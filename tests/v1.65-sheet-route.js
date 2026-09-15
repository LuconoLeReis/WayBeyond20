// WB20-0065 (Bill, live 2026-09-15): the Combat window drew on the Character Builder because the
// main-sheet route test accepted /characters/<id>/builder/... . Runs the real route predicate.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "src", "dndbeyond", "content-scripts", "character.js"), "utf8");
const match = /^function wayBeyond20IsMainCharacterSheet\(/m.exec(source);
assert.ok(match, "Missing wayBeyond20IsMainCharacterSheet");
const rest = source.slice(match.index + match[0].length);
const next = /^(?:async )?function |^\/\//m.exec(rest);
const fn = source.slice(match.index, match.index + match[0].length + next.index);

const context = { window: { location: { pathname: "/" } } };
vm.createContext(context);
vm.runInContext(fn, context);
const isSheet = pathname => vm.runInContext("wayBeyond20IsMainCharacterSheet", context)(pathname);

// Synthetic ids only; no real character or share ids in tests.
for (const sheet of ["/characters/100000001", "/characters/100000001/", "/characters/100000002/AbCd12"]) {
    assert.equal(isSheet(sheet), true, `${sheet} is a sheet`);
}
for (const other of [
    "/characters/100000001/builder",
    "/characters/100000001/builder/class/manage",
    "/characters/100000001/builder/species/choose",
    "/characters/builder",
    "/characters",
    "/characters/100000001/builder/home/basic"
]) {
    assert.equal(isSheet(other), false, `${other} is not a sheet`);
}

console.log("WayBeyond20 v1.65.1 sheet route checks passed.");
