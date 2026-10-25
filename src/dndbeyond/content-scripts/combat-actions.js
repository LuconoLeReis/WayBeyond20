// Action choices use the same serialized resource dispatcher as sheet rolls.
// Rules: D&D Beyond 2024 Free Rules, Rules Glossary (Actions).
const WB20_COMBAT_ACTIONS = {
    Attack: "Spend an Action to queue your attacks. No attack is rolled yet.",
    Dash: "Gain extra movement equal to your current Speed for this turn.",
    Disengage: "Your movement does not provoke Opportunity Attacks for the rest of this turn.",
    Dodge: "Until your next turn starts, visible attackers have Disadvantage against you and you have Advantage on Dexterity saves. This ends if you are Incapacitated or your Speed becomes 0.",
    Help: "Help an eligible ally with an ability check or against an enemy within 5 feet. Describe whom you help; the recipient applies the appropriate Advantage.",
    Hide: "Make a Dexterity (Stealth) check. Confirm the required cover or concealment and lack of enemy line of sight; a roll alone does not establish that you are hidden.",
    Influence: "Make the appropriate Charisma check, or Wisdom (Animal Handling). The DM determines the response.",
    Magic: "Choose a spell or magical feature on your sheet. Its actual activation pays its own cost; opening the sheet spends nothing.",
    Search: "Make a Wisdom check using the appropriate skill to notice or assess something.",
    Study: "Make an Intelligence check using the appropriate skill to recall or investigate information.",
    Utilize: "Use a nonmagical object. Describe the object and what you do with it. Use the sheet's own activation for a tracked item instead of recording the action twice."
};
const WB20_ACTION_SKILLS = {
    Hide: ["Stealth"],
    Influence: ["Animal Handling","Deception","Intimidation","Performance","Persuasion"],
    Search: ["Insight","Medicine","Perception","Survival"],
    Study: ["Arcana","History","Investigation","Nature","Religion"]
};
let wb20CombatActionBusy = false;

function wb20BuildCombatActionMenu(label, resource, count) {
    const state = wayBeyond20GetTurnTrackerState(), turn = wayBeyond20AttackActivationTurnKey();
    const grants = Object.values(state.featureGrants || {}).filter(grant=>
        grant.unit === resource && grant.turnKey === turn && grant.remaining > 0);
    count += grants.reduce((sum,grant)=>sum + grant.remaining,0);
    const wrapper = $("<div>").addClass("wb20-action-menu");
    const toggle = $("<button type='button'>").addClass("waybeyond20-combat-resource")
        .attr({"aria-expanded":"false", "aria-label":`${label}: ${count}. Choose an action`,
            "data-waybeyond20-resource":resource, title:"Available Actions. Feature grants retain their restrictions; Haste Actions are separate."}).text(`${label}: ${count}`);
    const panel = $("<div>").addClass("wb20-action-choices").attr({"role":"group","aria-label":`${label} choices`});
    for (const [name, description] of Object.entries(WB20_COMBAT_ACTIONS)) {
        if (resource === "hasteAction" && !["Attack","Dash","Disengage","Hide","Utilize"].includes(name)) continue;
        panel.append($("<button type='button'>").text(name).attr("title",description).on("click", async event => {
            event.preventDefault(); event.stopPropagation(); wrapper.removeClass("wb20-action-open");
            toggle.attr("aria-expanded","false");
            try { await wb20TakeCombatAction(name,resource); }
            catch (error) { console.warn("WayBeyond20: combat action failed",error); alertify.warning("The action could not complete. Check Correction before trying again."); }
        }));
    }
    const open = value => { wrapper.toggleClass("wb20-action-open",value); toggle.attr("aria-expanded",String(value)); };
    toggle.on("click", event => {event.preventDefault();event.stopPropagation();open(true);});
    wrapper.on("mouseenter focusin",()=>open(true)).on("mouseleave",()=>{
        if (!wrapper[0].contains(document.activeElement)) open(false);
    }).on("focusout",event=>{if (!wrapper[0].contains(event.relatedTarget)) open(false);})
        .on("keydown",event=>{
            if (event.key === "Escape") {event.preventDefault();toggle[0].focus();open(false);}
            if (event.key === "ArrowDown" && event.target === toggle[0]) {event.preventDefault();open(true);panel.find("button").first()[0].focus();}
        });
    return wrapper.append(toggle,panel);
}

async function wb20TakeCombatAction(name, resource = "action") {
    if (wb20CombatActionBusy || !Object.hasOwn(WB20_COMBAT_ACTIONS,name) ||
        !["action","hasteAction"].includes(resource)) return false;
    if (resource === "hasteAction" && !["Attack","Dash","Disengage","Hide","Utilize"].includes(name)) return false;
    wb20CombatActionBusy = true;
    const owner = character, turn = wayBeyond20AttackActivationTurnKey();
    const request = {resource, actionType:name, takeAction:true, name};
    try {
        if (name === "Magic") {
            const tab = wayBeyond20CharacterSheetTab("Spells");
            if (!tab || typeof tab.click !== "function") {alertify.warning("Open the spell, item, or feature on your sheet and use its own activation. No Action was spent.");return false;}
            tab.click(); return true;
        }
        if (name === "Attack") return sendRollWithCharacter("trait",0,{name,
            description:"Takes the Attack action.", "source-type":"Combat action",
            "waybeyond20-resource-costs":[], "waybeyond20-turn-resource":request});
        const skills = WB20_ACTION_SKILLS[name];
        const esc = value => String(value).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
        const form = await dndbeyondDiceRoller._prompter.prompt(name,
            `<form><p>${esc(WB20_COMBAT_ACTIONS[name])}</p>${skills ? `<label>Skill <select name="skill">${skills.map(skill=>`<option>${esc(skill)}</option>`).join("")}</select></label>` : ''}<label>Details / target (optional)<input name="details" type="text" maxlength="500"></label></form>`,
            skills ? "Roll check" : "Take action","Cancel");
        if (!form || owner !== character || turn !== wayBeyond20AttackActivationTurnKey()) return false;
        const details = String(form.find('[name="details"]').val() || '').slice(0,500);
        if (skills) return wb20RollCombatSkill(String(form.find('[name="skill"]').val()), request, details);
        const result = await sendRollWithCharacter("trait",0,{name, description:WB20_COMBAT_ACTIONS[name]+(details ? "\n"+details : ''),
            "source-type":"Combat action","waybeyond20-turn-resource":request});
        if (result === true && owner === character && turn === wayBeyond20AttackActivationTurnKey() && wb20CombatOwnTurn(wayBeyond20GetTurnTrackerState())) {
            const state = {...wayBeyond20GetTurnTrackerState()};
            if (name === "Dash") state.movement = (Number(state.movement) || 0) + wayBeyond20GetCurrentDisplayedSpeed();
            if (["Dodge","Disengage","Help"].includes(name)) state.combatActionEffects = {...state.combatActionEffects,
                [name]:{name,description:WB20_COMBAT_ACTIONS[name],turnKey:turn}};
            wayBeyond20SetTurnTrackerState(state,wayBeyond20ScheduleActiveEffectBadgeRefresh);
        }
        return result;
    } finally {wb20CombatActionBusy = false;}
}

// Open the real skill pane and reuse its full roll preparation (Advantage,
// proficiency, features, dice settings). No second skill-roll implementation.
async function wb20RollCombatSkill(skill, request, details) {
    if (!WB20_ACTION_SKILLS[request.actionType]?.includes(skill)) return false;
    const owner = character, turn = wayBeyond20AttackActivationTurnKey();
    const row = $(".ct-skills__item,.ddbc-skills__item").filter((_,node)=>
        $(node).find(".ct-skills__col--skill,.ddbc-skills__col--skill").text().trim() === skill).first();
    const trigger = row.find(".ct-skills__col--skill,.ddbc-skills__col--skill").first();
    if (!trigger.length) {alertify.warning(`Open ${skill} on your sheet to roll it. No Action was spent.`);return false;}
    trigger[0].click();
    for (let attempt=0;attempt<20;attempt++) {
        if (owner !== character || turn !== wayBeyond20AttackActivationTurnKey()) return false;
        for (const pane of ["ct-skill-pane","ct-custom-skill-pane"]) {
            if ($(`.${pane}__header-name`).text().trim() === skill)
                return rollSkillCheck(pane,{request,details});
        }
        await new Promise(resolve=>setTimeout(resolve,100));
    }
    alertify.warning("The skill pane did not become available. No Action was spent."); return false;
}

function wb20ActiveCombatActionEffects(state) {
    if (!wayBeyond20HasActiveCombatState(state)) return [];
    const turn = wayBeyond20AttackActivationTurnKey();
    // End-of-turn effects need this character's turn; next-start effects survive
    // other combatants' turns, but are removed by the resource reset at own start.
    return Object.values(state.combatActionEffects || {}).filter(effect=>
        (effect.name !== "Dodge" || !wb20DodgeUnavailable()) &&
        (effect.name !== "Disengage" || (effect.turnKey === turn && wb20CombatOwnTurn(state))));
}

function wb20DodgeUnavailable() {
    return wayBeyond20GetCurrentDisplayedSpeed() === 0 || (character?._conditions || []).some(condition=>
        /^(incapacitated|stunned|paralyzed|petrified|unconscious)$/i.test(String(condition)));
}
