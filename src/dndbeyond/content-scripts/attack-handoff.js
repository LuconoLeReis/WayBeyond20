// UI intent only. Once DDB supplies a ready pane, the existing execute/builders
// enter the attack lifecycle. No rolls, rules, targets or costs live here.
let wb20CombatHandoff = null;

function wb20CancelCombatHandoff() {
    if (!wb20CombatHandoff) return;
    clearTimeout(wb20CombatHandoff.startTimer);
    clearTimeout(wb20CombatHandoff.expiryTimer);
    wb20CombatHandoff = null;
}

function wb20ContinueCombatHandoff() {
    const request = wb20CombatHandoff;
    if (!request) return false;
    if (!request.isCurrent()) { wb20CancelCombatHandoff(); return false; }
    const rowName = row => $(row).find('.ct-combat-attack__label,.ddbc-combat-attack__label').first().text().trim();
    if (request.row.isConnected) {
        if (!request.control.isConnected || rowName(request.row) !== request.name) {
            wb20CancelCombatHandoff(); return false;
        }
    } else {
        // React can replace the source row while opening the pane. Rebind only
        // a unique equivalent row; never execute from an unrelated stale node.
        const rows = [...document.querySelectorAll('.ct-combat-attack,.ddbc-combat-attack')]
            .filter(row => row.getClientRects().length && rowName(row) === request.name && row.querySelector(request.controlSelector));
        if (rows.length !== 1) return false;
        request.row = rows[0];
        request.control = rows[0].querySelectorAll(request.controlSelector)[request.controlIndex];
        if (!request.control) { wb20CancelCombatHandoff(); return false; }
    }
    for (const paneClass of ['b20-item-pane','b20-action-pane','ct-custom-action-pane','b20-custom-action-pane','ct-spell-pane']) {
        const panes = [...document.querySelectorAll('.' + paneClass)];
        if (panes.length !== 1) continue;
        const pane = $(panes[0]);
        if (pane.find('.ct-sidebar__heading').text().trim() !== request.name) continue;
        const properties = propertyListToDict(pane.find('[role=list] > div'));
        // A heading alone is not a ready action. Modern action panes need not
        // contain the old ct-available-actions class. Reuse the real parser.
        if (!['To Hit','Damage','Attack/Save'].some(key => properties[key] !== undefined)) continue;
        const options = request.options;
        wb20CancelCombatHandoff(); // Claim before execute can trigger mutations.
        Promise.resolve(execute(paneClass, options)).catch(error =>
            console.warn('WayBeyond20: attack shortcut could not complete.', error));
        return true;
    }
    return false;
}

function wb20RequestCombatHandoff(control, options) {
    const row = control.closest('.ct-combat-attack,.ddbc-combat-attack');
    if (!row) return false;
    const name = $(row).find('.ct-combat-attack__label,.ddbc-combat-attack__label').first().text().trim();
    if (!name) return false;
    wb20CancelCombatHandoff();
    resetHijackQuickRollState();
    const owner = character;
    const identity = () => JSON.stringify([owner._id, owner._name]);
    const originalIdentity = identity();
    const route = () => {
        const value = owner.getGlobalSetting?.('vtt-tab', null);
        return JSON.stringify(value ? [value.vtt, value.id, value.title] : null);
    };
    const originalRoute = route(), path = window.location.pathname;
    const getTurnKey = typeof wayBeyond20AttackActivationTurnKey === 'function' ? wayBeyond20AttackActivationTurnKey : null;
    const turn = getTurnKey ? getTurnKey() : null;
    const controlSelector = options.force_to_hit_only
        ? '.ct-combat-attack__tohit .integrated-dice__container,.ddbc-combat-attack__tohit .integrated-dice__container'
        : options.force_damages_only
            ? '.ct-combat-attack__damage .integrated-dice__container,.ddbc-combat-attack__damage .integrated-dice__container'
            : '.ct-combat-attack__icon,.ddbc-combat-attack__icon';
    const request = {row, control, controlSelector, controlIndex: options.force_versatile ? 1 : 0,
        name, options: {...options}, isCurrent: () => character === owner && identity() === originalIdentity &&
            route() === originalRoute && window.location.pathname === path &&
            !(typeof isExtensionDisconnected === 'function' && isExtensionDisconnected()) &&
            (!getTurnKey || turn === getTurnKey())};
    wb20CombatHandoff = request;
    // No polling loop: the normal document observer resumes this same request
    // as native heading/body/properties arrive. A later unrelated click cancels it.
    request.startTimer = setTimeout(() => {
        if (wb20CombatHandoff !== request || !request.isCurrent()) {
            if (wb20CombatHandoff === request) wb20CancelCombatHandoff();
            return;
        }
        if (wb20ContinueCombatHandoff() || wb20CombatHandoff !== request) return;
        const label = request.row.querySelector('.ct-combat-attack__name .ct-combat-attack__label,.ddbc-combat-attack__name .ddbc-combat-attack__label');
        if (label) label.click();
        else wb20CancelCombatHandoff();
    }, 0);
    request.expiryTimer = setTimeout(() => {
        if (wb20CombatHandoff === request) wb20CancelCombatHandoff();
    }, 5000);
    return true;
}
