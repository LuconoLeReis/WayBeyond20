// WB20-0065 F03: helper switches are per character, default on, shown in the
// popup, persisted, reported, and read through the character accessor.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const read = relative => fs.readFileSync(path.join(root, ...relative.split("/")), "utf8");
const settingsSource = read("src/common/settings.js");
const baseSource = read("src/dndbeyond/base/base.js");
const characterSource = read("src/dndbeyond/content-scripts/character.js");
const popupSource = read("src/extension/popup.js");
const optionsSource = read("src/extension/options.js");

const HELPERS = [
    "paladin-smite-prompt",
    "wizard-occultist-intrusion-helper",
    "wizard-arcane-recovery-helper",
    "waybeyond20-ritual-casting-helper",
    "waybeyond20-mage-armor-helper",
    "waybeyond20-concentration-check-helper",
    "waybeyond20-condition-casting-warning",
    "musician-rest-reminder"
];

function between(source, startText, endText) {
    const start = source.indexOf(startText);
    const end = source.indexOf(endText, start + startText.length);
    assert.notEqual(start, -1, `Missing ${startText}`);
    assert.notEqual(end, -1, `Missing ${endText}`);
    return source.slice(start, end);
}

// Slice one top-level function declaration (declarations start at column 0).
function topLevelFunction(source, name) {
    const match = new RegExp(`^(?:async )?function ${name}\\(`, "m").exec(source);
    assert.ok(match, `Missing function ${name}`);
    const rest = source.slice(match.index + match[0].length);
    const next = /^(?:async )?function |^(?:const|let|var|class) /m.exec(rest);
    return source.slice(match.index, next ? match.index + match[0].length + next.index : source.length);
}

const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const flush = async () => {
    for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve));
};

function createChrome(storage, messages) {
    return {
        storage: {
            local: {
                get(query, cb) {
                    if (query === null) return cb(clone(storage));
                    const items = {};
                    for (const key of Object.keys(query)) {
                        items[key] = storage[key] !== undefined ? clone(storage[key]) : query[key];
                    }
                    cb(items);
                },
                set(values, cb) {
                    for (const key of Object.keys(values)) storage[key] = clone(values[key]);
                    if (cb) cb();
                }
            },
            sync: { get: (query, cb) => cb({}) }
        },
        runtime: {
            lastError: undefined,
            sendMessage: message => messages.push(clone(message)),
            getManifest: () => ({ version: "test" })
        }
    };
}

// Minimal popup DOM: E.* builds nodes, $("#id") finds rendered inputs.
function createPopupDom() {
    const byId = new Map();
    const node = (tag, attrs = {}, children = []) => {
        const n = { tag, attrs: Object.assign({}, attrs), children: children.filter(c => c !== null && c !== undefined), classes: new Set(), checked: false, value: "", textValue: "" };
        n.classList = { add: c => n.classes.add(c), contains: c => n.classes.has(c) };
        return n;
    };
    const register = n => {
        if (!n || typeof n !== "object") return;
        if (n.attrs && n.attrs.id) byId.set(n.attrs.id, n);
        (n.children || []).forEach(register);
    };
    const list = node("ul");
    const wrap = nodes => {
        const w = {
            length: nodes.length,
            append(...items) { for (const item of items) { nodes[0].children.push(item); register(item); } return w; },
            after(item) { register(item); list.children.push(item); return w; },
            prop(name, value) {
                if (value === undefined) return nodes[0] ? nodes[0][name] : undefined;
                nodes.forEach(n => { n[name] = value; });
                return w;
            },
            val(value) {
                if (value === undefined) return nodes[0] ? nodes[0].value : undefined;
                nodes.forEach(n => { n.value = value; });
                return w;
            },
            text(value) {
                if (value === undefined) return nodes[0] ? nodes[0].textValue : "";
                nodes.forEach(n => { n.textValue = value; });
                return w;
            },
            find: () => wrap([]),
            toArray: () => nodes
        };
        for (const method of ["addClass", "removeClass", "show", "hide", "off", "on", "change"]) w[method] = () => w;
        return w;
    };
    const $ = selector => {
        if (selector === ".beyond20-options") return wrap([list]);
        if (typeof selector === "string" && selector.startsWith("#")) {
            const found = byId.get(selector.slice(1));
            return wrap(found ? [found] : []);
        }
        return wrap([]);
    };
    const E = new Proxy({}, { get: (_, tag) => (attrs, ...children) => node(tag, attrs, children) });
    return { $, E, byId, list };
}

function createExtensionContext(storage, messages, dom = createPopupDom()) {
    const ctx = {
        chrome: createChrome(storage, messages),
        console: { log() {}, debug() {}, warn() {}, error() {} },
        getPlatform: () => "Windows",
        $: dom.$,
        E: dom.E,
        setImmediate
    };
    vm.createContext(ctx);
    vm.runInContext(settingsSource, ctx);
    // Special (non-bool) character options build unrelated widgets; keep them inert.
    vm.runInContext(`
        for (const key in character_settings) {
            if (character_settings[key].type === "special") {
                character_settings[key].createHTMLElement = () => E.li({});
                character_settings[key].set = () => {};
                character_settings[key].get = () => null;
            }
        }
    `, ctx);
    return { ctx, dom };
}

const loadStored = (ctx, key) => new Promise(resolve =>
    ctx.getStoredSettings(resolve, key, vm.runInContext("character_settings", ctx)));

function characterResponse(id, settings) {
    return { name: `Test ${id}`, id, settings, "racial-traits": [], "class-features": [], feats: [], classes: {} };
}

function createPopup(storage, messages) {
    const env = createExtensionContext(storage, messages);
    vm.runInContext(between(popupSource, "var character = null;", "function addMonsterOptions"), env.ctx);
    // Global options are outside this batch; deliver empty global settings.
    vm.runInContext("initializeSettings = cb => cb({});", env.ctx);
    return env;
}

// Content-script accessor: real CharacterBase.getSetting plus the helper read paths.
function createCharacter(ctx, id, storedSettings) {
    vm.runInContext("var window = { location: { href: '' } }; var key_modifiers = {}; var dndbeyondDiceRoller = { setSettings() {} }; function updateRollTypeButtonClasses() {}", ctx);
    if (!vm.runInContext("typeof CharacterBase", ctx).startsWith("function")) {
        vm.runInContext(between(baseSource, "class CharacterBase", "\n}\n") + "\n}\nthis.CharacterBase = CharacterBase;", ctx);
    }
    const character = new ctx.CharacterBase("Character", {});
    character._id = id;
    character._settings = storedSettings;
    character._conditions = ["Stunned"];
    character.hasFeat = () => true;
    character.hasClassFeature = () => true;
    return character;
}

function createHelperJq() {
    const make = el => {
        const w = {
            el,
            length: el ? 1 : 0,
            addClass(c) { if (el) el.classes.push(c); return w; },
            attr(k, v) { if (v === undefined) return el ? el.attrs[k] : undefined; if (el) el.attrs[k] = v; return w; },
            empty() { if (el) el.children = []; return w; },
            append(child) { if (el && child && child.el) { child.el.parent = el; el.children.push(child.el); } return w; },
            children: () => ({ length: el ? el.children.length : 0 }),
            text(t) { if (t === undefined) return el ? el.text : ""; if (el) el.text = t; return w; },
            prop(k, v) { if (el) el.props[k] = v; return w; },
            on: () => w,
            off: () => w,
            remove() { if (el) el.removed = true; return w; },
            parent: () => make(el ? el.parent || null : null),
            first: () => w,
            find: () => make(null),
            each: () => w,
            removeClass: () => w
        };
        return w;
    };
    const newEl = tag => ({ tag, classes: [], attrs: {}, props: {}, children: [], text: "" });
    const $ = arg => {
        if (typeof arg === "string" && arg.startsWith("<")) return make(newEl(arg.match(/^<(\w+)/)[1]));
        if (typeof arg === "string") return make(null);
        return make(arg);
    };
    const texts = el => [el.text, ...el.children.flatMap(texts)].filter(Boolean);
    return { $, newEl, make, texts };
}

async function exerciseHelpers(character, globalSettings) {
    const jq = createHelperJq();
    const calls = { bonusAction: 0, query: 0, musician: 0, popout: 0, concentrationCheck: 0, upsert: [] };
    const row = jq.newEl("div");
    const anchor = jq.newEl("span");
    anchor.parent = row;
    const ctx = {
        character,
        settings: globalSettings,
        $: jq.$,
        alertify: { message: () => { calls.musician++; } },
        dndbeyondDiceRoller: { queryGeneric: async (title, question, choices, id, order, fallback) => { calls.query++; return title === "Ritual Casting" ? "ritual" : "none"; } },
        wayBeyond20HasAvailableBonusAction: () => { calls.bonusAction++; return false; },
        wayBeyond20GetTrackedSpellEffects: () => [],
        wayBeyond20HasOccultistIntrusion: () => true,
        wayBeyond20SpellCastLevel: () => 1,
        wayBeyond20AvailableSpellSlots: () => [{ level: 1, available: 1 }],
        wayBeyond20GetConcentrationEffect: () => ({ name: "Bless" }),
        wayBeyond20RunConcentrationCheck: () => { calls.concentrationCheck++; },
        wayBeyond20OpenEffectsPopout: () => { calls.popout++; },
        wayBeyond20EffectName: effect => String(effect.name).toLowerCase(),
        wayBeyond20FindVisibleTextElement: () => jq.make(jq.newEl("h2")),
        wayBeyond20BuildActiveEffectMechanics: () => ({ baseArmor: 13 }),
        wayBeyond20UpsertEffectBadge: (header, className, label) => { calls.upsert.push(label); },
        wayBeyond20IsMainCharacterSheet: () => true,
        wayBeyond20SpellTabIsActive: () => true,
        wayBeyond20SpellTabAnchor: () => jq.make(anchor),
        wayBeyond20GetIntrusionDie: () => 8,
        wayBeyond20OccultistStartingDie: () => 8,
        WAYBEYOND20_INTRUSION_DICE: [2, 3, 4, 6, 8, 10, 12]
    };
    vm.createContext(ctx);
    for (const name of [
        "wayBeyond20CharacterHelperEnabled",
        "wayBeyond20ShowMusicianRestReminder",
        "wayBeyond20InjectWizardHelpers",
        "wayBeyond20InjectMageArmorBadge",
        "wayBeyond20HandleConcentrationBadge",
        "wayBeyond20BuildSmiteOptions",
        "wayBeyond20ChooseRitualMode",
        "wayBeyond20CastingConflicts",
        "wayBeyond20ApplyOccultistIntrusion"
    ]) {
        vm.runInContext(topLevelFunction(characterSource, name), ctx);
    }

    ctx.wayBeyond20ShowMusicianRestReminder("long");
    ctx.wayBeyond20InjectWizardHelpers();
    const tools = row.children.find(child => child.classes.includes("waybeyond20-wizard-tools"));
    const toolText = tools ? jq.texts(tools).join(" ") : "";
    ctx.wayBeyond20InjectMageArmorBadge([{ name: "Mage Armor" }]);
    ctx.wayBeyond20HandleConcentrationBadge({ preventDefault() {}, stopPropagation() {} }, null);
    const smite = await ctx.wayBeyond20BuildSmiteOptions();
    const queriesBeforeRitual = calls.query;
    const ritual = await ctx.wayBeyond20ChooseRitualMode({ ritual: true, forceDisplay: false });
    const ritualQueried = calls.query > queriesBeforeRitual;
    const conflicts = Array.from(ctx.wayBeyond20CastingConflicts("V, S"));
    const queriesBeforeIntrusion = calls.query;
    await ctx.wayBeyond20ApplyOccultistIntrusion({}, { forceDisplay: false, ritualMode: "normal", level: "1st Level", castas: "" });
    const intrusionQueried = calls.query > queriesBeforeIntrusion;

    return {
        "musician-rest-reminder": calls.musician === 1,
        "wizard-occultist-intrusion-helper": toolText.includes("INTRUSION d8") && intrusionQueried,
        "wizard-arcane-recovery-helper": toolText.includes("ARCANE RECOVERY"),
        "waybeyond20-mage-armor-helper": calls.upsert.includes("MAGE ARMOR AC 13"),
        "waybeyond20-concentration-check-helper": calls.concentrationCheck === 1 && calls.popout === 0,
        "paladin-smite-prompt": calls.bonusAction === 1 && smite === null,
        "waybeyond20-ritual-casting-helper": ritual === "ritual" && ritualQueried,
        "waybeyond20-condition-casting-warning": conflicts.length === 1,
        // Presentation-independent: when off, the concentration badge still opens the End popout.
        _concentrationPopout: calls.popout === 1,
        // Partial presentation: intrusion off must not hide the prompt alone while the tracker stays.
        _intrusionTracker: toolText.includes("INTRUSION d8"),
        _intrusionQueried: intrusionQueried
    };
}

(async () => {
    // Registry: all eight helpers are character settings, default on, and listed for the popup.
    {
        const { ctx } = createExtensionContext({}, []);
        const characterSettings = vm.runInContext("character_settings", ctx);
        const optionsList = vm.runInContext("options_list", ctx);
        assert.deepEqual(Array.from(vm.runInContext("WAYBEYOND20_CHARACTER_HELPER_SETTINGS", ctx)), HELPERS);
        for (const key of HELPERS) {
            assert.equal(characterSettings[key].type, "bool", key);
            assert.equal(characterSettings[key].default, true, key);
            assert.equal(optionsList[key], undefined, `${key} must not be a global option`);
        }
    }

    // Read paths: false is honored, absent keeps the default, and global settings do not govern.
    {
        const storage = { "character-111": Object.fromEntries(HELPERS.map(key => [key, false])) };
        const { ctx } = createExtensionContext(storage, []);
        const allOnGlobal = Object.fromEntries(HELPERS.map(key => [key, true]));
        const allOffGlobal = Object.fromEntries(HELPERS.map(key => [key, false]));

        const characterA = createCharacter(ctx, "111", await loadStored(ctx, "character-111"));
        const characterB = createCharacter(ctx, "222", await loadStored(ctx, "character-222"));
        const characterUnloaded = createCharacter(ctx, "333", null);
        const characterSparse = createCharacter(ctx, "444", {});

        const offA = await exerciseHelpers(characterA, allOnGlobal);
        const onB = await exerciseHelpers(characterB, allOffGlobal);
        const onUnloaded = await exerciseHelpers(characterUnloaded, allOffGlobal);
        const onSparse = await exerciseHelpers(characterSparse, allOffGlobal);
        for (const key of HELPERS) {
            assert.equal(offA[key], false, `character A disabled ${key} must suppress its presentation`);
            assert.equal(onB[key], true, `character B stored default must keep ${key} on`);
            assert.equal(onUnloaded[key], true, `unloaded character settings must keep ${key} on`);
            assert.equal(onSparse[key], true, `absent ${key} must keep the default`);
        }
        assert.equal(offA._concentrationPopout, true, "disabled concentration helper still opens the effects popout");
        assert.equal(onB._concentrationPopout, false);

        // One helper off suppresses only that helper.
        const onlyIntrusionOff = createCharacter(ctx, "555", { "wizard-occultist-intrusion-helper": false });
        const partial = await exerciseHelpers(onlyIntrusionOff, allOnGlobal);
        assert.equal(partial._intrusionTracker, false);
        assert.equal(partial._intrusionQueried, false);
        for (const key of HELPERS.filter(key => key !== "wizard-occultist-intrusion-helper")) {
            assert.equal(partial[key], true, `${key} must stay on when only Intrusion is off`);
        }

        // Re-enabling replaces the character's settings object, as Character.updateSettings does
        // for a "settings"/"character" message, and the next refresh restores presentation.
        characterA._settings = Object.assign({}, characterA._settings, { "waybeyond20-mage-armor-helper": true });
        const reenabled = await exerciseHelpers(characterA, allOffGlobal);
        assert.equal(reenabled["waybeyond20-mage-armor-helper"], true);
        assert.equal(reenabled["wizard-arcane-recovery-helper"], false);
    }

    // Popup: rendered for any character, loads stored values, saves per character, survives reload.
    {
        const storage = { "character-111": { "waybeyond20-mage-armor-helper": false } };
        const messages = [];
        const popupA = createPopup(storage, messages);
        popupA.ctx.populateCharacter(characterResponse("111", await loadStored(popupA.ctx, "character-111")));
        await flush();
        for (const key of HELPERS) {
            const input = popupA.dom.byId.get(key);
            assert.ok(input, `popup must render ${key} without a class or feature proxy`);
            assert.equal(input.checked, key !== "waybeyond20-mage-armor-helper", `popup loads stored ${key}`);
        }

        popupA.dom.byId.get("wizard-occultist-intrusion-helper").checked = false;
        popupA.ctx.save_settings();
        await flush();
        assert.equal(storage["character-111"]["wizard-occultist-intrusion-helper"], false);
        assert.equal(storage["character-111"]["waybeyond20-mage-armor-helper"], false);
        assert.equal(storage["character-111"]["paladin-smite-prompt"], true);
        assert.ok(messages.some(m => m.action === "settings" && m.type === "character" && m.id === "111" &&
            m.settings["wizard-occultist-intrusion-helper"] === false), "saved character settings are broadcast for that ID");

        // Reload: a fresh character reads the saved values through the accessor.
        const { ctx } = createExtensionContext(storage, []);
        const reloaded = createCharacter(ctx, "111", await loadStored(ctx, "character-111"));
        const afterReload = await exerciseHelpers(reloaded, {});
        assert.equal(afterReload["wizard-occultist-intrusion-helper"], false);
        assert.equal(afterReload["waybeyond20-mage-armor-helper"], false);
        assert.equal(afterReload["paladin-smite-prompt"], true);

        // Character B: sheet settings not yet loaded; defaults render on and a save does not write them off.
        const popupB = createPopup(storage, messages);
        popupB.ctx.populateCharacter(characterResponse("222", {}));
        await flush();
        for (const key of HELPERS) assert.equal(popupB.dom.byId.get(key).checked, true, `character B renders ${key} on`);
        popupB.ctx.save_settings();
        await flush();
        const storedB = await loadStored(ctx, "character-222");
        for (const key of HELPERS) assert.equal(storedB[key], true, `character B stores ${key} on`);
        assert.equal(storage["character-111"]["wizard-occultist-intrusion-helper"], false, "character B save leaves character A unchanged");
        assert.equal(storage["character-111"]["waybeyond20-mage-armor-helper"], false);

        // Settings report lists each helper per character with its stored value.
        vm.runInContext(between(optionsSource, "function wayBeyond20FormatCurrentSettingValue", "function wayBeyond20DisplayCurrentSettings"), ctx);
        const report = ctx.wayBeyond20BuildCurrentSettingsReport(clone(storage));
        const sectionA = between(report, "Character-specific settings — ID 111", "Character-specific settings — ID 222");
        const sectionB = report.slice(report.indexOf("Character-specific settings — ID 222"));
        for (const key of HELPERS) {
            const expectedA = ["wizard-occultist-intrusion-helper", "waybeyond20-mage-armor-helper"].includes(key) ? "Off" : "On";
            assert.match(sectionA, new RegExp(`Key: ${key}\\n  Value: ${expectedA}`), `report A ${key}`);
            assert.match(sectionB, new RegExp(`Key: ${key}\\n  Value: On`), `report B ${key}`);
        }
    }

    // No helper read path consults the global settings object any more.
    for (const key of HELPERS) {
        assert.doesNotMatch(characterSource, new RegExp(`settings\\["${key}"\\]`), `${key} must not be read from global settings`);
    }

    console.log("WayBeyond20 v1.65 per-character helper settings checks passed.");
})().catch(error => {
    console.error(error);
    process.exit(1);
});
