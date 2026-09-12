const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const characterSource = fs.readFileSync(path.join(root, "src", "dndbeyond", "content-scripts", "character.js"), "utf8");
const backgroundSource = fs.readFileSync(path.join(root, "src", "extension", "background.js"), "utf8");

function functionSource(source, name, nextName) {
    const start = source.indexOf(`function ${name}(`);
    const end = source.indexOf(`function ${nextName}(`, start + 1);
    assert.notEqual(start, -1, `Missing function ${name}`);
    assert.notEqual(end, -1, `Missing boundary function ${nextName}`);
    return source.slice(start, end);
}

function evaluate(source, context = {}) {
    const sandbox = Object.assign({}, context);
    vm.createContext(sandbox);
    vm.runInContext(source, sandbox);
    return sandbox;
}

{
    const sandbox = evaluate(functionSource(backgroundSource, "wayBeyond20SavageFormulaForTarget", "wayBeyond20BedsideFormulaForTarget"));
    assert.equal(sandbox.wayBeyond20SavageFormulaForTarget("2d6 + 4", "roll20"), "{2d6 + 4, 2d6 + 4}kh1");
    assert.equal(sandbox.wayBeyond20SavageFormulaForTarget("1d8+3", "roll20"), "{1d8+3, 1d8+3}kh1");
    assert.equal(sandbox.wayBeyond20SavageFormulaForTarget("2d6 + 4", "fvtt"), "2d6 + 4");
}

{
    const helperSource = functionSource(characterSource, "wayBeyond20LimitedUseFeatureForAction", "wayBeyond20AttachNativeActionUse");
    const sandbox = evaluate(helperSource, {
        wayBeyond20FindLimitedUseControls: () => ({ controls: [] })
    });
    assert.equal(sandbox.wayBeyond20LimitedUseFeatureForAction("Channel Divinity: Watcher’s Will"), "Channel Divinity");
    assert.equal(sandbox.wayBeyond20LimitedUseFeatureForAction("Elemental Strike: Efreeti’s Fury"), "Channel Divinity");
    assert.equal(sandbox.wayBeyond20LimitedUseFeatureForAction("Elemental Rebuke"), "Elemental Rebuke");
    assert.equal(sandbox.wayBeyond20LimitedUseFeatureForAction("Activate Noble Scion"), "Activate Noble Scion");
    assert.equal(sandbox.wayBeyond20LimitedUseFeatureForAction("Breath Weapon (Fire)"), "Breath Weapon");
    assert.equal(sandbox.wayBeyond20LimitedUseFeatureForAction("Longsword"), null);
}

{
    const mechanicsSource = [
        functionSource(characterSource, "wayBeyond20ParseInteger", "wayBeyond20FormatSigned"),
        functionSource(characterSource, "wayBeyond20EffectName", "wayBeyond20HasActiveEffect"),
        functionSource(characterSource, "wayBeyond20EffectDataEntries", "wayBeyond20EffectHasFlag"),
        functionSource(characterSource, "wayBeyond20ResolveEffectDataValue", "wayBeyond20BuildActiveEffectMechanics"),
        functionSource(characterSource, "wayBeyond20BuildActiveEffectMechanics", "wayBeyond20RenderedAttrName")
    ].join("\n");
    const sandbox = evaluate(mechanicsSource, {
        character: { getAbility: () => ({ mod: 0 }) },
        wayBeyond20GetTrackedSpellEffects: () => []
    });
    const mechanics = sandbox.wayBeyond20BuildActiveEffectMechanics([{
        name: "Watcher’s Will",
        data: ["INT", "WIS", "CHA"].map(ability => ({ field: "SAVE_ADVANTAGE", string: ability, value: "1" }))
    }]);
    assert.deepEqual(Array.from(mechanics.saveAdvantages), ["INT", "WIS", "CHA"]);
    assert.equal(mechanics.dexSaveAdvantage, false);
}

assert.match(characterSource, /if \(die\.text\(\) !== dieText\) die\.text\(dieText\)/);
assert.match(characterSource, /if \(uses\.text\(\) !== usesText\) uses\.text\(usesText\)/);
assert.match(characterSource, /if \(stealthEffect && result === true\)/);
assert.match(characterSource, /addRollButtonEx\(paneClass, "\.ct-sidebar__heading", \{ text: "Cast on VTT", small: true \}\)/);

console.log("WayBeyond20 v1.63 regression checks passed.");
