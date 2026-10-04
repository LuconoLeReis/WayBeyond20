// WB20-0065 group-test follow-up (Ian, 2026-09-16). Regressions for four tester reports:
//   1. A melee attack did not spend the Action: the native Actions row (rollAction) versus
//      the weapon's item pane (rollItem), and how an Actions-tab die click picks between them.
//   2. Breath Weapon offered Smite. Every Smite's trigger is hitting with a Melee weapon or an
//      Unarmed Strike; Breath Weapon is a saving throw with no attack roll.
//   3. Long Rest left Shield of Faith (Concentration, up to 10 minutes) tracked.
//   4. Efreeti's Fury "second 2d4" with one-handed, two-handed and both-variant Versatile attacks,
//      including which Versatile damage die an Actions-tab click actually rolls.
//
// Runs the real rollAction, rollItem, buildAttackRoll, Smite, Elemental Strike, dispatch, Long Rest
// tracker, renderer damage flags and totals, and the Roll20 damage template. D&D Beyond DOM reads
// are stubbed.
//
// GUARD cases describe current, required behavior and must pass.
// OPEN cases describe required behavior the current source does not have yet (recorded in the
// development report). By default each OPEN case must still fail, so a correction cannot land
// silently; when it passes, promote it to a GUARD. WB20_REQUIRE_OPEN=1 requires OPEN cases to pass.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = process.env.WB20_SOURCE_ROOT ? path.resolve(process.env.WB20_SOURCE_ROOT) : path.resolve(__dirname, "..");
const read = relative => fs.readFileSync(path.join(root, ...relative.split("/")), "utf8");
const characterSource = read("src/dndbeyond/content-scripts/character.js");
const baseUtilsSource = read("src/dndbeyond/base/utils.js");
const rendererSource = read("src/common/roll_renderer.js");
const roll20Source = read("src/roll20/content-script.js");

function between(source, startText, endText) {
    const start = source.indexOf(startText);
    const end = source.indexOf(endText, start + startText.length);
    assert.notEqual(start, -1, `Missing ${startText}`);
    assert.notEqual(end, -1, `Missing ${endText}`);
    return source.slice(start, end);
}

function topLevelFunction(source, name) {
    const match = new RegExp(`^(?:async )?function ${name}\\(`, "m").exec(source);
    assert.ok(match, `Missing function ${name}`);
    const rest = source.slice(match.index + match[0].length);
    const next = /^(?:async )?function |^(?:const|let|var|class) /m.exec(rest);
    return source.slice(match.index, next ? match.index + match[0].length + next.index : source.length);
}

function topLevelConst(source, name) {
    const match = new RegExp(`^const ${name} = `, "m").exec(source);
    assert.ok(match, `Missing const ${name}`);
    const rest = source.slice(match.index + match[0].length);
    const next = /^(?:async )?function |^(?:const|let|var|class) /m.exec(rest);
    return source.slice(match.index, next ? match.index + match[0].length + next.index : source.length);
}

const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));

const damageFlagsSource = rendererSource.slice(
    rendererSource.indexOf("class DAMAGE_FLAGS {"),
    rendererSource.indexOf("\n}\n", rendererSource.indexOf("class DAMAGE_FLAGS {")) + 3
);
// Renderer: non-critical flag loop, critical loop, and the totals block of postDescription.
const rendererDamageLoop = between(rendererSource, "const seen_spell_damages = {};", "await this._roller.resolveRolls(request.name, all_rolls, request)");
const rendererCriticalLoop = between(rendererSource, "const conditional_indices = new Set();", "await this._roller.resolveRolls(request.name, critical_damage_rolls, request);");
const rendererTotals = between(rendererSource, "let add_totals =", "let roll = null;");

const CHARACTER_FUNCTIONS = [
    "sendRollWithCharacter", "wayBeyond20DispatchRollWithCharacter", "wayBeyond20RestoreCharacterSheetTab", "addEffect",
    "wayBeyond20AttachLimitedUse", "wayBeyond20ActivationResource", "wayBeyond20AttachTurnResource",
    "wayBeyond20AttachAdditionalTurnResource", "wayBeyond20AttachActivationResource",
    "wayBeyond20AttachAttackActionResource", "wayBeyond20ActionTypeFromText",
    "wayBeyond20AttacksPerAttackAction", "wayBeyond20AttacksRemainingInAttackAction",
    "wayBeyond20SpendAttackAction",
    "wayBeyond20NormalizeFeatureLabel", "wayBeyond20PaladinSaveDC",
    "wayBeyond20RollIsUnarmedStrike", "wayBeyond20NormalizeAttackSemantics", "wayBeyond20ApplyDrainingAttackIntent",
    "wayBeyond20SmiteFormulaForSlot", "wayBeyond20MaybeAddSmite", "wayBeyond20AddSelectedSmite",
    "wayBeyond20AttackRollPresent", "wayBeyond20IsSmiteEligibleAttack",
    "wayBeyond20ElementalStrikeChoice", "wayBeyond20ElementalStrikeSummary", "wayBeyond20HasElementalStrike",
    "wayBeyond20ApplyElementalStrikeEffect", "wayBeyond20MaybeAddElementalStrike", "wayBeyond20RollElementalStrikeOption",
    "wayBeyond20IsElementalStrikeParent", "wayBeyond20RollElementalStrikeParent", "wayBeyond20RollPaladinSpecialAction",
    "wayBeyond20SplitDamageFormula", "wayBeyond20NextDamageId", "wayBeyond20AddDamage", "wayBeyond20DamageRowIndex",
    "wayBeyond20NormalizeActionPoolToDamages", "wayBeyond20CommitAfterDispatch", "capitalize",
    "rollItem", "rollAction", "handleCombatAttackIntegratedDie"
];

// ---- Minimal jQuery stand-in -------------------------------------------------------------
function jq(items = [], { text = "", val, find = {}, properties } = {}) {
    const object = {
        __jq: true,
        length: items.length,
        __properties: properties,
        text: () => text,
        val: () => val,
        toArray: () => items.slice(),
        eq: index => (items[index] && items[index].__jq) ? items[index] : jq([]),
        find: selector => find[selector] || jq([]),
        filter: () => object,
        first: () => object,
        attr: () => undefined,
        css: () => undefined,
        closest: () => jq([]),
        trigger: () => object
    };
    items.forEach((item, index) => { object[index] = item; });
    return object;
}

// The item pane's property rows. Only the Damage row is read for its inner values.
function itemPropertyList(properties, { damage, versatile = "" }) {
    const rows = Object.entries(properties).map(([key, value]) => {
        if (key !== "Damage") return jq([], { properties: { [key]: value } });
        const valueNode = jq([], {
            find: {
                ".ct-damage__value,.ddbc-damage__value": jq([], { text: damage }),
                ".ct-item-detail__versatile-damage,.ddbc-item-detail__versatile-damage": jq([], { text: versatile ? `(${versatile})` : "" })
            }
        });
        return jq([], { properties: { [key]: value }, find: { "> p": valueNode } });
    });
    rows.forEach(row => { row.__jq = true; });
    return jq(rows, { properties });
}

// ---- Sandbox -----------------------------------------------------------------------------
const DIVINE_SMITE = { name: "Divine Smite", level: 1, formula: "2d8", damageType: "Radiant", saveAbility: "", saveDc: null };
const PALADIN_SMITE_FUEL = { type: "paladin-smite", label: "Paladin's Smite", level: 1 };

function createSandbox({ features = [], settings = {}, smite = null, elementalChoice = null, sendResult = true, dom = () => null, declineSmite = false } = {}) {
    const log = { turnSpends: [], limitedUseSpends: [], slotSpends: [], freeSmiteSpends: 0, dispatched: [],
        sendRollCalls: 0, buildSmiteOptionsCalls: 0, smiteEligibility: [], executed: [], nativeUses: [],
        turnState: { action: 1, attacksRemaining: 0 } };
    const character = {
        _id: 111, _name: "Test Paladin", _proficiency: 2, _spell_saves: { Paladin: 12 },
        hasClassFeature: (name, substring) => features.some(feature => substring ? feature.includes(name) : feature === name),
        hasAction: () => false,
        hasRacialTrait: () => false,
        hasFeat: () => false,
        hasClass: () => false,
        hasGreatWeaponFighting: () => false,
        getClassLevel: () => 3,
        getAbility: () => ({ mod: 2 }),
        getSetting: (key, fallback) => settings[key] !== undefined ? settings[key] : fallback,
        getGlobalSetting: (key, fallback) => fallback,
        mergeCharacterSettings() {},
        _cacheToHit() {},
        _getToHitCache: () => null
    };
    const context = {
        console, Promise, setTimeout, character, settings: {}, log,
        key_modifiers: {},
        RollType: { OVERRIDE_ADVANTAGE: 99 },
        CriticalRules: { PHB: 0, HOMEBREW_MAX: 1 },
        $: selector => {
            if (selector && selector.__jq) return selector;
            if (selector && typeof selector === "object") return selector.__element || jq([selector]);
            return dom(String(selector)) || jq([]);
        },
        propertyListToDict: list => clone((list && list.__properties) || {}),
        descriptionToString: () => "",
        isItemATool: () => false,
        isItemAnInstruction: () => false,
        wayBeyond20IsProbablyMagicalItem: () => false,
        applyGWFIfRequired: (name, properties, damage) => damage,
        addCustomDamages() {},
        findToHit: () => null,
        includesNormalized: (list, value) => list.includes(String(value).toLocaleLowerCase().trim().replace(/[\s*]+$/, "")),
        handleSpecialGeneralAttacks: (d, t, p, s, { to_hit }) => to_hit,
        handleSpecialWeaponAttacks: (d, t, p, s, { to_hit }) => to_hit,
        handleSpecialMeleeAttacks: (d, t, p, s, { to_hit }) => to_hit,
        handleSpecialRangedAttacks: (d, t, p, s, { to_hit }) => to_hit,
        damagesToCrits: (c, damages) => damages.map(damage => `crit(${damage})`),
        applyRogueSneakAttack: async () => {},
        abbreviationToAbility: value => value,
        adjustRollAndKeyModifiersWithAdvantage() {},
        wayBeyond20ApplySavageAttacker() {},
        wayBeyond20ApplyBedsideMannerIntent() {},
        wayBeyond20CommitRollSettings() {},
        wayBeyond20ActionDescription: () => "",
        wayBeyond20AttachNativeActionUse: (request, name) => log.nativeUses.push(name),
        wayBeyond20CharacterDebug() {},
        wayBeyond20ActiveCharacterSheetTab: () => null,
        wayBeyond20BuildSmiteOptions: async () => {
            log.buildSmiteOptionsCalls++;
            return smite ? { smites: [smite.smite], fuels: [smite.fuel] } : null;
        },
        wayBeyond20QuerySmite: async () => (smite && !declineSmite) ? { smite: smite.smite, fuel: smite.fuel } : null,
        wayBeyond20ExposeChannelDivinityControls: async () => ({ controls: [{ unused: true }, { unused: true }] }),
        wayBeyond20LimitedUseControlIsUnused: control => control.unused,
        wayBeyond20QueryElementalStrike: async () => elementalChoice ? context.wayBeyond20ElementalStrikeChoice(elementalChoice) : null,
        wayBeyond20RollLayOnHands: async () => { throw new Error("unexpected Lay on Hands"); },
        wayBeyond20PreflightLimitedUse: async () => ({ allowed: true, tracked: true }),
        wayBeyond20SpendLimitedUse: async feature => { log.limitedUseSpends.push(feature); return true; },
        wayBeyond20PreflightTurnResource: async () => true,
        wayBeyond20SpendTurnResource: resource => { log.turnSpends.push(resource); return true; },
        // Minimal turn tracker so the real Attack-action pool logic runs for real.
        wayBeyond20GetTurnTrackerState: () => log.turnState,
        wayBeyond20SetTurnTrackerState: state => { log.turnState = state; },
        wayBeyond20NormalizeTurnTrackerState: state => Object.assign({ action: 1, attacksRemaining: 0 }, state || {}),
        wayBeyond20HasActiveCombatState: () => true,
        wayBeyond20ScheduleActiveEffectBadgeRefresh() {},
        wayBeyond20ParseInteger: value => {
            const parsed = parseInt(value);
            return isNaN(parsed) ? null : parsed;
        },
        wayBeyond20SpendSpellSlot: async level => { log.slotSpends.push(level); return true; },
        wayBeyond20SpendPaladinSmiteFreeUse: async () => { log.freeSmiteSpends++; return true; },
        wayBeyond20TrackSelfFeatureEffect() {},
        wayBeyond20RemoveTrackedEffect() {},
        wayBeyond20SetIntrusionDie() {},
        wayBeyond20GetTrackedSpellEffects: () => [],
        wayBeyond20EffectName: () => "",
        execute: (paneClass, options) => { log.executed.push({ paneClass, options: clone(options) }); },
        sendRoll: async (char, rollType, fallback, request) => {
            log.sendRollCalls++;
            if (sendResult !== true) return sendResult;
            log.dispatched.push({ rollType, request: clone(request) });
            return true;
        }
    };
    vm.createContext(context);
    vm.runInContext([
        damageFlagsSource,
        between(characterSource, "const WAYBEYOND20_ELEMENTAL_STRIKE_CHOICES", "function wayBeyond20ElementalStrikeChoice("),
        topLevelConst(characterSource, "WAYBEYOND20_ACTION_TYPE_ATTACK"),
        topLevelFunction(baseUtilsSource, "buildAttackRoll"),
        ...CHARACTER_FUNCTIONS.map(name => topLevelFunction(characterSource, name)),
        topLevelFunction(roll20Source, "damagesToRollProperties"),
        "function subDamageRolls(text) { return text; }",
        `function renderDamageRolls(request, is_critical) {
            const damages = request.damages; const damage_types = request["damage-types"];
            const critical_damages = request["critical-damages"] || []; const critical_damage_types = request["critical-damage-types"] || [];
            const all_rolls = []; const damage_rolls = [];
            ${rendererDamageLoop}
            ${rendererCriticalLoop}
            }
            return damage_rolls;
        }`,
        `async function renderTotals(request, attack_rolls, damage_rolls) {
            let html = ""; let play_sound = false;
            ${rendererTotals}
            return total_damages;
        }`
    ].join("\n"), context);
    return context;
}

const run = (context, expression) => vm.runInContext(expression, context);
const lastRequest = context => context.log.dispatched[context.log.dispatched.length - 1].request;

// ---- Fixtures: panes as D&D Beyond presents them to rollItem and rollAction ---------------
const LONGSWORD_PROPERTIES = { "Attack Type": "Melee", "Reach": "5 ft.", "To Hit": "+4", "Damage": "1d8+2 (1d10+2)",
    "Damage Type": "Slashing", "Properties": "Versatile, Sap", "Proficient": "Yes" };

function itemPane(name, properties, damage) {
    return selector => {
        if (selector.includes("[role=list] > div")) return itemPropertyList(properties, damage);
        if (selector.includes("ct-item-name")) return jq([{ firstChild: { textContent: name } }], { text: name });
        return null;
    };
}

function actionPane(name, properties, parent = "") {
    return selector => {
        if (selector.includes("[role=list] > div")) return jq([], { properties });
        if (selector === ".ct-sidebar__heading") return jq([], { text: name });
        if (selector === ".ct-sidebar__header-parent") return jq([], { text: parent });
        return null;
    };
}

async function rollItem(context, { to_hit_only = false, damages_only = false, versatile = false } = {}) {
    return run(context, "rollItem")(false, to_hit_only, damages_only, versatile, null);
}

async function rollAction(context, { to_hit_only = false, damages_only = false } = {}) {
    return run(context, "rollAction")("b20-action-pane", to_hit_only, damages_only);
}

// Stored totals for rendered rows, keyed by row label; renderer totals are the joined strings.
const ROW_TOTALS = {
    "Slashing (1-Hand) Damage": 7, "Slashing (2-Hand) Damage": 8, "Slashing Damage": 7,
    "Radiant (Divine Smite) Damage": 9, "Fire (Efreeti’s Fury) Damage": 5, "Fire (Efreeti’s Fury: second creature) Damage": 3,
    "Slashing (1-Hand) Critical Damage": 70, "Slashing (2-Hand) Critical Damage": 80, "Slashing Critical Damage": 70,
    "Radiant (Divine Smite) Critical Damage": 90
};

function renderRows(context, request, isCritical) {
    const roller = { roll: formula => ({ formula, total: 0, setRollType() {} }) };
    const rows = run(context, "renderDamageRolls").call({ _roller: roller }, request, isCritical);
    rows.forEach(row => {
        assert.ok(ROW_TOTALS[row[0]] !== undefined, `fixture total for ${row[0]}`);
        row[1].total = ROW_TOTALS[row[0]];
    });
    return rows;
}

async function renderTotals(context, request, rows, isCritical) {
    const attackRolls = [{ total: isCritical ? 20 : 15 }];
    return clone(await run(context, "renderTotals").call({ rollToDetails: async () => "" }, request, attackRolls, rows));
}

// ---- Case runner ---------------------------------------------------------------------------
const requireOpen = process.env.WB20_REQUIRE_OPEN === "1";
const results = [];
async function guard(name, fn) {
    try {
        await fn();
        results.push({ kind: "GUARD", name, ok: true });
    } catch (error) {
        results.push({ kind: "GUARD", name, ok: false, error });
    }
}
async function open(name, fn) {
    try {
        await fn();
        results.push({ kind: "OPEN", name, passed: true });
    } catch (error) {
        if (!(error instanceof assert.AssertionError)) {
            results.push({ kind: "OPEN", name, passed: false, harnessError: error });
            return;
        }
        results.push({ kind: "OPEN", name, passed: false, error });
    }
}

(async () => {
    // ===== 1. Melee Action spend =================================================================
    await guard("1a Actions row (Unarmed Strike) spends exactly one Action after dispatch", async () => {
        const ctx = createSandbox({ dom: actionPane("Unarmed Strike", { "Reach": "5 ft.", "To Hit": "+4", "Damage": "3", "Damage Type": "Bludgeoning" }) });
        assert.equal(await rollAction(ctx), true);
        assert.equal(ctx.log.sendRollCalls, 1);
        assert.deepEqual(ctx.log.turnSpends, ["action"]);
    });
    await guard("1b Actions row: failed dispatch spends nothing; a damage-only click attaches no Action", async () => {
        const failed = createSandbox({ sendResult: false, dom: actionPane("Unarmed Strike", { "Reach": "5 ft.", "To Hit": "+4", "Damage": "3", "Damage Type": "Bludgeoning" }) });
        assert.equal(await rollAction(failed), false);
        assert.deepEqual(failed.log.turnSpends, []);
        const damageOnly = createSandbox({ dom: actionPane("Unarmed Strike", { "Reach": "5 ft.", "To Hit": "+4", "Damage": "3", "Damage Type": "Bludgeoning" }) });
        await rollAction(damageOnly, { damages_only: true });
        assert.deepEqual(damageOnly.log.turnSpends, []);
    });
    await guard("1c An Actions-tab die click runs whichever pane D&D Beyond opened: a weapon row with its item pane runs rollItem", async () => {
        for (const [paneClass, heading] of [["b20-item-pane", "Longsword"], ["b20-action-pane", "Unarmed Strike"]]) {
            const labelText = heading;
            const row = { __element: null };
            const label = jq([], { text: labelText });
            row.__element = jq([row], { find: { ".ct-combat-attack__name .ct-combat-attack__label, .ddbc-combat-attack__name .ddbc-combat-attack__label": label } });
            const button = { closest: selector => selector.includes("combat-attack__tohit") ? {} : (selector.includes("__damage") ? null : row) };
            const pane = jq([{}], { find: { ".ct-sidebar__heading": jq([], { text: heading }) } });
            const detail = { "b20-item-pane": ".ct-item-detail", "b20-action-pane": ".ct-available-actions" }[paneClass];
            const ctx = createSandbox({ dom: selector => selector === `.${paneClass}` ? pane : (selector === detail ? jq([{}]) : null) });
            assert.equal(run(ctx, "handleCombatAttackIntegratedDie")(button), true);
            await new Promise(resolve => setTimeout(resolve, 20));
            assert.deepEqual(ctx.log.executed, [{ paneClass, options: { force_to_hit_only: true, force_damages_only: false, force_versatile: false } }]);
        }
    });
    await guard("1d Item-pane weapon attack spends one Action after dispatch, as the Actions row does (F-L14)", async () => {
        const ctx = createSandbox({ settings: { "versatile-choice": "one" }, dom: itemPane("Longsword", LONGSWORD_PROPERTIES, { damage: "1d8+2", versatile: "1d10+2" }) });
        assert.equal(await rollItem(ctx), true);
        assert.deepEqual(ctx.log.turnSpends, ["action"], "item-pane weapon attack spends the Action");
        const failed = createSandbox({ sendResult: false, settings: { "versatile-choice": "one" }, dom: itemPane("Longsword", LONGSWORD_PROPERTIES, { damage: "1d8+2", versatile: "1d10+2" }) });
        await rollItem(failed);
        assert.deepEqual(failed.log.turnSpends, [], "failed dispatch spends nothing");
    });

    // ===== 2. Smite trigger ======================================================================
    const SMITE = { smite: DIVINE_SMITE, fuel: PALADIN_SMITE_FUEL };
    await guard("2a Genuine melee attacks still offer Smite: Longsword item, Unarmed Strike row, natural Claws row", async () => {
        const item = createSandbox({ smite: SMITE, settings: { "versatile-choice": "one" }, dom: itemPane("Longsword", LONGSWORD_PROPERTIES, { damage: "1d8+2", versatile: "1d10+2" }) });
        await rollItem(item);
        assert.equal(item.log.buildSmiteOptionsCalls, 1, "Longsword");
        assert.ok(lastRequest(item)["damage-types"].includes("Radiant (Divine Smite)"));
        for (const [name, props] of [
            ["Unarmed Strike", { "Reach": "5 ft.", "To Hit": "+4", "Damage": "3", "Damage Type": "Bludgeoning" }],
            ["Claws", { "Reach": "5 ft.", "To Hit": "+4", "Damage": "1d6+2", "Damage Type": "Slashing" }]]) {
            const ctx = createSandbox({ smite: SMITE, dom: actionPane(name, props) });
            await rollAction(ctx);
            assert.equal(ctx.log.buildSmiteOptionsCalls, 1, name);
        }
    });
    await guard("2b A Ranged weapon and a Bonus Action attack row do not offer Smite", async () => {
        const crossbow = createSandbox({ smite: SMITE, dom: itemPane("Light Crossbow",
            { "Attack Type": "Ranged", "Range": "80/320 ft.", "To Hit": "+3", "Damage": "1d8+1", "Damage Type": "Piercing", "Properties": "Ammunition" }, { damage: "1d8+1" }) });
        await rollItem(crossbow);
        assert.equal(crossbow.log.buildSmiteOptionsCalls, 0, "ranged weapon");
        const bonus = createSandbox({ smite: SMITE, dom: actionPane("Unarmed Strike", { "Action Type": "Bonus Action", "Reach": "5 ft.", "To Hit": "+4", "Damage": "3", "Damage Type": "Bludgeoning" }) });
        await rollAction(bonus);
        assert.equal(bonus.log.buildSmiteOptionsCalls, 0, "Bonus Action row");
    });
    await guard("2c Cause: buildAttackRoll reads Breath Weapon's `Range/Area: --ft. Reach` as a Melee attack with no attack roll", async () => {
        const ctx = createSandbox();
        const request = await run(ctx, "buildAttackRoll")(ctx.character, "action", "Breath Weapon (Fire)", "",
            { "Range/Area": "--ft. Reach", "Attack/Save": "DEX 12", "Damage": "1d10", "Damage Type": "Fire" },
            ["1d10"], ["Fire"], null, 0, false, false, { weapon_damage_length: 1 }, {});
        assert.equal(request["attack-type"], "Melee");
        assert.equal(request["to-hit"], undefined);
        assert.equal(request["save-dc"], "12");
    });
    await guard("2d Breath Weapon (saving throw, no attack roll) does not probe for or offer Smite (F-L2)", async () => {
        const ctx = createSandbox({ smite: SMITE, dom: actionPane("Breath Weapon (Fire)",
            { "Range/Area": "--ft. Reach", "Attack/Save": "DEX 12", "Damage": "1d10", "Damage Type": "Fire" }) });
        assert.equal(await rollAction(ctx), true);
        assert.equal(ctx.log.buildSmiteOptionsCalls, 0, "no Smite probe or prompt");
        assert.ok(!lastRequest(ctx)["damage-types"].some(type => type.includes("Divine Smite")), "no Smite damage");
        assert.deepEqual(ctx.log.turnSpends, ["action"], "no Smite Bonus Action");
    });

    // ===== 3. Long Rest and tracked effects ======================================================
    function createRestSandbox({ effects = [], concentration = null } = {}) {
        const store = { "waybeyond20-active-effects": clone(effects), "waybeyond20-concentration": clone(concentration) };
        const log = { endCombat: [], hitDiceResets: 0, wizardRests: [], timers: [], merges: [] };
        let listener = null;
        const character = {
            _id: 111, _name: "Test Paladin",
            updateInfo() {},
            getSetting: (key, fallback) => store[key] !== undefined ? clone(store[key]) : fallback,
            mergeCharacterSettings: (changes, callback) => { log.merges.push(clone(changes)); Object.assign(store, clone(changes)); if (callback) callback(); }
        };
        const context = {
            console, character, log, store, settings: {},
            window: { addEventListener: (type, fn) => { listener = fn; }, removeEventListener() {} },
            setTimeout: fn => { log.timers.push(fn); return log.timers.length; },
            $: node => ({
                closest: () => {
                    const pane = node && node.pane;
                    return pane ? { length: 1, text: () => pane.text } : { length: 0, text: () => "" };
                }
            }),
            wayBeyond20CharacterDebug() {},
            wayBeyond20DescribeElement: () => null,
            wayBeyond20EndCombat: restore => log.endCombat.push(restore),
            wayBeyond20InvalidateSmiteSpellCache() {},
            wayBeyond20ResetHitDice: () => { log.hitDiceResets++; },
            wayBeyond20RestWizardResources: type => log.wizardRests.push(type),
            wayBeyond20ShowMusicianRestReminder() {},
            wayBeyond20SendEffectsUpdate() {},
            wayBeyond20NotifyEffectEnded() {},
            wayBeyond20CloseEffectsPopout() {}
        };
        vm.createContext(context);
        vm.runInContext([
            "let wayBeyond20LongRestResetPending = false;",
            topLevelConst(characterSource, "WAYBEYOND20_REST_MINUTES"),
            topLevelConst(characterSource, "WAYBEYOND20_DURATION_MINUTES_PER_UNIT"),
            ...["wayBeyond20InstallLongRestTracker", "wayBeyond20GetTrackedSpellEffects", "wayBeyond20GetConcentrationEffect",
                "wayBeyond20EffectKey", "wayBeyond20RemoveTrackedEffect",
                "wayBeyond20NormalizeTalentText", "wayBeyond20TalentTextLower", "wayBeyond20WordToNumber",
                "wayBeyond20ParseTalentDuration", "wayBeyond20EffectDurationMinutes",
                "wayBeyond20EffectEndedByRest", "wayBeyond20ExpireEffectsForRest"].map(name => topLevelFunction(characterSource, name)),
            "wayBeyond20InstallLongRestTracker();"
        ].join("\n"), context);
        const click = control => {
            listener({ target: { closest: () => control } });
            const pending = log.timers.splice(0);
            pending.forEach(fn => fn());
            return pending.length;
        };
        return { context, log, store, click };
    }
    const REST_PANE = { text: "Long Rest Take a long rest to restore hit points and resources. Take Long Rest" };
    const SHORT_REST_PANE = { text: "Short Rest Take a short rest to spend Hit Dice. Take Short Rest" };
    const button = (text, className) => ({
        textContent: text, className,
        pane: /short rest/i.test(text) ? SHORT_REST_PANE : REST_PANE,
        getAttribute: name => name === "class" ? className : null
    });
    const SHIELD_OF_FAITH = { id: "e-sof", name: "Shield of Faith", owner: "Test Paladin", source: "Shield of Faith",
        duration: "Concentration, up to 10 minutes", concentration: true, flags: ["buff", "concentration"], data: [{ field: "AC", value: "2" }] };

    await guard("3a A Long Rest completion runs its resets once: End Combat with restore, Paladin's Smite flag, Hit Dice, Wizard resources", async () => {
        const rest = createRestSandbox();
        assert.equal(rest.click(button("Take Long RestConfirm (2)", "ct-button ct-button--confirm ct-button--is-confirming")), 1);
        assert.deepEqual(rest.log.endCombat, [true]);
        assert.equal(rest.store["waybeyond20-paladin-smite-used"], false);
        assert.equal(rest.log.hitDiceResets, 1);
        assert.deepEqual(rest.log.wizardRests, ["long"]);
    });
    await guard("3b A completed Long Rest ends a tracked Concentration effect (Shield of Faith, up to 10 minutes)", async () => {
        const rest = createRestSandbox({ effects: [SHIELD_OF_FAITH], concentration: SHIELD_OF_FAITH });
        rest.click(button("Take Long RestConfirm (2)", "ct-button ct-button--confirm ct-button--is-confirming"));
        assert.equal(rest.store["waybeyond20-concentration"], null, "Concentration cleared");
        assert.ok(!rest.store["waybeyond20-active-effects"].some(effect => effect.name === "Shield of Faith"), "Shield of Faith no longer tracked");
    });
    await guard("3c The arming click (Take Long Rest -> Confirm countdown) is not treated as a completed rest (F-L6)", async () => {
        const rest = createRestSandbox();
        const scheduled = rest.click(button("Take Long Rest", "ct-button"));
        assert.equal(scheduled, 0, "no reset scheduled before confirmation");
        assert.equal(rest.log.hitDiceResets, 0);
    });
    await guard("3c-2 The armed press is told apart from the confirming press by class, not by label", async () => {
        // Measured live 2026-10-04 in a capture listener: the arming press carries
        // `ct-button--confirm` and ALREADY reads "Take Long RestConfirm (2)", because the button
        // arms on pointerdown; only the confirming press adds `ct-button--is-confirming`.
        const arming = createRestSandbox();
        assert.equal(arming.click(button("Take Long RestConfirm (2)", "ct-button ct-button--confirm")), 0,
            "the arming press must not rest, even though its label already says Confirm");
        assert.equal(arming.log.hitDiceResets, 0);

        const confirming = createRestSandbox();
        assert.equal(confirming.click(button("Take Long RestConfirm (2)", "ct-button ct-button--confirm ct-button--is-confirming")), 1);
        assert.equal(confirming.log.hitDiceResets, 1);
    });

    // ===== 3d-3g. Effects end on the clock =======================================================
    const BLESS_ONE_MINUTE = { id: "e-bless", name: "Bless", owner: "Test Paladin", source: "Bless",
        duration: "Concentration, up to 1 minute", concentration: true, flags: ["buff", "concentration"] };
    const MAGE_ARMOR_EIGHT_HOURS = { id: "e-ma", name: "Mage Armor", owner: "Test Paladin", source: "Mage Armor",
        duration: "8 hours", flags: ["buff"] };
    const HEROES_FEAST_24_HOURS = { id: "e-hf", name: "Heroes' Feast", owner: "Test Paladin", source: "Heroes' Feast",
        duration: "24 hours", flags: ["buff"] };
    const UNTIL_DISPELLED = { id: "e-ud", name: "Arcane Lock", owner: "Test Paladin", source: "Arcane Lock",
        duration: "Until dispelled", flags: ["buff"] };

    await guard("3d A Long Rest is at least 8 hours, so shorter effects have run out; longer ones have not", async () => {
        const rest = createRestSandbox({ effects: [BLESS_ONE_MINUTE, MAGE_ARMOR_EIGHT_HOURS, HEROES_FEAST_24_HOURS, UNTIL_DISPELLED] });
        rest.click(button("Take Long RestConfirm (2)", "ct-button ct-button--confirm ct-button--is-confirming"));
        const names = rest.store["waybeyond20-active-effects"].map(effect => effect.name).sort();
        assert.deepEqual(names, ["Arcane Lock", "Heroes' Feast"],
            "a 1-minute and an 8-hour effect end over an 8-hour rest; 24 hours and an unreadable duration do not");
    });
    await guard("3e A Short Rest is an hour: it ends shorter effects and leaves longer ones", async () => {
        const rest = createRestSandbox({ effects: [BLESS_ONE_MINUTE, MAGE_ARMOR_EIGHT_HOURS] });
        rest.click(button("Take Short RestConfirm (2)", "ct-button ct-button--confirm ct-button--is-confirming"));
        const names = rest.store["waybeyond20-active-effects"].map(effect => effect.name);
        assert.deepEqual(names, ["Mage Armor"], "the 1-minute effect is gone, the 8-hour effect remains");
    });
    await guard("3f A Short Rest does not make you Unconscious, so it does not break Concentration by itself", async () => {
        const longLived = Object.assign({}, SHIELD_OF_FAITH, { duration: "Concentration, up to 8 hours" });
        const rest = createRestSandbox({ effects: [longLived], concentration: longLived });
        rest.click(button("Take Short RestConfirm (2)", "ct-button ct-button--confirm ct-button--is-confirming"));
        assert.ok(rest.store["waybeyond20-concentration"], "Concentration survives a Short Rest");
    });
    await guard("3g A Long Rest ends Concentration even when the effect would outlast the rest", async () => {
        const longLived = Object.assign({}, SHIELD_OF_FAITH, { duration: "Concentration, up to 24 hours" });
        const rest = createRestSandbox({ effects: [longLived], concentration: longLived });
        rest.click(button("Take Long RestConfirm (2)", "ct-button ct-button--confirm ct-button--is-confirming"));
        assert.equal(rest.store["waybeyond20-concentration"], null,
            "sleeping gives you Unconscious, which gives you Incapacitated, which ends Concentration");
    });

    // ===== 2e. Declining a smite never calls off the attack ======================================
    await guard("2e Declining the smite still sends the attack, with no smite damage and no smite resources", async () => {
        // A smite is cast immediately after hitting, so by the time the chooser appears the attack
        // has happened. Saying no leaves the attack alone; it must not call it off.
        const ctx = createSandbox({ smite: SMITE, declineSmite: true, dom: itemPane("Longsword",
            { "Attack Type": "Melee", "To Hit": "+5", "Damage": "1d8+3", "Damage Type": "Slashing" }, { damage: "1d8+3" }) });
        assert.equal(await rollItem(ctx), true, "the attack is still dispatched");
        const request = lastRequest(ctx);
        assert.ok(!request["damage-types"].some(type => String(type).includes("Smite")), "no smite damage was added");
        assert.deepEqual(ctx.log.slotSpends, [], "no spell slot spent");
        assert.equal(ctx.log.freeSmiteSpends, 0, "Paladin's Smite not spent");
        assert.deepEqual(ctx.log.turnSpends, ["action"], "the attack still costs its Attack action");
    });

    // ===== 5. Action types: the Attack action and its attacks ====================================
    await guard("5a A feature that replaces one of your attacks is an Attack action; a Magic action one is not", async () => {
        const ctx = createSandbox();
        const fromText = run(ctx, "wayBeyond20ActionTypeFromText");
        assert.equal(fromText("When you take the Attack action on your turn, you can replace one of your attacks with an exhalation of magical energy"), "Attack");
        assert.equal(fromText("When you use a Magic action to expel your Breath Weapon, each creature in the area"), "Magic");
        assert.equal(fromText("A shimmering field surrounds a creature of your choice"), null);
    });
    await guard("5b Extra Attack: a second attack in the same turn comes out of the Attack action, not a second Action", async () => {
        const ctx = createSandbox({ features: ["Extra Attack"], dom: itemPane("Longsword",
            { "Attack Type": "Melee", "To Hit": "+5", "Damage": "1d8+3", "Damage Type": "Slashing", "Properties": "Versatile" }, { damage: "1d8+3" }) });
        await rollItem(ctx);
        await rollItem(ctx);
        assert.deepEqual(ctx.log.turnSpends, ["action"], "one Action buys both attacks");
        assert.equal(ctx.log.turnState.attacksRemaining, 0, "both attacks of the Attack action are used");
    });
    await guard("5c Without Extra Attack each attack takes its own Attack action", async () => {
        const ctx = createSandbox({ dom: itemPane("Longsword",
            { "Attack Type": "Melee", "To Hit": "+5", "Damage": "1d8+3", "Damage Type": "Slashing" }, { damage: "1d8+3" }) });
        await rollItem(ctx);
        await rollItem(ctx);
        assert.deepEqual(ctx.log.turnSpends, ["action", "action"]);
    });
    await guard("5d Breath Weapon replaces one of the attacks rather than costing its own Action", async () => {
        const ctx = createSandbox({ features: ["Extra Attack"], dom: actionPane("Breath Weapon (Fire)",
            { "Range/Area": "--ft. Reach", "Attack/Save": "DEX 12", "Damage": "2d10", "Damage Type": "Fire" },
            { description: "When you take the Attack action on your turn, you can replace one of your attacks with an exhalation of magical energy." }) });
        await rollAction(ctx);
        assert.deepEqual(ctx.log.turnSpends, ["action"], "it starts the Attack action");
        assert.equal(ctx.log.turnState.attacksRemaining, 1, "the other attack of that Attack action is still available");
    });

    // ===== 4. Efreeti's Fury with Versatile attacks ================================================
    const EFREETI = ["Elemental Strike"];
    async function efreetiAttack({ versatileChoice, forceVersatile = false, sendResult = true } = {}) {
        const ctx = createSandbox({ features: EFREETI, smite: SMITE, elementalChoice: "efreeti", sendResult,
            settings: { "versatile-choice": versatileChoice }, dom: itemPane("Longsword", LONGSWORD_PROPERTIES, { damage: "1d8+2", versatile: "1d10+2" }) });
        const result = await rollItem(ctx, { versatile: forceVersatile });
        return { ctx, result };
    }
    const EFREETI_ROWS = ["Radiant (Divine Smite)", "Fire (Efreeti’s Fury)", "Fire (Efreeti’s Fury: second creature)"];

    await guard("4a Each Versatile variant carries exactly one primary 2d4 and one second-creature 2d4", async () => {
        for (const [choice, forceVersatile, weaponRows, isVersatile] of [
            ["both", false, ["Slashing (1-Hand)", "Slashing (2-Hand)"], true],
            ["one", false, ["Slashing"], false],
            ["two", false, ["Slashing"], false],
            ["both", true, ["Slashing"], false]]) {
            const { ctx, result } = await efreetiAttack({ versatileChoice: choice, forceVersatile });
            const label = `${choice}${forceVersatile ? " (two-handed die)" : ""}`;
            assert.equal(result, true, label);
            const request = lastRequest(ctx);
            assert.deepEqual(request["damage-types"], [...weaponRows, ...EFREETI_ROWS], label);
            assert.equal(request.damages.filter(damage => damage === "2d4").length, 2, `${label}: two 2d4 rows in total`);
            assert.equal(!!request.is_versatile, isVersatile, `${label}: is_versatile`);
            assert.ok(!request["critical-damage-types"].some(type => type.includes("Efreeti")), `${label}: no Efreeti crit dice`);
            assert.deepEqual(ctx.log.limitedUseSpends, ["Channel Divinity"], `${label}: one Channel Divinity`);
            assert.equal(ctx.log.sendRollCalls, 1, `${label}: one card`);
        }
        const { ctx: two } = await efreetiAttack({ versatileChoice: "two" });
        assert.equal(lastRequest(two).damages[0], "1d10+2", "two-handed damage die");
        const { ctx: one } = await efreetiAttack({ versatileChoice: "one" });
        assert.equal(lastRequest(one).damages[0], "1d8+2", "one-handed damage die");
    });
    await guard("4b Renderer flags for the both-variant card: the second creature's row is Conditional", async () => {
        const { ctx } = await efreetiAttack({ versatileChoice: "both" });
        const flags = run(ctx, "DAMAGE_FLAGS");
        const rows = renderRows(ctx, lastRequest(ctx), false);
        assert.deepEqual(clone(rows.map(row => [row[0], row[2]])), [
            ["Slashing (1-Hand) Damage", flags.REGULAR],
            ["Slashing (2-Hand) Damage", flags.VERSATILE],
            ["Radiant (Divine Smite) Damage", flags.ADDITIONAL],
            ["Fire (Efreeti’s Fury) Damage", flags.ADDITIONAL],
            ["Fire (Efreeti’s Fury: second creature) Damage", flags.CONDITIONAL]
        ]);
    });
    await guard("4c Non-critical totals: each hand total has the primary 2d4 once; the second creature's 2d4 is only its own total", async () => {
        const { ctx } = await efreetiAttack({ versatileChoice: "both" });
        const request = lastRequest(ctx);
        const totals = await renderTotals(ctx, request, renderRows(ctx, request, false), false);
        assert.deepEqual(totals, { "Conditional": "3", "1-Handed Damage": "7 + 9 + 5", "2-Handed Damage": "8 + 9 + 5" });
    });
    await guard("4d Critical one-handed card: the Combined total excludes the second creature's 2d4", async () => {
        const { ctx } = await efreetiAttack({ versatileChoice: "one" });
        const request = lastRequest(ctx);
        const totals = await renderTotals(ctx, request, renderRows(ctx, request, true), true);
        assert.equal(totals["Combined"], "7 + 9 + 5 + 70 + 90");
        assert.equal(totals["Conditional"], "3");
    });
    await guard("4e Roll20 template path lists each 2d4 once and keeps the second creature labeled", async () => {
        const { ctx } = await efreetiAttack({ versatileChoice: "both" });
        const request = lastRequest(ctx);
        ctx.settings = { "crit-prefix": "Crit: " };
        const props = run(ctx, "damagesToRollProperties")(request.damages, request["damage-types"], request["critical-damages"], request["critical-damage-types"]);
        assert.equal(props.dmg1, "1d8+2");
        assert.equal(props.dmg2, "1d10+2 | 2d8 | 2d4 | 2d4");
        assert.equal(props.dmg2type, "Slashing (2-Hand) | Radiant (Divine Smite) | Fire (Efreeti’s Fury) | Fire (Efreeti’s Fury: second creature)");
    });
    await guard("4f Critical both-variant card: Combined 1- and 2-Handed totals exclude the second creature's 2d4", async () => {
        const { ctx } = await efreetiAttack({ versatileChoice: "both" });
        const request = lastRequest(ctx);
        const totals = await renderTotals(ctx, request, renderRows(ctx, request, true), true);
        assert.equal(totals["Combined 1 Handed"], "7 + 9 + 5 + 70 + 90", "one-handed combined total for the primary target");
        assert.equal(totals["Combined 2 Handed"], "8 + 9 + 5 + 80 + 90", "two-handed combined total for the primary target");
    });

    // Actions-tab damage dice for a Versatile weapon, as D&D Beyond lays them out: both dice are
    // sibling buttons inside one damage cell, and the cell follows the row's action cell.
    function versatileDamageDie(which) {
        const row = { __element: null };
        row.__element = jq([row], { find: { ".ct-combat-attack__name .ct-combat-attack__label, .ddbc-combat-attack__name .ddbc-combat-attack__label": jq([], { text: "Longsword" }) } });
        const oneHanded = { previousElementSibling: null };
        const twoHanded = { previousElementSibling: oneHanded };
        // Both dice are sibling .integrated-dice__container buttons inside the one damage cell,
        // and the cell follows the action cell (live DOM, LIVE-G-14).
        const damageCell = {
            previousElementSibling: { className: "ddbc-combat-attack__action" },
            querySelectorAll: selector => selector.includes("integrated-dice__container") ? [oneHanded, twoHanded] : []
        };
        for (const node of [oneHanded, twoHanded]) {
            node.closest = selector => selector.includes("combat-attack__tohit") ? null
                : selector.includes("__damage") ? damageCell
                : selector.includes("integrated-dice__container") ? node
                : row;
        }
        const die = which === "two" ? twoHanded : oneHanded;
        const pane = jq([{}], { find: { ".ct-sidebar__heading": jq([], { text: "Longsword" }) } });
        const ctx = createSandbox({ dom: selector => selector === ".b20-item-pane" ? pane : (selector === ".ct-item-detail" ? jq([{}]) : null) });
        return { ctx, die };
    }
    await guard("4g The two-handed damage die on the Actions tab forces the two-handed damage", async () => {
        const { ctx, die } = versatileDamageDie("two");
        run(ctx, "handleCombatAttackIntegratedDie")(die);
        await new Promise(resolve => setTimeout(resolve, 20));
        assert.deepEqual(ctx.log.executed, [{ paneClass: "b20-item-pane", options: { force_to_hit_only: false, force_damages_only: true, force_versatile: true } }]);
    });
    await guard("4h The one-handed damage die on the Actions tab does not force two-handed damage (live: clicking 1d8+2 rolled 1d10 + 2)", async () => {
        const { ctx, die } = versatileDamageDie("one");
        run(ctx, "handleCombatAttackIntegratedDie")(die);
        await new Promise(resolve => setTimeout(resolve, 20));
        assert.equal(ctx.log.executed.length, 1);
        assert.equal(ctx.log.executed[0].options.force_versatile, false, "one-handed die");
    });

    // ---- Report ----------------------------------------------------------------------------
    let failed = false;
    for (const result of results) {
        if (result.kind === "GUARD") {
            console.log(`${result.ok ? "PASS" : "FAIL"} GUARD ${result.name}`);
            if (!result.ok) { failed = true; console.log(`     ${result.error && result.error.stack}`); }
        } else if (result.harnessError) {
            failed = true;
            console.log(`FAIL OPEN  ${result.name} — harness error, not a behavior result`);
            console.log(`     ${result.harnessError.stack}`);
        } else if (result.passed) {
            console.log(`${requireOpen ? "PASS" : "FAIL"} OPEN  ${result.name} — now passes${requireOpen ? "" : "; promote it to a GUARD"}`);
            if (!requireOpen) failed = true;
        } else {
            console.log(`${requireOpen ? "FAIL" : "OPEN"} OPEN  ${result.name}`);
            const { inspect } = require("node:util");
            console.log(`     fails at: ${result.error.message.split("\n")[0]}; actual ${inspect(result.error.actual)}, expected ${inspect(result.error.expected)}`);
            if (requireOpen) failed = true;
        }
    }
    if (failed) {
        console.log("WB20-0065 group-report regressions: FAILED");
        process.exitCode = 1;
    } else {
        const openCount = results.filter(r => r.kind === "OPEN").length;
        console.log(requireOpen
            ? `WB20-0065 group-report regressions: guards and all ${openCount} open cases pass`
            : `WB20-0065 group-report regressions: guards pass; ${openCount} open cases still open as recorded`);
    }
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
