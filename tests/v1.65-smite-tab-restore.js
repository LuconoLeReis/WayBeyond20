// WB20-0065 brief 1.11, P1 (F-L12): every exit of the Smite helper returns the player to the sheet tab they
// started on.
// Live evidence: on a character with no Smite, a melee attack with an available Bonus Action left the sheet on
// Spells, because Smite discovery opened Spells and returned "no Smite" without restoring the tab.
// This suite runs the real wayBeyond20MaybeAddSmite, wayBeyond20BuildSmiteOptions (tab probe and fuel/Smite
// discovery logic), the real tab helpers and the real sendRollWithCharacter against a sheet model whose tab
// buttons mount and unmount content. Row/slot parsing and the Smite dialog are modeled; the sheet is a test
// model of D&D Beyond's structure, not captured markup.
// WB20_SOURCE_ROOT may point at a copy of the sources to record pre-correction behavior.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createDocument, h, miniJQuery } = require("./helpers/mini-dom");

const sourceRoot = process.env.WB20_SOURCE_ROOT || path.resolve(__dirname, "..");
const characterSource = fs.readFileSync(path.join(sourceRoot, "src", "dndbeyond", "content-scripts", "character.js"), "utf8");

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

const CONTENT_FUNCTIONS = ["sendRollWithCharacter", "addEffect", "wayBeyond20NormalizeFeatureLabel",
    "wayBeyond20CharacterSheetTab", "wayBeyond20ActiveCharacterSheetTab", "wayBeyond20MaybeAddSmite",
    "wayBeyond20BuildSmiteOptions", "wayBeyond20PaladinSmiteFreeUseAvailable", "wayBeyond20PaladinSmiteUseTextIsUsed",
    "wayBeyond20SmiteFuelIsLegal", "wayBeyond20SmiteFormulaForSlot", "wayBeyond20AttachTurnResource",
    "wayBeyond20AttachAdditionalTurnResource"];
const OPTIONAL_CONTENT_FUNCTIONS = ["wayBeyond20DispatchRollWithCharacter", "wayBeyond20RestoreCharacterSheetTab",
    "wayBeyond20AddSelectedSmite"];

const DIVINE_SMITE_ROW = { name: "Divine Smite", meta: "Paladin", text: "Divine Smite 2d8 Radiant", action: "cast",
    disabled: false, prepared: true, level: 1, formula: "2d8", damageType: "Radiant" };

// smite: "none" (no Smite prepared), "no-fuel" (Smite prepared, no slot and no Paladin's Smite), "available".
function buildSheet({ tab = "Actions", smite = "none", slotsOnSpellsTab = true, rerenderTabs = false } = {}) {
    const state = { tabClicks: [], tab };
    const document = createDocument();
    const content = {
        Actions: h("div", { class: "ct-actions" }, "Longsword"),
        Spells: h("div", { class: "ct-spells" }, smite === "none" ? "Fire Bolt" : "Divine Smite"),
        Inventory: h("div", { class: "ct-inventory" }, "Longsword")
    };
    const main = h("div", { class: "ct-primary-box" });
    const tabs = h("div", { class: "ct-primary-box__tabs" });
    // rerenderTabs: every tab change replaces the tab buttons with new elements, as a React re-render may.
    const renderTabs = () => tabs.replaceChildren(...Object.keys(content).map(label => {
        const button = h("button", { role: "radio", "aria-checked": String(label === state.tab) }, label);
        button.onclick = () => {
            // A button React already replaced does nothing when clicked.
            if (!button.isConnected) return;
            state.tabClicks.push(label);
            state.tab = label;
            if (rerenderTabs) renderTabs();
            else tabs.children.forEach(other => other.setAttribute("aria-checked", String(other.textContent === label)));
            main.replaceChildren(content[label]);
        };
        return button;
    }));
    renderTabs();
    main.append(content[tab]);
    document.body.append(tabs, main);
    const spellsMounted = () => state.tab === "Spells";
    return {
        document, state,
        rows: () => spellsMounted() && smite !== "none" ? [Object.assign({}, DIVINE_SMITE_ROW)] : [],
        slots: () => smite === "available" && (spellsMounted() || !slotsOnSpellsTab) ? [{ level: 1, available: 2 }] : []
    };
}

// query: "cancel" | "select" | "throw"
function createSandbox(sheet, { query = "cancel", sendResult = true, preflightAllowed = true, riderOpensActions = false } = {}) {
    const log = { queries: 0, dispatched: 0, turnSpends: [], slotSpends: [] };
    const context = {
        console, Promise, document: sheet.document, log,
        setTimeout: (fn, ms) => setTimeout(fn, Math.ceil((Number(ms) || 0) / 25)),
        $: miniJQuery,
        character: { _id: 1, _name: "Test Sheet", hasRacialTrait: () => false, getSetting: (key, fallback) => fallback, mergeCharacterSettings() {} },
        alertify: { warning() {} },
        damagesToCrits: (c, damages) => damages.map(damage => `crit(${damage})`),
        abbreviationToAbility: value => value,
        wayBeyond20CharacterDebug() {},
        wayBeyond20CharacterHelperEnabled: () => true,
        wayBeyond20HasAvailableBonusAction: () => true,
        wayBeyond20FindSmiteRows: () => sheet.rows(),
        wayBeyond20AvailableSpellSlots: () => sheet.slots(),
        wayBeyond20FirstDamageFormula: () => "2d8",
        wayBeyond20DamageTypeFromText: () => "Radiant",
        wayBeyond20QuerySmite: async options => {
            log.queries++;
            if (query === "throw") throw new Error("dialog failed");
            if (query === "cancel") return null;
            return { smite: options.smites[0], fuel: options.fuels[0] };
        },
        // The Elemental Strike rider exposes Channel Divinity on Actions.
        wayBeyond20MaybeAddElementalStrike: async () => {
            if (riderOpensActions) sheet.document.querySelectorAll("button").find(button => button.textContent === "Actions").click();
        },
        wayBeyond20PreflightLimitedUse: async () => ({ allowed: true, tracked: false }),
        wayBeyond20PreflightTurnResource: async () => preflightAllowed,
        wayBeyond20SpendTurnResource: resource => log.turnSpends.push(resource),
        wayBeyond20SpendSpellSlot: async level => { log.slotSpends.push(level); return true; },
        wayBeyond20SpendPaladinSmiteFreeUse: async () => true,
        wayBeyond20GetTrackedSpellEffects: () => [],
        wayBeyond20EffectName: () => "",
        wayBeyond20NormalizeAttackSemantics() {},
        wayBeyond20ApplyDrainingAttackIntent() {},
        wayBeyond20RemoveTrackedEffect() {},
        wayBeyond20TrackSelfFeatureEffect() {},
        wayBeyond20SetIntrusionDie() {},
        sendRoll: async () => { log.dispatched++; return sendResult; }
    };
    vm.createContext(context);
    vm.runInContext([
        ...CONTENT_FUNCTIONS.map(name => topLevelFunction(characterSource, name)),
        ...OPTIONAL_CONTENT_FUNCTIONS.map(name => topLevelFunction(characterSource, name, { optional: true }))
    ].join("\n"), context);
    return context;
}

const run = (context, expression) => vm.runInContext(expression, context);
const settle = () => new Promise(resolve => setTimeout(resolve, 20));
const attackRequest = () => ({ name: "Longsword", rollDamage: true, damages: ["1d8 + 3"], "damage-types": ["Slashing"],
    "waybeyond20-turn-resource": { resource: "action", name: "Longsword" } });

async function attack(ctx) {
    const request = attackRequest();
    let selection;
    let error = null;
    try {
        selection = await run(ctx, "wayBeyond20MaybeAddSmite")(request, true);
    } catch (caught) {
        error = caught;
    }
    return { request, selection, error };
}

const sections = [];
const section = (name, body) => sections.push({ name, body });

section("1. No Smite, starting on Actions: discovery opens Spells, the player is returned to Actions", async () => {
    const sheet = buildSheet({ tab: "Actions", smite: "none" });
    const ctx = createSandbox(sheet);
    const { selection } = await attack(ctx);
    await settle();
    assert.equal(selection, null);
    assert.deepEqual(sheet.state.tabClicks, ["Spells", "Actions"], "probe, then restore");
    assert.equal(sheet.state.tab, "Actions");
});

section("2. No Smite, starting on Inventory: returned to Inventory, not Actions", async () => {
    const sheet = buildSheet({ tab: "Inventory", smite: "none" });
    const ctx = createSandbox(sheet);
    await attack(ctx);
    await settle();
    assert.equal(sheet.state.tab, "Inventory");
    assert.deepEqual(sheet.state.tabClicks, ["Spells", "Inventory"]);
});

section("3. No Smite, starting on Spells: no tab change at all", async () => {
    const sheet = buildSheet({ tab: "Spells", smite: "none" });
    const ctx = createSandbox(sheet);
    await attack(ctx);
    await settle();
    assert.equal(sheet.state.tab, "Spells");
    assert.deepEqual(sheet.state.tabClicks, []);
});

section("4. Smite prepared but no fuel: returned to the starting tab (Actions and Spells)", async () => {
    for (const tab of ["Actions", "Spells"]) {
        const sheet = buildSheet({ tab, smite: "no-fuel" });
        const ctx = createSandbox(sheet);
        const { selection } = await attack(ctx);
        await settle();
        assert.equal(selection, null, tab);
        assert.equal(ctx.log.queries, 0, `${tab}: no dialog without fuel`);
        assert.equal(sheet.state.tab, tab, `${tab}: restored`);
    }
});

section("5. Player cancels the Smite dialog: returned to the starting tab (Actions and Spells)", async () => {
    for (const tab of ["Actions", "Spells"]) {
        const sheet = buildSheet({ tab, smite: "available" });
        const ctx = createSandbox(sheet, { query: "cancel" });
        const { selection } = await attack(ctx);
        await settle();
        assert.equal(selection, null, tab);
        assert.equal(ctx.log.queries, 1, `${tab}: dialog shown`);
        assert.equal(sheet.state.tab, tab, `${tab}: restored`);
    }
});

section("6. The Smite dialog throws: the error surfaces and the tab is still restored", async () => {
    const sheet = buildSheet({ tab: "Actions", smite: "available" });
    const ctx = createSandbox(sheet, { query: "throw" });
    const { error } = await attack(ctx);
    await settle();
    assert.ok(error && /dialog failed/.test(error.message), "error propagates");
    assert.equal(sheet.state.tab, "Actions");
});

section("7. Smite chosen: tab restored after the dispatch and its spends, including the rider's tab switch", async () => {
    for (const tab of ["Actions", "Inventory"]) {
        const sheet = buildSheet({ tab, smite: "available" });
        const ctx = createSandbox(sheet, { query: "select", riderOpensActions: true });
        const { request, selection } = await attack(ctx);
        assert.ok(selection, `${tab}: Smite selected`);
        assert.equal(await run(ctx, "sendRollWithCharacter")("attack", "1d8 + 3", request), true);
        await settle();
        assert.deepEqual(ctx.log.slotSpends, [1], `${tab}: slot spent`);
        assert.equal(sheet.state.tab, tab, `${tab}: restored after dispatch`);
    }
});

section("8. Smite chosen, then the dispatch fails or a preflight is declined: tab restored", async () => {
    for (const options of [{ sendResult: false }, { preflightAllowed: false }]) {
        const sheet = buildSheet({ tab: "Inventory", smite: "available" });
        const ctx = createSandbox(sheet, Object.assign({ query: "select" }, options));
        const { request } = await attack(ctx);
        assert.notEqual(await run(ctx, "sendRollWithCharacter")("attack", "1d8 + 3", request), true);
        await settle();
        assert.deepEqual(ctx.log.slotSpends, [], `${JSON.stringify(options)}: nothing spent`);
        assert.equal(sheet.state.tab, "Inventory", `${JSON.stringify(options)}: restored`);
    }
});

section("9. Discovery unchanged: Smite rows and slots are still read from the Spells tab", async () => {
    const sheet = buildSheet({ tab: "Actions", smite: "available" });
    const ctx = createSandbox(sheet, { query: "select" });
    const options = await run(ctx, "wayBeyond20BuildSmiteOptions")();
    assert.ok(options, "options found after opening Spells");
    assert.deepEqual(JSON.parse(JSON.stringify(options.smites.map(smite => smite.name))), ["Divine Smite"]);
    assert.deepEqual(JSON.parse(JSON.stringify(options.fuels.map(fuel => fuel.type))), ["spell-slot"]);
});

section("10. Tab buttons re-rendered during discovery: the starting tab is found again by its label", async () => {
    const sheet = buildSheet({ tab: "Inventory", smite: "none", rerenderTabs: true });
    const ctx = createSandbox(sheet);
    await attack(ctx);
    await settle();
    assert.equal(sheet.state.tab, "Inventory");
    assert.deepEqual(sheet.state.tabClicks, ["Spells", "Inventory"]);
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
        console.log(`WayBeyond20 v1.65.2 Smite tab restore checks: ${failures} of ${sections.length} sections failed.`);
        process.exit(1);
    }
    console.log("WayBeyond20 v1.65.2 Smite tab restore checks passed.");
})();
