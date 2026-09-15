// WB20-0065 brief 1.11, P0 (F-L4): a roll that never left the tab spends nothing.
// Live evidence: after the extension was reloaded behind an unrefreshed D&D Beyond tab, the roll threw
// "Extension context invalidated" and never reached Roll20, yet Channel Divinity was spent because sendRoll
// still reported success. This suite runs the real sendRoll, DNDBDisplayer.sendMessage,
// beyond20SendMessageFailure and sendRollWithCharacter against a simulated chrome.runtime that throws,
// reports lastError, answers, or has no VTT, and checks every post-dispatch commit.
// WB20_SOURCE_ROOT may point at a copy of the sources to record pre-correction behavior.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const sourceRoot = process.env.WB20_SOURCE_ROOT || path.resolve(__dirname, "..");
const read = relative => fs.readFileSync(path.join(sourceRoot, ...relative.split("/")), "utf8");
const baseUtilsSource = read("src/dndbeyond/base/utils.js");
const diceSource = read("src/dndbeyond/base/dice.js");
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

const displayerClass = diceSource.slice(diceSource.indexOf("class DNDBDisplayer {"), diceSource.indexOf("class DNDBRoller {"));
assert.ok(displayerClass.startsWith("class DNDBDisplayer {"), "Missing DNDBDisplayer");

const UTILS_FUNCTIONS = ["sendRoll", "beyond20SendMessageFailure", "adjustRollAndKeyModifiersWithAdvantage"];
const OPTIONAL_UTILS_FUNCTIONS = ["wayBeyond20ExtensionContextAvailable", "wayBeyond20SendRuntimeMessage",
    "wayBeyond20TrackRollDelivery", "wayBeyond20NotifyDispatchFailure"];
const CHARACTER_FUNCTIONS = ["sendRollWithCharacter", "addEffect"];
const OPTIONAL_CHARACTER_FUNCTIONS = ["wayBeyond20DispatchRollWithCharacter", "wayBeyond20RestoreCharacterSheetTab",
    "wayBeyond20CommitAfterDispatch", "wayBeyond20CommitRollSettings", "wayBeyond20CommitSpellRollSettings",
    "wayBeyond20CreateSpellEffectPlan", "wayBeyond20AddSpellEffectToSettings"];

// runtime modes: "ok" (Roll20 answered), "no-vtt" (background: no VTT, local display), "throw" (orphaned
// script: sendMessage throws), "last-error" (callback with lastError), "no-id" (runtime.id gone).
function createSandbox({ runtime = "ok", digitalDice = false, rendererSends = true, rendererThrows = false } = {}) {
    const log = { runtimeSends: [], errors: [], warnings: [], localDisplays: [], rendered: [], turnSpends: [],
        limitedUseSpends: [], slotSpends: [], freeSmiteSpends: 0, selfEffects: [], intrusion: [], removedEffects: [],
        merges: [], remoteEffects: [], effectsUpdates: [], restoredTabs: 0 };
    const chromeRuntime = {
        get id() { return runtime === "no-id" ? undefined : "test-extension"; },
        lastError: undefined,
        sendMessage(message, callback) {
            if (runtime === "throw") throw new Error("Extension context invalidated.");
            log.runtimeSends.push(message);
            setTimeout(() => {
                if (runtime === "last-error") {
                    chromeRuntime.lastError = { message: "Could not establish connection. Receiving end does not exist." };
                    callback(undefined);
                    chromeRuntime.lastError = undefined;
                    return;
                }
                if (runtime === "no-vtt") {
                    callback({ success: false, vtt: null, request: message, error: "No VTT found that matches your settings." });
                    return;
                }
                callback({ success: true, vtt: ["roll20"], error: null, request: message });
            }, 1);
        },
        getURL: () => "chrome-extension://test/"
    };
    const displayer = { value: null };
    const character = {
        _id: 7, _name: "Test Sheet", _settings: {},
        type: () => "Character",
        getDict: () => ({ id: 7, name: "Test Sheet", type: "Character", settings: {} }),
        getGlobalSetting: (key, fallback) => key === "use-digital-dice" ? digitalDice : fallback,
        getSetting: (key, fallback) => fallback,
        hasRacialTrait: () => false,
        mergeCharacterSettings(data, callback) { log.merges.push(data); if (callback) callback(data); }
    };
    const context = {
        console: { log() {}, warn() {}, error() {} }, Promise, setTimeout, WeakMap, Date, Math, String, Object, Array, JSON,
        chrome: { runtime: chromeRuntime }, character, settings: {}, log, key_modifiers: {},
        WhisperType: { NO: 0, YES: 1, QUERY: 2, HIDE_NAMES: 3 },
        RollType: { NORMAL: 0, DOUBLE: 1, QUERY: 2, ADVANTAGE: 3, DISADVANTAGE: 4, THRICE: 5, SUPER_ADVANTAGE: 6, SUPER_DISADVANTAGE: 7, OVERRIDE_ADVANTAGE: 8, OVERRIDE_DISADVANTAGE: 9 },
        cleanRoll: roll => String(roll || ""),
        DigitalDiceManager: { isEnabled: () => true, clearResults() {} },
        sendRollRequestToDOM() {},
        resetKeyModifiers() {},
        alertify: { error: message => log.errors.push(message), warning: message => log.warnings.push(message) },
        $: () => ({ css: () => undefined }),
        dndbeyondDiceRoller: {
            queryWhisper: async () => 0,
            queryAdvantage: async () => 0,
            handleRollError: (request, error) => log.localDisplays.push({ action: request.action, error }),
            // The renderer rolls the digital dice, then sends the rendered result through the displayer.
            handleRollRequest: async request => {
                await new Promise(resolve => setTimeout(resolve, 2));
                if (rendererThrows) throw new Error("renderer failed");
                log.rendered.push(request.name);
                if (rendererSends) displayer.value.sendMessage(request, request.name, "<div></div>", "Test Sheet", 0, false, "", {}, "", [], [], [], {}, false);
            }
        },
        wayBeyond20CharacterDebug() {},
        wayBeyond20PreflightLimitedUse: async () => ({ allowed: true, tracked: true, remaining: 2 }),
        wayBeyond20PreflightTurnResource: async () => true,
        wayBeyond20SpendTurnResource: resource => log.turnSpends.push(resource),
        wayBeyond20SpendLimitedUse: async feature => { log.limitedUseSpends.push(feature); return true; },
        wayBeyond20SpendSpellSlot: async level => { log.slotSpends.push(level); return true; },
        wayBeyond20SpendPaladinSmiteFreeUse: async () => { log.freeSmiteSpends++; return true; },
        wayBeyond20TrackSelfFeatureEffect: name => log.selfEffects.push(name),
        wayBeyond20SetIntrusionDie: value => log.intrusion.push(value),
        wayBeyond20RemoveTrackedEffect: key => log.removedEffects.push(key),
        wayBeyond20EffectKey: effect => effect.id,
        wayBeyond20EffectName: effect => String(effect && effect.name || "").toLowerCase(),
        wayBeyond20GetTrackedSpellEffects: () => [{ id: "stealth-1", name: "Stealth", conditions: ["Invisible"], hideDc: 18 }],
        wayBeyond20GetConcentrationEffect: () => null,
        wayBeyond20NormalizeAttackSemantics() {},
        wayBeyond20ApplyDrainingAttackIntent() {},
        wayBeyond20SendEffectToTarget: (target, effect) => log.remoteEffects.push([target.name, effect.name]),
        wayBeyond20SendEffectsUpdate: (c, effects, concentration) => log.effectsUpdates.push({ effects: effects.length, concentration: concentration && concentration.name }),
        wayBeyond20ActiveCharacterSheetTab: () => null
    };
    vm.createContext(context);
    vm.runInContext([
        topLevelDeclaration(baseUtilsSource, "const wayBeyond20RollDeliveries"),
        topLevelDeclaration(baseUtilsSource, "let wayBeyond20LastDispatchFailureNotice"),
        ...UTILS_FUNCTIONS.map(name => topLevelFunction(baseUtilsSource, name)),
        ...OPTIONAL_UTILS_FUNCTIONS.map(name => topLevelFunction(baseUtilsSource, name, { optional: true })),
        displayerClass,
        "displayerHolder.value = new DNDBDisplayer();",
        ...CHARACTER_FUNCTIONS.map(name => topLevelFunction(characterSource, name)),
        ...OPTIONAL_CHARACTER_FUNCTIONS.map(name => topLevelFunction(characterSource, name, { optional: true }))
    ].join("\n"), Object.assign(context, { displayerHolder: displayer }));
    return context;
}

const run = (context, expression) => vm.runInContext(expression, context);
const plain = value => JSON.parse(JSON.stringify(value));
const settle = () => new Promise(resolve => setTimeout(resolve, 20));

// A request carrying every post-dispatch commit this dispatch path owns.
function fullRequest(context) {
    const request = {
        name: "Longsword", "to-hit": "+5", damages: ["1d8 + 3"], "damage-types": ["Slashing"], rollDamage: true,
        "waybeyond20-turn-resource": { resource: "action", name: "Longsword" },
        "waybeyond20-turn-resources": [{ resource: "bonusAction", name: "Divine Smite" }],
        "waybeyond20-limited-use": { feature: "Channel Divinity", name: "Efreeti's Fury" },
        "waybeyond20-smite": { name: "Divine Smite", fuel: "spell-slot", slotLevel: 1, slotAvailable: 3, returnTab: null },
        "waybeyond20-noble-genie-rider": { choice: "djinni" },
        "waybeyond20-occultist-intrusion": { nextDie: "1d6" }
    };
    if (typeof context.wayBeyond20CommitAfterDispatch === "function") {
        run(context, "wayBeyond20CommitAfterDispatch")(request, () => run(context, "wayBeyond20CommitRollSettings")({ "rogue-sneak-attack": false }));
    }
    return request;
}

function assertNothingCommitted(log, label) {
    assert.deepEqual(log.turnSpends, [], `${label}: no Action/Bonus Action spent`);
    assert.deepEqual(log.limitedUseSpends, [], `${label}: no limited use spent`);
    assert.deepEqual(log.slotSpends, [], `${label}: no spell slot spent`);
    assert.equal(log.freeSmiteSpends, 0, `${label}: Paladin's Smite not spent`);
    assert.deepEqual(log.selfEffects, [], `${label}: no feature effect tracked`);
    assert.deepEqual(log.intrusion, [], `${label}: Occultist Intrusion die unchanged`);
    assert.deepEqual(log.removedEffects, [], `${label}: Stealth effect not consumed`);
    assert.deepEqual(log.merges, [], `${label}: no settings committed`);
    assert.deepEqual(log.remoteEffects, [], `${label}: no target effect sent`);
}

const sections = [];
const section = (name, body) => sections.push({ name, body });

section("1. Orphaned script, sendMessage throws: sendRoll reports failure and asks for a tab reload", async () => {
    const ctx = createSandbox({ runtime: "throw" });
    const result = await run(ctx, "sendRoll")(ctx.character, "attack", "1d8", { name: "Longsword" });
    assert.equal(result, false, "a thrown extension-context error is a failed dispatch");
    assert.equal(ctx.log.errors.length, 1, "one notice");
    assert.match(ctx.log.errors[0], /reload this tab/i);
    assert.match(ctx.log.errors[0], /nothing was spent/i);
});

section("2. Runtime id already gone: failure without attempting the send", async () => {
    const ctx = createSandbox({ runtime: "no-id" });
    assert.equal(await run(ctx, "sendRoll")(ctx.character, "attack", "1d8", { name: "Longsword" }), false);
    assert.equal(ctx.log.runtimeSends.length, 0);
    assert.equal(ctx.log.errors.length, 1);
    // With digital dice, an orphaned tab must not roll dice whose result can never be sent.
    const digital = createSandbox({ runtime: "no-id", digitalDice: true });
    assert.equal(await run(digital, "sendRoll")(digital.character, "attack", "1d8", { name: "Longsword" }), false);
    assert.deepEqual(digital.log.rendered, [], "no dice rolled");
});

section("3. Callback lastError: failure", async () => {
    const ctx = createSandbox({ runtime: "last-error" });
    assert.equal(await run(ctx, "sendRoll")(ctx.character, "attack", "1d8", { name: "Longsword" }), false);
    assert.equal(ctx.log.runtimeSends.length, 1);
    assert.equal(ctx.log.errors.length, 1);
});

section("4. Roll20 received the roll: success, no local display, no notice", async () => {
    const ctx = createSandbox({ runtime: "ok" });
    assert.equal(await run(ctx, "sendRoll")(ctx.character, "attack", "1d8", { name: "Longsword" }), true);
    assert.equal(ctx.log.runtimeSends.length, 1);
    assert.deepEqual(ctx.log.localDisplays, []);
    assert.deepEqual(ctx.log.errors, []);
});

section("5. No VTT open: the supported local D&D Beyond display still counts as handled", async () => {
    const ctx = createSandbox({ runtime: "no-vtt" });
    assert.equal(await run(ctx, "sendRoll")(ctx.character, "attack", "1d8", { name: "Longsword" }), true);
    assert.equal(ctx.log.localDisplays.length, 1, "local display shown");
    assert.deepEqual(ctx.log.errors, []);
});

section("6. Digital dice: the renderer's later send decides the outcome", async () => {
    const failed = createSandbox({ runtime: "throw", digitalDice: true });
    // runtime.id is present, so the precheck passes; the send after the dice throws.
    assert.equal(await run(failed, "sendRoll")(failed.character, "attack", "1d8", { name: "Longsword" }), false, "thrown send after the dice");
    assert.deepEqual(failed.log.rendered, ["Longsword"]);
    assert.equal(failed.log.errors.length, 1);

    const lastError = createSandbox({ runtime: "last-error", digitalDice: true });
    assert.equal(await run(lastError, "sendRoll")(lastError.character, "attack", "1d8", { name: "Longsword" }), false, "lastError after the dice");

    const ok = createSandbox({ runtime: "ok", digitalDice: true });
    assert.equal(await run(ok, "sendRoll")(ok.character, "attack", "1d8", { name: "Longsword" }), true);
    assert.equal(ok.log.runtimeSends.length, 1);
    assert.equal(ok.log.runtimeSends[0].action, "rendered-roll");

    const localOnly = createSandbox({ runtime: "throw", digitalDice: true, rendererSends: false });
    assert.equal(await run(localOnly, "sendRoll")(localOnly.character, "attack", "1d8", { name: "Longsword" }), true,
        "a roll the renderer only displayed locally keeps its local-only outcome");

    const renderFailure = createSandbox({ runtime: "ok", digitalDice: true, rendererThrows: true });
    assert.equal(await run(renderFailure, "sendRoll")(renderFailure.character, "attack", "1d8", { name: "Longsword" }), false);
});

section("7. sendRollWithCharacter: failed dispatch commits nothing (throw, lastError, orphaned, digital)", async () => {
    for (const options of [{ runtime: "throw" }, { runtime: "last-error" }, { runtime: "no-id" }, { runtime: "throw", digitalDice: true }]) {
        const ctx = createSandbox(options);
        const result = await run(ctx, "sendRollWithCharacter")("attack", "1d8 + 3", fullRequest(ctx));
        const label = JSON.stringify(options);
        assert.notEqual(result, true, `${label}: failure returned to the caller`);
        await settle();
        assertNothingCommitted(ctx.log, label);
    }
});

section("8. sendRollWithCharacter: successful dispatch still commits everything once (regression)", async () => {
    for (const options of [{ runtime: "ok" }, { runtime: "no-vtt" }, { runtime: "ok", digitalDice: true }]) {
        const ctx = createSandbox(options);
        const result = await run(ctx, "sendRollWithCharacter")("attack", "1d8 + 3", fullRequest(ctx));
        const label = JSON.stringify(options);
        assert.equal(result, true, label);
        await settle();
        assert.deepEqual(ctx.log.turnSpends, ["action", "bonusAction"], label);
        assert.deepEqual(ctx.log.limitedUseSpends, ["Channel Divinity"], label);
        assert.deepEqual(ctx.log.slotSpends, [1], label);
        assert.deepEqual(ctx.log.selfEffects, ["Djinni’s Escape"], label);
        assert.deepEqual(ctx.log.intrusion, ["1d6"], label);
        assert.deepEqual(ctx.log.removedEffects, ["stealth-1"], label);
        assert.deepEqual(ctx.log.merges, [{ "rogue-sneak-attack": false }], `${label}: one-shot toggle committed after dispatch`);
        const dispatched = ctx.log.runtimeSends[0];
        const payload = dispatched.action === "rendered-roll" ? dispatched.request : dispatched;
        assert.equal(payload["waybeyond20-after-dispatch"], undefined, `${label}: commit intents never leave the tab`);
    }
});

section("9. Spell effects, Concentration and target effects are committed only after dispatch", async () => {
    for (const [runtime, expectCommitted] of [["throw", false], ["ok", true]]) {
        const ctx = createSandbox({ runtime });
        assert.equal(typeof ctx.wayBeyond20CreateSpellEffectPlan, "function", "spell effect plan exists");
        const plan = run(ctx, "wayBeyond20CreateSpellEffectPlan")(ctx.character);
        plan.local.push({ id: "bless-self", name: "Bless", concentration: true });
        plan.remote.push([{ name: "Ally" }, { id: "bless-ally", name: "Bless" }]);
        const request = { name: "Bless", "waybeyond20-turn-resource": { resource: "action", name: "Bless" } };
        run(ctx, "wayBeyond20CommitAfterDispatch")(request, () => run(ctx, "wayBeyond20CommitSpellRollSettings")({ "scroll-choice": "remembered" }, plan));
        ctx.wayBeyond20GetTrackedSpellEffects = () => [];
        const result = await run(ctx, "sendRollWithCharacter")("spell-card", 0, request);
        await settle();
        if (!expectCommitted) {
            assert.notEqual(result, true);
            assert.deepEqual(ctx.log.merges, [], "no effect or Concentration saved");
            assert.deepEqual(ctx.log.remoteEffects, [], "no target effect sent");
            assert.deepEqual(ctx.log.turnSpends, []);
        } else {
            assert.equal(result, true);
            assert.equal(ctx.log.merges.length, 1);
            assert.equal(ctx.log.merges[0]["waybeyond20-concentration"].name, "Bless");
            assert.deepEqual(plain(ctx.log.merges[0]["waybeyond20-active-effects"].map(effect => effect.id)), ["bless-self"]);
            assert.equal(ctx.log.merges[0]["scroll-choice"], "remembered");
            assert.deepEqual(plain(ctx.log.remoteEffects), [["Ally", "Bless"]]);
            assert.deepEqual(plain(ctx.log.effectsUpdates), [{ effects: 1, concentration: "Bless" }]);
            assert.deepEqual(ctx.log.turnSpends, ["action"]);
        }
    }
});

section("10. Roll builders no longer save settings before dispatch", async () => {
    const body = name => topLevelFunction(characterSource, name);
    for (const name of ["rollItem", "rollAction", "rollSpell"]) {
        const source = body(name);
        assert.doesNotMatch(source, /character\.mergeCharacterSettings\(settings_to_change/, `${name} saves settings only through the post-dispatch commit`);
        assert.match(source, /wayBeyond20CommitAfterDispatch\(/, `${name} registers its settings commit`);
    }
    assert.doesNotMatch(topLevelFunction(characterSource, "wayBeyond20ApplySpellEffectWithTargets"), /wayBeyond20SendEffectToTarget\(/,
        "target effects are queued in the plan, not sent during target selection");
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
        console.log(`WayBeyond20 v1.65.2 dispatch-failure checks: ${failures} of ${sections.length} sections failed.`);
        process.exit(1);
    }
    console.log("WayBeyond20 v1.65.2 dispatch-failure checks passed.");
})();
