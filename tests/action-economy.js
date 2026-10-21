// Exercise real accounting and dispatcher functions without a live character/VTT.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "../src/dndbeyond/content-scripts/character.js"), "utf8");
function unit(name) {
    const start = new RegExp(`^(?:async )?function ${name}\\(`, "m").exec(source);
    assert.ok(start, `Missing ${name}`);
    const tail = source.slice(start.index + start[0].length);
    const end = /^(?:async )?function |^(?:const|let|var|class) /m.exec(tail);
    return source.slice(start.index, end ? start.index + start[0].length + end.index : source.length);
}
function fixture() {
    const state = {inCombat: true, combatSource: "Roll20", combatStartedAt: 1,
        localTurnNumber: 2, currentRoll20Turn: {isThisCharactersTurn: false, turnKey: "other"},
        action: 1, bonusAction: 1, reaction: 1, attacksRemaining: 1};
    const log = {sent: [], warnings: [], preflights: []};
    const ctx = {
        console, Promise, state, log, result: true, allow: true,
        character: {hasRacialTrait: () => false, hasClassFeature: () => false},
        wayBeyond20GetTrackedSpellEffects: () => [],
        wayBeyond20GetTurnTrackerState: () => state,
        wayBeyond20NormalizeTurnTrackerState: value => ({...value}),
        wayBeyond20SetTurnTrackerState: value => Object.assign(state, value),
        wayBeyond20ParseInteger: value => Number.isFinite(Number(value)) ? Number(value) : null,
        wayBeyond20ScheduleActiveEffectBadgeRefresh() {},
        wayBeyond20CharacterDebug() {},
        wayBeyond20NormalizeAttackSemantics() {},
        wayBeyond20ApplyDrainingAttackIntent() {},
        wayBeyond20PreflightTurnResource: async resource => {
            log.preflights.push(resource);
            return ctx.allow;
        },
        $: () => ({css: () => undefined}),
        alertify: {warning: message => log.warnings.push(message)},
        sendRoll: async (owner, type, fallback, args) => {
            log.sent.push({...args});
            if (ctx.onSend) await ctx.onSend();
            return ctx.result;
        }
    };
    vm.createContext(ctx);
    const names = [
        "wayBeyond20HasActiveCombatState", "wayBeyond20SpendTurnResource",
        "wayBeyond20AttacksPerAttackAction", "wayBeyond20AttacksRemainingInAttackAction",
        "wayBeyond20SpendAttackAction", "wayBeyond20HasAvailableBonusAction"
    ];
    for (const name of names) vm.runInContext(unit(name), ctx);
    ctx.loadGrants = () => {
        for (const name of ["wayBeyond20AttackActivationTurnKey",
            "wayBeyond20CreateAttackActivation", "wayBeyond20PerformGrantedAttack",
            "wayBeyond20DispatchRollWithCharacter"]) vm.runInContext(unit(name), ctx);
    };
    ctx.send = activation => ctx.wayBeyond20DispatchRollWithCharacter("attack", "1d6", {
        name: "Test attack", rollAttack: true,
        "waybeyond20-attack-activation": activation,
        // The caller's native attack would ordinarily spend an Action.
        "waybeyond20-turn-resource": {resource: "action", actionType: "Attack"}
    }, {afterDispatchCommits: []});
    return ctx;
}

(async () => {
    let ctx = fixture();
    assert.equal(ctx.wayBeyond20AttacksRemainingInAttackAction(), 0,
        "another combatant's turn cannot borrow the prior Attack-action pool");
    assert.equal(ctx.wayBeyond20SpendAttackAction(), false);
    assert.equal(ctx.state.attacksRemaining, 1, "off-turn advisory roll preserves the pool");
    assert.equal(ctx.wayBeyond20HasAvailableBonusAction(), false,
        "an unspent Bonus Action is not available off-turn");
    ctx.state.currentRoll20Turn.isThisCharactersTurn = true;
    assert.equal(ctx.wayBeyond20AttacksRemainingInAttackAction(), 1);
    assert.equal(ctx.wayBeyond20HasAvailableBonusAction(), true);
    assert.equal(ctx.wayBeyond20SpendAttackAction(), true);
    assert.equal(ctx.state.attacksRemaining, 0);
    assert.equal(ctx.state.action, 1, "remaining attack does not spend another Action");

    ctx = fixture(); ctx.loadGrants();
    let activation = ctx.wayBeyond20CreateAttackActivation({resource: "reaction", attacks: 1});
    assert.equal(await ctx.send(activation), true);
    assert.equal(ctx.state.reaction, 0);
    assert.equal(ctx.state.action, 1);
    assert.equal(ctx.state.attacksRemaining, 1);
    assert.deepEqual(ctx.log.preflights, ["reaction"]);
    assert.equal(ctx.log.sent[0]["waybeyond20-attack-activation"], undefined,
        "internal owner and transaction state must not leave this content script");
    assert.equal(await ctx.send(activation), false, "one grant cannot perform a second attack");
    assert.equal(ctx.log.sent.length, 1);

    ctx = fixture(); ctx.loadGrants();
    activation = ctx.wayBeyond20CreateAttackActivation({resource: "reaction", attacks: 1});
    ctx.allow = false;
    assert.equal(await ctx.send(activation), null);
    assert.equal(activation.remaining, 1);
    assert.equal(ctx.state.reaction, 1);
    ctx.allow = true; ctx.result = false;
    assert.equal(await ctx.send(activation), false);
    assert.equal(activation.remaining, 1);
    assert.equal(ctx.state.reaction, 1);
    ctx.result = true;
    assert.equal(await ctx.send(activation), true, "cancelled/failed dispatch can be retried");

    ctx = fixture(); ctx.loadGrants();
    ctx.state.currentRoll20Turn.isThisCharactersTurn = true;
    activation = ctx.wayBeyond20CreateAttackActivation({resource: "bonusAction", attacks: 3});
    for (let i = 0; i < 3; i++) assert.equal(await ctx.send(activation), true);
    assert.equal(ctx.state.bonusAction, 0, "one activation pays once for its granted attacks");
    assert.deepEqual(ctx.log.preflights, ["bonusAction"]);
    assert.equal(ctx.state.action, 1);
    assert.equal(ctx.state.attacksRemaining, 1);
    assert.equal(await ctx.send(activation), false);

    ctx = fixture(); ctx.loadGrants();
    activation = ctx.wayBeyond20CreateAttackActivation({resource: null, attacks: 1});
    assert.equal(await ctx.send(activation), true, "an already-paid rider has no new economy cost");
    assert.deepEqual(ctx.log.preflights, []);
    assert.equal(ctx.state.action, 1);
    assert.equal(ctx.state.reaction, 1);

    ctx = fixture(); ctx.loadGrants();
    activation = ctx.wayBeyond20CreateAttackActivation({resource: "reaction", attacks: 1});
    let release;
    ctx.onSend = () => new Promise(resolve => { release = resolve; });
    const first = ctx.send(activation);
    for (let i = 0; i < 5; i++) await Promise.resolve();
    assert.equal(await ctx.send(activation), false, "double click cannot use an in-flight grant");
    release();
    assert.equal(await first, true);
    assert.equal(ctx.log.sent.length, 1);

    ctx = fixture(); ctx.loadGrants();
    activation = ctx.wayBeyond20CreateAttackActivation({resource: "reaction", attacks: 1});
    ctx.character = {...ctx.character};
    assert.equal(await ctx.send(activation), false, "grant belongs to its original sheet");
    assert.equal(ctx.log.sent.length, 0);
    ctx = fixture(); ctx.loadGrants();
    activation = ctx.wayBeyond20CreateAttackActivation({resource: "reaction", attacks: 1});
    ctx.state.currentRoll20Turn.turnKey = "next";
    assert.equal(await ctx.send(activation), false, "a stale trigger cannot spend in a new turn");
    assert.equal(ctx.log.sent.length, 0);

    ctx = fixture(); ctx.loadGrants();
    activation = ctx.wayBeyond20CreateAttackActivation({resource: "reaction", attacks: 1});
    ctx.onSend = async () => { ctx.character = {...ctx.character}; };
    assert.equal(await ctx.send(activation), true, "delivery succeeded despite navigation");
    assert.equal(ctx.state.reaction, 1, "never debit another sheet after navigation");
    assert.equal(activation.remaining, 0, "already-delivered attack cannot be retried");
    assert.equal(ctx.log.warnings.length, 1, "manual reconciliation is explicit");

    ctx = fixture(); ctx.loadGrants();
    activation = ctx.wayBeyond20CreateAttackActivation({resource: "reaction", attacks: 1});
    ctx.onSend = async () => { throw new Error("delivery failed"); };
    await assert.rejects(ctx.send(activation), /delivery failed/);
    assert.equal(ctx.state.reaction, 1);
    assert.equal(activation.remaining, 1);
    assert.equal(activation.inFlight, false, "exception releases the in-flight guard");
    assert.throws(() => ctx.wayBeyond20CreateAttackActivation({resource: "made-up", attacks: 1}));
    assert.throws(() => ctx.wayBeyond20CreateAttackActivation({resource: "reaction", attacks: 0}));
    console.log("Action economy: off-turn pool, Bonus Action timing, granted attacks, cancellation, failure, duplicate and owner tests passed.");
})().catch(error => { console.error(error); process.exitCode = 1; });
