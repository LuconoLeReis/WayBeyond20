// Damage reminders use the existing effect store, prompt and resolved-roll pipeline.
// No class gates, second HP deduction, or guessed resistance from feature names.
const WAYBEYOND20_DAMAGE_TYPES = ["Acid", "Bludgeoning", "Cold", "Fire", "Force", "Lightning", "Necrotic", "Piercing", "Poison", "Psychic", "Radiant", "Slashing", "Thunder"];
const WAYBEYOND20_DAMAGE_HELP = "Leave Unmodified if this is the damage you actually sustained, including any resistance already applied. Choose a damage type if you entered the damage before resistance and want WayBeyond20 to apply it.";
let wayBeyond20ConcentrationQueue = Promise.resolve();
let wayBeyond20PendingHealthInput = null;

function wayBeyond20ConcentrationDC(damage) {
    return Math.min(30, Math.max(10, Math.floor(damage / 2)));
}

function wayBeyond20ReadDamageDefenses(root = document) {
    const defenses = { resistance: [], immunity: [], vulnerability: [] };
    root.querySelectorAll(".ct-defenses-summary__group,.ddbc-defenses-summary__group").forEach(group => {
        for (const kind of Object.keys(defenses)) {
            if (!group.querySelector(`.ddbc-${kind}-icon`)) continue;
            group.querySelectorAll(".ct-defenses-summary__defense,.ddbc-defenses-summary__defense").forEach(entry => {
                // Conditional defenses must not silently become unconditional ones.
                const type = WAYBEYOND20_DAMAGE_TYPES.find(type => type.toLowerCase() === entry.textContent.trim().toLowerCase());
                if (type && !defenses[kind].includes(type)) defenses[kind].push(type);
            });
        }
    });
    return defenses;
}

function wayBeyond20ConcentrationDamage(rows, defenses) {
    let total = 0;
    const effective = [];
    for (const row of rows) {
        const raw = Number(row.amount);
        if (String(row.amount).trim() === "" || !Number.isSafeInteger(raw) || raw < 0) return null;
        let amount = raw;
        const notes = [];
        if (row.type !== "Unmodified" && WAYBEYOND20_DAMAGE_TYPES.includes(row.type)) {
            if ((defenses.immunity || []).includes(row.type)) {
                amount = 0;
                notes.push("immune");
            } else {
                if ((defenses.resistance || []).includes(row.type)) {
                    amount = Math.floor(amount / 2);
                    notes.push("resisted");
                }
                if ((defenses.vulnerability || []).includes(row.type)) {
                    amount *= 2;
                    notes.push("vulnerable");
                }
            }
        }
        total += amount;
        effective.push({ amount, note: notes.join(", ") });
    }
    return { total, dc: wayBeyond20ConcentrationDC(total), effective };
}

function wayBeyond20ConcentrationRowHtml(amount, index) {
    return `<div class="waybeyond20-concentration-source">` +
        `<label>HP<input name="concentration-damage" aria-label="Damage source ${index}" type="number" min="0" step="1" value="${amount}"></label>` +
        `<label title="${WAYBEYOND20_DAMAGE_HELP}">Damage type<select name="concentration-type" aria-label="Damage type ${index}" title="${WAYBEYOND20_DAMAGE_HELP}">` +
        ["Unmodified", ...WAYBEYOND20_DAMAGE_TYPES].map(type => `<option>${type}</option>`).join("") +
        `</select></label><button type="button" data-remove-source aria-label="Remove damage source ${index}">×</button>` +
        '<small data-effective-damage></small></div>';
}

function wayBeyond20ConcentrationQueryHtml(effect, damage, defenses) {
    return `<form class="waybeyond20-concentration-query" data-defenses="${wayBeyond20EscapeHtml(JSON.stringify(defenses))}">` +
        `<p>You have taken damage while concentrating on <strong>${wayBeyond20EscapeHtml(effect.name)}</strong>. ` +
        `Is <strong>${damage}</strong> the total damage sustained?</p>` +
        `<div data-damage-sources>${wayBeyond20ConcentrationRowHtml(damage, 1)}</div>` +
        '<button type="button" data-add-source>Add source</button>' +
        '<p class="waybeyond20-concentration-total" aria-live="polite" data-concentration-total></p>' +
        '<small>These entries calculate the save only; they do not change your hit points. Use separate checks for separate hits. Conditional defenses are left to you.</small></form>';
}

function wayBeyond20WireConcentrationForm(form, okButton) {
    const defenses = JSON.parse(form.getAttribute("data-defenses") || "{}");
    const sources = form.querySelector("[data-damage-sources]");
    let nextIndex = 2;
    const refresh = () => {
        const elements = Array.from(sources.querySelectorAll(".waybeyond20-concentration-source"));
        const result = wayBeyond20ConcentrationDamage(elements.map(row => ({
            amount: row.querySelector("input").value, type: row.querySelector("select").value
        })), defenses);
        okButton.disabled = !result || result.total <= 0;
        okButton.setAttribute("aria-disabled", String(okButton.disabled));
        okButton.classList.toggle("waybeyond20-query-proceed-disabled", okButton.disabled);
        form.querySelector("[data-concentration-total]").textContent = !result ? "Enter whole, non-negative damage amounts." :
            result.total === 0 ? "Total: 0 HP — no concentration save needed." : `Total: ${result.total} HP · Constitution save DC ${result.dc}`;
        elements.forEach((row, index) => {
            const value = result && result.effective[index];
            row.querySelector("[data-effective-damage]").textContent = value ? `${value.amount} HP${value.note ? ` (${value.note})` : ""}` : "";
            row.querySelector("[data-remove-source]").disabled = elements.length === 1;
        });
    };
    form.addEventListener("input", refresh);
    form.addEventListener("change", refresh);
    form.addEventListener("click", event => {
        if (event.target.closest("[data-add-source]")) {
            event.preventDefault();
            sources.insertAdjacentHTML("beforeend", wayBeyond20ConcentrationRowHtml(0, nextIndex++));
            refresh();
        } else if (event.target.closest("[data-remove-source]") && sources.children.length > 1) {
            event.preventDefault();
            event.target.closest(".waybeyond20-concentration-source").remove();
            refresh();
        }
    });
    refresh();
}

function wayBeyond20QueueConcentrationCheck(damage, owner, effect) {
    const run = wayBeyond20ConcentrationQueue.then(async () => {
        // The existing prompt is shared with attack and spell choices. Never replace one.
        while (document.querySelector(".alertify:not(.ajs-hidden) .ajs-content form")) {
            await new Promise(resolve => setTimeout(resolve, 200));
            if (character !== owner) return;
        }
        if (character !== owner || !wayBeyond20CharacterHelperEnabled("waybeyond20-concentration-check-helper")) return;
        const current = wayBeyond20GetConcentrationEffect();
        if (!current || wayBeyond20EffectKey(current) !== wayBeyond20EffectKey(effect)) return;
        await wayBeyond20RunConcentrationCheck(damage, effect);
    });
    wayBeyond20ConcentrationQueue = run.catch(error => console.warn("WayBeyond20: concentration reminder failed", error));
    return run;
}

function wayBeyond20ArmConcentrationDamage(event) {
    if (typeof character === "undefined" || !character || !character._max_hp ||
        !wayBeyond20CharacterHelperEnabled("waybeyond20-concentration-check-helper")) return;
    const effect = wayBeyond20GetConcentrationEffect();
    if (!effect) return;
    const element = event.target;
    if (!element || !element.closest || element.closest(".alertify")) return;
    let amount = null;
    if (event.type === "click") {
        const button = element.closest("button,[role='button']");
        if (!button || button.textContent.trim().toLowerCase() !== "damage") return;
        let root = button.parentElement;
        let input = null;
        for (let depth = 0; root && depth < 5; depth++, root = root.parentElement) {
            input = root.querySelector("input[aria-label='Hit Points Adjustment'],.ct-health-manager__adjuster input");
            if (input) break;
        }
        amount = input ? Number(input.value) : null;
        if (amount !== null && (!Number.isSafeInteger(amount) || amount <= 0)) return;
    } else {
        if (!element.matches("input") || !element.closest(".b20-health-manage-pane,.ct-health-manager,.ct-quick-info__health,.ct-health-summary__hp-group")) return;
    }
    wayBeyond20PendingHealthInput = { owner: character, effect, amount, hp: character._hp, temp: character._temp_hp, max: character._max_hp, at: Date.now() };
}

function wayBeyond20ObserveConcentrationHP(owner, before, after) {
    const pending = wayBeyond20PendingHealthInput;
    if (!pending || pending.owner !== owner || Date.now() - pending.at > 3000 || pending.max !== after.max) return;
    const damage = Math.max(0, pending.hp - after.hp) + Math.max(0, pending.temp - after.temp);
    if (damage <= 0) return;
    clearTimeout(pending.timer);
    pending.timer = setTimeout(() => {
        if (wayBeyond20PendingHealthInput !== pending) return;
        wayBeyond20PendingHealthInput = null;
        const loss = Math.max(0, pending.hp - owner._hp) + Math.max(0, pending.temp - owner._temp_hp);
        if (loss > 0) wayBeyond20QueueConcentrationCheck(pending.amount === null ? loss : pending.amount, owner, pending.effect);
    }, 180);
}

document.addEventListener("click", wayBeyond20ArmConcentrationDamage, true);
document.addEventListener("change", wayBeyond20ArmConcentrationDamage, true);
