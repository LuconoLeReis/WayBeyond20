// Real rules/context/dispatch units. No live sheet or VTT is represented by this fixture.
const assert = require("node:assert/strict"), fs = require("node:fs"), vm = require("node:vm"), path = require("node:path");
const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "src/dndbeyond/content-scripts/character.js"), "utf8");
const moduleSource = fs.readFileSync(path.join(root, "src/dndbeyond/content-scripts/opportunity-attacks.js"), "utf8");
function fn(name) {
    const start = source.search(new RegExp(`^(?:async )?function ${name}\\(`, "m"));
    assert.ok(start >= 0, name);
    const end = source.slice(start + 1).search(/^(?:(?:async )?function |const |let |var |class )/m);
    return source.slice(start, end < 0 ? undefined : start + 1 + end);
}
function fixture() {
    const state = {inCombat: true, combatSource: "Roll20", combatStartedAt: 1, localTurnNumber: 1,
        currentRoll20Turn: {turnKey: "enemy", isThisCharactersTurn: false}};
    const c = {
        console, Promise, Map, Set, character: {}, state, prompts: [], sent: [], allow: true,
        wayBeyond20GetTurnTrackerState: () => state,
        wayBeyond20HasActiveCombatState: () => true,
        wayBeyond20EscapeFollowupText: s => String(s).replace(/</g, "&lt;"),
        alertify: {warning() {}},
        dndbeyondDiceRoller: {_prompter: {prompt: async (...args) => {c.prompts.push(args); return c.allow;}}},
    };
    vm.createContext(c);
    vm.runInContext(moduleSource + "\n" + [
        "wayBeyond20AttackActivationTurnKey", "wayBeyond20CreateAttackActivation", "wayBeyond20PerformGrantedAttack",
        "wayBeyond20MaybeAddSmite", "handleSpecialWeaponAttacks", "handleSpecialMeleeAttacks", "handleSpecialGeneralAttacks"
    ].map(fn).join("\n"), c);
    c.context = () => ({kind: "opportunity", attackAction: false, isOwnTurn: false,
        activation: c.wayBeyond20CreateAttackActivation({resource: "reaction", attacks: 1}),
        rules: [], review: new Map()});
    return c;
}
(async () => {
    let c = fixture(), ctx = c.context();
    const timing = (text, ongoing = false) => c.wayBeyond20AttackRiderTiming(text, ctx, ongoing);
    assert.equal(timing("Once on each of your turns, when you hit with a weapon attack, you deal extra damage.").allowed, false);
    assert.equal(timing("When you hit with an attack as part of the Attack action, add extra damage.").allowed, false);
    assert.equal(timing("Once per turn, when you hit, you can deal extra damage.").allowed, true, "once per turn permits an off-turn use");
    assert.equal(timing("As a Reaction when you hit, add extra damage.").allowed, false);
    assert.equal(timing("As a Bonus Action when you hit, add extra damage.").allowed, false);
    ctx.isOwnTurn = true;
    assert.equal(timing("As a Bonus Action when you hit, add extra damage.").allowed, true);
    ctx.isOwnTurn = false;
    assert.equal(timing("As a Bonus Action when you hit, add extra damage.", true).allowed, true, "previous activation is not charged again");
    assert.equal(timing("On your turn, add damage when you hit. You also gain advantage on attacks.").allowed, true, "ambiguous multi-benefit rules require review");
    assert.equal(timing("").allowed, true, "unknown is review, not invented exclusion");

    ctx.rules = [{name: "Test rider", text: "Once on each of your turns, when you hit, add extra damage."}];
    assert.equal(c.wayBeyond20AttackRiderAllowed(ctx, "Test rider"), false);
    assert.match(ctx.review.get("Test rider").reason, /Omitted/);
    assert.equal(c.wayBeyond20AttackRiderAllowed(ctx, "Test rider 2024"), true, "never confuse editions");
    const args = {rollAttack: true};
    c.allow = false;
    assert.equal(await c.wayBeyond20ConfirmAttackContext(ctx, args), false);
    assert.equal(args["waybeyond20-attack-activation"], undefined);
    c.allow = true;
    assert.equal(await c.wayBeyond20ConfirmAttackContext(ctx, args), true);
    assert.equal(args["waybeyond20-attack-activation"], ctx.activation);
    assert.equal(args["waybeyond20-attack-context"].isOwnTurn, false);
    assert.equal(await c.wayBeyond20MaybeAddSmite(args, true), null, "off-turn Smite never enters discovery");
    c.state.currentRoll20Turn.turnKey = "next";
    assert.equal(await c.wayBeyond20ConfirmAttackContext(ctx, {}), false);

    c = fixture(); ctx = c.context();
    const rule = {name: "A different feature name", text: "When a creature provokes an opportunity attack by leaving your reach, you can cast a spell instead. The spell must have a casting time of one action and must target only that creature."};
    assert.equal(c.wayBeyond20ReactiveSpellRule([rule]), rule);
    assert.equal(c.wayBeyond20ReactiveSpellRule([{name: "War Caster", text: "You have advantage on concentration saves."}]), undefined);
    ctx.kind = "reactive-spell"; ctx.activation.kind = "spell";
    assert.equal(await c.wayBeyond20ConfirmReactiveSpell(ctx, {"Casting Time": "1 Bonus Action"}, "Test", "Rules"), false);
    assert.equal(c.prompts.length, 0);
    assert.equal(await c.wayBeyond20ConfirmReactiveSpell(ctx, {"Casting Time": "1 Action"}, "Test", "Rules"), true);
    const spell = {rollAttack: false};
    assert.equal(await c.wayBeyond20ConfirmAttackContext(ctx, spell), true);
    let dispatches = 0;
    assert.equal(await c.wayBeyond20PerformGrantedAttack(ctx.activation, spell, async () => {dispatches++; return true;}), true);
    assert.equal(spell["waybeyond20-turn-resource"].resource, "reaction", "save/card spells pay the replacement Reaction");
    assert.equal(await c.wayBeyond20PerformGrantedAttack(ctx.activation, spell, async () => {dispatches++; return true;}), false);
    assert.equal(dispatches, 1);
    const advisoryBA = c.wayBeyond20CreateAttackActivation({resource: "bonusAction", attacks: 2});
    assert.equal(await c.wayBeyond20PerformGrantedAttack(advisoryBA, {rollAttack: true}, async () => true), true,
        "the shared resource preflight, not a class/producer hard block, owns the off-turn decision");

    // Exercise the actual damage helpers, not only the timing parser.
    c = fixture(); ctx = c.context();
    c.character = {hasClass: name => name === "Rogue", hasClassFeature: name => name === "Sneak Attack",
        getSetting: (key, fallback) => key === "rogue-sneak-attack" ? true : fallback, _classes: {Rogue: 3}};
    ctx.rules = [{name: "Sneak Attack", text: "Once per turn, when you hit with a finesse weapon attack, you can deal extra damage."}];
    let damage = [], types = [], settings = {};
    c.handleSpecialWeaponAttacks(damage, types, {"Attack Type":"Melee", Properties:"Finesse"}, settings,
        {to_hit:"+5", attack_context:ctx});
    assert.deepEqual(damage, ["2d6"]);
    assert.equal(ctx.review.size, 1, "target prerequisites and prior use still require confirmation");
    c.character = {hasClass: name => name === "Ranger", hasRacialTrait: () => false, hasClassFeature: name => name === "Gathered Swarm",
        getSetting: (key, fallback) => key === "ranger-gathered-swarm" ? true : fallback, getClassLevel: () => 5};
    ctx.rules = [{name: "Gathered Swarm", text: "Once on each of your turns, after you hit, deal extra damage."}];
    damage = []; types = [];
    c.handleSpecialGeneralAttacks(damage, types, {}, {}, {to_hit:"+5", attack_context:ctx});
    assert.deepEqual(damage, []);
    console.log("Opportunity Attack: live-text timing, edition isolation, review/cancel, reactive spells, bounded grants and real rider helpers passed.");
})().catch(error => {console.error(error); process.exitCode = 1;});
