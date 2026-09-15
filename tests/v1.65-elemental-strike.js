// WB20-0065 brief 1.8: Elemental Strike / Elemental Smite. Casting Divine Smite (any fuel,
// any entry point) and activating the parent Elemental Strike row open one chooser with four
// action buttons; a click performs that option at once. Option rows stay independently usable.
// Runs the real rider, option, Smite, dispatch, attack builder, Beyond20Prompt dialog
// (prepare, button click, callback, close), renderer rows and damage flags, and Roll20 text.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const read = relative => fs.readFileSync(path.join(root, ...relative.split("/")), "utf8");
const characterSource = read("src/dndbeyond/content-scripts/character.js");
const baseUtilsSource = read("src/dndbeyond/base/utils.js");
const commonUtilsSource = read("src/common/utils.js");
const rendererSource = read("src/common/roll_renderer.js");
const roll20Source = read("src/roll20/content-script.js");
const diceSource = read("src/dndbeyond/base/dice.js");

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

const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));

const damageFlagsSource = rendererSource.slice(
    rendererSource.indexOf("class DAMAGE_FLAGS {"),
    rendererSource.indexOf("\n}\n", rendererSource.indexOf("class DAMAGE_FLAGS {")) + 3
);
// The renderer's non-critical damage loop, which assigns REGULAR/ADDITIONAL/CONDITIONAL flags.
const rendererDamageLoop = between(rendererSource, "const seen_spell_damages = {};", "await this._roller.resolveRolls(request.name, all_rolls, request)");

const CHARACTER_FUNCTIONS = [
    "sendRollWithCharacter", "wayBeyond20DispatchRollWithCharacter", "wayBeyond20RestoreCharacterSheetTab", "addEffect", "wayBeyond20AttachLimitedUse",
    "wayBeyond20ActivationResource", "wayBeyond20AttachTurnResource",
    "wayBeyond20AttachAdditionalTurnResource", "wayBeyond20AttachActivationResource",
    "wayBeyond20NormalizeFeatureLabel", "wayBeyond20PaladinSaveDC",
    "wayBeyond20RollIsUnarmedStrike", "wayBeyond20NormalizeAttackSemantics", "wayBeyond20ApplyDrainingAttackIntent",
    "wayBeyond20SmiteFormulaForSlot", "wayBeyond20SmiteFuelIsLegal", "wayBeyond20QuerySmite",
    "wayBeyond20ElementalStrikeChoice", "wayBeyond20ElementalStrikeSummary", "wayBeyond20HasElementalStrike",
    "wayBeyond20ApplyElementalStrikeEffect", "wayBeyond20QueryElementalStrike",
    "wayBeyond20MaybeAddElementalStrike", "wayBeyond20RollElementalStrikeOption",
    "wayBeyond20IsElementalStrikeParent", "wayBeyond20RollElementalStrikeParent",
    "wayBeyond20MaybeAddSmite", "wayBeyond20AddSelectedSmite", "wayBeyond20RollPaladinSpecialAction"
];

// ---- Minimal DOM for the Beyond20Prompt dialog -------------------------------------------
// Parses only what the Elemental Strike and Smite prompts emit: the form class and the
// action buttons. Events are delivered to the listeners the real prepare() registers.
function fakeClassList() {
    const set = new Set();
    return { toggle: (c, on) => on ? set.add(c) : set.delete(c), remove: c => set.delete(c), add: c => set.add(c), contains: c => set.has(c) };
}

function parseForm(html) {
    const formMatch = /^<form class="([^"]+)"/.exec(html);
    if (!formMatch) return null;
    const attributes = {};
    const listeners = {};
    const form = {
        className: formMatch[1],
        buttons: [],
        getAttribute: name => attributes[name] === undefined ? null : attributes[name],
        setAttribute: (name, value) => { attributes[name] = String(value); },
        addEventListener: (type, fn) => { (listeners[type] = listeners[type] || []).push(fn); },
        querySelector: () => null,
        querySelectorAll: selector => selector === "button[data-elemental-strike]" ? form.buttons : [],
        dispatch(type, target) {
            const event = { type, target, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
            (listeners[type] || []).forEach(fn => fn(event));
            return event;
        },
        listenerCount: type => (listeners[type] || []).length
    };
    const buttonPattern = /<button type="button" class="([^"]+)" data-elemental-strike="([^"]+)" title="([^"]*)">([^<]*)<\/button>/g;
    let match;
    while ((match = buttonPattern.exec(html))) {
        const button = {
            tagName: "BUTTON", type: "button", className: match[1], key: match[2], title: match[3], textContent: match[4], disabled: false,
            getAttribute: name => name === "data-elemental-strike" ? button.key : null,
            closest: selector => selector === "button[data-elemental-strike]" ? button : null
        };
        // A click on a child (e.g. the text) bubbles to the form with the child as target.
        button.textNode = { closest: selector => button.closest(selector) };
        form.buttons.push(button);
    }
    return form;
}

function createDialogHarness() {
    let factory = null;
    const dialogLog = { opened: [], closes: 0, callbacks: [] };
    const okButton = { disabled: false, style: { display: "" }, innerHTML: "", classList: fakeClassList(), attributes: {},
        setAttribute(k, v) { this.attributes[k] = v; }, removeAttribute(k) { delete this.attributes[k]; } };
    const cancelButton = { innerHTML: "" };
    let instance = null;
    const alertify = {
        set() {},
        defaults: { glossary: {}, theme: {} },
        dialog: (name, value) => { if (name === "Beyond20Prompt") factory = value; }
    };
    // Registered by initializeAlertify (it only defines the dialog when absent); this stands in
    // for alertify's dialog runner: main(), prepare(), then button callbacks.
    const openPrompt = function (title, content, ok, cancel, resolver) {
            if (!instance) {
                const definition = factory();
                const settings = {};
                const content = {
                    form: null,
                    set innerHTML(html) { this.html = html; this.form = parseForm(html); },
                    get firstElementChild() { return this.form; },
                    querySelector(selector) {
                        const match = /^form\.(.+)$/.exec(selector);
                        return match && this.form && this.form.className === match[1] ? this.form : null;
                    }
                };
                instance = Object.assign({}, definition, {
                    elements: { content },
                    __internal: { buttons: [{ element: okButton }, { element: cancelButton }] },
                    set: (key, value) => { settings[key] = value; },
                    get: key => settings[key],
                    close() {
                        dialogLog.closes++;
                        // alertify runs the invokeOnClose (Cancel) button's callback on close.
                        instance.callback({ index: 1 });
                    }
                });
                const callback = definition.callback;
                instance.callback = function (event) { dialogLog.callbacks.push(event.index); return callback.call(instance, event); };
            }
            instance.main(title, content, ok, cancel, resolver);
            instance.prepare();
            dialogLog.opened.push({ title, html: content, ok, cancel });
    };
    const $ = element => ({ attr: name => element.getAttribute(name), 0: element });
    const context = { alertify, $, document: {}, console };
    vm.createContext(context);
    vm.runInContext(topLevelFunction(commonUtilsSource, "initializeAlertify"), context);
    vm.runInContext("initializeAlertify()", context);
    assert.equal(typeof factory, "function", "initializeAlertify registers Beyond20Prompt");
    alertify.Beyond20Prompt = openPrompt;
    // The DDB prompter, verbatim from dice.js.
    const promptMethod = between(diceSource, "async prompt(title, html, ok_label = \"OK\", cancel_label = \"Cancel\") {", "\n}\n");
    vm.runInContext(`var prompter = { ${promptMethod} };`, context);
    return {
        prompter: context.prompter,
        dialogLog,
        okButton,
        form: () => instance && instance.elements.content.form,
        click(key, { onChild = false } = {}) {
            const form = instance.elements.content.form;
            const button = form.buttons.find(candidate => candidate.key === key);
            assert.ok(button, `button ${key} exists`);
            return form.dispatch("click", onChild ? button.textNode : button);
        },
        cancel: () => instance.callback({ index: 1 }),
        pressEnter: () => instance.callback({ index: 0 })
    };
}

// Fake Smite prompt result: answers find("input[name='x']:checked").val() from a map.
const promptAnswer = answers => ({
    find(selector) {
        const name = /name='([^']+)'/.exec(selector)[1];
        return { val: () => answers[name] };
    }
});

function createSandbox({ features = [], actions = [], channelDivinity = [true, true], smiteOptions = null,
    answers = [], preflightAllowed = true, sendResult = true, spellSaveDc = 15 } = {}) {
    const log = { prompts: [], dispatched: [], turnSpends: [], limitedUseSpends: [], slotSpends: [],
        freeSmiteSpends: 0, selfEffects: [], buildSmiteOptionsCalls: 0, sendRollCalls: 0 };
    const dialog = createDialogHarness();
    const character = {
        _id: 111, _name: "Test Genie", _proficiency: 2, _spell_saves: { Paladin: spellSaveDc },
        hasClassFeature: (name, substring) => features.some(feature => substring ? feature.includes(name) : feature === name),
        hasAction: (name, substring) => actions.some(action => substring ? action.includes(name) : action === name),
        hasRacialTrait: () => false,
        hasFeat: () => false,
        // Inherited buildAttackRoll checks unrelated classes; the rider code must not (see section 10).
        hasClass: () => false,
        getAbility: () => ({ mod: 3 }),
        getSetting: (key, fallback) => fallback,
        getGlobalSetting: (key, fallback) => fallback,
        mergeCharacterSettings() {}
    };
    const promptQueue = answers.slice();
    const context = {
        console, Promise, setTimeout, character, settings: {}, log, dialog,
        CriticalRules: { PHB: 0, HOMEBREW_MAX: 1, HOMEBREW_DOUBLE: 2, HOMEBREW_REROLL: 3, HOMEBREW_MOD: 4 },
        RollType: {},
        ability_abbreviations: { Strength: "STR", Dexterity: "DEX", Constitution: "CON", Intelligence: "INT", Wisdom: "WIS", Charisma: "CHA" },
        $: () => ({ css: () => undefined }),
        damagesToCrits: (c, damages) => damages.map(damage => `crit(${damage})`),
        applyRogueSneakAttack: async () => {},
        abbreviationToAbility: value => value,
        dndbeyondDiceRoller: {
            _prompter: {
                prompt: (title, html, ok, cancel) => {
                    log.prompts.push({ title, html, ok, cancel });
                    const answer = promptQueue.shift();
                    if (title !== "Elemental Strike") return Promise.resolve(answer ? promptAnswer(answer) : null);
                    // The real dialog; the scripted user acts after it has been prepared.
                    const pending = dialog.prompter.prompt(title, html, ok, cancel);
                    setTimeout(() => {
                        if (!answer || answer.cancel) dialog.cancel();
                        else if (answer.enter) dialog.pressEnter();
                        else answer.clicks.forEach(key => dialog.click(key, { onChild: !!answer.onChild }));
                    }, 0);
                    return pending;
                }
            }
        },
        wayBeyond20CharacterDebug() {},
        wayBeyond20DebugLog() {},
        wayBeyond20BuildSmiteOptions: async () => { log.buildSmiteOptionsCalls++; return clone(smiteOptions); },
        // No sheet tabs in this model; tab restoration is covered by tests/v1.65-smite-tab-restore.js.
        wayBeyond20ActiveCharacterSheetTab: () => null,
        wayBeyond20ExposeChannelDivinityControls: async () => ({ controls: channelDivinity.map(unused => ({ unused })) }),
        wayBeyond20LimitedUseControlIsUnused: control => control.unused,
        wayBeyond20PreflightLimitedUse: async () => ({ allowed: true, tracked: true }),
        wayBeyond20SpendLimitedUse: async feature => { log.limitedUseSpends.push(feature); return true; },
        wayBeyond20PreflightTurnResource: async () => preflightAllowed,
        wayBeyond20SpendTurnResource: resource => log.turnSpends.push(resource),
        wayBeyond20SpendSpellSlot: async level => { log.slotSpends.push(level); return true; },
        wayBeyond20SpendPaladinSmiteFreeUse: async () => { log.freeSmiteSpends++; return true; },
        wayBeyond20TrackSelfFeatureEffect: name => log.selfEffects.push(name),
        wayBeyond20RemoveTrackedEffect() {},
        wayBeyond20SetIntrusionDie() {},
        wayBeyond20GetTrackedSpellEffects: () => [],
        wayBeyond20EffectName: () => "",
        wayBeyond20RollLayOnHands: async () => { throw new Error("unexpected Lay on Hands"); },
        sendRoll: async (char, rollType, fallback, request) => {
            log.sendRollCalls++;
            if (sendResult !== true) return sendResult;
            request.character = { id: char._id, name: char._name };
            log.dispatched.push({ rollType, request: clone(request) });
            return true;
        }
    };
    vm.createContext(context);
    vm.runInContext([
        damageFlagsSource,
        between(characterSource, "const WAYBEYOND20_ELEMENTAL_STRIKE_CHOICES", "function wayBeyond20ElementalStrikeChoice("),
        topLevelFunction(baseUtilsSource, "buildAttackRoll"),
        ...CHARACTER_FUNCTIONS.map(name => topLevelFunction(characterSource, name)),
        topLevelFunction(roll20Source, "wayBeyond20SendResolvedDamageToDDB"),
        `function renderDamageFlags(request) { const damages = request.damages; const damage_types = request["damage-types"]; const all_rolls = []; const damage_rolls = []; ${rendererDamageLoop} return damage_rolls; }`
    ].join("\n"), context);
    return context;
}

const run = (context, expression) => vm.runInContext(expression, context);
const FEATURE = ["Elemental Strike"];
const DIVINE_SMITE = { name: "Divine Smite", level: 1, formula: "2d8", damageType: "Radiant", saveAbility: "", saveDc: null };
const THUNDEROUS_SMITE = { name: "Thunderous Smite", level: 1, formula: "2d6", damageType: "Thunder", saveAbility: "STR", saveDc: 13 };
const FUELS = [
    { type: "paladin-smite", label: "Paladin's Smite", level: 1 },
    { type: "spell-slot", level: 2, label: "2nd Level Spell Slot (1 available)" }
];
const SMITE_OPTIONS = { smites: [DIVINE_SMITE, THUNDEROUS_SMITE], fuels: FUELS, returnTab: null };
const smiteAnswer = (smite, fuel) => ({ "smite-type": smite, "smite-fuel": fuel });
const click = (...keys) => ({ clicks: keys });
const CANCEL = { cancel: true };
const LABELS = ["Dao’s Crush", "Djinni’s Escape", "Efreeti’s Fury", "Marid’s Surge"];
const RESULT_TEXT = {
    dao: "The target has the Grappled condition (DC 15 to escape). While Grappled, the target has the Restrained condition.",
    djinni: "You can teleport to an unoccupied space you can see within 30 feet of yourself. Until the end of your next turn, you have Resistance to Bludgeoning, Piercing, and Slashing damage, and Immunity to the Grappled, Prone, and Restrained conditions.",
    efreeti: "The target of your Divine Smite takes an extra 2d4 Fire damage, and fire jumps to another creature you can see within 30 feet of yourself. The second creature also takes 2d4 Fire damage (rolled separately; not part of the target's total).",
    marid: "The target of your Divine Smite and each creature of your choice in a 10-foot Emanation originating from you make a DC 15 Strength saving throw. On a failed save, a creature is pushed 15 feet straight away from you and has the Prone condition."
};
const NAME = { dao: LABELS[0], djinni: LABELS[1], efreeti: LABELS[2], marid: LABELS[3] };

// Attack follow-up route: a melee action attack through the real buildAttackRoll and Smite code.
async function smiteAttack(context) {
    const properties = { "Attack Type": "Melee", "Reach": "5 ft.", "Action Type": "Action" };
    const request = await run(context, "buildAttackRoll")(context.character, "action", "Longsword", "", properties,
        ["1d8 + 3"], ["Slashing"], "+5", 0, false, false, { weapon_damage_length: 1 }, {});
    run(context, "wayBeyond20AttachActivationResource")(request, properties, null, "action", { name: "Longsword", rollType: "attack" });
    await run(context, "wayBeyond20MaybeAddSmite")(request, true);
    return run(context, "sendRollWithCharacter")("attack", "1d8 + 3", request);
}

// Direct cast route: the tail of rollSpell for a Divine Smite spell pane.
async function castDivineSmite(context, spellName = "Divine Smite") {
    const properties = { "Casting Time": "1 Bonus Action", "Range/Area": "Self" };
    const request = await run(context, "buildAttackRoll")(context.character, "spell", spellName, "", properties,
        ["2d8"], ["Radiant"], null, 0, false, false, {}, {});
    run(context, "wayBeyond20AttachActivationResource")(request, properties, null, null, { name: spellName, rollType: "spell-attack" });
    await run(context, "wayBeyond20MaybeAddElementalStrike")(request, spellName);
    return run(context, "sendRollWithCharacter")("spell-attack", "2d8", request);
}

const lastRequest = context => context.log.dispatched[context.log.dispatched.length - 1].request;
const titles = context => context.log.prompts.map(prompt => prompt.title);

function assertChooser(context, route) {
    const form = context.dialog.form();
    assert.ok(form, "chooser rendered through Beyond20Prompt.prepare");
    assert.equal(form.className, "waybeyond20-elemental-strike-query");
    assert.deepEqual(form.buttons.map(button => button.textContent), LABELS, "four buttons, exact labels, in order");
    assert.ok(form.buttons.every(button => button.type === "button" && button.className === "waybeyond20-elemental-strike-button"));
    assert.deepEqual(form.buttons.map(button => button.key), ["dao", "djinni", "efreeti", "marid"]);
    const html = context.log.prompts.find(prompt => prompt.title === "Elemental Strike").html;
    assert.doesNotMatch(html, /type="radio"|<input/, "no radio selection");
    assert.equal(context.log.prompts.find(prompt => prompt.title === "Elemental Strike").cancel, "Cancel");
    assert.equal(context.dialog.okButton.style.display, "none", "no Proceed/confirm step is shown");
    assert.equal(form.listenerCount("click"), 1, "one click handler per prepared chooser");
    assert.ok(html.includes(route === "divine-smite" ? "this Divine Smite's Bonus Action" : "uses one Channel Divinity."));
}

(async () => {
    // 1. Feature detection: both capability names; absent feature offers nothing; no class gate.
    {
        for (const [features, actions, expected] of [
            [[], [], false], [["Elemental Strike"], [], true], [["Elemental Smite"], [], true],
            [[], ["Elemental Strike: Marid’s Surge"], true], [["Divine Smite", "Channel Divinity"], [], false]
        ]) {
            const ctx = createSandbox({ features, actions });
            assert.equal(run(ctx, "wayBeyond20HasElementalStrike")(), expected, JSON.stringify({ features, actions }));
        }
        const absent = createSandbox({ features: [], answers: [click("dao")] });
        assert.equal(await castDivineSmite(absent), true);
        assert.deepEqual(titles(absent), [], "no chooser without the feature");
        assert.deepEqual(absent.log.limitedUseSpends, []);
        assert.deepEqual(absent.log.turnSpends, ["bonusAction"], "Divine Smite itself is unaffected");
    }

    // 2. Channel Divinity: zero or unexposed suppresses only the rider; positive opens the chooser.
    for (const channelDivinity of [[], [false, false]]) {
        const ctx = createSandbox({ features: FEATURE, channelDivinity, answers: [click("dao")] });
        assert.equal(await castDivineSmite(ctx), true);
        assert.deepEqual(titles(ctx), [], `no chooser with Channel Divinity ${JSON.stringify(channelDivinity)}`);
        assert.equal(ctx.log.dispatched.length, 1, "Divine Smite still dispatches");
        assert.deepEqual(ctx.log.limitedUseSpends, []);
    }
    for (const feature of ["Elemental Strike", "Elemental Smite"]) {
        const ctx = createSandbox({ features: [feature], channelDivinity: [false, true], answers: [click("dao")] });
        await castDivineSmite(ctx);
        assert.deepEqual(titles(ctx), ["Elemental Strike"], `${feature} opens the chooser`);
        assertChooser(ctx, "divine-smite");
        assert.ok(ctx.dialog.form().buttons[0].title.includes("DC 15 to escape"), "button tooltip uses the resolved DC");
    }

    // 3. Direct cast: one click performs the option at once; one Channel Divinity, one Bonus
    //    Action, one dispatch; the readable result carries the full text with the resolved DC.
    for (const key of ["dao", "djinni", "efreeti", "marid"]) {
        for (const onChild of [false, true]) {
            const ctx = createSandbox({ features: FEATURE, answers: [{ clicks: [key], onChild }] });
            assert.equal(await castDivineSmite(ctx), true);
            const request = lastRequest(ctx);
            assert.deepEqual(ctx.dialog.dialogLog.opened.map(open => open.title), ["Elemental Strike"], `${key}: one chooser, no second step`);
            assert.equal(ctx.dialog.dialogLog.closes, 1, `${key}: the click closes the chooser`);
            assert.equal(ctx.dialog.form().getAttribute("data-selected"), key);
            assert.ok(ctx.dialog.form().buttons.every(button => button.disabled), `${key}: buttons locked after the click`);
            assert.equal(ctx.log.sendRollCalls, 1, `${key}: one dispatch`);
            assert.deepEqual(ctx.log.limitedUseSpends, ["Channel Divinity"], `${key}: one Channel Divinity`);
            assert.deepEqual(ctx.log.turnSpends, ["bonusAction"], `${key}: only the Divine Smite Bonus Action`);
            assert.deepEqual(ctx.log.slotSpends, [], `${key}: no extra slot`);
            assert.equal(ctx.log.buildSmiteOptionsCalls, 0, `${key}: no Smite offer from the rider`);
            assert.deepEqual(request["feature-results"], [{ name: NAME[key], text: RESULT_TEXT[key] }], `${key}: readable result`);
            assert.ok(request.effects.includes(`Channel Divinity: ${NAME[key]} (part of Divine Smite)`));
            assert.deepEqual(ctx.log.selfEffects, key === "djinni" ? ["Djinni’s Escape"] : [], `${key}: self-effect only for Djinni`);
            if (key === "marid") {
                assert.equal(request["save-ability"], "Strength");
                assert.equal(request["save-dc"], 15);
            }
            if (key === "efreeti") {
                assert.deepEqual(request.damages, ["2d8", "2d4", "2d4"]);
                assert.deepEqual(request["damage-types"], ["Radiant", "Fire (Efreeti’s Fury)", "Fire (Efreeti’s Fury: second creature)"]);
            } else {
                assert.deepEqual(request.damages, ["2d8"], `${key}: no invented damage`);
            }
        }
    }

    // 4. Cancel and Enter-without-choice keep the Divine Smite and spend no Channel Divinity;
    //    double-clicks and repeated callbacks never post, damage, or spend twice.
    for (const answer of [CANCEL, { enter: true }]) {
        const ctx = createSandbox({ features: FEATURE, answers: [answer] });
        assert.equal(await castDivineSmite(ctx), true);
        assert.deepEqual(titles(ctx), ["Elemental Strike"]);
        assert.deepEqual(ctx.log.limitedUseSpends, [], `${JSON.stringify(answer)} spends no Channel Divinity`);
        assert.deepEqual(ctx.log.turnSpends, ["bonusAction"], `${JSON.stringify(answer)} declines only the rider`);
        assert.equal(ctx.log.sendRollCalls, 1, "the Divine Smite still posts once");
        assert.equal(lastRequest(ctx)["feature-results"], undefined);
        assert.equal(lastRequest(ctx).effects, undefined);
    }
    for (const clicks of [["efreeti", "efreeti"], ["efreeti", "dao", "marid"]]) {
        const ctx = createSandbox({ features: FEATURE, answers: [click(...clicks)] });
        assert.equal(await castDivineSmite(ctx), true);
        const request = lastRequest(ctx);
        assert.equal(ctx.dialog.form().getAttribute("data-selected"), "efreeti", `${clicks}: first click wins`);
        assert.equal(ctx.dialog.dialogLog.closes, 1, `${clicks}: closed once`);
        assert.equal(ctx.log.sendRollCalls, 1, `${clicks}: one post`);
        assert.deepEqual(ctx.log.limitedUseSpends, ["Channel Divinity"], `${clicks}: one Channel Divinity`);
        assert.deepEqual(request.damages, ["2d8", "2d4", "2d4"], `${clicks}: damage added once`);
        assert.equal(request["feature-results"].length, 1);
        assert.equal(request["save-ability"], undefined, `${clicks}: later Marid click ignored`);
    }
    {
        const repeated = createSandbox({ features: FEATURE, answers: [click("efreeti"), click("efreeti")] });
        const request = { name: "Divine Smite", damages: ["2d8"], "damage-types": ["Radiant"] };
        await run(repeated, "wayBeyond20MaybeAddElementalStrike")(request, "Divine Smite");
        assert.equal(await run(repeated, "wayBeyond20MaybeAddElementalStrike")(request, "Divine Smite"), null);
        assert.equal(repeated.log.prompts.length, 1, "repeated callback does not open the chooser again");
        assert.equal(request.damages.length, 3, "repeated callback does not add damage again");

        // A second trigger while the chooser is open reuses the one Beyond20Prompt instance: the
        // earlier chooser is superseded (never resolves), and repeated clicks still post once.
        const overlap = createSandbox({ features: FEATURE, answers: [click("efreeti", "efreeti"), click("dao")] });
        const superseded = castDivineSmite(overlap);
        const current = castDivineSmite(overlap);
        let supersededSettled = false;
        superseded.then(() => { supersededSettled = true; });
        assert.equal(await current, true);
        await new Promise(resolve => setTimeout(resolve, 20));
        assert.equal(supersededSettled, false, "the superseded chooser neither posts nor spends");
        assert.equal(overlap.dialog.dialogLog.opened.length, 2);
        assert.equal(overlap.log.sendRollCalls, 1, "one post");
        assert.deepEqual(overlap.log.limitedUseSpends, ["Channel Divinity"], "one Channel Divinity");
        assert.deepEqual(overlap.log.turnSpends, ["bonusAction"], "one Bonus Action");
        assert.equal(lastRequest(overlap)["feature-results"].length, 1);

        const otherSmite = createSandbox({ features: FEATURE, answers: [click("dao")] });
        await castDivineSmite(otherSmite, "Thunderous Smite");
        assert.deepEqual(titles(otherSmite), [], "only Divine Smite triggers Elemental Strike");
    }

    // 5. Attack follow-up dialog, both fuels: one Bonus Action, one Channel Divinity, one attack;
    //    the second creature's Fire is shown but kept out of the target's total.
    for (const [fuel, expectSlot, expectFree] of [["paladin-smite:1", [], 1], ["spell-slot:2", [2], 0]]) {
        const ctx = createSandbox({ features: FEATURE, smiteOptions: SMITE_OPTIONS,
            answers: [smiteAnswer("Divine Smite", fuel), click("efreeti")] });
        assert.equal(await smiteAttack(ctx), true);
        const request = lastRequest(ctx);
        assert.deepEqual(titles(ctx), ["Smite", "Elemental Strike"], `${fuel}: chooser follows the Smite choice`);
        assertChooser(ctx, "divine-smite");
        assert.equal(ctx.log.sendRollCalls, 1, `${fuel}: no standalone attack`);
        assert.deepEqual(ctx.log.turnSpends.slice().sort(), ["action", "bonusAction"], `${fuel}: exactly one Bonus Action`);
        assert.deepEqual(ctx.log.limitedUseSpends, ["Channel Divinity"], `${fuel}: exactly one Channel Divinity`);
        assert.deepEqual(ctx.log.slotSpends, expectSlot, `${fuel}: slot spend`);
        assert.equal(ctx.log.freeSmiteSpends, expectFree, `${fuel}: Paladin's Smite spend`);
        assert.equal(ctx.log.buildSmiteOptionsCalls, 1, `${fuel}: no recursive Smite`);
        assert.deepEqual(request["damage-types"], ["Slashing", "Radiant (Divine Smite)", "Fire (Efreeti’s Fury)", "Fire (Efreeti’s Fury: second creature)"]);
        assert.deepEqual(request["feature-results"], [{ name: NAME.efreeti, text: RESULT_TEXT.efreeti }]);
        assert.ok(!request["critical-damage-types"].some(type => type.includes("Efreeti")), "Efreeti damage is not added to critical dice");

        const flags = run(ctx, "DAMAGE_FLAGS");
        const rendered = run(ctx, "renderDamageFlags").call({ _roller: { roll: formula => ({ formula, setRollType() {} }) } }, request);
        assert.deepEqual(clone(rendered.map(row => [row[0], row[2]])), [
            ["Slashing Damage", flags.REGULAR],
            ["Radiant (Divine Smite) Damage", flags.ADDITIONAL],
            ["Fire (Efreeti’s Fury) Damage", flags.ADDITIONAL],
            ["Fire (Efreeti’s Fury: second creature) Damage", flags.CONDITIONAL]
        ]);
        const roll20Messages = [];
        ctx.wayBeyond20SendCustomMessageToExtension = message => roll20Messages.push(message);
        run(ctx, "wayBeyond20SendResolvedDamageToDDB")({
            request: Object.assign({}, request, { "waybeyond20-temp-hp-on-hit": { mode: "damage-dealt" } }),
            damage_rolls: rendered.map(([type, , flag], index) => [type, { total: [6, 9, 5, 4][index] }, flag])
        });
        assert.equal(roll20Messages[0].totalDamage, 20, "second-creature damage is not added to the primary target");
    }
    {
        const thunder = createSandbox({ features: FEATURE, smiteOptions: SMITE_OPTIONS, answers: [smiteAnswer("Thunderous Smite", "spell-slot:2"), click("dao")] });
        await smiteAttack(thunder);
        assert.deepEqual(titles(thunder), ["Smite"]);
        assert.deepEqual(thunder.log.limitedUseSpends, []);

        const cancelled = createSandbox({ features: FEATURE, smiteOptions: SMITE_OPTIONS, answers: [null, click("dao")] });
        assert.equal(await smiteAttack(cancelled), true);
        assert.deepEqual(titles(cancelled), ["Smite"], "no chooser without a Divine Smite");
        assert.deepEqual(cancelled.log.turnSpends, ["action"], "cancelled Smite spends no Bonus Action");
        assert.deepEqual(cancelled.log.limitedUseSpends, []);

        const declined = createSandbox({ features: FEATURE, smiteOptions: SMITE_OPTIONS, answers: [smiteAnswer("Divine Smite", "spell-slot:2"), CANCEL] });
        await smiteAttack(declined);
        assert.deepEqual(declined.log.slotSpends, [2], "cancelling the chooser keeps the Smite");
        assert.deepEqual(declined.log.turnSpends.slice().sort(), ["action", "bonusAction"]);
        assert.deepEqual(declined.log.limitedUseSpends, []);
    }

    // 6. Cancelling the base action, or a failed dispatch, spends nothing.
    for (const options of [{ preflightAllowed: false }, { sendResult: false }]) {
        const ctx = createSandbox(Object.assign({ features: FEATURE, smiteOptions: SMITE_OPTIONS,
            answers: [smiteAnswer("Divine Smite", "paladin-smite:1"), click("djinni")] }, options));
        await smiteAttack(ctx);
        assert.deepEqual(ctx.log.turnSpends, [], JSON.stringify(options));
        assert.deepEqual(ctx.log.limitedUseSpends, []);
        assert.equal(ctx.log.freeSmiteSpends, 0);
        assert.deepEqual(ctx.log.selfEffects, [], "no Djinni self-effect without the action");
    }

    // 7. Independent option rows: already chosen, so no chooser; own activation cost from the
    //    actual row, one Channel Divinity, same effect, never an attack or a Divine Smite offer.
    for (const [name, key] of [["Dao’s Crush", "dao"], ["Elemental Strike: Djinni's Escape", "djinni"],
        ["Efreeti's Fury", "efreeti"], ["Elemental Strike: Marid’s Surge", "marid"]]) {
        for (const [properties, expectedTurn] of [
            [{ "Action Type": "Bonus Action" }, ["bonusAction"]],
            [{ "Activation Time": "1 Action" }, ["action"]],
            [{}, []]
        ]) {
            const ctx = createSandbox({ features: FEATURE, smiteOptions: SMITE_OPTIONS });
            const outcome = await run(ctx, "wayBeyond20RollPaladinSpecialAction")(name, "Elemental Strike", "Native description text.", properties);
            assert.equal(outcome.handled, true, `${name} is handled before the attack branch`);
            assert.equal(outcome.result, true);
            const { rollType, request } = ctx.log.dispatched[0];
            assert.equal(ctx.log.sendRollCalls, 1);
            assert.deepEqual(ctx.log.turnSpends, expectedTurn, `${name} ${JSON.stringify(properties)}: cost from its own entry`);
            assert.deepEqual(ctx.log.limitedUseSpends, ["Channel Divinity"]);
            assert.equal(ctx.log.buildSmiteOptionsCalls, 0, `${name}: no Divine Smite offer`);
            assert.deepEqual(titles(ctx), [], `${name}: no duplicate chooser`);
            assert.equal(request["to-hit"], undefined, `${name}: not an attack roll`);
            assert.equal(request.description, "Native description text.", `${name}: native description preserved`);
            assert.equal(request.name, name, `${name}: native name preserved`);
            assert.deepEqual(request["feature-results"], [{ name: NAME[key], text: RESULT_TEXT[key] }]);
            assert.ok(request.effects.includes(`Channel Divinity: ${NAME[key]}`));
            assert.ok(!request.effects.some(effect => effect.includes("part of Divine Smite")));
            assert.equal(rollType, key === "efreeti" ? "spell-attack" : "trait");
            if (key === "efreeti") assert.deepEqual(request.damages, ["2d4", "2d4"]);
            if (key === "marid") assert.equal(request["save-ability"], "Strength");
            assert.deepEqual(ctx.log.selfEffects, key === "djinni" ? ["Djinni’s Escape"] : []);
        }
    }
    {
        const cancelled = createSandbox({ features: FEATURE, preflightAllowed: false });
        const outcome = await run(cancelled, "wayBeyond20RollPaladinSpecialAction")("Djinni’s Escape", "Elemental Strike", "", { "Action Type": "Bonus Action" });
        assert.equal(outcome.result, null);
        assert.deepEqual(cancelled.log.turnSpends, []);
        assert.deepEqual(cancelled.log.limitedUseSpends, []);
        assert.deepEqual(cancelled.log.selfEffects, []);
        const unrelated = createSandbox({ features: FEATURE });
        assert.equal((await run(unrelated, "wayBeyond20RollPaladinSpecialAction")("Longsword", "", "", {})).handled, false);
    }

    // 8. Parent Elemental Strike row: the same chooser; a click performs that option on the
    //    independent route with the parent row's own activation and native description.
    for (const parentName of ["Elemental Strike", "Channel Divinity: Elemental Strike", "Elemental Smite"]) {
        for (const key of ["dao", "djinni", "efreeti", "marid"]) {
            const ctx = createSandbox({ features: FEATURE, smiteOptions: SMITE_OPTIONS, answers: [click(key, key)] });
            const outcome = await run(ctx, "wayBeyond20RollPaladinSpecialAction")(parentName, "Oath of the Noble Genies", "Native heading and intro. Four options.", { "Action Type": "Bonus Action" });
            assert.equal(outcome.handled, true, `${parentName} handled before the attack branch`);
            assert.equal(outcome.result, true);
            assert.deepEqual(titles(ctx), ["Elemental Strike"], `${parentName}: one chooser`);
            assertChooser(ctx, "independent");
            const { rollType, request } = ctx.log.dispatched[0];
            assert.equal(ctx.log.sendRollCalls, 1, `${parentName}/${key}: one post despite a double-click`);
            assert.equal(request.name, `${parentName}: ${NAME[key]}`);
            assert.equal(request.description, "Native heading and intro. Four options.");
            assert.deepEqual(request["feature-results"], [{ name: NAME[key], text: RESULT_TEXT[key] }]);
            assert.deepEqual(ctx.log.turnSpends, ["bonusAction"], "parent row's own activation");
            assert.deepEqual(ctx.log.limitedUseSpends, ["Channel Divinity"]);
            assert.equal(ctx.log.buildSmiteOptionsCalls, 0, "no Divine Smite offer");
            assert.equal(request["to-hit"], undefined);
            assert.equal(rollType, key === "efreeti" ? "spell-attack" : "trait");
            assert.ok(!request.effects.some(effect => effect.includes("part of Divine Smite")));
        }
        const cancelled = createSandbox({ features: FEATURE, answers: [CANCEL] });
        const outcome = await run(cancelled, "wayBeyond20RollPaladinSpecialAction")(parentName, "", "", { "Action Type": "Bonus Action" });
        assert.deepEqual(clone(outcome), { handled: true, result: null }, `${parentName}: Cancel`);
        assert.equal(cancelled.log.sendRollCalls, 0);
        assert.deepEqual(cancelled.log.turnSpends, []);
        assert.deepEqual(cancelled.log.limitedUseSpends, []);
    }
    for (const name of ["Elemental Rebuke", "Elemental Strikes Extra", "Dao’s Crush"]) {
        const ctx = createSandbox({ features: FEATURE });
        assert.equal(run(ctx, "wayBeyond20IsElementalStrikeParent")(name), false, `${name} is not the parent row`);
    }

    // 9. Dialog reuse: after the chooser, the next prompt shows its confirm button again and a
    //    Smite prompt's Proceed lock still works.
    {
        const dialog = createDialogHarness();
        const pending = dialog.prompter.prompt("Elemental Strike",
            '<form class="waybeyond20-elemental-strike-query"><div><button type="button" class="waybeyond20-elemental-strike-button" data-elemental-strike="dao" title="t">Dao’s Crush</button></div></form>', "Choose", "Cancel");
        assert.equal(dialog.okButton.style.display, "none");
        dialog.click("dao");
        assert.equal((await pending).attr("data-selected"), "dao");
        assert.deepEqual(dialog.dialogLog.callbacks, [1], "close ran the cancel callback after the choice resolved");
        const generic = dialog.prompter.prompt("Custom Skill", "<form class=\"other\"></form>", "Roll", "Cancel");
        assert.equal(dialog.okButton.style.display, "", "a following prompt shows its confirm button");
        assert.equal(dialog.okButton.disabled, false);
        dialog.pressEnter();
        assert.ok(await generic, "the following prompt resolves normally");
        assert.ok(commonUtilsSource.includes("const smiteForm = this.elements.content.querySelector(\"form.waybeyond20-smite-query\")"), "Smite lock logic kept");
    }

    // 10. Renderer rows and Roll20 text, plus wiring the harness cannot execute without the D&D Beyond DOM.
    {
        const methodSource = between(rendererSource, "    featureResultInfo(request) {", "\n    }\n");
        const featureResultInfo = new Function("request", methodSource.slice(methodSource.indexOf("{") + 1));
        assert.deepEqual(featureResultInfo({ "feature-results": [{ name: NAME.dao, text: RESULT_TEXT.dao }, null, { name: "x" }] }), [[NAME.dao, RESULT_TEXT.dao]]);
        assert.deepEqual(featureResultInfo({}), []);
        const rollTrait = between(rendererSource, "    rollTrait(request) {", "\n    }\n");
        const rollAttack = between(rendererSource, "    async rollAttack(request, custom_roll_dice = \"\") {", "\n    }\n");
        const rollSpellAttack = between(rendererSource, "    async rollSpellAttack(request, custom_roll_dice) {", "\n    }\n");
        for (const [label, body] of [["trait", rollTrait], ["attack", rollAttack], ["spell-attack", rollSpellAttack]]) {
            assert.match(body, /this\.featureResultInfo\(request\)/, `${label} card shows the readable result row`);
        }
        const roll20 = vm.createContext({ template: (request, name, properties) => properties.desc });
        vm.runInContext(topLevelFunction(roll20Source, "displayExtraInfo"), roll20);
        const extra = vm.runInContext("displayExtraInfo", roll20)({ "feature-results": [{ name: NAME.marid, text: RESULT_TEXT.marid }], effects: ["Channel Divinity: Marid’s Surge"] });
        assert.ok(extra.includes(`${NAME.marid}: ${RESULT_TEXT.marid}`), "Roll20 native template shows the readable result");

        const rollSpell = topLevelFunction(characterSource, "rollSpell");
        const conflicts = rollSpell.indexOf("wayBeyond20ConfirmCastingConflicts(spell_name");
        const rider = rollSpell.indexOf("wayBeyond20MaybeAddElementalStrike(roll_properties, spell_name)");
        assert.ok(conflicts !== -1 && rider > conflicts, "direct Divine Smite cast offers the chooser after the casting warning");
        assert.ok(rider < rollSpell.indexOf('sendRollWithCharacter("spell-attack"'), "rider is attached before dispatch");
        assert.match(rollSpell, /if \(!force_display\) await wayBeyond20MaybeAddElementalStrike/);
        const rollAction = topLevelFunction(characterSource, "rollAction");
        assert.ok(rollAction.indexOf("wayBeyond20RollPaladinSpecialAction(") < rollAction.indexOf("wayBeyond20MaybeAddSmite("),
            "parent and option rows are handled before the attack/Smite branch");
        assert.doesNotMatch(characterSource, /selection\.fuel\.type !== "paladin-smite"/, "fuel no longer gates the rider");
        for (const name of ["wayBeyond20HasElementalStrike", "wayBeyond20ApplyElementalStrikeEffect",
            "wayBeyond20MaybeAddElementalStrike", "wayBeyond20RollElementalStrikeOption", "wayBeyond20RollElementalStrikeParent"]) {
            assert.doesNotMatch(topLevelFunction(characterSource, name), /hasClass\(|getClassLevel\(|Paladin"/, `${name} is not class-gated`);
        }
    }

    console.log("v1.65 Elemental Strike checks passed.");
})().catch(error => {
    console.error(error);
    process.exit(1);
});
