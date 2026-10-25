// One accounting interface. Native DDB counters are the source of truth;
// only resources without native controls live in WB20 storage.
const WB20_RESOURCE_KEY = "waybeyond20-resources";
let wb20ResourceQueue = Promise.resolve();
let wb20CorrectionOpen = false;
const wb20ResourceDefinitions = new WeakMap();
const wb20NativeResourceSnapshots = new WeakMap();

function wb20ResourceId(name) {
    return String(name || "").replace(/[’']/g, "").replace(/[^a-z0-9]+/gi, " ").trim().toLowerCase();
}

function wb20OwnedFeatures(owner = character) {
    const rules = typeof wayBeyond20LiveFeatureRules === "function" ? wayBeyond20LiveFeatureRules() : [];
    return [...(owner?._class_features || []), ...(owner?._racial_traits || []), ...(owner?._feats || []),
        ...(owner?._actions || []), ...rules.map(rule => rule.name)].map(String);
}

function wb20HasFeature(name, owner = character) {
    const id = wb20ResourceId(name);
    return wb20OwnedFeatures(owner).some(value => {
        const clean=value.replace(/\s*\((?:special|action|bonus action|reaction)\)\s*$/i,'');
        const actual = wb20ResourceId(clean).replace(/ 2024$/, "");
        return actual === id || clean.split(':').slice(1).some(part=>wb20ResourceId(part).replace(/ 2024$/,'') === id);
    });
}

function wb20ResourceStore(owner = character) {
    const raw = owner.getSetting(WB20_RESOURCE_KEY, {}) || {};
    return {pools: {...raw.pools}, turns: {...raw.turns}, history: Array.isArray(raw.history) ? raw.history.slice(-30) : []};
}

function wb20ResourceSave(store, owner = character) {
    return new Promise(resolve => owner.mergeCharacterSettings({[WB20_RESOURCE_KEY]: store}, () => {
        if (owner === character && typeof wayBeyond20ScheduleActiveEffectBadgeRefresh === "function") wayBeyond20ScheduleActiveEffectBadgeRefresh();
        resolve();
    }));
}

function wb20ResourceLocked(operation, owner = character) {
    const run = async () => {
        if (typeof getStoredSettings === "function" && typeof character_settings !== "undefined" && owner.updateSettings) {
            const saved = await new Promise(resolve => getStoredSettings(resolve, "character-" + owner._id, character_settings));
            owner.updateSettings(saved);
        }
        return operation();
    };
    const next = wb20ResourceQueue.then(() => typeof navigator !== "undefined" && navigator.locks
        ? navigator.locks.request("wb20-resources-" + owner._id, run) : run());
    wb20ResourceQueue = next.catch(() => {});
    return next;
}

function wb20RegisterResource(definition, owner = character) {
    if (!owner || !definition.name || !Number.isInteger(definition.max) || definition.max < 0) return;
    if (!wb20ResourceDefinitions.has(owner)) wb20ResourceDefinitions.set(owner, new Map());
    const id=wb20ResourceId(definition.name), previous=wb20ResourceDefinitions.get(owner).get(id);
    if (!previous || previous.kind === "local") wb20ResourceDefinitions.get(owner).set(id, {...definition, kind: "local"});
}

function wb20NativeResources() {
    if (wb20NativeResourceSnapshots.has(character)) return wb20NativeResourceSnapshots.get(character);
    const pools = new Map();
    if (typeof document === "undefined" || typeof wayBeyond20LimitedUseSelectors !== "function") return pools;
    const selectors = wayBeyond20LimitedUseSelectors();
    for (const control of document.querySelectorAll(selectors.control)) {
        const slotHeader=control.closest('.ct-content-group__header,.ddbc-content-group__header');
        if (slotHeader && typeof wayBeyond20SpellSlotHeaderLevel === "function" && wayBeyond20SpellSlotHeaderLevel(slotHeader)) continue;
        const name = wayBeyond20LimitedUseControlOwnerLabel(control);
        if (!name || pools.has(wb20ResourceId(name))) continue;
        const controls = wayBeyond20FindLimitedUseControls(name).controls;
        if (!controls.length) continue;
        const row = controls[0].closest(selectors.row);
        const heading=row?.querySelector(selectors.label);
        const label = (typeof wayBeyond20ElementOwnText === "function" && heading ? wayBeyond20ElementOwnText(heading) : heading?.textContent.trim()) || name;
        pools.set(wb20ResourceId(name), {name: label, kind: "native", max: controls.length,
            remaining: controls.filter(wayBeyond20LimitedUseControlIsUnused).length});
    }
    // Numeric pools must be owned by their nearest feature, not a neighboring row.
    for (const widget of document.querySelectorAll('.ct-slot-manager-large,.ddbc-slot-manager-large')) {
        if (!wayBeyond20LimitedUseControlIsVisible(widget)) continue;
        const row = widget.closest(selectors.row);
        let heading = row?.querySelector(selectors.label);
        if (!heading) {
            // Some native pools (e.g. casting resources) live in a header rather
            // than a feature snippet. Accept only a single owned label/widget.
            for (let node=widget.parentElement,depth=0;node && depth<8;node=node.parentElement,depth++) {
                const labels=[...node.querySelectorAll(selectors.label+',.ct-slot-manager-large__label,.ddbc-slot-manager-large__label')];
                if (!labels.length) continue;
                if (labels.length === 1 && node.querySelectorAll('.ct-slot-manager-large,.ddbc-slot-manager-large').length === 1) heading=labels[0];
                break;
            }
        }
        const current = widget.querySelector('[class*="value--cur"]');
        const max = widget.querySelector('[class*="value--max"]');
        if (!heading || !current || !max) continue;
        const name = heading.textContent.trim(), remaining = Number(current.textContent.trim()), maximum = Number(max.textContent.replace(/[^\d]/g,""));
        if (Number.isInteger(remaining) && Number.isInteger(maximum) && maximum >= remaining)
            pools.set(wb20ResourceId(name), {name, kind: "numeric", max: maximum, remaining, widget});
    }
    if (typeof wayBeyond20AllSpellSlotPools === "function") for (const slot of wayBeyond20AllSpellSlotPools()) {
        const name=`Level ${slot.level} spell slots`;
        pools.set(wb20ResourceId(name),{name,kind:"slot",level:slot.level,max:slot.total,remaining:slot.available});
    }
    const owner=character;
    wb20NativeResourceSnapshots.set(owner,pools);
    Promise.resolve().then(()=>{if (wb20NativeResourceSnapshots.get(owner) === pools) wb20NativeResourceSnapshots.delete(owner);});
    return pools;
}

function wb20Resources(owner = character) {
    const pools = owner === character ? new Map(wb20NativeResources()) : new Map();
    if (!wb20ResourceDefinitions.has(owner)) wb20ResourceDefinitions.set(owner,new Map());
    for (const [id,pool] of pools) wb20ResourceDefinitions.get(owner).set(id,{name:pool.name,kind:pool.kind,max:pool.max,level:pool.level});
    const store = wb20ResourceStore(owner);
    for (const [id, definition] of wb20ResourceDefinitions.get(owner) || []) {
        if (definition.source && !wb20HasFeature(definition.source,owner)) continue;
        if (!pools.has(id)) {
            const saved = store.pools[id];
            pools.set(id, {...definition, remaining: definition.kind === "local" && Number.isInteger(saved?.remaining) ? Math.min(definition.max, saved.remaining) : null});
        }
    }
    const state = typeof wayBeyond20GetTurnTrackerState === "function" ? wayBeyond20GetTurnTrackerState() : {};
    if (state.inCombat) {
        for (const [id,name] of [["action","Action"],["bonusAction","Bonus Action"],["reaction","Reaction"],["hasteAction","Haste attack action"],["attacksRemaining","# of Attacks (standard)"],["movement","Movement"]]) {
            if (id === "hasteAction" && !state.maxHasteAction) continue;
            const max = id === "attacksRemaining" ? wayBeyond20AttacksPerAttackAction()
                : id === "hasteAction" ? state.maxHasteAction : null;
            pools.set(id, {name, kind: "turn", remaining: Number(state[id]) || 0, max: Number.isInteger(max) ? max : null});
        }
        for (const [id,grant] of Object.entries(state.featureGrants || {}))
            if (grant.turnKey === wayBeyond20AttackActivationTurnKey()) pools.set("grant:" + id, {...grant, kind:"grant", remaining: grant.remaining, max: grant.max});
        for (const [name,usedTurn] of Object.entries(store.turns)) {
            if (wb20HasFeature(name,owner)) pools.set("turn-use:"+name,{name:name+" (this turn)",kind:"perTurn",max:1,remaining:usedTurn === wayBeyond20AttackActivationTurnKey() ? 0 : 1});
        }
    }
    return pools;
}

function wb20Resource(name, owner = character) {
    const id = wb20ResourceId(name);
    return [...wb20Resources(owner)].find(([key,pool]) => key === name || key === id || wb20ResourceId(pool.name) === id)?.[1] || null;
}

async function wb20VisitResourceSheets(operation, owner = character, names = ["Features & Traits", "Actions"]) {
    const previous = typeof wayBeyond20ActiveCharacterSheetTab === "function" ? wayBeyond20ActiveCharacterSheetTab() : "";
    try {
        for (const name of names) {
            if (owner !== character) return;
            const tab = typeof wayBeyond20CharacterSheetTab === "function" ? wayBeyond20CharacterSheetTab(name) : null;
            if (!tab) continue;
            tab.click();
            await new Promise(resolve => setTimeout(resolve, 150));
            if (owner === character) await operation();
        }
    } finally {
        if (owner === character && previous && typeof wayBeyond20RestoreCharacterSheetTab === "function") wayBeyond20RestoreCharacterSheetTab(previous);
    }
}

async function wb20SetNativeResource(pool, desired, owner) {
    if (pool.kind === "slot") {
        for (let index=0;index<pool.max;index++) {
            if (owner !== character) return false;
            const fresh=wb20Resource(pool.name,owner);
            if (!fresh || fresh.remaining === null) return false;
            if (fresh.remaining === desired) return true;
            const changed=desired > fresh.remaining ? await wayBeyond20RestoreSpellSlot(pool.level)
                : await wayBeyond20SpendSpellSlot(pool.level,{expectedAvailable:fresh.remaining});
            if (!changed) return false;
        }
        return wb20Resource(pool.name,owner)?.remaining === desired;
    }
    if (pool.kind === "numeric") {
        const widget = pool.widget;
        if (!widget?.isConnected || widget.querySelector('[class*="__diff"]')) return false;
        const delta = desired - pool.remaining;
        for (let i=0; i<Math.abs(delta); i++) {
            if (owner !== character || !widget.isConnected) return false;
            const button = widget.querySelector(delta > 0 ? 'button[class*="action-increase"]' : 'button[class*="action-decrease"]');
            if (!button || button.disabled) return false;
            button.click();
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        const diff = widget.querySelector('[class*="__diff-explain"]');
        const confirms = [...widget.querySelectorAll('button')].filter(button => /^confirm$/i.test(button.textContent.trim()) && !button.disabled);
        if (!diff || wayBeyond20ParseInteger(diff.textContent) !== delta || confirms.length !== 1) return false;
        confirms[0].click();
        for (let i=0;i<10;i++) {
            await new Promise(resolve=>setTimeout(resolve,100));
            if (owner !== character) return false;
            const fresh = wb20Resource(pool.name,owner);
            if (fresh?.remaining === desired && !fresh.widget.querySelector('[class*="__diff"]')) return true;
        }
        return false;
    }
    // One verified click per point; never toggle a guessed neighboring counter.
    for (let i=0;i<pool.max;i++) {
        if (owner !== character) return false;
        const fresh = wb20Resource(pool.name,owner);
        if (!fresh || fresh.kind !== "native") return false;
        if (fresh.remaining === desired) return true;
        if (desired < fresh.remaining) {
            if (!await wayBeyond20SpendLimitedUse(pool.name)) return false;
        } else {
            const controls = wayBeyond20FindLimitedUseControls(pool.name).controls;
            const used = controls.find(control => !wayBeyond20LimitedUseControlIsUnused(control));
            if (!used) return false;
            used.click();
            for (let retry=0;retry<10;retry++) {
                await new Promise(resolve=>setTimeout(resolve,100));
                if (owner !== character) return false;
                if (wb20Resource(pool.name,owner)?.remaining === fresh.remaining+1) break;
            }
            if (wb20Resource(pool.name,owner)?.remaining !== fresh.remaining+1) return false;
        }
    }
    return wb20Resource(pool.name,owner)?.remaining === desired;
}

async function wb20SetResource(name, desired, {owner = character, reason = "Correction", expected} = {}) {
    let pool = wb20Resource(name,owner);
    if (!pool) {
        await wb20VisitResourceSheets(async()=>{if (!pool) pool=wb20Resource(name,owner);},owner);
        // Reopen the owning sheet before changing a native counter.
        if (["native","numeric","slot"].includes(pool?.kind)) pool=null;
    }
    const apply = async () => {
        const fresh = wb20Resource(name,owner);
        if (!fresh || owner !== character) return false;
        if (!Number.isInteger(desired) || desired < 0 || fresh.max !== null && desired > fresh.max) return false;
        if (expected !== undefined && fresh.remaining !== expected) return false;
        if (fresh.remaining === desired) return true;
        let changed = false;
        if (["native","numeric","slot"].includes(fresh.kind)) changed = await wb20SetNativeResource(fresh,desired,owner);
        else if (fresh.kind === "perTurn") {
            const store=wb20ResourceStore(owner),key=String(name).replace(/^turn-use:/,"");
            if (desired === 1) delete store.turns[key];else store.turns[key]=wayBeyond20AttackActivationTurnKey();
            await wb20ResourceSave(store,owner);changed=true;
        } else if (fresh.kind === "turn" || fresh.kind === "grant") {
            const original=wayBeyond20GetTurnTrackerState();
            const state={...original,featureGrants:Object.fromEntries(Object.entries(original.featureGrants || {}).map(([key,value])=>[key,{...value}]))};
            if (fresh.kind === "turn") state[name]=desired;
            else { const key=String(name).replace(/^grant:/,""); if (!state.featureGrants?.[key]) return false; state.featureGrants[key].remaining=desired; }
            wayBeyond20SetTurnTrackerState(state,wayBeyond20ScheduleActiveEffectBadgeRefresh); changed=true;
        } else {
            const store=wb20ResourceStore(owner); store.pools[wb20ResourceId(fresh.name)]={remaining:desired};
            await wb20ResourceSave(store,owner); changed=true;
        }
        if (changed) {
            const store=wb20ResourceStore(owner);
            store.history.push({at:Date.now(),name:fresh.name,before:fresh.remaining,after:desired,reason});
            store.history=store.history.slice(-30); await wb20ResourceSave(store,owner);
        }
        return changed;
    };
    if (pool && (pool.remaining !== null || pool.kind === "local")) return apply();
    let changed=false;
    await wb20VisitResourceSheets(async()=>{const found=wb20Resource(name,owner);if (!changed && found && found.remaining !== null) changed=await apply();},owner,
        /spell slots/i.test(name) ? ["Spells"] : ["Features & Traits","Actions"]);
    return changed;
}

async function wb20DispatchResources(args, intents, dispatch) {
    const owner=character, turn=wayBeyond20AttackActivationTurnKey();
    const declared=Object.prototype.hasOwnProperty.call(args,"waybeyond20-resource-costs");
    const costs=[...(args["waybeyond20-resource-costs"] || [])];
    if (!declared && wb20HasFeature(args.name,owner)) costs.push(...wb20ReadFeatureCosts(args.description,owner));
    delete args["waybeyond20-resource-costs"];
    const perTurn=args["waybeyond20-resource-per-turn"] || (!declared && wb20HasFeature(args.name,owner) && /\bonce per turn\b/i.test(args.description || '')
        ? wb20OwnedFeatures(owner).find(name=>wb20ResourceId(name) === wb20ResourceId(args.name)) : null), gains=args["waybeyond20-resource-gains"] || [];
    delete args["waybeyond20-resource-per-turn"]; delete args["waybeyond20-resource-gains"];
    const requests=[args["waybeyond20-turn-resource"],...(args["waybeyond20-turn-resources"] || [])].filter(Boolean);
    delete args["waybeyond20-turn-resource"]; delete args["waybeyond20-turn-resources"];
    if (intents.limitedUseRequest) costs.push({name:intents.limitedUseRequest.feature,amount:1});
    return wb20ResourceLocked(async()=>{
        if (owner !== character || turn !== wayBeyond20AttackActivationTurnKey()) return false;
        for (const request of requests) {
            if (request.actionType === "Attack" && request.resource === "action" && wayBeyond20AttacksRemainingInAttackAction()>0) continue;
            const state=wayBeyond20GetTurnTrackerState();
            const actionType=request.actionType || (/spell/.test(intents.rollType || '') || /\bmagic action\b/i.test(args.description || '') ? "Magic" : "Other");
            const extra=Object.entries(state.featureGrants || {}).find(([,grant])=>grant.turnKey === turn && grant.unit === request.resource && grant.remaining > 0 && !(grant.excludes || []).includes(actionType));
            if (state.inCombat && Number(state[request.resource]) === 0 && extra &&
                (request.resource === "reaction" || state.currentRoll20Turn?.isThisCharactersTurn !== false)) {request.grantId=extra[0];continue;}
            if (request.actionType === "Attack" && request.resource === "action" && state.action === 0 && state.hasteAction > 0) {
                request.resource="hasteAction"; request.actionType="Granted Attack";
            }
            if (!await wayBeyond20PreflightTurnResource(request.resource,{name:request.name || args.name})) return false;
        }
        if (perTurn && turn && wb20ResourceStore(owner).turns[perTurn] === turn &&
            !await wayBeyond20ConfirmChoice("Feature already used",`${perTurn} is already recorded this turn. Proceed anyway?`,"Proceed","Cancel")) return false;
        const combined=new Map();
        for (const cost of costs) {
            if (!Number.isInteger(cost.amount) || cost.amount < 0) return false;
            const id=wb20ResourceId(cost.name), previous=combined.get(id);
            combined.set(id,{name:cost.name,amount:cost.amount+(previous?.amount || 0)});
        }
        const charges=[];
        for (const cost of combined.values()) {
            if (!cost.amount) continue;
            let pool=wb20Resource(cost.name,owner);
            if (!pool || pool.remaining === null) await wb20VisitResourceSheets(async()=>{
                const found=wb20Resource(cost.name,owner); if (found?.remaining !== null && found) pool=found;
            },owner);
            if (!pool || pool.remaining === null || pool.remaining < cost.amount) {
                const proceed=await wayBeyond20ConfirmChoice("Check " + cost.name,
                    `${pool?.remaining === null || !pool ? "The current amount is unavailable" : "There is not enough remaining"}. Proceed without changing this resource? You can reconcile it in Correction.`,"Proceed","Cancel");
                if (!proceed) return false;
                continue;
            }
            charges.push({name:cost.name,before:pool.remaining,after:pool.remaining-cost.amount});
        }
        if (owner !== character || turn !== wayBeyond20AttackActivationTurnKey()) return false;
        const result=await dispatch();
        if (result !== true) return result;
        if (owner !== character || turn !== wayBeyond20AttackActivationTurnKey() || intents.isCurrent && !intents.isCurrent()) {
            alertify.warning("The action was performed while the character or turn changed. Check Correction before continuing."); return true;
        }
        const beforeTurn={...wayBeyond20GetTurnTrackerState()};
        for (const request of requests) {
            if (request.grantId) {
                const state={...wayBeyond20GetTurnTrackerState()},grant=state.featureGrants?.[request.grantId];
                if (grant?.remaining > 0) {
                    state.featureGrants={...state.featureGrants,[request.grantId]:{...grant,remaining:grant.remaining-1}};
                    if (request.actionType === "Attack") state.attacksRemaining=Math.max(0,wayBeyond20AttacksPerAttackAction()-1);
                    wayBeyond20SetTurnTrackerState(state,wayBeyond20ScheduleActiveEffectBadgeRefresh);
                }
            } else if (request.actionType === "Attack" && request.resource === "action") wayBeyond20SpendAttackAction({name:args.name});
            else wayBeyond20SpendTurnResource(request.resource,{name:args.name});
        }
        const afterTurn=wayBeyond20GetTurnTrackerState(),turnHistory=[];
        for (const id of ["action","bonusAction","reaction","hasteAction","attacksRemaining"]) {
            if (Number.isInteger(beforeTurn[id]) && beforeTurn[id] !== afterTurn[id])
                turnHistory.push({at:Date.now(),name:id,before:beforeTurn[id],after:afterTurn[id],reason:args.name || "Action use"});
        }
        if (turnHistory.length) {const store=wb20ResourceStore(owner);store.history=store.history.concat(turnHistory).slice(-30);await wb20ResourceSave(store,owner);}
        for (const charge of charges) {
            if (!await wb20SetResource(charge.name,charge.after,{owner,expected:charge.before,reason:args.name || "Feature use"}))
                alertify.warning(`${charge.name} could not be updated after the action. Check Correction; do not repeat the action to retry its charge.`);
        }
        if (owner !== character || turn !== wayBeyond20AttackActivationTurnKey()) {
            alertify.warning("The turn changed during resource updates. Check Correction for any remaining recovery or grants.");return true;
        }
        for (const gain of gains) {
            const pool=wb20Resource(gain.name,owner);
            const amount=gain.maximum ? pool?.max : gain.minimum !== undefined ? Math.max(pool?.remaining ?? 0,gain.minimum) : gain.remaining;
            if (Number.isInteger(amount) && !await wb20SetResource(gain.name,amount,{owner,reason:args.name || "Feature recovery"}))
                alertify.warning(`${gain.name} recovery could not be saved. Check Correction.`);
        }
        if (perTurn && turn) {const store=wb20ResourceStore(owner);store.turns[perTurn]=turn;await wb20ResourceSave(store,owner);}
        const grant=intents.rollType === "trait" && args["source-type"] === "action" ? wb20ReadActionGrant(args.description) : null;
        if (grant && wayBeyond20HasActiveCombatState(wayBeyond20GetTurnTrackerState())) {
            const state={...wayBeyond20GetTurnTrackerState()},id=wb20ResourceId(args.name)+":"+grant.unit,previous=state.featureGrants?.[id];
            state.featureGrants={...state.featureGrants,[id]:{...grant,name:`${args.name} ${grant.unit === "bonusAction" ? "Bonus Actions" : grant.unit === "reaction" ? "Reactions" : "Actions"}`,
                turnKey:turn,remaining:(previous?.turnKey === turn ? previous.remaining : 0)+grant.amount,max:(previous?.turnKey === turn ? previous.max : 0)+grant.amount}};
            wayBeyond20SetTurnTrackerState(state,wayBeyond20ScheduleActiveEffectBadgeRefresh);
        }
        return result;
    },owner);
}

function wb20RecordAttackGrant(activation) {
    if (!activation.source || activation.owner !== character || activation.turnKey !== wayBeyond20AttackActivationTurnKey()) return;
    const state={...wayBeyond20GetTurnTrackerState()};
    if (!wayBeyond20HasActiveCombatState(state)) return;
    state.featureGrants={...state.featureGrants,[wb20ResourceId(activation.source)]:{name:activation.source+" attacks",unit:"attack",turnKey:activation.turnKey,remaining:activation.remaining,max:activation.maximum,benefits:{...activation.benefits}}};
    wayBeyond20SetTurnTrackerState(state,wayBeyond20ScheduleActiveEffectBadgeRefresh);
}

async function wb20CorrectResources() {
    if (wb20CorrectionOpen) return;
    wb20CorrectionOpen=true;
    const owner=character, turn=wayBeyond20AttackActivationTurnKey(), pools=new Map();
    try {
        const collect=()=>{for (const [id,pool] of wb20Resources(owner)) if (pool.remaining !== null || !pools.has(id)) pools.set(id,{...pool});};
        collect(); await wb20VisitResourceSheets(collect,owner,["Features & Traits","Actions","Spells"]);
        if (owner !== character) return;
        const esc=value=>String(value ?? "").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
        const entries=[...pools].filter(([,pool])=>pool.remaining !== null || pool.kind === "local");
        const rows=entries.map(([id,pool],i)=>`<label>${esc(pool.name)} <input name="resource-${i}" type="number" min="0" ${pool.max === null ? '' : `max="${pool.max}"`} value="${pool.remaining ?? ''}" placeholder="Unknown" aria-label="${esc(pool.name)} remaining"><span>${pool.max === null ? '' : '/ '+pool.max}</span></label>`).join("");
        const history=wb20ResourceStore(owner).history.slice().reverse().map(entry=>`<li>${esc(new Date(entry.at).toLocaleTimeString())} · ${esc(entry.name)}: ${entry.before ?? '?'} → ${entry.after} · ${esc(entry.reason)}</li>`).join("");
        const form=await dndbeyondDiceRoller._prompter.prompt("Correction",`<form class="wb20-resource-correction"><p>Remaining resources. Only changed values will be saved.</p>${rows || '<p>No feature resources are currently exposed on this sheet.</p>'}<details><summary>Recent resource history · local only</summary><ol>${history || '<li>No recorded changes.</li>'}</ol></details></form>`,"Save corrections","Cancel");
        if (!form || owner !== character || turn !== wayBeyond20AttackActivationTurnKey()) return;
        const updates=[];
        for (let i=0;i<entries.length;i++) {
            const raw=String(form.find(`[name="resource-${i}"]`).val()).trim(), value=raw === '' ? null : Number(raw), [id,pool]=entries[i];
            if (value === pool.remaining) continue;
            if (!Number.isInteger(value) || value < 0 || pool.max !== null && value > pool.max) {alertify.warning("Enter valid remaining amounts. Nothing was changed.");return;}
            updates.push({id,pool,value});
        }
        await wb20ResourceLocked(async()=>{
            for (const {id,pool,value} of updates) {
                if (owner !== character || turn !== wayBeyond20AttackActivationTurnKey()) return;
                if (!await wb20SetResource(id,value,{owner,expected:pool.remaining})) alertify.warning(`${pool.name} changed or could not be saved. Reopen Correction to check it.`);
            }
        },owner);
    } finally {wb20CorrectionOpen=false;}
}

async function wb20ResourcesRest(owner,rest) {
    return wb20ResourceLocked(async()=>{
        // DDB restores native counters itself. Never click them a second time.
        const store=wb20ResourceStore(owner); store.turns={};
        for (const [id,pool] of wb20ResourceDefinitions.get(owner) || []) {
            if (pool.kind === "local" && (rest === "long" || rest === "short" && pool.reset === "short")) store.pools[id]={remaining:pool.max};
        }
        await wb20ResourceSave(store,owner);
    },owner);
}

function wb20ThemeResourcePrompt(dialog) {
    if (!dialog || typeof wayBeyond20ApplySheetTheme !== "function") return;
    wayBeyond20ApplySheetTheme(dialog);
    dialog.classList.add("wb20-resource-dialog");
}

function wb20FeatureAttackCount() {
    let count=1;
    for (const rule of typeof wayBeyond20LiveFeatureRules === "function" ? wayBeyond20LiveFeatureRules() : []) {
        if (!/\battack action\b/i.test(rule.text)) continue;
        const match=rule.text.match(/\battack\s+(twice|three times|four times|\d+ times)\b/i);
        if (match) count=Math.max(count,({twice:2,"three times":3,"four times":4})[match[1].toLowerCase()] || parseInt(match[1]) || 1);
    }
    for (const [name,value] of [["Extra Attack",2],["Two Extra Attacks",3],["Three Extra Attacks",4]]) if (wb20HasFeature(name)) count=Math.max(count,value);
    return count;
}

function wb20ReadActionGrant(text) {
    const rule=String(text || '').replace(/\s+/g,' ');
    const match=rule.match(/\b(?:you (?:can )?take|you gain|gain)\s+(an?|one|two|\d+)\s+(?:additional|extra)\s+(bonus action|reaction|action)\b/i);
    if (!match) return null;
    const amount=({a:1,an:1,one:1,two:2})[match[1].toLowerCase()] || Number(match[1]);
    // Keep restricted currency separate. Uninterpreted restrictions must not be
    // silently converted into an unrestricted ordinary Action.
    const clause=rule.slice(match.index).split(/[.;]/)[0];
    const exception=clause.match(/\bexcept\s+(?:for\s+)?(?:the\s+)?Magic action\b/i);
    if (/\b(?:only|except|restricted)\b/i.test(clause.replace(exception?.[0] || '\u0000',''))) return null;
    return Number.isInteger(amount) && amount > 0 ? {unit:({"bonus action":"bonusAction",reaction:"reaction",action:"action"})[match[2].toLowerCase()],amount,excludes:exception ? ["Magic"] : []} : null;
}

function wb20ReadFeatureCosts(text,owner = character) {
    const costs=[];
    for (const pool of wb20Resources(owner).values()) {
        if (["turn","grant","perTurn","slot"].includes(pool.kind)) continue;
        const words=wb20ResourceId(pool.name).split(' ').map(word=>word.replace(/s$/,'')+'s?').join('\\s+');
        const pattern=new RegExp('\\b(?:expend|spend|costs?)\\s+(\\d+)\\s+(?:of\\s+your\\s+)?'+words+'\\b','ig');
        const amounts=new Set([...String(text || '').matchAll(pattern)].map(match=>Number(match[1])));
        // Alternatives with different costs need a feature choice, not a guess.
        if (amounts.size === 1) costs.push({name:pool.name,amount:[...amounts][0]});
    }
    return costs;
}
