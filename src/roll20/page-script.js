async function loadCharacterAttributes(character) {
    if (!character.attribs.backboneFirebase) {
        character.attribs.backboneFirebase = new BackboneFirebase(character.attribs);

        return character.attribs.backboneFirebase.reference.once('value');
    }
}

async function updateHP(name, current, total, temp) {
    console.log(`Updating HP for ${name} : (${current} + ${temp})/${total}`);
    name = name.toLowerCase().trim();

    const character = window.Campaign.characters.find((c) => c.attributes.name.toLowerCase().trim() === name);
    if (!character)
        return; // nothing to do when no matching character exists

    // Make sure character attributes are loaded before we try to find the HP attributes to sync it
    await loadCharacterAttributes(character);

    /* We currently support the following character sheets:
        Sheet Name                            | Short Name (internally used)
       ---------------------------------------+------------------------------
        D&D 5E By Roll20 - 2014 Sheet Version | ogl5e
        D&D 5E By Roll20 - 2024 Sheet Version | dnd2024byroll20
        D&D 5E 2014                           | ogl5e
        D&D 5e (New!) - 2024 / 2014           | dnd2024byroll20
        D&D 5E (Community Contributed)        | dnd5e
     */

    if (character.characterSheet?.shortName === "ogl5e" || character.characterSheet?.shortName === "dnd5e") { // 2014 sheet versions
        const hp = character.attribs.find((a) => a.attributes.name === "hp");
        if (hp) {
            //console.log("Found attribute : ", hp);
            hp.set("current", String(current));
            hp.set("max", String(total));
            hp.save();
            character.updateTokensByName("hp", hp.id);
        }
        const temp_hp = character.attribs.find((a) => a.attributes.name === "hp_temp");
        if (temp_hp) {
            //console.log("Found attribute : ", temp_hp);
            if (temp_hp.attributes.current != String(temp)) {
                const value = temp != 0 ? String(temp) : "";
                temp_hp.set("current", value);
                temp_hp.set("max", value);
                temp_hp.save();
                character.updateTokensByName("hp_temp", temp_hp.id);
            }
        }

    } else if (character.characterSheet?.shortName === "dnd2024byroll20") { // 2024 sheet versions
        const sheetCharacter = character.characterSheet?.state?.characters?.[character.id];
        const store = sheetCharacter?.attributes?.store;

        if (!store) {
            // Usually, the character attributes are initialized by the front end and sent to the back end after creating a new character.
            // This occurs shortly after the the "Your Adventure Begins Here!" splash screen first opens (where one can also edit the character sheet).
            // However, if the users closes the character screen quickly enough, the attributes remain uninitialized.
            // As a workaround, we create the required HP entries manually.
            // (Alternatively, we could trigger the character screen with `character.view.showDialog()`, which would lead to character attribute initialisation.)

            console.warn(
                `Warning: character "${character.get("name")}" is not yet initialized. ` +
                "If HP sync does not work, please open the character dialog and wait for it to finish loading. " +
                "You can do this by clicking on the character's entry in the Journal view."
            );

            character.characterSheet.headlessRelay.postMessage({
                type: "change",
                character: {
                    id: character.id,
                    attributes: {
                        store: {
                            hitpoints: {
                                currentHP: current,
                                temp,
                            },
                            integrants: {
                                integrants: {
                                    [uuidv4()]: createHitpointIntegrantEntry(0, "Maximum", total),
                                    [uuidv4()]: createHitpointIntegrantEntry(1, "Temporary", temp),
                                },
                            },
                        },
                    },
                },
            });

            // using the property setter to (again) set the HP value leads to the internal state synchronizing to the character sheet state
            await character.characterSheet.headlessRelay.setComputed({
                characterId: character.id,
                property: "hp",
                args: [current],
            });
        } else {
            // To set max HP we have to manually change the integrants, as the max HP is a read-only property.
            // As the integrant is optional, we first have to check if it exists, and, in case it does not, create it.
            let maxHpIntegrantKey = Object.entries(store.integrants.integrants).find(([_, v]) => v.hitpointType === "Maximum")?.[0], updatePayload;

            if (maxHpIntegrantKey) { // integrant has already been created, simply update the value
                updatePayload = { valueFormula: { flatValue: total } };

            } else { // we have to create a new integrant entry
                maxHpIntegrantKey = uuidv4();

                // calculate the next free array position
                const newPosition = Math.max(...Object.values(store.integrants.integrants).map(v => v.arrayPosition)) + 1;

                updatePayload = createHitpointIntegrantEntry(newPosition, "Maximum", total);
            }

            character.characterSheet.headlessRelay.postMessage({
                type: "change",
                character: {
                    id: character.id,
                    attributes: { store: { integrants: { integrants: { [maxHpIntegrantKey]: updatePayload } } } },
                },
            });

            // set HP using the property setter

            /* **TEMPORARY WORKAROUND**
               Using the property setter is currently broken on Roll20's end, as they use the wrong key for storing the temporary HP (temp vs tempHP).
               So, the current workaround is to just forgo the setter and change the store value directly, where we can determine the key ourselves.

            // If we wanted to auto-hide the bar when temp is zero, we'd have to manually edit the temporary HP integrant's value and set it to an empty string (ref. changing max HP).
            // The property setter that's used with setComputed automatically converts values to integers, so an empty string remains zero and the bar is still visible.
            // As this matches Roll20's default behaviour when using the 2024 templates, we keep it that way.
            await character.characterSheet.headlessRelay.setComputed({
                characterId: character.id,
                property: "hp_temp",
                args: [temp],
            });
            */
            const tempHpIntegrantKey = Object.entries(store.integrants.integrants).find(([_, v]) => v.hitpointType === "Temporary")?.[0],
                tempHPIntegrantUpdatePayload = tempHpIntegrantKey ? { integrants: { integrants: { [tempHpIntegrantKey]: { valueFormula: { flatValue: temp } } } } } : {};
            character.characterSheet.headlessRelay.postMessage({
                type: "change",
                character: {
                    id: character.id,
                    attributes: {
                        store: {
                            hitpoints: {
                                temp,
                                tempHP: temp,
                            },
                            ...tempHPIntegrantUpdatePayload,
                        },
                    },
                },
            });
            /* **END OF TEMPORARY WORKAROUND** */

            // set HP using the property setter
            await character.characterSheet.headlessRelay.setComputed({
                characterId: character.id,
                property: "hp",
                args: [current],
            });

        }
        // make sure all tokens resemble the new values
        character.updateTokensForAdvancedSheets();
    } else {
        console.warn(`Unsupported character sheet ${character.characterSheet?.longName} (${character.characterSheet?.shortName}) used. WayBeyond20 HP synchronization will not work.`);
    }
}

function createHitpointIntegrantEntry(arrayPosition, hitpointType, initialValue = 0) {
    let label, source, calculation;

    if (hitpointType === "Maximum") {
        label = "Other Bonus";
        source = "Custom";
        calculation = "Modify";
    } else if (hitpointType === "Temporary") {
        label = "";
        source = "";
        calculation = "Set Value";
    }
    else {
        throw `Invalid hitpoint type "${hitpointType}" provided. Only "Maximum" and "Temporary" are supported.`;
    }

    return {
        // attributes that differ based on hitpoint type
        _label: label,
        arrayPosition,
        calculation,
        hitpointType,
        source,

        // these attributes are the same for all hitpoint types
        _enabled: true,
        builderDisplayName: "",
        childIDs: "[]",
        createdTime: Date.now(),
        isFixed: false,
        isTemp: false,
        name: "",
        overwriteDisabled: false,
        parentDisabled: false,
        parentID: "",
        relations: {},
        shortID: crypto.getRandomValues(new Uint8Array(7)).toBase64().substr(0, 9).replace(/[^\w]/, '-'), // creates a random strings matching the pattern [0-9a-ZA-Z-]{9}
        type: "Hit Points",
        valueFormula: { flatValue: initialValue },
    };
}

function updateCombatTracker(combat, settings) {
    if (!is_gm) return;

    const index = combat.findIndex(x => x.turn);
    // Map combatants to tokens before splicing/re-ordering the array
    // so we can ensure the token mapping is consistent
    const mappedGraphics = [];
    const turnOrder = combat.map(combatant => {
        const name = combatant.name.toLowerCase().trim();
        const page = Campaign.activePage();
        let graphic = null;
        if (page && page.thegraphics) {
          graphic = page.thegraphics.models.find(g => g.attributes.name.toLowerCase().trim() === name);
          // Try to find token with the base name in case of multiple mooks
          if (!graphic && name.match(/ \([a-z]\)$/)) {
            const baseName = name.replace(/ \([a-z]\)$/, "");
            graphic = page.thegraphics.models.find(g => {
                if (mappedGraphics.includes(g.id)) return false;
                return g.attributes.name.toLowerCase().trim() === baseName;
            });

          }
          if (graphic) {
              mappedGraphics.push(graphic.id);
          }
        }
        let combatantName = combatant.name;
        if (!graphic && combatant.tags.includes("monster") && settings["combat-unknown-monster-name"]) {
            combatantName = settings["combat-unknown-monster-name"];
        }
        return {
            id: graphic ? graphic.id : "-1",
            pr: combatant.initiative,
            custom: combatantName,
            _pageid: graphic ? page.id : undefined // if an id is set, the page id must be set too
        }
    });
    // Roll20 needs the unit whose turn it is at the top of the array.
    if (index === -1) {
        console.warn("It's apparently nobody's turn :/");
    } else {
        const c = turnOrder.splice(index, turnOrder.length);
        turnOrder.splice(0, 0, ...c);
    }
    // Make sure the turn tracker window is open
    // This also forces roll20 to sync the initiative tracker state to other clients.
    $("#startrounds").click();
    Campaign.set("turnorder", JSON.stringify(turnOrder));
    Campaign.save();
}


function wayBeyond20ArrayFromPossibleCollection(collection) {
    if (!collection) return [];
    if (Array.isArray(collection)) return collection;
    if (collection.models && Array.isArray(collection.models)) return collection.models;
    if (collection._objects && Array.isArray(collection._objects)) return collection._objects;
    if (typeof collection.forEach === "function") {
        const values = [];
        try {
            collection.forEach(value => values.push(value));
            return values;
        } catch (err) {
            return [];
        }
    }
    return [collection];
}

function wayBeyond20ExtractGraphicId(value) {
    if (!value) return null;
    const candidates = [value, value.model, value._model, value.graphic, value.token];
    for (const candidate of candidates) {
        if (!candidate) continue;
        if (typeof candidate === "string") return candidate;
        if (candidate.id) return candidate.id;
        if (candidate._id) return candidate._id;
        if (candidate.attributes && candidate.attributes.id) return candidate.attributes.id;
        if (typeof candidate.get === "function") {
            try {
                const id = candidate.get("id") || candidate.get("_id");
                if (id) return id;
            } catch (err) {
                // Ignore and keep checking alternate shapes.
            }
        }
    }
    return null;
}

function wayBeyond20GetSelectedTokenIds() {
    const ids = [];
    const addId = value => {
        const id = wayBeyond20ExtractGraphicId(value);
        if (id && id !== "-1" && !ids.includes(id)) ids.push(id);
    };

    try {
        if (window.d20 && window.d20.engine) {
            const engine = window.d20.engine;
            let selected = null;
            if (typeof engine.selected === "function") selected = engine.selected();
            else if (engine.selected !== undefined) selected = engine.selected;
            wayBeyond20ArrayFromPossibleCollection(selected).forEach(addId);
        }
    } catch (err) {
        console.warn("WayBeyond20: Unable to read d20.engine.selected", err);
    }

    try {
        const canvas = window.d20?.engine?.canvas || window.canvas;
        const activeObjects = canvas && typeof canvas.getActiveObjects === "function" ? canvas.getActiveObjects() : [];
        wayBeyond20ArrayFromPossibleCollection(activeObjects).forEach(addId);
        if (canvas && typeof canvas.getActiveObject === "function") addId(canvas.getActiveObject());
    } catch (err) {
        console.warn("WayBeyond20: Unable to read active canvas token", err);
    }

    return ids;
}

function wayBeyond20BindSelectedToken(characterName, reason = "") {
    const tokenIds = wayBeyond20GetSelectedTokenIds();
    if (!characterName || tokenIds.length === 0) return;
    sendCustomEvent("SendMessage", [{
        action: "waybeyond20-token-binding",
        character: { name: characterName },
        tokenId: tokenIds[0],
        tokenIds,
        reason
    }]);
}

function wayBeyond20GetGraphicName(tokenId) {
    if (!tokenId || tokenId === "-1") return "";
    try {
        const page = Campaign.activePage();
        const graphic = page && page.thegraphics
            ? page.thegraphics.models.find(g => g.id === tokenId)
            : null;
        return graphic ? (graphic.attributes.name || "") : "";
    } catch (err) {
        return "";
    }
}


function wayBeyond20ReadTurnOrderTargets(order) {
    if (!Array.isArray(order)) return [];
    const targets = [];
    const seen = new Set();
    for (const entry of order) {
        if (!entry || !entry.id || entry.id === "-1") continue;
        const tokenName = wayBeyond20GetGraphicName(entry.id || "");
        const name = String(tokenName || entry.custom || "").replace(/\s+/g, " ").trim();
        if (!name) continue;
        const key = String(entry.id || name).toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        targets.push({
            key: String(entry.id),
            tokenId: String(entry.id),
            name,
            tokenName,
            custom: entry.custom || "",
            relation: "unknown"
        });
    }
    return targets;
}

let wayBeyond20LastTurnOrderKey = "";

function wayBeyond20ReadCurrentTurn() {
    try {
        const raw = Campaign.get("turnorder");
        const order = raw ? JSON.parse(raw) : [];
        if (!Array.isArray(order) || order.length === 0) return { active: false, targets: [] };
        const current = order[0] || {};
        const orderKey = JSON.stringify(order.map(entry => ({
            id: entry && entry.id ? String(entry.id) : "",
            pr: entry && entry.pr !== undefined && entry.pr !== null ? String(entry.pr) : "",
            custom: entry && entry.custom ? String(entry.custom) : "",
            pageId: entry && entry._pageid ? String(entry._pageid) : ""
        })));
        return {
            active: true,
            tokenId: current.id || "",
            custom: current.custom || "",
            pr: current.pr !== undefined && current.pr !== null ? String(current.pr) : "",
            pageId: current._pageid || "",
            tokenName: wayBeyond20GetGraphicName(current.id || ""),
            orderKey,
            targets: wayBeyond20ReadTurnOrderTargets(order)
        };
    } catch (err) {
        console.warn("WayBeyond20: Unable to read Roll20 turn order", err);
        return null;
    }
}

function wayBeyond20PollCurrentTurn() {
    const current = wayBeyond20ReadCurrentTurn();
    if (!current) return;

    if (current.active === false) {
        const inactiveKey = "inactive";
        if (inactiveKey === wayBeyond20LastTurnOrderKey) return;
        wayBeyond20LastTurnOrderKey = inactiveKey;
        sendCustomEvent("SendMessage", [{
            action: "waybeyond20-turn-update",
            current
        }]);
        return;
    }

    if (!current.tokenId || current.tokenId === "-1") return;
    const key = current.orderKey || [current.tokenId, current.custom, current.pr, current.pageId].join("|");
    if (key === wayBeyond20LastTurnOrderKey) return;
    wayBeyond20LastTurnOrderKey = key;
    current.turnKey = key;
    sendCustomEvent("SendMessage", [{
        action: "waybeyond20-turn-update",
        current
    }]);
}

var wayBeyond20TurnOrderMonitorId = 0;

function wayBeyond20StopTurnOrderMonitor() {
    if (!wayBeyond20TurnOrderMonitorId) return;
    clearInterval(wayBeyond20TurnOrderMonitorId);
    wayBeyond20TurnOrderMonitorId = 0;
}

function wayBeyond20StartTurnOrderMonitor() {
    // WayBeyond20 owns this poller. Keep it to one instance and do not run it in
    // Roll20 popout windows; only the main editor needs to publish turn state.
    wayBeyond20StopTurnOrderMonitor();
    if (window.location && /\/editor\/popout(?:\/|$)/i.test(window.location.pathname || "")) return;
    wayBeyond20PollCurrentTurn();
    wayBeyond20TurnOrderMonitorId = setInterval(wayBeyond20PollCurrentTurn, 1000);
}


function checkForOGL() {
    // Make sure at least one of these variables is set
    if (typeof(customcharsheet_data) === "undefined" &&
        typeof(customcharsheet_html) === "undefined" &&
        typeof(CHARSHEET_NAME) === "undefined")
        return setTimeout(checkForOGL, 1000)
    const oglTemplates = ["simple", "atk", "atkdmg", "dmg", "spell", "traits"];
    const templates = typeof(customcharsheet_data) !== "undefined" && customcharsheet_data.rolltemplates;
    let isOGL = false;
    if (templates) {
        isOGL = oglTemplates.every(template => !!templates[template]);
    } else if (typeof(CHARSHEET_NAME) !== "undefined") {
        isOGL = (CHARSHEET_NAME == "ogl5e");
    } else if (typeof(customcharsheet_html) !== "undefined") {
        const html = $(atob(customcharsheet_html));
        isOGL = oglTemplates.every(template => html.find(`rolltemplate.sheet-rolltemplate-${template}`).length !== 0);
    }
    $("#isOGL").remove();
    document.body.append($(`<input type="hidden" value="${isOGL ? 1 : 0}" name="isOGL" id="isOGL">`)[0]);
}

function disconnectAllEvents() {
    for (let event of registered_events)
        document.removeEventListener(...event);
}

var registered_events = [];
registered_events.push(addCustomEventListener("UpdateHP", updateHP));
registered_events.push(addCustomEventListener("CombatTracker", updateCombatTracker));
registered_events.push(addCustomEventListener("BindSelectedToken", wayBeyond20BindSelectedToken));
// Stop WayBeyond20's own turn poller before Beyond20 removes the registered
// page listeners during its normal disconnect/reinjection cycle.
registered_events.push(addCustomEventListener("disconnect", wayBeyond20StopTurnOrderMonitor));
registered_events.push(addCustomEventListener("disconnect", disconnectAllEvents));

wayBeyond20StartTurnOrderMonitor();

// Hack for VTT ES making every script load before Roll20 loads
if (window.$ !== undefined)
    setTimeout(checkForOGL, 1000)
else
    window.addEventListener("DOMContentLoaded", () => setTimeout(checkForOGL, 1000));
