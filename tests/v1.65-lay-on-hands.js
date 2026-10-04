// Lay on Hands redesign (Bill's specification, 2026-09-15). Features & Traits shows
// "Lay On Hands: Heal: 1 Bonus Action" and "Lay On Hands: Purify Poison: 1 Bonus Action"; each
// option name becomes a pill button that opens WayBeyond20's own window (never a browser prompt):
//   Heal: an amount box prefilled with the pool's remaining points, [−]/[+], and
//         "Confirm Heal on Self" / "Confirm Heal on Other" / Cancel.
//   Purify Poison: a fixed 5 points, the same two confirms and Cancel.
// Self applies the healing through D&D Beyond's own Heal control (or removes Poisoned with its own
// toggle); Other does the housekeeping only. Both send the card, reduce the pool and spend the
// Bonus Action, and only after a successful dispatch.
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { h, createDocument, miniJQuery, TEXT_NODE } = require("./helpers/mini-dom");

const root = process.env.WB20_SOURCE_ROOT ? path.resolve(process.env.WB20_SOURCE_ROOT) : path.resolve(__dirname, "..");
const read = relative => fs.readFileSync(path.join(root, ...relative.split("/")), "utf8");
const characterSource = read("src/dndbeyond/content-scripts/character.js");
const commonUtilsSource = read("src/common/utils.js");
const settingsSource = read("src/common/settings.js");
// The real RollType class, so the roll-mode assertion compares against the real value.
const ROLL_TYPE_CLASS = settingsSource.slice(settingsSource.indexOf("class RollType {"),
    settingsSource.indexOf("\n}\n", settingsSource.indexOf("class RollType {")) + 3);

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
const tick = (ms = 0) => new Promise(resolve => setTimeout(resolve, ms));
const LAY_ON_HANDS_CONSTANTS = between(characterSource, "const WAYBEYOND20_LAY_ON_HANDS_POOL", "function wayBeyond20LayOnHandsKind(");
const LAY_ON_HANDS_PILLS = between(characterSource, "const WAYBEYOND20_LAY_ON_HANDS_PILLS", "function wayBeyond20InjectLayOnHandsControls(");

const results = [];
// A flow that waits forever (for example a second window) must fail the run, not end it quietly.
let reported = false;
process.on("exit", () => {
    if (!reported) {
        console.log("WayBeyond20 Lay on Hands checks did not finish: a flow never settled.");
        process.exitCode = 1;
    }
});
async function section(name, fn) {
    try {
        await fn();
        results.push({ name, ok: true });
    } catch (error) {
        results.push({ name, ok: false, error });
    }
}

// ---- 1. The window's form wiring (common/utils.js) -----------------------------------------
function wireForm(form) {
    const context = { console };
    vm.createContext(context);
    vm.runInContext(topLevelFunction(commonUtilsSource, "wayBeyond20WireLayOnHandsForm"), context);
    const okButton = { style: {} };
    const log = { resolved: [], closes: 0 };
    vm.runInContext("wayBeyond20WireLayOnHandsForm", context)(form, {
        okButton,
        resolve: resolved => log.resolved.push({
            selected: resolved.getAttribute("data-selected"),
            healing: resolved.getAttribute("data-healing"),
            purify: resolved.getAttribute("data-purify")
        }),
        close: () => { log.closes++; }
    });
    return { okButton, log };
}

function layOnHandsForm(pool = 15, { start = "healing" } = {}) {
    // Mirrors wayBeyond20LayOnHandsQueryHtml: pill options, a healing amount panel, a purify note,
    // and the two confirms. Section 4 asserts the generated HTML carries these same hooks.
    const input = h("input", { type: "number", name: "lay-on-hands-amount" });
    input.value = String(Math.max(1, pool));
    const option = (key, label) => h("button", {
        type: "button",
        class: "waybeyond20-lay-on-hands-option" + (key === start ? " waybeyond20-lay-on-hands-option-selected" : ""),
        "data-lay-on-hands-option": key,
        "data-cost": key === "purify" ? "5" : "amount",
        "aria-pressed": key === start ? "true" : "false"
    }, label);
    const healing = option("healing", "Healing");
    const purify = option("purify", "Purify Poison");
    const remaining = h("span", { "data-lay-on-hands-remaining": "" }, String(pool));
    const amountPanel = h("div", { class: "waybeyond20-lay-on-hands-amount", "data-for-option": "healing" },
        h("button", { type: "button", "data-lay-on-hands-step": "-1" }, "−"),
        input,
        h("button", { type: "button", "data-lay-on-hands-step": "1" }, "+"));
    const purifyNote = h("p", { class: "waybeyond20-lay-on-hands-note", "data-for-option": "purify" }, "Spends 5 points");
    const form = h("form", {
        class: "waybeyond20-lay-on-hands-query", "data-kind": "heal",
        "data-pool": String(pool), "data-purify-cost": "5"
    },
        h("p", { class: "waybeyond20-lay-on-hands-pool" }, remaining),
        h("div", { class: "waybeyond20-lay-on-hands-options" }, healing, purify),
        amountPanel,
        purifyNote,
        h("p", { class: "waybeyond20-lay-on-hands-error" }),
        h("div", {},
            h("button", { type: "button", "data-lay-on-hands-target": "self" }, "Confirm on Self"),
            h("button", { type: "button", "data-lay-on-hands-target": "other" }, "Confirm on Other")));
    const pick = selector => form.querySelector(selector);
    // Typing in a browser fires `input`; the shim needs it dispatched explicitly.
    const type = value => {
        input.value = String(value);
        input.dispatchEvent({ type: "input", target: input, preventDefault() {} });
    };
    return {
        form, input, healing, purify, remaining, amountPanel, purifyNote, type,
        minus: pick("button[data-lay-on-hands-step='-1']"),
        plus: pick("button[data-lay-on-hands-step='1']"),
        self: pick("button[data-lay-on-hands-target='self']"),
        other: pick("button[data-lay-on-hands-target='other']"),
        error: pick(".waybeyond20-lay-on-hands-error")
    };
}

// ---- 2. Flow sandbox: the real Lay on Hands, dispatch and turn-resource code ----------------
const FLOW_FUNCTIONS = [
    "sendRollWithCharacter", "wayBeyond20DispatchRollWithCharacter", "wayBeyond20RestoreCharacterSheetTab", "addEffect",
    "wayBeyond20ActivationResource", "wayBeyond20AttachTurnResource", "wayBeyond20AttachActivationResource",
    "wayBeyond20AttachLimitedUse", "wayBeyond20NormalizeFeatureLabel", "wayBeyond20PaladinSaveDC",
    "wayBeyond20RollIsUnarmedStrike", "wayBeyond20NormalizeAttackSemantics", "wayBeyond20ApplyDrainingAttackIntent",
    "wayBeyond20ElementalStrikeChoice", "wayBeyond20IsElementalStrikeParent",
    "wayBeyond20LayOnHandsKind", "wayBeyond20LayOnHandsQueryHtml", "wayBeyond20QueryLayOnHands",
    "wayBeyond20CurrentHitPoints",
    "wayBeyond20RollLayOnHands", "wayBeyond20PerformLayOnHands", "wayBeyond20RollPaladinSpecialAction"
];

function createFlowSandbox({ pool = 15, answers = [], sendResult = true, poisoned = false, confirm = true,
    healingApplied = true, conditionRemoved = true, holdPrompt = false, helperEnabled = true } = {}) {
    const log = { prompts: [], dispatched: [], turnSpends: [], poolSpends: [], heals: [], removals: [],
        confirms: [], warnings: [], order: [], sendRollCalls: 0 };
    let releasePrompt = null;
    const character = {
        _id: 111, _name: "Test Paladin", _proficiency: 2, _spell_saves: { Paladin: 12 },
        hasClassFeature: () => false, hasAction: () => false, hasRacialTrait: () => false, hasFeat: () => false,
        getAbility: () => ({ mod: 2 }),
        getSetting: (key, fallback) => fallback,
        getGlobalSetting: (key, fallback) => fallback,
        mergeCharacterSettings() {}
    };
    const context = {
        console, Promise, setTimeout, character, settings: {}, log,
        window: { prompt: () => { throw new Error("window.prompt must not be used"); } },
        alertify: { warning: message => log.warnings.push(message) },
        $: () => ({ css: () => undefined }),
        dndbeyondDiceRoller: {
            _prompter: {
                prompt: async (title, html, ok, cancel) => {
                    log.prompts.push({ title, html, ok, cancel });
                    if (holdPrompt) await new Promise(resolve => { releasePrompt = resolve; });
                    const answer = answers.shift();
                    if (!answer) return null;
                    const attributes = {
                        "data-selected": answer.target,
                        "data-healing": answer.healing === undefined ? "0" : String(answer.healing),
                        "data-purify": answer.purify ? "1" : "0"
                    };
                    return { attr: name => attributes[name] };
                }
            }
        },
        wayBeyond20CharacterHelperEnabled: () => helperEnabled,
        wayBeyond20FindNumericFeaturePool: heading => ({ current: pool, heading }),
        wayBeyond20SpendNumericFeaturePool: async (heading, amount) => { log.poolSpends.push([heading, amount]); log.order.push("pool"); return true; },
        wayBeyond20ApplyHealingToSelf: async (amount, options) => { log.heals.push({ amount, source: options && options.source }); log.order.push("heal"); return { applied: healingApplied }; },
        wayBeyond20RemoveConditionFromSelf: async name => { log.removals.push(name); log.order.push("condition"); return { wasPresent: poisoned, removed: conditionRemoved }; },
        wayBeyond20SelfHasCondition: () => poisoned,
        wayBeyond20ConfirmChoice: async (title, message) => { log.confirms.push({ title, message }); return confirm; },
        wayBeyond20CharacterDebug() {},
        wayBeyond20PreflightLimitedUse: async () => ({ allowed: true, tracked: true }),
        wayBeyond20SpendLimitedUse: async () => true,
        wayBeyond20PreflightTurnResource: async () => true,
        wayBeyond20SpendTurnResource: resource => { log.turnSpends.push(resource); log.order.push(`turn:${resource}`); },
        wayBeyond20SpendSpellSlot: async () => true,
        wayBeyond20SpendPaladinSmiteFreeUse: async () => true,
        wayBeyond20TrackSelfFeatureEffect() {},
        wayBeyond20RemoveTrackedEffect() {},
        wayBeyond20SetIntrusionDie() {},
        wayBeyond20GetTrackedSpellEffects: () => [],
        wayBeyond20EffectName: () => "",
        wayBeyond20ChooseElementalDamageType: () => { throw new Error("unexpected Elemental Rebuke"); },
        sendRoll: async (char, rollType, fallback, request) => {
            log.sendRollCalls++;
            log.order.push("dispatch");
            if (sendResult !== true) return sendResult;
            log.dispatched.push({ rollType, fallback, request: clone(request) });
            return true;
        }
    };
    vm.createContext(context);
    vm.runInContext([
        ROLL_TYPE_CLASS,
        between(characterSource, "const WAYBEYOND20_ELEMENTAL_STRIKE_CHOICES", "function wayBeyond20ElementalStrikeChoice("),
        LAY_ON_HANDS_CONSTANTS,
        ...FLOW_FUNCTIONS.map(name => topLevelFunction(characterSource, name))
    ].join("\n"), context);
    context.release = () => releasePrompt && releasePrompt();
    return context;
}

const run = (context, expression) => vm.runInContext(expression, context);
const roll = (context, name, properties = { "Action Type": "1 Bonus Action" }) =>
    run(context, "wayBeyond20RollLayOnHands")(name, "Lay on Hands text", properties);
const lastCard = context => context.log.dispatched[context.log.dispatched.length - 1];

// ---- 3. Mini-DOM sandbox for the sheet-facing helpers ----------------------------------------
const DOM_FUNCTIONS = [
    "wayBeyond20NormalizeFeatureLabel", "wayBeyond20ElementOwnText", "wayBeyond20IsVisibleElement",
    "wayBeyond20SetReactInputValue", "wayBeyond20NativeClick",
    "wayBeyond20CurrentHitPoints", "wayBeyond20FindHitPointsAdjuster", "wayBeyond20NotifyHealingReceived",
    "wayBeyond20ApplyHealingToSelf", "wayBeyond20SelfHasCondition", "wayBeyond20FindConditionToggle",
    "wayBeyond20ConditionToggleIsOn", "wayBeyond20RemoveConditionFromSelf",
    "wayBeyond20ActionSummaryParts", "wayBeyond20FindNumericFeaturePool", "wayBeyond20InjectLayOnHandsControls"
];

// The extension ships jQuery 3.4, whose selector engine throws on the case-insensitive attribute
// flag ("[attr*='x' i]") in .find(); native querySelector accepts it. Model that, because the
// mini-DOM would otherwise hide it (live, 2026-09-17: the pool finder threw on the Heal click).
function strictJQuery(input) {
    const wrapper = miniJQuery(input);
    const guard = method => {
        const original = wrapper[method];
        wrapper[method] = selector => {
            if (typeof selector === "string" && /\s[iI]\s*\]/.test(selector)) {
                throw new Error(`jQuery rejects the case-insensitive attribute flag: ${selector}`);
            }
            return strictJQuery(original(selector));
        };
    };
    guard("find");
    guard("closest");
    const first = wrapper.first;
    wrapper.first = () => strictJQuery(first());
    return wrapper;
}

function createDomSandbox({ hp = 20, maxHp = 28, helperEnabled = true } = {}) {
    const document = createDocument();
    const events = [];
    document.dispatchEvent = event => { events.push(event); return true; };
    const model = { hp, maxHp };
    const character = {
        _hp: hp, _max_hp: maxHp,
        updateHP() { this._hp = model.hp; this._max_hp = model.maxHp; }
    };
    class FakeEvent { constructor(type, init = {}) { this.type = type; Object.assign(this, init); } }
    const log = { rolls: [] };
    const context = {
        console, Promise, setTimeout, document, character, log, events,
        wayBeyond20CharacterHelperEnabled: () => helperEnabled,
        Node: { TEXT_NODE },
        Event: FakeEvent, InputEvent: FakeEvent, KeyboardEvent: FakeEvent, MouseEvent: FakeEvent,
        CustomEvent: class extends FakeEvent { constructor(type, init = {}) { super(type); this.detail = init.detail; } },
        HTMLInputElement: function HTMLInputElement() {},
        $: strictJQuery,
        wayBeyond20CharacterDebug() {},
        wayBeyond20ParseInteger: value => { const match = String(value ?? "").match(/-?\d+/); return match ? parseInt(match[0]) : null; },
        wayBeyond20RollLayOnHands: (name, description, properties) => { log.rolls.push({ name, description, properties: clone(properties) }); return Promise.resolve(true); }
    };
    context.HTMLInputElement.prototype = {};
    vm.createContext(context);
    vm.runInContext([
        LAY_ON_HANDS_PILLS,
        ...DOM_FUNCTIONS.map(name => topLevelFunction(characterSource, name))
    ].join("\n"), context);
    return { context, document, model, events, log };
}

// D&D Beyond's Hit Points box: Heal, the adjustment input, Damage (as read live on 2026-09-17).
function hitPointsBox(sandbox, { respond = true } = {}) {
    const input = h("input", { type: "number", "aria-label": "Hit Points Adjustment" });
    input.value = "";
    const heal = h("button", {}, "Heal");
    const damage = h("button", {}, "Damage");
    heal.addEventListener("click", () => {
        if (!respond) return;
        const amount = parseInt(input.value) || 0;
        sandbox.model.hp = Math.min(sandbox.model.maxHp, sandbox.model.hp + amount);
    });
    sandbox.document.body.append(h("div", { class: "hp-box" }, h("h1", {}, "Hit Points"), h("div", { class: "controls" }, heal, input, damage)));
    return { input, heal };
}

// The Conditions summary on the sheet and D&D Beyond's Conditions pane with its Poisoned toggle.
function conditions(sandbox, { active = true, paneOpen = true, toggleResponds = true, openOnSummaryClick = true } = {}) {
    const doc = sandbox.document;
    const summary = h("div", { class: "conditions-summary" });
    doc.body.append(summary);
    const state = { active, clicks: 0 };
    const renderSummary = () => {
        summary.replaceChildren(...(state.active ? [h("span", { class: "ddbc-condition__name" }, "Poisoned")] : [h("span", {}, "Add Active Conditions")]));
        const entry = summary.querySelector(".ddbc-condition__name");
        if (entry && openOnSummaryClick) entry.addEventListener("click", () => openPane());
    };
    let pane = null;
    const openPane = () => {
        if (pane) return;
        const toggle = h("button", { "aria-pressed": String(state.active), "aria-label": "Enable Poisoned" });
        toggle.addEventListener("click", () => {
            state.clicks++;
            if (!toggleResponds) return;
            state.active = !state.active;
            toggle.setAttribute("aria-pressed", String(state.active));
            renderSummary();
        });
        pane = h("div", { class: "ct-condition-manage-pane" },
            h("div", { class: "ct-condition-manage-pane__condition" },
                h("div", { class: "ct-condition-manage-pane__condition-name" }, "Blinded"),
                h("div", {}, h("button", { "aria-pressed": "false", "aria-label": "Enable Blinded" }))),
            h("div", { class: "ct-condition-manage-pane__condition" },
                h("div", { class: "ct-condition-manage-pane__condition-name" }, "Poisoned"),
                h("div", { class: "ct-condition-manage-pane__condition-toggle" }, toggle)));
        doc.body.append(pane);
    };
    renderSummary();
    if (paneOpen) openPane();
    return state;
}

// Features & Traits: the Lay On Hands feature with its three action summaries (live markup,
// 2026-09-17) and the pool's value and decrease control.
function featuresTab(sandbox, { poolValue = 15 } = {}) {
    const summary = text => h("div", { class: "ct-feature-snippet__action-summary " }, text);
    const heal = summary("Lay On Hands: Heal: 1 Bonus Action");
    const purify = summary("Lay On Hands: Purify Poison: 1 Bonus Action");
    const poolSummary = summary("Lay On Hands: Healing Pool: 1 Bonus Action");
    const other = summary("Channel Divinity: Divine Sense: 1 Bonus Action");
    const decrease = h("button", { class: "button-action-decrease" });
    const snippet = h("div", { class: "ct-feature-snippet" },
        h("div", { class: "ct-feature-snippet__heading" }, "Lay On Hands"),
        h("div", { class: "ct-feature-snippet__content" }, h("p", {}, "Your blessed touch can heal wounds.")),
        h("div", { class: "ct-feature-snippet__action" }, poolSummary,
            h("div", { class: "ct-slot-manager-large" }, decrease,
                h("div", { class: "ct-slot-manager-large__value ct-slot-manager-large__value--cur" }, String(poolValue)))),
        h("div", { class: "ct-feature-snippet__action" }, heal),
        h("div", { class: "ct-feature-snippet__action" }, purify),
        h("div", { class: "ct-feature-snippet__action" }, other));
    sandbox.document.body.append(snippet);
    return { heal, purify, poolSummary, other, decrease };
}

const lineOf = summary => summary.children.find(child => child.classList.contains("waybeyond20-loh-line")) || null;

(async () => {
    await section("1. Window: the pool preview tracks the allocation and the steppers respect it", async () => {
        const f = layOnHandsForm(15);
        const { okButton } = wireForm(f.form);
        assert.equal(okButton.style.display, "none", "footer confirm hidden; the two confirms replace it");
        assert.equal(f.remaining.textContent, "0", "15 healing allocated leaves nothing");
        f.input.value = "7";
        f.minus.click();
        assert.equal(f.input.value, "6");
        assert.equal(f.remaining.textContent, "9", "the preview follows the amount");
        f.purify.click();
        assert.equal(f.remaining.textContent, "4", "Purify Poison takes 5 more");
        f.plus.click();
        assert.equal(f.input.value, "7");
        assert.equal(f.remaining.textContent, "3");
        f.input.value = "1"; f.minus.click();
        assert.equal(f.input.value, "1", "− stops at 1");
        f.input.value = "40"; f.plus.click();
        assert.equal(f.input.value, "10", "+ cannot take points already promised to Purify Poison");
    });

    await section("1b. Bill's screenshot: a full pool opens from Heal with Purify Poison selectable, not greyed", async () => {
        // 1.65.3 prefilled healing with the whole pool and then disabled Purify because nothing was
        // "unallocated", so on a full pool Purify opened greyed out every time (Bill, live,
        // 2026-10-04). Purify must be offered whenever the pool can pay for it.
        const f = layOnHandsForm(15);
        wireForm(f.form);
        assert.equal(f.input.value, "15", "healing is prefilled with the whole pool");
        assert.equal(f.purify.disabled, false, "Purify Poison is selectable on a full pool");
        f.purify.click();
        assert.equal(f.purify.getAttribute("aria-pressed"), "true");
        assert.equal(f.input.value, "10", "choosing Purify makes room for itself: healing trims to pool - 5");
        assert.equal(f.remaining.textContent, "0", "10 healing + 5 Purify uses the whole pool");
        f.plus.click();
        assert.equal(f.input.value, "10", "healing cannot climb back into Purify's 5 points");
    });

    await section("1c. The option just chosen takes priority on small pools", async () => {
        const five = layOnHandsForm(5);
        wireForm(five.form);
        assert.equal(five.purify.disabled, false, "a 5-point pool can afford Purify");
        five.purify.click();
        assert.equal(five.healing.getAttribute("aria-pressed"), "false", "nothing is left for healing, so Healing switches off");
        assert.equal(five.remaining.textContent, "0");
        five.healing.click();
        assert.equal(five.purify.getAttribute("aria-pressed"), "false", "choosing Healing back turns Purify off in turn");
        assert.equal(five.input.value, "5");

        const four = layOnHandsForm(4);
        wireForm(four.form);
        assert.equal(four.purify.disabled, true, "a 4-point pool can never afford it");

        const fromPurify = layOnHandsForm(15, { start: "purify" });
        wireForm(fromPurify.form);
        fromPurify.healing.click();
        assert.equal(fromPurify.input.value, "10", "adding Healing to a Purify touch is capped at pool - 5");
        assert.equal(fromPurify.purify.getAttribute("aria-pressed"), "true", "Purify stays selected");
    });

    await section("2. A confirm resolves once with the target and the allocation, then closes", async () => {
        const f = layOnHandsForm(15);
        const { log } = wireForm(f.form);
        f.type(7);
        f.purify.click();
        f.self.click();
        f.self.click();
        f.other.click();
        assert.deepEqual(log.resolved, [{ selected: "self", healing: "7", purify: "1" }]);
        assert.equal(log.closes, 1);
        assert.ok(f.plus.disabled && f.self.disabled && f.other.disabled, "buttons disabled after the choice");
    });

    await section("3. Either option alone is a valid touch; neither is not", async () => {
        const healOnly = layOnHandsForm(15);
        const a = wireForm(healOnly.form);
        healOnly.type(4);
        healOnly.self.click();
        assert.deepEqual(a.log.resolved, [{ selected: "self", healing: "4", purify: "0" }]);

        const purifyOnly = layOnHandsForm(15, { start: "purify" });
        const b = wireForm(purifyOnly.form);
        assert.equal(purifyOnly.healing.getAttribute("aria-pressed"), "false", "the Purify pill opens with Healing off");
        purifyOnly.other.click();
        assert.deepEqual(b.log.resolved, [{ selected: "other", healing: "0", purify: "1" }],
            "Purify Poison on its own carries no healing");

        const none = layOnHandsForm(15);
        const c = wireForm(none.form);
        none.healing.click();
        none.self.click();
        assert.equal(c.log.resolved.length, 0);
        assert.match(none.error.textContent, /Choose Healing, Purify Poison, or both/);
    });

    await section("3b. A bad typed amount is refused while Healing is selected", async () => {
        const f = layOnHandsForm(15);
        const { log } = wireForm(f.form);
        f.input.value = "abc"; f.self.click();
        assert.equal(log.resolved.length, 0);
        assert.match(f.error.textContent, /whole number/);
        f.input.value = "0"; f.other.click();
        assert.equal(log.resolved.length, 0, "0 is not a heal");
        f.minus.click();
        assert.equal(f.error.textContent, "", "a step clears the error");
    });

    await section("4. Window HTML: pool preview, pill options, amount panel and the hooks the wiring needs", async () => {
        const ctx = createFlowSandbox();
        const html = run(ctx, "wayBeyond20LayOnHandsQueryHtml");
        const heal = html("heal", { current: 12 });
        assert.match(heal, /^<form class="waybeyond20-lay-on-hands-query" data-kind="heal" data-pool="12" data-purify-cost="5">/);
        assert.match(heal, /data-lay-on-hands-remaining>12<\/span> left/);
        assert.match(heal, /data-lay-on-hands-option="healing"[^>]*aria-pressed="false"/);
        assert.match(heal, /data-lay-on-hands-option="purify"[^>]*aria-pressed="false"/);
        assert.doesNotMatch(heal, /type="radio"/, "pill buttons, not radio buttons");
        assert.match(heal, /<input type="number" name="lay-on-hands-amount" min="1" step="1" value="1"/);
        assert.match(heal, /data-lay-on-hands-step="-1"/);
        assert.match(heal, /data-lay-on-hands-step="1"/);
        assert.match(heal, />Confirm on Self</);
        assert.match(heal, />Confirm on Other</);
        assert.match(heal, /waybeyond20-lay-on-hands-error/);

        const purify = html("purify", { current: 15 }, { poisoned: false });
        assert.match(purify, /data-lay-on-hands-option="purify"[^>]*aria-pressed="false"/,
            "the Purify pill opens with no option pre-allocated");
        assert.match(purify, /do not have the Poisoned condition yourself/);
        assert.doesNotMatch(html("purify", { current: 15 }, { poisoned: true }), /do not have the Poisoned/);

        const unknown = html("heal", { current: null });
        assert.match(unknown, /can't see the Lay on Hands pool/);
    });

    await section("5. Heal on Self: one card, then the real heal, the pool and the Bonus Action — after dispatch", async () => {
        const ctx = createFlowSandbox({ answers: [{ target: "self", healing: 7 }] });
        assert.equal(await roll(ctx, "Lay On Hands: Heal"), true);
        assert.equal(ctx.log.prompts.length, 1);
        assert.equal(ctx.log.prompts[0].title, "Lay On Hands");
        const card = lastCard(ctx);
        assert.equal(card.rollType, "spell-attack");
        assert.equal(card.request.name, "Lay On Hands: Heal");
        assert.deepEqual(card.request.damages, ["7"]);
        assert.deepEqual(card.request["damage-types"], ["Healing"]);
        // Live 2026-09-17: without rollDamage the card posted with no Healing row.
        assert.equal(card.request.rollDamage, true, "the Healing row is rolled and shown");
        assert.equal(card.request.rollAttack, false);
        assert.ok(card.request.effects.includes("On self"));
        assert.deepEqual(ctx.log.heals, [{ amount: 7, source: "Lay On Hands: Heal" }]);
        assert.deepEqual(ctx.log.poolSpends, [["Lay On Hands: Healing Pool", 7]]);
        assert.deepEqual(ctx.log.turnSpends, ["bonusAction"]);
        assert.deepEqual(ctx.log.order, ["dispatch", "turn:bonusAction", "heal", "pool"]);
        assert.deepEqual(ctx.log.warnings, []);
    });

    await section("5b. One touch, one Bonus Action: healing and Purify Poison allocated together", async () => {
        // 03-DECISIONS, Bill 2026-10-04: one Lay On Hands use is one touch and one Bonus Action,
        // and the player allocates the pool across the options inside it. The 5 Purify points
        // restore no Hit Points.
        const ctx = createFlowSandbox({ answers: [{ target: "self", healing: 10, purify: true }], poisoned: true });
        assert.equal(await roll(ctx, "Lay On Hands: Heal"), true);
        const card = lastCard(ctx);
        assert.equal(card.request.name, "Lay On Hands: Heal and Purify Poison");
        assert.deepEqual(card.request.damages, ["10"], "only the healing restores Hit Points");
        assert.ok(card.request.effects.some(effect => /Removes the Poisoned condition/.test(effect)),
            "the card reports each selected effect");
        assert.ok(card.request.effects.includes("On self"));
        assert.deepEqual(ctx.log.heals, [{ amount: 10, source: "Lay On Hands: Heal and Purify Poison" }]);
        assert.deepEqual(ctx.log.removals, ["Poisoned"]);
        assert.deepEqual(ctx.log.poolSpends, [["Lay On Hands: Healing Pool", 15]], "10 healed plus 5 for the condition");
        assert.deepEqual(ctx.log.turnSpends, ["bonusAction"], "one touch is one Bonus Action");
    });

    await section("5c. A combined touch that outruns the pool still advises rather than blocks", async () => {
        const ctx = createFlowSandbox({ pool: 12, answers: [{ target: "self", healing: 10, purify: true }], confirm: false });
        assert.equal(await roll(ctx, "Lay On Hands: Heal"), null);
        assert.match(ctx.log.confirms[0].message, /needs 15 points, but D&D Beyond shows 12/);
        assert.deepEqual(ctx.log.poolSpends, [], "declining spends nothing");
        assert.deepEqual(ctx.log.turnSpends, []);
    });

    await section("5d. The per-character helper switch hides the window and the pills", async () => {
        const off = createFlowSandbox({ helperEnabled: false, answers: [{ target: "self", healing: 7 }] });
        assert.equal(await roll(off, "Lay On Hands: Heal"), null, "no window, nothing sent");
        assert.deepEqual(off.log.prompts, []);
        assert.deepEqual(off.log.poolSpends, []);
        assert.deepEqual(off.log.turnSpends, []);

        const sandbox = createDomSandbox({ helperEnabled: false });
        const tab = featuresTab(sandbox);
        run(sandbox.context, "wayBeyond20InjectLayOnHandsControls")();
        assert.equal(lineOf(tab.heal), null, "no pill injected while the helper is off");
        assert.equal(lineOf(tab.purify), null);
    });

    await section("6. Heal on Other: housekeeping only — card, pool, Bonus Action, no healing applied here", async () => {
        const ctx = createFlowSandbox({ answers: [{ target: "other", healing: 15 }] });
        assert.equal(await roll(ctx, "Lay On Hands: Heal"), true);
        assert.ok(lastCard(ctx).request.effects.includes("On another creature"));
        assert.deepEqual(ctx.log.heals, []);
        assert.deepEqual(ctx.log.poolSpends, [["Lay On Hands: Healing Pool", 15]]);
        assert.deepEqual(ctx.log.turnSpends, ["bonusAction"]);
    });

    await section("7. Cancel, close, Enter and a failed dispatch spend nothing and heal nothing", async () => {
        for (const [label, options] of [
            ["cancel", { answers: [] }],
            ["enter", { answers: [{ target: undefined }] }],
            ["failed dispatch", { answers: [{ target: "self", healing: 5 }], sendResult: false }]]) {
            const ctx = createFlowSandbox(options);
            const result = await roll(ctx, "Lay On Hands: Heal");
            assert.notEqual(result, true, label);
            assert.deepEqual(ctx.log.heals, [], `${label}: no heal`);
            assert.deepEqual(ctx.log.poolSpends, [], `${label}: pool unchanged`);
            assert.deepEqual(ctx.log.turnSpends, [], `${label}: Bonus Action unchanged`);
        }
    });

    await section("8. More points than the pool: advise, never block", async () => {
        const declined = createFlowSandbox({ pool: 5, answers: [{ target: "self", healing: 9 }], confirm: false });
        assert.equal(await roll(declined, "Lay On Hands: Heal"), null);
        assert.equal(declined.log.confirms.length, 1);
        assert.match(declined.log.confirms[0].message, /needs 9 points, but D&D Beyond shows 5/);
        assert.equal(declined.log.sendRollCalls, 0);
        const accepted = createFlowSandbox({ pool: 5, answers: [{ target: "self", healing: 9 }], confirm: true });
        assert.equal(await roll(accepted, "Lay On Hands: Heal"), true);
        assert.deepEqual(accepted.log.heals.map(heal => heal.amount), [9], "the player chose to proceed");
        assert.deepEqual(accepted.log.poolSpends, [], "the pool is not driven below what D&D Beyond shows");
    });

    await section("9. Purify Poison on Self: 5 points, Poisoned removed through D&D Beyond, no healing", async () => {
        const ctx = createFlowSandbox({ poisoned: true, answers: [{ target: "self", purify: true }] });
        assert.equal(await roll(ctx, "Lay On Hands: Purify Poison"), true);
        assert.equal(ctx.log.prompts[0].title, "Lay On Hands");
        assert.doesNotMatch(ctx.log.prompts[0].html, /do not have the Poisoned/);
        const card = lastCard(ctx);
        assert.equal(card.rollType, "trait");
        assert.equal(card.request.name, "Lay On Hands: Purify Poison");
        assert.equal(card.request.damages, undefined, "restores no Hit Points");
        // Live 2026-09-17: a trait card shows only its description, so the result leads it.
        assert.match(card.request.description, /^Purify Poison on self: removes the Poisoned condition \(5 points; restores no Hit Points\)\.\n\nLay on Hands text$/);
        assert.ok(card.request.effects.some(effect => /Removes the Poisoned condition/.test(effect)));
        assert.deepEqual(ctx.log.removals, ["Poisoned"]);
        assert.deepEqual(ctx.log.heals, []);
        assert.deepEqual(ctx.log.poolSpends, [["Lay On Hands: Healing Pool", 5]]);
        assert.deepEqual(ctx.log.turnSpends, ["bonusAction"]);
    });

    await section("10. Purify Poison on Other, not poisoned yourself, short pool, and a failed native removal", async () => {
        const other = createFlowSandbox({ poisoned: false, answers: [{ target: "other", purify: true }] });
        await roll(other, "Lay On Hands: Purify Poison");
        assert.match(other.log.prompts[0].html, /do not have the Poisoned condition yourself/);
        assert.deepEqual(other.log.removals, []);
        assert.deepEqual(other.log.poolSpends, [["Lay On Hands: Healing Pool", 5]]);
        const short = createFlowSandbox({ pool: 3, answers: [{ target: "other", purify: true }], confirm: false });
        assert.equal(await roll(short, "Lay On Hands: Purify Poison"), null);
        assert.match(short.log.confirms[0].message, /needs 5 points, but D&D Beyond shows 3/);
        // Lay on Hands is a Bonus Action by rule, even when the row does not state its activation.
        const bare = createFlowSandbox({ answers: [{ target: "other", purify: true }, { target: "other", healing: 2 }] });
        await roll(bare, "Lay On Hands: Purify Poison", {});
        await roll(bare, "Lay On Hands: Heal", {});
        assert.deepEqual(bare.log.turnSpends, ["bonusAction", "bonusAction"]);
        const stuck = createFlowSandbox({ poisoned: true, conditionRemoved: false, answers: [{ target: "self", purify: true }] });
        await roll(stuck, "Lay On Hands: Purify Poison");
        assert.equal(stuck.log.warnings.length, 1);
        assert.match(stuck.log.warnings[0], /did not remove the Poisoned condition/);
    });

    await section("11. Reconciliation warnings: pool not on this tab; healing not applied", async () => {
        const noPool = createFlowSandbox({ pool: null, answers: [{ target: "other", healing: 4 }] });
        assert.equal(await roll(noPool, "Lay On Hands: Heal"), true);
        assert.deepEqual(noPool.log.poolSpends, []);
        assert.match(noPool.log.warnings.join(" "), /could not find the Lay on Hands pool.*reduce it by 4/);
        const notHealed = createFlowSandbox({ healingApplied: false, answers: [{ target: "self", healing: 6 }] });
        await roll(notHealed, "Lay On Hands: Heal");
        assert.match(notHealed.log.warnings.join(" "), /did not apply the healing. Please add 6 Hit Points manually/);
    });

    await section("12. A second click while the window is open does nothing", async () => {
        const ctx = createFlowSandbox({ holdPrompt: true, answers: [{ target: "other", healing: 3 }] });
        const first = roll(ctx, "Lay On Hands: Heal");
        await tick();
        const second = await Promise.race([roll(ctx, "Lay On Hands: Heal"), tick(300).then(() => "still waiting")]);
        assert.equal(second, null, "the second click returns at once instead of opening another window");
        ctx.release();
        assert.equal(await first, true);
        assert.equal(ctx.log.prompts.length, 1);
        assert.equal(ctx.log.sendRollCalls, 1);
        assert.deepEqual(ctx.log.poolSpends, [["Lay On Hands: Healing Pool", 3]]);
        assert.equal(await roll(createFlowSandbox({ answers: [] }), "Lay On Hands: Heal"), null, "the guard resets after Cancel");
    });

    await section("13. Routing: Healing Pool opens Heal; Restoring Touch keeps its 5-point card; the action pane uses the same window", async () => {
        const kind = run(createFlowSandbox(), "wayBeyond20LayOnHandsKind");
        assert.equal(kind("Lay On Hands: Heal"), "heal");
        assert.equal(kind("Lay On Hands: Healing Pool"), "heal");
        assert.equal(kind("Lay On Hands"), "heal");
        assert.equal(kind("Lay On Hands: Purify Poison"), "purify");
        assert.equal(kind("Restoring Touch"), "restoring-touch");
        assert.equal(kind("Divine Sense"), null);

        const restoring = createFlowSandbox();
        assert.equal(await roll(restoring, "Restoring Touch", {}), true);
        assert.equal(restoring.log.prompts.length, 0);
        assert.equal(lastCard(restoring).rollType, "trait");
        assert.deepEqual(restoring.log.poolSpends, [["Lay On Hands: Healing Pool", 5]]);
        assert.deepEqual(restoring.log.turnSpends, [], "no Bonus Action is assumed for Restoring Touch");

        const pane = createFlowSandbox({ answers: [{ target: "other", healing: 2 }] });
        const outcome = await run(pane, "wayBeyond20RollPaladinSpecialAction")("Lay On Hands: Heal", "Lay On Hands", "text", { "Action Type": "1 Bonus Action" });
        assert.equal(outcome.handled, true);
        assert.equal(outcome.result, true);
        assert.equal(pane.log.prompts[0].title, "Lay On Hands");
        assert.deepEqual(pane.log.turnSpends, ["bonusAction"]);
    });

    await section("14. Healing on Self goes through D&D Beyond's Heal control and notifies healing triggers", async () => {
        const sandbox = createDomSandbox({ hp: 20, maxHp: 28 });
        const box = hitPointsBox(sandbox);
        const apply = run(sandbox.context, "wayBeyond20ApplyHealingToSelf");
        const healed = await apply(5, { source: "Lay On Hands: Heal" });
        assert.deepEqual(clone(healed), { applied: true, before: 20, after: 25 });
        assert.equal(box.input.value, "5", "the amount was typed into D&D Beyond's box");
        assert.equal(sandbox.events.length, 1);
        assert.equal(sandbox.events[0].type, "WayBeyond20HealingReceived");
        assert.deepEqual(clone(sandbox.events[0].detail), { amount: 5, regained: 5, source: "Lay On Hands: Heal" });

        const capped = await apply(10, { source: "x" });
        assert.equal(capped.after, 28, "D&D Beyond caps at the maximum");
        assert.equal(sandbox.events[1].detail.regained, 3);

        const full = await apply(4, { source: "x" });
        assert.deepEqual(clone(full), { applied: true, before: 28, after: 28 }, "healing at full HP is received, regaining nothing");

        const ignored = createDomSandbox({ hp: 10, maxHp: 28 });
        hitPointsBox(ignored, { respond: false });
        const notApplied = await run(ignored.context, "wayBeyond20ApplyHealingToSelf")(3, {});
        assert.equal(notApplied.applied, false);
        assert.equal(ignored.events.length, 0, "no trigger when D&D Beyond did not heal");

        const missing = createDomSandbox({ hp: 10 });
        const none = await run(missing.context, "wayBeyond20ApplyHealingToSelf")(3, {});
        assert.equal(none.applied, false);
    });

    await section("15. Poisoned is removed with D&D Beyond's own toggle, opening the pane when needed", async () => {
        const open = createDomSandbox();
        const openState = conditions(open, { active: true, paneOpen: true });
        const has = run(open.context, "wayBeyond20SelfHasCondition");
        assert.equal(has("Poisoned"), true);
        assert.equal(has("Blinded"), false, "a pane row is not an active condition");
        assert.deepEqual(clone(await run(open.context, "wayBeyond20RemoveConditionFromSelf")("Poisoned")), { wasPresent: true, removed: true });
        assert.equal(openState.active, false);
        assert.equal(openState.clicks, 1);

        const closed = createDomSandbox();
        const closedState = conditions(closed, { active: true, paneOpen: false });
        assert.deepEqual(clone(await run(closed.context, "wayBeyond20RemoveConditionFromSelf")("Poisoned")), { wasPresent: true, removed: true });
        assert.equal(closedState.active, false);

        const clean = createDomSandbox();
        const cleanState = conditions(clean, { active: false, paneOpen: true });
        assert.deepEqual(clone(await run(clean.context, "wayBeyond20RemoveConditionFromSelf")("Poisoned")), { wasPresent: false, removed: false });
        assert.equal(cleanState.clicks, 0, "a condition you don't have is not toggled on");

        const stuck = createDomSandbox();
        conditions(stuck, { active: true, paneOpen: true, toggleResponds: false });
        assert.deepEqual(clone(await run(stuck.context, "wayBeyond20RemoveConditionFromSelf")("Poisoned")), { wasPresent: true, removed: false });
    });

    await section("16. Pills replace \"Heal:\" and \"Purify Poison:\" on Features & Traits, idempotently", async () => {
        const sandbox = createDomSandbox();
        const tab = featuresTab(sandbox);
        const inject = run(sandbox.context, "wayBeyond20InjectLayOnHandsControls");
        inject();
        for (const [summary, label] of [[tab.heal, "Heal"], [tab.purify, "Purify Poison"]]) {
            const line = lineOf(summary);
            assert.ok(line, `${label}: line injected`);
            assert.ok(summary.classList.contains("waybeyond20-loh-summary"), `${label}: native text hidden`);
            const pill = line.querySelector("button.waybeyond20-loh-pill");
            assert.equal(pill.textContent, label);
            assert.equal(line.textContent, `Lay On Hands: ${label} 1 Bonus Action`, `${label}: "${label}:" became the pill`);
        }
        assert.equal(lineOf(tab.poolSummary), null, "the pool row keeps D&D Beyond's own text and controls");
        assert.equal(lineOf(tab.other), null, "other features are untouched");

        inject(); inject();
        assert.equal(tab.heal.children.filter(child => child.classList.contains("waybeyond20-loh-line")).length, 1, "no duplicate lines");

        tab.heal.childNodes[0].textContent = "Lay On Hands: Heal: 1 Action";
        inject();
        assert.equal(lineOf(tab.heal).textContent, "Lay On Hands: Heal 1 Action", "rebuilt when D&D Beyond's text changes");

        const pillClick = { type: "click", defaultPrevented: false, propagationStopped: false,
            preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.propagationStopped = true; } };
        lineOf(tab.purify).querySelector("button").dispatchEvent(pillClick);
        await tick();
        assert.ok(pillClick.defaultPrevented && pillClick.propagationStopped, "the pill does not also open D&D Beyond's pane");
        assert.deepEqual(sandbox.log.rolls, [{ name: "Lay On Hands: Purify Poison", description: "Your blessed touch can heal wounds.", properties: { "Action Type": "1 Bonus Action" } }]);

        tab.purify.childNodes[0].textContent = "Channel Divinity: Divine Sense: 1 Bonus Action";
        inject();
        assert.equal(lineOf(tab.purify), null, "removed when the row is no longer a Lay on Hands option");
        assert.ok(!tab.purify.classList.contains("waybeyond20-loh-summary"));
    });

    await section("17. The pool is found from the Features & Traits summary as well as the Actions heading", async () => {
        const sandbox = createDomSandbox();
        const tab = featuresTab(sandbox, { poolValue: 12 });
        run(sandbox.context, "wayBeyond20InjectLayOnHandsControls")();
        const pool = run(sandbox.context, "wayBeyond20FindNumericFeaturePool")("Lay On Hands: Healing Pool");
        assert.equal(pool.current, 12);
        assert.equal(pool.decrease[0], tab.decrease);

        const actions = createDomSandbox();
        const decrease = h("button", { class: "button-action-decrease" });
        actions.document.body.append(h("div", { class: "ct-feature-snippet" },
            h("div", { class: "ct-feature-snippet__heading" }, "Lay On Hands: Healing Pool "),
            h("div", { class: "ct-slot-manager-large" }, decrease,
                h("div", { class: "ct-slot-manager-large__value--cur" }, "9"))));
        const fromHeading = run(actions.context, "wayBeyond20FindNumericFeaturePool")("Lay On Hands: Healing Pool");
        assert.equal(fromHeading.current, 9);
        assert.equal(run(actions.context, "wayBeyond20FindNumericFeaturePool")("Lay On Hands: Heal").current, null, "Heal is not the pool");
    });

    await section("19. Every Lay on Hands dispatch pins a Normal roll mode, so \"Ask every time\" never asks", async () => {
        // Tester report, 2026-10-04: both confirms "ask me to roll dice". With the global Roll Type set
        // to Ask every time, sendRoll poses the roll-mode query for any request whose advantage is
        // unset -- a dialog whose only button reads "Roll" -- even though this card has no attack
        // roll. Before the correction these requests carried no advantage at all.
        const flows = [
            ["heal on self", createFlowSandbox({ answers: [{ target: "self", healing: 6 }] }), "Lay On Hands: Heal"],
            ["purify on other", createFlowSandbox({ answers: [{ target: "other", purify: true }] }), "Lay On Hands: Purify Poison"],
            ["combined on self", createFlowSandbox({ answers: [{ target: "self", healing: 4, purify: true }], poisoned: true }), "Lay On Hands: Heal"],
            ["Restoring Touch", createFlowSandbox(), "Restoring Touch"]
        ];
        for (const [label, ctx, feature] of flows) {
            assert.equal(await roll(ctx, feature), true, `${label}: dispatched`);
            const request = lastCard(ctx).request;
            const normal = run(ctx, "RollType.NORMAL");
            assert.equal(request.advantage, normal, `${label}: advantage is pinned to Normal`);
            assert.notEqual(request.advantage, undefined, `${label}: advantage is set at all`);
        }
    });

    await section("18. No browser prompt anywhere in the Lay on Hands path", async () => {
        const body = ["wayBeyond20RollLayOnHands", "wayBeyond20PerformLayOnHands", "wayBeyond20QueryLayOnHands",
            "wayBeyond20InjectLayOnHandsControls", "wayBeyond20ApplyHealingToSelf", "wayBeyond20RemoveConditionFromSelf"]
            .map(name => topLevelFunction(characterSource, name)).join("\n");
        assert.doesNotMatch(body, /window\.prompt/);
        // Behaviorally too: the flow sandbox's window.prompt throws, and sections 5-13 never hit it.
    });

    reported = true;
    let failed = false;
    for (const result of results) {
        console.log(`  ${result.ok ? "PASS" : "FAIL"}  ${result.name}`);
        if (!result.ok) { failed = true; console.log(result.error && result.error.stack); }
    }
    if (failed) {
        console.log("WayBeyond20 Lay on Hands checks FAILED.");
        process.exitCode = 1;
    } else {
        console.log("WayBeyond20 Lay on Hands checks passed.");
    }
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
