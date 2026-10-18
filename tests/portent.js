"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const read = file => fs.readFileSync(path.join(__dirname, "..", file), "utf8");
const portent = read("src/dndbeyond/content-scripts/portent.js");
const utils = read("src/dndbeyond/base/utils.js");
let passed = 0;
async function test(name, run) { await run(); passed++; console.log("PASS " + name); }
function setup() {
    const values = { "waybeyond20-portent": { dice: [{ id: "a", value: 17, used: false }, { id: "b", value: 3, used: false }], selected: "a" } };
    const logs = [], prompts = [], results = [];
    let nextChoice = "a", auto = false, generation = 0;
    const owner = {
        _id: "1", hasClassFeature: name => name === "Portent", type: () => "Character",
        getSetting: (key, fallback) => values[key] ?? fallback,
        getGlobalSetting: (key, fallback) => key === "roll-type" ? 3 : fallback,
        mergeCharacterSettings: (updates, cb) => { Object.assign(values, JSON.parse(JSON.stringify(updates))); cb?.(); },
        getDict: () => ({ id: "1", settings: {} })
    };
    const c = {
        console, Map, Uint32Array, Promise, Math, Date, setTimeout,
        crypto: { getRandomValues: bytes => bytes[0] = 16, randomUUID: () => "rest-" + (++generation) },
        character: owner, character_settings: {},
        RollType: { NORMAL: 0, QUERY: 3, ADVANTAGE: 4, DISADVANTAGE: 5, DOUBLE: 1, THRICE: 2, SUPER_ADVANTAGE: 6, SUPER_DISADVANTAGE: 7, OVERRIDE_ADVANTAGE: 8, OVERRIDE_DISADVANTAGE: 9 },
        WhisperType: { NO: 0, YES: 1, QUERY: 2, HIDE_NAMES: 3 },
        key_modifiers: {},
        alertify: { warning: msg => logs.push(msg) },
        addEffect: (req, effect) => { (req.effects ||= []).push(effect); },
        wayBeyond20ScheduleActiveEffectBadgeRefresh() {},
        wayBeyond20GetTurnTrackerState: () => ({ inCombat: false }),
        cleanRoll: value => String(value),
        wayBeyond20ExtensionContextAvailable: () => true,
        DigitalDiceManager: { isEnabled: () => false },
        wayBeyond20TrackRollDelivery: () => ({invoked: false}),
        wayBeyond20RollDeliveries: new Map(), wayBeyond20ResolvedRollHooks: new Map(),
        wayBeyond20NotifyDispatchFailure: err => logs.push(err),
        beyond20SendMessageFailure() {},
        wayBeyond20SendRuntimeMessage: async req => { results.push(req); return {ok: true}; },
        dndbeyondDiceRoller: {
            _prompter: { prompt: async (title, html) => {
                prompts.push({title,html});
                if (nextChoice === null) return null;
                return { attr: () => nextChoice, find: () => ({prop: () => auto}) };
            } },
            queryWhisper: async () => 0,
            queryAdvantage: async () => { logs.push("advantage query"); return 0; },
            handleRollRequest: async req => results.push(req)
        }
    };
    vm.createContext(c);
    vm.runInContext(portent, c);
    vm.runInContext(utils.slice(utils.indexOf("async function sendRoll("), utils.indexOf("// ---- Dispatch outcome")), c);
    const request = (type = "saving-throw", extra = {}) => ({type, name: "Wisdom", modifier: "+4", character: {settings: {}}, advantage: 3, ...extra});
    return { c, owner, values, logs, prompts, results, request, choice: value => nextChoice = value, auto: value => auto = value };
}

(async () => {
    await test("manual acceptance replaces raw d20 and spends exactly one die after dispatch", async () => {
        const t = setup(), req = t.request();
        assert.equal(await t.c.wayBeyond20PortentDispatch(t.owner, req, async () => {
            assert.equal(t.values["waybeyond20-portent"].dice[0].used, false);
            assert.equal(req.d20, "17"); assert.equal(req.modifier, "+4"); return true;
        }), true);
        assert.equal(t.values["waybeyond20-portent"].dice[0].used, true);
        assert.equal(t.values["waybeyond20-portent"].dice[1].used, false);
        assert.equal(t.values["waybeyond20-portent"].selected, null);
        assert.equal(req.advantage, 0);
    });
    await test("No rolls normally and deselects; closing cancels and preserves selection", async () => {
        for (const choice of ["no", null]) {
            const t = setup(); t.choice(choice); let sent = 0;
            const req = t.request();
            await t.c.wayBeyond20PortentDispatch(t.owner, req, async () => {sent++; return true;});
            assert.equal(sent, choice === "no" ? 1 : 0);
            assert.equal(req["waybeyond20-portent-value"], undefined);
            assert.equal(t.values["waybeyond20-portent"].dice[0].used, false);
            assert.equal(t.values["waybeyond20-portent"].selected, choice === "no" ? null : "a");
        }
    });
    await test("failed or thrown delivery preserves dice and selected state", async () => {
        const t = setup();
        assert.equal(await t.c.wayBeyond20PortentDispatch(t.owner,t.request(),async()=>false), false);
        await assert.rejects(t.c.wayBeyond20PortentDispatch(t.owner,t.request(),async()=>{throw Error("offline");}));
        assert.equal(t.values["waybeyond20-portent"].dice[0].used, false);
        assert.equal(t.values["waybeyond20-portent"].selected, "a");
    });
    await test("remembered confirmation is reversible and manual selection suppresses automatic prompt", async () => {
        const t = setup(); t.auto(true); t.values["portent-prompts"] = true;
        await t.c.wayBeyond20PortentDispatch(t.owner,t.request(),async()=>false);
        assert.equal(t.values["portent-auto-proceed"], true); assert.equal(t.prompts.length,1);
        await t.c.wayBeyond20PortentDispatch(t.owner,t.request(),async()=>false); assert.equal(t.prompts.length,1);
        t.values["portent-auto-proceed"] = false;
        await t.c.wayBeyond20PortentDispatch(t.owner,t.request(),async()=>false); assert.equal(t.prompts.length,2);
    });
    await test("all d20 categories use inclusive modified thresholds and exclude spent dice", async () => {
        const t = setup(); const state = t.c.wayBeyond20PortentState(t.owner);
        for (const [type, category, extra] of [
            ["attack","attack",{"to-hit":"+4",rollAttack:true}], ["spell-attack","attack",{"to-hit":"+4"}],
            ["saving-throw","save",{}], ["saving-throw","concentration",{"waybeyond20-concentration-dc":10}],
            ["death-save","death",{}], ["skill","ability",{}], ["ability","ability",{}], ["initiative","initiative",{initiative:"+4"}]
        ]) {
            const req = t.request(type,extra); t.values["portent-threshold-"+category] = "21";
            assert.equal(t.c.wayBeyond20PortentCategory(req),category);
            assert.deepEqual(Array.from(t.c.wayBeyond20PortentCandidates(t.owner,req,state),d=>d.value),[17]);
            t.values["portent-threshold-"+category] = "22";
            assert.equal(t.c.wayBeyond20PortentCandidates(t.owner,req,state).length,0);
        }
        state.dice[0].used = true; t.values["portent-threshold-save"] = "10";
        assert.equal(t.c.wayBeyond20PortentCandidates(t.owner,t.request(),state).length,0);
    });
    await test("automatic suggestions default off; low/blank/invalid thresholds stay quiet; bonus dice are not guessed", async () => {
        const t=setup(); t.values["waybeyond20-portent"].selected=null;
        await t.c.wayBeyond20PortentDispatch(t.owner,t.request(),async()=>true); assert.equal(t.prompts.length,0);
        t.values["portent-prompts"]=true;
        for(const threshold of ["","abc","40"]) {
            t.values["portent-threshold-save"]=threshold;
            await t.c.wayBeyond20PortentDispatch(t.owner,t.request(),async()=>true);
        }
        assert.equal(t.prompts.length,0);
        assert.equal(t.c.wayBeyond20PortentFlatModifier(t.request("saving-throw", {character:{settings:{"custom-roll-dice":"+1d4-2+3"}}})),5);
        t.values["portent-threshold-save"]="21";
        await t.c.wayBeyond20PortentDispatch(t.owner,t.request(),async()=>true);
        assert.equal(t.prompts.length,1); assert.match(t.prompts[0].html,/17 \(total 21\)/);
    });
    await test("damage, healing, cards and custom dice never consume selected Portent", async () => {
        const t=setup();
        for(const req of [t.request("trait"),t.request("custom"),t.request("hit-dice"),t.request("spell-card"),t.request("attack",{rollAttack:false,"to-hit":"+4"}),t.request("spell-attack")]) {
            await t.c.wayBeyond20PortentDispatch(t.owner,req,async()=>true);
        }
        assert.equal(t.prompts.length,0); assert.equal(t.values["waybeyond20-portent"].dice[0].used,false);
    });
    await test("tracked turns prevent a second use and release on the next turn", async () => {
        const t=setup(); let turn="a";
        t.c.wayBeyond20GetTurnTrackerState=()=>({inCombat:true,combatStartedAt:1,currentRoll20Turn:{turnKey:turn}});
        await t.c.wayBeyond20PortentDispatch(t.owner,t.request(),async()=>true);
        t.values["waybeyond20-portent"].selected="b"; t.choice("b");
        assert.equal(await t.c.wayBeyond20PortentDispatch(t.owner,t.request(),async()=>true),false);
        turn="b";
        assert.equal(await t.c.wayBeyond20PortentDispatch(t.owner,t.request(),async()=>true),true);
        assert.equal(t.values["waybeyond20-portent"].dice[1].used,true);
    });
    await test("completed Long Rest replaces all dice; Short Rest and reading state never reroll", async () => {
        const t=setup(); const before=JSON.stringify(t.values);
        t.c.wayBeyond20PortentState(t.owner); await t.c.wayBeyond20RefreshPortentForRest(t.owner,"short");
        assert.equal(JSON.stringify(t.values),before);
        await t.c.wayBeyond20RefreshPortentForRest(t.owner,"long");
        assert.equal(t.values["waybeyond20-portent"].dice.length,2);
        assert.equal(t.values["waybeyond20-portent"].dice[0].value,17);
        assert.equal(t.values["waybeyond20-portent"].selected,null);
        assert.notEqual(t.values["waybeyond20-portent"].dice[0].id,"a");
        t.owner.hasClassFeature=()=>true;
        await t.c.wayBeyond20RefreshPortentForRest(t.owner,"long");
        assert.equal(t.values["waybeyond20-portent"].dice.length,3);
    });
    await test("simultaneous rolls serialize and cannot reuse the same selected die", async () => {
        const t=setup(); let replaced=0;
        await Promise.all([1,2].map(()=>{const req=t.request();return t.c.wayBeyond20PortentDispatch(t.owner,req,async()=>{if(req.d20)replaced++; await Promise.resolve();return true;});}));
        assert.equal(replaced,1); assert.equal(t.prompts.length,1);
    });
    await test("real sendRoll bypasses roll-mode query, routes through renderer, keeps whisper cancellation safe", async () => {
        const t=setup(); t.c.key_modifiers.super_disadvantage=true;
        assert.equal(await t.c.sendRoll(t.owner,"saving-throw","1d20+4",{name:"Wisdom",modifier:"+4"}),true);
        assert.equal(t.logs.includes("advantage query"),false);
        assert.equal(t.results[0]["waybeyond20-portent-value"],17); assert.equal(t.results[0].advantage,0);
        const cancel=setup(); cancel.owner.getGlobalSetting=(key,fallback)=>key==="whisper-type"?2:fallback;
        cancel.c.dndbeyondDiceRoller.queryWhisper=async()=>null;
        assert.equal(await cancel.c.sendRoll(cancel.owner,"saving-throw","1d20+4",{name:"Wisdom",modifier:"+4"}),false);
        assert.equal(cancel.values["waybeyond20-portent"].dice[0].used,false);
    });
    await test("real renderer produces no d20, keeps modifiers, natural 1/20, crit ranges and bonus dice", async () => {
        const t=setup();
        vm.runInContext(read("src/common/dice.js")+"\nthis.DNDBRoll=DNDBRoll;",t.c);
        vm.runInContext(read("src/common/roll_renderer.js")+"\nthis.Renderer=Beyond20RollRenderer;",t.c);
        const renderer=new t.c.Renderer({roll:(formula,data)=>new t.c.DNDBRoll(formula,data)}, {}, {});
        for(const value of [1,17,19,20]) {
            const req={advantage:6,"waybeyond20-portent-value":value};
            const {rolls}=renderer.getToHit(req,"",{WIS:"+4"},"saving-throw");
            assert.equal(rolls.length,1);assert.equal(rolls[0].dice.length,0);
            await rolls[0].roll();assert.equal(rolls[0].total,value+4);
            assert.equal(rolls[0].toJSON()["critical-success"],value===20);
            assert.equal(rolls[0].toJSON()["critical-failure"],value===1);
            assert.equal(renderer.isCriticalHitD20(rolls,19),value>=19);
        }
        const {rolls}=renderer.getToHit({"waybeyond20-portent-value":17}," + 4 + 1d4");
        assert.deepEqual(Array.from(rolls[0].dice,d=>d.faces),[4]);
        assert.match(rolls[0].formula,/17/);
    });
    await test("feature gate, character routing and prompt escaping are preserved", async () => {
        assert.equal(setup().c.wayBeyond20HasPortent({_id:"monster-without-class-features"}),false);
        const t=setup(); t.owner.hasClassFeature=()=>false;
        await t.c.wayBeyond20PortentDispatch(t.owner,t.request(),async()=>true);assert.equal(t.prompts.length,0);
        t.owner.hasClassFeature=()=>true;t.c.character={};
        assert.equal(await t.c.wayBeyond20PortentDispatch(t.owner,t.request(),async()=>true),false);
        assert.equal(t.c.wayBeyond20PortentEscape('<img onerror="x">'),"&lt;img onerror=&quot;x&quot;&gt;");
    });
    console.log(`Portent: ${passed} checks passed. Live sheet/VTT acceptance is separate.`);
})().catch(error=>{console.error(error);process.exitCode=1;});
