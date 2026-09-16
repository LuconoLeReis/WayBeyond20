const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const characterSource = fs.readFileSync(path.join(root, "src", "dndbeyond", "content-scripts", "character.js"), "utf8");
const utilsSource = fs.readFileSync(path.join(root, "src", "common", "utils.js"), "utf8");

function functionSource(source, name, nextName) {
    const start = source.indexOf(`function ${name}(`);
    const end = source.indexOf(`function ${nextName}(`, start + 1);
    assert.notEqual(start, -1, `Missing function ${name}`);
    assert.notEqual(end, -1, `Missing boundary function ${nextName}`);
    return source.slice(start, end);
}

function evaluate(source) {
    const sandbox = {};
    vm.createContext(sandbox);
    vm.runInContext(source, sandbox);
    return sandbox;
}

{
    const sandbox = evaluate(functionSource(characterSource, "wayBeyond20SmiteFormulaForSlot", "wayBeyond20SmiteFuelIsLegal"));
    assert.equal(sandbox.wayBeyond20SmiteFormulaForSlot("2d8", 1), "2d8");
    assert.equal(sandbox.wayBeyond20SmiteFormulaForSlot("2d8", 3), "2d8 + 2d8");
    assert.equal(sandbox.wayBeyond20SmiteFormulaForSlot("2d6", 2), "2d6 + 1d6");
    assert.equal(sandbox.wayBeyond20SmiteFormulaForSlot("5d10", 5, 5), "5d10");
    assert.equal(sandbox.wayBeyond20SmiteFormulaForSlot("5d10", 6, 5), "5d10 + 1d10");
}

{
    const sandbox = evaluate(functionSource(characterSource, "wayBeyond20SmiteNameIsEligible", "wayBeyond20SpellRowIsPrepared"));
    assert.equal(sandbox.wayBeyond20SmiteNameIsEligible("Divine Smite"), true);
    assert.equal(sandbox.wayBeyond20SmiteNameIsEligible("Branding Smite"), true);
    assert.equal(sandbox.wayBeyond20SmiteNameIsEligible("Custom Homebrew Smite"), true);
    assert.equal(sandbox.wayBeyond20SmiteNameIsEligible("Improved Divine Strike"), false);
}

{
    const sandbox = evaluate(functionSource(characterSource, "wayBeyond20SpellRowIsPrepared", "wayBeyond20FirstDamageFormula"));
    const control = (label, checked = undefined) => ({
        textContent: label,
        checked,
        getAttribute(name) {
            if (name === "aria-label") return label;
            return null;
        }
    });
    const row = (controls, className = "") => ({
        className,
        attributes: [],
        querySelectorAll() { return controls; }
    });
    assert.equal(sandbox.wayBeyond20SpellRowIsPrepared(row([control("Prepare")])), false);
    assert.equal(sandbox.wayBeyond20SpellRowIsPrepared(row([control("Unprepare")])), true);
    assert.equal(sandbox.wayBeyond20SpellRowIsPrepared(row([], "spell-row-prepared")), true);
}

{
    const formulaSandbox = evaluate(functionSource(characterSource, "wayBeyond20FirstDamageFormula", "wayBeyond20DamageTypeFromText"));
    const damageTypeSandbox = evaluate(functionSource(characterSource, "wayBeyond20DamageTypeFromText", "wayBeyond20SmiteFormulaForSlot"));
    assert.equal(formulaSandbox.wayBeyond20FirstDamageFormula("A smite deals 2d8 radiant damage"), "2d8");
    assert.equal(damageTypeSandbox.wayBeyond20DamageTypeFromText("2d8 radiant damage"), "Radiant");
}

{
    const sandbox = evaluate(functionSource(characterSource, "wayBeyond20SmiteFuelIsLegal", "wayBeyond20HasAvailableBonusAction"));
    assert.equal(sandbox.wayBeyond20SmiteFuelIsLegal("Divine Smite", "paladin-smite"), true);
    assert.equal(sandbox.wayBeyond20SmiteFuelIsLegal("Thunderous Smite", "paladin-smite"), false);
    assert.equal(sandbox.wayBeyond20SmiteFuelIsLegal("Thunderous Smite", "spell-slot"), true);
    assert.equal(sandbox.wayBeyond20SmiteFuelIsLegal("Branding Smite", "spell-slot", 1, 2), false);
    assert.equal(sandbox.wayBeyond20SmiteFuelIsLegal("Branding Smite", "spell-slot", 2, 2), true);
}

assert.match(characterSource, /waybeyond20-smite-query/);
assert.match(characterSource, /Paladin's Smite/);
assert.match(characterSource, /wayBeyond20HasAvailableBonusAction/);
assert.match(characterSource, /wayBeyond20AttachTurnResource\(rollProperties, "bonusAction"/);
assert.match(characterSource, /waybeyond20-paladin-smite-used/);
assert.match(characterSource, /wayBeyond20SmiteNameIsEligible/);
assert.doesNotMatch(characterSource, /WAYBEYOND20_PALADIN_SMITE_NAMES/);
assert.doesNotMatch(
    functionSource(characterSource, "wayBeyond20BuildSmiteOptions", "wayBeyond20QuerySmite"),
    /hasClass\("Paladin"\)/
);
assert.match(characterSource, /data-smite-level/);
assert.match(characterSource, /data-slot-level/);
assert.match(utilsSource, /slotLevel >= smiteLevel/);
assert.match(characterSource, /wayBeyond20PreparedSmiteCache/);
assert.match(characterSource, /wayBeyond20SpellSlotCache/);
assert.match(characterSource, /wayBeyond20InstallSmiteSpellStateTracker\(\)/);
assert.match(characterSource, /prepared: true, slots: false/);
 // Brief 1.7/1.8: Elemental Strike follows any Divine Smite cast, whatever its fuel,
// through a four-button chooser. Behavior is executed in tests/v1.65-elemental-strike.js.
assert.match(characterSource, /await wayBeyond20MaybeAddElementalStrike\(rollProperties, selection\.smite\.name\)/);
assert.doesNotMatch(characterSource, /selection\.fuel\.type !== "paladin-smite"/);
assert.match(characterSource, /wayBeyond20AttachLimitedUse\(rollProperties, "Channel Divinity"/);
assert.match(characterSource, /uses one Channel Divinity and this Divine Smite's Bonus Action/);
assert.match(characterSource, /async function wayBeyond20SpendPaladinSmiteFreeUse[\s\S]*wayBeyond20CharacterSheetTab\("Spells"\)/);

console.log("WayBeyond20 v1.64.1 smite checks passed.");
