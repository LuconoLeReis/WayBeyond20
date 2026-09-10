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

    function b20LimitedUseControlMatchesFeature(control, featureName) {
        const needle = String(featureName || "").replace(/\s+/g, " ").trim().toLowerCase();
        if (!control || !needle) return false;
        let node = control;
        for (let depth = 0; node && depth < 12; depth++, node = node.parentElement) {
            const text = String(node.textContent || "").replace(/\s+/g, " ").trim().toLowerCase();
            if (!text.includes(needle)) continue;
            const localControls = node.querySelectorAll?.("[role='checkbox'][aria-label='use' i], input[type='checkbox'][aria-label='use' i]").length || 0;
            if (localControls > 0 && localControls <= 12) return true;
        }
        return false;
    }

    function b20FindLimitedUseControls(featureName) {
        const raw = Array.from(document.querySelectorAll(
            "[role='checkbox'][aria-label='use' i], input[type='checkbox'][aria-label='use' i]"
        ));
        const unique = [];
        const seen = new Set();
        for (const element of raw) {
            const canonical = b20LimitedUseCanonicalControl(element);
            if (!canonical || seen.has(canonical) || !b20LimitedUseElementVisible(canonical)) continue;
            seen.add(canonical);
            unique.push(canonical);
        }
        const featureControls = unique.filter(control => b20LimitedUseControlMatchesFeature(control, featureName));
        const labeledUseControls = unique.filter(control => {
            const input = b20LimitedUseInputForControl(control);
            return String(control.getAttribute?.("aria-label") || "").toLowerCase() === "use" ||
                String(input?.getAttribute?.("aria-label") || "").toLowerCase() === "use";
        });
        return featureControls.length ? featureControls : (featureName ? [] : labeledUseControls);
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
        }

        controls = verification.controls;
        unused = controls.find(b20LimitedUseControlUnused);
        const clickHandler = b20InvokeLimitedUseReactHandler(unused, "onClick");
        attempts.push({ method: "react-onClick", handler: clickHandler });
        verification = await b20WaitForLimitedUseChange(featureName, beforeUnused, 5);
        if (verification.spent) return { spent: true, beforeUnused, afterUnused: verification.afterUnused, controlCount: verification.controls.length, method: "react-onClick", attempts };

        controls = verification.controls;
        unused = controls.find(b20LimitedUseControlUnused);
        const changeHandler = b20InvokeLimitedUseReactHandler(unused, "onChange");
        attempts.push({ method: "react-onChange", handler: changeHandler });
        verification = await b20WaitForLimitedUseChange(featureName, beforeUnused, 5);
        return { spent: verification.spent, beforeUnused, afterUnused: verification.afterUnused, controlCount: verification.controls.length, method: verification.spent ? "react-onChange" : "failed", attempts };
    }

    function spendLimitedUse(requestId, featureName, beforeUnused) {
        b20SpendLimitedUseInPage(featureName, beforeUnused)
            .then(result => sendCustomEvent("WayBeyond20LimitedUseResult", [requestId, result]))
            .catch(error => sendCustomEvent("WayBeyond20LimitedUseResult", [requestId, {
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
    registered_events.push(addCustomEventListener("disconnect", disconnectAllEvents));

    window[EVENTS_KEY] = registered_events;
    
    // Install hooks immediately so we can intercept messages from other players
    _installB20OverrideHooksOnce();
}