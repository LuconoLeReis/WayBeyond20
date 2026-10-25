// Secondary character adapter. Production entry is explicitly opt-in.
// Existing builders/preflight/spenders/renderers remain the source of rule behavior.
// This first adapter covers prepared character attacks, not anonymous native dice,
// creature ownership, or an un-attributed damage notification from a destination.
function wb20CreateCharacterAttackWorkflow(rollType, fallback, args, caller) {
    const owner = character;
    const state = typeof wayBeyond20GetTurnTrackerState === "function" ? wayBeyond20GetTurnTrackerState() : null;
    const entryTurnKey = wayBeyond20AttackActivationTurnKey();
    const isOwnTurn = !(wayBeyond20HasActiveCombatState(state || {}) && state?.currentRoll20Turn?.isThisCharactersTurn === false);
    const selectedDestination = owner.getGlobalSetting?.("vtt-tab", null);
    const destination = selectedDestination ? {id: selectedDestination.id, vtt: selectedDestination.vtt, title: selectedDestination.title} : null;
    const destinationKey = value => JSON.stringify(value ? [value.vtt, value.id, value.title] : null);
    let smiteOptions, savage, draining, features, manageHit = false, ancestorFollowup;
    const adapter = {
        isCurrent: () => character === owner &&
            destinationKey(owner.getGlobalSetting?.("vtt-tab", null)) === destinationKey(destination),
        schedule(task) {
            // Share the ancestor's prompt queue while its modules still participate.
            const run = wayBeyond20AttackFollowupQueue.then(task);
            wayBeyond20AttackFollowupQueue = run.catch(() => {});
            return run;
        },
        async prepare(attack) {
            if (entryTurnKey !== wayBeyond20AttackActivationTurnKey()) return false;
            if (!attack.args["waybeyond20-attack-context"]) {
                attack.args["waybeyond20-attack-context"] = {
                    turnKey: entryTurnKey, isOwnTurn
                };
            }
            if (typeof wb20FeaturePrepareAttack === "function" && !await wb20FeaturePrepareAttack(attack.args)) return false;
            ancestorFollowup = wayBeyond20NeedsAttackFollowup(attack.args);
            wayBeyond20NormalizeAttackSemantics(attack.args, attack.args.name || fallback);
            wayBeyond20ApplyDrainingAttackIntent(attack.args, attack.args.name || fallback);
            smiteOptions = attack.args["waybeyond20-attack-context"]?.isOwnTurn !== false &&
                attack.args["waybeyond20-smite-eligible"] && wayBeyond20MayHaveSmiteAfterHit();
            savage = attack.args["waybeyond20-savage-attacker"];
            draining = attack.args["waybeyond20-temp-hp-on-hit"];
            features = typeof wb20FeatureNeedsHit === "function" && wb20FeatureNeedsHit(attack.args);
            return true;
        },
        needsHit(attack) {
            manageHit = !attack.args["waybeyond20-followup-phase"] &&
                !!(attack.args.rollAttack || attack.args.rollDamage) &&
                !!(smiteOptions || savage?.mode === "post-result" || draining || features ||
                    attack.targetKey && attack.args.rollAttack && attack.args["to-hit"]);
            if (!manageHit && ancestorFollowup) attack.args["waybeyond20-followup-phase"] = "base";
            return manageHit;
        },
        async dispatch(attack, properties, type = rollType, rollFallback = fallback) {
            if (!adapter.isCurrent()) return {accepted: false, request: null, attacks: [], damages: []};
            const args = {...properties};
            let result = {accepted: false, request: null, attacks: [], damages: []};
            // Capture only the managed base. Capturing ordinary attacks would force
            // local resolution in sendRoll and change the existing VTT dice behavior.
            if (manageHit && args["waybeyond20-followup-phase"] === "base") {
                if (!attack.args.rollDamage && !attack.continuation) {
                    const tab = await wayBeyond20SendRuntimeMessage({action: "get-current-tab"});
                    if (tab.ok && Number.isInteger(tab.response?.id)) {
                        const id = `workflow-${Date.now()}-${Math.random().toString(36).slice(2)}`;
                        attack.continuation = {id, tab: tab.response.id};
                        wayBeyond20PendingAttackDamage.set(id, {ready: true, workflow: operation});
                        if (wayBeyond20PendingAttackDamage.size > 100)
                            wayBeyond20PendingAttackDamage.delete(wayBeyond20PendingAttackDamage.keys().next().value);
                    }
                }
                if (attack.continuation) args["waybeyond20-attack-continuation"] = attack.continuation;
                const capture = args["waybeyond20-capture-result"];
                args["waybeyond20-capture-result"] = (request, attacks, damages) => {
                    result = {...result, request, attacks, damages};
                    if (capture) capture(request, attacks, damages);
                };
            }
            const intents = {isCurrent: adapter.isCurrent};
            for (const [field, name] of [["limited-use", "limitedUseRequest"], ["smite", "smiteRequest"],
                ["noble-genie-rider", "nobleGenieRider"], ["occultist-intrusion", "intrusionRequest"],
                ["after-dispatch", "afterDispatchCommits"]]) {
                const key = `waybeyond20-${field}`;
                intents[name] = args[key];
                delete args[key];
            }
            if (!Array.isArray(intents.afterDispatchCommits)) intents.afterDispatchCommits = [];
            try {
                const accepted = await wayBeyond20DispatchRollWithCharacter(type, rollFallback, args, intents);
                result.accepted = accepted === true && adapter.isCurrent();
                if (result.accepted && args["waybeyond20-elemental-after-cast"])
                    await wayBeyond20AfterDivineSmite(args, perform(attack));
                // The shared elemental module appends its result on the properties
                // passed to it. Preserve that result for the outer damage total.
                if (args["waybeyond20-elemental-damage"])
                    properties["waybeyond20-elemental-damage"] = args["waybeyond20-elemental-damage"];
                return result;
            } finally {
                if (intents.smiteRequest?.returnTab) wayBeyond20RestoreCharacterSheetTab(intents.smiteRequest.returnTab);
            }
        },
        async confirmHit(attack, resolved) {
            const decision = await wb20ConfirmAttackOutcome(attack.args.name || fallback, resolved.attacks);
            attack.confirmedRoll = decision.roll;
            return decision.hit;
        },
        observeHit(attack, resolved, hit) {
            return typeof wb20TargetObserveAttack === "function" && wb20TargetObserveAttack(attack, attack.confirmedRoll, hit);
        },
        async finishDamage(attack, resolved) {
            const critical = !!attack.args.rollCritical || !!attack.confirmedRoll?.isCriticalHit();
            const sameTurn = attack.args["waybeyond20-attack-context"]?.turnKey === wayBeyond20AttackActivationTurnKey();
            return wayBeyond20FinishAttackDamage({ready: true, owner, args: attack.args, rollType, fallback,
                critical, whisper: resolved.request?.whisper, savage, draining, smiteOptions, monk: features && sameTurn}, perform(attack));
        }
    };
    // Rule modules send each ordered damage/rider request through this operation's
    // dispatcher. They do not restart attack preparation, hit choice or its costs.
    const perform = attack => async (type, rollFallback, properties) =>
        (await adapter.dispatch(attack, properties, type, rollFallback)).accepted;
    const operation = wb20CreateAttackWorkflow({actor: owner, caller, rollType, fallback, args,
        targetKey: state?.selectedTargetKey || null, combatSource: state?.combatSource || null,
        boardKey: typeof wb20AttackBoardKey === "function" ? wb20AttackBoardKey() : null,
        combatStartedAt: state?.combatStartedAt,
        // This is the destination requested at entry, not evidence of receipt.
        destination: destination ? {id: destination.id, vtt: destination.vtt, title: destination.title} : null
    }, adapter);
    return operation;
}
