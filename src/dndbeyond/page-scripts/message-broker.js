if (!window.__beyond20_mb2_initialized__) {
    window.__beyond20_mb2_initialized__ = true;

    const BROKER_KEY = "__beyond20_message_broker__";
    const EVENTS_KEY = "__beyond20_mb2_registered_events__";
    const OVERRIDE_QUEUE_KEY = "__beyond20_mb2_override_queue__";
    const HOOKS_INSTALLED_KEY = "__beyond20_mb2_override_hooks_installed__";
    const B20_OVERRIDE_MARKER = "__b20Override__";
    const WAYBEYOND20_CRITICAL_GAME_LOG_KEY = "__waybeyond20_mb2_critical_game_log__";

    const messageBroker =
        window[BROKER_KEY] || (window[BROKER_KEY] = new DDBMessageBroker());

    messageBroker.register();
    console.log("Registered WayBeyond20 message broker");

    const b20OverrideQueue =
        window[OVERRIDE_QUEUE_KEY] || (window[OVERRIDE_QUEUE_KEY] = []);

    let lastCharacter = null;

    function normalizeActionName(name) {
        const s = String(name || "").trim();
        return /^Initiative\b/i.test(s) ? "Initiative" : s;
    }

    function cloneMessage(message) {
        try {
            return JSON.parse(JSON.stringify(message));
        } catch (e) {
            const cloned = Object.assign({}, message);
            cloned.data = Object.assign({}, message?.data);
            return cloned;
        }
    }

    function sendRollToGameLog(request) {
        const message = { persist: false };

        if (request.action === "roll") {
            message.eventType = "custom/beyond20/request";
            message.data = { request };
            lastCharacter = request.character;
        } else if (request.action === "rendered-roll") {
            message.eventType = "custom/beyond20/roll";
            message.data = {
                request: request.request,
                render: request.html
            };
            lastCharacter = request.character;
        } else {
            return;
        }

        messageBroker.postMessage(message);
    }

    function rollToDDBRoll(roll, forceResults = false, damageType = null) {
        let constant = 0;
        let lastOperation = "+";
        const sets = [];
        const results = [];

        for (const part of (roll?.parts || [])) {
            const signMultiplier = (lastOperation === "+" ? 1 : -1);

            if (part === "-" || part === "+") {
                lastOperation = part;
                continue;
            }

            if (typeof part === "number") {
                constant += parseInt(part, 10) * signMultiplier;
                continue;
            }

            if (!part?.formula) continue;

            const mods = part.modifiers || "";
            let operation = 0;
            if (mods.includes("kl") || mods.includes("dh")) operation = 1;
            else if (mods.includes("kh") || mods.includes("dl")) operation = 2;

            const faces = Number(part.faces);
            const dieType = [4, 6, 8, 10, 12, 20, 100].includes(faces) ? `d${faces}` : "d100";

            sets.push({
                count: parseInt(part.amount, 10) * signMultiplier,
                dieType,
                operation,
                dice: (part.rolls || []).map(r => ({
                    dieType,
                    dieValue: r.roll || 0
                }))
            });

            if (part.total !== undefined) {
                results.push(
                    ...(part.rolls || [])
                        .filter(r => !r.discarded)
                        .map(r => (parseInt(r.roll, 10) || 0) * signMultiplier)
                );
            }
        }

        const rollToKind = {
            "critical-damage": "critical hit"
        };

        const rollToType = {
            "to-hit": "to hit",
            "damage": "damage",
            "critical-damage": "damage",
            "skill-check": "check",
            "ability-check": "check",
            "initiative": "check",
            "saving-throw": "save",
            "death-save": "save",
        };

        let rollType = rollToType[roll.type] || "roll";
        if (damageType && (roll.type === "damage" || roll.type === "critical-damage")) {
            rollType = damageType;
        }

        const data = {
            diceNotation: {
                constant,
                set: sets
            },
            diceNotationStr: roll.formula,
            rollKind: rollToKind[roll.type] || "",
            rollType: rollType
        };

        if (forceResults || results.length > 0) {
            data.result = {
                constant,
                text: (roll.parts || []).map(p => {
                    if (p?.total === undefined) return String(p);

                    const rolls = (p.rolls || [])
                        .filter(r => !r.discarded && !Number.isNaN(parseInt(r.roll, 10)))
                        .map(r => parseInt(r.roll, 10));

                    return rolls.length ? rolls.join("+") : String(p.total);
                }).join(""),
                total: parseInt(roll.total, 10),
                values: results
            };
        }

        return data;
    }

    function b20BuildDdbRollsForGameLog(b20Rolls, request = {}) {
        const rolls = Array.isArray(b20Rolls) ? b20Rolls : [];
        if (!rolls.length) return [];

        const advantage = request.advantage;
        const isAdvantage = advantage === 3;
        const isDisadvantage = advantage === 4;
        const isSuperAdvantage = advantage === 6;
        const isSuperDisadvantage = advantage === 7;
        
        const damageTypes = request["damage-types"] || [];
        const criticalDamageTypes = request["critical-damage-types"] || [];

        const nextDamageType = (roll, indexes) => {
            if (roll.type === "critical-damage") {
                return criticalDamageTypes[indexes.critical++] || null;
            }
            if (roll.type === "damage") {
                return damageTypes[indexes.regular++] || null;
            }
            return null;
        };

        if (!isAdvantage && !isDisadvantage && !isSuperAdvantage && !isSuperDisadvantage) {
            const indexes = { regular: 0, critical: 0 };
            return rolls.map((r) => rollToDDBRoll(r, true, nextDamageType(r, indexes)));
        }

        const [d20Rolls, otherRolls] = [[], []];
        for (const roll of rolls) {
            ((roll.parts || []).some(p => p?.faces === 20) ? d20Rolls : otherRolls).push(roll);
        }

        const isAdv = isAdvantage || isSuperAdvantage;
        const indexes = { regular: 0, critical: 0 };
        const combinedD20RollType = {
            "to-hit": "to hit",
            "skill-check": "check",
            "ability-check": "check",
            "initiative": "check",
            "saving-throw": "save",
            "death-save": "save"
        }[d20Rolls[0]?.type] || "roll";

        return [
            ...(d20Rolls.length ? [combineD20Rolls(
                d20Rolls,
                isAdv,
                isSuperAdvantage || isSuperDisadvantage,
                { rollType: combinedD20RollType }
            )] : []),
            ...otherRolls.map((r) => rollToDDBRoll(r, true, nextDamageType(r, indexes)))
        ];
    }

    function combineD20Rolls(d20Rolls, isAdvantage, isSuper = false, options = {}) {
        const {
            rollType = "to hit",   // "to hit" | "save" | "check"
            includeDebug = false
        } = options;

        const keepHighest = !!isAdvantage;
        const operation = keepHighest ? 2 : 1;

        function formatSigned(value) {
            if (!value) return "";
            return value > 0 ? `+${value}` : `${value}`;
        }

        function parseRoll(roll) {
            let sign = 1;

            let numericConstant = 0;   // only literal numbers like -1, +3
            let d20Total = 0;          // sum of d20s in this branch
            let extraDiceTotal = 0;    // sum of non-d20 dice in this branch

            const d20Values = [];

            for (const part of roll?.parts || []) {
                if (typeof part === "string") {
                    const op = part.trim();
                    if (op === "+") sign = 1;
                    else if (op === "-") sign = -1;
                    continue;
                }

                if (typeof part === "number") {
                    numericConstant += sign * part;
                    sign = 1;
                    continue;
                }

                if (part && typeof part === "object" && Array.isArray(part.rolls)) {
                    const values = (part.rolls || []).map(r => Number(r?.roll) || 0);
                    const subtotal = values.reduce((sum, v) => sum + v, 0);

                    if (part.faces === 20) {
                        d20Values.push(...values);
                        d20Total += sign * subtotal;
                    } else {
                        extraDiceTotal += sign * subtotal;
                    }

                    sign = 1;
                }
            }

            const reconstructedTotal = d20Total + extraDiceTotal + numericConstant;
            const total = typeof roll?.total === "number" ? roll.total : reconstructedTotal;

            // This is the branch value WITHOUT the flat numeric modifier.
            // It still includes bless/bane/etc, because those are rolled per branch for the extension.
            const displayValue = total - numericConstant;

            return {
                raw: roll,
                total,
                numericConstant,
                d20Total,
                extraDiceTotal,
                d20Values,
                displayValue
            };
        }

        function buildDiceNotationStr(d20Count, flatConstant, keepHighest) {
            const base = `${d20Count}d20${keepHighest ? "kh1" : "kl1"}`;
            return `${base}${formatSigned(flatConstant)}`;
        }

        if (!Array.isArray(d20Rolls) || d20Rolls.length === 0) {
            return {
                diceNotation: {
                    constant: 0,
                    set: []
                },
                diceNotationStr: "",
                rollKind: keepHighest ? "advantage" : "disadvantage",
                rollType,
                result: {
                    constant: 0,
                    text: "",
                    total: 0,
                    values: []
                }
            };
        }

        const parsedRolls = d20Rolls.map(parseRoll);
        const allD20Values = parsedRolls.flatMap(r => r.d20Values);

        // Pick the winning FULL branch total.
        const selectedRoll = parsedRolls.reduce((best, current) => {
            if (!best) return current;
            return keepHighest
                ? current.total > best.total ? current : best
                : current.total < best.total ? current : best;
        }, null);

        // In normal use these should all match, since the formula is the same for each branch.
        // We keep the selected branch's numeric constant to stay safe.
        const flatConstant = selectedRoll?.numericConstant ?? 0;

        // Show values WITHOUT the flat numeric constant, but WITH per-branch rolled dice like bless.
        const displayValues = parsedRolls.map(r => r.total - flatConstant);

        const resultText = `(${displayValues.join(",")})${formatSigned(flatConstant)}`;
        const resultSummary = `${resultText} = ${selectedRoll?.total ?? 0}`;

        const payload = {
            diceNotation: {
                constant: flatConstant,
                set: [
                    {
                        count: allD20Values.length,
                        dieType: "d20",
                        operation,
                        dice: allD20Values.map(v => ({
                            dieType: "d20",
                            dieValue: v
                        }))
                    }
                ]
            },

            // Helpful for debugging/other consumers.
            // DDB itself seems to rebuild from diceNotation, not this string.
            diceNotationStr: buildDiceNotationStr(
                allD20Values.length,
                flatConstant,
                keepHighest
            ),

            // Keep native wording even for super advantage/disadvantage.
            // The 3d20 visual comes from count, not a different rollKind.
            rollKind: keepHighest ? "advantage" : "disadvantage",
            rollType,

            result: {
                constant: flatConstant,
                text: resultText,
                summary: resultSummary,
                total: selectedRoll?.total ?? 0,
                values: displayValues
            }
        };

        if (includeDebug) {
            payload.__nativeDowngrade__ = true;
            payload.__isSuper__ = !!isSuper;
            payload.__rawD20Values__ = allD20Values;
            payload.__branchTotals__ = parsedRolls.map(r => r.total);
            payload.__branchDisplayValues__ = displayValues;
            payload.__selectedBranchTotal__ = selectedRoll?.total ?? 0;
            payload.__selectedFlatConstant__ = flatConstant;
        }

        return payload;
    }

    function wayBeyond20GameLogDebug(event, details = null) {
        try {
            sendCustomEvent("WayBeyond20GameLogDebug", [String(event || "event"), details]);
        } catch (error) {
            console.debug("WayBeyond20: unable to forward Game Log debug event", error);
        }
    }

    function wayBeyond20DescribeGameLogRolls(rolls) {
        return (rolls || []).map(roll => ({
            type: roll?.type || "",
            formula: roll?.formula || "",
            total: roll?.total,
            discarded: !!roll?.discarded,
            criticalSuccess: roll?.["critical-success"] === true
        }));
    }

    function wayBeyond20RollDataHasCriticalDamage(rollData) {
        return (rollData?.rolls || []).some(roll => roll?.type === "critical-damage");
    }

    function wayBeyond20RollDataExpectsCriticalDamage(rollData) {
        const request = rollData?.request || {};
        const criticalDamages = request["critical-damages"] || [];
        if (!criticalDamages.length) return false;
        if (request.rollCritical) return true;
        return (rollData?.rolls || []).some(roll =>
            roll?.type === "to-hit" &&
            !roll?.discarded &&
            roll?.["critical-success"] === true
        );
    }

    function wayBeyond20ClearCriticalGameLogAggregate() {
        const aggregate = window[WAYBEYOND20_CRITICAL_GAME_LOG_KEY];
        if (aggregate?.fallbackTimer) clearTimeout(aggregate.fallbackTimer);
        window[WAYBEYOND20_CRITICAL_GAME_LOG_KEY] = null;
        return aggregate || null;
    }

    function wayBeyond20DispatchCriticalGameLogAggregate(criticalRollData, currentEntry=null, currentIdx=-1) {
        const aggregate = wayBeyond20ClearCriticalGameLogAggregate();
        if (!aggregate?.ddbFulfilled || !aggregate?.rollData) return false;

        try {
            if (currentEntry?.fallbackTimer) {
                clearTimeout(currentEntry.fallbackTimer);
                currentEntry.fallbackTimer = null;
            }

            const combinedRequest = {
                ...(aggregate.request || {}),
                ...(criticalRollData?.request || {})
            };
            const combinedRollData = {
                ...(aggregate.rollData || {}),
                ...(criticalRollData || {}),
                request: combinedRequest,
                rolls: [
                    ...(aggregate.rollData.rolls || []),
                    ...(criticalRollData?.rolls || [])
                ]
            };

            const patched = cloneMessage(aggregate.ddbFulfilled);
            patched.data = patched.data || {};
            patched.data.action = normalizeActionName(aggregate.action || patched.data.action);
            patched.data.rolls = b20BuildDdbRollsForGameLog(
                combinedRollData.rolls,
                combinedRequest
            );
            patched.data[B20_OVERRIDE_MARKER] = true;

            wayBeyond20GameLogDebug("Critical Game Log phases merged", {
                action: patched.data.action,
                normalRolls: wayBeyond20DescribeGameLogRolls(aggregate.rollData.rolls || []),
                criticalRolls: wayBeyond20DescribeGameLogRolls(criticalRollData?.rolls || []),
                damageTypes: combinedRequest["damage-types"] || [],
                criticalDamageTypes: combinedRequest["critical-damage-types"] || [],
                combinedGameLogRolls: patched.data.rolls
            });

            if (messageBroker._mbDispatch) messageBroker._mbDispatch(patched);
            else if (messageBroker._mb) messageBroker._mb.dispatch(patched);

            wayBeyond20GameLogDebug("Critical Game Log combined payload dispatched", {
                action: patched.data.action,
                rollCount: patched.data.rolls?.length || 0
            });
        } catch (e) {
            console.warn("WayBeyond20: failed to dispatch combined critical Game Log roll", e);
            wayBeyond20GameLogDebug("Critical Game Log combined dispatch failed", {
                action: aggregate.action || "",
                error: String(e?.message || e)
            });
            try {
                if (messageBroker._mbDispatch) messageBroker._mbDispatch(aggregate.ddbFulfilled);
                else if (messageBroker._mb) messageBroker._mb.dispatch(aggregate.ddbFulfilled);
            } catch (fallbackError) {
                console.warn("WayBeyond20: failed to dispatch critical Game Log fallback", fallbackError);
                wayBeyond20GameLogDebug("Critical Game Log immediate fallback failed", {
                    action: aggregate.action || "",
                    error: String(fallbackError?.message || fallbackError)
                });
            }
        } finally {
            if (currentIdx >= 0 && b20OverrideQueue[currentIdx] === currentEntry) {
                b20OverrideQueue.splice(currentIdx, 1);
            }
        }
        return true;
    }

    function wayBeyond20HoldGameLogForCritical(entry, idx) {
        if (!entry?.ddbFulfilled || !entry?.rollData) return false;

        const existing = wayBeyond20ClearCriticalGameLogAggregate();
        if (existing?.ddbFulfilled) {
            try {
                if (messageBroker._mbDispatch) messageBroker._mbDispatch(existing.ddbFulfilled);
                else if (messageBroker._mb) messageBroker._mb.dispatch(existing.ddbFulfilled);
            } catch (e) {
                console.warn("WayBeyond20: failed to flush previous critical Game Log roll", e);
            }
        }

        if (entry.fallbackTimer) {
            clearTimeout(entry.fallbackTimer);
            entry.fallbackTimer = null;
        }

        const aggregate = {
            action: entry.action,
            request: entry.request || entry.rollData.request || {},
            rollData: entry.rollData,
            ddbFulfilled: entry.ddbFulfilled,
            fallbackTimer: null
        };

        wayBeyond20GameLogDebug("Critical Game Log normal phase held", {
            action: aggregate.action,
            normalRolls: wayBeyond20DescribeGameLogRolls(aggregate.rollData.rolls || []),
            expectedCriticalDamages: aggregate.request["critical-damages"] || [],
            damageTypes: aggregate.request["damage-types"] || [],
            criticalDamageTypes: aggregate.request["critical-damage-types"] || [],
            fallbackDelayMs: 6000
        });

        aggregate.fallbackTimer = setTimeout(() => {
            const pending = wayBeyond20ClearCriticalGameLogAggregate();
            if (!pending?.ddbFulfilled) return;
            wayBeyond20GameLogDebug("Critical Game Log hold expired; normal payload dispatched", {
                action: pending.action || "",
                normalRolls: wayBeyond20DescribeGameLogRolls(pending.rollData?.rolls || [])
            });
            try {
                if (messageBroker._mbDispatch) messageBroker._mbDispatch(pending.ddbFulfilled);
                else if (messageBroker._mb) messageBroker._mb.dispatch(pending.ddbFulfilled);
            } catch (e) {
                console.warn("WayBeyond20: failed to dispatch delayed critical Game Log fallback", e);
                wayBeyond20GameLogDebug("Critical Game Log delayed fallback failed", {
                    action: pending.action || "",
                    error: String(e?.message || e)
                });
            }
        }, 6000);

        window[WAYBEYOND20_CRITICAL_GAME_LOG_KEY] = aggregate;
        if (b20OverrideQueue[idx] === entry) b20OverrideQueue.splice(idx, 1);
        return true;
    }

    function _dispatchOriginalFulfilled(entry, idx) {
        try {
            if (!entry?.ddbFulfilled) return;
            if (messageBroker._mbDispatch) messageBroker._mbDispatch(entry.ddbFulfilled);
            else if (messageBroker._mb) messageBroker._mb.dispatch(entry.ddbFulfilled);
        } catch (e) {
            console.warn("WayBeyond20: failed to dispatch original fulfilled", e);
        } finally {
            b20OverrideQueue.splice(idx, 1);
        }
    }

    function _dispatchOverrideFulfilled(entry, idx) {
        try {
            if (entry.fallbackTimer) {
                clearTimeout(entry.fallbackTimer);
                entry.fallbackTimer = null;
            }

            const base = entry.ddbFulfilled;
            if (!base) return _dispatchOriginalFulfilled(entry, idx);
            if (!entry.rollData) return _dispatchOriginalFulfilled(entry, idx);

            const patched = cloneMessage(base);
            patched.data = patched.data || {};
            patched.data.action = normalizeActionName(entry.action || patched.data.action);
            patched.data.rolls = b20BuildDdbRollsForGameLog(
                entry.rollData.rolls || [],
                entry.request || {}
            );
            patched.data[B20_OVERRIDE_MARKER] = true;

            if (messageBroker._mbDispatch) messageBroker._mbDispatch(patched);
            else if (messageBroker._mb) messageBroker._mb.dispatch(patched);
        } catch (e) {
            console.warn("WayBeyond20: failed to dispatch override fulfilled", e);
            _dispatchOriginalFulfilled(entry, idx);
            return;
        } finally {
            const stillThere = b20OverrideQueue[idx] === entry;
            if (stillThere) b20OverrideQueue.splice(idx, 1);
        }
    }

    function _installB20OverrideHooksOnce() {
        if (window[HOOKS_INSTALLED_KEY]) return;
        window[HOOKS_INSTALLED_KEY] = true;

        const bindRollIdIfNeeded = (message) => {
            const head = b20OverrideQueue[0];
            const rid = message?.data?.rollId;
            if (!head || head.rollId || !rid) return;
            head.rollId = rid;
        };

        // Let deferred/pending flow normally so DDB can mint the native rollId/context
        messageBroker.on("dice/roll/deferred", bindRollIdIfNeeded, { once: false, send: true, recv: false });
        messageBroker.on("dice/roll/pending", bindRollIdIfNeeded, { once: false, send: true, recv: false });

        // Intercept fulfilled BEFORE it reaches the DDB game log.
        // Block rolls we initiated (we have queue entry), allow dice toolbox rolls through.
        messageBroker.on("dice/roll/fulfilled", (message) => {
            // Allow WayBeyond20 override messages through
            if (message?.data && message.data[B20_OVERRIDE_MARKER]) {
                return;
            }

            const rid = message?.data?.rollId;
            
            // Check if this rollId matches any of our queue entries
            let queueIdx = -1;
            if (rid && b20OverrideQueue.length) {
                queueIdx = b20OverrideQueue.findIndex(e => e.rollId === rid);
            }
            
            // If no matching queue entry, this is a dice toolbox roll - allow through
            if (queueIdx === -1) {
                return;
            }
            
            const entry = b20OverrideQueue[queueIdx];
            
            // Preserve digital dice result parsing
            try {
                if (typeof messageBroker._forwardDiceRollEvent === "function") {
                    messageBroker._forwardDiceRollEvent(message);
                }
            } catch (e) {
                console.warn("WayBeyond20: failed to forward fulfilled message to dice bridge", e);
            }

            if (!entry.rollId && rid) entry.rollId = rid;
            entry.ddbFulfilled = message;

            if (entry.rollData) {
                _dispatchOverrideFulfilled(entry, queueIdx);
                return false;
            }

            // No rollData yet, start fallback timer
            if (!entry.fallbackTimer) {
                entry.fallbackTimer = setTimeout(() => {
                    entry.fallbackTimer = null;
                    _dispatchOriginalFulfilled(entry, queueIdx);
                }, 2000);
            }
            
            // Block while we wait for rollData
            return false;
        }, { once: false, send: true, recv: true });
    }

    function pendingRoll(rollData) {
        if (!rollData) return;

        _installB20OverrideHooksOnce();

        b20OverrideQueue.push({
            action: normalizeActionName(rollData.name || "WayBeyond20"),
            rollId: null,
            rollData: null,
            ddbFulfilled: null,
            fallbackTimer: null,
            createdAt: Date.now(),
            request: rollData.request || {}
        });
    }

    function fulfilledRoll(rollData) {
        if (!rollData) return;

        const criticalAggregate = window[WAYBEYOND20_CRITICAL_GAME_LOG_KEY];
        if (criticalAggregate && wayBeyond20RollDataHasCriticalDamage(rollData)) {
            const currentEntry = b20OverrideQueue.length ? b20OverrideQueue[0] : null;
            return wayBeyond20DispatchCriticalGameLogAggregate(
                rollData,
                currentEntry,
                currentEntry ? 0 : -1
            );
        }

        if (!b20OverrideQueue.length) return;

        const entry = b20OverrideQueue[0];
        entry.rollData = rollData;

        if (rollData.request) {
            entry.request = { ...entry.request, ...rollData.request };
        }

        if (entry.ddbFulfilled) {
            if (!wayBeyond20RollDataHasCriticalDamage(rollData) &&
                wayBeyond20RollDataExpectsCriticalDamage(rollData)) {
                wayBeyond20HoldGameLogForCritical(entry, 0);
                return;
            }
            _dispatchOverrideFulfilled(entry, 0);
        }
    }


    function b20LimitedUseElementVisible(element) {
        if (!element || !element.isConnected) return false;
        const style = window.getComputedStyle ? window.getComputedStyle(element) : null;
        if (style && (style.display === "none" || style.visibility === "hidden")) return false;
        return !!(element.getClientRects && element.getClientRects().length);
    }

    function b20LimitedUseInputForControl(control) {
        if (!control) return null;
        if (control.matches?.("input[type='checkbox']")) return control;
        const nested = control.querySelector?.("input[type='checkbox']");
        if (nested) return nested;
        const forId = control.getAttribute?.("for");
        return forId ? document.getElementById(forId) : null;
    }

    function b20LimitedUseCanonicalControl(element) {
        if (!element) return null;
        return element.closest?.("[role='checkbox']") || element.closest?.("label") || element;
    }

    function b20LimitedUseControlUnused(control) {
        if (!control || control.disabled) return false;
        const input = b20LimitedUseInputForControl(control);
        if (input) return !input.checked && !input.disabled;
        const ariaChecked = control.getAttribute?.("aria-checked");
        if (ariaChecked !== null && ariaChecked !== undefined) return ariaChecked !== "true";
        const className = String(control.className || "").toLowerCase();
        return !/(checked|selected|active|used)/.test(className);
    }

    // Named limited-use ownership (brief 1.10). Same rule as content character.js
    // wayBeyond20LimitedUseControlOwnerLabel: a control belongs only to the feature named by the primary
    // label of its own nearest row; with no recognizable row, the nearest ancestor that adds a label owns
    // it only when that ancestor adds no other controls and carries exactly one distinct label.
    const B20_LIMITED_USE_LABEL_SELECTOR = ".ct-feature-snippet__heading,.ddbc-feature-snippet__heading,[class*='styles_heading']," +
        ".ct-combat-attack__label,.ddbc-combat-attack__label,.ct-sidebar__heading,h1,h2,h3,h4,h5,h6";
    const B20_LIMITED_USE_SELECTORS = {
        control: "[role='checkbox'][aria-label='use' i],input[type='checkbox'][aria-label='use' i]",
        row: ".ct-feature-snippet__option,.ddbc-feature-snippet__option,.ct-feature-snippet,.ddbc-feature-snippet," +
            "[class*='ct-feature-snippet--'],[class*='ddbc-feature-snippet--']," +
            ".ct-combat-attack,.ddbc-combat-attack,.b20-action-pane,.b20-custom-action-pane,.ct-custom-action-pane",
        label: B20_LIMITED_USE_LABEL_SELECTOR,
        fallbackLabel: "[class*='heading'],[class*='title'],[class*='name'],[class*='label']"
    };

    function b20LimitedUseLabelsWithin(node, control) {
        const ownedElsewhere = candidate => {
            const row = candidate.closest(B20_LIMITED_USE_SELECTORS.row);
            if (!row) return false;
            for (let current = control; current; current = current.parentElement) if (current === row) return false;
            return true;
        };
        const distinct = selector => Array.from(new Set(Array.from(node.querySelectorAll(selector))
            .filter(candidate => !ownedElsewhere(candidate))
            .map(b20LimitedUseLabelText)
            .filter(text => /[a-z]/.test(text))));
        const headings = distinct(B20_LIMITED_USE_SELECTORS.label);
        return headings.length ? headings : distinct(B20_LIMITED_USE_SELECTORS.fallbackLabel);
    }

    function b20NormalizeFeatureLabel(value) {
        return String(value || "")
            .replace(/[’']/g, "")
            .replace(/[^a-z0-9]+/gi, " ")
            .replace(/\s+/g, " ")
            .trim()
            .toLowerCase();
    }

    function b20LimitedUseLabelText(element) {
        if (!element) return "";
        const ownText = Array.from(element.childNodes || [])
            .filter(node => node.nodeType === 3)
            .map(node => node.textContent)
            .join(" ")
            .replace(/\s+/g, " ")
            .trim();
        return b20NormalizeFeatureLabel(ownText || element.textContent);
    }

    function b20LimitedUseControlOwnerLabel(control) {
        if (!control?.closest) return "";
        const selectors = B20_LIMITED_USE_SELECTORS;
        const row = control.closest(selectors.row);
        if (row) {
            const primary = Array.from(row.querySelectorAll(selectors.label)).find(candidate =>
                candidate.closest(selectors.row) === row && b20LimitedUseLabelText(candidate));
            if (primary) return b20LimitedUseLabelText(primary);
        }
        const controlsWithin = node => (node.matches?.(selectors.control) ? 1 : 0) +
            node.querySelectorAll(selectors.control).length;
        let node = row ? row.parentElement : control.parentElement;
        const groupControls = row ? controlsWithin(row) : (node ? controlsWithin(node) : 1);
        for (let depth = 0; node && depth < 12; depth++, node = node.parentElement) {
            const labels = b20LimitedUseLabelsWithin(node, control);
            if (labels.length === 0) continue;
            return controlsWithin(node) === groupControls && labels.length === 1 ? labels[0] : "";
        }
        return "";
    }

    function b20LimitedUseControlMatchesFeature(control, featureName) {
        const needle = b20NormalizeFeatureLabel(featureName);
        return !!needle && b20LimitedUseControlOwnerLabel(control) === needle;
    }

    function b20FindLimitedUseControls(featureName) {
        if (!b20NormalizeFeatureLabel(featureName)) return [];
        const raw = Array.from(document.querySelectorAll(B20_LIMITED_USE_SELECTORS.control));
        const unique = [];
        const seen = new Set();
        for (const element of raw) {
            const canonical = b20LimitedUseCanonicalControl(element);
            if (!canonical || seen.has(canonical) || !b20LimitedUseElementVisible(canonical)) continue;
            seen.add(canonical);
            unique.push(canonical);
        }
        // Never fall back to another labeled `use` control: no owned control means no match.
        return unique.filter(control => b20LimitedUseControlMatchesFeature(control, featureName));
    }

    function b20BuildSyntheticReactEvent(type, target, currentTarget) {
        const nativeEvent = new MouseEvent(type === "change" ? "click" : type, {
            bubbles: true,
            cancelable: true,
            composed: true,
            view: window,
            button: 0
        });
        return {
            type,
            target,
            currentTarget,
            nativeEvent,
            button: 0,
            buttons: 0,
            preventDefault: () => nativeEvent.preventDefault(),
            stopPropagation: () => nativeEvent.stopPropagation(),
            isDefaultPrevented: () => nativeEvent.defaultPrevented,
            isPropagationStopped: () => false,
            persist: () => {}
        };
    }

    function b20InvokeLimitedUseReactHandler(control, preferredHandler = null) {
        if (!control) return null;
        const input = b20LimitedUseInputForControl(control);
        const targets = [control, input, control.parentElement, input?.parentElement].filter((node, index, values) => node && values.indexOf(node) === index);
        const names = preferredHandler
            ? [preferredHandler]
            : ["onClick", "onChange", "onPointerUp", "onPointerDown"];
        const errors = [];

        const invokeFromProps = (props, node, depth, source) => {
            if (!props) return null;
            for (const handlerName of names) {
                if (typeof props[handlerName] !== "function") continue;
                const eventTarget = input || control;
                try {
                    props[handlerName](b20BuildSyntheticReactEvent(
                        handlerName === "onChange" ? "change" : handlerName.replace(/^on/, "").toLowerCase(),
                        eventTarget,
                        node
                    ));
                    return { handlerName, depth, source, tag: node.tagName, className: String(node.className || "") };
                } catch (error) {
                    errors.push({ handlerName, depth, source, error: String(error) });
                }
            }
            return null;
        };

        for (const startNode of targets) {
            let node = startNode;
            for (let depth = 0; node && depth < 8; depth++, node = node.parentElement) {
                const reactPropKeys = Object.keys(node).filter(key =>
                    key.startsWith("__reactProps$") || key.startsWith("__reactEventHandlers$")
                );
                for (const key of reactPropKeys) {
                    const invoked = invokeFromProps(node[key], node, depth, "dom-props");
                    if (invoked) return invoked;
                }

                const fiberKeys = Object.keys(node).filter(key => key.startsWith("__reactFiber$"));
                for (const key of fiberKeys) {
                    let fiber = node[key];
                    for (let fiberDepth = 0; fiber && fiberDepth < 12; fiberDepth++, fiber = fiber.return) {
                        for (const props of [fiber.memoizedProps, fiber.pendingProps]) {
                            const invoked = invokeFromProps(props, node, depth + fiberDepth, "fiber-props");
                            if (invoked) return invoked;
                        }
                    }
                }
            }
        }
        return errors.length ? { errors } : null;
    }

    async function b20WaitForLimitedUseChange(featureName, beforeUnused, attempts = 5) {
        let controls = b20FindLimitedUseControls(featureName);
        let afterUnused = controls.filter(b20LimitedUseControlUnused).length;
        for (let attempt = 0; attempt < attempts && afterUnused >= beforeUnused; attempt++) {
            await new Promise(resolve => setTimeout(resolve, 120));
            controls = b20FindLimitedUseControls(featureName);
            afterUnused = controls.filter(b20LimitedUseControlUnused).length;
        }
        return { controls, afterUnused, spent: controls.length > 0 && afterUnused < beforeUnused };
    }

    async function b20SpendLimitedUseInPage(featureName, requestedBeforeUnused) {
        let controls = b20FindLimitedUseControls(featureName);
        const detectedBeforeUnused = controls.filter(b20LimitedUseControlUnused).length;
        const beforeUnused = Number.isFinite(Number(requestedBeforeUnused)) && Number(requestedBeforeUnused) > 0
            ? Number(requestedBeforeUnused)
            : detectedBeforeUnused;
        if (controls.length > 0 && detectedBeforeUnused < beforeUnused) {
            return { spent: true, method: "already-spent", beforeUnused, afterUnused: detectedBeforeUnused, controlCount: controls.length };
        }

        let unused = controls.find(b20LimitedUseControlUnused);
        if (!unused) {
            return { spent: false, method: "no-unused-control", beforeUnused, afterUnused: detectedBeforeUnused, controlCount: controls.length };
        }

        const attempts = [];
        const verify = async method => {
            const result = await b20WaitForLimitedUseChange(featureName, beforeUnused, 4);
            attempts.push({ method, afterUnused: result.afterUnused });
            return result;
        };

        try {
            unused.scrollIntoView({ block: "nearest", inline: "nearest" });
            unused.focus?.({ preventScroll: true });
            unused.click();
        } catch (error) {
            attempts.push({ method: "main-native-click", error: String(error) });
        }
        let verification = await verify("main-native-click");
        if (verification.spent) return { spent: true, beforeUnused, afterUnused: verification.afterUnused, controlCount: verification.controls.length, method: "main-native-click", attempts };
        // Re-read immediately before each fallback so a late native change is never doubled.
        const spentLate = async method => {
            const fresh = await b20WaitForLimitedUseChange(featureName, beforeUnused, 0);
            return fresh.spent ? { spent: true, beforeUnused, afterUnused: fresh.afterUnused, controlCount: fresh.controls.length, method: `${method}-late`, attempts } : null;
        };
        let late = await spentLate("main-native-click");
        if (late) return late;

        controls = verification.controls;
        unused = controls.find(b20LimitedUseControlUnused);
        const input = b20LimitedUseInputForControl(unused);
        if (input && typeof HTMLInputElement !== "undefined") {
            try {
                const checkedSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "checked")?.set;
                if (checkedSetter) checkedSetter.call(input, true);
                else input.checked = true;
                input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
                input.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
            } catch (error) {
                attempts.push({ method: "main-input-change", error: String(error) });
            }
            verification = await verify("main-input-change");
            if (verification.spent) return { spent: true, beforeUnused, afterUnused: verification.afterUnused, controlCount: verification.controls.length, method: "main-input-change", attempts };
            late = await spentLate("main-input-change");
            if (late) return late;
        }

        controls = verification.controls;
        unused = controls.find(b20LimitedUseControlUnused);
        const clickHandler = b20InvokeLimitedUseReactHandler(unused, "onClick");
        attempts.push({ method: "react-onClick", handler: clickHandler });
        verification = await b20WaitForLimitedUseChange(featureName, beforeUnused, 5);
        if (verification.spent) return { spent: true, beforeUnused, afterUnused: verification.afterUnused, controlCount: verification.controls.length, method: "react-onClick", attempts };
        late = await spentLate("react-onClick");
        if (late) return late;

        controls = verification.controls;
        unused = controls.find(b20LimitedUseControlUnused);
        const changeHandler = b20InvokeLimitedUseReactHandler(unused, "onChange");
        attempts.push({ method: "react-onChange", handler: changeHandler });
        verification = await b20WaitForLimitedUseChange(featureName, beforeUnused, 5);
        return { spent: verification.spent, beforeUnused, afterUnused: verification.afterUnused, controlCount: verification.controls.length, method: verification.spent ? "react-onChange" : "failed", attempts };
    }

    // A request delivered twice (a duplicated event or listener) must not spend twice.
    const b20HandledLimitedUseRequests = new Set();

    function spendLimitedUse(requestId, featureName, beforeUnused) {
        if (requestId && b20HandledLimitedUseRequests.has(requestId)) return;
        if (requestId) b20HandledLimitedUseRequests.add(requestId);
        b20SpendLimitedUseInPage(featureName, beforeUnused)
            .then(result => sendCustomEvent("WayBeyond20LimitedUseResult", [requestId, result]))
            .catch(error => sendCustomEvent("WayBeyond20LimitedUseResult", [requestId, {
                spent: false,
                method: "exception",
                error: String(error)
            }]));
    }

    function b20SpellSlotHeaderLevel(header) {
        const text = String(header?.textContent || "").replace(/\s+/g, " ").trim();
        const match = text.match(/\b(\d+)(?:st|nd|rd|th)\s+level\b/i);
        return match ? parseInt(match[1]) : null;
    }

    function b20SpellSlotControls(level) {
        const desiredLevel = parseInt(level);
        if (!Number.isFinite(desiredLevel) || desiredLevel < 1) return [];
        const headers = Array.from(document.querySelectorAll(
            ".ct-content-group__header,.ddbc-content-group__header,[class*='contentGroup'][class*='header']"
        ));
        const header = headers.find(candidate => b20SpellSlotHeaderLevel(candidate) === desiredLevel);
        if (!header) return [];
        return Array.from(header.querySelectorAll(
            "[role='checkbox'][aria-label='use' i],input[type='checkbox'][aria-label='use' i]"
        )).map(b20LimitedUseCanonicalControl).filter((control, index, controls) =>
            control && controls.indexOf(control) === index
        );
    }

    function b20SpellSlotAvailable(control) {
        return b20LimitedUseControlUnused(control);
    }

    async function b20WaitForSpellSlotChange(level, mode, beforeAvailable, attempts = 6) {
        let controls = b20SpellSlotControls(level);
        let afterAvailable = controls.filter(b20SpellSlotAvailable).length;
        const changed = () => mode === "restore"
            ? afterAvailable > beforeAvailable
            : afterAvailable < beforeAvailable;
        for (let attempt = 0; attempt < attempts && !changed(); attempt++) {
            await new Promise(resolve => setTimeout(resolve, 120));
            controls = b20SpellSlotControls(level);
            afterAvailable = controls.filter(b20SpellSlotAvailable).length;
        }
        return { controls, afterAvailable, changed: controls.length > 0 && changed() };
    }

    async function b20ChangeSpellSlotInPage(level, mode = "spend", requestedBeforeAvailable = null) {
        let controls = b20SpellSlotControls(level);
        const detectedBeforeAvailable = controls.filter(b20SpellSlotAvailable).length;
        const beforeAvailable = Number.isFinite(Number(requestedBeforeAvailable))
            ? Number(requestedBeforeAvailable)
            : detectedBeforeAvailable;
        const desiredControl = controls.find(control => mode === "restore"
            ? !b20SpellSlotAvailable(control)
            : b20SpellSlotAvailable(control));
        if (!desiredControl) {
            return { changed: false, method: "no-eligible-control", level, mode, beforeAvailable, afterAvailable: detectedBeforeAvailable };
        }

        const attempts = [];
        const verify = async method => {
            const result = await b20WaitForSpellSlotChange(level, mode, beforeAvailable, 5);
            attempts.push({ method, afterAvailable: result.afterAvailable });
            return result;
        };
        try {
            desiredControl.scrollIntoView?.({ block: "nearest", inline: "nearest" });
            desiredControl.focus?.({ preventScroll: true });
            desiredControl.click();
        } catch (error) {
            attempts.push({ method: "main-native-click", error: String(error) });
        }
        let verification = await verify("main-native-click");
        if (verification.changed) return { changed: true, level, mode, beforeAvailable, afterAvailable: verification.afterAvailable, method: "main-native-click", attempts };
        // Re-read immediately before each fallback so a late native change is never doubled.
        const changedLate = async method => {
            const fresh = await b20WaitForSpellSlotChange(level, mode, beforeAvailable, 0);
            return fresh.changed ? { changed: true, level, mode, beforeAvailable, afterAvailable: fresh.afterAvailable, method: `${method}-late`, attempts } : null;
        };
        let late = await changedLate("main-native-click");
        if (late) return late;

        controls = verification.controls;
        const retryControl = controls.find(control => mode === "restore"
            ? !b20SpellSlotAvailable(control)
            : b20SpellSlotAvailable(control));
        const input = b20LimitedUseInputForControl(retryControl);
        if (input && typeof HTMLInputElement !== "undefined") {
            try {
                const checkedSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "checked")?.set;
                const checked = mode !== "restore";
                if (checkedSetter) checkedSetter.call(input, checked);
                else input.checked = checked;
                input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
                input.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
            } catch (error) {
                attempts.push({ method: "main-input-change", error: String(error) });
            }
            verification = await verify("main-input-change");
            if (verification.changed) return { changed: true, level, mode, beforeAvailable, afterAvailable: verification.afterAvailable, method: "main-input-change", attempts };
            late = await changedLate("main-input-change");
            if (late) return late;
        }

        controls = verification.controls;
        const reactControl = controls.find(control => mode === "restore"
            ? !b20SpellSlotAvailable(control)
            : b20SpellSlotAvailable(control));
        const clickHandler = b20InvokeLimitedUseReactHandler(reactControl, "onClick");
        attempts.push({ method: "react-onClick", handler: clickHandler });
        verification = await b20WaitForSpellSlotChange(level, mode, beforeAvailable, 6);
        if (verification.changed) return { changed: true, level, mode, beforeAvailable, afterAvailable: verification.afterAvailable, method: "react-onClick", attempts };
        late = await changedLate("react-onClick");
        if (late) return late;

        const changeHandler = b20InvokeLimitedUseReactHandler(reactControl, "onChange");
        attempts.push({ method: "react-onChange", handler: changeHandler });
        verification = await b20WaitForSpellSlotChange(level, mode, beforeAvailable, 6);
        return { changed: verification.changed, level, mode, beforeAvailable, afterAvailable: verification.afterAvailable, method: verification.changed ? "react-onChange" : "failed", attempts };
    }

    function changeSpellSlot(requestId, level, mode, beforeAvailable) {
        b20ChangeSpellSlotInPage(level, mode, beforeAvailable)
            .then(result => sendCustomEvent("WayBeyond20SpellSlotResult", [requestId, result]))
            .catch(error => sendCustomEvent("WayBeyond20SpellSlotResult", [requestId, {
                changed: false,
                method: "exception",
                error: String(error)
            }]));
    }

    function b20PaladinSmiteUseEntry() {
        const rows = Array.from(document.querySelectorAll(".ct-spells-spell,.ddbc-spells-spell"));
        for (const row of rows) {
            const name = String(row.querySelector(
                ".ct-spells-spell__label,.ddbc-spells-spell__label,[class*='spellName']"
            )?.textContent || "").replace(/\s+/g, " ").trim();
            const meta = String(row.querySelector(
                ".ct-spells-spell__meta,.ddbc-spells-spell__meta,[class*='spellMeta']"
            )?.textContent || "").replace(/\s+/g, " ").trim();
            const text = String(row.textContent || "").replace(/\s+/g, " ").trim();
            if (name.toLowerCase() !== "divine smite" ||
                !/paladin.?s smite/i.test(meta.replace(/[’']/g, "'")) ||
                !/1\s*\/\s*(?:lr|long\s+rest)/i.test(text)) continue;
            const button = Array.from(row.querySelectorAll("button")).find(candidate =>
                /^use$/i.test(String(candidate.textContent || "").replace(/\s+/g, " ").trim()));
            if (button) return { row, button };
        }
        return null;
    }

    // D&D Beyond keeps the row and its "Use" label once spent and shows "1/LR (Used)".
    function b20PaladinSmiteUseIsUsed(entry) {
        if (!entry || !entry.row || !entry.row.isConnected) return false;
        const text = String(entry.row.textContent || "").replace(/\s+/g, " ");
        return /\(\s*used\s*\)/i.test(text) ||
            !!(entry.button && (entry.button.disabled || entry.button.getAttribute("aria-disabled") === "true"));
    }

    function b20PaladinSmiteUseAvailable(entry = b20PaladinSmiteUseEntry()) {
        if (!entry || !entry.button || !entry.button.isConnected) return false;
        return !b20PaladinSmiteUseIsUsed(entry);
    }

    async function b20SpendPaladinSmiteUseInPage() {
        let entry = b20PaladinSmiteUseEntry();
        if (!b20PaladinSmiteUseAvailable(entry)) return { spent: false, method: "no-available-use" };
        const attempts = [];
        // Success is the mounted row showing the use as spent. A row that disappeared
        // (tab change, re-render) proves nothing and is not success.
        const verify = async method => {
            for (let attempt = 0; attempt < 8; attempt++) {
                await new Promise(resolve => setTimeout(resolve, 120));
                entry = b20PaladinSmiteUseEntry();
                if (b20PaladinSmiteUseIsUsed(entry)) return { spent: true, method, attempts };
            }
            return null;
        };
        try {
            entry.button.scrollIntoView?.({ block: "nearest", inline: "nearest" });
            entry.button.focus?.({ preventScroll: true });
            entry.button.click();
        } catch (error) {
            attempts.push({ method: "main-native-click", error: String(error) });
        }
        let result = await verify("main-native-click");
        if (result) return result;

        entry = b20PaladinSmiteUseEntry();
        if (!b20PaladinSmiteUseAvailable(entry)) return { spent: false, method: "row-unavailable-after-click", attempts };
        const clickHandler = b20InvokeLimitedUseReactHandler(entry.button, "onClick");
        attempts.push({ method: "react-onClick", handler: clickHandler });
        result = await verify("react-onClick");
        return result || { spent: false, method: "failed", attempts };
    }

    function spendPaladinSmiteUse(requestId) {
        b20SpendPaladinSmiteUseInPage()
            .then(result => sendCustomEvent("WayBeyond20PaladinSmiteUseResult", [requestId, result]))
            .catch(error => sendCustomEvent("WayBeyond20PaladinSmiteUseResult", [requestId, {
                spent: false,
                method: "exception",
                error: String(error)
            }]));
    }

    function disconnectAllEvents() {
        const registeredEvents = window[EVENTS_KEY] || [];

        for (const event of registeredEvents) {
            document.removeEventListener(...event);
        }

        for (const entry of b20OverrideQueue) {
            if (entry?.fallbackTimer) {
                clearTimeout(entry.fallbackTimer);
                entry.fallbackTimer = null;
            }
        }
        wayBeyond20ClearCriticalGameLogAggregate();

        b20OverrideQueue.length = 0;
        window[EVENTS_KEY] = [];
        window.__beyond20_mb2_initialized__ = false;

        messageBroker.unregister();
    }

    const registered_events = [];
    registered_events.push(addCustomEventListener("rendered-roll", sendRollToGameLog));
    registered_events.push(addCustomEventListener("roll", sendRollToGameLog));
    registered_events.push(addCustomEventListener("MBPendingRoll", pendingRoll));
    registered_events.push(addCustomEventListener("MBFulfilledRoll", fulfilledRoll));
    registered_events.push(addCustomEventListener("WayBeyond20SpendLimitedUse", spendLimitedUse));
    registered_events.push(addCustomEventListener("WayBeyond20ChangeSpellSlot", changeSpellSlot));
    registered_events.push(addCustomEventListener("WayBeyond20SpendPaladinSmiteUse", spendPaladinSmiteUse));
    registered_events.push(addCustomEventListener("disconnect", disconnectAllEvents));

    window[EVENTS_KEY] = registered_events;
    
    // Install hooks immediately so we can intercept messages from other players
    _installB20OverrideHooksOnce();
}
