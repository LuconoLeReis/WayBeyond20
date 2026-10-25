// Feature consumers of the shared resource system. Class level is a formula
// input where the feature scales with it, never permission to own the feature.
let wb20FeatureUIBusy = false;
let wb20FeatureLastSave = null;

function wb20FeatureProfile(owner = character) {
    const level = Math.max(0, Math.min(20, Number(owner?.getClassLevel?.("Monk")) || 0));
    const has = name => wb20HasFeature(name,owner);
    const rules = typeof wayBeyond20LiveFeatureRules === "function" ? wayBeyond20LiveFeatureRules() : [];
    const focusRule=rules.find(rule=>/\b(?:have|gain)\b.*\bfocus points\b/i.test(rule.text));
    const explicitFocus=focusRule?.text.match(/\b(?:have|gain)\s+(\d+)\s+Focus Points/i);
    const focusPool=wb20Resource("Focus Points",owner);
    const maxFocus=focusPool?.max ?? (explicitFocus ? Number(explicitFocus[1]) : null);
    if (maxFocus !== null && !focusPool) wb20RegisterResource({name:"Focus Points",source:focusRule?.name,max:maxFocus,reset:/short/i.test(focusRule?.text || '') ? "short" : "long"},owner);
    const active=["Martial Arts","Flurry of Blows","Patient Defense","Step of the Wind","Deflect Attacks","Slow Fall","Evasion","Stunning Strike","Hand of Healing","Hand of Ultimate Mercy","Hand of Harm","Self-Restoration","Superior Defense","Disciplined Survivor","Uncanny Metabolism","Perfect Focus"].some(has);
    const mod = ability => Number(owner?.getAbility?.(ability)?.mod) || 0;
    const nativeStrike=typeof document !== "undefined" ? wb20FeatureNativeEntry() : null;
    const nativeDie=nativeStrike?.damage?.match(/\d+d(\d+)/i);
    for (const [name,max] of [["Uncanny Metabolism",1],["Hand of Ultimate Mercy",1],["Flurry of Healing and Harm",Math.max(1,mod("WIS"))]])
        if (has(name) && !wb20Resource(name,owner)) wb20RegisterResource({name,source:name,max,reset:"long"},owner);
    return {level, active, has, mercy: has("hand of healing"),
        die: nativeDie ? Number(nativeDie[1]) : level >= 17 ? 12 : level >= 11 ? 10 : level >= 5 ? 8 : 6,
        maxFocus, dex: mod("DEX"), wis: mod("WIS"),
        dc: 8 + mod("WIS") + (Number(owner?._proficiency) || 0),
        flurry: has("Heightened Focus") ? 3 : 2,
        movement: level < 2 ? 0 : level < 6 ? 10 : level < 10 ? 15 : level < 14 ? 20 : level < 18 ? 25 : 30};
}

function wb20FeatureState(owner = character) {
    return {focus:wb20Resource("Focus Points",owner)?.remaining ?? null,turns:wb20ResourceStore(owner).turns};
}

function wb20FeatureEscape(value) {
    return String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"}[c]));
}

async function wb20FeatureForm(title, body, ok = "Use") {
    return dndbeyondDiceRoller._prompter.prompt(title, `<form class="wb20-feature-prompt">${body}</form>`, ok, "Cancel");
}

function wb20FeatureTurn() {
    return wayBeyond20AttackActivationTurnKey();
}

function wb20FeatureAvailable(cost, state = wb20FeatureState(), profile = wb20FeatureProfile()) {
    if (!profile.active) return false;
    if (cost.perTurn && wb20FeatureTurn() && state.turns[cost.perTurn] === wb20FeatureTurn()) return false;
    return true;
}

function wb20FeatureCost(cost = {}) {
    return {"waybeyond20-resource-costs":[...(cost.focus ? [{name:"Focus Points",amount:cost.focus}] : []),
        ...(cost.once ? [{name:cost.once,amount:1}] : [])],
        "waybeyond20-resource-per-turn":cost.perTurn || null,
        "waybeyond20-resource-gains":cost.refill ? [{name:"Focus Points",maximum:true}] : []};
}

async function wb20FeatureRest(owner, rest) {
    if (wb20FeatureLastSave?.owner === owner) wb20FeatureLastSave = null;
    return wb20ResourcesRest(owner,rest);
}

async function wb20FeatureRoll(name, formula, {type = "", resource = null, cost = {}, description = "", save = null, whisper, critical = false} = {}, dispatch = sendRollWithCharacter) {
    let result = null;
    const args = {name, description, "waybeyond20-followup-phase": "feature", ...wb20FeatureCost(cost)};
    if (whisper !== undefined) args.whisper = whisper;
    args["waybeyond20-capture-result"] = (request, attacks, damages) => {
        const rolls = formula ? (type ? damages.map(entry => entry[1]) : attacks) : [];
        result = {request, damages, total: rolls.reduce((sum, roll) => sum + (Number(roll?.total) || 0), 0)};
    };
    if (resource) wayBeyond20AttachTurnResource(args, resource, {name, rollType: type ? "attack" : "custom"});
    if (type) Object.assign(args, {rollAttack: false, rollDamage: true, rollCritical: critical, damages: [formula], "damage-types": [type],
        "critical-damages": critical ? [formula.match(/\d+d\d+/i)?.[0] || "0"] : [], "critical-damage-types": critical ? [type] : []});
    else if (formula) args.modifier = formula;
    if (save) Object.assign(args, {"save-ability": save, "save-dc": wb20FeatureProfile().dc});
    const sent = await dispatch(type ? "attack" : formula ? "custom" : "trait", formula || 0, args);
    return sent === true ? (result || {total: null}) : null;
}

async function wb20FeatureInitialize() {
    return wb20FeatureProfile().active;
}

function wb20FeatureIsUnarmed(args) {
    return args?.["waybeyond20-unarmed-strike"] === true || /^unarmed strike$/i.test(args?.["attack-type"] || "") ||
        /^unarmed strike(?:\s*\(.*\))?$/i.test(args?.name || "");
}

function wb20FeatureIsWeapon(args) {
    if (wb20FeatureIsUnarmed(args)) return true;
    const text = [args?.["weapon-type"], args?.["item-type"], args?.["attack-type"], args?.properties].flat().join(" ");
    return /simple.*melee|melee.*simple/i.test(text) ||
        /martial/i.test(text) && /melee/i.test(text) && /\blight\b/i.test(text);
}

async function wb20FeaturePrepareAttack(args) {
    const p = wb20FeatureProfile();
    if (!p.has("Empowered Strikes") || !wb20FeatureIsUnarmed(args) || !args.rollAttack || args["waybeyond20-monk-type-chosen"] || args["waybeyond20-followup-phase"]) return true;
    const owner = character, turn = wb20FeatureTurn();
    const form = await wb20FeatureForm("Empowered Strikes", '<select name="type"><option value="normal">Normal damage type</option><option value="force">Force</option></select>', "Continue attack");
    if (!form || owner !== character || turn !== wb20FeatureTurn()) return false;
    if (form.find('[name="type"]').val() === "force") {
        if (args["damage-types"]?.length) args["damage-types"][0] = "Force";
        if (args["critical-damage-types"]?.length) args["critical-damage-types"][0] = "Force";
    }
    args["waybeyond20-monk-type-chosen"] = true;
    return true;
}

function wb20FeatureNeedsHit(args) {
    const p = wb20FeatureProfile();
    if (!character.getSetting("waybeyond20-feature-on-hit", character.getSetting("waybeyond20-monk-on-hit",true))) return false;
    return p.has("Hand of Harm") && wb20FeatureIsUnarmed(args) && wb20FeatureAvailable({focus:args?.["waybeyond20-monk-free-harm"] ? 0 : 1, perTurn:"Hand of Harm"}) ||
        p.has("Stunning Strike") && wb20FeatureIsWeapon(args) && wb20FeatureAvailable({focus:1, perTurn:"Stunning Strike"});
}

async function wb20FeatureAfterDamage(args, resolved, dispatch = sendRollWithCharacter) {
    const owner = character, turn = wb20FeatureTurn(), p = wb20FeatureProfile();
    const addedDamage = [];
    if (!wb20FeatureNeedsHit(args) || !resolved) return addedDamage;
    const damage = resolved.damages.reduce((sum, [, roll, flags]) =>
        sum + ((flags & (DAMAGE_FLAGS.HEALING | DAMAGE_FLAGS.VERSATILE | DAMAGE_FLAGS.CONDITIONAL)) ? 0 : Number(roll?.total) || 0), 0);
    const freeHarm = !!args["waybeyond20-monk-free-harm"];
    for (const name of ["Hand of Harm", "Stunning Strike"]) {
        if (character !== owner || turn !== wb20FeatureTurn()) return addedDamage;
        if (!p.has(name) || (name === "Hand of Harm" ? !wb20FeatureIsUnarmed(args) || damage <= 0 : !wb20FeatureIsWeapon(args))) continue;
        const cost = {focus: name === "Hand of Harm" && freeHarm ? 0 : 1, perTurn: name};
        if (!wb20FeatureAvailable(cost)) continue;
        const form = await wb20FeatureForm(name, `<p>${name === "Hand of Harm" ? `${freeHarm ? "No additional Focus" : "1 Focus"}; add Necrotic damage.` : `1 Focus; Constitution save DC ${p.dc}.`}</p>` +
            (!turn ? '<p>No tracked turn: verify this feature has not already been used this turn.</p>' : '') +
            (name === "Hand of Harm" && p.has("Physician’s Touch") ? '<label><input type="checkbox" name="poison"> Also poison until the end of your next turn</label>' : ''));
        if (!form) continue;
        if (character !== owner || turn !== wb20FeatureTurn()) return addedDamage;
        const result = await wb20FeatureRoll(name, name === "Hand of Harm" ? `1d${p.die}+${p.wis}` : null, {
            type: name === "Hand of Harm" ? "Necrotic" : "", cost, whisper: resolved.request?.whisper,
            critical: name === "Hand of Harm" && !!args.rollCritical,
            save: name === "Stunning Strike" ? "Constitution" : null,
            description: name === "Hand of Harm" ? (form.find('[name="poison"]').prop("checked") ? "Poisoned until the end of your next turn." : "") :
                "Failed save: Stunned until the start of your next turn. Success: Speed halved until then; the next attack against the target before then has Advantage. Resolve the target's save and conditions at the table."
        }, dispatch);
        if (name === "Hand of Harm" && result?.damages) addedDamage.push(...result.damages);
    }
    return addedDamage;
}

async function wb20FeatureStrikeSequence(flurry) {
    const owner = character, turn = wb20FeatureTurn(), p = wb20FeatureProfile();
    const source=flurry ? "Flurry of Blows" : "Bonus Unarmed Strike";
    const grant = wayBeyond20CreateAttackActivation({resource: "bonusAction", attacks: flurry ? p.flurry : 1, source});
    const count = grant.remaining;
    const maxHealing = flurry && p.mercy ? (p.has("Flurry of Healing and Harm") ? count : Math.max(0,1-(grant.benefits?.healsUsed || 0))) : 0;
    const form = await wb20FeatureForm(flurry ? "Flurry of Blows" : "Bonus Unarmed Strike",
        `<p>${count} Unarmed Strike${count > 1 ? "s" : ""}; ${grant.paid ? "activation already paid" : "one Bonus Action"+(flurry ? ", 1 Focus" : "")}.</p>` +
        (!flurry ? '<p>Confirm you are unarmed or wield only Monk weapons, without armor or a Shield.</p>' : '') +
        (maxHealing ? `<label>Replace strikes with Hand of Healing <input name="heals" type="number" min="0" max="${maxHealing}" value="0"></label>` : '') +
        (!grant.paid && flurry && p.mercy && p.has("Flurry of Healing and Harm") ? '<label><input type="checkbox" name="mercy"> Use a Flurry of Healing and Harm use (free healing replacements / Hand of Harm; limited per Long Rest)</label>' : '') +
        '<p>Each strike is rolled separately. Canceling later strikes does not refund an already used Bonus Action or Focus.</p>', "Begin");
    if (!form || owner !== character || turn !== wb20FeatureTurn()) return false;
    const heals = maxHealing ? Number(form.find('[name="heals"]').val()) : 0;
    if (!Number.isInteger(heals) || heals < 0 || heals > maxHealing) return false;
    const mercy = grant.paid ? !!grant.benefits?.mercy : !!form.find('[name="mercy"]').prop("checked");
    grant.benefits={...grant.benefits,mercy};
    if (heals > 1 && !mercy) { alertify.warning("Replacing more than one strike needs a Flurry of Healing and Harm use."); return false; }
    // Pay on the first delivered member, including a healing replacement. No Attack-action pool is touched.
    const cost = {focus: flurry ? 1 : 0, ...(mercy ? {once: "Flurry of Healing and Harm"} : {})};
    let paid = grant.paid;
    for (let i = 0; i < count; i++) {
        if (owner !== character || turn !== wb20FeatureTurn()) return false;
        const healing = i < heals;
        if (i && !await wb20FeatureForm("Continue Flurry", `<p>${healing ? "Heal" : "Unarmed Strike"} ${i + 1} of ${count}</p>`, "Continue")) break;
        let result;
        if (healing) {
            result = await wb20FeatureHealing({resource: paid ? null : "bonusAction", cost: paid ? {} : cost});
            if (result) { grant.remaining--; grant.paid = true; grant.benefits.healsUsed=(grant.benefits.healsUsed || 0)+1; wb20RecordAttackGrant(grant); }
        } else {
            const entry = wb20FeatureNativeEntry();
            if (!entry) { alertify.warning("Show the native Unarmed Strike row in Actions before using this attack. Nothing further was spent."); break; }
            const typeChoice = p.has("Empowered Strikes") ? await wb20FeatureForm("Unarmed damage", '<select name="type"><option>Bludgeoning</option><option>Force</option></select>', "Roll strike") : null;
            if (p.has("Empowered Strikes") && !typeChoice) break;
            const type = typeChoice?.find('[name="type"]').val() || "Bludgeoning";
            // Re-enter the actual native pane/attack builder: magic-item bonuses,
            // enabled riders, roll mode and existing attack rules stay intact.
            const context = {kind: "feature", activation: grant, attackAction: false, isOwnTurn: true,
                rules: wayBeyond20LiveFeatureRules(), review: new Map(), damageType: type,
                freeHarm: mercy, featureCost: paid ? null : cost};
            result = await wayBeyond20OpenGrantedAttack(entry, context, null) === true;
        }
        if (!result) break;
        paid = true;
    }
    return paid;
}

async function wb20FeatureHealing({resource = "action", cost = {focus: 1}, ultimate = false} = {}) {
    const owner = character, turn = wb20FeatureTurn(), p = wb20FeatureProfile();
    const conditions = p.has("Physician’s Touch") ? ["None", "Blinded", "Deafened", "Paralyzed", "Poisoned", "Stunned"] : ["None"];
    const form = await wb20FeatureForm(ultimate ? "Hand of Ultimate Mercy" : "Hand of Healing",
        '<label>Creature touched <input name="target" maxlength="120" required></label>' +
        (ultimate ? '<p>Confirm this creature died within the past 24 hours. Removes Blinded, Deafened, Paralyzed, Poisoned and Stunned if present at death.</p>' :
            `<label>Also end a condition <select name="condition">${conditions.map(name => `<option>${name}</option>`).join("")}</select></label>`));
    if (!form || character !== owner || turn !== wb20FeatureTurn()) return null;
    const target = String(form.find('[name="target"]').val() || "").trim();
    if (!target) return null;
    const condition = form.find('[name="condition"]').val();
    return wb20FeatureRoll(ultimate ? "Hand of Ultimate Mercy" : "Hand of Healing", `${ultimate ? "4d10" : `1d${p.die}`}+${p.wis}`, {
        type: "Healing", resource, cost, description: `Target: ${target}. ` + (ultimate ? "Return to life; remove the listed conditions." :
            condition && condition !== "None" ? `End ${condition}.` : "") + " Apply healing and conditions to that creature; no target HP is written automatically."
    });
}

function wb20FeatureDeflection(profile, incoming, reduction, types) {
    if (!Number.isSafeInteger(incoming) || incoming < 0 || !Number.isFinite(reduction) || reduction < 0) return null;
    if (!profile.has("Deflect Energy") && !types.some(type => ["Bludgeoning", "Piercing", "Slashing"].includes(type))) return null;
    return {remaining: Math.max(0, incoming - reduction), redirect: incoming <= reduction};
}

function wb20FeatureEvasion(damage, success, incapacitated) {
    return incapacitated ? (success ? Math.floor(damage / 2) : damage) : success ? 0 : Math.floor(damage / 2);
}

function wb20FeatureNativeEntry() {
    if (typeof document === "undefined") return null;
    const rows = Array.from(document.querySelectorAll(".ct-combat-attack,.ddbc-combat-attack")).filter(row =>
        /^unarmed strike$/i.test(row.querySelector(".ct-combat-attack__label,.ddbc-combat-attack__label")?.textContent.trim() || ""));
    if (!rows.length) return null;
    const actionRows=rows.filter(row=>[...row.querySelectorAll('[aria-label]')].some(button=>/unarmed strike:\s*action\./i.test(button.getAttribute('aria-label'))));
    const candidates=actionRows.length ? actionRows : rows;
    const signature=row=>[row.querySelector('.ct-combat-attack__tohit,.ddbc-combat-attack__tohit')?.textContent,
        row.querySelector('.ct-combat-attack__damage,.ddbc-combat-attack__damage')?.textContent].join('|').replace(/\s/g,'');
    if (candidates.some(row=>signature(row)!==signature(candidates[0]))) return null;
    const row=candidates[0];
    const hit = row.querySelector(".ct-combat-attack__tohit,.ddbc-combat-attack__tohit")?.textContent.replace(/\s/g, "");
    const damage = row.querySelector(".ct-combat-attack__damage,.ddbc-combat-attack__damage")?.textContent.replace(/\s/g, "").match(/\d+d\d+(?:[+-]\d+)?/)?.[0];
    const label = row.querySelector(".ct-combat-attack__label,.ddbc-combat-attack__label");
    return /^[+-]?\d+$/.test(hit || "") && damage && label ? {row,label,name:label.textContent.trim(),hit,damage} : null;
}

function wb20FeatureRememberSave(type, args) {
    if (!["saving-throw", "death-save"].includes(type) || args?.["waybeyond20-monk-reroll"] || !wb20HasFeature("Disciplined Survivor")) return;
    const owner = character, prior = args["waybeyond20-capture-result"];
    args["waybeyond20-capture-result"] = (request, attacks, damages) => {
        prior?.(request, attacks, damages);
        if (owner === character) wb20FeatureLastSave = {owner, type, turn: wb20FeatureTurn(), args: {...args}, whisper: request.whisper};
    };
}

async function wb20FeatureRerollSave() {
    const last = wb20FeatureLastSave;
    if (!last || last.owner !== character || last.turn !== wb20FeatureTurn()) { alertify.warning("Roll the failed saving throw on this sheet first."); return false; }
    if (!await wb20FeatureForm("Disciplined Survivor", '<p>Confirm the last saving throw failed. Spend 1 Focus to reroll; you must use the new result.</p>', "Reroll save")) return false;
    if (last.owner !== character || last.turn !== wb20FeatureTurn() || wb20FeatureLastSave !== last) return false;
    const args = {...last.args, whisper: last.whisper, ...wb20FeatureCost({focus:1}), "waybeyond20-monk-reroll": true};
    for (const key of ["waybeyond20-capture-result", "waybeyond20-after-dispatch", "waybeyond20-turn-resource", "waybeyond20-turn-resources", "waybeyond20-limited-use", "waybeyond20-portent-value", "d20"])
        delete args[key];
    const result = await sendRollWithCharacter(last.type, "1d20" + args.modifier, args);
    if (result === true) wb20FeatureLastSave = null;
    return result;
}

async function wb20FeatureEvasionQuery() {
    const form = await wb20FeatureForm("Evasion", '<p>For a Dexterity saving throw that normally deals half damage on success.</p>' +
        '<label>Full damage <input name="damage" type="number" min="0" step="1"></label><label><input type="checkbox" name="success"> Save succeeded</label>' +
        '<label><input type="checkbox" name="incapacitated"> Incapacitated (Evasion does not apply)</label>', "Calculate");
    if (!form) return;
    const raw = String(form.find('[name="damage"]').val()), damage = Number(raw);
    if (!raw || !Number.isSafeInteger(damage) || damage < 0) return;
    const total = wb20FeatureEvasion(damage, !!form.find('[name="success"]').prop("checked"), !!form.find('[name="incapacitated"]').prop("checked"));
    alertify.message(`Damage to apply: ${total}. This calculation did not change HP.`);
    return total;
}

function wb20FeaturePassiveSummary(p = wb20FeatureProfile()) {
    return (typeof wayBeyond20LiveFeatureRules === "function" ? wayBeyond20LiveFeatureRules() : [])
        .filter(rule=>p.has(rule.name)).map(rule=>[rule.name,0,rule.text]);
}

async function wb20FeatureDeflect() {
    const owner = character, turn = wb20FeatureTurn(), p = wb20FeatureProfile();
    const types = typeof WAYBEYOND20_DAMAGE_TYPES === "undefined" ? ["Bludgeoning", "Piercing", "Slashing"] : WAYBEYOND20_DAMAGE_TYPES;
    const form = await wb20FeatureForm("Deflect Attacks", '<p>Confirm an attack roll hit you.</p><label>Attack damage <input type="number" min="0" step="1" name="damage"></label>' +
        '<label>Damage types (select all included)<select name="types" multiple>' + types.map(type => `<option>${type}</option>`).join("") +
        '</select></label><label>Attack <select name="range"><option>Melee</option><option>Ranged</option></select></label>', "Use Reaction");
    if (!form || owner !== character || turn !== wb20FeatureTurn()) return false;
    const damageText = String(form.find('[name="damage"]').val());
    const incoming = Number(damageText), selected = form.find('[name="types"]').val() || [];
    if (!damageText || !selected.length || !wb20FeatureDeflection(p, incoming, 0, selected)) { alertify.warning("Check the incoming damage and eligible damage types."); return false; }
    const result = await wb20FeatureRoll("Deflect Attacks", `1d10+${p.dex}+${p.level}`, {resource: "reaction", description: "Reduction of the attack's total damage, not an attack or damage dealt."});
    if (!result || result.total === null) return false;
    const outcome = wb20FeatureDeflection(p, incoming, result.total, selected);
    alertify.message(`Damage remaining: ${outcome.remaining}. Apply this instead of the original attack damage.`);
    if (!outcome.redirect || owner !== character || turn !== wb20FeatureTurn()) return true;
    const ranged = form.find('[name="range"]').val() === "Ranged";
    const redirect = await wb20FeatureForm("Redirect attack", `<p>1 Focus. Choose a creature you can see within ${ranged ? "60 feet, not behind Total Cover" : "5 feet"}.</p>` +
        '<label>Creature <input name="target" maxlength="120"></label><label>Damage type <select name="type">' + selected.map(type => `<option>${wb20FeatureEscape(type)}</option>`).join("") + '</select></label>');
    if (!redirect || owner !== character || turn !== wb20FeatureTurn()) return true;
    const target = String(redirect.find('[name="target"]').val() || "").trim();
    if (!target) return true;
    await wb20FeatureRoll("Deflect Attacks: Redirect", `2d${p.die}+${p.dex}`, {type: redirect.find('[name="type"]').val(), cost: {focus: 1},
        save: "Dexterity", description: `${target}: Dexterity save DC ${p.dc}; damage on failure only. No additional Reaction.`});
    return true;
}

async function wb20FeatureInitiative() {
    const owner = character, p = wb20FeatureProfile();
    if (!p.has("Uncanny Metabolism") && !p.has("Perfect Focus")) return;
    if (p.has("Uncanny Metabolism") && wb20Resource("Uncanny Metabolism")?.remaining !== 0) {
        const form = await wb20FeatureForm("Uncanny Metabolism", '<p>Regain all expended Focus and roll healing? Once per Long Rest; no Action.</p>');
        if (character !== owner) return;
        if (form) {
            const result = await wb20FeatureRoll("Uncanny Metabolism", `1d${p.die}+${p.level}`, {type: "Healing", cost: {once: "Uncanny Metabolism", refill: true}});
            if (result?.total !== null && result && character === owner) {
                const heal = await wayBeyond20ApplyHealingToSelf(result.total, {source: "Uncanny Metabolism"});
                if (!heal.applied) alertify.warning(`Apply ${result.total} healing to yourself; the native Heal control was not available.`);
            }
            return;
        }
    }
    if (p.has("Perfect Focus") && character === owner) await wb20ResourceLocked(async () => {
        const latest = wb20Resource("Focus Points",owner);
        if (latest?.remaining !== null && latest?.remaining < 4) await wb20SetResource("Focus Points",4,{owner,reason:"Perfect Focus"});
    });
}

async function wb20FeatureActivate(name) {
    if (wb20FeatureUIBusy) return false;
    wb20FeatureUIBusy = true;
    const owner = character, turn = wb20FeatureTurn();
    try {
        if (!await wb20FeatureInitialize()) return false;
        const p = wb20FeatureProfile();
        if (!wb20FeatureActions(p).some(([action]) => action === name) && !["Focus", "Feature rules", "Reroll save", "Evasion"].includes(name)) return false;
        if (name === "Feature rules") return await wb20FeatureForm("Feature rules and sheet integration", wb20FeaturePassiveSummary(p).map(([feature,,text]) =>
            `<p><strong>${wb20FeatureEscape(feature)}</strong><br>${wb20FeatureEscape(text)}</p>`).join(""), "Close");
        if (name === "Reroll save" && p.has("Disciplined Survivor")) return await wb20FeatureRerollSave();
        if (name === "Evasion" && p.has("Evasion")) return await wb20FeatureEvasionQuery();
        if (name === "Focus") return await wb20CorrectResources();
        const state = wayBeyond20GetTurnTrackerState();
        if (name === "Flurry of Blows" || name === "Bonus Unarmed Strike") return await wb20FeatureStrikeSequence(name === "Flurry of Blows");
        if (name === "Deflect Attacks") return await wb20FeatureDeflect();
        if (name === "Hand of Healing") return await wb20FeatureHealing();
        if (name === "Hand of Ultimate Mercy") return await wb20FeatureHealing({ultimate: true, cost: {focus: 5, once: "Hand of Ultimate Mercy"}});
        if (name === "Slow Fall") return await wb20FeatureRoll(name, null, {resource: "reaction", description: `Reduce fall damage by ${5 * p.level}, to a minimum of 0.`});
        if (name === "Patient Defense" || name === "Step of the Wind") {
            const patient = name === "Patient Defense";
            const form = await wb20FeatureForm(name, `<select name="mode"><option value="free">${patient ? "Disengage" : "Dash"} · no Focus</option>` +
                `<option value="focus">${patient ? "Disengage + Dodge" : "Dash + Disengage; double jump distance"} · 1 Focus</option></select>` +
                (!patient && p.has("Heightened Focus") ? '<p>Focus option may carry one willing Large-or-smaller creature within 5 feet until turn end, without provoking for that creature.</p>' : ''));
            if (!form || owner !== character || turn !== wb20FeatureTurn()) return false;
            const focus = form.find('[name="mode"]').val() === "focus";
            const result = await wb20FeatureRoll(name, patient && focus && p.has("Heightened Focus") ? `2d${p.die}` : null, {
                type: patient && focus && p.has("Heightened Focus") ? "Temp HP" : "", resource: "bonusAction", cost: {focus: focus ? 1 : 0},
                description: patient ? `Disengage${focus ? "; Dodge until the start of your next turn" : ""}.` : `Dash${focus ? "; Disengage; doubled jump distance this turn" : ""}.`});
            if (result && owner === character && turn === wb20FeatureTurn()) {
                wayBeyond20TrackSelfFeatureEffect(name, patient && focus ? "Until the start of your next turn" : "Until the end of your turn",
                    [{name: "Benefit", value: patient ? focus ? "Disengage; Dodge" : "Disengage" : focus ? "Dash; Disengage; double jump" : "Dash"}]);
                if (patient && focus && p.has("Heightened Focus") && result.total !== null) await wayBeyond20SetTemporaryHitPoints(result.total);
                if (!patient) { const latest = {...wayBeyond20GetTurnTrackerState()}; if (latest.inCombat) {latest.movement = (Number(latest.movement) || 0) + (Number(character._speed) || 0); wayBeyond20SetTurnTrackerState(latest);} }
            }
            return result;
        }
        if (name === "Self-Restoration") {
            const choices = ["Charmed", "Frightened", "Poisoned"].filter(wayBeyond20SelfHasCondition);
            if (!choices.length) { alertify.message("No eligible condition is currently shown."); return false; }
            const form = await wb20FeatureForm(name, '<p>At the end of your turn, remove one:</p><select name="condition">' + choices.map(c => `<option>${c}</option>`).join("") + '</select>');
            if (form && owner === character && turn === wb20FeatureTurn()) return await wayBeyond20RemoveConditionFromSelf(form.find('[name="condition"]').val());
        }
        if (name === "Superior Defense") {
            if (state.inCombat && state.currentRoll20Turn?.isThisCharactersTurn === false &&
                !await wayBeyond20ConfirmChoice("Different turn","Superior Defense is normally activated at the start of your turn. Proceed?","Proceed","Cancel")) return false;
            if (!await wb20FeatureForm(name, '<p>At the start of your turn: 3 Focus; resistance to all damage except Force for 1 minute, ending if Incapacitated.</p>')) return false;
            if (owner !== character || turn !== wb20FeatureTurn()) return false;
            const result = await wb20FeatureRoll(name, null, {cost: {focus: 3}});
            if (result && owner === character && turn === wb20FeatureTurn()) wayBeyond20TrackSelfFeatureEffect(name, "1 minute", [{name: "Resistance", value: "All damage except Force; ends when Incapacitated"}], ["resistance"]);
            return result;
        }
    } finally { wb20FeatureUIBusy = false; }
}

function wb20FeatureActions(p = wb20FeatureProfile()) {
    if (!p.active) return [];
    return [["Bonus Unarmed Strike", "Martial Arts", "bonusAction"], ["Flurry of Blows", "Flurry of Blows", "bonusAction"],
        ["Patient Defense", "Patient Defense", "bonusAction"], ["Step of the Wind", "Step of the Wind", "bonusAction"], ["Deflect Attacks", "Deflect Attacks", "reaction"],
        ["Slow Fall", "Slow Fall", "reaction"], ["Evasion", "Evasion", "special"], ["Self-Restoration", "Self-Restoration", "special"],
        ["Reroll save", "Disciplined Survivor", "special"], ["Superior Defense", "Superior Defense", "special"],
        ["Hand of Healing", "Hand of Healing", "action"], ["Hand of Ultimate Mercy", "Hand of Ultimate Mercy", "action"]]
        .filter(([,feature])=>p.has(feature));
}

function wb20FeatureRows(root) {
    if (character.getSetting("waybeyond20-feature-controls",true) === false) {root.querySelectorAll(':scope > .wb20-feature-row').forEach(row=>row.remove());return [];}
    const p = wb20FeatureProfile(), entries = [], wanted = new Set();
    for (const [name, , cost] of wb20FeatureActions(p)) {
        wanted.add(name);
        let row = Array.from(root.querySelectorAll(":scope > .wb20-feature-row")).find(el => el._wb20FeatureName === name);
        if (!row) {
            row = document.createElement("div"); row.className = "ddbc-combat-attack wb20-feature-option wb20-feature-row";
            row._wb20FeatureName = name;
            row.innerHTML = '<button type="button" class="wb20-feature-option-icon">◆</button><div class="ddbc-combat-attack__name"><span class="wb20-feature-option-name"></span><div class="wb20-talent-category"></div></div><div class="ddbc-combat-attack__range"></div><div class="ddbc-combat-attack__action"></div><div class="ddbc-combat-attack__damage"></div><div class="ddbc-combat-attack__notes"></div>';
            row.querySelector(".wb20-feature-option-name").textContent = name;
            row.querySelector("button").addEventListener("click", () => { if (row._wb20Owner === character) wb20FeatureActivate(name).catch(error => {console.warn("WayBeyond20: Feature activation failed", error); alertify.warning("Feature activation did not finish. Check its last result before retrying.");}); });
            root.append(row);
        }
        row._wb20Owner = character;
        const set = (cls, value) => { const el = row.querySelector(cls); if (el.textContent !== value) el.textContent = value; };
        const healing = name.includes("Healing") || name.includes("Mercy");
        set(".wb20-talent-category", healing ? "Heal Creature" : name.includes("Strike") || name.includes("Flurry") ? "Unarmed Strike" : "Feature");
        set(".ddbc-combat-attack__range", healing ? "Touch" : name.includes("Strike") || name.includes("Flurry") ? "5 ft." : "Self");
        set(".ddbc-combat-attack__action", name === "Deflect Attacks" ? `DEX DC ${p.dc}` : "—");
        set(".ddbc-combat-attack__damage", healing ? `${name.includes("Ultimate") ? "4d10" : `1d${p.die}`}+${p.wis}` : name === "Slow Fall" ? `${5 * p.level} reduction` : name === "Deflect Attacks" ? `1d10+${p.dex + p.level}` : name.includes("Flurry") ? `${p.flurry} strikes` : "Use");
        set(".ddbc-combat-attack__notes", name === "Hand of Ultimate Mercy" ? "5 Focus · 1/Long Rest" : name === "Flurry of Blows" || healing ? "1 Focus" : "");
        const live = typeof wayBeyond20LiveFeatureRules === "function" ? wayBeyond20LiveFeatureRules().find(rule => rule.name === name)?.text : "";
        const title = live || `${name} — open activation choices`;
        if (row.querySelector("button").title !== title) row.querySelector("button").title = title;
        entries.push({row, name, cost, group: cost === "special" ? "action" : cost});
    }
    for (const row of root.querySelectorAll(":scope > .wb20-feature-row")) if (!wanted.has(row._wb20FeatureName)) row.remove();
    return entries;
}

function wb20FeatureToolbar(toolbar) {
    const p = wb20FeatureProfile();
    let button = toolbar.querySelector(".wb20-feature-focus");
    if (!p.active || character.getSetting("waybeyond20-feature-controls",true) === false) { button?.remove(); toolbar.querySelector(".wb20-feature-rules")?.remove(); return; }
    if (!button) {
        button = document.createElement("button"); button.type = "button"; button.className = "wb20-feature-focus";
        button.addEventListener("click", () => wb20FeatureActivate("Focus").catch(console.warn));
        toolbar.querySelector(".wb20-action-list-controls").prepend(button);
    }
    const value = wb20FeatureState().focus;
    const text = `Focus: ${value === null ? "Unknown" : `${value}/${p.maxFocus}`}`;
    if (button.textContent !== text) button.textContent = text;
    const title = "Shared Focus resource; native DDB count when available. Open Correction to reconcile an error.";
    if (button.title !== title) button.title = title;
    let rules = toolbar.querySelector(".wb20-feature-rules");
    if (!rules) { rules = document.createElement("button"); rules.type = "button"; rules.className = "wb20-feature-rules"; rules.textContent = "Feature rules";
        rules.addEventListener("click", () => wb20FeatureActivate("Feature rules").catch(console.warn));
        toolbar.querySelector(".wb20-action-list-controls").append(rules); }
}
