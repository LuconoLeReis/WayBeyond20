const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const characterSource = fs.readFileSync(path.join(root, "src", "dndbeyond", "content-scripts", "character.js"), "utf8");

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
}

{
    const sandbox = evaluate(functionSource(characterSource, "wayBeyond20SmiteFuelIsLegal", "wayBeyond20HasAvailableBonusAction"));
    assert.equal(sandbox.wayBeyond20SmiteFuelIsLegal("Divine Smite", "paladin-smite"), true);
    assert.equal(sandbox.wayBeyond20SmiteFuelIsLegal("Thunderous Smite", "paladin-smite"), false);
    assert.equal(sandbox.wayBeyond20SmiteFuelIsLegal("Thunderous Smite", "spell-slot"), true);
}

assert.match(characterSource, /waybeyond20-smite-query/);
assert.match(characterSource, /Paladin's Smite/);
assert.match(characterSource, /wayBeyond20HasAvailableBonusAction/);
assert.match(characterSource, /wayBeyond20AttachTurnResource\(rollProperties, "bonusAction"/);
assert.match(characterSource, /waybeyond20-paladin-smite-used/);

console.log("WayBeyond20 v1.64 smite checks passed.");
