"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { h, createDocument, miniJQuery } = require("./helpers/mini-dom");
const read = file => fs.readFileSync(path.join(__dirname, "..", file), "utf8").replace(/\r\n/g, "\n");
const content = read("src/dndbeyond/content-scripts/character.js");
const utils = read("src/dndbeyond/base/utils.js");
// Layout guard: names belong in their own native-sized, right-aligned column,
// not in the clipped header or in native resistance elements.
assert.match(content, /"waybeyond20-buffs-badge", "BUFFS", "Active Buffs"/);
assert.match(content, /addClass\("waybeyond20-buff-name"\)\.text\(effect.name\)/);
const buffStyle = read("src/extension/beyond20.css").match(/\.waybeyond20-buff-name \{([^}]+)\}/)[1];
assert.match(buffStyle, /text-align: right/);
assert.match(buffStyle, /font: inherit/);
assert.match(buffStyle, /white-space: normal/);
function fn(source, name) {
    const start = source.search(new RegExp(`^(?:async )?function ${name}\\(`, "m"));
    assert.ok(start >= 0, name);
    const rest = source.slice(start + 1);
    const end = rest.search(/^(?:(?:async )?function |const |let |class )/m);
    return source.slice(start, end < 0 ? undefined : start + 1 + end);
}
const document = createDocument();
const ctx = { document, console, setTimeout, clearTimeout, Promise, Date, Number,
    wayBeyond20EscapeHtml: value => String(value).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;") };
vm.createContext(ctx);
// Native Cast/Use must reuse the spell pipeline, then replay exactly the original
// resource control once. Same-name spells from a different source are not interchangeable.
{
    const nativeDoc = createDocument();
    const owner = {};
    let clicks = 0, warnings = 0;
    const nativeRow = (source, action = "Cast") => h("div", {class:"ct-spells-spell"},
        h("span", {class:"ddbc-spell-name"}, "Example Ward"),
        h("div", {class:"ct-spells-spell__meta"}, source),
        h("div", {class:"ct-spells-spell__action"}, h("button", {}, action)));
    const first = nativeRow("Item");
    const other = nativeRow("Feat");
    nativeDoc.body.append(first, other);
    first.querySelector("button").onclick = () => clicks++;
    other.querySelector("button").onclick = () => { throw Error("wrong source spent"); };
    const native = { document:nativeDoc, character:owner, WeakSet,
        wayBeyond20SpellRowLevel:()=>1, alertify:{warning:()=>warnings++} };
    vm.createContext(native);
    vm.runInContext("const wayBeyond20NativeCastReplays = new WeakSet();", native);
    vm.runInContext(fn(content,"wayBeyond20NativeSpellIdentity"), native);
    vm.runInContext(fn(content,"wayBeyond20CommitNativeSpellCast"), native);
    const identity = native.wayBeyond20NativeSpellIdentity(first);
    const commit = native.wayBeyond20CommitNativeSpellCast(owner,identity,"cast");
    assert.equal(clicks,0,"preflight/Cancel has no native spend");
    commit(); commit(); assert.equal(clicks,1,"resource replay is exactly once");
    native.character = {};
    native.wayBeyond20CommitNativeSpellCast(owner,identity,"cast")();
    assert.equal(clicks,1,"never spend on a switched character");
    native.character = owner;
    nativeDoc.body.append(nativeRow("Item"));
    native.wayBeyond20CommitNativeSpellCast(owner,identity,"cast")();
    assert.equal(clicks,1); assert.equal(warnings,1,"ambiguous identity is not guessed");
    // A same-name daily Use and slot-funded Cast must never spend one another.
    nativeDoc.body.replaceChildren();
    const free = nativeRow("Feat", "Use"), slot = nativeRow("Feat", "Cast");
    nativeDoc.body.append(free,slot);
    let freeUses=0, slotUses=0;
    free.querySelector("button").onclick=()=>freeUses++;
    slot.querySelector("button").onclick=()=>slotUses++;
    const freeIdentity=native.wayBeyond20NativeSpellIdentity(free);
    native.wayBeyond20CommitNativeSpellCast(owner,freeIdentity,"use")();
    assert.equal(freeUses,1); assert.equal(slotUses,0);
    native.wayBeyond20CommitNativeSpellCast(owner,freeIdentity,"cast")();
    assert.equal(freeUses,1); assert.equal(slotUses,1);
    free.querySelector("button").disabled=true;
    native.wayBeyond20CommitNativeSpellCast(owner,freeIdentity,"use")();
    assert.equal(freeUses,1); assert.equal(slotUses,1,"disabled Use never falls back to spending a slot");
    // React can replace the original row while a target dialog is open.
    const refreshed=nativeRow("Feat","Use");
    refreshed.querySelector("button").onclick=()=>freeUses++;
    nativeDoc.body.replaceChildren(refreshed,slot);
    native.wayBeyond20CommitNativeSpellCast(owner,freeIdentity,"use")();
    assert.equal(freeUses,2,"fresh row is re-found at commit time");
    assert.match(fn(content,"wayBeyond20RunNativeSpellCast"),/await execute\("ct-spell-pane"/);
    assert.equal((fn(content,"rollSpell").match(/wayBeyond20CommitAfterDispatch\(roll_properties, nativeCast\)/g)||[]).length,2,
        "attack and utility spells use the same successful-dispatch native spend hook");
    assert.match(fn(content,"wayBeyond20InstallNativeSpellCasting"),/wayBeyond20NativeCastReplays\.has\(button\)/);
    assert.match(fn(content,"wayBeyond20InstallNativeSpellCasting"),/if \(wayBeyond20NativeCastPending\) return/);
}
vm.runInContext(read("src/dndbeyond/content-scripts/concentration.js"), ctx);
const defenses = { resistance: ["Fire"], immunity: ["Poison"], vulnerability: ["Cold"] };
const damage = (amount, type = "Unmodified") => ctx.wayBeyond20ConcentrationDamage([{amount, type}], defenses);
assert.equal(damage(27).total, 27);
assert.equal(damage(27, "Fire").total, 13);
assert.equal(damage(27, "Fire").total, 13, "recalculation never halves the previous result");
assert.equal(damage(27).total, 27, "Unmodified restores raw value");
assert.equal(damage(27, "Poison").total, 0);
assert.equal(damage(27, "Cold").total, 54);
assert.equal(damage(100).dc, 30);
assert.equal(damage(21).dc, 10);
for (const value of [-1, "", "1.5", "NaN"]) assert.equal(damage(value), null);
assert.equal(ctx.wayBeyond20ConcentrationDamage([{amount:27,type:"Fire"},{amount:15,type:"Unmodified"}], defenses).dc, 14);

document.body.append(h("div", {class:"ct-defenses-summary__group"},
    h("svg", {class:"ddbc-resistance-icon"}),
    h("span", {class:"ct-defenses-summary__defense"}, "Fire"),
    h("span", {class:"ct-defenses-summary__defense"}, "Bludgeoning from nonmagical attacks")));
assert.deepEqual(Array.from(ctx.wayBeyond20ReadDamageDefenses().resistance), ["Fire"]);

function row(amount, type = "Unmodified") {
    const input = h("input"); input.value = String(amount);
    const select = h("select"); select.value = type;
    return h("div", {class:"waybeyond20-concentration-source"}, input, select,
        h("button", {"data-remove-source":""}), h("small", {"data-effective-damage":""}));
}
const sources = h("div", {"data-damage-sources":""}, row(27));
const total = h("p", {"data-concentration-total":""});
const form = h("form", {"data-defenses":JSON.stringify(defenses)}, sources, total);
const ok = h("button");
ctx.wayBeyond20WireConcentrationForm(form, ok);
assert.match(total.textContent, /27 HP.*DC 13/);
sources.querySelector("select").value = "Fire";
form.dispatchEvent({type:"change"});
assert.match(total.textContent, /13 HP.*DC 10/);
sources.append(row(15)); form.dispatchEvent({type:"input"});
assert.match(total.textContent, /28 HP.*DC 14/);
sources.querySelector("input").value = "-2"; form.dispatchEvent({type:"input"});
assert.equal(ok.disabled, true);
sources.querySelector("input").value = "27"; form.dispatchEvent({type:"input"});
assert.equal(ok.disabled, false);
assert.match(ctx.wayBeyond20ConcentrationQueryHtml({name:"Test <spell>"}, 27, defenses), /Test &lt;spell>/);
assert.match(ctx.wayBeyond20ConcentrationRowHtml(0, 2), /<option>Unmodified<\/option>/);

async function run() {
    // Exercise the REAL rollSpell function, not just source-string guards. The
    // surrounding UI/roller services are fixtures; live DDB coverage is recorded
    // separately. Arbitrary names/sources ensure this is not a Shield of Faith fix.
    for (const kind of ["utility", "attack", "save", "healing", "temporary-hp"]) {
        for (const mode of ["normal", "ritual", "display", null]) {
            const doc = createDocument();
            const name = h("span", {class:"ddbc-spell-name"}, `Fixture ${kind}`);
            // mini-dom deliberately has no browser firstChild accessor.
            name.firstChild = name.childNodes[0];
            const pane = h("div", {class:"ct-spell-pane"},
                h("div", {class:"ct-sidebar__heading"}, name),
                h("div", {class:"ct-sidebar__header-parent"}, "Unusual Talent Source"),
                h("div", {class:"ct-spell-caster__casting-level-current"}, "3rd"),
                h("div", {class:"ct-spell-detail__level-school-item"}, "1st Level Abjuration"));
            if (["healing", "temporary-hp"].includes(kind)) pane.append(
                h("div", {class:"ct-spell-caster__modifiers--healing"},
                    h("div", {class:kind === "healing" ? "ct-spell-caster__modifier--hp" : "ct-spell-caster__modifier--temp"},
                        h("span", {class:"ct-spell-caster__modifier-amount"},
                            kind === "healing" ? "Regain 2d8+2 Hit Points" : "Regain 1d6 Temp Hit Points"))));
            doc.body.append(pane);
            let sent = [], spent = 0, effects = 0, cancelTarget = false, delivered = true;
            const fixture = {
                $:input => miniJQuery(typeof input === "string" ? doc.querySelectorAll(input) : input),
                propertyListToDict:()=>({Duration:"1 minute", "Casting Time":"1 action", Components:"V",
                    ...(kind === "save" ? {"Attack/Save":"STR 15"} : {})}),
                descriptionToString:()=>"Fixture description", key_modifiers:{},
                character:{hasClassFeature:()=>false, getSetting:(k,f)=>f},
                findToHit:()=>kind === "attack" ? "+5" : null,
                wayBeyond20ChooseRitualMode:async()=>mode,
                wayBeyond20ParseTalent:x=>x,
                wayBeyond20ResolveSpellcastingSource:async()=>({source:null}),
                wayBeyond20ApplyScrollSpellcastingToRollInput:x=>x,
                addCustomDamages(){}, handleSpecialHealingSpells(){},
                buildAttackRoll:async(c,t,n,d,p,damages,types)=>({name:n,damages,"damage-types":types}),
                wayBeyond20ApplyBedsideMannerIntent(){}, wayBeyond20ApplyRitualMode(){},
                wayBeyond20ShouldTrackSpellEffect:()=>true,
                wayBeyond20BuildSpellEffect:()=>({id:"fixture"}),
                wayBeyond20ApplySpellEffectWithTargets:async()=>cancelTarget ? null : {},
                wayBeyond20CommitSpellRollSettings:()=>effects++,
                wayBeyond20AttachActivationResource(){},
                wayBeyond20ConfirmCastingConflicts:async()=>true,
                wayBeyond20MaybeAddElementalStrike:async()=>{},
                wayBeyond20ApplyOccultistIntrusion:async()=>{},
                sendRollWithCharacter:async(type,fallback,args)=>{
                    assert.equal(spent,0,"no native spending before successful dispatch");
                    sent.push({type,args});
                    if (delivered) for (const commit of args["waybeyond20-after-dispatch"] || []) await commit();
                    return delivered;
                }
            };
            vm.createContext(fixture);
            vm.runInContext(fn(content,"wayBeyond20CommitAfterDispatch"),fixture);
            vm.runInContext(fn(content,"rollSpell"),fixture);
            await fixture.rollSpell(false,false,false,()=>spent++);
            assert.equal(spent,mode === "normal" ? 1 : 0,`${kind}/${mode}: only normal casts spend native resource`);
            assert.equal(sent.length,mode === null ? 0 : 1);
            assert.equal(effects,mode === "normal" || mode === "ritual" ? 1 : 0);
            if (sent.length) {
                assert.equal(sent[0].type,kind === "utility" || mode === "display" ? "spell-card" : "spell-attack");
                assert.equal(sent[0].args["cast-at"],"3rd","upcast level survives the shared flow");
                if (mode !== "display" && ["healing","temporary-hp"].includes(kind))
                    assert.equal(sent[0].args["damage-types"][0],kind === "healing" ? "Healing" : "Temp HP");
            }
            if (mode === "normal") {
                spent=0; effects=0; sent=[]; cancelTarget=true;
                await fixture.rollSpell(false,false,false,()=>spent++);
                assert.equal(sent.length,0,"target cancellation does not dispatch");
                assert.equal(spent,0); assert.equal(effects,0);
                cancelTarget=false; delivered=false;
                await fixture.rollSpell(false,false,false,()=>spent++);
                assert.equal(spent,0,"failed dispatch does not run native spend callback");
                assert.equal(effects,0,"failed dispatch does not apply effects");
            }
        }
    }
    const effect = { id:"old", name:"Test Ward" };
    let current = effect, removed = [], sent = 0, passed = 12, delivered = true, cancel = false, replacement = false;
    ctx.character = { _hp:28, _temp_hp:5, _max_hp:28, getAbility:()=>({mod:2}), hasFeat:()=>false,
        hasClassFeature:()=>false, getSetting:(key,fallback)=>fallback };
    const owner = ctx.character;
    ctx.wayBeyond20CharacterHelperEnabled = () => true;
    ctx.wayBeyond20GetConcentrationEffect = () => current;
    ctx.wayBeyond20EffectKey = e => e.id;
    ctx.wayBeyond20RemoveTrackedEffect = key => removed.push(key);
    ctx.wayBeyond20FormatSigned = n => n >= 0 ? `+${n}` : String(n);
    ctx.addEffect = () => {};
    ctx.RollType = { OVERRIDE_ADVANTAGE:8 };
    ctx.alertify = {warning(){},message(){}};
    ctx.$ = () => ({ filter(){return this;},first(){return this;},find(){return this;},text:()=>"+2" });
    ctx.dndbeyondDiceRoller = {_prompter:{prompt:async()=>cancel ? null : miniJQuery(h("form", {}, row(24)))}};
    ctx.sendRollWithCharacter = async (type, fallback, args) => {
        sent++;
        args["waybeyond20-capture-result"]({}, [{total:passed,isDiscarded:()=>false},{total:1,isDiscarded:()=>true}]);
        if (replacement) current = {id:"new",name:"New Ward"};
        return delivered;
    };
    vm.runInContext(fn(content,"wayBeyond20RunConcentrationCheck"), ctx);
    await ctx.wayBeyond20RunConcentrationCheck(24); assert.equal(removed.length,0,"equal DC succeeds");
    passed=11; await ctx.wayBeyond20RunConcentrationCheck(24); assert.deepEqual(removed,["old"]);
    removed=[]; delivered=false; await ctx.wayBeyond20RunConcentrationCheck(24); assert.equal(removed.length,0);
    delivered=true; replacement=true; await ctx.wayBeyond20RunConcentrationCheck(24); assert.equal(removed.length,0,"never remove replacement effect");
    replacement=false; current=effect; cancel=true; const before=sent;
    await ctx.wayBeyond20RunConcentrationCheck(24); assert.equal(sent,before);
    assert.equal(owner._hp,28,"dialog never changes HP");
    cancel=false; const queued=[];
    ctx.wayBeyond20QueueConcentrationCheck = (...args) => queued.push(args);
    ctx.wayBeyond20ObserveConcentrationHP(owner,{hp:28,temp:5,max:28},{hp:28,temp:0,max:28});
    await new Promise(r=>setTimeout(r,210)); assert.equal(queued.length,0,"passive sync is quiet");
    const amount=h("input",{"aria-label":"Hit Points Adjustment"}); amount.value="8";
    const button=h("button",{},"Damage"); document.body.append(h("div",{},amount,button));
    ctx.wayBeyond20ArmConcentrationDamage({type:"click",target:button});
    owner._temp_hp=0; ctx.wayBeyond20ObserveConcentrationHP(owner,{}, {hp:28,temp:0,max:28});
    owner._hp=25; ctx.wayBeyond20ObserveConcentrationHP(owner,{}, {hp:25,temp:0,max:28});
    await new Promise(r=>setTimeout(r,210)); assert.equal(queued.length,1); assert.equal(queued[0][0],8);
    ctx.wayBeyond20ObserveConcentrationHP(owner,{}, {hp:25,temp:0,max:28});
    await new Promise(r=>setTimeout(r,210)); assert.equal(queued.length,1,"same damage not repeated");

    // Real generic effect parser and planner: other target receives AC, caster keeps only concentration.
    for (const name of ["wayBeyond20NormalizeTalentText","wayBeyond20TalentTextLower","wayBeyond20UniquePush",
        "wayBeyond20WordToNumber","wayBeyond20ParseTalentTargeting","wayBeyond20ParseTalentEffectData",
        "wayBeyond20EffectHasExecutableTargetData","wayBeyond20TalentTargetsAnotherCreature",
        "wayBeyond20TalentNeedsTargetSelection","wayBeyond20ApplySelectedTargetToEffect","wayBeyond20ApplySpellEffectWithTargets"]) vm.runInContext(fn(content,name),ctx);
    const text="A shimmering field surrounds a creature of your choice within range, granting it a +2 bonus to AC for the duration.";
    const talent={targeting:ctx.wayBeyond20ParseTalentTargeting("60 ft.",text)};
    const shield={id:"shield",name:"Shield of Faith",concentration:true,data:ctx.wayBeyond20ParseTalentEffectData(text)};
    ctx.wayBeyond20CreateSpellEffectPlan=()=>({local:[],remote:[]});
    ctx.wayBeyond20EffectTargetForCurrentCharacter=()=>({name:"Caster",relation:"self"});
    ctx.wayBeyond20CurrentCharacterName=()=>"Caster";
    ctx.wayBeyond20SelectTalentTargets=async()=>[{key:"other",name:"Ally",relation:"other",manual:true}];
    ctx.wayBeyond20CharacterMatchesMessageCharacter=()=>false;
    ctx.wayBeyond20GenerateEffectId=()=>"generated";
    ctx.wayBeyond20NormalizeEffectFlags=x=>x;
    let plan=await ctx.wayBeyond20ApplySpellEffectWithTargets(owner,shield,talent);
    assert.equal(plan.local[0].data.length,0); assert.equal(plan.local[0].concentration,true);
    assert.equal(plan.remote[0][1].data[0].value,2); assert.equal(plan.remote[0][1].concentration,false);
    ctx.wayBeyond20SelectTalentTargets=async()=>[{name:"Caster",relation:"self"}];
    plan=await ctx.wayBeyond20ApplySpellEffectWithTargets(owner,shield,talent);
    assert.equal(plan.local[0].data[0].value,2); assert.equal(plan.remote.length,0);
    ctx.wayBeyond20SelectTalentTargets=async()=>[];
    assert.equal(await ctx.wayBeyond20ApplySpellEffectWithTargets(owner,shield,talent),null);

    // Real sendRoll with Query selected: utility cards must never call queryAdvantage.
    const rollctx = { console:{log(){}}, key_modifiers:{}, cleanRoll:String,
        WhisperType:{NO:0,YES:1,QUERY:2,HIDE_NAMES:3},
        RollType:{NORMAL:0,QUERY:2,OVERRIDE_ADVANTAGE:8,OVERRIDE_DISADVANTAGE:9},
        DigitalDiceManager:{isEnabled:()=>false}, wayBeyond20ExtensionContextAvailable:()=>true,
        wayBeyond20SendRuntimeMessage:async()=>({ok:true}), beyond20SendMessageFailure(){},
        dndbeyondDiceRoller:{queryAdvantage:()=>{throw Error("unnecessary dice prompt");}} };
    vm.createContext(rollctx); vm.runInContext(fn(utils,"sendRoll"),rollctx);
    const caster={type:()=>"Character",getGlobalSetting:(key,fallback)=>key==="roll-type"?2:fallback,getDict:()=>({})};
    assert.equal(await rollctx.sendRoll(caster,"spell-card",0,{name:"Shield of Faith"}),true);
    assert.match(read("src/common/roll_renderer.js"),/wayBeyond20HandleResolvedD20\(request, rolls, type\);\s*if[^\n]*\n\s*wayBeyond20CaptureResolvedRoll\(request, rolls, \[\]\)/);
    console.log("Concentration and utility-spell tests passed: damage math, form, result lifecycle, HP trigger and target plans.");
}
run().catch(e=>{console.error(e);process.exitCode=1;});
