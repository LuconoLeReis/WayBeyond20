const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const characterSource = fs.readFileSync(path.join(root, "src", "dndbeyond", "content-scripts", "character.js"), "utf8");
const baseCharacterSource = fs.readFileSync(path.join(root, "src", "dndbeyond", "base", "character.js"), "utf8");
const settingsSource = fs.readFileSync(path.join(root, "src", "common", "settings.js"), "utf8");
const cssSource = fs.readFileSync(path.join(root, "src", "extension", "beyond20.css"), "utf8");

function sourceBetween(startText, endText) {
    const start = characterSource.indexOf(startText);
    const end = characterSource.indexOf(endText, start + startText.length);
    assert.notEqual(start, -1, `Missing ${startText}`);
    assert.notEqual(end, -1, `Missing ${endText}`);
    return characterSource.slice(start, end);
}

{
    const sandbox = {};
    vm.createContext(sandbox);
    vm.runInContext(sourceBetween("function wayBeyond20SpellCastLevel", "async function wayBeyond20ChooseRitualMode"), sandbox);
    assert.equal(sandbox.wayBeyond20SpellCastLevel("Cantrip Evocation", ""), 0);
    assert.equal(sandbox.wayBeyond20SpellCastLevel("1st Level Abjuration", ""), 1);
    assert.equal(sandbox.wayBeyond20SpellCastLevel("1st Level Abjuration", "3rd"), 3);
}

{
    const sandbox = {
        wayBeyond20GetTrackedSpellEffects: () => [],
        character: { _conditions: ["Restrained"], getSetting: (key, defaultValue) => defaultValue }
    };
    vm.createContext(sandbox);
    vm.runInContext(sourceBetween("function wayBeyond20CharacterHelperEnabled", "function wayBeyond20ShowMusicianRestReminder"), sandbox);
    vm.runInContext(sourceBetween("function wayBeyond20CastingConflicts", "async function wayBeyond20ConfirmCastingConflicts"), sandbox);
    assert.deepEqual(Array.from(sandbox.wayBeyond20CastingConflicts("V, S, M")), []);
    sandbox.character._conditions = ["Stunned"];
    assert.equal(sandbox.wayBeyond20CastingConflicts("V, S").length, 1);
    sandbox.character._conditions = ["Silenced"];
    assert.equal(sandbox.wayBeyond20CastingConflicts("V").length, 1);
    assert.deepEqual(Array.from(sandbox.wayBeyond20CastingConflicts("S")), []);
}

assert.match(characterSource, /WAYBEYOND20_INTRUSION_DICE = \[2, 3, 4, 6, 8, 10, 12\]/);
assert.doesNotMatch(sourceBetween("function wayBeyond20HasOccultistIntrusion", "function wayBeyond20GetIntrusionDie"), /hasClass\("Wizard"\)/);
assert.match(characterSource, /level >= 17\) return 12/);
assert.match(characterSource, /level >= 11\) return 10/);
assert.match(characterSource, /level >= 5\) return 8/);
assert.match(characterSource, /result === 1/);
assert.match(characterSource, /wayBeyond20ResolveIntrusionRoll\(12\)/);
assert.match(characterSource, /Overwhelming Mind: creatures have Disadvantage/);
assert.match(characterSource, /Seeking Eye: Advantage on the first attack roll/);
assert.match(characterSource, /Aberration or Fiend of CR no greater than your Wizard level/);
assert.match(characterSource, /waybeyond20-occultist-intrusion-die/);
assert.match(characterSource, /short-rest/);
assert.match(characterSource, /updates\["waybeyond20-arcane-recovery-used"\] = false/);

assert.match(characterSource, /Choose expended spell slots totaling no more than/);
assert.match(characterSource, /Math\.ceil\(\(parseInt\(character\.getClassLevel\("Wizard"\)\)/);
assert.match(characterSource, /pool\.level <= 5/);
assert.match(characterSource, /wayBeyond20RequestPageSpellSlotChange\(level, "restore"/);
assert.match(characterSource, /wayBeyond20SpendLimitedUse\("Arcane Recovery"\)/);
assert.doesNotMatch(sourceBetween("async function wayBeyond20UseArcaneRecovery", "function wayBeyond20InjectWizardHelpers"), /hasClass\("Wizard"\)/);

assert.match(characterSource, /Cast as Ritual/);
assert.match(characterSource, /does not expend a spell slot/);
assert.match(characterSource, /waybeyond20_ritual_mode !== "ritual"/);
assert.match(characterSource, /hasClassFeature\("Ritual Adept", true\)/);
assert.match(characterSource, /hasClassFeature\("Ritual Casting", true\)/);
assert.match(characterSource, /hasFeat\("Ritual Caster", true\)/);
assert.doesNotMatch(sourceBetween("async function wayBeyond20ChooseRitualMode", "function wayBeyond20CastingConflicts"), /hasClass\("Wizard"\)/);
assert.match(characterSource, /wayBeyond20ConfirmCastingConflicts/);
assert.match(characterSource, /const blocking = \["incapacitated", "stunned", "paralyzed", "petrified", "unconscious"\]/);
assert.doesNotMatch(sourceBetween("function wayBeyond20CastingConflicts", "async function wayBeyond20ConfirmCastingConflicts"), /restrained/i);

assert.match(characterSource, /Damage taken for this Concentration check/);
assert.match(characterSource, /Math\.max\(10, Math\.floor\(damage \/ 2\)\)/);
assert.match(characterSource, /Did the save fail/);
assert.match(characterSource, /wayBeyond20RemoveTrackedEffect/);
assert.match(characterSource, /MAGE ARMOR AC/);
assert.doesNotMatch(sourceBetween("function wayBeyond20InjectMageArmorBadge", "async function wayBeyond20RunConcentrationCheck"), /hasClass\("Wizard"\)/);
assert.match(baseCharacterSource, /return \(this\._classes \|\| \{\}\)\[name\] \|\| 0/);
assert.match(baseCharacterSource, /return \(this\._classes \|\| \{\}\)\[name\] !== undefined/);
assert.match(characterSource, /Musician:.*Rest completed/);

for (const setting of [
    "wizard-occultist-intrusion-helper",
    "wizard-arcane-recovery-helper",
    "waybeyond20-ritual-casting-helper",
    "waybeyond20-mage-armor-helper",
    "waybeyond20-concentration-check-helper",
    "waybeyond20-condition-casting-warning",
    "musician-rest-reminder"
]) {
    assert.match(settingsSource, new RegExp(`"${setting}"[\\s\\S]{0,500}"default": true`));
}
assert.match(cssSource, /waybeyond20-wizard-tools/);
assert.match(cssSource, /waybeyond20-intrusion-tracker/);
assert.match(cssSource, /waybeyond20-arcane-recovery-query/);

console.log("WayBeyond20 v1.65 Wizard helper checks passed.");
