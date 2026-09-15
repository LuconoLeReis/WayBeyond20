// WB20-0065 brief 1.5: Draining Attack follows every Unarmed Strike when the character has
// both Draining Attack and Natural Attack, whatever produced the attack. Runs the real
// shared dispatch, attack builder, Agile Strikes producer, and both Temporary HP paths.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const read = relative => fs.readFileSync(path.join(root, ...relative.split("/")), "utf8");
const characterSource = read("src/dndbeyond/content-scripts/character.js");
const baseUtilsSource = read("src/dndbeyond/base/utils.js");
const diceSource = read("src/dndbeyond/base/dice.js");
const rendererSource = read("src/common/roll_renderer.js");
const roll20Source = read("src/roll20/content-script.js");

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

const DRAINING_EFFECT = "Draining Attack: gain Temporary HP equal to damage dealt";

// ---- Harness -------------------------------------------------------------------------------

const damageFlagsSource = rendererSource.slice(
    rendererSource.indexOf("class DAMAGE_FLAGS {"),
    rendererSource.indexOf("\n}\n", rendererSource.indexOf("class DAMAGE_FLAGS {")) + 3
);
const rendererTempHpBlock = between(
    rendererSource,
    'if (request["waybeyond20-temp-hp-on-hit"] &&',
    "return [to_hit, damage_rolls];"
);
const applyDamageBasedTempHPMethod = between(diceSource, "async applyDamageBasedTempHP(", "async resolveRolls(");
const damageResultStart = '} else if (request.action == "waybeyond20-damage-result") {';
const damageResultBody = between(characterSource, damageResultStart, '} else if (request.action == "open-options") {')
    .slice(damageResultStart.length);

function createSandbox({ traits = [], features = [], abilities = { STR: 1, DEX: 3 }, bardLevel = 0,
    tempHp = 0, preflightAllowed = true, whisperCancelled = false, rolledDamage = 7 } = {}) {
    const log = { dispatched: [], tempHpRequests: [], roll20Messages: [], sendRollCalls: 0 };
    const character = {
        _id: 111,
        _name: "Test Dhampir",
        _proficiency: 2,
        _temp_hp: tempHp,
        updateHP() {},
        hasRacialTrait: (name, substring) => traits.some(trait => substring ? trait.includes(name) : trait === name),
        hasClassFeature: (name, substring) => features.some(feature => substring ? feature.includes(name) : feature === name),
        hasClass: () => false,
        hasFeat: () => false,
        getClassLevel: className => className === "Bard" ? bardLevel : 0,
        getAbility: ability => ({ mod: abilities[ability] || 0 }),
        getSetting: (key, fallback) => fallback,
        getGlobalSetting: (key, fallback) => fallback,
        mergeCharacterSettings() {}
    };
    const context = {
        console, Promise, setTimeout,
        character,
        settings: {},
        CriticalRules: { PHB: 0, HOMEBREW_MAX: 1, HOMEBREW_DOUBLE: 2, HOMEBREW_REROLL: 3, HOMEBREW_MOD: 4 },
        RollType: {},
        $: () => ({ css: () => undefined }),
        damagesToCrits: (c, damages) => damages.map(() => ""),
        applyRogueSneakAttack: async () => {},
        abbreviationToAbility: value => value,
        wayBeyond20CharacterDebug() {},
        wayBeyond20DebugLog() {},
        wayBeyond20PreflightLimitedUse: async () => ({ allowed: true, tracked: false }),
        wayBeyond20PreflightTurnResource: async () => preflightAllowed,
        wayBeyond20SpendTurnResource() {},
        wayBeyond20GetTrackedSpellEffects: () => [],
        wayBeyond20EffectName: () => "",
        wayBeyond20NormalizeNameForTokenMatch: value => String(value || "").trim().toLowerCase(),
        // Local Temporary HP writer: record instead of driving the D&D Beyond input.
        wayBeyond20SetTemporaryHitPoints: async value => { log.tempHpRequests.push(value); return true; },
        wayBeyond20SendCustomMessageToExtension: message => log.roll20Messages.push(clone(message)),
        log
    };
    vm.createContext(context);
    vm.runInContext([
        damageFlagsSource,
        topLevelFunction(baseUtilsSource, "buildAttackRoll"),
        ...[
            "sendRollWithCharacter", "wayBeyond20DispatchRollWithCharacter", "wayBeyond20RestoreCharacterSheetTab", "addEffect", "wayBeyond20FormatSignedNumber",
            "wayBeyond20GetBardicInspirationDie", "wayBeyond20RollIsUnarmedStrike",
            "wayBeyond20NormalizeAttackSemantics", "wayBeyond20ApplyDrainingAttackIntent",
            "wayBeyond20ChooseUnarmedStrikeProfile", "wayBeyond20RollAgileStrike",
            "wayBeyond20CharacterMatchesMessageCharacter"
        ].map(name => topLevelFunction(characterSource, name)),
        topLevelFunction(roll20Source, "wayBeyond20SendResolvedDamageToDDB"),
        `const localRoller = ({ ${applyDamageBasedTempHPMethod} });`,
        `async function renderLocalTempHp(request, damage_rolls) { ${rendererTempHpBlock} }`,
        `function handleDamageResultMessage(request) { ${damageResultBody} }`
    ].join("\n"), context);

    // The dispatch stub stands in for sendRoll: a performed roll renders its damage locally
    // (D&D Beyond roller), exactly where roll_renderer.js awards Temporary HP.
    context.sendRoll = async (char, rollType, fallback, request) => {
        log.sendRollCalls++;
        if (whisperCancelled) return false;
        request.character = { id: char._id, name: char._name, "temp-hp": char._temp_hp };
        log.dispatched.push(clone(request));
        const damageRolls = request.rollDamage && rolledDamage > 0
            ? [["Damage", { total: rolledDamage }, vm.runInContext("DAMAGE_FLAGS.REGULAR", context)]]
            : [];
        await vm.runInContext("renderLocalTempHp", context).call({ _roller: vm.runInContext("localRoller", context) }, request, damageRolls);
        return true;
    };
    return context;
}

const run = (context, expression) => vm.runInContext(expression, context);

async function directAttack(context, { name, source = "action", properties, description = "" }) {
    const build = run(context, "buildAttackRoll");
    const rollProperties = await build(context.character, source, name, description, properties,
        ["1d6 + 3"], ["Slashing"], "+5", 0, false, false, { weapon_damage_length: 1 }, {});
    return run(context, "sendRollWithCharacter")("attack", "1d6 + 3", rollProperties);
}

const BOTH = ["Draining Attack", "Natural Attack"];
const lastRequest = context => context.log.dispatched[context.log.dispatched.length - 1];
const hasIntent = request => !!(request && request["waybeyond20-temp-hp-on-hit"]);

const nativeUnarmedStrike = {
    name: "Unarmed Strike",
    properties: { "Attack Type": "Melee", "Reach": "5 ft.", "Damage": "1d6 + 3", "Damage Type": "Slashing" }
};

(async () => {
    // 1. Both traits: every producer and profile attaches the intent.
    {
        const ctx = createSandbox({ traits: BOTH });
        await directAttack(ctx, nativeUnarmedStrike);
        assert.ok(hasIntent(lastRequest(ctx)), "native D&D Beyond Unarmed Strike row qualifies");
        assert.equal(lastRequest(ctx)["waybeyond20-unarmed-strike"], true);
    }
    {
        const ctx = createSandbox({ traits: BOTH });
        await directAttack(ctx, { name: "Weapon Attack", properties: { "Attack Type": "Unarmed Strike", "Reach": "5 ft." } });
        assert.ok(hasIntent(lastRequest(ctx)), "Attack Type Unarmed Strike qualifies without the name");
        const ctx2 = createSandbox({ traits: BOTH });
        await directAttack(ctx2, { name: "Strike", properties: { "Attack Type": "Melee", "Reach": "5 ft.", "Properties": "Unarmed Strike" } });
        assert.ok(hasIntent(lastRequest(ctx2)), "Properties Unarmed Strike qualifies without the name");
    }
    {
        const ctx = createSandbox({ traits: BOTH });
        await directAttack(ctx, { name: "Flurry of Blows", properties: { "Attack Type": "Melee", "Reach": "5 ft." } });
        assert.ok(hasIntent(lastRequest(ctx)), "Flurry of Blows makes Unarmed Strikes");
    }
    {
        // Natural-attack recognition that existed before is preserved.
        const ctx = createSandbox({ traits: BOTH });
        await directAttack(ctx, { name: "Fangs/Claws", properties: { "Attack Type": "Melee", "Reach": "5 ft." } });
        assert.ok(hasIntent(lastRequest(ctx)), "natural attack name still qualifies");
        const ctx2 = createSandbox({ traits: BOTH });
        await directAttack(ctx2, { name: "Hunger", properties: { "Reach": "5 ft." }, description: "You attack with your natural weapons." });
        assert.ok(hasIntent(lastRequest(ctx2)), "natural weapon description still qualifies on an action row");
    }
    {
        // Agile Strikes: the profile picker chooses naturalDex when no Bardic Damage.
        const ctx = createSandbox({ traits: BOTH, features: ["Dazzling Footwork"], abilities: { STR: 1, DEX: 3 } });
        await run(ctx, "wayBeyond20RollAgileStrike")();
        assert.equal(lastRequest(ctx)["waybeyond20-unarmed-damage-mode"], "naturalDex");
        assert.ok(hasIntent(lastRequest(ctx)), "Agile naturalDex qualifies");
    }
    {
        const ctx = createSandbox({ traits: BOTH, abilities: { STR: 4, DEX: 1 } });
        await run(ctx, "wayBeyond20RollAgileStrike")();
        assert.equal(lastRequest(ctx)["waybeyond20-unarmed-damage-mode"], "naturalStr");
        assert.ok(hasIntent(lastRequest(ctx)), "Agile naturalStr qualifies");
    }
    {
        // Ian's reproduction: equal expectation and modifier sorts bardic first. It must still qualify.
        const ctx = createSandbox({ traits: BOTH, features: ["Bardic Damage"], bardLevel: 1, abilities: { STR: 0, DEX: 3 } });
        const profile = await run(ctx, "wayBeyond20ChooseUnarmedStrikeProfile")();
        assert.equal(profile.damageMode, "bardic", "tie-break is unchanged");
        await run(ctx, "wayBeyond20RollAgileStrike")();
        assert.equal(lastRequest(ctx)["waybeyond20-unarmed-damage-mode"], "bardic");
        assert.ok(hasIntent(lastRequest(ctx)), "Agile bardic qualifies");
    }
    {
        const ctx = createSandbox({ traits: BOTH });
        ctx.wayBeyond20ChooseUnarmedStrikeProfile = async () => ({
            attackAbility: "STR", damageFormula: "1 + 1", damageType: "Bludgeoning",
            damageMode: "standard", expectedDamage: 2, attackMod: 1, toHit: "+3"
        });
        await run(ctx, "wayBeyond20RollAgileStrike")();
        assert.equal(lastRequest(ctx)["waybeyond20-unarmed-damage-mode"], "standard");
        assert.ok(hasIntent(lastRequest(ctx)), "Agile standard profile qualifies");
    }

    // 2. Each trait absent separately: no intent, for direct and Agile producers.
    for (const traits of [["Draining Attack"], ["Natural Attack"], []]) {
        const ctx = createSandbox({ traits, features: ["Bardic Damage"], bardLevel: 1 });
        await directAttack(ctx, nativeUnarmedStrike);
        assert.ok(!hasIntent(lastRequest(ctx)), `no intent with traits ${JSON.stringify(traits)}`);
        assert.ok(!(lastRequest(ctx).effects || []).includes(DRAINING_EFFECT));
        await run(ctx, "wayBeyond20RollAgileStrike")();
        assert.ok(!hasIntent(lastRequest(ctx)), `no Agile intent with traits ${JSON.stringify(traits)}`);
        assert.deepEqual(ctx.log.tempHpRequests, [], "no Temporary HP without both traits");
    }

    // 3. Unrelated attacks without Unarmed Strike semantics: no intent.
    {
        const ctx = createSandbox({ traits: BOTH });
        await directAttack(ctx, { name: "Longsword", source: "item", properties: { "Attack Type": "Melee", "Reach": "5 ft.", "Properties": "Versatile", "Proficient": "Yes" } });
        assert.ok(!hasIntent(lastRequest(ctx)), "weapon item does not qualify");
        assert.notEqual(lastRequest(ctx)["waybeyond20-unarmed-strike"], true);
        await directAttack(ctx, { name: "Iron Claw", source: "item", properties: { "Attack Type": "Melee", "Reach": "5 ft." }, description: "Wielded like natural weapons." });
        assert.ok(!hasIntent(lastRequest(ctx)), "weapon item named like a natural weapon does not qualify");
        await directAttack(ctx, { name: "Alter Self", source: "spell", properties: { "Range/Area": "Self" }, description: "Natural Weapons. You grow claws." });
        assert.ok(!hasIntent(lastRequest(ctx)), "a spell mentioning natural weapons does not qualify");
        await directAttack(ctx, { name: "Javelin", source: "item", properties: { "Attack Type": "Ranged", "Range": "30/120" } });
        assert.ok(!hasIntent(lastRequest(ctx)), "ranged weapon does not qualify");
        assert.deepEqual(ctx.log.tempHpRequests, []);
    }

    // 4. Same semantic attack through different producers: identical eligibility; applied once.
    {
        const requests = [];
        for (const producer of [
            ctx => directAttack(ctx, nativeUnarmedStrike),
            ctx => directAttack(ctx, { name: "Unarmed Strike", source: "item", properties: { "Attack Type": "Unarmed Strike", "Reach": "5 ft." } }),
            ctx => run(ctx, "wayBeyond20RollAgileStrike")()
        ]) {
            const ctx = createSandbox({ traits: BOTH, tempHp: 0, rolledDamage: 6 });
            await producer(ctx);
            const request = lastRequest(ctx);
            requests.push(request);
            assert.equal(request.effects.filter(effect => effect === DRAINING_EFFECT).length, 1, "effect added once");
            assert.deepEqual(ctx.log.tempHpRequests, [6], "one Temporary HP award per performed roll");
        }
        const shape = request => ({
            unarmed: request["waybeyond20-unarmed-strike"],
            mode: request["waybeyond20-temp-hp-on-hit"].mode,
            source: request["waybeyond20-temp-hp-on-hit"].source
        });
        assert.deepEqual(shape(requests[1]), shape(requests[0]));
        assert.deepEqual(shape(requests[2]), shape(requests[0]));

        // Re-normalizing an already-qualified request does not duplicate anything.
        const ctx = createSandbox({ traits: BOTH });
        const args = { name: "Unarmed Strike", "attack-source": "action", effects: [] };
        for (let i = 0; i < 3; i++) {
            run(ctx, "wayBeyond20NormalizeAttackSemantics")(args, args.name);
            run(ctx, "wayBeyond20ApplyDrainingAttackIntent")(args, args.name);
        }
        assert.equal(args.effects.filter(effect => effect === DRAINING_EFFECT).length, 1);
    }

    // 5. Local (D&D Beyond roller) Temporary HP: qualifying damage reaches the setter; higher
    //    existing Temporary HP is unchanged; no damage resolution awards nothing.
    {
        const ctx = createSandbox({ traits: BOTH, tempHp: 3, rolledDamage: 8 });
        await directAttack(ctx, nativeUnarmedStrike);
        assert.deepEqual(ctx.log.tempHpRequests, [8], "local path awards resolved damage");

        const higher = createSandbox({ traits: BOTH, tempHp: 12, rolledDamage: 8 });
        await directAttack(higher, nativeUnarmedStrike);
        assert.deepEqual(higher.log.tempHpRequests, [], "higher existing Temporary HP is not replaced (roller)");

        const noDamage = createSandbox({ traits: BOTH, rolledDamage: 0 });
        await directAttack(noDamage, nativeUnarmedStrike);
        assert.ok(hasIntent(lastRequest(noDamage)));
        assert.deepEqual(noDamage.log.tempHpRequests, [], "attack without resolved damage awards nothing");

        const messageOnly = createSandbox({ traits: BOTH });
        await run(messageOnly, "renderLocalTempHp").call(
            { _roller: run(messageOnly, "localRoller") },
            { "waybeyond20-temp-hp-on-hit": { mode: "damage-dealt" }, character: { "temp-hp": 0 } },
            [["Note", { total: 9 }, 0], ["Healing", { total: 9 }, 8]]
        );
        assert.deepEqual(messageOnly.log.tempHpRequests, [], "message and healing rows are not damage dealt");
    }
    {
        // The real setter also refuses to lower a higher existing value before touching the DOM.
        const ctx = createSandbox({ tempHp: 10 });
        vm.runInContext(topLevelFunction(characterSource, "wayBeyond20SetTemporaryHitPoints"), ctx);
        ctx.$ = () => { throw new Error("DOM must not be touched"); };
        assert.equal(await run(ctx, "wayBeyond20SetTemporaryHitPoints")(7), false);
        assert.equal(await run(ctx, "wayBeyond20SetTemporaryHitPoints")(10), false);
    }

    // 6. Roll20 resolved damage reaches the D&D Beyond handler for the right character only.
    {
        const ctx = createSandbox({ traits: BOTH });
        await directAttack(ctx, nativeUnarmedStrike);
        const original = lastRequest(ctx);
        const flags = run(ctx, "DAMAGE_FLAGS");
        run(ctx, "wayBeyond20SendResolvedDamageToDDB")({
            request: original,
            damage_rolls: [["Slashing", { total: 5 }, flags.REGULAR], ["Rage", { total: 2 }, flags.ADDITIONAL],
                ["Two-Handed", { total: 9 }, flags.VERSATILE]]
        });
        assert.equal(ctx.log.roll20Messages.length, 1);
        assert.equal(ctx.log.roll20Messages[0].totalDamage, 7);

        ctx.log.tempHpRequests.length = 0;
        run(ctx, "handleDamageResultMessage")(ctx.log.roll20Messages[0]);
        assert.deepEqual(ctx.log.tempHpRequests, [7], "Roll20 damage reaches the Temporary HP handler");
        run(ctx, "handleDamageResultMessage")(Object.assign({}, ctx.log.roll20Messages[0], { character: { id: 222, name: "Other" } }));
        assert.deepEqual(ctx.log.tempHpRequests, [7], "another character's damage is ignored");

        // No intent (unrelated weapon): Roll20 sends nothing.
        const weapon = createSandbox({ traits: BOTH });
        await directAttack(weapon, { name: "Longsword", source: "item", properties: { "Attack Type": "Melee", "Reach": "5 ft." } });
        run(weapon, "wayBeyond20SendResolvedDamageToDDB")({ request: lastRequest(weapon), damage_rolls: [["Slashing", { total: 5 }, flags.REGULAR]] });
        assert.equal(weapon.log.roll20Messages.length, 0);
    }

    // 7. Cancellation before performing the action awards nothing; a local roll without a VTT is valid.
    {
        const declined = createSandbox({ traits: BOTH, preflightAllowed: false });
        const request = await run(declined, "buildAttackRoll")(declined.character, "action", "Unarmed Strike", "",
            { "Attack Type": "Melee", "Reach": "5 ft." }, ["1d6"], ["Slashing"], "+5", 0, false, false, {}, {});
        request["waybeyond20-turn-resource"] = { resource: "action" };
        assert.equal(await run(declined, "sendRollWithCharacter")("attack", "1d6", request), null);
        assert.equal(declined.log.sendRollCalls, 0);
        assert.deepEqual(declined.log.tempHpRequests, [], "advisory Cancel awards nothing");

        const whisper = createSandbox({ traits: BOTH, whisperCancelled: true });
        assert.equal(await directAttack(whisper, nativeUnarmedStrike), false);
        assert.deepEqual(whisper.log.tempHpRequests, [], "whisper/advantage Cancel awards nothing");

        const local = createSandbox({ traits: BOTH, rolledDamage: 4 });
        assert.equal(await directAttack(local, nativeUnarmedStrike), true);
        assert.deepEqual(local.log.tempHpRequests, [4], "local D&D Beyond roll without a VTT awards");
    }

    console.log("v1.65 Draining Attack eligibility checks passed.");
})().catch(error => {
    console.error(error);
    process.exit(1);
});
