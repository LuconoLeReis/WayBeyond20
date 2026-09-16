// WB20-0065 (live report, 2026-09-13): after a Divine Smite fueled by Paladin's Smite with
// the Elemental Strike rider, D&D Beyond still showed "Use" and "1/LR" on the Spells tab. The rider
// shows the Actions tab to read Channel Divinity, so the Spells rows were unmounted when the spend
// ran; the old code clicked a detached cached row and treated "row not found" as spent.
// Runs the real content-script spend and the real page-script spend against a small sheet model.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const read = relative => fs.readFileSync(path.join(root, ...relative.split("/")), "utf8");
const characterSource = read("src/dndbeyond/content-scripts/character.js");
const brokerSource = read("src/dndbeyond/page-scripts/message-broker.js");

function topLevelFunction(source, name) {
    const match = new RegExp(`^(?:async )?function ${name}\\(`, "m").exec(source);
    assert.ok(match, `Missing function ${name}`);
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

// ---- Sheet model ---------------------------------------------------------------------------
// Spells rows exist in the DOM only while the Spells tab is showing, as on D&D Beyond.
function makeSheet({ tab = "Actions", used = false, clickWorks = true, hasSpellsTab = true } = {}) {
    const state = { tab, used, clickWorks, useClicks: 0, tabClicks: [] };
    const labels = ["Actions", hasSpellsTab ? "Spells" : null, "Inventory", "Features & Traits"].filter(Boolean);
    const tabs = labels.map(label => ({
        textContent: label,
        isConnected: true,
        getAttribute: name => name === "aria-checked" ? String(state.tab === label) : null,
        classList: { contains: () => false },
        click() { state.tabClicks.push(label); state.tab = label; }
    }));
    const button = {
        textContent: "Use",
        disabled: false,
        getAttribute: () => null,
        get isConnected() { return state.tab === "Spells"; },
        click() {
            state.useClicks++;
            if (state.clickWorks && state.tab === "Spells") state.used = true;
        }
    };
    const row = {
        get isConnected() { return state.tab === "Spells"; },
        get textContent() {
            return `Divine Smite Paladin's Smite 1BA Self -- 2d8 ${state.used ? "1/LR (Used), V" : "1/LR, V"}`;
        },
        querySelectorAll: selector => selector === "button" ? [button] : [],
        querySelector: selector => /label|spellName/.test(selector) ? { textContent: "Divine Smite" }
            : /meta|spellMeta/.test(selector) ? { textContent: "Paladin's Smite" } : null
    };
    const document = {
        querySelectorAll(selector) {
            if (/spells-spell/.test(selector)) return state.tab === "Spells" ? [row] : [];
            if (/button/.test(selector)) return tabs;
            return [];
        }
    };
    const $ = element => ({
        find: selector => ({
            first: () => ({ text: () => (element.querySelector(selector) || { textContent: "" }).textContent })
        })
    });
    return { state, document, $, row, button };
}

const immediate = fn => { setImmediate(fn); return 0; };

// ---- Content script ------------------------------------------------------------------------
const CONTENT_FUNCTIONS = [
    "wayBeyond20NormalizeFeatureLabel", "wayBeyond20CharacterSheetTab", "wayBeyond20InvalidateSmiteSpellCache",
    "wayBeyond20PaladinSmiteUseTextIsUsed", "wayBeyond20LivePaladinSmiteUse", "wayBeyond20ActiveCharacterSheetTab",
    "wayBeyond20WaitForPaladinSmiteUsed", "wayBeyond20SpendPaladinSmiteFreeUse", "wayBeyond20PaladinSmiteFreeUseAvailable"
];

function contentSandbox(sheet, pageSpend) {
    const sandbox = {
        document: sheet.document,
        $: sheet.$,
        setTimeout: immediate,
        character: { getSetting: () => false },
        wayBeyond20PreparedSmiteCache: [{ stale: true }],
        wayBeyond20SpellSlotCache: null,
        debug: [],
        pageRequests: 0
    };
    sandbox.wayBeyond20CharacterDebug = (message, data) => sandbox.debug.push(message);
    vm.createContext(sandbox);
    vm.runInContext(CONTENT_FUNCTIONS.map(name => topLevelFunction(characterSource, name)).join("\n"), sandbox);
    // The page-script round trip is replaced by a model of what the page did.
    sandbox.wayBeyond20RequestPagePaladinSmiteSpend = async () => { sandbox.pageRequests++; return pageSpend(sheet); };
    return sandbox;
}

const pageClicks = sheet => { sheet.button.click(); return { spent: sheet.state.used }; };
const pageLies = () => ({ spent: true, method: "main-native-click" });
const pageFails = () => ({ spent: false, method: "no-available-use" });

(async () => {
  // 1. Reported case: rider left the Actions tab showing. The spend opens Spells, marks D&D Beyond's
    //    own use, and returns to Actions.
    {
        const sheet = makeSheet({ tab: "Actions" });
        const sandbox = contentSandbox(sheet, pageClicks);
        assert.equal(await sandbox.wayBeyond20SpendPaladinSmiteFreeUse(), true);
        assert.equal(sheet.state.used, true, "D&D Beyond row must show the use as spent");
        assert.equal(sheet.state.useClicks, 1, "exactly one native Use click");
        assert.deepEqual(sheet.state.tabClicks, ["Spells", "Actions"]);
        assert.equal(sheet.state.tab, "Actions");
        assert.equal(sandbox.wayBeyond20PreparedSmiteCache, null, "stale prepared rows are dropped");
    }
    // 2. Already on Spells: no tab changes.
    {
        const sheet = makeSheet({ tab: "Spells" });
        const sandbox = contentSandbox(sheet, pageClicks);
        assert.equal(await sandbox.wayBeyond20SpendPaladinSmiteFreeUse(), true);
        assert.equal(sheet.state.used, true);
        assert.deepEqual(sheet.state.tabClicks, []);
    }
    // 3. The page reports success but the sheet did not change: not success, so the caller warns.
    //    The content fallback clicks once; it does not work either.
    {
        const sheet = makeSheet({ tab: "Actions", clickWorks: false });
        const sandbox = contentSandbox(sheet, pageLies);
        assert.equal(await sandbox.wayBeyond20SpendPaladinSmiteFreeUse(), false);
        assert.equal(sheet.state.used, false);
        assert.equal(sheet.state.useClicks, 1);
        assert.equal(sheet.state.tab, "Actions", "the previous tab is restored after a failure");
    }
    // 4. Page path fails but the content fallback click works.
    {
        const sheet = makeSheet({ tab: "Actions" });
        const sandbox = contentSandbox(sheet, pageFails);
        assert.equal(await sandbox.wayBeyond20SpendPaladinSmiteFreeUse(), true);
        assert.equal(sheet.state.used, true);
        assert.equal(sheet.state.useClicks, 1);
    }
    // 5. Already marked on D&D Beyond: nothing is clicked (no toggle back), reported as spent.
    {
        const sheet = makeSheet({ tab: "Actions", used: true });
        const sandbox = contentSandbox(sheet, pageClicks);
        assert.equal(await sandbox.wayBeyond20SpendPaladinSmiteFreeUse(), true);
        assert.equal(sheet.state.useClicks, 0);
        assert.equal(sandbox.pageRequests, 0);
    }
    // 6. No Spells tab or row: never success.
    {
        const sheet = makeSheet({ tab: "Actions", hasSpellsTab: false });
        const sandbox = contentSandbox(sheet, pageLies);
        assert.equal(await sandbox.wayBeyond20SpendPaladinSmiteFreeUse(), false);
        assert.equal(sheet.state.useClicks, 0);
    }
    // 7. Fuel offer respects D&D Beyond's "(Used)" marker even when the extension's flag is unset.
    {
        const sandbox = contentSandbox(makeSheet(), pageClicks);
        const row = used => ({
            name: "Divine Smite", meta: "Paladin's Smite", action: "use", disabled: false,
            text: `Divine Smite Paladin's Smite 1BA Self 2d8 ${used ? "1/LR (Used), V" : "1/LR, V"}`
        });
        assert.equal(sandbox.wayBeyond20PaladinSmiteFreeUseAvailable([row(false)]), true);
        assert.equal(sandbox.wayBeyond20PaladinSmiteFreeUseAvailable([row(true)]), false);
    }

    // ---- Page script ---------------------------------------------------------------------------
    const pageSource = between(brokerSource, "    function b20PaladinSmiteUseEntry()", "    function spendPaladinSmiteUse(");
    function pageSandbox(sheet, onReactClick = () => null) {
        const sandbox = { document: sheet.document, setTimeout: immediate };
        sandbox.b20InvokeLimitedUseReactHandler = (control, name) => onReactClick(control, name);
        vm.createContext(sandbox);
        vm.runInContext(pageSource, sandbox);
        return sandbox;
    }
    // 8. Native click works: spent.
    {
        const sheet = makeSheet({ tab: "Spells" });
        const result = await pageSandbox(sheet).b20SpendPaladinSmiteUseInPage();
        assert.equal(result.spent, true);
        assert.equal(sheet.state.used, true);
    }
    // 9. The row unmounts after the click without the use being marked (tab change): the old code
    //    called this spent. It is not.
    {
        const sheet = makeSheet({ tab: "Spells", clickWorks: false });
        const originalClick = sheet.button.click;
        sheet.button.click = function () { originalClick.call(this); sheet.state.tab = "Actions"; };
        const result = await pageSandbox(sheet).b20SpendPaladinSmiteUseInPage();
        assert.equal(result.spent, false);
        assert.equal(sheet.state.used, false);
    }
    // 10. Native click ignored; the React handler marks it.
    {
        const sheet = makeSheet({ tab: "Spells", clickWorks: false });
        const result = await pageSandbox(sheet, () => { sheet.state.used = true; return "onClick"; })
            .b20SpendPaladinSmiteUseInPage();
        assert.equal(result.spent, true);
        assert.equal(result.method, "react-onClick");
    }
    // 11. Row not showing: nothing clicked, not spent.
    {
        const sheet = makeSheet({ tab: "Actions" });
        const result = await pageSandbox(sheet).b20SpendPaladinSmiteUseInPage();
        assert.deepEqual({ spent: result.spent, method: result.method }, { spent: false, method: "no-available-use" });
        assert.equal(sheet.state.useClicks, 0);
    }

    console.log("WayBeyond20 v1.65 Paladin's Smite native use checks passed.");
})().catch(error => {
    console.error(error);
    process.exit(1);
});
