/* Player-maintained combat target notes. Selection and observations never
 * spend character resources or write another creature's sheet/token. */
function wb20TargetAC(observations = []) {
    let lower = null, upper = null;
    for (const observation of observations) {
        const total = observation.total;
        if (!Number.isInteger(total)) continue;
        if (observation.hit) upper = upper === null ? total : Math.min(upper, total);
        else lower = lower === null ? total + 1 : Math.max(lower, total + 1);
    }
    if (lower !== null && upper !== null) return lower === upper ? String(lower) : `${lower}\u2013${upper}`;
    if (lower !== null) return `\u2265${lower}`;
    if (upper !== null) return `\u2264${upper}`;
    return "??";
}

function wb20TargetRecord(state) {
    return state.targetRecords?.[state.selectedTargetKey] || {observations: [], damage: []};
}

function wb20TargetEdit(update) {
    const state = {...wayBeyond20GetTurnTrackerState()};
    if (!state.selectedTargetKey) return;
    const old = wb20TargetRecord(state);
    const record = {...old, observations: [...(old.observations || [])], damage: [...(old.damage || [])]};
    update(record);
    state.targetRecords = {...state.targetRecords, [state.selectedTargetKey]: record};
    wayBeyond20SetTurnTrackerState(state, wayBeyond20ScheduleActiveEffectBadgeRefresh);
    // The state setter updates memory synchronously and queues persistence.
    // Paint this edit before the next gesture is aimed, not when its delayed
    // storage callback arrives: shrinking history can otherwise move the next
    // button even BEFORE pointerdown (outside the gesture guard below).
    const section = $(".waybeyond20-combat-section");
    if (section.length) wb20TargetMount(section.first(), wayBeyond20GetTurnTrackerState());
}

function wb20TargetChoose(key) {
    const state = {...wayBeyond20GetTurnTrackerState()};
    const target = (state.knownTargets || []).find(t => (t.tokenId || t.key) === key);
    if (key && !target) return;
    state.selectedTargetKey = key;
    if (target) state.targetRecords = {...state.targetRecords,
        [key]: {...(state.targetRecords?.[key] || {observations: [], damage: []}), name: target.name, initiative: target.initiative || ""}};
    wayBeyond20SetTurnTrackerState(state, wayBeyond20ScheduleActiveEffectBadgeRefresh);
}

function wb20TargetBuildPanel(state) {
    const panel = $("<aside>").addClass("wb20-my-target").attr({"aria-label": "My Target", "data-target-key": state.selectedTargetKey || ""});
    // A delayed save can shorten history and scroll the page between a second
    // button's pointerdown and pointerup. Keep its click target stationary until
    // the gesture completes; keyboard activation still uses the normal click.
    panel.on("pointerdown", event => {
        if (event.button !== 0 || panel.data("pointerHeld")) return;
        panel.data("pointerHeld", true);
        const release = event => {
            if (event.type === "blur" && event.target !== window) return;
            window.removeEventListener("pointerup", release, true);
            window.removeEventListener("pointercancel", release, true);
            window.removeEventListener("blur", release, true);
            panel.data("pointerHeld", false);
            if (panel.data("refreshPending") && panel[0].isConnected) {
                panel.data("refreshPending", false);
                // The click event follows pointerup. Use the existing debounced
                // refresh so it runs after the click handler saves its change.
                wayBeyond20ScheduleActiveEffectBadgeRefresh();
            }
        };
        window.addEventListener("pointerup", release, true);
        window.addEventListener("pointercancel", release, true);
        window.addEventListener("blur", release, true);
    });
    const heading = $("<div>").addClass("wb20-target-label").text("Target");
    const select = $("<select>").attr("aria-label", "Choose my target");
    select.append($("<option>").val("").text("Select a target"));
    const targets = state.knownTargets || [];
    const selected = targets.find(t => (t.tokenId || t.key) === state.selectedTargetKey);
    const record = wb20TargetRecord(state);
    for (const target of targets) {
        const key = target.tokenId || target.key;
        const duplicates = targets.filter(t=>t.name === target.name).length > 1;
        const label = target.name + (duplicates ? ` (${targets.filter(t=>t.name === target.name).indexOf(target) + 1})` : "");
        select.append($("<option>").val(key).text(label));
    }
    if (!selected && state.selectedTargetKey && record.name)
        select.append($("<option>").val(state.selectedTargetKey).text(record.name + " (not in turn order)"));
    select.val(state.selectedTargetKey || "").on("change", () => wb20TargetChoose(select.val()));
    panel.append(heading, select);
    if (!state.selectedTargetKey) {
        panel.append($("<p>").addClass("wb20-target-empty").text(targets.length ? "Choose someone from the turn order." : "Targets appear here from Roll20's turn order."));
        return panel;
    }
    const summary = $("<div>").addClass("wb20-target-summary");
    summary.append($("<span>").text(`Initiative: ${selected?.initiative || record.initiative || "??"}`),
        $("<strong>").addClass("wb20-target-ac").text(`AC: ${wb20TargetAC(record.observations)}`));
    const damage = (record.damage || []).reduce((sum, entry)=>sum + entry.amount, 0);
    summary.append($("<span>").addClass("wb20-target-damage-total").text(`Damage: ${damage}`)
        .attr("title", "Recorded gross damage"));
    panel.append(summary);
    const attacks = $("<form>").addClass("wb20-target-attacks").on("submit", e=>e.preventDefault());
    const total = $("<input>").attr({type:"number", step:"1", placeholder:"Attack total", "aria-label":"Attack total"});
    const observe = hit => {
        const value = total.val().trim();
        if (!value || !Number.isInteger(Number(value))) { total[0].reportValidity(); total.trigger("focus"); return; }
        total.val(""); // Clear only the submitted draft, before the async refresh.
        wb20TargetEdit(r=>r.observations.push({total:Number(value), hit}));
    };
    attacks.append(total,
        $("<button>").attr("type", "button").text("Hit").on("click", ()=>observe(true)),
        $("<button>").attr("type", "button").text("Miss").on("click", ()=>observe(false)),
        $("<button>").attr({type:"button", title:"Undo last AC entry"}).text("Undo")
            .prop("disabled", !record.observations?.length).on("click", ()=>wb20TargetEdit(r=>r.observations.pop())));
    panel.append(attacks);
    const details = $("<details>").addClass("wb20-target-history");
    details.append($("<summary>").text("Damage & history"));
    const damageForm = $("<form>").on("submit", e=>e.preventDefault());
    const amount = $("<input>").attr({type:"number", min:"0", step:"0.01", placeholder:"Damage", "aria-label":"Damage amount"});
    const type = $("<select>").attr("aria-label", "Recorded damage type");
    ["Untyped", ...wb20QuickDamageTypes, "Divine"].forEach(t=>type.append($("<option>").text(t)));
    damageForm.append(amount, type, $("<button>").attr("type", "button").text("Add damage").on("click", ()=>{
        const value = amount.val().trim();
        if (!value || !Number.isFinite(Number(value)) || Number(value) < 0 || !amount[0].reportValidity()) return;
        amount.val("");
        wb20TargetEdit(r=>r.damage.push({amount:Number(value), type:type.val()}));
    }));
    details.append(damageForm);
    const byType = {};
    (record.damage || []).forEach(d=>byType[d.type] = (byType[d.type] || 0) + d.amount);
    const damageHistory = $("<div>").addClass("wb20-target-damage-history");
    Object.entries(byType).forEach(([type, amount])=>damageHistory.append($("<div>").text(`${type}: ${amount}`)));
    details.append(damageHistory);
    details.append($("<button>").attr("type", "button").text("Undo damage")
        .prop("disabled", !record.damage?.length).on("click", ()=>wb20TargetEdit(r=>r.damage.pop())));
    const history = $("<div>").addClass("wb20-target-ac-history");
    (record.observations || []).forEach(o=>history.append($("<div>").text(`${o.total}: ${o.hit ? "Hit" : "Miss"}`)));
    details.append(history);
    panel.append(details);
    return panel;
}

function wb20TargetDistance(state, target, diagnostic = {}) {
    const unavailable = reason => { diagnostic.reason = reason; return null; };
    const point = target?.position;
    const valid = p => p && p.pageId && [p.x, p.y, p.scale].every(Number.isFinite) && p.scale > 0;
    if (!valid(point)) return unavailable(target?.positionStatus || "Waiting for this token's Roll20 position");
    if (typeof character === "undefined") return unavailable("Character has not loaded");
    const primary = String(character?.getSetting?.("waybeyond20-roll20-token-id", "") || "");
    const bound = character?.getSetting?.("waybeyond20-roll20-token-ids", []) || [];
    const ids = new Set([primary, ...(Array.isArray(bound) ? bound.map(String) : [])].filter(Boolean));
    const candidates = state.knownTargets || [];
    let own = candidates.filter(t => ids.has(String(t.tokenId || t.key)));
    // Use a unique exact name only when no explicit binding was supplied.
    if (!own.length && !ids.size) {
        const name = String(character?._name || "").trim().toLowerCase();
        own = name ? candidates.filter(t => String(t.name).trim().toLowerCase() === name) : [];
    }
    if (!own.length) return unavailable(ids.size ? "Your linked token is not in this turn order" : "Your character's token is not identified in this turn order");
    if (own.length !== 1) return unavailable("More than one token matches your character");
    if (!valid(own[0].position)) return unavailable(`Your token: ${own[0].positionStatus || "waiting for Roll20 position"}`);
    if (own[0].position.pageId !== point.pageId) return unavailable("Your token is on a different map");
    if (own[0].position.scale !== point.scale || own[0].position.units !== point.units) return unavailable("Map distance scales do not match");
    const from = own[0].position;
    // Roll20 canvas coordinates use 70 pixels per base map unit. This is a
    // center-to-center straight-line estimate, not pathfinding or weapon reach.
    const distance = Math.hypot(point.x - from.x, point.y - from.y) / 70 * point.scale;
    return `${Number(distance.toFixed(1))} ${point.units || "units"}`;
}

function wb20CompassInfo(state, key) {
    const target = (state.knownTargets || []).find(t => String(t.tokenId || t.key) === key);
    if (!target) return "No combatant selected";
    const record = state.targetRecords?.[key] || {};
    const damage = (record.damage || []).reduce((sum, entry) => sum + entry.amount, 0);
    const lines = [target.name, `Initiative: ${target.initiative ?? "??"}`, `AC: ${wb20TargetAC(record.observations)}`,
        `Recorded damage: ${damage}`];
    const byType = {};
    (record.damage || []).forEach(d => byType[d.type] = (byType[d.type] || 0) + d.amount);
    if (Object.keys(byType).length) lines.push(Object.entries(byType).map(([type, amount]) => `${type}: ${amount}`).join(" · "));
    const diagnostic = {};
    const distance = wb20TargetDistance(state, target, diagnostic);
    lines.push(distance ? `Distance: ${distance} (straight line)` : `Distance: unavailable\n${diagnostic.reason}`);
    return lines.join("\n");
}

function wb20BuildTurnCompass(state, animate = false) {
    const current = state.currentRoll20Turn;
    const order = Array.isArray(state.knownTargets) ? state.knownTargets : [];
    const index = current ? order.findIndex(t => String(t.tokenId || t.key) === String(current.tokenId)) : -1;
    const currentName = current?.tokenName || current?.custom || (index >= 0 ? order[index].name : "") || "Manual turn";
    const compass = $("<div>").addClass("wb20-turn-compass").attr({role:"group", "aria-label":"Combat turn order"});
    const face = (position, label, name) => $(position === "current" ? "<div>" : "<button type='button'>")
        .addClass(`wb20-compass-face wb20-compass-${position}`)
        .append($("<span>").addClass("wb20-compass-caption").text(label),
            $("<span>").addClass("wb20-compass-name").text(name || "—").attr("title", name || ""));
    const arrow = direction => $("<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 44 28' aria-hidden='true' focusable='false'><path d='M3 8 Q19 25 34 11 L29 9 L42 3 L41 17 L37 14 Q20 33 3 8Z' fill='currentColor' stroke='currentColor' stroke-width='.8' stroke-linejoin='round'/></svg>")
        .addClass(`wb20-compass-arrow wb20-compass-arrow-${direction}`);
    const rim = () => $("<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 620 50' preserveAspectRatio='none' aria-hidden='true' focusable='false'><path d='M8 1 C8 48 40 49 310 49 C580 49 612 48 612 1' fill='none' stroke='currentColor' stroke-width='1.5'/></svg>")
        .addClass("wb20-compass-rim");
    // Browsing is local presentation only. Never rotate Roll20's order, save
    // combat state, change the selected target, or spend/reset resources.
    const render = (viewIndex, reveal) => {
        const browsing = viewIndex >= 0 && viewIndex !== index;
        const canBrowse = viewIndex >= 0 && order.length > 1;
        const before = canBrowse ? (viewIndex + order.length - 1) % order.length : -1;
        const after = canBrowse ? (viewIndex + 1) % order.length : -1;
        const left = face("previous", "Previous", order[before]?.name)
            .prop("disabled", !canBrowse).attr("aria-label", `Preview previous combatant: ${order[before]?.name || "none"}`)
            .on("click", () => render(before, true));
        const right = face("next", "Up next", order[after]?.name)
            .prop("disabled", !canBrowse).attr("aria-label", `Preview next combatant: ${order[after]?.name || "none"}`)
            .on("click", () => render(after, true));
        const key = String(order[viewIndex]?.tokenId || order[viewIndex]?.key || "");
        compass.attr("data-view-token", key);
        compass.closest(".waybeyond20-combat-section").find(".wb20-select-target").prop("disabled", !key);
        const center = face("current", browsing ? "Viewing" : "Current turn", browsing ? order[viewIndex].name : currentName);
        center.attr({tabindex:"0", "aria-describedby":"wb20-compass-info"}).find(".wb20-compass-name").removeAttr("title");
        if (browsing) center.find(".wb20-compass-caption").after($("<button>")
            .attr({type:"button", "aria-label":"Back to current turn", title:"Back to current turn"})
            .addClass("wb20-compass-reset").text("↩")
            .on("click", () => render(index, true)));
        const info = $("<div>").attr({id:"wb20-compass-info", role:"tooltip", hidden:true}).addClass("wb20-compass-info");
        const refreshInfo = () => info.text(wb20CompassInfo(wayBeyond20GetTurnTrackerState(), key));
        const showInfo = () => { refreshInfo(); info.prop("hidden", false); };
        center.on("mouseenter focusin", showInfo).on("click", event => {
            if (!$(event.target).closest("button").length) showInfo();
        });
        compass.off("mouseleave focusout keydown").on("mouseleave", () => info.prop("hidden", true))
            .on("focusout", event => { if (!compass[0].contains(event.relatedTarget)) info.prop("hidden", true); })
            .on("keydown", event => { if (event.key === "Escape") info.prop("hidden", true); });
        compass.data("refreshInfo", refreshInfo);
        compass.empty().toggleClass("wb20-compass-advancing", reveal)
            .append(rim(), left, arrow("left"), center, arrow("right"), right, info);
    };
    render(index, animate);
    return compass;
}

function wb20TargetMount(section, state) {
    let layout = section.parent(".wb20-combat-layout");
    if (!layout.length) {
        section.wrap($("<div>").addClass("wb20-combat-layout"));
        layout = section.parent();
    }
    const signature = JSON.stringify([state.selectedTargetKey,
        (state.knownTargets || []).map(t => [t.tokenId || t.key, t.name, t.initiative]), state.targetRecords]);
    // Position-only updates leave unfinished inputs, preview and scroll untouched.
    section.find(".wb20-turn-compass").data("refreshInfo")?.();
    if (section.attr("data-target-signature") !== signature || !section.children(".wb20-my-target").length) {
        const current = section.children(".wb20-my-target");
        if (current.data("pointerHeld")) {
            current.data("refreshPending", true);
            return;
        }
        section.attr("data-target-signature", signature);
        const old = section.children(".wb20-my-target");
        const fresh = wb20TargetBuildPanel(state);
        if (old.length && old.attr("data-target-key") === (state.selectedTargetKey || "")) {
            // Keep the native input/select nodes, caret, focus and disclosure.
            // Patch only saved data; a late save must not erase the next draft.
            const choice = old.children("select");
            const options = fresh.children("select");
            if (choice.html() !== options.html()) choice.empty().append(options.children()).val(state.selectedTargetKey || "");
            for (const selector of [".wb20-target-summary", ".wb20-target-damage-history", ".wb20-target-ac-history", ".wb20-target-empty"]) {
                old.find(selector).replaceWith(fresh.find(selector));
            }
            old.find(".wb20-target-attacks button[title]").prop("disabled", !wb20TargetRecord(state).observations?.length);
            old.find(".wb20-target-history > button").prop("disabled", !wb20TargetRecord(state).damage?.length);
        } else {
            // A different enemy starts with clean fields; never apply its
            // predecessor's unfinished attack/damage to the new selection.
            old.remove();
            section.append(fresh);
        }
    }
    // Inherit Combat's theme and frame. A theme-only refresh does not replace
    // the target controls or discard an unfinished entry.
}
