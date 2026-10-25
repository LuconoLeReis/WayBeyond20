// Stat blocks enter the same lifecycle without impersonating the open sheet.
// Their builders still own parsing/form riders; sendRoll still owns privacy and
// destination dice. No reliable creature target/resource owner exists yet, so
// hit/damage remain destination-owned, explicitly recorded in local context.
function wb20CreateStatBlockAttackWorkflow(actor, fallback, args, caller) {
    const identity = () => JSON.stringify([actor.type(), actor._id, actor._name, actor._creatureType]);
    const originalIdentity = identity();
    const parent = actor._parent_character;
    const sourceNodes = actor._stat_block?.toArray?.() || [];
    const route = () => {
        const value = actor.getGlobalSetting("vtt-tab", null);
        return value ? {id: value.id, vtt: value.vtt, title: value.title} : null;
    };
    const destination = route();
    const adapter = {
        isCurrent: () => identity() === originalIdentity && actor._parent_character === parent &&
            sourceNodes.every(node => node.isConnected) && JSON.stringify(route()) === JSON.stringify(destination),
        prepare: async () => true,
        needsHit: () => false,
        dispatch: async (attack, properties) => ({accepted: await sendRoll(actor, "attack", fallback, properties, adapter.isCurrent) === true}),
        // Required lifecycle hooks are deliberately unreachable with destination
        // hit ownership. Do not invent a hit or a parent-sheet damage continuation.
        confirmHit: async () => null,
        finishDamage: async () => false
    };
    return wb20CreateAttackWorkflow({actor, caller, rollType: "attack", fallback, args,
        destination, hitOwner: "destination", resourceOwner: null, targetKey: null}, adapter);
}

async function wb20SendStatBlockAttack(actor, fallback, args, caller) {
    if (!actor.getGlobalSetting("waybeyond20-secondary-attacks", false))
        return sendRoll(actor, "attack", fallback, args);
    const workflow = wb20CreateStatBlockAttackWorkflow(actor, fallback, args, caller);
    try { return await workflow.run(); }
    finally { console.debug("WayBeyond20: secondary attack", caller, workflow.context.trace); }
}
