var settings = getDefaultSettings();
var extension_url = "/modules/beyond20/";
var fvttVersion = game.version || game.data?.version;
//isNewerVersion is deprecated in Foundry 12
const fvtt_isNewer = window.foundry && foundry.utils && foundry.utils.isNewerVersion ? (v1, v0) => foundry.utils.isNewerVersion(v1, v0) : isNewerVersion;
// getProperty is deprecated in Foundry 13
const fvtt_getProperty = window.foundry && foundry.utils && foundry.utils.getProperty ? (obj, path) => foundry.utils.getProperty(obj, path) : getProperty;
// Die and PoolTerm moved under foundry.dice.terms in Foundry 13
const fvtt_Die = window.foundry && foundry.dice?.terms?.Die ? foundry.dice.terms.Die : Die;
const fvtt_PoolTerm = window.foundry && foundry.dice?.terms?.PoolTerm ? foundry.dice.terms.PoolTerm : PoolTerm;
// v10 uses .document for Placeables (tokens), or the Base object itself, instead of .data field
// We use the new fields to avoid spamming the log with deprecation warnings
const docData = (doc) => fvtt_isNewer(fvttVersion, "10") ? doc.document || doc : doc.data;
// Determine ownership of a Foundry document without triggering deprecated getters
const docIsOwner = (doc) => {
    if (doc && 'isOwner' in doc) return doc.isOwner;
    return doc?.owner;
};

// Foundry 14 replaced the core "rollMode" setting (now null) with "messageMode".
function wayBeyond20FvttCurrentRollMode() {
    const publicRoll = (CONST.DICE_ROLL_MODES && CONST.DICE_ROLL_MODES.PUBLIC) || "roll";
    let legacy = null;
    try { legacy = game.settings.get("core", "rollMode"); } catch (err) { legacy = null; }
    if (legacy) return legacy;
    let mode = null;
    try { mode = game.settings.get("core", "messageMode"); } catch (err) { mode = null; }
    return { gm: "gmroll", blind: "blindroll", self: "selfroll" }[mode] || publicRoll;
}

// Foundry 14 deprecates the rollMode creation option in favour of messageMode.
function wayBeyond20FvttMessageOptions(rollMode) {
    if (!fvtt_isNewer(fvttVersion, "14")) return { rollMode };
    const messageMode = { roll: "public", publicroll: "public", gmroll: "gm", blindroll: "blind", selfroll: "self" }[rollMode];
    return messageMode ? { messageMode } : {};
}

class FVTTDisplayer {
    postHTML(request, title, html, character, whisper, play_sound, source, attributes, description, attack_rolls, roll_info, damage_rolls, total_damages, open) {
        const hookName = fvtt_isNewer(fvttVersion, "13") ? 'renderChatMessageHTML' : 'renderChatMessage';
        Hooks.once(hookName, (chat_message, html, data) => {
            if (!(html instanceof jQuery)) html = $(html);
            const icon = extension_url + "images/icons/badges/custom20.png";
            html.find(".ct-beyond20-custom-icon").attr('src', icon);
            html.find(".ct-beyond20-custom-roll").on('click', (event) => {
                const roll = $(event.currentTarget).find(".beyond20-roll-formula").text();
                roll_renderer.rollDice(request, title, roll);
            });
            html.find(".beyond20-button-roll-damages").on('click', (event) => {
                request.rollAttack = false;
                request.rollDamage = true;
                request.rollCritical = attack_rolls.some(r => !r.discarded && r["critical-success"])
                roll_renderer.handleRollRequest(request)
            });
        });
        const posted = this._postChatMessage(html, character, whisper, play_sound, attack_rolls, damage_rolls);
        wayBeyond20FvttResolvedDamage(request, damage_rolls);
        return posted;
    }

    _postChatMessage(message, character, whisper, play_sound = false, attack_rolls, damage_rolls) {
        const MESSAGE_STYLES = CONST.CHAT_MESSAGE_STYLES || CONST.CHAT_MESSAGE_TYPES || CHAT_MESSAGE_STYLES || CHAT_MESSAGE_TYPES;
        const styleProp = fvtt_isNewer(fvttVersion, "13") ? "style" : "type";
        const data = {
            "content": message,
            "user": game.user?.id || game.user?._id,
            "speaker": this._getSpeakerByName(character)
        }
        const rollMode = this._whisperToRollMode(whisper);
        if (["gmroll", "blindroll"].includes(rollMode)) {
            data["whisper"] = (ChatMessage.getWhisperRecipients || ChatMessage.getWhisperIDs).call(ChatMessage, "GM");
            data[styleProp] = MESSAGE_STYLES.WHISPER;
            if (rollMode == "blindroll")
                data["blind"] = true;
        } else if (rollMode == "selfroll") {
            data["whisper"] = [game.user?.id || game.user?._id];
            data[styleProp] = MESSAGE_STYLES.WHISPER;
        } else {
            data[styleProp] = MESSAGE_STYLES.OOC;
        }
        if (play_sound)
            data["sound"] = CONFIG.sounds.dice;
        // If there are attack roll(s) or damage_roll(s)
        // Build a dicePool, attach it to a Roll, then attach it to the ChatMessage
        // Then set ChatMessage type to "ROLL"
        if (attack_rolls.length > 0 || damage_rolls.length > 0) {
            const rolls = [...attack_rolls, ...damage_rolls.map(d => d[1]).filter(r => !!r && typeof(r) !== "string")];
            // Transforms DNDBRolls -> FVTTRolls
            const fvttRolls = rolls.map(r => {
                if (r instanceof FVTTRoll) { return r._roll; }
                const dice = [];
                const result = []
                const parts = [];
                r.class = "Roll";
                if (fvtt_isNewer(fvttVersion, "0.8")) {
                    // Foundry 0.8.x API
                    r.parts.forEach(p => {
                        let term;
                        if (p.formula) {
                            term = {
                                class: "Die",
                                evaluated: true,
                                expression: p.formula,
                                options: {},
                                number: p.amount,
                                faces: p.faces,
                                modifiers: [],
                                results: p.rolls.map(roll => ({active: !roll.discarded, result: roll.roll}))
                            };
                        } else {
                            const numeric = parseFloat(p);
                            term = {
                                class: isNaN(numeric) ? "OperatorTerm" : "NumericTerm",
                                evaluated: true,
                                expression: isNaN(numeric) ? p : numeric,
                                operator: isNaN(numeric) ? p : undefined,
                                number: isNaN(numeric) ? undefined : numeric,
                                options: {}
                            };
                        }
                        if (term.class !== "OperatorTerm" &&
                            parts.length > 0 && parts[parts.length - 1].class !== "OperatorTerm") {
                            parts.push({
                                class: "OperatorTerm",
                                evaluated: true,
                                expression: "+",
                                operator: "+",
                                options: {}
                            });
                        }
                        parts.push(term);
                    });
                    r.parts = undefined;
                    r.terms = parts;
                } else if (fvtt_isNewer(fvttVersion, "0.7")) {
                    r.parts.forEach(p => {
                        if (parts.length > 0 && !["+", "-"].includes(parts[parts.length - 1])) parts.push("+");
                        if (p.formula) {
                            result.push(p.total)
                            parts.push({
                                class: "Die",
                                options: {},
                                number: p.amount,
                                faces: p.faces,
                                modifiers: [],
                                results: p.rolls.map(roll => ({active: !roll.discarded, result: roll.roll}))
                            });
                        } else {
                            parts.push(p)
                            result.push(p)
                        }
                    })
                    r.dice = [];
                    r.terms = parts;
                    r.parts = undefined;
                    r.result = result.join(" + ")
                } else {
                    r.parts.forEach(p => {
                        if (parts.length > 0) parts.push("+");
                        if (p.formula) {
                            const idx = dice.length;
                            p.class = "Die";
                            dice.push(p)
                            result.push(p.total)
                            parts.push(`_d${idx}`);
                        } else {
                            parts.push(p)
                            result.push(p)
                        }
                    })
                    r.dice = dice;
                    r.parts = parts;
                    r.result = result.join(" + ")
                }
                return Roll.fromData(r)
            });
            if (fvtt_isNewer(fvttVersion, "10")) {
                data.rolls = fvttRolls;
            } else if (fvtt_isNewer(fvttVersion, "0.8")) {
                // Foundry 0.8.x API
                // This will accept backware compatible fvttRolls format
                const pool = fvtt_PoolTerm.fromRolls(fvttRolls);
                data.roll = Roll.fromTerms([pool]);
            } else if (fvtt_isNewer(fvttVersion, "0.7")) {
                // Foundry 0.7.x API
                // This will accept backware compatible fvttRolls format
                const pool = new DicePool({rolls: fvttRolls}).evaluate();
                const pool_roll = Roll.create(pool.formula);
                pool_roll.terms = [pool];
                pool_roll.results = [pool.total];
                pool_roll._total = pool.total;
                pool_roll._rolled = true;
                data.roll = pool_roll;
            } else {
                // Foundry 0.6.x API
                const pool = new DicePool(fvttRolls).roll();
                const formulas = pool.dice.map(d => d.formula);
                const pool_roll = new Roll(`{${formulas.join(",")}}`);
                pool_roll._result = [pool.total];
                pool_roll._total = pool.total;
                pool_roll._dice = pool.dice;
                pool_roll.parts = [pool];
                pool_roll._rolled = true;
                data.roll = pool_roll;
            }
            if (!fvtt_isNewer(fvttVersion, "13")) {
                data[styleProp] = MESSAGE_STYLES.ROLL;
            }
        }
        return ChatMessage.create(data, wayBeyond20FvttMessageOptions(rollMode));
    }

    _getSpeakerByName(name) {
        if (name === null)
            return ChatMessage.getSpeaker();
        const actors = game.actors?.contents || game.actors?.entities || game.actors; // v13 compatibility
        const actor = actors.find((actor) => docData(actor).name.toLowerCase() == name.toLowerCase());
        const speaker = ChatMessage.getSpeaker({ actor });
        speaker.alias = name;
        return speaker;
    }

    _whisperToRollMode(whisper) {
        // An explicit public mode: Foundry 14 maps the legacy "roll" to the user's current chat mode.
        const publicRoll = (CONST.DICE_ROLL_MODES && CONST.DICE_ROLL_MODES.PUBLIC) || "roll";
        try {
            return {
                [WhisperType.NO]: publicRoll,
                [WhisperType.HIDE_NAMES]: publicRoll,
                [WhisperType.YES]: "gmroll",
                [WhisperType.QUERY]: wayBeyond20FvttCurrentRollMode()
            }[whisper];
        } catch (err) {
            return wayBeyond20FvttCurrentRollMode();
        }
    }

    displayError(message) {
        ui.notifications.error(message);
    }
}

class FVTTRoll extends Beyond20BaseRoll {
    constructor(formula, data = {}) {
        super(formula, data);
        this._roll = new Roll(this._formula, data)
    }

    get total() {
        return this._roll.total;
    }

    get formula() {
        return this.cleanupFormula(this._roll.formula);
    }

    get dice() {
        // 0.7.x Dice Roll API is different
        if (fvtt_isNewer(fvttVersion, "0.7")) {
            return this._roll.dice.map(d => {
                return {
                    amount: d.amount || d.number,
                    faces: d.faces,
                    formula: d.formula,
                    total: d.total,
                    rolls: d.results.map(r => ({discarded: r.discarded || r.rerolled, roll: r.result}))
                }
            });
        } else {
            return this._roll.dice;
        }
    }

    get parts() {
        // 0.7.x Dice Roll API is different
        if (fvtt_isNewer(fvttVersion, "0.8")) {
            return this._roll.terms.map(t => {
                if (t instanceof fvtt_Die) {
                    return {
                        amount: t.amount || t.number,
                        faces: t.faces,
                        formula: t.formula,
                        total: t.total,
                        rolls: t.results.map(r => ({discarded: r.discarded || r.rerolled, roll: r.result}))
                    }
                } else if (t instanceof fvtt_PoolTerm) {
                    const dice = t.rolls[0]?.dice[0];
                    // A DicePool means a "minX", so don't include it in the roll results
                    const results = t.results.slice(0, t.results.length - 1);
                    return {
                        amount: dice ? dice.amount || dice.number : 0,
                        faces: dice ? dice.faces : 0,
                        formula: t.formula,
                        total: t.total,
                        rolls: results.map(r => ({discarded: r.discarded || r.rerolled, roll: r.result})),
                        modifiers: t.modifiers.join("")
                    }
                } else {
                    return t.expression;
                }
            });
        } else if (fvtt_isNewer(fvttVersion, "0.7")) {
            return this._roll.terms.map(t => {
                if (t instanceof fvtt_Die) {
                    return {
                        amount: t.amount || t.number,
                        faces: t.faces,
                        formula: t.formula,
                        total: t.total,
                        rolls: t.results.map(r => ({discarded: r.discarded || r.rerolled, roll: r.result}))
                    }
                } else if (t instanceof DicePool) {
                    const dice = t.rolls[0]?.dice[0];
                    // A DicePool means a "minX", so don't include it in the roll results
                    const results = t.results.slice(0, t.results.length - 1);
                    return {
                        amount: dice ? dice.amount || dice.number : 0,
                        faces: dice ? dice.faces : 0,
                        formula: t.formula,
                        total: t.total,
                        rolls: results.map(r => ({discarded: r.discarded || r.rerolled, roll: r.result})),
                        modifiers: t.modifiers.join("")
                    }
                } else {
                    return String(t);
                }
            });
        } else {
            return this._roll.parts;
        }
    }

    cleanupFormula(formula) {
        formula = formula.replace(/ro(=|<|<=|>|>=)([0-9]+)/g, "r$1$2");
        formula = formula.replace(/(^|\s)+(\d*d\d+)([^\s+\-]*?)min(\d+)([^\s+\-]*)/g, "$1{$2$3$5, $4}kh1");
        return super.cleanupFormula(formula);
    }


    async getTooltip() {
        const tooltip = await this._roll.getTooltip();
        // Automatically expand the roll details in the tooltip
        return tooltip.replace(/<div class="dice-tooltip">/g, `<div class="dice-tooltip" style="display: block;">`)
    }

    async roll() {
        if (typeof this._roll.evaluate === "function") {
            await this._roll.evaluate();
        } else {
            await this._roll.roll();
        }
        return this;
    }

    async reroll() {
        if (typeof this._roll.reroll === "function") {
            this._roll = await this._roll.reroll();
        } else if (typeof this._roll.evaluate === "function") {
            await this._roll.evaluate();
        }
        return this;
    }
}

class FVTTRoller {
    roll(formula, data) {
        return new FVTTRoll(formula, data);
    }
    async resolveRolls(name, rolls) {
        return Promise.all(rolls.map(roll => roll.roll()))
    }
}


class FVTTPrompter {
    prompt(title, html, ok_label = "OK", cancel_label = "Cancel") {
        return new Promise((resolve, reject) => {
            const icon = `<img style="border: 0px;" src="${extension_url}images/icons/icon20.png"></img>`;
            let ok_pressed = false;
            new Dialog({
                "title": title,
                "content": html,
                "buttons": {
                    "ok": {
                        "label": ok_label,
                        "icon": icon,
                        "callback": () => ok_pressed = true
                    },
                    "cancel": { "label": cancel_label }
                },
                "default": "ok",
                "close": (html) => resolve(ok_pressed ? html : null)
            }).render(true);
        });
    }
}

var roll_renderer = new Beyond20RollRenderer(new FVTTRoller(), new FVTTPrompter(), new FVTTDisplayer());
roll_renderer.setBaseURL(extension_url);
roll_renderer.setSettings(settings);

function rollInitiative(request, custom_roll_dice = "") {
    roll_renderer.handleRollRequest(request).then((roll) => {
        if (roll && settings["initiative-tracker"])
            addInitiativeToCombat(roll, request);
    });
}

function popAvatar(request, sendToDiscord=true) {
    const popout = fvtt_isNewer(fvttVersion, "13") ? 
        new foundry.applications.apps.ImagePopout({
            "src": request.character.avatar,
            "shareable": false,
            "window": {"title": (request.whisper !== WhisperType.NO) ? settings["hidden-monster-replacement"] : request.character.name},
            "entity": { "type": "User", "id": game.user.id }
        }) :
        new ImagePopout(request.character.avatar, {
            "shareable": false,
            "title": (request.whisper !== WhisperType.NO) ? settings["hidden-monster-replacement"] : request.character.name,
            "entity": { "type": "User", "id": game.user.id }
        });
    popout.render(true)
    popout.shareImage(true);
    if (sendToDiscord) {
        roll_renderer.displayAvatarToDiscord(request);
    }
}

async function addInitiativeToCombat(roll, request = null) {
    if (canvas.tokens.controlled.length > 0) {
        if (game.combat) {
            // Known Issue game.combat.scene are not longer set so you can add combatants from other scenes by mistake
            if (!fvtt_isNewer(fvttVersion, "13") && (game.combat.scene?.id != canvas.scene.id)) {
                ui.notifications.warn("Cannot add initiative to tracker: Encounter was not created for this scene");
            } else {
                const controlled = [...canvas.tokens.controlled];
                for (let token of controlled) {
                    const combatant = game.combat.getCombatantByToken(token.id);
                    if (fvtt_isNewer(fvttVersion, "9")) {
                        if (combatant) {
                            await game.combat.updateEmbeddedDocuments("Combatant", [{ "_id": docData(combatant)._id, "initiative": roll.total }]);
                        } else {
                            await game.combat.createEmbeddedDocuments("Combatant", [{ "tokenId": token.id, "hidden": docData(token).hidden, "initiative": roll.total, "actorId": token.actor?.id, "sceneId": token.scene?.id, "img": token.actor?.img }]);
                        }
                    } else {
                        if (combatant) {
                            const idField = combatant._id ? "_id" : "id";
                            await game.combat.updateCombatant({ [idField]: combatant[idField], "initiative": roll.total });
                        } else {
                            await game.combat.createCombatant({ "tokenId": token.id, "hidden": docData(token).hidden, "initiative": roll.total });
                        }
                    }
                }
                wayBeyond20FvttBindTokens(request?.character?.name, controlled, "initiative");
            }
        } else {
            ui.notifications.warn("Cannot add initiative to tracker: no Encounter has been created yet");
        }
    } else {
        ui.notifications.warn("Cannot add initiative to tracker: no token is currently selected");
    }
}


function handleRoll(request) {
    console.log("Received roll request ", request);

    // The hook would return "false" to stop propagation, meaning that it was handled
    const handledNatively = Hooks.call("beyond20Request", request.action, request);
    if (handledNatively === false) return;

    if (request.type == "initiative")
        rollInitiative(request);
    else if (request.type == "avatar")
        popAvatar(request);
    else
        roll_renderer.handleRollRequest(request);
}
function handleRenderedRoll(request) {
    console.log("Received rendered roll request ", request);
    // The hook would return "false" to stop propagation, meaning that it was handled
    const handledNatively = Hooks.call("beyond20Request", request.action, request);
    if (handledNatively === false) return;
    if (request.request.type == "avatar") {
        return popAvatar(request.request, false);
    }

    roll_renderer._displayer.postHTML(request.request, request.title,
        request.html, request.character, request.whisper,
        request.play_sound, request.source, request.attributes,
        request.description, request.attack_rolls, request.roll_info,
        request.damage_rolls, request.total_damages, request.open);
    if (request.request.type === "initiative" && settings["initiative-tracker"]) {
        const initiative = request.attack_rolls.find((roll) => !roll.discarded);
        if (initiative)
            addInitiativeToCombat(initiative, request.request);
    }
}

function updateHP(name, current, total, temp) {
    console.log(`Updating HP for ${name} : (${current} + ${temp})/${total}`);
    name = name.toLowerCase().trim();

    const tokens = canvas.tokens.placeables.filter((t) => docIsOwner(t) && t.name.toLowerCase().trim() == name);

    const prefix = fvtt_isNewer(fvttVersion, "10") ? "system": "data";
    const dnd5e_data = {
        [`${prefix}.attributes.hp.value`]: current,
        [`${prefix}.attributes.hp.temp`]: temp,
        [`${prefix}.attributes.hp.max`]: total
    }
    const sws_data = {
        [`${prefix}.health.value`]: current + temp,
        [`${prefix}.health.max`]: total
    }
    if (tokens.length == 0) {
        const actors = game.actors?.contents || game.actors?.entities || game.actors; // v13 compatibility
        const actor = actors.find((a) => docIsOwner(a) && a.name.toLowerCase().trim() == name);
        const systemData = fvtt_isNewer(fvttVersion, "10") ? actor?.system : actor?.data?.data;
        if (actor && fvtt_getProperty(systemData, "attributes.hp") !== undefined) {
            actor.update(dnd5e_data);
        } else if (actor && fvtt_getProperty(systemData, "health") !== undefined) {
            actor.update(sws_data);
        }
    }

    for (let token of tokens) {
        const systemData = fvtt_isNewer(fvttVersion, "10") ? token.actor?.system : token.actor?.data?.data;
        if (token.actor && fvtt_getProperty(systemData, "attributes.hp") !== undefined) {
            token.actor.update(dnd5e_data);
        } else if (token.actor && fvtt_getProperty(systemData, "health") !== undefined) {
            token.actor.update(sws_data);
        }
    }
}


function updateConditions(request, name, conditions, exhaustion) {
    console.log("Updating Conditions for " + name + " : ", conditions, " - exhaustion level : ", exhaustion);
    let display_conditions = conditions;
    if (exhaustion > 0)
        display_conditions = conditions.concat(["Exhausted (Level " + exhaustion + ")"]);
    const message = name + (display_conditions.length == 0 ? " has no active condition" : " is : " + display_conditions.join(", "));
    const MESSAGE_STYLES = CONST.CHAT_MESSAGE_STYLES || CONST.CHAT_MESSAGE_TYPES || CHAT_MESSAGE_STYLES || CHAT_MESSAGE_TYPES;
    const styleProp = fvtt_isNewer(fvttVersion, "13") ? "style" : "type";
    ChatMessage.create({
        "content": message,
        "user": game.user?.id || game.user?._id,
        "speaker": roll_renderer._displayer._getSpeakerByName(name),
        [styleProp]: MESSAGE_STYLES.EMOTE
    });

    // Check for the beyond20 module, if (it's there, we can use its status effects.;
    const module = game.modules.get("beyond20");
    if (module && fvtt_isNewer(module.version || module.data.version, "0.6")) {
        // Update status effects;
        name = name.toLowerCase().trim();

        const tokens = canvas.tokens.placeables.filter((t) => docData(t).name.toLowerCase().trim() === name);
        // look for an actor with the character name and search for a linked token to that actor
        const actors = game.actors?.contents || game.actors?.entities || game.actors; // v13 compatibility
        const actor = actors.find((a) => docIsOwner(a) && a.name.toLowerCase().trim() === name);
        if (actor) {
            const linkedTokens = canvas.tokens.placeables.filter((t) => t.actor && t.actor.id === actor.id);
            // Only add linked tokens that do not name match to avoid duplicate operations
            tokens.push(...linkedTokens.filter((t) => docData(t).name.toLowerCase().trim() !== name));
        }

        const updates = [];
        for (let token of tokens) {
            const effects = docData(token).effects;
            let new_effects = [];

            let new_conditions = conditions.map((c) => c.toLowerCase() + ".svg");
            let defeated = false;
            if (exhaustion > 0) {
                if (exhaustion == 6) {
                    defeated = true;
                } else {
                    new_conditions.push("exhaustion" + exhaustion + ".svg");
                }
            }

            // Remove status effects that have disappeared;
            for (let effect of effects) {
                if (!effect.startsWith("modules/beyond20/conditions/")) {
                    new_effects.push(effect);
                } else {
                    const effect_name = effect.slice(34);
                    if (new_conditions.includes(effect_name)) {
                        new_effects.push(effect);
                        new_conditions = new_conditions.filter((c) => c != effect_name);
                    }
                }
            }
            console.log("From ", effects, "to ", new_effects, " still need to add ", new_conditions);
            new_effects = new_effects.concat(new_conditions.map((c) => "modules/beyond20/conditions/" + c));
            const data = { "_id": docData(token)._id, "effects": new_effects };
            if (defeated) {
                data["overlayEffect"] = "icons/svg/skull.svg";
            }
            updates.push(data);
        }
        if (updates.length > 0) {
            canvas.scene.updateEmbeddedDocuments("Token", updates);
        }
    }
}



// DDB owns visible effect badges. Consume passive bookkeeping quietly; do not
// post chat or write native actor effects without an executable target plan.
function updateEffects(request, name, effects, concentration) {
    return;
}

// ---- WayBeyond20 Foundry return path --------------------------------------
// Foundry combat, token and resolved-damage observations go back to D&D Beyond
// through the same envelopes the Roll20 adapter uses (waybeyond20-turn-update,
// waybeyond20-token-binding, waybeyond20-damage-result), tagged source "Foundry".
// Everything here is read-only towards the world: no document is created or updated.
// Updates are driven by Foundry hooks and coalesced; nothing polls.

const WB20_FVTT_ROLL20_UNITS_PER_GRID = 70; // the D&D Beyond distance reader expects Roll20 map units

function wayBeyond20FvttSend(message) {
    sendCustomEvent("SendMessage", [{ ...message, source: "Foundry" }]);
}

function wayBeyond20FvttIsGM() {
    return !!(game.user && game.user.isGM);
}

function wayBeyond20FvttSceneGrid(scene) {
    if (!scene) return null;
    const grid = scene.grid;
    if (grid && typeof grid === "object")
        return { size: Number(grid.size), distance: Number(grid.distance), units: String(grid.units || "") };
    // Foundry 9 and older keep the grid on scene.data
    const data = scene.data || {};
    return { size: Number(data.grid), distance: Number(data.gridDistance), units: String(data.gridUnits || "") };
}

function wayBeyond20FvttCombatantToken(combatant) {
    if (combatant.token) return combatant.token.document || combatant.token;
    const tokenId = docData(combatant).tokenId || combatant.tokenId;
    const sceneId = docData(combatant).sceneId || combatant.sceneId;
    const scene = sceneId && game.scenes ? game.scenes.get(sceneId) : canvas?.scene;
    const tokens = scene && (scene.tokens || scene.data?.tokens);
    return tokenId && tokens && typeof tokens.get === "function" ? tokens.get(tokenId) : null;
}

function wayBeyond20FvttTokenPosition(token, diagnostic = {}) {
    const unavailable = reason => { diagnostic.reason = reason; return null; };
    try {
        if (!token) return unavailable("Token is not on a loaded scene");
        // Foundry 14 keeps x/y at the pre-move position until the move animation finishes,
        // which never happens in a background tab. The saved source is authoritative.
        const data = token._source || docData(token);
        if (data.hidden) return unavailable("Token is hidden");
        const scene = token.parent || token.scene || null;
        if (!scene || !scene.id) return unavailable("Scene identity has not loaded");
        const grid = wayBeyond20FvttSceneGrid(scene);
        const number = v => v !== null && v !== undefined && v !== "" && Number.isFinite(Number(v));
        if (!grid || !number(grid.size) || grid.size <= 0) return unavailable("Scene grid size is unavailable");
        if (!number(grid.distance) || grid.distance <= 0) return unavailable("Scene distance scale is unavailable");
        if (!number(data.x) || !number(data.y)) return unavailable("Token coordinates have not loaded");
        const width = number(data.width) ? Number(data.width) : 1;
        const height = number(data.height) ? Number(data.height) : 1;
        // Token x/y is the top-left corner in pixels; width/height are grid squares.
        const centerX = Number(data.x) + width * grid.size / 2;
        const centerY = Number(data.y) + height * grid.size / 2;
        const toUnits = px => px / grid.size * WB20_FVTT_ROLL20_UNITS_PER_GRID;
        return { pageId: String(scene.id), x: toUnits(centerX), y: toUnits(centerY),
            scale: grid.distance, units: grid.units || "units", system: "fvtt" };
    } catch (err) {
        return unavailable("Foundry token position could not be read");
    }
}

function wayBeyond20FvttCombatantKey(combatant) {
    const data = docData(combatant);
    const tokenId = data.tokenId || combatant.tokenId;
    return String(tokenId || combatant.id || data._id || "");
}

function wayBeyond20FvttReadTargets(combat) {
    const isGM = wayBeyond20FvttIsGM();
    const targets = [];
    const seen = new Set();
    for (const combatant of combat.turns || []) {
        const data = docData(combatant);
        // Players never learn hidden combatants from WayBeyond20.
        if (data.hidden && !isGM) continue;
        const key = wayBeyond20FvttCombatantKey(combatant);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        const token = wayBeyond20FvttCombatantToken(combatant);
        const tokenName = token ? String(docData(token).name || "") : "";
        const custom = String(combatant.name || data.name || "");
        const name = (tokenName || custom).replace(/\s+/g, " ").trim();
        if (!name) continue;
        const diagnostic = {};
        const position = data.hidden ? null : wayBeyond20FvttTokenPosition(token, diagnostic);
        targets.push({
            key, tokenId: key, name, tokenName, custom,
            initiative: data.initiative !== undefined && data.initiative !== null ? String(data.initiative) : "",
            pageId: position ? position.pageId : String(data.sceneId || ""),
            relation: "unknown",
            position,
            positionStatus: data.hidden ? "Combatant is hidden" : (diagnostic.reason || "")
        });
    }
    return targets;
}

// null means "not known yet"; it must never be reported as a finished battle.
function wayBeyond20FvttReadCurrentTurn() {
    try {
        if (typeof game === "undefined" || !game || !game.ready) return null;
        const combat = game.combat;
        if (!combat) return { active: false, targets: [] };
        const combatData = docData(combat);
        const round = Number(combatData.round ?? combat.round ?? 0);
        const started = combat.started !== undefined ? !!combat.started : round > 0;
        if (!started) return { active: false, targets: [] };
        const current = combat.combatant;
        if (!current) return null;
        const data = docData(current);
        const hidden = !!data.hidden && !wayBeyond20FvttIsGM();
        const key = wayBeyond20FvttCombatantKey(current);
        const token = hidden ? null : wayBeyond20FvttCombatantToken(current);
        const turn = Number(combatData.turn ?? combat.turn ?? 0);
        return {
            active: true,
            // A hidden combatant's turn still has to move the turn away from the player.
            tokenId: hidden ? `hidden:${current.id || data._id || turn}` : key,
            custom: hidden ? "" : String(current.name || data.name || ""),
            pr: !hidden && data.initiative !== undefined && data.initiative !== null ? String(data.initiative) : "",
            pageId: String(data.sceneId || combatData.scene || ""),
            tokenName: token ? String(docData(token).name || "") : "",
            turnKey: [combat.id || combatData._id || "", round, turn, current.id || data._id || ""].join("|"),
            targets: wayBeyond20FvttReadTargets(combat)
        };
    } catch (err) {
        console.warn("WayBeyond20: Unable to read Foundry combat", err);
        return null;
    }
}

let wayBeyond20FvttLastTurnKey = "";
let wayBeyond20FvttTurnTimer = 0;
const wayBeyond20FvttHookIds = [];

function wayBeyond20FvttPublishTurn() {
    wayBeyond20FvttTurnTimer = 0;
    const current = wayBeyond20FvttReadCurrentTurn();
    if (!current) return;
    if (current.active === false) {
        if (wayBeyond20FvttLastTurnKey === "inactive") return;
        wayBeyond20FvttLastTurnKey = "inactive";
        wayBeyond20FvttSend({ action: "waybeyond20-turn-update", current });
        return;
    }
    // Token movement refreshes target positions without being a new turn.
    const key = JSON.stringify([current.turnKey, current.targets]);
    if (key === wayBeyond20FvttLastTurnKey) return;
    wayBeyond20FvttLastTurnKey = key;
    wayBeyond20FvttSend({ action: "waybeyond20-turn-update", current });
}

function wayBeyond20FvttScheduleTurn() {
    if (wayBeyond20FvttTurnTimer) return;
    wayBeyond20FvttTurnTimer = setTimeout(wayBeyond20FvttPublishTurn, 100);
}

function wayBeyond20FvttTokenChangeMatters(tokenDoc, changed) {
    const combat = game.combat;
    if (!combat || !changed) return false;
    if (!["x", "y", "width", "height", "hidden", "name"].some(k => k in changed)) return false;
    return (combat.turns || []).some(c => wayBeyond20FvttCombatantKey(c) === String(tokenDoc.id || docData(tokenDoc)._id));
}

function wayBeyond20FvttStartCombatObserver() {
    wayBeyond20FvttStopCombatObserver();
    const on = (hook, fn) => wayBeyond20FvttHookIds.push([hook, Hooks.on(hook, fn)]);
    for (const hook of ["createCombat", "updateCombat", "deleteCombat",
        "createCombatant", "updateCombatant", "deleteCombatant", "canvasReady"])
        on(hook, wayBeyond20FvttScheduleTurn);
    on("updateToken", (tokenDoc, changed) => {
        if (wayBeyond20FvttTokenChangeMatters(tokenDoc, changed)) wayBeyond20FvttScheduleTurn();
    });
    wayBeyond20FvttScheduleTurn();
}

function wayBeyond20FvttStopCombatObserver() {
    while (wayBeyond20FvttHookIds.length) {
        const [hook, id] = wayBeyond20FvttHookIds.pop();
        Hooks.off(hook, id);
    }
    if (wayBeyond20FvttTurnTimer) clearTimeout(wayBeyond20FvttTurnTimer);
    wayBeyond20FvttTurnTimer = 0;
    wayBeyond20FvttLastTurnKey = "";
}

// Link the character to the tokens the player controlled when initiative was added.
function wayBeyond20FvttBindTokens(characterName, tokens, reason) {
    const ids = (tokens || []).map(t => String(t.id || docData(t)._id || "")).filter(Boolean);
    if (!characterName || ids.length === 0) return;
    wayBeyond20FvttSend({ action: "waybeyond20-token-binding", character: { name: characterName },
        tokenId: ids[0], tokenIds: ids, reason });
}

// Same award rule as the Roll20 adapter: only Draining Attack style temp-HP intents,
// counting regular damage only, never healing, versatile or conditional rows.
function wayBeyond20FvttResolvedDamage(request, damage_rolls) {
    if (!request || !request.character || !Array.isArray(damage_rolls)) return;
    // Match the renderer's ownership rule: the sheet continuation owns these
    // already-managed attacks, including its final combined rider damage.
    if (request["waybeyond20-await-hit"]) return;
    const effects = Array.isArray(request.effects) ? request.effects : [];
    const inferred = effects.some(e => String(e || "").toLowerCase().includes("draining attack")) &&
        !!request["waybeyond20-unarmed-strike"];
    if (!request["waybeyond20-temp-hp-on-hit"] && !inferred) return;
    const totalDamage = damage_rolls.reduce((total, row) => {
        if (!Array.isArray(row) || row.length < 3) return total;
        const roll = row[1];
        const flags = Number(row[2] || 0);
        if (!roll || typeof roll !== "object") return total;
        if (flags === DAMAGE_FLAGS.MESSAGE || (flags & (DAMAGE_FLAGS.HEALING | DAMAGE_FLAGS.VERSATILE | DAMAGE_FLAGS.CONDITIONAL))) return total;
        const amount = Number(roll.total);
        return Number.isFinite(amount) && amount > 0 ? total + amount : total;
    }, 0);
    if (totalDamage > 0)
        wayBeyond20FvttSend({ action: "waybeyond20-damage-result", character: request.character, totalDamage });
}

function setSettings(new_settings, url) {
    settings = new_settings;
    extension_url = url;
    roll_renderer.setBaseURL(extension_url);
    roll_renderer.setSettings(settings);
}

function disconnectAllEvents() {
    for (let event of registered_events)
        document.removeEventListener(...event);
}

function setTitle() {
    // Look for the chat-controls (pre-v13) or chat-message (v13+) container
    const chatControls = $("#chat-controls, #chat-message");
    if (chatControls.length) {
        const title = document.getElementsByTagName("title")[0];
        const worldTitle = game.world?.title || game.world?.data?.title || "";
        // Make sure the mutation gets triggerred if we reload the extension
        title.textContent = "Foundry Virtual Tabletop";
        title.textContent = `${worldTitle} • Foundry Virtual Tabletop`;
    } else {
        // Wait for the world and UI to be loaded;
        Hooks.once("renderChatLog", setTitle);
    }
    // Mark WayBeyond20 as loaded as soon as game is defined
    if (game) game.beyond20 = {loaded: true};
    // Re-set the game version on ready in case the game data wasn't initialized on WayBeyond20 load
    Hooks.on("ready", () => {
        fvttVersion = game.version || game.data?.version;
        game.beyond20 = {loaded: true};
    });
  }

console.log("WayBeyond20: Foundry VTT Page Script loaded");
const registered_events = [];
registered_events.push(addCustomEventListener("Roll", handleRoll));
registered_events.push(addCustomEventListener("RenderedRoll", handleRenderedRoll));
registered_events.push(addCustomEventListener("NewSettings", setSettings));
registered_events.push(addCustomEventListener("UpdateHP", updateHP));
registered_events.push(addCustomEventListener("UpdateConditions", updateConditions));
registered_events.push(addCustomEventListener("UpdateEffects", updateEffects));
// Stop WayBeyond20's own hooks before the listeners are removed on reinjection.
registered_events.push(addCustomEventListener("disconnect", wayBeyond20FvttStopCombatObserver));
registered_events.push(addCustomEventListener("disconnect", disconnectAllEvents));
//const alertify = ui.notifications;
setTitle();
initializeAlertify();
if (typeof game !== "undefined" && game && game.ready) wayBeyond20FvttStartCombatObserver();
else Hooks.once("ready", wayBeyond20FvttStartCombatObserver);
