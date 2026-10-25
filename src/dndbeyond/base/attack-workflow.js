// Secondary attack workflow. Character callers use an explicit, default-off gate.
// Keep context/ownership here, outside the serialized roll arguments. The adapter
// supplies existing rule modules; it must not silently substitute another actor.
function wb20AttackEscape(value) {
    return String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"}[c]));
}

async function wb20ConfirmAttackOutcome(name, rolls) {
    const active = rolls.filter(roll => !roll.isDiscarded());
    const label = roll => `${wb20AttackEscape(roll.total)}${roll.isCriticalHit?.() ? " — Critical Hit" : ""}`;
    const choices = active.map((roll, index) => `<option value="${index}">${label(roll)}</option>`).join("");
    const html = `<form class="wb20-feature-prompt wb20-attack-outcome"><p>${wb20AttackEscape(name)}</p>` +
        (active.length > 1 ? `<label>Attack result <select name="attack-index" aria-label="Attack result">${choices}</select></label>` :
            `<input type="hidden" name="attack-index" value="0"><p>Attack result: <strong>${active.length ? label(active[0]) : "Not available"}</strong></p>`) +
        '<input type="hidden" name="outcome" value="hit"></form>';
    const form = await dndbeyondDiceRoller._prompter.prompt("Attack result", html, "Hit", "Skip/Cancel");
    if (!form || typeof form.find !== "function") return {hit: null, roll: null};
    const outcome = form.find('[name="outcome"]').val();
    const index = Number(form.find('[name="attack-index"]').val());
    return {hit: outcome === "hit" ? true : outcome === "miss" ? false : null,
        roll: Number.isInteger(index) ? active[index] || null : null};
}

function wb20CreateAttackWorkflow(context, adapter) {
    if (!context?.actor || !context.caller || !["attack", "spell-attack"].includes(context.rollType))
        throw new TypeError("An attack needs its actor, caller and roll type.");
    for (const method of ["prepare", "needsHit", "dispatch", "confirmHit", "finishDamage", "isCurrent"])
        if (typeof adapter?.[method] !== "function") throw new TypeError(`Missing attack adapter: ${method}`);

    // Copy mutable argument arrays, but retain deliberate identity-bearing records
    // such as granted-attack ledgers and callbacks. Do not JSON-clone those away.
    const args = Object.fromEntries(Object.entries(context.args || {}).map(([key, value]) =>
        [key, Array.isArray(value) ? value.slice() : value]));
    const attack = {...context, args, trace: []};
    let running = null, damageRunning = null, pending = null;
    const trace = stage => attack.trace.push(stage);
    const current = () => adapter.isCurrent(attack);
    const schedule = task => adapter.schedule ? adapter.schedule(task) : Promise.resolve().then(task);
    const finishDamage = () => {
        // Retain even a failed promise: retrying transport is not permission to
        // reroll or repeat a resource spend. A new attack needs a new operation.
        if (!damageRunning) damageRunning = Promise.resolve().then(async () => {
            if (!pending || !current()) return false;
            trace("damage");
            const result = await adapter.finishDamage(attack, pending);
            trace(result === true ? "damage-finished" : "damage-incomplete");
            return result;
        });
        return damageRunning;
    };
    return {
        // These diagnostics are local. No actor object, callbacks, target state,
        // routing settings or trace is added to the outgoing roll payload.
        context: attack,
        run() {
            if (!running) running = schedule(async () => {
                if (!current()) return false;
                trace("prepare");
                if (await adapter.prepare(attack) !== true || !current()) return false;
                trace("choose-hit-handling");
                if (!adapter.needsHit(attack)) {
                    trace("dispatch");
                    return (await adapter.dispatch(attack, attack.args)).accepted;
                }
                let resolved = {attacks: [], damages: [], request: null};
                if (attack.args.rollAttack) {
                    trace("attack");
                    resolved = await adapter.dispatch(attack, {...attack.args, rollDamage: false,
                        "waybeyond20-await-hit": true, "waybeyond20-followup-phase": "base",
                        "waybeyond20-managed-damage": !!attack.args.rollDamage});
                    if (!resolved.accepted) return false;
                }
                // Never infer a hit from successful delivery. Recheck ownership
                // after asynchronous work before asking or applying an effect.
                if (!current()) return false;
                trace("confirm-hit");
                const decision = await adapter.confirmHit(attack, resolved);
                if (!current()) return false;
                // null means skip/unknown, not a confirmed miss. Only a definite
                // boolean may become an AC observation through the target module.
                if (typeof decision === "boolean" && adapter.observeHit) {
                    trace("observe-hit");
                    await adapter.observeHit(attack, resolved, decision);
                }
                if (decision !== true) { trace("damage-declined"); return true; }
                pending = resolved;
                if (attack.args.rollDamage) return finishDamage();
                trace("await-damage");
                return true;
            });
            return running;
        },
        continueDamage() {
            // An early click must not memoize false and disable the later valid
            // continuation. Once ready, concurrent/repeated calls share one run.
            if (!pending) return Promise.resolve(false);
            return schedule(finishDamage);
        }
    };
}
