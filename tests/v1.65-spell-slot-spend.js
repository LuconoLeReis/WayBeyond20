// WB20-0065 brief 1.9/1.10, correction 2: a slot-fueled Smite spends its exact slot level even when
// the Elemental Strike rider left the Actions tab showing. Runs the real content slot spend, the real
// page-context slot change (message-broker.js, over a simulated custom-event bridge) and the real
// dispatch commit against a sheet model whose Spells and Actions tabs mount and unmount their content.
// The sheet is a test model of D&D Beyond's structure, not captured markup.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createDocument, h, miniJQuery } = require("./helpers/mini-dom");

const root = path.resolve(__dirname, "..");
const read = relative => fs.readFileSync(path.join(root, ...relative.split("/")), "utf8");
const characterSource = process.env.WB20_CHARACTER_SOURCE
    ? fs.readFileSync(process.env.WB20_CHARACTER_SOURCE, "utf8")
    : read("src/dndbeyond/content-scripts/character.js");
const brokerSource = read("src/dndbeyond/page-scripts/message-broker.js");

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

function between(source, startText, endText) {
    const start = source.indexOf(startText);
    const end = source.indexOf(endText, start + startText.length);
    assert.notEqual(start, -1, `Missing ${startText}`);
    assert.notEqual(end, -1, `Missing ${endText}`);
    return source.slice(start, end);
}

const CONTENT_FUNCTIONS = [
    "sendRollWithCharacter", "wayBeyond20DispatchRollWithCharacter", "wayBeyond20RestoreCharacterSheetTab", "addEffect", "wayBeyond20NormalizeFeatureLabel", "wayBeyond20ElementOwnText",
    "wayBeyond20CharacterSheetTab", "wayBeyond20ActiveCharacterSheetTab",
    "wayBeyond20SpellSlotHeaderLevel", "wayBeyond20SpellSlotControls", "wayBeyond20AvailableSpellSlots",
    "wayBeyond20CurrentSmiteCacheOwner", "wayBeyond20EnsureSmiteCacheOwner", "wayBeyond20InvalidateSmiteSpellCache",
    "wayBeyond20RequestPageSpellSlotChange", "wayBeyond20SpendSpellSlot",
    "wayBeyond20LimitedUseInputForControl", "wayBeyond20LimitedUseControlIsVisible",
    "wayBeyond20LimitedUseCanonicalControl", "wayBeyond20LimitedUseControlIsUnused",
    "wayBeyond20LimitedUseControlMatchesFeature", "wayBeyond20FindLimitedUseControls",
    "wayBeyond20WaitForLimitedUseSpend", "wayBeyond20RequestPageLimitedUseSpend", "wayBeyond20SpendLimitedUse",
    "wayBeyond20PreflightLimitedUse", "wayBeyond20AttachLimitedUse",
    "wayBeyond20RollIsUnarmedStrike", "wayBeyond20NormalizeAttackSemantics", "wayBeyond20ApplyDrainingAttackIntent"
];
const OPTIONAL_CONTENT_FUNCTIONS = [
    "wayBeyond20SpellSlotState", "wayBeyond20WaitForSpellSlotBelow",
    "wayBeyond20LimitedUseSelectors", "wayBeyond20LimitedUseLabelsWithin", "wayBeyond20LimitedUseLabelText",
    "wayBeyond20LimitedUseControlOwnerLabel"
];
const pageSource = between(brokerSource, "    function b20LimitedUseElementVisible(", "    function b20PaladinSmiteUseEntry(");

// ---- Sheet model: the active tab decides which content is mounted --------------------------
function buildSheet({ slots = { 1: 4, 2: 3 }, spent = {}, tab = "Actions", clicksWork = true, clickDelayMs = 0 } = {}) {
    const state = { clicks: [], tabClicks: [], clicksWork, tab };
    const document = createDocument();
    const toggle = element => element.setAttribute("aria-checked", element.getAttribute("aria-checked") === "true" ? "false" : "true");
    const box = (key, used) => {
        const element = h("div", { role: "checkbox", "aria-label": "use", "aria-checked": String(!!used), class: "ct-slot-manager__slot", "data-slot": key });
        element.onclick = () => {
            state.clicks.push(key);
            if (!state.clicksWork) return;
            if (clickDelayMs > 0) setTimeout(() => toggle(element), clickDelayMs);
            else toggle(element);
        };
        return element;
    };
    const ordinal = level => `${level}${level === 1 ? "st" : level === 2 ? "nd" : level === 3 ? "rd" : "th"}`;
    const spells = h("div", { class: "ct-spells" }, ...Object.entries(slots).map(([level, count]) =>
        h("div", { class: "ct-content-group" },
            h("div", { class: "ct-content-group__header" },
                h("div", { class: "ct-content-group__header-content" }, `${ordinal(Number(level))} Level`),
                h("div", { class: "ct-slot-manager" }, ...Array.from({ length: count }, (_, index) =>
                    box(`L${level}#${index}`, index < (spent[level] || 0))))),
            h("div", { class: "ct-spells-spell" }, "Divine Smite"))));
    const actions = h("div", { class: "ct-actions" },
        h("div", { class: "ct-feature-snippet" },
            h("div", { class: "ct-feature-snippet__heading" }, "Channel Divinity"),
            h("div", { class: "ct-slot-manager" }, box("CD#0", false), box("CD#1", false))));
    const main = h("div", { class: "ct-primary-box" });
    const tabButton = label => {
        const button = h("button", { role: "radio", "aria-checked": String(state.tab === label) }, label);
        button.onclick = () => {
            state.tabClicks.push(label);
            state.tab = label;
            tabs.children.forEach(other => other.setAttribute("aria-checked", String(other.textContent === label)));
            main.replaceChildren(label === "Spells" ? spells : actions);
        };
        return button;
    };
    const tabs = h("div", { class: "ct-primary-box__tabs" }, tabButton("Actions"), tabButton("Spells"));
    main.append(state.tab === "Spells" ? spells : actions);
    document.body.append(tabs, main);
    const available = prefix => [...spells.querySelectorAll("[data-slot]"), ...actions.querySelectorAll("[data-slot]")]
        .filter(element => element.getAttribute("data-slot").startsWith(prefix) && element.getAttribute("aria-checked") !== "true").length;
    return { document, state, available };
}

function createSandbox(sheet, { sendResult = true } = {}) {
    const log = { warnings: [], debug: [] };
    const { document } = sheet;
    const addCustomEventListener = (name, callback) => {
        const handler = event => callback(...event.detail);
        document.addEventListener(name, handler);
        return [name, handler];
    };
    const sendCustomEvent = (name, args) => setTimeout(() => document.root.dispatchEvent({ type: name, detail: args }), 0);
    const context = {
        console, Promise, document, log, key_modifiers: {},
        character: { _id: 1, _name: "Test Sheet", hasRacialTrait: () => false, getSetting: (key, fallback) => fallback, mergeCharacterSettings() {} },
        window: { getComputedStyle: element => element.style, location: { pathname: "/characters/test" } },
        Node: { TEXT_NODE: 3 },
        $: miniJQuery,
        setTimeout: (fn, ms) => setTimeout(fn, Math.ceil((Number(ms) || 0) / 25)),
        addCustomEventListener, sendCustomEvent,
        alertify: { warning: message => log.warnings.push(message) },
        wayBeyond20CharacterDebug: message => log.debug.push(message),
        wayBeyond20DescribeElement: element => element ? element.getAttribute("data-slot") : null,
        wayBeyond20PreflightTurnResource: async () => true,
        wayBeyond20SpendTurnResource() {},
        wayBeyond20GetTrackedSpellEffects: () => [],
        wayBeyond20EffectName: () => "",
        wayBeyond20TrackSelfFeatureEffect() {},
        wayBeyond20RemoveTrackedEffect() {},
        wayBeyond20SetIntrusionDie() {},
        wayBeyond20SpendPaladinSmiteFreeUse: async () => true,
        sendRoll: async () => sendResult
    };
    vm.createContext(context);
    vm.runInContext([
        "var wayBeyond20PreparedSmiteCache = null; var wayBeyond20SpellSlotCache = null; var wayBeyond20SmiteCacheOwner = '';",
        ...CONTENT_FUNCTIONS.map(name => topLevelFunction(characterSource, name)),
        ...OPTIONAL_CONTENT_FUNCTIONS.map(name => topLevelFunction(characterSource, name, { optional: true })),
        pageSource,
        "addCustomEventListener('WayBeyond20ChangeSpellSlot', changeSpellSlot);",
        "addCustomEventListener('WayBeyond20SpendLimitedUse', spendLimitedUse);"
    ].join("\n"), context);
    return context;
}

const run = (context, expression) => vm.runInContext(expression, context);
const failures = [];
async function section(label, body) {
    try {
        await body();
        console.log(`  PASS  ${label}`);
    } catch (error) {
        failures.push(label);
        console.log(`  FAIL  ${label}: ${String(error.message || error).split("\n")[0]}`);
    }
}

(async () => {
    await section("1. Actions showing: opens Spells, spends exactly one slot of the requested level, restores Actions", async () => {
        const sheet = buildSheet();
        const ctx = createSandbox(sheet);
        assert.equal(await run(ctx, "wayBeyond20SpendSpellSlot")(2), true);
        assert.equal(sheet.available("L2"), 2, "one 2nd-level slot spent");
        assert.equal(sheet.available("L1"), 4, "1st-level slots unchanged");
        assert.deepEqual(sheet.state.clicks, ["L2#0"], "one native click");
        assert.deepEqual(sheet.state.tabClicks, ["Spells", "Actions"]);
        assert.equal(sheet.state.tab, "Actions");
    });

    await section("2. Spells already showing: no tab changes", async () => {
        const sheet = buildSheet({ tab: "Spells" });
        const ctx = createSandbox(sheet);
        assert.equal(await run(ctx, "wayBeyond20SpendSpellSlot")(1), true);
        assert.equal(sheet.available("L1"), 3);
        assert.equal(sheet.available("L2"), 3);
        assert.deepEqual(sheet.state.tabClicks, []);
    });

    await section("3. Slot already spent by D&D Beyond's own cast: nothing more is deducted", async () => {
        const sheet = buildSheet({ spent: { 2: 1 } });
        const ctx = createSandbox(sheet);
        assert.equal(await run(ctx, "wayBeyond20SpendSpellSlot")(2, { expectedAvailable: 3 }), true);
        assert.equal(sheet.available("L2"), 2, "still the one slot D&D Beyond spent");
        assert.deepEqual(sheet.state.clicks, []);
        assert.equal(sheet.state.tab, "Actions");
    });

    await section("4. Native click ignored: failure, no neighboring slot touched, tab restored", async () => {
        const sheet = buildSheet({ clicksWork: false });
        const ctx = createSandbox(sheet);
        assert.equal(await run(ctx, "wayBeyond20SpendSpellSlot")(2), false);
        assert.equal(sheet.available("L2"), 3);
        assert.equal(sheet.available("L1"), 4);
        assert.ok(sheet.state.clicks.length >= 1 && sheet.state.clicks.every(key => key.startsWith("L2#")));
        assert.equal(sheet.state.tab, "Actions");
    });

    await section("5. Missing level: failure with no click", async () => {
        const sheet = buildSheet();
        const ctx = createSandbox(sheet);
        assert.equal(await run(ctx, "wayBeyond20SpendSpellSlot")(5), false);
        assert.deepEqual(sheet.state.clicks, []);
        assert.equal(sheet.state.tab, "Actions");
    });

    await section("6. A native change that lands late is not doubled", async () => {
        const sheet = buildSheet({ clickDelayMs: 20 });
        const ctx = createSandbox(sheet);
        assert.equal(await run(ctx, "wayBeyond20SpendSpellSlot")(2), true);
        await new Promise(resolve => setTimeout(resolve, 80));
        assert.equal(sheet.available("L2"), 2, "exactly one slot");
        assert.equal(sheet.state.clicks.length, 1, "one click");
    });

    await section("7. Dispatch with the rider on Actions: one Channel Divinity and exactly the chosen slot, no warning", async () => {
        const sheet = buildSheet();
        const ctx = createSandbox(sheet);
        const request = {
            name: "Longsword", "to-hit": "+5", damages: ["1d8 + 3", "2d8"], "damage-types": ["Slashing", "Radiant (Divine Smite)"],
            "waybeyond20-limited-use": { feature: "Channel Divinity", name: "Efreeti’s Fury" },
            "waybeyond20-smite": { name: "Divine Smite", fuel: "spell-slot", slotLevel: 1, slotAvailable: 4, returnTab: null }
        };
        assert.equal(await run(ctx, "sendRollWithCharacter")("attack", "1d8 + 3", request), true);
        assert.equal(sheet.available("CD"), 1, "one Channel Divinity");
        assert.equal(sheet.available("L1"), 3, "one 1st-level slot");
        assert.equal(sheet.available("L2"), 3, "2nd-level slots unchanged");
        assert.deepEqual(ctx.log.warnings, []);
        assert.equal(sheet.state.tab, "Actions");
    });

    await section("8. Failed dispatch spends neither the slot nor Channel Divinity", async () => {
        const sheet = buildSheet();
        const ctx = createSandbox(sheet, { sendResult: false });
        const request = {
            name: "Longsword", "to-hit": "+5", damages: ["1d8 + 3"], "damage-types": ["Slashing"],
            "waybeyond20-limited-use": { feature: "Channel Divinity", name: "Efreeti’s Fury" },
            "waybeyond20-smite": { name: "Divine Smite", fuel: "spell-slot", slotLevel: 1, slotAvailable: 4, returnTab: null }
        };
        assert.notEqual(await run(ctx, "sendRollWithCharacter")("attack", "1d8 + 3", request), true);
        assert.equal(sheet.available("CD"), 2);
        assert.equal(sheet.available("L1"), 4);
        assert.deepEqual(sheet.state.clicks, []);
    });

    if (failures.length) { console.error(`${failures.length} section(s) failed.`); process.exit(1); }
    console.log("WayBeyond20 v1.65.1 spell-slot spend checks passed.");
})().catch(error => {
    console.error(error);
    process.exit(1);
});
