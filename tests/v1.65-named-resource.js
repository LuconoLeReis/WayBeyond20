// WB20-0065 brief 1.9/1.10, correction 1: a limited-use control is spent only for the feature whose
// own bounded row owns it. Runs the real content discovery, preflight, native-action mapping,
// dispatch commit and page-context spend (message-broker.js, over a simulated custom-event bridge)
// against one Actions surface holding a Natural Attack row and an Unarmed Strike row with no
// counter, four Bardic Inspiration uses, two Breath Weapon uses, and two Channel Divinity uses.
// The surface is a test model of D&D Beyond's structure, not captured markup.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createDocument, h, miniJQuery } = require("./helpers/mini-dom");

const root = path.resolve(__dirname, "..");
const read = relative => fs.readFileSync(path.join(root, ...relative.split("/")), "utf8");
const characterSource = read("src/dndbeyond/content-scripts/character.js");
const brokerSource = read("src/dndbeyond/page-scripts/message-broker.js");
const baseUtilsSource = read("src/dndbeyond/base/utils.js");

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
    "wayBeyond20LimitedUseInputForControl", "wayBeyond20LimitedUseControlIsVisible",
    "wayBeyond20LimitedUseCanonicalControl", "wayBeyond20LimitedUseControlIsUnused",
    "wayBeyond20LimitedUseControlMatchesFeature", "wayBeyond20FindLimitedUseControls",
    "wayBeyond20WaitForLimitedUseSpend", "wayBeyond20RequestPageLimitedUseSpend", "wayBeyond20SpendLimitedUse",
    "wayBeyond20PreflightLimitedUse", "wayBeyond20AttachLimitedUse", "wayBeyond20LimitedUseFeatureForAction",
    "wayBeyond20AttachNativeActionUse", "wayBeyond20CharacterSheetTab", "wayBeyond20ExposeChannelDivinityControls",
    "wayBeyond20ActivationResource", "wayBeyond20AttachTurnResource", "wayBeyond20AttachAdditionalTurnResource",
    "wayBeyond20AttachActivationResource", "wayBeyond20PaladinSaveDC", "wayBeyond20RollIsUnarmedStrike",
    "wayBeyond20NormalizeAttackSemantics", "wayBeyond20ApplyDrainingAttackIntent",
    "wayBeyond20ElementalStrikeChoice", "wayBeyond20ElementalStrikeSummary", "wayBeyond20HasElementalStrike",
    "wayBeyond20ApplyElementalStrikeEffect", "wayBeyond20MaybeAddElementalStrike",
    "wayBeyond20RollElementalStrikeOption"
];
// Introduced by the correction; absent when this suite is run against the pre-correction source.
const OPTIONAL_CONTENT_FUNCTIONS = [
    "wayBeyond20LimitedUseSelectors", "wayBeyond20LimitedUseLabelsWithin", "wayBeyond20LimitedUseLabelText",
    "wayBeyond20LimitedUseControlOwnerLabel"
];

const pageSource = between(brokerSource, "    function b20LimitedUseElementVisible(", "    function b20SpellSlotHeaderLevel(");

// ---- Actions surface ------------------------------------------------------------------------
function buildSheet({ clicksWork = true, unlabeledChannelDivinity = false, extraRows = [] } = {}) {
    const state = { clicksWork, clicks: [] };
    const document = createDocument();
    const box = (pool, index) => {
        const element = h("div", {
            role: "checkbox", "aria-label": "use", "aria-checked": "false",
            class: "ct-slot-manager__slot ct-slot-manager__slot--interactive", "data-pool": pool, "data-index": index
        });
        element.onclick = () => {
            state.clicks.push(`${pool}#${index}`);
            if (!state.clicksWork) return;
            element.setAttribute("aria-checked", element.getAttribute("aria-checked") === "true" ? "false" : "true");
        };
        return element;
    };
    const attackRow = name => h("div", { class: "ddbc-combat-attack" },
        h("div", { class: "ddbc-combat-attack__name" }, h("span", { class: "ddbc-combat-attack__label" }, name)),
        h("div", { class: "ddbc-combat-attack__tohit" }, "+5"));
    const snippet = (name, pool, uses, description, { heading = true } = {}) => h("div", { class: "ct-feature-snippet" },
        heading ? h("div", { class: "ct-feature-snippet__heading" }, name, h("span", { class: "ct-feature-snippet__meta" }, " 1 Action")) : null,
        h("div", { class: "ct-feature-snippet__content" }, h("p", {}, description)),
        h("div", { class: "ct-slot-manager" }, ...Array.from({ length: uses }, (_, index) => box(pool, index))));
    const tabs = h("div", { class: "ct-primary-box__tabs" },
        h("button", { role: "radio", "aria-checked": "true" }, "Actions"),
        h("button", { role: "radio", "aria-checked": "false" }, "Spells"));
    document.body.append(tabs, h("div", { class: "ct-actions" },
        h("div", { class: "ct-actions-list" },
            attackRow("Fangs/Claws (Dexterity)"),
            attackRow("Unarmed Strike"),
            attackRow("Channel Divinity: Efreeti’s Fury"),
            h("div", { class: "ct-actions-list__activatable" },
                snippet("Bardic Inspiration", "bardic", 4, "You can inspire others through dance."),
                snippet("Breath Weapon", "breath", 2, "Some features let you use your Channel Divinity instead."),
                snippet("Channel Divinity", "channel", 2, "You can channel divine energy.", { heading: !unlabeledChannelDivinity }),
                ...extraRows.map(build => build({ box, snippet }))))));
    const unused = pool => document.querySelectorAll(`[data-pool='${pool}']`)
        .filter(element => element.getAttribute("aria-checked") !== "true").length;
    const counts = () => ({ bardic: unused("bardic"), breath: unused("breath"), channel: unused("channel") });
    return { document, state, counts, unused };
}

const FULL = { bardic: 4, breath: 2, channel: 2 };

function createSandbox(sheet, { sendResult = true, turnAllowed = true, features = ["Elemental Strike"] } = {}) {
    const log = { warnings: [], dispatched: [], debug: [], pageRequests: 0 };
    const { document } = sheet;
    const addCustomEventListener = (name, callback) => {
        const handler = event => callback(...event.detail);
        document.addEventListener(name, handler);
        return [name, handler];
    };
    const sendCustomEvent = (name, args) => {
        setTimeout(() => document.root.dispatchEvent({ type: name, detail: args }), 0);
    };
    const character = {
        _id: 1, _name: "Test Sheet", _proficiency: 2, _spell_saves: { Paladin: 13 },
        hasClassFeature: (name, substring) => features.some(feature => substring ? feature.includes(name) : feature === name),
        hasAction: () => false,
        hasRacialTrait: () => false,
        getSetting: (key, fallback) => fallback,
        mergeCharacterSettings() {}
    };
    const context = {
        console, Promise, document, character, log, key_modifiers: {},
        window: { getComputedStyle: element => element.style, location: { pathname: "/characters/test" } },
        Node: { TEXT_NODE: 3 },
        $: miniJQuery,
        // Timers run 25x faster than written so waits stay proportionate (page before content timeout).
        setTimeout: (fn, ms) => setTimeout(fn, Math.ceil((Number(ms) || 0) / 25)),
        addCustomEventListener, sendCustomEvent,
        alertify: { warning: message => log.warnings.push(message) },
        wayBeyond20CharacterDebug: message => log.debug.push(message),
        wayBeyond20DescribeElement: element => element ? `${element.getAttribute("data-pool")}#${element.getAttribute("data-index")}` : null,
        wayBeyond20QueryElementalStrike: async () => context.nextElementalChoice,
        wayBeyond20PreflightTurnResource: async () => turnAllowed,
        wayBeyond20SpendTurnResource() {},
        wayBeyond20GetTrackedSpellEffects: () => [],
        wayBeyond20EffectName: () => "",
        wayBeyond20TrackSelfFeatureEffect() {},
        wayBeyond20RemoveTrackedEffect() {},
        wayBeyond20SetIntrusionDie() {},
        wayBeyond20SpendSpellSlot: async () => true,
        wayBeyond20SpendPaladinSmiteFreeUse: async () => true,
        abbreviationToAbility: value => value,
        damagesToCrits: (c, damages) => damages,
        sendRoll: async (char, rollType, fallback, request) => {
            if (sendResult !== true) return sendResult;
            log.dispatched.push({ rollType, name: request.name, limitedUse: request["waybeyond20-limited-use"] || null });
            return true;
        }
    };
    vm.createContext(context);
    vm.runInContext([
        between(characterSource, "const WAYBEYOND20_ELEMENTAL_STRIKE_CHOICES", "function wayBeyond20ElementalStrikeChoice("),
        ...CONTENT_FUNCTIONS.map(name => topLevelFunction(characterSource, name)),
        ...OPTIONAL_CONTENT_FUNCTIONS.map(name => topLevelFunction(characterSource, name, { optional: true })),
        pageSource,
        `addCustomEventListener("WayBeyond20SpendLimitedUse", (...args) => { log.pageRequests++; spendLimitedUse(...args); });`
    ].join("\n"), context);
    return context;
}

const run = (context, expression) => vm.runInContext(expression, context);
const attackRequest = name => ({ name, "to-hit": "+5", damages: ["1d6 + 3"], "damage-types": ["Slashing"], rollDamage: true });

// Every section runs; failures are collected so a pre-correction run shows each broken case.
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
    // 1. Discovery: each named pool finds exactly its own controls, in content and page context alike.
    await section("1. Discovery: each named pool finds exactly its own controls, in content and page context alike.", async () => {
        const sheet = buildSheet();
        const ctx = createSandbox(sheet);
        const expected = {
            "Bardic Inspiration": 4, "Breath Weapon": 2, "Channel Divinity": 2,
            "Fangs/Claws (Dexterity)": 0, "Unarmed Strike": 0, "Channel Divinity: Efreeti’s Fury": 0, "": 0
        };
        for (const [name, count] of Object.entries(expected)) {
            const content = run(ctx, "wayBeyond20FindLimitedUseControls")(name).controls;
            const page = run(ctx, "b20FindLimitedUseControls")(name);
            assert.equal(content.length, count, `content discovery for "${name}"`);
            assert.equal(page.length, count, `page discovery for "${name}"`);
            assert.deepEqual(page, content, `page and content agree for "${name}"`);
        }
        const pools = name => new Set(run(ctx, "wayBeyond20FindLimitedUseControls")(name).controls.map(c => c.getAttribute("data-pool")));
        assert.deepEqual([...pools("Bardic Inspiration")], ["bardic"]);
        assert.deepEqual([...pools("Breath Weapon")], ["breath"]);
        assert.deepEqual([...pools("Channel Divinity")], ["channel"]);
    });

    // 2. Native-action mapping: ordinary attacks attach nothing; explicit shared pools are kept.
    await section("2. Native-action mapping: ordinary attacks attach nothing; explicit shared pools are kept.", async () => {
        const sheet = buildSheet();
        const ctx = createSandbox(sheet);
        const attach = name => { const request = {}; const feature = run(ctx, "wayBeyond20AttachNativeActionUse")(request, name); return { feature, request }; };
        for (const name of ["Fangs/Claws (Dexterity)", "Unarmed Strike"]) {
            const { feature, request } = attach(name);
            assert.equal(feature, null, `${name} has no native use`);
            assert.equal(request["waybeyond20-limited-use"], undefined, `${name} carries no limited-use request`);
        }
        assert.equal(attach("Breath Weapon (Fire)").feature, "Breath Weapon");
        assert.equal(attach("Channel Divinity: Efreeti’s Fury").feature, "Channel Divinity");
        assert.equal(attach("Marid’s Surge").feature, "Channel Divinity");
    });

    // 3. Natural Attack and Unarmed Strike dispatch leave every pool unchanged (Bill's Bard evidence).
    for (const name of ["Fangs/Claws (Dexterity)", "Unarmed Strike"]) await section(`3. Natural Attack and Unarmed Strike dispatch leave every pool unchanged (Bill's Bard evidence). [${name}]`, async () => {
        const sheet = buildSheet();
        const ctx = createSandbox(sheet);
        const request = attackRequest(name);
        run(ctx, "wayBeyond20AttachNativeActionUse")(request, name);
        assert.equal(await run(ctx, "sendRollWithCharacter")("attack", "1d6 + 3", request), true);
        assert.deepEqual(sheet.counts(), FULL, `${name} changes no pool`);
        assert.deepEqual(sheet.state.clicks, [], `${name} clicks no counter`);
        assert.equal(ctx.log.pageRequests, 0);
        assert.deepEqual(ctx.log.warnings, []);
    });

    // 4. Bardic Inspiration spends exactly one Bardic Inspiration use.
    await section("4. Bardic Inspiration spends exactly one Bardic Inspiration use.", async () => {
        const sheet = buildSheet();
        const ctx = createSandbox(sheet);
        const preflight = await run(ctx, "wayBeyond20PreflightLimitedUse")("Bardic Inspiration", {});
        assert.deepEqual({ allowed: preflight.allowed, tracked: preflight.tracked, remaining: preflight.remaining }, { allowed: true, tracked: true, remaining: 4 });
        assert.equal(await run(ctx, "wayBeyond20SpendLimitedUse")("Bardic Inspiration"), true);
        assert.deepEqual(sheet.counts(), { bardic: 3, breath: 2, channel: 2 });
        assert.deepEqual(sheet.state.clicks, ["bardic#0"]);
    });

    // 5. Breath Weapon (two uses before Channel Divinity) spends exactly one Breath Weapon use.
    await section("5. Breath Weapon (two uses before Channel Divinity) spends exactly one Breath Weapon use.", async () => {
        const sheet = buildSheet();
        const ctx = createSandbox(sheet);
        const request = attackRequest("Breath Weapon (Fire)");
        run(ctx, "wayBeyond20AttachNativeActionUse")(request, "Breath Weapon (Fire)");
        assert.equal(await run(ctx, "sendRollWithCharacter")("attack", "1d10", request), true);
        assert.deepEqual(sheet.counts(), { bardic: 4, breath: 1, channel: 2 });
        assert.deepEqual(sheet.state.clicks, ["breath#0"]);
    });

    // 6. Independent Elemental Strike options each spend exactly one Channel Divinity, never Breath Weapon.
    for (const key of ["dao", "djinni", "efreeti", "marid"]) await section(`6. Independent Elemental Strike options each spend exactly one Channel Divinity, never Breath Weapon. [${key}]`, async () => {
        const sheet = buildSheet();
        const ctx = createSandbox(sheet);
        const choice = run(ctx, "wayBeyond20ElementalStrikeChoice")(key);
        const actionName = `Channel Divinity: ${choice.name}`;
        assert.equal(await run(ctx, "wayBeyond20RollElementalStrikeOption")(actionName, "Paladin", "", { "Activation Time": "1 Action" }), true);
        assert.deepEqual(sheet.counts(), { bardic: 4, breath: 2, channel: 1 }, `${key}: one Channel Divinity`);
        assert.deepEqual(sheet.state.clicks, ["channel#0"], `${key}: one click on the Channel Divinity pool`);
    });

    // 7. Divine Smite rider spends exactly one Channel Divinity, never Breath Weapon.
    await section("7. Divine Smite rider spends exactly one Channel Divinity, never Breath Weapon.", async () => {
        const sheet = buildSheet();
        const ctx = createSandbox(sheet);
        ctx.nextElementalChoice = run(ctx, "wayBeyond20ElementalStrikeChoice")("efreeti");
        const request = { name: "Divine Smite", damages: ["2d8"], "damage-types": ["Radiant"], rollDamage: true };
        const chosen = await run(ctx, "wayBeyond20MaybeAddElementalStrike")(request, "Divine Smite");
        assert.equal(chosen.key, "efreeti");
        assert.equal(await run(ctx, "sendRollWithCharacter")("spell-attack", "2d8", request), true);
        assert.deepEqual(sheet.counts(), { bardic: 4, breath: 2, channel: 1 });
        assert.deepEqual(sheet.state.clicks, ["channel#0"]);
    });

    // 8. Failed dispatch and Cancel (declined turn-resource advisory) spend nothing.
    for (const [label, options] of [["failed dispatch", { sendResult: false }], ["Cancel", { turnAllowed: false }]]) await section(`8. Failed dispatch and Cancel (declined turn-resource advisory) spend nothing. [${label}]`, async () => {
        const sheet = buildSheet();
        const ctx = createSandbox(sheet, options);
        const result = await run(ctx, "wayBeyond20RollElementalStrikeOption")("Channel Divinity: Dao’s Crush", "Paladin", "", { "Activation Time": "1 Action" });
        assert.notEqual(result, true, label);
        assert.deepEqual(sheet.counts(), FULL, `${label} spends nothing`);
        assert.deepEqual(sheet.state.clicks, []);
    });

    // 9. Missing ownership: an unlabeled Channel Divinity counter is never claimed by a neighbor.
    //    Nothing is spent and the dispatch reports that the use must be reconciled manually.
    await section("9. Missing ownership: an unlabeled Channel Divinity counter is never claimed by a neighbor.", async () => {
        const sheet = buildSheet({ unlabeledChannelDivinity: true });
        const ctx = createSandbox(sheet);
        assert.equal(run(ctx, "wayBeyond20FindLimitedUseControls")("Channel Divinity").controls.length, 0);
        assert.equal(run(ctx, "b20FindLimitedUseControls")("Channel Divinity").length, 0);
        const pageResult = await run(ctx, "b20SpendLimitedUseInPage")("Channel Divinity", 2);
        assert.equal(pageResult.spent, false);
        assert.equal(await run(ctx, "wayBeyond20RollElementalStrikeOption")("Channel Divinity: Efreeti’s Fury", "Paladin", "", { "Activation Time": "1 Action" }), true);
        assert.deepEqual(sheet.counts(), FULL, "no pool changes");
        assert.deepEqual(sheet.state.clicks, []);
        assert.equal(ctx.log.warnings.length, 1, "manual reconciliation warning after a successful dispatch");
        assert.match(ctx.log.warnings[0], /Channel Divinity/);
    });

    // 10. Ambiguous ownership in an unrecognized row: a wrapper holding two labels and one counter
    //     belongs to neither; single-label generic rows keep their own counters.
    await section("10. Ambiguous ownership in an unrecognized row: a wrapper holding two labels and one counter", async () => {
        const ambiguous = ({ box }) => h("div", { class: "styles_group__a" },
            h("div", { class: "styles_heading__b" }, "Second Wind"),
            h("div", { class: "styles_heading__b" }, "Action Surge"),
            h("div", {}, box("ambiguous", 0)));
        const generic = ({ box }) => h("div", { class: "styles_group__c" },
            h("div", { class: "styles_row__d" }, h("div", { class: "styles_heading__e" }, "Healing Hands"), h("div", {}, box("healing", 0))),
            h("div", { class: "styles_row__d" }, h("div", { class: "styles_heading__e" }, "Relentless Endurance"), h("div", {}, box("endurance", 0))));
        const sheet = buildSheet({ extraRows: [ambiguous, generic] });
        const ctx = createSandbox(sheet);
        for (const name of ["Second Wind", "Action Surge"]) {
            assert.equal(run(ctx, "wayBeyond20FindLimitedUseControls")(name).controls.length, 0, `${name} is ambiguous`);
            assert.equal(run(ctx, "b20FindLimitedUseControls")(name).length, 0, `${name} is ambiguous (page)`);
        }
        // Generic Talent support: an action whose own row shows a counter keeps it.
        const request = { name: "Healing Hands" };
        assert.equal(run(ctx, "wayBeyond20AttachNativeActionUse")(request, "Healing Hands"), "Healing Hands");
        assert.equal(await run(ctx, "sendRollWithCharacter")("trait", 0, request), true);
        assert.equal(sheet.unused("healing"), 0);
        assert.equal(sheet.unused("endurance"), 1);
        assert.deepEqual(sheet.counts(), FULL);
    });

    // 11. Duplicate callbacks: the same page request delivered twice spends one use.
    await section("11. Duplicate callbacks: the same page request delivered twice spends one use.", async () => {
        const sheet = buildSheet();
        const ctx = createSandbox(sheet);
        const results = [];
        const listener = run(ctx, "addCustomEventListener")("WayBeyond20LimitedUseResult", (id, result) => results.push(result));
        run(ctx, "sendCustomEvent")("WayBeyond20SpendLimitedUse", ["dup-1", "Channel Divinity", 2]);
        run(ctx, "sendCustomEvent")("WayBeyond20SpendLimitedUse", ["dup-1", "Channel Divinity", 2]);
        await new Promise(resolve => setTimeout(resolve, 200));
        sheet.document.removeEventListener(...listener);
        assert.deepEqual(sheet.counts(), { bardic: 4, breath: 2, channel: 1 }, "one Channel Divinity");
        assert.deepEqual(sheet.state.clicks, ["channel#0"], "one click");
        assert.ok(results.length >= 1 && results.every(result => !result || result.spent !== false || result.method === "duplicate-request"));
    });

    // 12. A native click D&D Beyond ignores: nothing flips, and the dispatch warns instead of guessing.
    await section("12. A native click D&D Beyond ignores: nothing flips, and the dispatch warns instead of guessing.", async () => {
        const sheet = buildSheet({ clicksWork: false });
        const ctx = createSandbox(sheet);
        const request = attackRequest("Breath Weapon (Fire)");
        run(ctx, "wayBeyond20AttachNativeActionUse")(request, "Breath Weapon (Fire)");
        assert.equal(await run(ctx, "sendRollWithCharacter")("attack", "1d10", request), true);
        assert.deepEqual(sheet.counts(), FULL);
        assert.ok(sheet.state.clicks.every(click => click.startsWith("breath#")), "only Breath Weapon controls were tried");
        assert.equal(ctx.log.warnings.length, 1);
        assert.match(ctx.log.warnings[0], /Breath Weapon/);
    });

    // 13. Modifier-class feature rows (ct-feature-snippet--class with a hashed styles_heading), as the
    //     Features tab uses, keep their own counters despite a meta label and another feature named in
    //     the description; the Features-tab Arcane Recovery caller relies on this.
    await section("13. Modifier-class feature rows own their counters", async () => {
        const featureRow = (name, pool, uses, description) => ({ box }) => h("div", { class: "ct-feature-snippet--class" },
            h("div", { class: "styles_heading__q1" }, name, h("span", { class: "styles_label__q2" }, " 1 / Long Rest")),
            h("div", { class: "styles_content__q3" }, h("p", {}, h("strong", {}, "Channel Divinity"), description)),
            h("div", { class: "ct-slot-manager" }, ...Array.from({ length: uses }, (_, index) => box(pool, index))));
        const sheet = buildSheet({ extraRows: [
            featureRow("Arcane Recovery", "arcane", 1, " is mentioned here only as text."),
            featureRow("Divine Sense", "sense", 3, " also appears here.")
        ] });
        const ctx = createSandbox(sheet);
        for (const [name, pool, count] of [["Arcane Recovery", "arcane", 1], ["Divine Sense", "sense", 3]]) {
            const content = run(ctx, "wayBeyond20FindLimitedUseControls")(name).controls;
            assert.equal(content.length, count, `${name} content discovery`);
            assert.ok(content.every(control => control.getAttribute("data-pool") === pool));
            assert.deepEqual(run(ctx, "b20FindLimitedUseControls")(name), content, `${name} page discovery agrees`);
        }
        assert.equal(run(ctx, "wayBeyond20FindLimitedUseControls")("Channel Divinity").controls.length, 2, "description text claims nothing");
        assert.equal(await run(ctx, "wayBeyond20SpendLimitedUse")("Arcane Recovery"), true);
        assert.equal(sheet.unused("arcane"), 0);
        assert.equal(sheet.unused("sense"), 3);
        assert.deepEqual(sheet.counts(), FULL);
    });

    // 14. An unlabeled counter beside a Natural Attack row in an unrecognized wrapper belongs to nobody:
    //     the attack row's label names that row, and the counter adds no controls to it.
    await section("14. Unlabeled counter beside an attack row is not claimed by the attack", async () => {
        const wrapper = ({ box }) => h("div", { class: "styles_wrapper__z1" },
            h("div", { class: "ddbc-combat-attack" },
                h("div", { class: "ddbc-combat-attack__name" }, h("span", { class: "ddbc-combat-attack__label" }, "Bite")),
                h("div", { class: "ddbc-combat-attack__tohit" }, "+4")),
            h("div", { class: "styles_counter__z2" }, box("orphan", 0), box("orphan", 1)));
        const sheet = buildSheet({ extraRows: [wrapper] });
        const ctx = createSandbox(sheet);
        assert.equal(run(ctx, "wayBeyond20FindLimitedUseControls")("Bite").controls.length, 0);
        assert.equal(run(ctx, "b20FindLimitedUseControls")("Bite").length, 0);
        const request = attackRequest("Bite");
        assert.equal(run(ctx, "wayBeyond20AttachNativeActionUse")(request, "Bite"), null);
        assert.equal(await run(ctx, "sendRollWithCharacter")("attack", "1d6 + 2", request), true);
        assert.equal(sheet.unused("orphan"), 2);
        assert.deepEqual(sheet.counts(), FULL);
    });

    // 15. Live markup (2026-09-14, test sheet): the Breath Weapon counter row is titled after the
    //     ancestry, "Breath Weapon (Fire)", matching the action row. The action spends that row's
    //     counter; a sheet whose row is titled plain "Breath Weapon" still maps to the shared name.
    await section("15. Breath Weapon (Fire) row title spends its own counter", async () => {
        const fireRow = ({ box, snippet }) => snippet("Breath Weapon (Fire)", "breathfire", 2, "Exhale destructive energy.");
        const sheet = buildSheet({ extraRows: [fireRow] });
        const ctx = createSandbox(sheet);
        const request = attackRequest("Breath Weapon (Fire)");
        assert.equal(run(ctx, "wayBeyond20AttachNativeActionUse")(request, "Breath Weapon (Fire)"), "Breath Weapon (Fire)");
        assert.equal(await run(ctx, "sendRollWithCharacter")("attack", "1d10", request), true);
        assert.equal(sheet.unused("breathfire"), 1, "one use of the titled row");
        assert.deepEqual(sheet.counts(), FULL, "plain Breath Weapon, Bardic Inspiration and Channel Divinity unchanged");
        assert.deepEqual(ctx.log.warnings, []);
        // Plain-titled pool (the base fixture's "Breath Weapon" row): the shared name is used.
        const plain = buildSheet();
        const plainCtx = createSandbox(plain);
        assert.equal(run(plainCtx, "wayBeyond20AttachNativeActionUse")({}, "Breath Weapon (Fire)"), "Breath Weapon");
    });

    if (failures.length) { console.error(`${failures.length} section(s) failed.`); process.exit(1); }
    console.log("WayBeyond20 v1.65.1 named limited-use ownership checks passed.");
})().catch(error => {
    console.error(error);
    process.exit(1);
});
