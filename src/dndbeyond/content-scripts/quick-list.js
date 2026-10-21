// Shared presentation, never a second spell executor or a named-spell rules DB.
// Native rows supply availability, casting time, source, level and effect tags.
const wb20QuickSessions = new WeakMap();
const wb20QuickCategories = ["Attack", "Healing", "Smite", "Resurrect", "Protection",
    "Buff", "Debuff", "Control", "Movement", "Detection", "Communication", "Creation", "Utility", "Other"];

function wb20QuickSettings(owner = character) {
    try {
        const value = JSON.parse(owner.getSetting("waybeyond20-quick-list", "{}"));
        return value && typeof value === "object" && !Array.isArray(value) ? value : {};
    } catch (_) { return {}; }
}

function wb20QuickSave(patch, owner = character) {
    if (owner !== character) return;
    owner.mergeCharacterSettings({"waybeyond20-quick-list": JSON.stringify({...wb20QuickSettings(owner), ...patch})},
        () => { if (owner === character) wayBeyond20RefreshCombinedActions(); });
}

function wb20QuickSession() {
    if (!wb20QuickSessions.has(character))
        wb20QuickSessions.set(character, {spells: [], scanned: false, pending: false, managing: false});
    return wb20QuickSessions.get(character);
}

function wb20QuickTiming(text) {
    const value = String(text || "").trim().toLowerCase().replace(/\s+/g, " ");
    if (/^(1|one)\s*(ba|bonus action)\b/.test(value)) return {cost: "bonusAction", time: "1 Bonus Action"};
    if (/^(1|one)\s*(r|reaction)\b/.test(value)) return {cost: "reaction", time: "1 Reaction"};
    if (/^(1|one)\s*(a|action)\b/.test(value)) return {cost: "action", time: "1 Action"};
    // Longer/unknown casting is NOT a free action. Separate neutral cost/type.
    return {cost: "extended", time: String(text || "Casting time unavailable").trim()};
}

function wb20QuickClassify(spell) {
    const text = `${spell.effect} ${spell.description || ""}`.toLowerCase();
    const categories = new Set();
    if (/\b(?:revival|resurrection|resurrect|return.{0,30}to life|restore.{0,30}to life)\b/.test(text)) categories.add("Resurrect");
    if (/\b(?:healing|regain.{0,35}hit points|restore.{0,35}hit points)\b/.test(text)) categories.add("Healing");
    // A title vocabulary is only a display hint. It grants no trigger/cost rule.
    if (/\bsmite\b/i.test(spell.name)) categories.add("Smite");
    if (spell.attack || spell.damage || /\bdamage\b/.test(text)) categories.add("Attack");
    for (const [pattern, category] of [
        [/\b(?:warding|protection|defense|defensive)\b/, "Protection"],
        [/\bbuff\b/, "Buff"], [/\bdebuff\b/, "Debuff"], [/\bcontrol\b/, "Control"],
        [/\b(?:movement|teleportation)\b/, "Movement"], [/\b(?:detection|foreknowledge)\b/, "Detection"],
        [/\bcommunication\b/, "Communication"], [/\bcreation\b/, "Creation"], [/\butility\b/, "Utility"]
    ]) if (pattern.test(text)) categories.add(category);
    if (categories.has("Smite")) categories.delete("Attack");
    return categories.size ? Array.from(categories) : ["Other"];
}

function wb20QuickReadSpells() {
    const text = (row, field) => {
        const el = row.querySelector(`.ct-spells-spell__${field},.ddbc-spells-spell__${field}`);
        return (el?.innerText || el?.textContent || "").replace(/\s+/g, " ").trim();
    };
    const result = [];
    for (const row of document.querySelectorAll(".ct-spells-spell,.ddbc-spells-spell")) {
        const identity = wayBeyond20NativeSpellIdentity(row);
        if (!identity) continue;
        const action = text(row, "action");
        const button = row.querySelector(".ct-spells-spell__action button,.ddbc-spells-spell__action button");
        // Available sheet entries, not the Manage Spells catalogue. Empty slots
        // do not remove a prepared spell, and class identity is never a gate.
        if (!/(?:cast|use)\s*$/i.test(action) && !/at will/i.test(action)) continue;
        const timing = row.querySelector(".ct-spells-spell__activation [data-original-title],.ddbc-spells-spell__activation [data-original-title]");
        const hit = text(row, "attacking"), effect = text(row, "damage");
        const damageNode = row.querySelector(".ddbc-damage__value,.ct-damage__value,.ddbc-spell-damage-effect__damage");
        const healing = !!row.querySelector('[aria-label*="healing" i],[data-original-title*="healing" i]') || /\bhealing\b/i.test(row.innerText);
        const spell = {
            name: identity.name, source: identity.source, level: identity.level,
            key: JSON.stringify([identity.name, identity.source, identity.level]),
            ...wb20QuickTiming(timing?.getAttribute("data-original-title") || text(row, "activation")),
            range: text(row, "range") || "—", hit: hit || "—",
            effect: healing ? `${effect} Healing` : effect || "Effect",
            damage: !healing && damageNode ? damageNode.textContent.trim() : "",
            attack: /^[+−-]?\s*\d/.test(hit), notes: text(row, "notes"),
            action, row
        };
        result.push(spell);
    }
    return result;
}

function wb20QuickObserveSpells() {
    if (!character) return;
    const session = wb20QuickSession(), live = wb20QuickReadSpells();
    wb20QuickRememberOpenDescription();
    if (!live.length) return;
    // Do not persist DOM nodes or trust last-session metadata to cast.
    session.spells = live.map(({row, ...spell}) => spell);
    session.scanned = true;
}

function wb20QuickRememberOpenDescription() {
    // Read only native, identity-checked rules. Do not invent a description
    // from effect tags or borrow text from a same-named different source.
    const pane = document.querySelector(".ct-spell-pane");
    if (!pane) return;
    const spell = wb20QuickSession().spells.find(spell => wayBeyond20NativeSpellPaneMatches(spell));
    if (!spell) return;
    const description = pane?.querySelector(".ct-spell-detail__description,div[class*='styles_description']")?.textContent.trim();
    if (!description || wb20QuickSettings().descriptions?.[spell.key] === description) return;
    wb20QuickSave({descriptions: {...wb20QuickSettings().descriptions, [spell.key]: description}});
}

function wb20QuickDescriptionText(spell) {
    const description = wb20QuickSettings().descriptions?.[spell.key];
    return description ? `${spell.name}\n\n${description}` :
        `${spell.name}\n\n${wb20QuickSession().descriptionAttempts?.has(spell.key) && !wb20QuickSession().loadingDescription
            ? "Description unavailable from the current sheet. Opening its native details can refresh it."
            : "Description will load automatically when the sheet is free. No spell will be cast."}`;
}

function wb20QuickCanLoadDescriptions() {
    const session = wb20QuickSession();
    return !session.pending && !session.managing && !wayBeyond20NativeCastPending &&
        !document.querySelector(".ct-spell-pane,.alertify:not(.ajs-hidden)") &&
        !$(".ct-sidebar__header:visible").length &&
        wayBeyond20ActiveCharacterSheetTab()?.textContent.trim().toLowerCase() === "actions";
}

function wb20QuickMissingDescriptions() {
    const settings = wb20QuickSettings(), session = wb20QuickSession();
    return [...new Set(wb20QuickGroups().filter(group => !wb20QuickIsHidden(group, settings))
        .flatMap(group => group.spells.filter(spell => spell.key === settings.selected?.[group.key])
            .map(spell => spell.key)))].filter(key => !settings.descriptions?.[key] &&
                !session.descriptionAttempts?.has(key));
}

function wb20QuickScheduleDescriptions() {
    const owner = character, session = wb20QuickSession();
    if (!session.scanned || session.descriptionTimer || !wb20QuickMissingDescriptions().length ||
        !wb20QuickCanLoadDescriptions()) return;
    // One bounded batch, not a recurring poll or one tab round-trip per spell.
    session.descriptionTimer = setTimeout(async () => {
        session.descriptionTimer = null;
        if (owner !== character || !wb20QuickCanLoadDescriptions()) return;
        const keys = wb20QuickMissingDescriptions();
        if (keys.length) await wb20QuickLoadDescription(keys);
    }, 350);
}

async function wb20QuickLoadDescription(key) {
    const owner = character, session = wb20QuickSession();
    const keys = [...new Set(Array.isArray(key) ? key : [key])]
        .filter(key => !wb20QuickSettings().descriptions?.[key]);
    // Remembered selections share one visit; hovering never moves the sheet.
    // Leave an already-open sidebar/dialog or an in-progress cast alone.
    if (!keys.length || !wb20QuickCanLoadDescriptions()) return;
    session.descriptionAttempts ||= new Set();
    keys.forEach(key => session.descriptionAttempts.add(key));
    session.pending = true;
    session.loadingDescription = true;
    wayBeyond20RefreshCombinedActions();
    try {
        await wb20QuickVisitSpells(async rows => {
          for (const key of keys) {
            if (owner !== character || document.querySelector(".alertify:not(.ajs-hidden)") ||
                wayBeyond20ActiveCharacterSheetTab()?.textContent.trim().toLowerCase() !== "spells") return false;
            const matches = wb20QuickReadSpells().filter(spell => spell.key === key);
            if (matches.length !== 1) continue;
            const spell = matches[0];
            wayBeyond20NativeSpellIdentity(spell.row).label.click();
            let loaded = false;
            for (let n = 0; n < 20 && owner === character; n++) {
                if (document.querySelector(".alertify:not(.ajs-hidden)") ||
                    wayBeyond20ActiveCharacterSheetTab()?.textContent.trim().toLowerCase() !== "spells") return false;
                if (wayBeyond20NativeSpellPaneMatches(spell) && document.querySelector(
                    ".ct-spell-pane .ct-spell-detail__description,.ct-spell-pane div[class*='styles_description']")?.textContent.trim()) {
                    wb20QuickRememberOpenDescription();
                    loaded = true;
                    break;
                }
                await new Promise(resolve => setTimeout(resolve, 75));
            }
            if (!loaded) return false;
          }
          return true;
        });
    } catch (error) {
        // A description is optional presentation, never a reason to break casting.
        console.warn("WayBeyond20: spell description unavailable", error);
    } finally {
        session.pending = false;
        session.loadingDescription = false;
        if (owner === character) wayBeyond20RefreshCombinedActions();
    }
}

async function wb20QuickVisitSpells(callback) {
    const owner = character, previous = wayBeyond20ActiveCharacterSheetTab();
    const previousLabel = previous?.textContent.trim().toLowerCase();
    const spellTab = wayBeyond20CharacterSheetTab("Spells");
    if (!spellTab) return false;
    // A prompt's confirmation click must finish before opening native content.
    await new Promise(resolve => setTimeout(resolve, 0));
    if (owner !== character) return false;
    spellTab.click();
    try {
        let enteredSpells = false;
        for (let attempt = 0; attempt < 30 && owner === character; attempt++) {
            const active = wayBeyond20ActiveCharacterSheetTab()?.textContent.trim().toLowerCase();
            // React does not commit its selected tab synchronously with click().
            // The old tab during that transition is not user navigation away.
            if (active !== "spells") {
                if (enteredSpells || (active && active !== previousLabel)) return false;
                await new Promise(resolve => setTimeout(resolve, 75));
                continue;
            }
            enteredSpells = true;
            const rows = wb20QuickReadSpells();
            if (rows.length) {
                wb20QuickObserveSpells();
                return await callback(rows);
            }
            await new Promise(resolve => setTimeout(resolve, 75));
        }
        return false;
    } finally {
        // Never yank the user back if they navigated away during discovery.
        if (owner === character && wayBeyond20ActiveCharacterSheetTab()?.textContent.trim().toLowerCase() === "spells")
            wayBeyond20RestoreCharacterSheetTab(previous);
    }
}

function wb20QuickDiscover() {
    if (!character) return;
    const owner = character, session = wb20QuickSession();
    if (session.scanned || session.pending || !wayBeyond20CharacterSheetTab("Spells")) return;
    session.pending = true;
    setTimeout(async () => {
        try {
            if (owner !== character || document.querySelector(".alertify:not(.ajs-hidden)") ||
                wayBeyond20ActiveCharacterSheetTab()?.textContent.trim().toLowerCase() !== "actions") return;
            session.scanned = true; // Bounded once per sheet load; Manage can retry.
            await wb20QuickVisitSpells(() => true);
        } catch (error) { console.warn("WayBeyond20: spell list discovery failed", error); }
        finally {
            session.pending = false;
            if (owner === character && session.scanned) wayBeyond20RefreshCombinedActions();
        }
    }, 500);
}

function wb20QuickGroups() {
    const settings = wb20QuickSettings(), groups = new Map();
    for (const spell of wb20QuickSession().spells) {
        const override = settings.categories?.[spell.key];
        const categories = wb20QuickCategories.includes(override) ? [override] : wb20QuickClassify(spell);
        for (const category of categories) {
            const title = `${spell.level === 0 ? "Cantrip" : "Spell"}: ${category}`;
            const key = JSON.stringify(["spell-category", spell.level === 0, category, spell.cost, spell.time]);
            if (!groups.has(key)) groups.set(key, {key, name: title, cost: spell.cost, time: spell.time,
                defaultVisible: category === "Attack" || category === "Healing", spells: []});
            groups.get(key).spells.push(spell);
        }
    }
    return Array.from(groups.values());
}

async function wb20QuickCast(key) {
    const owner = character, session = wb20QuickSession();
    if (session.pending || wayBeyond20NativeCastPending) return;
    session.pending = true;
    wayBeyond20NativeCastPending = true;
    try {
        const result = await wb20QuickVisitSpells(async rows => {
            const matches = rows.filter(spell => spell.key === key);
            if (matches.length !== 1) return false;
            const spell = matches[0];
            const button = spell.row.querySelector(".ct-spells-spell__action button,.ddbc-spells-spell__action button");
            if (button?.disabled) return false;
            const action = button?.textContent.trim().toLowerCase();
            // Existing native casting path owns all spell effects and payment.
            // Unsupported native controls open details rather than guessing.
            if (button && /(?:cast|use)\s*$/.test(action)) {
                await wayBeyond20RunNativeSpellCast(spell.row, action);
                return true;
            }
            if (spell.level === 0) {
                const identity = wayBeyond20NativeSpellIdentity(spell.row);
                identity.label.click();
                for (let n = 0; n < 20 && owner === character; n++) {
                    if (wayBeyond20NativeSpellPaneMatches(identity)) {
                        await execute("ct-spell-pane");
                        return true;
                    }
                    await new Promise(resolve => setTimeout(resolve, 75));
                }
            }
            return false;
        });
        if (!result && owner === character)
            alertify.warning("This spell's current casting control was unavailable or ambiguous. Nothing was cast. Check the Spells tab.");
    } finally { session.pending = false; wayBeyond20NativeCastPending = false; }
}

function wb20QuickSimpleFormula(value) {
    const formula = String(value || "").toLowerCase().replace(/\s+/g, "");
    if (!formula || formula.length > 240) return null;
    // Exact, bounded grammar shared by the current local and VTT dice paths.
    // ro<= is a one-time reroll, not an unbounded recursive reroll.
    const termPattern = /[+-]?(?:\d*d(?:100|20|12|10|8|6|4)(?:ro<=\d+)?(?:(?:dl|dh|kl|kh)\d+)?(?:min\d+)?|\d+(?:\.\d{1,2})?)/g;
    const terms = formula.match(termPattern) || [];
    if (terms.join("") !== formula || terms.slice(1).some(term => !/^[+-]/.test(term))) return null;
    let dice = 0;
    for (const term of terms) {
        const match = term.match(/^[+-]?(\d*)d(\d+)/);
        if (match) {
            const count = Number(match[1] || 1);
            if (count < 1 || count > 100) return null;
            dice += count;
            const reroll = term.match(/ro<=(\d+)/), keepDrop = term.match(/(dl|dh|kl|kh)(\d+)/), minimum = term.match(/min(\d+)/);
            if (reroll && (Number(reroll[1]) < 1 || Number(reroll[1]) > Number(match[2]))) return null;
            if (keepDrop && (Number(keepDrop[2]) < 1 || Number(keepDrop[2]) > count)) return null;
            if (minimum && Number(minimum[1]) > 100000) return null;
        } else if (Math.abs(Number(term)) > 100000) return null;
    }
    // Existing VTT minimum-total translation expects space-separated terms.
    return dice <= 100 ? (formula.includes('min') ? terms.map(term=>/^[+-]/.test(term) ? `${term[0]} ${term.slice(1)}` : term).join(' ') : formula) : null;
}

const wb20QuickDamageTypes = ["Acid", "Bludgeoning", "Cold", "Fire", "Force", "Lightning",
    "Necrotic", "Piercing", "Poison", "Psychic", "Radiant", "Slashing", "Thunder"];

// Braces belong to WB20, not to a destination's dice-pool syntax. Validate and
// split them before dispatch; retain the complete expression for the result.
function wb20QuickFormulaParts(value, fallbackType = "") {
    const input = String(value || "").replace(/\s+/g, "");
    if (!input || input.length > 240) return null;
    const aliases = {a:"Acid", b:"Bludgeoning", c:"Cold", f:"Fire", fo:"Force", l:"Lightning",
        n:"Necrotic", p:"Piercing", po:"Poison", ps:"Psychic", r:"Radiant", s:"Slashing", t:"Thunder", d:"Divine"};
    const types = [...wb20QuickDamageTypes, "Divine"];
    const parts = [];
    const chunks = input.match(/[+-]?(?:\{[^{}]+\}|[^{}+\-]+)/g) || [];
    if (chunks.join("") !== input || chunks.slice(1).some(s => !/^[+-]/.test(s))) return null;
    for (const chunk of chunks) {
        const sign = chunk[0] === "-" ? "-" : "+";
        const body = chunk.replace(/^[+-]/, "");
        let type = fallbackType, expression = body;
        if (body.startsWith("{")) {
            const match = body.match(/^\{([a-z]+):(.+)\}$/i);
            if (!match) return null;
            type = types.find(t => t.toLowerCase() === match[1].toLowerCase()) || aliases[match[1].toLowerCase()];
            if (!type) return null;
            expression = match[2];
        }
        const formula = wb20QuickSimpleFormula(expression);
        if (!formula) return null;
        // Distribute subtraction over a whole typed group, without changing
        // the semantics of reroll / keep / minimum modifiers inside it.
        const terms = formula.replace(/\s+/g, "").match(/[+-]?[^+-]+/g);
        const signed = terms.map(term => {
            const negative = (term[0] === "-") !== (sign === "-");
            return (negative ? "-" : "+") + term.replace(/^[+-]/, "");
        }).join("");
        parts.push({type, formula: signed});
    }
    const combined = wb20QuickSimpleFormula(parts.map(p=>p.formula).join(""));
    if (!combined) return null; // Enforce the dice budget across all groups.
    const grouped = new Map();
    parts.forEach(p => grouped.set(p.type, (grouped.get(p.type) || "") + p.formula));
    return {formula: combined, display: input, typed: input.includes("{"),
        parts: Array.from(grouped, ([type, formula]) => ({type, formula: wb20QuickSimpleFormula(formula.replace(/^\+/, ""))}))};
}

function wb20QuickFormula(value) {
    if (!String(value || "").includes("{")) return wb20QuickSimpleFormula(value);
    const parsed = wb20QuickFormulaParts(value);
    return parsed ? parsed.display : null;
}

async function wb20QuickRollCustom(id) {
    const owner = character, session = wb20QuickSession();
    if (session.pending) return;
    const item = wb20QuickSettings().custom?.find(item => item.id === id);
    const formula = wb20QuickFormula(item?.formula);
    if (!item || !formula) return;
    session.pending = true;
    try {
        const damageType = wb20QuickDamageTypes.includes(item.damageType) ? item.damageType : "";
        const args = {name: item.name + (damageType ? ` (${damageType} damage)` : ""), modifier: formula,
            description: item.notes || "", "damage-type": damageType, "waybeyond20-custom-formula": true};
        const parsed = wb20QuickFormulaParts(formula, damageType);
        if (parsed?.typed) {
            args.name = item.name;
            args["waybeyond20-damage-parts"] = parsed.parts;
        }
        if (["action", "bonusAction", "reaction"].includes(item.cost))
            wayBeyond20AttachTurnResource(args, item.cost, {name: item.name, rollType: "custom"});
        if (owner === character) await sendRollWithCharacter("custom", formula, args);
    } finally { session.pending = false; }
}

function wb20QuickRows(root) {
    const settings = wb20QuickSettings(), retained = new Set(), entries = [];
    const definitions = [
        ...wb20QuickGroups(),
        ...(settings.custom || []).map(item => ({...item, key: `custom:${item.id}`, custom: true}))
    ];
    for (const definition of definitions) {
        let row = Array.from(root.querySelectorAll(":scope > .wb20-quick-row")).find(row => row._wb20Key === definition.key);
        if (!row) {
            row = document.createElement("div");
            row.className = "ddbc-combat-attack wb20-quick-row";
            row._wb20Key = definition.key;
            const template = root.querySelector(".ddbc-combat-attack:not(.wb20-quick-row)");
            for (const cls of template?.classList || []) if (cls.startsWith("styles_attack__")) row.classList.add(cls);
            row.innerHTML = '<button type="button" class="wb20-feature-option-icon">✦</button><div class="ddbc-combat-attack__name"><span class="wb20-feature-option-name"></span><div class="wb20-talent-category"></div></div><div class="ddbc-combat-attack__range"></div><div class="ddbc-combat-attack__action"></div><div class="ddbc-combat-attack__damage"></div><div class="ddbc-combat-attack__notes"></div>';
            root.append(row);
            row.querySelector("button").addEventListener("click", event => {
                event.preventDefault(); event.stopPropagation();
                if (row._wb20Owner !== character || !row.isConnected) return;
                const promise = row._wb20Definition.custom
                    ? wb20QuickRollCustom(row._wb20Definition.id)
                    : row._wb20Selected ? wb20QuickCast(row._wb20Selected) : null;
                promise?.catch(error => { console.warn("WayBeyond20: quick-list activation failed", error); alertify.warning("The activation did not finish. Check its result before retrying."); });
            });
        }
        row._wb20Owner = character; row._wb20Definition = definition;
        const set = (selector, value) => {
            const el = row.querySelector(selector);
            if (el.textContent !== value) el.textContent = value;
        };
        set(".wb20-feature-option-name", definition.name);
        const subtitle = row.querySelector(".wb20-talent-category");
        let selected;
        if (!definition.custom) {
            const key = settings.selected?.[definition.key];
            selected = definition.spells.find(spell => spell.key === key);
            let select = subtitle.querySelector("select");
            if (!select) {
                select = document.createElement("select");
                const caption = document.createElement("span");
                caption.className = "wb20-spell-choice-caption"; caption.setAttribute("aria-hidden", "true");
                subtitle.classList.add("wb20-spell-choice");
                subtitle.replaceChildren(select, caption);
                select.addEventListener("change", event => {
                    event.stopPropagation();
                    if (row._wb20Owner !== character) return;
                    wb20QuickSave({selected: {...wb20QuickSettings().selected, [definition.key]: select.value}});
                    if (select.value) wb20QuickLoadDescription(select.value).catch(error =>
                        console.warn("WayBeyond20: spell description unavailable", error));
                });
            }
            const options = [["", "Select a spell"], ...definition.spells.map(spell =>
                [spell.key, `${spell.name} · ${spell.source || "Spell"} · ${spell.level ? `Level ${spell.level}` : "Cantrip"}`])];
            const signature = JSON.stringify(options);
            if (select.dataset.options !== signature) {
                select.replaceChildren(...options.map(([value, text]) => new Option(text, value)));
                select.dataset.options = signature;
            }
            const accessible = `${definition.name} (${definition.time})`;
            if (select.getAttribute("aria-label") !== accessible) select.setAttribute("aria-label", accessible);
            if (select.value !== (selected?.key || "")) select.value = selected?.key || "";
            const caption = subtitle.querySelector(".wb20-spell-choice-caption");
            const captionText = selected?.name || "Select a spell";
            if (caption.textContent !== captionText) caption.textContent = captionText;
            const help = selected ? wb20QuickDescriptionText(selected) : "Select a spell to see its description.";
            if (select.title !== help) select.title = help;
            if (select.getAttribute("aria-description") !== help) select.setAttribute("aria-description", help);
        } else set(".wb20-talent-category", "Custom roll");
        row._wb20Selected = selected?.key || null;
        const icon = row.querySelector("button");
        const disabled = !!wb20QuickSession().loadingDescription || (!definition.custom && !selected);
        if (icon.disabled !== disabled) icon.disabled = disabled;
        const title = definition.custom ? `Roll ${definition.name}` : selected ? `Cast ${selected.name} (${definition.time})` : "Select a spell first";
        if (icon.title !== title) { icon.title = title; icon.setAttribute("aria-label", title); }
        set(".ddbc-combat-attack__range", definition.custom ? definition.range || "—" : selected?.range || "—");
        set(".ddbc-combat-attack__action", definition.custom ? "—" : selected?.hit || "—");
        set(".ddbc-combat-attack__damage", definition.custom ? definition.formula +
            (wb20QuickDamageTypes.includes(definition.damageType) ? ` ${definition.damageType}` : "") : selected?.effect || "—");
        const sortFormula = definition.custom ? definition.formula : selected?.damage || "";
        if (row.dataset.wb20SortFormula !== sortFormula) row.dataset.wb20SortFormula = sortFormula;
        set(".ddbc-combat-attack__notes", definition.custom ? definition.notes || "" :
            `${definition.time}${selected?.notes ? " · " + selected.notes : ""}`);
        retained.add(row);
        entries.push({row, name: definition.name, key: definition.key, cost: definition.cost, defaultVisible: definition.defaultVisible,
            group: definition.cost === "special" || definition.cost === "extended" ? "action" : definition.cost});
    }
    for (const row of root.querySelectorAll(":scope > .wb20-quick-row")) if (!retained.has(row)) row.remove();
    wb20QuickScheduleDescriptions();
    return entries;
}

function wb20QuickRowKey(entry) {
    return entry.key || JSON.stringify(["native", entry.name, entry.cost,
        entry.row.querySelector(".ct-combat-attack__meta-item,.ddbc-combat-attack__meta-item")?.textContent.trim() || ""]);
}

function wb20QuickIsHidden(entry, settings = wb20QuickSettings()) {
    const key = wb20QuickRowKey(entry);
    if ((settings.hidden || []).includes(key)) return true;
    if ((settings.shown || []).includes(key)) return false;
    return entry.defaultVisible === false;
}

async function wb20QuickManage(root) {
    const owner = character, session = wb20QuickSession();
    if (session.managing || session.pending) return;
    session.managing = true;
    const escape = wayBeyond20EscapeFollowupText;
    try {
        let draft = wb20QuickSettings();
        for (;;) {
            const entries = Array.from(new Map((root._wb20QuickEntries || []).map(entry => [wb20QuickRowKey(entry), entry])).entries());
            const categories = spell => ['<option value="">Use detected category: ' + escape(wb20QuickClassify(spell).join(', ')) + '</option>', ...wb20QuickCategories.map(value => `<option>${value}</option>`)].join("");
            const costOptions = value => ["action", "bonusAction", "reaction", "special"].map(cost =>
                `<option value="${cost}"${cost === value ? " selected" : ""}>${({action:"Action",bonusAction:"Bonus Action",reaction:"Reaction",special:"Free/Special"})[cost]}</option>`).join("");
            const customFields = (item, index) => `<fieldset class="wb20-custom-editor"><legend>${index === "new" ? "Add custom line" : escape(item.name)}</legend>` +
                `<label>Name<input name="custom-${index}-name" maxlength="80" value="${escape(item.name || "")}"></label>` +
                `<label>Cost<select name="custom-${index}-cost">${costOptions(item.cost || "special")}</select></label>` +
                `<label>Formula<input name="custom-${index}-formula" placeholder="4d6dl1+1d4+3" maxlength="240" value="${escape(item.formula || "")}"></label>` +
                `<label>Damage type<select name="custom-${index}-damageType"><option value="">None (general roll)</option>` +
                wb20QuickDamageTypes.map(type=>`<option${item.damageType === type ? " selected" : ""}>${type}</option>`).join("") + '</select></label>' +
                `<label>Range<input name="custom-${index}-range" maxlength="60" value="${escape(item.range || "")}"></label>` +
                `<label>Notes<input name="custom-${index}-notes" maxlength="240" value="${escape(item.notes || "")}"></label>` +
                (index === "new" ? "" : `<label><input type="checkbox" name="remove-${index}">Remove this custom line</label>`) + "</fieldset>";
            const html = '<form class="wb20-quick-manager"><p>Only damage/attack and healing spell rows appear by default. Check any other categories you want to add. Nothing is removed from your character sheet. Identical native entries share a visibility choice.</p>' +
                '<label><input type="checkbox" name="refresh-spells">Refresh spells from the current Spells tab when saving</label>' +
                '<div class="wb20-quick-checks">' + entries.map(([key, entry], index) =>
                    `<label><input type="checkbox" name="visible-${index}"${wb20QuickIsHidden(entry, draft) ? "" : " checked"}>${escape(entry.name)} <small>${escape(({action:"Action",bonusAction:"Bonus Action",reaction:"Reaction",special:"Free/Special",extended:"Longer/other casting time"})[entry.cost] || entry.cost)}</small></label>`).join("") + "</div>" +
                '<details><summary>Spell categories</summary><p>Adjust uncertain classifications. Casting times stay separate. Discovery reads the current Spells list; clear its search and select All if spells are missing.</p>' +
                session.spells.map((spell, index) => `<label>${escape(spell.name)} (${escape(spell.source)}, level ${spell.level})<select name="category-${index}">` +
                    categories(spell).replace(draft.categories?.[spell.key] ? `<option>${draft.categories[spell.key]}</option>` : 'value=""', draft.categories?.[spell.key] ? `<option selected>${draft.categories[spell.key]}</option>` : 'value="" selected') +
                    "</select></label>").join("") + "</details>" +
                '<details><summary>Custom lines</summary><p>Your dice formula will be shown with the result.</p><p>Combine dice and numbers with + or -. Keep/drop: 2d20kh1, 4d6dl1, kl (keep lowest), dh (drop highest). Reroll once: 2d6ro&lt;=2. Minimum dice-group total: 2d6min6. Example: 4d6dl1+1d4+3. Modifiers go in reroll, keep/drop, minimum order. Up to 100 dice, 240 characters. Parentheses, multiplication, division, exploding dice, variables and scripts are not yet supported.</p><p>Damage type labels the result; it does not automatically change HP. No automatic spell slots, feature uses or attack riders. The selected Action/Bonus Action/Reaction cost is tracked after a successful roll.</p>' +
                '<p>Type individual parts with braces: {Fire:3d6}+{Piercing:1d6+6}+{Radiant:3d8}. Unmarked parts use the Damage type above. Each type gets a subtotal. Shortcuts: F Fire, P Piercing, Po Poison, Ps Psychic, R Radiant, D Divine (custom). Full type names also work.</p>' +
                (draft.custom || []).map(customFields).join("") + customFields(draft.newCustom || {}, "new") + "</details></form>";
            const response = await dndbeyondDiceRoller._prompter.prompt("Manage quick list", html, "Save", "Cancel");
            if (!response || owner !== character) return;
            const nextHidden = new Set(draft.hidden || []);
            const nextShown = new Set(draft.shown || []);
            entries.forEach(([key], index) => {
                if (response.find(`[name="visible-${index}"]`).prop("checked")) {
                    nextHidden.delete(key); nextShown.add(key);
                } else { nextHidden.add(key); nextShown.delete(key); }
            });
            const nextCategories = {...draft.categories};
            session.spells.forEach((spell,index) => {
                const category = response.find(`[name="category-${index}"]`).val();
                if (wb20QuickCategories.includes(category)) nextCategories[spell.key] = category;
                else delete nextCategories[spell.key];
            });
            const read = index => Object.fromEntries(["name", "cost", "formula", "damageType", "range", "notes"].map(field =>
                [field, String(response.find(`[name="custom-${index}-${field}"]`).val() || "").trim()]));
            const custom = (draft.custom || []).flatMap((item,index) =>
                response.find(`[name="remove-${index}"]`).prop("checked") ? [] : [{...read(index), id:item.id}]);
            const newCustom = read("new");
            if (newCustom.name || newCustom.formula) custom.push({...newCustom, id: crypto.randomUUID()});
            draft = {...draft, hidden:Array.from(nextHidden), shown:Array.from(nextShown), categories:nextCategories, custom};
            if (custom.length > 50 || custom.some(item => !item.name || !wb20QuickFormula(item.formula) ||
                (item.damageType && !wb20QuickDamageTypes.includes(item.damageType)) ||
                !["action","bonusAction","reaction","special"].includes(item.cost))) {
                alertify.warning("Custom lines need a name and supported dice formula (maximum 100 dice, 240 characters). See the formula examples. Maximum 50 custom lines.");
                continue;
            }
            wb20QuickSave({hidden:draft.hidden, shown:draft.shown, categories:draft.categories, custom:draft.custom}, owner);
            if (response.find('[name="refresh-spells"]').prop("checked")) {
                await wb20QuickVisitSpells(() => true);
                if (owner === character) wayBeyond20RefreshCombinedActions();
            }
            return;
        }
    } finally { session.managing = false; }
}
