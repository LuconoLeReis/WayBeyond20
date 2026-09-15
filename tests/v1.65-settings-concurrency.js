// WB20-0065 brief 1.11, P1 (F-L11): concurrent updates to different keys of one character-settings record
// must all survive, in storage and on the live sheet.
// Live evidence: a Hidden attack cleared Stealth but lost its Action spend; an in-combat concentration cast
// spent the Action but lost its effect and Concentration. Both wrote two keys back to back.
// This suite runs the real settings storage merge (common/settings.js), the real Character
// mergeCharacterSettings/updateSettings (dndbeyond/base/character.js) and the real turn-resource and effect
// writers (content character.js) against an asynchronous storage model whose reads return the value at the
// time of the read, and a background model that can deliver settings broadcasts late and out of order.
// WB20_SOURCE_ROOT may point at a copy of the sources to record pre-correction behavior.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const sourceRoot = process.env.WB20_SOURCE_ROOT || path.resolve(__dirname, "..");
const read = relative => fs.readFileSync(path.join(sourceRoot, ...relative.split("/")), "utf8");
const settingsSource = read("src/common/settings.js");
const baseCharacterSource = read("src/dndbeyond/base/character.js");
const characterSource = read("src/dndbeyond/content-scripts/character.js");

function topLevelFunction(source, name, { optional = false } = {}) {
    const match = new RegExp(`^(?:async )?function ${name}\\(`, "m").exec(source);
    if (!match) {
        if (optional) return "";
        assert.fail(`Missing function ${name}`);
    }
    const rest = source.slice(match.index + match[0].length);
    const next = /^(?:async )?function |^(?:const|let|var|class) |^\/\//m.exec(rest);
    return source.slice(match.index, next ? match.index + match[0].length + next.index : source.length);
}

function topLevelDeclaration(source, pattern) {
    const match = new RegExp(`^${pattern}.*$`, "m").exec(source);
    return match ? match[0] : "";
}

// A class method body, from its signature line to the matching closing brace.
function classMethod(source, name) {
    const match = new RegExp(`^    ${name}\\(.*\\{\\s*$`, "m").exec(source);
    assert.ok(match, `Missing method ${name}`);
    let depth = 0;
    for (let index = match.index; index < source.length; index++) {
        if (source[index] === "{") depth++;
        else if (source[index] === "}") {
            depth--;
            if (depth === 0) return source.slice(match.index, index + 1);
        }
    }
    assert.fail(`Unbalanced method ${name}`);
}

const SETTINGS_FUNCTIONS = ["getStorage", "storageGet", "storageSet", "getDefaultSettings", "getStoredSettings",
    "setSettings", "wayBeyond20SettingsValueEqual", "mergeSettings"];
const CONTENT_FUNCTIONS = ["wayBeyond20GetTrackedSpellEffects", "wayBeyond20GetConcentrationEffect", "wayBeyond20ParseInteger",
    "wayBeyond20GetTurnTrackerState", "wayBeyond20TurnTrackerStateEquals", "wayBeyond20SetTurnTrackerState",
    "wayBeyond20NormalizeTurnTrackerState", "wayBeyond20HasActiveCombatState", "wayBeyond20SpendTurnResource",
    "wayBeyond20EffectKey", "wayBeyond20RemoveTrackedEffect", "wayBeyond20AddSpellEffectToSettings"];
const OPTIONAL_CONTENT_FUNCTIONS = ["wayBeyond20CreateSpellEffectPlan", "wayBeyond20CommitRollSettings", "wayBeyond20CommitSpellRollSettings"];

const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));

function createSandbox({ readDelay = 4, writeDelay = 4, failFirstWrite = false } = {}) {
    const store = {
        "character-7": {
            "migrated-sync-settings": true,
            "waybeyond20-turn-state": { inCombat: true, combatSource: "D&D Beyond Initiative", combatStartedAt: 1, action: 1, bonusAction: 1, reaction: 1, movement: 30 },
            "waybeyond20-active-effects": [{ id: "stealth-1", name: "Stealth", conditions: ["Invisible"] }],
            "waybeyond20-concentration": null,
            "rogue-sneak-attack": true
        }
    };
    const broadcasts = [];
    let writes = 0;
    const runtime = { lastError: undefined, id: "test", sendMessage: message => broadcasts.push(clone(message)) };
    const chrome = {
        runtime,
        storage: {
            local: {
                get(defaults, callback) {
                    const key = Object.keys(defaults)[0];
                    const snapshot = clone(store[key] !== undefined ? store[key] : defaults[key]);
                    setTimeout(() => callback({ [key]: snapshot }), readDelay);
                },
                set(items, callback) {
                    const fail = failFirstWrite && writes === 0;
                    writes++;
                    setTimeout(() => {
                        if (fail) {
                            runtime.lastError = { message: "QUOTA_BYTES quota exceeded" };
                            callback();
                            runtime.lastError = undefined;
                            return;
                        }
                        for (const key in items) store[key] = clone(items[key]);
                        callback();
                    }, writeDelay);
                }
            },
            sync: { get: (defaults, callback) => callback({}) }
        }
    };
    const context = {
        console: { log() {}, warn() {}, error() {} }, Promise, setTimeout, Date, Math, JSON, Object, Array, String,
        chrome, store, broadcasts, key_modifiers: {}, options_list: {}, character_settings: {},
        wayBeyond20BuildTurnResourceDefaults: () => ({ action: 1, bonusAction: 1, reaction: 1, hasteAction: 0, movement: 30,
            maxAction: 1, maxBonusAction: 1, maxReaction: 1, maxHasteAction: 0, maxMovement: 30 }),
        wayBeyond20ScheduleActiveEffectBadgeRefresh() {},
        wayBeyond20CharacterDebug() {},
        wayBeyond20CloseEffectsPopout() {},
        wayBeyond20SendEffectsUpdate() {},
        wayBeyond20NotifyEffectEnded() {},
        wayBeyond20SendEffectToTarget() {}
    };
    vm.createContext(context);
    vm.runInContext([
        topLevelDeclaration(settingsSource, "const wayBeyond20SettingsMergeQueues"),
        topLevelDeclaration(settingsSource, "let wayBeyond20SettingsOriginToken"),
        ...SETTINGS_FUNCTIONS.map(name => topLevelFunction(settingsSource, name)),
        topLevelFunction(settingsSource, "wayBeyond20SettingsOrigin", { optional: true }),
        ...CONTENT_FUNCTIONS.map(name => topLevelFunction(characterSource, name)),
        ...OPTIONAL_CONTENT_FUNCTIONS.map(name => topLevelFunction(characterSource, name, { optional: true })),
        `class TestCharacter {
            constructor() { this._id = 7; this._settings = null; }
            getSetting(key, default_value = "") { return this._settings && this._settings[key] !== undefined ? this._settings[key] : default_value; }
            updateHP() {} updateFeatures() {} updateConditions() {}
            ${classMethod(baseCharacterSource, "mergeCharacterSettings")}
            ${classMethod(baseCharacterSource, "updateSettings")}
        }`,
        "var character = new TestCharacter();"
    ].join("\n"), context);
    return context;
}

const run = (context, expression) => vm.runInContext(expression, context);
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function loadSheet(ctx) {
    run(ctx, "character.updateSettings()");
    await wait(100);
    assert.ok(ctx.character._settings, "sheet loaded its settings");
}
// Mirrors content handleMessage: character broadcasts go to character.updateSettings with their origin.
function deliver(ctx, message) {
    run(ctx, "character").updateSettings(message.settings, message.origin);
}
function deliverAll(ctx, order = "reverse") {
    const messages = ctx.broadcasts.splice(0).filter(message => message.action === "settings" && message.type === "character");
    if (order === "reverse") messages.reverse();
    messages.forEach(message => deliver(ctx, message));
    return messages.length;
}
const sheet = ctx => ctx.character._settings;
const stored = ctx => ctx.store["character-7"];

const sections = [];
const section = (name, body) => sections.push({ name, body });

section("1. Storage: two overlapping merges to different keys keep both", async () => {
    const ctx = createSandbox();
    run(ctx, "mergeSettings")({ "waybeyond20-turn-state": { action: 0 } }, null, "character-7", {});
    run(ctx, "mergeSettings")({ "waybeyond20-active-effects": [] }, null, "character-7", {});
    await wait(250);
    assert.equal(stored(ctx)["waybeyond20-turn-state"].action, 0, "first key saved");
    assert.deepEqual(stored(ctx)["waybeyond20-active-effects"], [], "second key saved");
});

section("2. Sheet: back-to-back writes survive in storage and in memory, with broadcasts reordered", async () => {
    const ctx = createSandbox();
    await loadSheet(ctx);
    const character = run(ctx, "character");
    character.mergeCharacterSettings({ "waybeyond20-turn-state": Object.assign({}, sheet(ctx)["waybeyond20-turn-state"], { action: 0 }) });
    character.mergeCharacterSettings({ "waybeyond20-active-effects": [] });
    await wait(250);
    assert.equal(deliverAll(ctx, "reverse"), 2, "both writes broadcast");
    for (const [label, record] of [["storage", stored(ctx)], ["sheet", sheet(ctx)]]) {
        assert.equal(record["waybeyond20-turn-state"].action, 0, `${label}: Action spend kept`);
        assert.equal(record["waybeyond20-active-effects"].length, 0, `${label}: effect removal kept`);
    }
});

section("3. A stale full snapshot from elsewhere cannot roll back a key the sheet is still saving", async () => {
    const ctx = createSandbox({ writeDelay: 15 });
    await loadSheet(ctx);
    const character = run(ctx, "character");
    const staleSnapshot = Object.assign(clone(stored(ctx)), { "rogue-sneak-attack": false });
    character.mergeCharacterSettings({ "waybeyond20-turn-state": Object.assign({}, sheet(ctx)["waybeyond20-turn-state"], { action: 0 }) });
    // The popup saved a toggle from a record read before the sheet's write landed.
    deliver(ctx, { action: "settings", type: "character", id: 7, settings: staleSnapshot });
    assert.equal(sheet(ctx)["waybeyond20-turn-state"].action, 0, "in-flight Action spend kept in memory");
    assert.equal(sheet(ctx)["rogue-sneak-attack"], false, "the other page's change applied");
    await wait(300);
    deliverAll(ctx, "reverse");
    assert.equal(stored(ctx)["waybeyond20-turn-state"].action, 0);
    assert.equal(sheet(ctx)["waybeyond20-turn-state"].action, 0, "still kept after the write completed");
});

section("4. A newer snapshot from another page still applies after the sheet's writes complete", async () => {
    const ctx = createSandbox();
    await loadSheet(ctx);
    const character = run(ctx, "character");
    character.mergeCharacterSettings({ "waybeyond20-active-effects": [] });
    await wait(200);
    deliverAll(ctx);
    const popupRecord = Object.assign(clone(stored(ctx)), { "rogue-sneak-attack": false });
    deliver(ctx, { action: "settings", type: "character", id: 7, settings: popupRecord });
    assert.equal(sheet(ctx)["rogue-sneak-attack"], false, "popup toggle applied");
    assert.equal(sheet(ctx)["waybeyond20-active-effects"].length, 0, "sheet change kept");
});

section("5. Regression: Hidden attack spends the Action and consumes Stealth (real writers)", async () => {
    const ctx = createSandbox();
    await loadSheet(ctx);
    // Order used by sendRollWithCharacter after dispatch: turn resources, then the Stealth effect.
    assert.equal(run(ctx, "wayBeyond20SpendTurnResource")("action", { forRoll: true }), true);
    run(ctx, "wayBeyond20RemoveTrackedEffect")("stealth-1");
    await wait(250);
    deliverAll(ctx, "reverse");
    for (const [label, record] of [["storage", stored(ctx)], ["sheet", sheet(ctx)]]) {
        assert.equal(record["waybeyond20-turn-state"].action, 0, `${label}: Action spent`);
        assert.equal(record["waybeyond20-active-effects"].length, 0, `${label}: Stealth consumed`);
    }
});

section("6. Regression: in-combat concentration cast keeps both the Action spend and Concentration", async () => {
    const ctx = createSandbox();
    await loadSheet(ctx);
    const concentration = { id: "detect-1", name: "Detect Magic", concentration: true };
    if (typeof ctx.wayBeyond20CommitSpellRollSettings === "function") {
        // Current order: dispatch, turn resources, then the queued spell commit.
        run(ctx, "wayBeyond20SpendTurnResource")("action", { forRoll: true });
        const plan = run(ctx, "wayBeyond20CreateSpellEffectPlan")(run(ctx, "character"));
        plan.local.push(concentration);
        run(ctx, "wayBeyond20CommitSpellRollSettings")({}, plan);
    } else {
        // Pre-correction order: the effect was saved while building the roll, the Action right after dispatch.
        const settingsToChange = {};
        run(ctx, "wayBeyond20AddSpellEffectToSettings")(run(ctx, "character"), settingsToChange, concentration);
        run(ctx, "character").mergeCharacterSettings(settingsToChange);
        run(ctx, "wayBeyond20SpendTurnResource")("action", { forRoll: true });
    }
    await wait(250);
    deliverAll(ctx, "reverse");
    for (const [label, record] of [["storage", stored(ctx)], ["sheet", sheet(ctx)]]) {
        assert.equal(record["waybeyond20-turn-state"].action, 0, `${label}: Action spent`);
        assert.equal(record["waybeyond20-concentration"] && record["waybeyond20-concentration"].name, "Detect Magic", `${label}: Concentration tracked`);
        assert.ok(record["waybeyond20-active-effects"].some(effect => effect.name === "Detect Magic"), `${label}: effect tracked`);
        assert.ok(record["waybeyond20-active-effects"].some(effect => effect.name === "Stealth"), `${label}: unrelated effect kept`);
    }
});

section("7. A failed storage write does not stall later merges", async () => {
    const ctx = createSandbox({ failFirstWrite: true });
    run(ctx, "mergeSettings")({ "rogue-sneak-attack": false }, null, "character-7", {});
    let secondDone = false;
    run(ctx, "mergeSettings")({ "waybeyond20-active-effects": [] }, () => { secondDone = true; }, "character-7", {});
    await wait(300);
    assert.equal(secondDone, true, "the second merge ran");
    assert.deepEqual(stored(ctx)["waybeyond20-active-effects"], []);
});

section("8. The sheet passes the broadcast origin to updateSettings", async () => {
    assert.match(topLevelFunction(characterSource, "handleMessage"),
        /character\.updateSettings\(request\.settings, request\.origin\)/);
    assert.match(classMethod(baseCharacterSource, "mergeCharacterSettings"), /"origin": wayBeyond20SettingsOrigin\(\)/);
});

(async () => {
    let failures = 0;
    for (const { name, body } of sections) {
        try {
            await body();
            console.log(`  PASS  ${name}`);
        } catch (error) {
            failures++;
            console.log(`  FAIL  ${name}: ${error.message.split("\n")[0]}`);
        }
    }
    if (failures > 0) {
        console.log(`WayBeyond20 v1.65.2 settings concurrency checks: ${failures} of ${sections.length} sections failed.`);
        process.exit(1);
    }
    console.log("WayBeyond20 v1.65.2 settings concurrency checks passed.");
})();
