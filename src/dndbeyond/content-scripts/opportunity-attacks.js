// A reaction grants one attack, not an Attack action. Keep the selected row,
// character, turn and grant request-local throughout native pane discovery.
let wayBeyond20OpportunityPending = false;

function wayBeyond20DefaultOpportunityEntry(entries) {
    let saved;
    try { saved = JSON.parse(character.getSetting("waybeyond20-opportunity-default", "")); }
    catch (_) { return null; }
    // Names describe the chosen entry, not rules. Ambiguous duplicates require
    // another explicit choice. Live numbers are never cached in the preference.
    const matches = entries.filter(entry => entry.name === saved?.name && entry.meta === saved?.meta);
    return matches.length === 1 ? matches[0] : null;
}

function wayBeyond20OpportunityEntries(root) {
    return Array.from(root.querySelectorAll(".ct-combat-attack,.ddbc-combat-attack"))
        .filter(row => !row.matches(".wb20-feature-option,.wb20-opportunity-attack,.waybeyond20-bardic-feature-row"))
        .map(row => {
            const label = row.querySelector(".ct-combat-attack__label,.ddbc-combat-attack__label");
            const meta = Array.from(row.querySelectorAll(".ct-combat-attack__meta-item,.ddbc-combat-attack__meta-item"))
                .map(el => el.textContent).join(" ");
            const hit = row.querySelector(".ct-combat-attack__tohit,.ddbc-combat-attack__tohit")?.textContent.trim() || "";
            const damage = row.querySelector(".ct-combat-attack__damage,.ddbc-combat-attack__damage")?.textContent.trim() || "";
            const rangeCell = row.querySelector(".ct-combat-attack__range,.ddbc-combat-attack__range");
            const range = (rangeCell?.innerText || rangeCell?.textContent || "").replace(/\s+/g, " ").trim();
            return {row, label, name: label?.textContent.trim() || "", meta, hit, damage, range};
        })
        // Spell attacks and saving-throw actions are not ordinary OA choices.
        // The full pane is validated again before any roll can be sent.
        .filter(entry => entry.label && /\bmelee\b/i.test(entry.meta) &&
            !/\bspell\b/i.test(entry.meta) && /^[+\-\u2212]?\s*\d+/.test(entry.hit));
}

function wayBeyond20AttackContextCurrent(context) {
    return !!context && context.activation.owner === character &&
        context.activation.turnKey === wayBeyond20AttackActivationTurnKey();
}

function wayBeyond20LiveFeatureRules() {
    return Array.from(document.querySelectorAll(".ct-feature-snippet,.ddbc-feature-snippet")).map(node => ({
        name: node.querySelector(".ct-feature-snippet__heading,.ddbc-feature-snippet__heading")?.textContent.trim() || "",
        text: node.textContent.replace(/\s+/g, " ").trim()
    })).filter(entry => entry.name);
}

// Interpret timing words from the character's actual rule, not from the attack
// producer's name. Missing/ambiguous text is a review requirement, not a ban.
function wayBeyond20AttackRiderTiming(text, context, ongoing = false) {
    if (!text) return {allowed: true, reason: "Full rule unavailable: verify timing and prerequisites."};
    const normalized = text.replace(/\s+/g, " ").toLowerCase();
    const clauses = normalized.split(/[.!?;]/).filter(clause =>
        /\b(?:attack|damage|hit|strike)\b/.test(clause) && /\b(?:deal|add|extra|bonus|advantage)\b/.test(clause));
    const restrictions = [];
    if (!context.attackAction && clauses.some(clause =>
        /\battack action\b/.test(clause) && /when|as part|during|using|take/.test(clause)))
        restrictions.push("Requires the Attack action.");
    if (context.isOwnTurn === false && clauses.some(clause =>
        /(?:on|during) (?:each of |any of )?your turns?\b|once (?:on each of|on) your turns?/.test(clause)))
        restrictions.push("Own-turn benefit; this attack is off-turn.");
    if (!ongoing && clauses.some(clause =>
        /(?:use|take|spend|as) (?:a |your |one )?reaction\b/.test(clause) ||
        context.isOwnTurn === false && /(?:use|take|spend|as) (?:a |your |one )?bonus action\b/.test(clause)))
        restrictions.push("Requires a separate Bonus Action or Reaction.");
    // Only a single, unqualified damage benefit can be automatically excluded.
    // Multiple benefits, alternatives and exceptions need the actual rule checked.
    const unambiguous = clauses.length === 1 && !/\b(?:or|unless|except|instead|also)\b/.test(normalized);
    if (restrictions.length) return {
        allowed: !unambiguous,
        reason: restrictions.join(" ") + (unambiguous ? " Omitted from this attack." : " Check which benefit applies.")
    };
    // Even free riders can require a particular ability, weapon, target or
    // remaining once-per-turn use. Present their live text for confirmation.
    return {allowed: true, reason: "Verify trigger, ability/weapon prerequisites and any once-per-turn limit."};
}

function wayBeyond20AttackRiderAllowed(context, name, ongoing = false) {
    if (!context) return true;
    // Do not merge legacy and revised rules merely because the names are similar.
    const normalize = text => String(text).toLowerCase().replace(/['’]/g, "").trim();
    const matches = context.rules.filter(entry => normalize(entry.name) === normalize(name) ||
        normalize(entry.name).endsWith(": " + normalize(name)));
    const text = matches.length === 1 ? matches[0].text : "";
    const timing = wayBeyond20AttackRiderTiming(text, context, ongoing);
    context.review.set(name, {text, ongoing, ...timing});
    return timing.allowed;
}

async function wayBeyond20ConfirmAttackContext(context, rollProperties) {
    if (!context) return true;
    if (!wayBeyond20AttackContextCurrent(context)) return false;
    if (context.review.size) {
        const escape = wayBeyond20EscapeFollowupText;
        const html = "<form><p>These enabled modifiers need a rules check for this Reaction attack. " +
            "Confirm that each is legal now, including its trigger and any once-per-turn limit. " +
            "An Attack-action benefit does not apply. A new Bonus Action cannot be used off-turn, " +
            "and this attack already uses your Reaction. Previously active effects may still apply.</p>" +
            Array.from(context.review, ([name, rule]) =>
                `<p><strong>${escape(name)}</strong>${rule.ongoing ? " (already active)" : ""}<br>` +
                `${escape(rule.reason)}<br>` +
                `${escape(rule.text || "Full rule text is not currently available on this sheet.")}</p>`).join("") +
            "<p>Cancel to adjust the enabled modifiers before attacking. No resource has been spent.</p></form>";
        if (!await dndbeyondDiceRoller._prompter.prompt("Reaction attack: check modifiers", html, "Confirm remaining modifiers", "Cancel"))
            return false;
    }
    if (!wayBeyond20AttackContextCurrent(context)) return false;
    rollProperties["waybeyond20-attack-activation"] = context.activation;
    rollProperties["waybeyond20-attack-context"] = {
        kind: context.kind, isOwnTurn: context.isOwnTurn, attackAction: false,
        turnKey: context.activation.turnKey
    };
    return true;
}

function wayBeyond20ReactiveSpellRule(rules) {
    // A rule capability, not a feat-name lookup. Preserve its full trigger for
    // the player: e.g. leaving reach is narrower than all possible OA triggers.
    return rules.find(rule => /opportunity attack/i.test(rule.text) &&
        /cast (?:a |the )?spell/i.test(rule.text) && /instead/i.test(rule.text) &&
        /(?:one|1) action/i.test(rule.text) && /target only (?:that|the) creature/i.test(rule.text));
}

async function wayBeyond20ChooseReactiveSpell(context) {
    await new Promise(resolve => setTimeout(resolve, 0));
    const previousTab = wayBeyond20ActiveCharacterSheetTab();
    const spellsTab = wayBeyond20CharacterSheetTab("Spells");
    if (!spellsTab || !wayBeyond20AttackContextCurrent(context)) return false;
    try {
        spellsTab.click();
        let entries = [];
        for (let attempt = 0; attempt < 25 && wayBeyond20AttackContextCurrent(context); attempt++) {
            entries = Array.from(document.querySelectorAll(".ct-spells-spell,.ddbc-spells-spell"))
                .map(row => {
                    const identity = wayBeyond20NativeSpellIdentity(row);
                    const button = Array.from(row.querySelectorAll(".ct-spells-spell__action button,.ddbc-spells-spell__action button"))
                        .find(button => /^(cast|use)$/i.test(button.textContent.trim()) && !button.disabled);
                    return {row, identity, button};
                }).filter(entry => entry.identity && entry.button);
            if (entries.length) break;
            await new Promise(resolve => setTimeout(resolve, 75));
        }
        if (!entries.length) {
            alertify.warning("No available Cast/Use spell controls were found. Nothing was spent.");
            return false;
        }
        const escape = wayBeyond20EscapeFollowupText;
        const response = await dndbeyondDiceRoller._prompter.prompt("Reactive spell", "<form><p>" +
            escape(context.spellRule.text) + "</p><p>Choose a spell and casting level. Its full casting time " +
            "will be checked before casting. Only the provoking creature may be targeted.</p>" +
            '<select name="spell">' + entries.map((entry, index) =>
                `<option value="${index}">${escape(entry.identity.name)} | ${escape(entry.identity.source)} | ` +
                `${escape(entry.row.closest(".ct-content-group,.ddbc-content-group")?.querySelector(".ct-content-group__header,.ddbc-content-group__header")?.textContent || "")}</option>`
            ).join("") + '</select></form>', "Choose spell", "Cancel");
        if (!response || !wayBeyond20AttackContextCurrent(context)) return false;
        const value = response.find('[name="spell"]').val();
        const entry = /^\d+$/.test(String(value)) ? entries[Number(value)] : null;
        if (!entry || !entry.row.isConnected) return false;
        context.kind = "reactive-spell";
        context.activation.kind = "spell";
        await new Promise(resolve => setTimeout(resolve, 0));
        if (!wayBeyond20AttackContextCurrent(context) || !entry.row.isConnected) return false;
        resetHijackQuickRollState();
        entry.identity.label.click();
        for (let attempt = 0; attempt < 25 && wayBeyond20AttackContextCurrent(context); attempt++) {
            if (wayBeyond20NativeSpellPaneMatches(entry.identity)) {
                return await execute("ct-spell-pane", {
                    attack_context: context,
                    force_roll_mode: context.mode,
                    nativeCast: wayBeyond20CommitNativeSpellCast(character, entry.identity, entry.button.textContent.trim().toLowerCase())
                });
            }
            await new Promise(resolve => setTimeout(resolve, 75));
        }
        alertify.warning("The selected spell pane did not finish opening. Nothing was spent.");
        return false;
    } finally {
        if (context.activation.owner === character) wayBeyond20RestoreCharacterSheetTab(previousTab);
    }
}

async function wayBeyond20ConfirmReactiveSpell(context, properties, name, description) {
    if (!context) return true;
    if (context.kind !== "reactive-spell" || !wayBeyond20AttackContextCurrent(context)) return false;
    if (!/^(?:1|one)\s+action$/i.test((properties["Casting Time"] || "").trim())) {
        alertify.warning("This replacement requires a spell with a casting time of one Action. Nothing was spent.");
        return false;
    }
    const escape = wayBeyond20EscapeFollowupText;
    const result = await dndbeyondDiceRoller._prompter.prompt("Confirm reactive spell", "<form><p><strong>" +
        escape(name) + "</strong></p><p>" + escape(description) + "</p><p>Confirm that the actual feat trigger occurred " +
        "and this casting targets only the provoking creature, within the spell's range and restrictions. " +
        "If the spell creates several attacks or missiles, every target must be that same creature. " +
        "Do not select additional targets in any following effect dialog. Check applicable spell-slot-per-turn limits. " +
        "This casting spends one Reaction, not an Action.</p></form>", "Cast at that creature", "Cancel");
    return !!result && wayBeyond20AttackContextCurrent(context);
}

async function wayBeyond20OpenGrantedAttack(entry, context, mode) {
    // A prompt resolves during its confirmation click. Let that click finish
    // bubbling through DDB's outside-click handler before opening a sidebar.
    await new Promise(resolve => setTimeout(resolve, 0));
    if (!entry.row.isConnected || !wayBeyond20AttackContextCurrent(context)) return false;
    resetHijackQuickRollState();
    entry.label.click(); // Open details, never click the attack/roll button here.
    await new Promise(resolve => setTimeout(resolve, 75));
    for (let attempt = 0; attempt < 30; attempt++) {
        // Opening a native sidebar can replace the list row. Its DOM lifetime
        // does not own the pending attack: character/turn plus the matching
        // pane name, melee properties and attack bonus validate the handoff.
        if (!wayBeyond20AttackContextCurrent(context)) return false;
        for (const paneClass of ["b20-item-pane", "b20-action-pane", "ct-custom-action-pane", "b20-custom-action-pane"]) {
            const pane = document.querySelector("." + paneClass);
            if (!pane || pane.querySelector(".ct-sidebar__heading")?.textContent.trim() !== entry.name) continue;
            const properties = propertyListToDict($(pane).find("[role=list] > div"));
            if (!properties["Damage"] || !properties["To Hit"]) continue;
            // Native natural-attack panes omit Attack Type and express melee as
            // Range/Area: 5 ft. Reach. Do not infer it from the feature's name.
            const melee = properties["Attack Type"]
                ? /^(?:melee|unarmed strike)$/i.test(properties["Attack Type"].trim())
                : /\breach\b/i.test(properties["Range/Area"] || properties["Reach"] || "");
            if (!melee || String(properties["To Hit"]).replace(/\s/g, "") !== entry.hit.replace(/\s/g, "")) {
                alertify.warning("This entry is not a melee weapon attack or Unarmed Strike. Nothing was spent.");
                return false;
            }
            return await execute(paneClass, {force_roll_mode: mode, attack_context: context});
        }
        await new Promise(resolve => setTimeout(resolve, 75));
    }
    alertify.warning("The selected attack details did not finish opening. No Reaction was spent.");
    return false;
}

async function wayBeyond20ChooseOpportunityAttack(root, {useDefault = false, mode: shortcutMode = null} = {}) {
    if (wayBeyond20OpportunityPending) return false;
    const owner = character;
    wayBeyond20OpportunityPending = true;
    try {
        const entries = wayBeyond20OpportunityEntries(root);
        const rules = wayBeyond20LiveFeatureRules();
        const spellRule = wayBeyond20ReactiveSpellRule(rules);
        if (!entries.length && !spellRule) {
            alertify.warning("No melee weapon or Unarmed Strike is visible. Show the Actions list and try again.");
            return false;
        }
        const activation = wayBeyond20CreateAttackActivation({resource: "reaction", attacks: 1});
        const state = wayBeyond20GetTurnTrackerState();
        const knownOwnTurn = state.combatSource === "Roll20" ? state.currentRoll20Turn?.isThisCharactersTurn : undefined;
        const escape = wayBeyond20EscapeFollowupText;
        const savedEntry = wayBeyond20DefaultOpportunityEntry(entries);
        if (useDefault && savedEntry) {
            let ownTurn = knownOwnTurn;
            // A manual tracker does not know whose turn it is. Ask rather than
            // silently treating all reactions as off-turn (they can be either).
            if (typeof ownTurn !== "boolean") {
                const response = await dndbeyondDiceRoller._prompter.prompt("Opportunity Attack: whose turn?",
                    '<form class="wb20-opportunity-prompt"><p class="wb20-opportunity-summary"><strong>' +
                    escape(savedEntry.name) + '</strong><br>1 Reaction · 1 attack</p>' +
                    '<label class="wb20-opportunity-field">Whose turn?<select name="ownTurn" aria-label="Whose turn?"><option value="no">Another creature</option>' +
                    '<option value="yes">Mine</option></select></label></form>', "Make attack", "Cancel");
                if (!response || owner !== character) return false;
                ownTurn = response.find('[name="ownTurn"]').val() === "yes";
            }
            const context = {kind: "opportunity", activation, attackAction: false, mode: shortcutMode,
                isOwnTurn: ownTurn, rules, spellRule, review: new Map()};
            return await wayBeyond20OpenGrantedAttack(savedEntry, context, shortcutMode);
        }
        const html = '<form class="wb20-opportunity-prompt">' +
            '<p class="wb20-opportunity-summary"><strong>1 Reaction · 1 attack</strong></p>' +
            '<label class="wb20-opportunity-field">Attack<select name="attack" aria-label="Attack">' + entries.map((entry, index) =>
                `<option value="${index}"${entry === savedEntry ? " selected" : ""}>${escape(entry.name)} | ${escape(entry.hit)} | ${escape(entry.damage)}${entry.range ? " | " + escape(entry.range) : ""}</option>`).join("") +
            (spellRule ? `<option value="spell">Cast a spell instead (${escape(spellRule.name)})</option>` : "") +
            '</select></label><label class="wb20-opportunity-field">Roll with<select name="mode" aria-label="Roll with">' +
            `<option value="${RollType.NORMAL}">Flat (one die)</option>` +
            `<option value="${RollType.ADVANTAGE}">Advantage</option>` +
            `<option value="${RollType.DISADVANTAGE}">Disadvantage</option></select></label>` +
            (typeof knownOwnTurn === "boolean" ? `<p class="wb20-opportunity-note">${knownOwnTurn ? "Your turn" : "Another combatant's turn"} (Roll20).</p>` :
                '<label class="wb20-opportunity-field">Whose turn?<select name="ownTurn" aria-label="Whose turn?"><option value="no">Another creature</option><option value="yes">Mine</option></select></label>') +
            '<p class="wb20-opportunity-note">Your last successful melee choice becomes the default. Cancel spends nothing.</p>' +
            '<details class="wb20-opportunity-rules"><summary>Trigger and rules reminder</summary><ul>' +
            '<li>Use only when an Opportunity Attack is provoked. The usual trigger is a creature you can see leaving your reach; attack before it leaves.</li>' +
            '<li>Make one melee weapon attack or Unarmed Strike within reach. This is not the Attack action and does not grant Extra Attack.</li>' +
            '<li>Disengage, teleportation, and movement that uses none of the creature’s movement, Action, Bonus Action, or Reaction normally do not provoke.</li>' +
            '<li>Apply any exceptions in your actual features.</li></ul></details></form>';
        const response = await dndbeyondDiceRoller._prompter.prompt("Opportunity Attack", html, "Make attack", "Cancel");
        if (!response || owner !== character) return false;
        const value = response.find('[name="attack"]').val();
        const entry = /^\d+$/.test(String(value)) ? entries[Number(value)] : null;
        const mode = Number(response.find('[name="mode"]').val());
        if ((!entry && !(value === "spell" && spellRule)) ||
            ![RollType.NORMAL, RollType.ADVANTAGE, RollType.DISADVANTAGE].includes(mode)) return false;
        const context = {kind: "opportunity", activation, attackAction: false, mode,
            isOwnTurn: typeof knownOwnTurn === "boolean" ? knownOwnTurn : response.find('[name="ownTurn"]').val() === "yes",
            rules, spellRule, review: new Map()};
        if (value === "spell") return await wayBeyond20ChooseReactiveSpell(context);
        const result = await wayBeyond20OpenGrantedAttack(entry, context, mode);
        if (result === true && owner === character) {
            owner.mergeCharacterSettings({"waybeyond20-opportunity-default": JSON.stringify({name: entry.name, meta: entry.meta})},
                () => { if (owner === character && typeof wayBeyond20RefreshCombinedActions === "function") wayBeyond20RefreshCombinedActions(); });
        }
        return result;
    } finally {
        wayBeyond20OpportunityPending = false;
    }
}

function wayBeyond20OpportunityRow(root) {
    let row = root.querySelector(":scope > .wb20-opportunity-attack");
    if (!row) {
        row = document.createElement("div");
        row.className = "ddbc-combat-attack wb20-opportunity-attack";
        const template = root.querySelector(".ddbc-combat-attack:not(.wb20-feature-option)");
        for (const cls of template?.classList || [])
            if (cls.startsWith("styles_attack__")) row.classList.add(cls);
        const icon = document.createElement("button");
        icon.type = "button"; icon.className = "wb20-feature-option-icon"; icon.textContent = "↶";
        icon.setAttribute("aria-label", "Opportunity Attack: choose a melee attack");
        const name = document.createElement("div"); name.className = "ddbc-combat-attack__name";
        const label = document.createElement("button"); label.type = "button";
        label.className = "wb20-feature-option-name"; label.textContent = "Opportunity Attack";
        const category = document.createElement("div"); category.className = "wb20-talent-category";
        category.textContent = "Melee Attack";
        name.append(label, category); row.append(icon, name);
        for (const [field, text] of [["range", "Reach"], ["action", "Weapon"], ["damage", "Weapon"], ["notes", ""]]) {
            const cell = document.createElement("div");
            cell.className = `ddbc-combat-attack__${field}`; cell.textContent = text; row.append(cell);
        }
        const choose = document.createElement("button"); choose.type = "button";
        choose.className = "wb20-hit-die-choice wb20-opportunity-choose"; choose.textContent = "Choose different Attack";
        row.lastElementChild.append(choose);
        for (const button of [icon, label, choose]) button.addEventListener("click", event => {
            event.preventDefault(); event.stopPropagation();
            if (row._wb20Owner !== character || !row.isConnected) return;
            wayBeyond20ChooseOpportunityAttack(root, {useDefault: button !== choose}).catch(error => {
                console.warn("WayBeyond20: Opportunity Attack failed", error);
                alertify.warning("The attack did not finish. Check the roll and counters before retrying.");
            });
        });
        for (const button of [icon, label]) button.addEventListener("contextmenu", event => {
            event.preventDefault(); event.stopPropagation();
            if (row._wb20Owner !== character || !row.isConnected) return;
            wayBeyond20ShowAttackMenu(button, mode =>
                wayBeyond20ChooseOpportunityAttack(root, {useDefault: true, mode}).catch(error => {
                    console.warn("WayBeyond20: Opportunity Attack failed", error);
                    alertify.warning("The attack did not finish. Check the roll and counters before retrying.");
                }),
                () => row._wb20Owner === character && row.isConnected);
        });
        root.append(row);
    }
    row._wb20Owner = character;
    const selected = wayBeyond20DefaultOpportunityEntry(wayBeyond20OpportunityEntries(root));
    const setText = (selector, text) => {
        const cell = row.querySelector(selector);
        if (cell.textContent !== text) cell.textContent = text;
    };
    setText(".wb20-talent-category", selected?.name || "Choose an attack");
    setText(".ddbc-combat-attack__range", selected?.range || "—");
    setText(".ddbc-combat-attack__action", selected?.hit || "—");
    const damage = row.querySelector(".ddbc-combat-attack__damage");
    let value = damage.querySelector(".ddbc-damage__value");
    if (!value) { value = document.createElement("span"); value.className = "ddbc-damage__value"; damage.replaceChildren(value); }
    if (value.textContent !== (selected?.damage || "—")) value.textContent = selected?.damage || "—";
    const icon = row.querySelector(".wb20-feature-option-icon");
    const title = selected ? `Opportunity Attack: ${selected.name}. Uses one Reaction. Right-click for roll mode.` : "Opportunity Attack: choose a melee attack";
    if (icon.getAttribute("aria-label") !== title) { icon.setAttribute("aria-label", title); icon.title = title; }
    return {row, name: "Opportunity Attack", cost: "reaction", group: "reaction"};
}
