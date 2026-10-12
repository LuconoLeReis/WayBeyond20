// Character-sheet continuations. Reuse the existing roller, prompts and spenders; never
// treat delivery of an attack as evidence that it hit. No VTT-specific dice syntax here.
let wayBeyond20AttackFollowupQueue = Promise.resolve();
const wayBeyond20PendingAttackDamage = new Map();

function wayBeyond20QueueAttackFollowup(args, eligible) {
    if (eligible) args["waybeyond20-smite-eligible"] = true;
}

function wayBeyond20NeedsAttackFollowup(args) {
    return args && !args["waybeyond20-followup-phase"] &&
        (args.rollAttack || args.rollDamage) &&
        (args["waybeyond20-smite-eligible"] || args["waybeyond20-savage-attacker"]?.mode === "post-result" ||
            (args["waybeyond20-unarmed-strike"] && character.hasRacialTrait("Draining Attack")));
}

function wayBeyond20RunAttackFollowup(rollType, fallback, args) {
    // The real Alertify prompt is shared. Serializing these chains prevents a second
    // attack from replacing the first attack's unresolved choice.
    const owner = character;
    const run = wayBeyond20AttackFollowupQueue.then(() => {
        if (character !== owner) return false;
        return wayBeyond20ResolveAttackFollowup(rollType, fallback, args);
    });
    wayBeyond20AttackFollowupQueue = run.catch(() => {});
    return run;
}

function wayBeyond20EscapeFollowupText(value) {
    return String(value ?? "").replace(/[&<>"']/g, c => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
}

async function wayBeyond20ConfirmAttackHit(name, rolls) {
    const results = rolls.filter(roll => !roll.isDiscarded()).map(roll => roll.total).join(" / ");
    const html = `<form><p>${wayBeyond20EscapeFollowupText(name)}${results ? `: <strong>${results}</strong>` : ""}</p>` +
        '<p>Did this attack hit?</p></form>';
    return !!await dndbeyondDiceRoller._prompter.prompt("Attack result", html, "Hit", "Miss / Skip");
}

async function wayBeyond20ResolveAttackFollowup(rollType, fallback, args) {
    const originalTab = wayBeyond20ActiveCharacterSheetTab();
    let smiteOptions = null;
    try {
        if (args["waybeyond20-smite-eligible"]) smiteOptions = await wayBeyond20BuildSmiteOptions();
    } finally {
        wayBeyond20RestoreCharacterSheetTab(originalTab);
    }
    const savage = args["waybeyond20-savage-attacker"];
    wayBeyond20NormalizeAttackSemantics(args, args.name || fallback);
    wayBeyond20ApplyDrainingAttackIntent(args, args.name || fallback);
    const draining = args["waybeyond20-temp-hp-on-hit"];
    args["waybeyond20-followup-phase"] = "base";
    if (!smiteOptions && savage?.mode !== "post-result" && !draining) {
        return sendRollWithCharacter(rollType, fallback, args);
    }

    // Resolve once on DDB, then send those same results through rendered-roll delivery.
    // The normal automatic-damage setting still determines whether damage follows now
    // or waits for the existing Roll Damages button, but never before the hit decision.
    let resolved = { attacks: [], damages: [], request: null };
    const base = { ...args, rollDamage: false, "waybeyond20-await-hit": true };
    base["waybeyond20-capture-result"] = (request, attacks, damages) => {
        resolved = { request, attacks, damages };
    };
    let continuation = null;
    if (args.rollAttack && !args.rollDamage) {
        const tab = await wayBeyond20SendRuntimeMessage({ action: "get-current-tab" });
        if (tab.ok && Number.isInteger(tab.response?.id)) {
            const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
            continuation = { tab: tab.response.id, id };
            base["waybeyond20-attack-continuation"] = continuation;
            wayBeyond20PendingAttackDamage.set(id, { ready: false });
            // Bound old chat links without growing an unbounded session history.
            if (wayBeyond20PendingAttackDamage.size > 100)
                wayBeyond20PendingAttackDamage.delete(wayBeyond20PendingAttackDamage.keys().next().value);
        }
    }
    base["waybeyond20-managed-damage"] = !!args.rollDamage;
    if (args.rollAttack) {
        const sent = await sendRollWithCharacter(rollType, fallback, base);
        if (sent !== true) {
            if (continuation) wayBeyond20PendingAttackDamage.delete(continuation.id);
            return sent;
        }
    }
    if (!await wayBeyond20ConfirmAttackHit(args.name || fallback, resolved.attacks)) {
        if (continuation) wayBeyond20PendingAttackDamage.set(continuation.id, { ready: true, declined: true });
        return true;
    }

    const critical = !!args.rollCritical || resolved.attacks.some(roll => !roll.isDiscarded() && roll.isCriticalHit());
    const riderDamage = [];
    if (smiteOptions) {
        const smite = {
            name: args.name, description: "", rollAttack: false, rollDamage: true, rollCritical: critical,
            damages: [], "damage-types": [], "critical-damages": [], "critical-damage-types": [],
            advantage: RollType.NORMAL,
            "waybeyond20-followup-phase": "smite", "waybeyond20-hit-confirmed": true
        };
        if (resolved.request) smite.whisper = resolved.request.whisper;
        const selection = await wayBeyond20MaybeAddSmite(smite, true);
        if (selection) {
            smite.name = selection.smite.name;
            smite.description = selection.smite.description || "";
            let rolled = [];
            smite["waybeyond20-capture-result"] = (request, attacks, damages) => { rolled = damages; };
            if (await sendRollWithCharacter("spell-attack", smite.damages[0], smite) === true)
                riderDamage.push(...rolled, ...(smite["waybeyond20-elemental-damage"] || []));
        }
    }
    const pending = { ready: true, owner: character, args, rollType, fallback, critical,
        whisper: resolved.request?.whisper, savage, draining, riderDamage };
    if (args.rollDamage) await wayBeyond20FinishAttackDamage(pending);
    else if (continuation) wayBeyond20PendingAttackDamage.set(continuation.id, pending);
    return true;
}

async function wayBeyond20FinishAttackDamage(pending) {
    if (pending.owner !== character) return false;
    const { args, rollType, fallback, critical, savage, draining, riderDamage } = pending;
    const damageArgs = { ...args, rollAttack: false, rollDamage: true, rollCritical: critical,
        advantage: RollType.NORMAL, "waybeyond20-await-hit": true, "waybeyond20-followup-phase": "damage" };
    // This is the damage from an already-performed attack, not another attack/action.
    for (const key of ["to-hit", "waybeyond20-turn-resource", "waybeyond20-turn-resources",
        "waybeyond20-limited-use", "waybeyond20-after-dispatch", "waybeyond20-attack-continuation"])
        delete damageArgs[key];
    if (pending.whisper !== undefined) damageArgs.whisper = pending.whisper;
    let resolved = null;
    damageArgs["waybeyond20-capture-result"] = (request, attacks, damages) => { resolved = { request, damages }; };
    if (await sendRollWithCharacter(rollType, fallback, damageArgs) !== true || !resolved) return false;
    if (savage)
        await wayBeyond20ResolveSavageAttacker(resolved.request, resolved.damages, savage);
    if (draining) {
        const damage = resolved.damages.concat(riderDamage).reduce((sum, [, roll, flags]) => {
            if (flags & (DAMAGE_FLAGS.HEALING | DAMAGE_FLAGS.VERSATILE | DAMAGE_FLAGS.CONDITIONAL)) return sum;
            return sum + (Number(roll?.total) || 0);
        }, 0);
        await dndbeyondDiceRoller._roller.applyDamageBasedTempHP(damage, resolved.request);
    }
    return true;
}

function wayBeyond20ContinueAttackDamage(id) {
    const pending = wayBeyond20PendingAttackDamage.get(id);
    if (!pending?.ready) return Promise.resolve(false);
    if (pending.running) return pending.running;
    if (pending.declined) return Promise.resolve(false);
    // Keep the resolved promise: repeated clicks/forwarded callbacks never reroll or spend.
    pending.running = wayBeyond20AttackFollowupQueue.then(() => wayBeyond20FinishAttackDamage(pending));
    wayBeyond20AttackFollowupQueue = pending.running.catch(() => {});
    return pending.running;
}

async function wayBeyond20AfterDivineSmite(args) {
    const originalTab = wayBeyond20ActiveCharacterSheetTab();
    try {
        const rider = {
            name: "Elemental Strike", description: "", rollAttack: false, rollDamage: true,
            advantage: RollType.NORMAL,
            "waybeyond20-followup-phase": "elemental"
        };
        const whisper = args["waybeyond20-resolved-whisper"] ?? args.whisper;
        if (whisper !== undefined) rider.whisper = whisper;
        const choice = await wayBeyond20MaybeAddElementalStrike(rider, "Divine Smite");
        if (!choice) return;
        rider.name = choice.name;
        // No second Bonus Action and no second spell slot. Existing CD preflight/spender
        // and Djinni effect commit still run through the normal dispatcher.
        let rolled = [];
        if (rider.damages?.length)
            rider["waybeyond20-capture-result"] = (request, attacks, damages) => { rolled = damages; };
        if (await sendRollWithCharacter(rider.damages?.length ? "spell-attack" : "trait", rider.damages?.[0] || 0, rider) === true)
            args["waybeyond20-elemental-damage"] = rolled;
    } finally {
        wayBeyond20RestoreCharacterSheetTab(originalTab);
    }
}

function wayBeyond20SavageOfferKey() {
    const state = wayBeyond20GetTurnTrackerState();
    if (!wayBeyond20HasActiveCombatState(state)) return null;
    // Use the current combatant too: once per turn is not once per own turn.
    return [state.combatStartedAt, state.localTurnNumber, state.currentRoll20Turn?.turnKey || "manual"].join(":");
}

async function wayBeyond20ResolveSavageAttacker(request, damages, intent) {
    const ask = intent.mode === "post-result";
    const key = ask ? wayBeyond20SavageOfferKey() : null;
    if (key && character.getSetting("waybeyond20-savage-offered-turn", null) === key) return;
    const types = new Set(intent.originalDamages.map(row => `${row.type} Damage`));
    const selected = damages.filter(([label, roll, flags]) => types.has(label.replace(" Critical Damage", " Damage")) &&
        roll && typeof roll.formula === "string" && !(flags & DAMAGE_FLAGS.CONDITIONAL));
    if (!selected.length) return;
    // A declined offer is still an offer; do not nag on each extra attack.
    if (key) character.mergeCharacterSettings({ "waybeyond20-savage-offered-turn": key });
    const amounts = selected.map(([label, roll]) => `${wayBeyond20EscapeFollowupText(label)}: ${roll.total}`).join("<br>");
    const chosen = !ask || await dndbeyondDiceRoller._prompter.prompt("Savage Attacker",
        `<form><p>${amounts}</p><p>Roll the weapon damage again and keep the higher total?</p></form>`,
        "Use Savage Attacker", "Keep original");
    if (!chosen) return;
    const rerolls = selected.map(([, roll]) => dndbeyondDiceRoller._roller.roll(roll.formula));
    await dndbeyondDiceRoller._roller.resolveRolls("Savage Attacker", rerolls, request);
    // Compare complete weapon packages, including their critical dice. Versatile
    // alternatives remain separate packages; never choose each die independently.
    const groups = new Map();
    selected.forEach((entry, index) => {
        const group = entry[2] & DAMAGE_FLAGS.VERSATILE ? "versatile" : "regular";
        if (!groups.has(group)) groups.set(group, []);
        groups.get(group).push(index);
    });
    const replacements = [];
    groups.forEach(indices => {
        const oldTotal = indices.reduce((sum, i) => sum + selected[i][1].total, 0);
        const newTotal = indices.reduce((sum, i) => sum + rerolls[i].total, 0);
        indices.forEach(i => {
            const entry = selected[i];
            const kept = newTotal > oldTotal ? rerolls[i] : entry[1];
            damages[damages.indexOf(entry)] = [entry[0], kept, entry[2]];
            replacements.push([entry[0], kept, entry[2]]);
        });
    });
    const result = { ...request, name: "Savage Attacker — replacement weapon damage", rollAttack: false,
        rollDamage: true, "waybeyond20-savage-attacker": { ...intent, mode: "resolved" } };
    delete result["waybeyond20-temp-hp-on-hit"];
    await dndbeyondDiceRoller.postDescription(result, result.name, null, {},
        "Use this weapon damage instead of the original weapon damage. Smite and other added damage are unchanged.",
        [], [], replacements);
}
