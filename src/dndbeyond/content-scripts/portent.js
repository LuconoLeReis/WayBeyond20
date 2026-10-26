// Portent is stored per character. It replaces a raw d20, never the modifier or
// damage dice. Reuse the shared prompt, settings, rest, turn and roll pipelines.
const WAYBEYOND20_PORTENT_KEY = "waybeyond20-portent";
const WAYBEYOND20_PORTENT_CATEGORIES = {
    attack: "Attack roll", save: "Saving throw", concentration: "Concentration check",
    death: "Death save", ability: "Ability / skill check", initiative: "Initiative"
};
const wayBeyond20PortentQueues = new Map();

function wayBeyond20HasPortent(owner) {
    return !!owner && !!owner._id && typeof owner.hasClassFeature === "function" && owner.hasClassFeature("Portent", true);
}

function wayBeyond20PortentState(owner) {
    const raw = owner.getSetting(WAYBEYOND20_PORTENT_KEY, {}) || {};
    const dice = Array.isArray(raw.dice) ? raw.dice.filter(die => die &&
        Number.isInteger(die.value) && die.value >= 1 && die.value <= 20 && typeof die.id === "string")
        .map(die => ({ id: die.id, value: die.value, used: die.used === true })) : [];
    return { dice, selected: raw.selected || null, lastTurn: raw.lastTurn || null };
}

function wayBeyond20SavePortent(owner, state) {
    return new Promise(resolve => owner.mergeCharacterSettings({ [WAYBEYOND20_PORTENT_KEY]: state }, () => {
        if (typeof wayBeyond20ScheduleActiveEffectBadgeRefresh === "function") wayBeyond20ScheduleActiveEffectBadgeRefresh();
        resolve();
    }));
}

async function wayBeyond20PortentLock(owner, operation) {
    const run = async () => {
        // Read the latest persisted pool inside the lock, including another tab's spend.
        if (typeof getStoredSettings === "function") {
            const saved = await new Promise(resolve => getStoredSettings(resolve, "character-" + owner._id, character_settings));
            owner.updateSettings(saved);
        }
        return operation();
    };
    const key = "waybeyond20-portent-" + owner._id;
    if (typeof navigator !== "undefined" && navigator.locks) return navigator.locks.request(key, run);
    const pending = (wayBeyond20PortentQueues.get(key) || Promise.resolve()).then(run);
    wayBeyond20PortentQueues.set(key, pending.catch(() => {}));
    return pending;
}

function wayBeyond20PortentD20() {
    // Rejection sampling avoids modulo bias. Do not roll through the game dispatcher.
    const bytes = new Uint32Array(1);
    do { crypto.getRandomValues(bytes); } while (bytes[0] >= 4294967280);
    return bytes[0] % 20 + 1;
}

async function wayBeyond20RefreshPortentForRest(owner, restType) {
    if (restType !== "long" || !wayBeyond20HasPortent(owner)) return;
    return wayBeyond20PortentLock(owner, async () => {
        const count = owner.hasClassFeature("Greater Portent", true) ? 3 : 2;
        const generation = crypto.randomUUID();
        const dice = Array.from({ length: count }, (_, index) => ({
            id: `${generation}-${index}`, value: wayBeyond20PortentD20(), used: false
        }));
        await wayBeyond20SavePortent(owner, { dice, selected: null, lastTurn: null });
    });
}

// Manual table adjudication shares the same pool and turn lock as self rolls.
// It records a use only; it does not roll dice or edit another creature's sheet.
async function wayBeyond20UsePortentOnOtherRoll(owner, dieId) {
    if (!wayBeyond20HasPortent(owner) || owner !== character) return false;
    const turn = wayBeyond20PortentTurnKey();
    return wayBeyond20PortentLock(owner, async () => {
        if (owner !== character || turn !== wayBeyond20PortentTurnKey()) return false;
        const state = wayBeyond20PortentState(owner);
        const die = state.dice.find(item => item.id === dieId && !item.used);
        if (!die) return false;
        if (turn && state.lastTurn === turn) {
            alertify.warning("Portent has already been used this turn. Start the next turn in the combat tracker before using another.");
            return false;
        }
        const confirmed = await dndbeyondDiceRoller._prompter.prompt("Use Portent on Another Creature",
            `<form class="wb20-feature-prompt"><p>Use Portent <strong>${die.value}</strong> to replace another creature's attack roll, saving throw, or ability check?</p>` +
            `<p>Confirm to mark this die spent. Apply ${die.value} as the d20 result at the table, keeping that creature's modifiers. This does not change their sheet or send another roll.</p></form>`,
            "Use Portent", "Cancel");
        if (!confirmed || owner !== character || turn !== wayBeyond20PortentTurnKey()) return false;
        // A rest/reroll or another writer may have replaced this pool while open.
        const current = wayBeyond20PortentState(owner);
        const currentDie = current.dice.find(item => item.id === dieId && !item.used);
        if (!currentDie || (turn && current.lastTurn === turn)) return false;
        currentDie.used = true;
        if (current.selected === dieId) current.selected = null;
        current.lastTurn = turn;
        await wayBeyond20SavePortent(owner, current);
        return true;
    });
}

async function wayBeyond20ForceRerollPortent(owner) {
    if (!wayBeyond20HasPortent(owner)) return false;
    const confirmed=await dndbeyondDiceRoller._prompter.prompt("Reroll Portent",
        '<form class="wb20-feature-prompt"><p>Replace all current Portent dice with fresh rolls? This clears spent dice and the selected die. It does not take a rest or restore any other resource.</p></form>',"Reroll Portent","Cancel");
    if (!confirmed || owner !== character) return false;
    await wayBeyond20RefreshPortentForRest(owner,"long");
    return true;
}

function wayBeyond20PortentCategory(req) {
    if (["attack", "spell-attack"].includes(req.type))
        return req.rollAttack !== false && req["to-hit"] !== undefined ? "attack" : null;
    if (req.type === "saving-throw") return req["waybeyond20-concentration-dc"] !== undefined ? "concentration" : "save";
    return ({ "death-save": "death", skill: "ability", ability: "ability", initiative: "initiative" })[req.type] || null;
}

function wayBeyond20PortentFlatModifier(req) {
    const base = req.type === "initiative" ? req.initiative :
        (["attack", "spell-attack"].includes(req.type) ? req["to-hit"] : req.modifier);
    const parseFlat = text => {
        text = String(text || "0").replace(/\u2212/g, "-").replace(/\s+/g, "");
        if (!/^[+-]?\d+(?:[+-]\d+)*$/.test(text)) return null;
        return (text.match(/[+-]?\d+/g) || []).reduce((sum, term) => sum + Number(term), 0);
    };
    const fixed = parseFlat(base);
    if (fixed === null) return null;
    // Only guaranteed flat adjustments qualify. Never predict Bless/Bane or other dice.
    const custom = String(req.character?.settings?.["custom-roll-dice"] || "").replace(/\s+/g, "");
    if (!custom) return fixed;
    const terms = custom.match(/[+-]?[^+-]+/g) || [];
    return fixed + terms.reduce((sum, term) => sum + (parseFlat(term) ?? 0), 0);
}

function wayBeyond20PortentCandidates(owner, req, state) {
    const category = wayBeyond20PortentCategory(req);
    const raw = String(owner.getSetting("portent-threshold-" + category, "")).trim();
    const modifier = wayBeyond20PortentFlatModifier(req);
    if (!/^-?\d+$/.test(raw) || modifier === null) return [];
    return state.dice.filter(die => !die.used && die.value + modifier >= Number(raw));
}

function wayBeyond20PortentTurnKey() {
    if (typeof wayBeyond20GetTurnTrackerState !== "function") return null;
    const state = wayBeyond20GetTurnTrackerState();
    if (!state.inCombat) return null;
    return `${state.combatStartedAt || "combat"}:${state.currentRoll20Turn?.turnKey || state.localTurnNumber || "unknown"}`;
}

function wayBeyond20PortentEscape(text) {
    return String(text).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

function wayBeyond20WirePortentPrompt(form, dialog, okButton) {
    okButton.style.display = "none";
    form.addEventListener("submit", event => event.preventDefault());
    form.addEventListener("click", event => {
        const button = event.target.closest("button[data-portent-choice]");
        if (!button || form.hasAttribute("data-selected")) return;
        event.preventDefault();
        form.setAttribute("data-selected", button.getAttribute("data-portent-choice"));
        form.querySelectorAll("button").forEach(item => item.disabled = true);
        dialog.get("resolver").call(dialog, $(form));
    });
}

async function wayBeyond20PortentDispatch(owner, req, dispatch) {
    if (!wayBeyond20HasPortent(owner) || !wayBeyond20PortentCategory(req)) return dispatch();
    return wayBeyond20PortentLock(owner, async () => {
        if (typeof character !== "undefined" && character !== owner) return false;
        const state = wayBeyond20PortentState(owner);
        const turn = wayBeyond20PortentTurnKey();
        let die = state.dice.find(item => item.id === state.selected && !item.used);
        if (turn && state.lastTurn === turn) {
            if (die) {
                alertify.warning("Portent has already been used this turn. Start the next turn in the combat tracker before using another.");
                return false;
            }
            return dispatch();
        }
        const manual = !!die;
        const candidates = manual ? [die] : (owner.getSetting("portent-prompts", false)
            ? wayBeyond20PortentCandidates(owner, req, state) : []);
        if (!candidates.length) return dispatch();
        const label = wayBeyond20PortentEscape(req.name || req.skill || WAYBEYOND20_PORTENT_CATEGORIES[wayBeyond20PortentCategory(req)]);
        if (!manual || !owner.getSetting("portent-auto-proceed", false)) {
            const modifier = wayBeyond20PortentFlatModifier(req);
            const question = manual ? `You are about to use your portent die (${die.value}) for ${label} instead of rolling it. Proceed?` :
                `Would you like to use a Portent die for ${label} instead of rolling?`;
            const choices = candidates.map(item => `<button type="button" data-portent-choice="${wayBeyond20PortentEscape(item.id)}">${manual ? "Yes" : `${item.value} (total ${item.value + modifier})`}</button>`).join(" ");
            const form = await dndbeyondDiceRoller._prompter.prompt("Portent Dice",
                `<form class="waybeyond20-portent-query"><p>${question}</p><p>${choices} <button type="button" data-portent-choice="no">No, roll normally</button></p>` +
                (manual ? '<label><input type="checkbox" name="auto-proceed"> Automatically proceed in the future without this warning.</label>' : '<p>Totals include known flat modifiers only, not bonus dice.</p>') +
                '<p>Close or Cancel stops this roll without spending a die.</p></form>', "Proceed", "Cancel");
            if (!form) return false;
            if (typeof character !== "undefined" && character !== owner) return false;
            const choice = form.attr("data-selected");
            if (choice === "no") {
                if (manual) { state.selected = null; await wayBeyond20SavePortent(owner, state); }
                return dispatch();
            }
            die = candidates.find(item => item.id === choice);
            if (!die) return false;
            if (manual && form.find('[name="auto-proceed"]').prop("checked")) {
                await new Promise(resolve => owner.mergeCharacterSettings({ "portent-auto-proceed": true }, resolve));
            }
        }
        req["waybeyond20-portent-value"] = die.value;
        if (wayBeyond20PortentTurnKey() !== turn) {
            alertify.warning("The turn changed while choosing Portent. Please try the roll again.");
            return false;
        }
        req.d20 = String(die.value);
        req.advantage = RollType.NORMAL;
        addEffect(req, `Portent ${die.value}`);
        const sent = await dispatch();
        if (sent === true) {
            die.used = true;
            state.selected = null;
            state.lastTurn = turn;
            await wayBeyond20SavePortent(owner, state);
        }
        return sent;
    });
}

async function wayBeyond20PortentSettings(owner) {
    const esc = wayBeyond20PortentEscape;
    const fields = Object.entries(WAYBEYOND20_PORTENT_CATEGORIES).map(([key, label]) =>
        `<label>${label} total threshold <input name="${key}" type="number" step="1" value="${esc(owner.getSetting("portent-threshold-" + key, ""))}"></label>`).join("");
    const form = await dndbeyondDiceRoller._prompter.prompt("Portent Settings",
        `<form class="waybeyond20-portent-settings"><label><input type="checkbox" name="prompts" ${owner.getSetting("portent-prompts", false) ? "checked" : ""}> Portent Prompts</label>` +
        '<p>Remind me only when an unused die plus this roll\'s known flat modifiers meets or beats its threshold. Leave a threshold blank to disable that category. Bonus dice are not predicted.</p>' + fields +
        `<label><input type="checkbox" name="auto" ${owner.getSetting("portent-auto-proceed", false) ? "checked" : ""}> Automatically proceed with a manually selected die without a warning</label></form>`, "Save", "Cancel");
    if (!form) return;
    const updates = { "portent-prompts": !!form.find('[name="prompts"]').prop("checked"), "portent-auto-proceed": !!form.find('[name="auto"]').prop("checked") };
    for (const key of Object.keys(WAYBEYOND20_PORTENT_CATEGORIES)) {
        const value = String(form.find(`[name="${key}"]`).val()).trim();
        if (value !== "" && !/^-?\d+$/.test(value)) { alertify.warning("Thresholds must be whole numbers or blank."); return; }
        updates["portent-threshold-" + key] = value;
    }
    owner.mergeCharacterSettings(updates, wayBeyond20ScheduleActiveEffectBadgeRefresh);
}

async function wayBeyond20InitializePortent(owner) {
    // Installation/reload is not a rest. Let existing characters enter today's dice once.
    const count = owner.hasClassFeature("Greater Portent", true) ? 3 : 2;
    const form = await dndbeyondDiceRoller._prompter.prompt("Today's Portent Dice",
        '<form><p>Enter the Portent dice you already rolled at your last Long Rest. This does not take a rest or reroll them.</p>' +
        Array.from({length: count}, (_, i) => `<p><label>Die ${i + 1} <input type="number" min="1" max="20" step="1" name="die-${i}"></label> <label><input type="checkbox" name="spent-${i}"> Already spent</label></p>`).join("") + '</form>', "Save dice", "Cancel");
    if (!form) return;
    const values = Array.from({length: count}, (_, i) => Number(form.find(`[name="die-${i}"]`).val()));
    if (values.some(value => !Number.isInteger(value) || value < 1 || value > 20)) { alertify.warning("Enter whole numbers from 1 to 20."); return; }
    await wayBeyond20PortentLock(owner, async () => {
        if (wayBeyond20PortentState(owner).dice.length) return;
        const generation = crypto.randomUUID();
        await wayBeyond20SavePortent(owner, { dice: values.map((value, i) => ({id: `${generation}-${i}`, value, used: !!form.find(`[name="spent-${i}"]`).prop("checked")})), selected: null, lastTurn: null });
    });
}

function wayBeyond20ApplySheetTheme(node) {
    if (!node) return;
    const native = document.querySelector('.ct-saving-throws-box,.ddbc-saving-throws-box') ||
        document.querySelector('.ct-ability-summary,.ddbc-ability-summary');
    if (!native) return;
    const style = getComputedStyle(native);
    const ink=native.querySelector(".ct-saving-throws-summary__ability-modifier,.ddbc-saving-throws-summary__ability-modifier,.ct-signed-number,.ddbc-signed-number");
    node.style.color = ink ? getComputedStyle(ink).color : style.color;
    node.style.backgroundColor = style.backgroundColor !== "rgba(0, 0, 0, 0)" ? style.backgroundColor : "var(--ttui-color-surface, Canvas)";
    node.style.borderColor = style.borderColor;
    node.style.borderRadius = style.borderRadius;
    node.style.boxShadow = "none";
    // Sheet themes use decorative SVG frames rather than CSS borders. Reuse
    // that displayed artwork as an inert background, never its IDs or handlers.
    const frame = native.querySelector('.ddbc-box-background svg');
    // DDB's frame starts with its surface silhouette, then decorative edges.
    // Native select menus need an opaque surface matching that artwork.
    const surface = frame?.querySelector('path[fill]:not([fill="none"]),rect[fill]:not([fill="none"])');
    node.style.setProperty('--wb20-sheet-surface', surface ? getComputedStyle(surface).fill : node.style.backgroundColor);
    const accent = frame && [...frame.querySelectorAll('[fill]')].find(part => {
        const fill = getComputedStyle(part).fill;
        return fill !== 'none' && fill !== 'transparent' && fill !== getComputedStyle(surface || native).fill;
    });
    node.style.setProperty('--wb20-sheet-accent', accent ? getComputedStyle(accent).fill : style.color);
    node.classList.toggle('waybeyond20-sheet-frame', !!frame);
    if (frame) {
        const copy = frame.cloneNode(true);
        copy.querySelectorAll('script,foreignObject,image,use,a,animate,set').forEach(item => item.remove());
        for (const element of [copy, ...copy.querySelectorAll('*')]) {
            for (const attribute of [...element.attributes]) {
                if (/^(id|class|on.*|.*href)$/i.test(attribute.name)) element.removeAttribute(attribute.name);
            }
        }
        copy.setAttribute('preserveAspectRatio', 'none');
        const background = `url("data:image/svg+xml,${encodeURIComponent(new XMLSerializer().serializeToString(copy))}")`;
        if (node.style.backgroundImage !== background) node.style.backgroundImage = background;
        node.style.backgroundSize = '100% 100%';
        node.style.backgroundRepeat = 'no-repeat';
        node.style.backgroundColor = 'transparent';
        node.style.borderColor = 'transparent';
    } else {
        node.style.backgroundImage = 'none';
    }
    const heading = document.querySelector('.ct-combat__statuses-group--defenses .ct-combat__summary-label,.ct-defenses-summary__heading,.ddbc-defenses-summary__heading');
    const headingStyle = heading ? getComputedStyle(heading) : null;
    if (headingStyle) {
        node.style.setProperty("--wb20-heading-font", headingStyle.fontFamily);
        node.style.setProperty("--wb20-heading-size", headingStyle.fontSize);
    }
    const number = document.querySelector('.ddbc-ability-summary__primary,.ct-ability-summary__primary');
    if (number) {
        node.style.setProperty("--wb20-number-font", getComputedStyle(number).fontFamily);
        node.style.setProperty("--wb20-number-size", getComputedStyle(number).fontSize);
    }
}

function wayBeyond20InjectPortent() {
    const owner = character;
    let panel = document.querySelector('.waybeyond20-portent');
    if (!wayBeyond20IsMainCharacterSheet() || !wayBeyond20HasPortent(owner)) {
        panel?.remove();
        document.querySelector('.waybeyond20-header-with-portent')?.classList.remove('waybeyond20-header-with-portent');
        return;
    }
    const heading = document.querySelector('.ddbc-character-tidbits__heading');
    if (!heading) return;
    // Never enlarge the name row. DDB centers that entire block inside a
    // fixed-height header, so putting a tall/wrapping panel there pushes the
    // name upward and the class/level down into the ability scores.
    const desktopGroup = heading.closest('.ct-character-header-desktop__group-tidbits');
    const anchor = desktopGroup || heading.closest('.ddbc-character-tidbits') || heading;
    desktopGroup?.parentElement.classList.add('waybeyond20-header-with-portent');
    if (!panel) {
        panel = document.createElement("section"); panel.className = "waybeyond20-portent";
        // The name region opens DDB's character sidebar. Our controls are
        // independent: neither setup/settings nor keyboard clicks should bubble.
        panel.addEventListener("click", event => event.stopPropagation());
        if (desktopGroup) anchor.after(panel);
        else anchor.append(panel);
    }
    wayBeyond20ApplySheetTheme(panel);
    const state = wayBeyond20PortentState(owner);
    const signature = JSON.stringify([owner._id, state]);
    if (panel.dataset.signature === signature) return;
    panel.dataset.signature = signature;
    panel.replaceChildren();
    const title = document.createElement("div"); title.className = "waybeyond20-portent-title"; title.textContent = "PORTENT DICE"; panel.append(title);
    const dice = document.createElement("div"); dice.className = "waybeyond20-portent-dice"; panel.append(dice);
    for (const die of state.dice) {
        const button = document.createElement("button"); button.type = "button"; button.textContent = String(die.value); button.disabled = die.used;
        button.setAttribute("aria-label", `Portent ${die.value}${die.used ? ", spent" : ""}`);
        button.setAttribute("aria-pressed", String(state.selected === die.id));
        button.title = die.used ? "Spent until your next Long Rest" : "Click to select for your next d20 test; right-click to use on another creature's roll";
        button.addEventListener("click", event => {
            event.stopPropagation();
            wayBeyond20PortentLock(owner, async () => {
                const current = wayBeyond20PortentState(owner);
                if (!current.dice.some(item => item.id === die.id && !item.used)) return;
                current.selected = current.selected === die.id ? null : die.id;
                await wayBeyond20SavePortent(owner, current);
            });
        });
        button.addEventListener("contextmenu", event => {
            event.preventDefault();
            event.stopPropagation();
            if (!die.used) wayBeyond20UsePortentOnOtherRoll(owner, die.id);
        });
        dice.append(button);
    }
    if (!state.dice.length) {
        const setup = document.createElement("button"); setup.type = "button"; setup.textContent = "Set today's dice";
        setup.addEventListener("click", () => wayBeyond20InitializePortent(owner)); dice.append(setup);
    }
    const settingsButton = document.createElement("button"); settingsButton.type = "button"; settingsButton.className = "waybeyond20-portent-settings-button"; settingsButton.textContent = "\u2699";
    settingsButton.setAttribute("aria-label", "Portent Settings"); settingsButton.title = "Portent Settings";
    settingsButton.addEventListener("click", () => wayBeyond20PortentSettings(owner)); panel.append(settingsButton);
    const reroll=document.createElement("button");reroll.type="button";reroll.textContent="Reroll";
    reroll.setAttribute("aria-label","Reroll Portent");reroll.title="Replace current Portent dice with fresh rolls";
    reroll.addEventListener("click",()=>wayBeyond20ForceRerollPortent(owner));panel.append(reroll);
    panel.title = "Portent: choose before rolling, once per turn. Dice refresh after a completed Long Rest. Right-click a die to record its use on another creature's roll.";
}
