console.log("WayBeyond20: D&D Beyond module loaded.");

async function sendRollWithCharacter(rollType, fallback, args) {
    const resourceRequest = args && args["waybeyond20-turn-resource"];
    if (resourceRequest) {
        delete args["waybeyond20-turn-resource"];
        const allowed = await wayBeyond20UseTurnResource(resourceRequest.resource, {
            name: resourceRequest.name || args.name || fallback,
            rollType: resourceRequest.rollType || rollType
        });
        if (!allowed) return null;
    }
    let stealthEffect = null;
    if (args && ["attack", "spell-attack"].includes(rollType) && args["to-hit"]) {
        stealthEffect = wayBeyond20GetTrackedSpellEffects().find(effect => {
            const conditions = Array.isArray(effect && effect.conditions) ? effect.conditions : [];
            return wayBeyond20EffectName(effect) === "stealth" &&
                conditions.some(condition => String(condition || "").trim().toLowerCase() === "invisible");
        }) || null;
        if (stealthEffect) {
            adjustRollAndKeyModifiersWithAdvantage(args);
            addEffect(args, `Hidden (Stealth ${stealthEffect.hideDc ?? stealthEffect.checkTotal ?? ""})`.trim());
        }
    }
    if (args && ["attack", "spell-attack"].includes(rollType)) {
        wayBeyond20ApplyDrainingAttackIntent(args, args.name || fallback);
    }
    wayBeyond20CharacterDebug("Roll request prepared", {
        rollType,
        fallback,
        name: args ? args.name : null,
        drainingAttackIntent: args ? args["waybeyond20-temp-hp-on-hit"] : null
    });
    const preview = $(".ct-sidebar__header-preview > div").css('background-image');
    if (preview && preview.startsWith("url("))
        args.preview = preview.slice(5, -2);
    // Add halfling luck
    if ((character.hasRacialTrait("Lucky") || character.hasRacialTrait("Luck")) && character.getSetting("halfling-lucky", false) &&
        ["skill", "ability", "saving-throw", "death-save", "initiative", "attack", "spell-attack"].includes(rollType)) {
        args.d20 = args.d20 || "1d20";
        args.d20 += "ro<=1";
    }
    const result = await sendRoll(character, rollType, fallback, args);
    if (stealthEffect) {
        wayBeyond20RemoveTrackedEffect(wayBeyond20EffectKey(stealthEffect));
    }
    return result;
}

function addEffect(rollProperties, effect) {
    rollProperties["effects"] = rollProperties["effects"] || [];
    if (!rollProperties["effects"].includes(effect)) {
        rollProperties["effects"].push(effect);
    }
}

function wayBeyond20CharacterDebug(event, details = null) {
    if (!settings || !settings["waybeyond20-debug-log"]) return;
    wayBeyond20DebugLog("D&D Beyond Character", event, {
        character: character ? { id: character._id, name: character._name } : null,
        details
    }, true);
}

function wayBeyond20InstallGameLogDebugRelay() {
    if (window.__waybeyond20_game_log_debug_listener__) return;
    window.__waybeyond20_game_log_debug_listener__ = addCustomEventListener(
        "WayBeyond20GameLogDebug",
        (event, details) => {
            if (!settings || !settings["waybeyond20-debug-log"]) return;
            wayBeyond20DebugLog("D&D Beyond Game Log", event, {
                character: character ? { id: character._id, name: character._name } : null,
                details
            }, true);
        }
    );
}

function wayBeyond20DescribeElement(element) {
    const node = element && element.jquery ? element[0] : element;
    if (!node) return null;
    const attributes = {};
    for (const name of ["id", "class", "name", "type", "role", "aria-label", "aria-checked", "data-testid", "placeholder"]) {
        if (node.getAttribute && node.getAttribute(name) !== null) attributes[name] = node.getAttribute(name);
    }
    return {
        tag: node.tagName || node.nodeName || "",
        attributes,
        value: node.value !== undefined ? node.value : undefined,
        checked: node.checked !== undefined ? node.checked : undefined,
        text: String(node.textContent || "").replace(/\s+/g, " ").trim().slice(0, 240)
    };
}

function wayBeyond20ConfirmChoice(title, message, yesLabel="Yes", noLabel="No") {
    return new Promise(resolve => {
        if (typeof alertify !== "undefined" && alertify && alertify.confirm) {
            const dialog = alertify.confirm(title, message, () => resolve(true), () => resolve(false));
            if (dialog && dialog.set) dialog.set("labels", { ok: yesLabel, cancel: noLabel });
            return;
        }
        resolve(window.confirm(message));
    });
}

function wayBeyond20FormatSignedNumber(value) {
    const parsed = parseInt(value || 0);
    return parsed >= 0 ? `+${parsed}` : `${parsed}`;
}

function wayBeyond20BedsideFormulaForDDB(formula) {
    let changed = false;
    return String(formula || "").replace(/(\d*)d(\d+)((?:ro<=\d+|min\d+)*)/i, (match, amount, faces, modifiers) => {
        if (changed) return match;
        const count = parseInt(amount || "1");
        if (!Number.isFinite(count) || count <= 0) return match;
        changed = true;
        return `${count + 1}d${faces}${modifiers || ""}kh${count}`;
    });
}

function wayBeyond20ApplyBedsideMannerIntent(roll_properties, field="damages") {
    if (!roll_properties || !character || !character.hasFeat("Triage Expert", true)) return;

    if (field === "hit-dice") {
        const formula = String(roll_properties["hit-dice"] || "");
        if (!/\d*d\d+/i.test(formula)) return;
        const rendered = wayBeyond20BedsideFormulaForDDB(formula);
        roll_properties["waybeyond20-bedside-manner"] = {
            mode: "extra-die-drop-lowest",
            field: "hit-dice",
            original: formula,
            renderedTarget: "dndbeyond",
            changed: rendered !== formula ? [{ field: "hit-dice", from: formula, to: rendered }] : []
        };
        roll_properties["hit-dice"] = rendered;
        addEffect(roll_properties, "Triage Expert: Bedside Manner");
        return;
    }

    const damages = Array.isArray(roll_properties.damages) ? roll_properties.damages : [];
    const damageTypes = Array.isArray(roll_properties["damage-types"]) ? roll_properties["damage-types"] : [];
    const selectedIndex = damages.findIndex((formula, index) =>
        /\d*d\d+/i.test(String(formula || "")) && String(damageTypes[index] || "").toLowerCase().includes("healing")
    );
    if (selectedIndex < 0) return;

    const original = damages[selectedIndex];
    const rendered = wayBeyond20BedsideFormulaForDDB(original);
    roll_properties["waybeyond20-bedside-manner"] = {
        mode: "extra-die-drop-lowest",
        field: "damages",
        selectedHealingIndexes: [selectedIndex],
        originalHealing: [{
            index: selectedIndex,
            formula: original,
            type: damageTypes[selectedIndex] || "Healing"
        }],
        renderedTarget: "dndbeyond",
        changed: rendered !== original ? [{
            index: selectedIndex,
            from: original,
            to: rendered,
            type: damageTypes[selectedIndex] || "Healing"
        }] : []
    };
    damages[selectedIndex] = rendered;
    addEffect(roll_properties, "Triage Expert: Bedside Manner");
}

function wayBeyond20SetReactInputValue(input, value) {
    const prototype = Object.getPrototypeOf(input);
    const descriptor = Object.getOwnPropertyDescriptor(prototype, "value") ||
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
    if (descriptor && descriptor.set) descriptor.set.call(input, String(value));
    else input.value = String(value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
}

function wayBeyond20FindTempHpInput() {
    const direct = $(
        ".b20-health-manage-pane input[data-testid*='temp' i], " +
        ".b20-health-manage-pane input[name*='temp' i], " +
        ".b20-health-manage-pane input[aria-label*='temp' i], " +
        ".b20-health-manage-pane div[class*='temp' i] input, " +
        ".ct-health-manager input[data-testid*='temp' i], " +
        ".ct-health-manager input[name*='temp' i], " +
        ".ct-health-manager input[aria-label*='temp' i], " +
        ".ct-sidebar__portal div[class*='temp' i] input, " +
        ".ct-quick-info__health input[data-testid*='temp' i], " +
        ".ct-quick-info__health input[name*='temp' i], " +
        ".ct-quick-info__health input[aria-label*='temp' i], " +
        "[role='dialog'] input[data-testid*='temp' i], " +
        "[role='dialog'] input[name*='temp' i], " +
        "[role='dialog'] input[aria-label*='temp' i]"
    ).filter(":visible").first();
    if (direct.length) return direct;

    const candidates = $(
        ".b20-health-manage-pane input, .ct-health-manager input, .ct-sidebar__portal input, " +
        ".ct-quick-info__health input, .ct-health-summary__hp-group--temp input, " +
        ".ct-health-summary__hp-item--temp input, [role='dialog'] input"
    ).filter(":visible");
    let best = null;
    let bestScore = 0;
    candidates.each((_, element) => {
        const input = $(element);
        let score = 0;
        const attributes = [
            input.attr("name"),
            input.attr("aria-label"),
            input.attr("data-testid"),
            input.attr("placeholder"),
            input.attr("class")
        ].filter(Boolean).join(" ").toLowerCase();
        if (/temp(?:orary)?[ _-]*(?:hp|hit)/.test(attributes)) score += 100;
        else if (attributes.includes("temp")) score += 70;

        const id = input.attr("id");
        if (id) {
            const labelText = $(`label[for='${CSS.escape(id)}']`).first().text().replace(/\s+/g, " ").trim().toLowerCase();
            if (labelText.includes("temp")) score += 100;
        }
        if (element.labels) {
            const labelText = Array.from(element.labels).map(label => label.textContent || "").join(" ").toLowerCase();
            if (labelText.includes("temp")) score += 100;
        }

        let ancestor = input.parent();
        for (let depth = 0; depth < 4 && ancestor.length; depth++) {
            const className = String(ancestor.attr("class") || "").toLowerCase();
            if (className.includes("temp")) score += 60 - (depth * 10);
            const localText = ancestor.children("label,span,div").slice(0, 4).text().replace(/\s+/g, " ").trim().toLowerCase();
            if (/\btemp(?:orary)?(?: hit points| hp)?\b/.test(localText)) score += 40 - (depth * 8);
            ancestor = ancestor.parent();
        }

        if (score > bestScore) {
            bestScore = score;
            best = element;
        }
    });
    return bestScore >= 40 ? $(best) : $();
}

function wayBeyond20FindTempHpHealthRoots() {
    const roots = [];
    const add = element => {
        const node = element && element.jquery ? element[0] : element;
        if (!node || !wayBeyond20IsVisibleElement(node) || roots.includes(node)) return;
        roots.push(node);
    };

    $(".ct-quick-info__health, .ct-health-summary__hp-group--primary, [data-testid*='hit-points' i]")
        .filter(":visible").each((_, element) => add(element));

    // D&D Beyond's current compact HP block uses generated class names. Anchor the
    // search to the native Heal/Damage controls and walk upward to the smallest
    // container that also contains Current and Temp value buttons.
    const controls = $("button,[role='button']").filter((_, element) => wayBeyond20IsVisibleElement(element));
    const healControls = controls.filter((_, element) => {
        return $(element).text().replace(/\s+/g, " ").trim().toLowerCase() === "heal";
    });
    healControls.each((_, healElement) => {
        let container = $(healElement).parent();
        for (let depth = 0; depth < 10 && container.length; depth++) {
            const text = container.text().replace(/\s+/g, " ").trim();
            const hasDamage = container.find("button,[role='button']").filter((_, element) => {
                return wayBeyond20IsVisibleElement(element) &&
                    $(element).text().replace(/\s+/g, " ").trim().toLowerCase() === "damage";
            }).length > 0;
            const valueButtons = container.find("button[class*='valueButton'], [role='button'][class*='valueButton']")
                .filter((_, element) => wayBeyond20IsVisibleElement(element));
            if (hasDamage && valueButtons.length === 2 && /\bcurrent\b/i.test(text) && /\btemp\b/i.test(text)) {
                add(container[0]);
                break;
            }
            container = container.parent();
        }
    });

    return roots;
}

function wayBeyond20FindTempHpOpeners(currentValue = null) {
    const candidates = [];
    const add = element => {
        const node = element && element.jquery ? element[0] : element;
        if (!node || !wayBeyond20IsVisibleElement(node) || candidates.includes(node)) return;
        candidates.push(node);
    };

    const addAssociatedValueButton = labelElement => {
        const label = $(labelElement);
        const isValueButton = (_, element) => {
            if (!wayBeyond20IsVisibleElement(element)) return false;
            const text = wayBeyond20ElementOwnText(element).replace(/\s+/g, " ").trim();
            const className = String($(element).attr("class") || "").toLowerCase();
            return /^\d+$/.test(text) || className.includes("valuebutton");
        };

        // D&D Beyond renders an existing Temporary HP value as a separate numeric
        // button beside the TEMP label. Prefer that button because clicking the label
        // itself only works while no Temporary HP value is present.
        label.siblings("button,[role='button']").filter(isValueButton).each((_, element) => add(element));

        let container = label.parent();
        for (let depth = 0; depth < 5 && container.length; depth++) {
            const hasTempLabel = container.find("span,div,button,[role='button']").addBack().filter((_, element) => {
                const text = wayBeyond20ElementOwnText(element).replace(/\s+/g, " ").trim().toUpperCase();
                return ["TEMP", "TEMP HP", "TEMPORARY HP"].includes(text);
            }).length > 0;
            if (!hasTempLabel) break;

            const valueButtons = container.find("button,[role='button']").filter(isValueButton);
            if (valueButtons.length === 1) {
                add(valueButtons[0]);
                break;
            }
            container = container.parent();
        }
    };

    // D&D Beyond's current sheet opens the editor by clicking the word TEMP itself.
    // Prefer that exact label before generic health containers, which can open the wrong pane.
    const tempLabels = $("span,div,button,[role='button']").filter((_, element) => {
        const ownText = wayBeyond20ElementOwnText(element).replace(/\s+/g, " ").trim().toUpperCase();
        return wayBeyond20IsVisibleElement(element) && ["TEMP", "TEMP HP", "TEMPORARY HP"].includes(ownText);
    });
    tempLabels.each((_, element) => addAssociatedValueButton(element));
    tempLabels.each((_, element) => add(element));

    $(
        ".ct-health-summary__hp-group--temp, .ct-health-summary__hp-item--temp, " +
        "button[class*='temp' i], [role='button'][class*='temp' i], " +
        "[data-testid*='temp' i][role='button']"
    ).filter(":visible").each((_, element) => add(element));

    const healthRoots = wayBeyond20FindTempHpHealthRoots();
    const health = $(healthRoots);
    health.find("button,[role='button'],span,div").filter((_, element) => {
        const text = wayBeyond20ElementOwnText(element).replace(/\s+/g, " ").trim().toUpperCase();
        return ["TEMP", "TEMP HP", "TEMPORARY HP"].includes(text);
    }).each((_, element) => add(element));

    // When Temporary HP already has a value, D&D Beyond removes the temp-specific
    // class and renders both Current HP and Temporary HP as generic numeric buttons.
    // Find the smallest ancestor that labels one of those buttons as TEMP. The Current
    // HP button never qualifies because its local group does not contain that label.
    health.each((_, healthElement) => {
        const healthNode = $(healthElement);
        const valueButtons = healthNode.find("button[class*='valueButton'], [role='button'][class*='valueButton']")
            .filter((_, element) => wayBeyond20IsVisibleElement(element));
        valueButtons.each((_, buttonElement) => {
            let container = $(buttonElement).parent();
            for (let depth = 0; depth < 6 && container.length && container[0] !== healthElement; depth++) {
                const text = container.text().replace(/\s+/g, " ").trim();
                const localValueButtons = container.find("button[class*='valueButton'], [role='button'][class*='valueButton']")
                    .filter((_, element) => wayBeyond20IsVisibleElement(element));
                if (/\btemp(?:orary)?(?:\s*(?:hp|hit points))?\b/i.test(text) && localValueButtons.length === 1) {
                    add(buttonElement);
                    break;
                }
                container = container.parent();
            }
        });

        // Current D&D Beyond sheets expose exactly two generic value buttons in the
        // compact health block: Current HP first, Temporary HP second. Use that order
        // only as a tightly constrained fallback when both labels are present.
        const healthText = healthNode.text().replace(/\s+/g, " ").trim();
        if (valueButtons.length === 2 && /\bcurrent\b/i.test(healthText) && /\btemp\b/i.test(healthText)) {
            const expectedCurrent = Number.isFinite(parseInt(currentValue)) ? String(parseInt(currentValue)) : null;
            const currentMatches = expectedCurrent === null ? $() : valueButtons.filter((_, element) => {
                return wayBeyond20ElementOwnText(element).replace(/\s+/g, " " ).trim() === expectedCurrent;
            });
            if (currentMatches.length === 1) add(currentMatches[0]);
            else add(valueButtons[1]);
        }
    });

    // Last-resort structural fallback for generated-class D&D Beyond layouts: when
    // exactly two visible value buttons exist beside native Heal and Damage controls,
    // the second is Temporary HP. Prefer a unique match to the currently parsed temp
    // value so the Current HP button cannot be selected accidentally.
    if (!candidates.length) {
        const allValueButtons = $("button[class*='valueButton'], [role='button'][class*='valueButton']")
            .filter((_, element) => wayBeyond20IsVisibleElement(element));
        const hasHeal = $("button,[role='button']").filter((_, element) => {
            return wayBeyond20IsVisibleElement(element) &&
                $(element).text().replace(/\s+/g, " " ).trim().toLowerCase() === "heal";
        }).length > 0;
        const hasDamage = $("button,[role='button']").filter((_, element) => {
            return wayBeyond20IsVisibleElement(element) &&
                $(element).text().replace(/\s+/g, " " ).trim().toLowerCase() === "damage";
        }).length > 0;
        if (hasHeal && hasDamage && allValueButtons.length === 2) {
            const expectedCurrent = Number.isFinite(parseInt(currentValue)) ? String(parseInt(currentValue)) : null;
            const currentMatches = expectedCurrent === null ? $() : allValueButtons.filter((_, element) => {
                return wayBeyond20ElementOwnText(element).replace(/\s+/g, " " ).trim() === expectedCurrent;
            });
            if (currentMatches.length === 1) add(currentMatches[0]);
            else add(allValueButtons[1]);
        }
    }

    // Do not click the entire health panel or generic HIT POINTS controls. D&D Beyond
    // may route those clicks to unrelated editors, which can steal focus from native rolls.
    return candidates;
}

function wayBeyond20FindTempHpOpener(currentValue = null) {
    const candidates = wayBeyond20FindTempHpOpeners(currentValue);
    return candidates.length ? $(candidates[0]) : $();
}

function wayBeyond20NativeClick(element) {
    const node = element && element.jquery ? element[0] : element;
    if (!node) return false;
    try {
        if (typeof node.click === "function") {
            node.click();
            return true;
        }
        node.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
        return true;
    } catch (error) {
        wayBeyond20CharacterDebug("Native click failed", {
            element: wayBeyond20DescribeElement(node),
            error: String(error)
        });
        return false;
    }
}

function wayBeyond20CommitTempHpInput(input, desired) {
    if (!input) return;
    input.focus();
    if (typeof input.select === "function") input.select();
    wayBeyond20SetReactInputValue(input, desired);
    try {
        input.dispatchEvent(new InputEvent("input", {
            bubbles: true,
            inputType: "insertText",
            data: String(desired)
        }));
    } catch (error) {
        input.dispatchEvent(new Event("input", { bubbles: true }));
    }
    input.dispatchEvent(new Event("change", { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true }));
    input.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", code: "Enter", bubbles: true }));
    input.blur();
}

async function wayBeyond20SetTemporaryHitPoints(value) {
    const desired = Math.max(0, parseInt(value || 0));
    wayBeyond20CharacterDebug("Temporary HP update requested", { value, desired });
    if (!Number.isFinite(desired) || desired <= 0) return false;

    character.updateHP();
    const current = parseInt(character._temp_hp || 0);
    if (current >= desired) return false;

    let input = wayBeyond20FindTempHpInput();
    let openedPane = false;
    if (!input.length) {
        const openers = wayBeyond20FindTempHpOpeners(current);
        const valueButtonScan = $("button[class*='valueButton'], [role='button'][class*='valueButton']")
            .filter((_, element) => wayBeyond20IsVisibleElement(element)).toArray().slice(0, 10).map(element => ({
                button: wayBeyond20DescribeElement(element),
                parent: wayBeyond20DescribeElement($(element).parent()),
                grandparent: wayBeyond20DescribeElement($(element).parent().parent())
            }));
        wayBeyond20CharacterDebug("Temporary HP opener candidates", {
            current,
            candidates: openers.slice(0, 20).map(wayBeyond20DescribeElement),
            healthRoots: wayBeyond20FindTempHpHealthRoots().slice(0, 10).map(wayBeyond20DescribeElement),
            valueButtons: valueButtonScan
        });
        for (const opener of openers) {
            wayBeyond20CharacterDebug("Temporary HP opener clicked", {
                opener: wayBeyond20DescribeElement(opener)
            });
            if (!wayBeyond20NativeClick(opener)) continue;
            openedPane = true;
            for (let attempt = 0; attempt < 12 && !input.length; attempt++) {
                await new Promise(resolve => setTimeout(resolve, 75));
                input = wayBeyond20FindTempHpInput();
            }
            if (input.length) break;
        }
    }

    if (!input.length) {
        wayBeyond20CharacterDebug("Temporary HP input not found", {
            opener: wayBeyond20DescribeElement(wayBeyond20FindTempHpOpener(current)),
            visibleInputs: $("input:visible").toArray().slice(0, 30).map(wayBeyond20DescribeElement),
            visibleButtons: $("button:visible, [role='button']:visible").toArray().slice(0, 60).map(wayBeyond20DescribeElement),
            visibleDialogs: $("[role='dialog']:visible, .ct-sidebar__portal:visible, .b20-health-manage-pane:visible, .ct-health-manager:visible").toArray().slice(0, 10).map(wayBeyond20DescribeElement)
        });
        console.warn("WayBeyond20: Could not find D&D Beyond Temporary HP input.");
        return false;
    }

    wayBeyond20CharacterDebug("Temporary HP input selected", { desired, input: wayBeyond20DescribeElement(input) });
    wayBeyond20CommitTempHpInput(input[0], desired);
    await new Promise(resolve => setTimeout(resolve, 250));

    const pane = input.closest(".b20-health-manage-pane, .ct-health-manager, [role='dialog']");
    const confirmButton = pane.find("button").filter((_, element) => {
        const text = $(element).text().replace(/\s+/g, " ").trim().toLowerCase();
        return $(element).is(":visible") && ["apply", "save", "update", "confirm"].includes(text);
    }).first();
    if (confirmButton.length) {
        confirmButton.trigger("click");
        await new Promise(resolve => setTimeout(resolve, 200));
    }

    await new Promise(resolve => setTimeout(resolve, 250));
    character.updateHP();
    let updated = parseInt(character._temp_hp || 0);

    if (updated < desired) {
        wayBeyond20CommitTempHpInput(input[0], desired);
        await new Promise(resolve => setTimeout(resolve, 300));
        character.updateHP();
        updated = parseInt(character._temp_hp || 0);
    }

    if (openedPane && updated >= desired) {
        const closeButton = $(".b20-health-manage-pane button[aria-label*='Close'], " +
            ".b20-health-manage-pane button[class*='styles_close'], .b20-health-manage-pane .ct-sidebar__close, " +
            "[role='dialog'] button[aria-label*='Close']").filter(":visible").first();
        if (closeButton.length) {
            closeButton.trigger("click");
            await new Promise(resolve => setTimeout(resolve, 250));
            character.updateHP();
            updated = parseInt(character._temp_hp || 0);
        }
    }

    if (updated < desired) {
        wayBeyond20CharacterDebug("Temporary HP update failed", { desired, updated });
        console.warn(`WayBeyond20: Temporary HP input did not commit ${desired}; D&D Beyond reports ${updated}.`);
        return false;
    }
    wayBeyond20CharacterDebug("Temporary HP update verified", { desired, updated });
    return true;
}

function wayBeyond20GetBardicInspirationDie() {
    const bardLevel = character ? character.getClassLevel("Bard") : 0;
    if (bardLevel < 5) return "1d6";
    if (bardLevel < 10) return "1d8";
    if (bardLevel < 15) return "1d10";
    return "1d12";
}

function wayBeyond20RollIsUnarmedStrike(rollProperties, actionName = "") {
    if (!rollProperties) return false;
    if (rollProperties["waybeyond20-natural-attack"] === true) return true;
    if (["naturalStr", "naturalDex"].includes(rollProperties["waybeyond20-unarmed-damage-mode"])) return true;

    const name = String(actionName || rollProperties.name || "").replace(/\s+/g, " ").trim().toLowerCase();
    if (/\b(?:natural attack|fangs?\/claws?|fangs?|claws?|bite)\b/.test(name)) return true;

    // Natural-attack rows sometimes use a feature title instead of a stable attack name. Their
    // live description still identifies natural weaponry. Do not treat generic Unarmed Strike,
    // Bardic Damage, or Agile Strikes as Draining Attack merely because they say "Unarmed Strike."
    const description = String(rollProperties.description || "").replace(/\s+/g, " ").trim().toLowerCase();
    return /\bnatural weapon(?:ry|s)?\b/.test(description);
}

function wayBeyond20ApplyDrainingAttackIntent(roll_properties, actionName) {
    const hasDrainingAttack = !!(character && character.hasRacialTrait("Draining Attack", true));
    const hasNaturalAttack = !!(character && character.hasRacialTrait("Natural Attack", true));
    const qualifies = wayBeyond20RollIsUnarmedStrike(roll_properties, actionName);
    wayBeyond20CharacterDebug("Draining Attack intent evaluated", {
        actionName,
        hasRollProperties: !!roll_properties,
        hasDrainingAttack,
        hasNaturalAttack,
        qualifies
    });
    if (!roll_properties || !character || !hasDrainingAttack || !hasNaturalAttack || !qualifies) return;
    roll_properties["waybeyond20-unarmed-strike"] = true;
    roll_properties["waybeyond20-temp-hp-on-hit"] = {
        mode: "damage-dealt",
        source: "Draining Attack",
        attack: actionName
    };
    addEffect(roll_properties, "Draining Attack: gain Temporary HP equal to damage dealt");
    wayBeyond20CharacterDebug("Draining Attack intent attached", {
        actionName,
        intent: roll_properties["waybeyond20-temp-hp-on-hit"]
    });
}

async function wayBeyond20ChooseUnarmedStrikeProfile() {
    const strength = character.getAbility("STR");
    const dexterity = character.getAbility("DEX");
    const strengthMod = parseInt(strength.mod || 0);
    const dexterityMod = parseInt(dexterity.mod || 0);
    const proficiency = parseInt(character._proficiency || 0);
    const bestAttackAbility = dexterityMod > strengthMod ? "DEX" : "STR";
    const bestAttackMod = Math.max(strengthMod, dexterityMod);
    const profiles = [{
        attackAbility: "STR",
        damageFormula: `1 ${strengthMod >= 0 ? "+" : "-"} ${Math.abs(strengthMod)}`,
        damageType: "Bludgeoning",
        damageMode: "standard",
        expectedDamage: 1 + strengthMod,
        attackMod: strengthMod
    }];

    if (character.hasRacialTrait("Natural Attack", true)) {
        const naturalAbility = dexterityMod > strengthMod ? "DEX" : "STR";
        const naturalMod = Math.max(strengthMod, dexterityMod);
        profiles.push({
            attackAbility: naturalAbility,
            damageFormula: `1d6 ${naturalMod >= 0 ? "+" : "-"} ${Math.abs(naturalMod)}`,
            damageType: "Slashing",
            damageMode: naturalAbility === "DEX" ? "naturalDex" : "naturalStr",
            expectedDamage: 3.5 + naturalMod,
            attackMod: naturalMod
        });
    }

    if (character.hasClassFeature("Bardic Damage", true)) {
        const bardicDie = wayBeyond20GetBardicInspirationDie();
        const dieSize = parseInt(String(bardicDie).split("d")[1] || 0);
        profiles.push({
            attackAbility: bestAttackAbility,
            damageFormula: `${bardicDie} ${dexterityMod >= 0 ? "+" : "-"} ${Math.abs(dexterityMod)}`,
            damageType: "Bludgeoning",
            damageMode: "bardic",
            expectedDamage: ((dieSize + 1) / 2) + dexterityMod,
            attackMod: bestAttackMod
        });
    }

    profiles.sort((left, right) =>
        right.expectedDamage - left.expectedDamage ||
        right.attackMod - left.attackMod ||
        String(left.damageMode).localeCompare(String(right.damageMode))
    );
    const selected = profiles[0];
    return Object.assign({}, selected, {
        toHit: wayBeyond20FormatSignedNumber(proficiency + selected.attackMod)
    });
}

async function wayBeyond20RollAgileStrike() {
    const profile = await wayBeyond20ChooseUnarmedStrikeProfile();
    if (!profile) return;
    const properties = {
        "Attack Type": "Melee",
        "Reach": "5 ft.",
        "Properties": "Unarmed Strike",
        "Proficient": "Yes"
    };
    const damages = [profile.damageFormula];
    const damageTypes = [profile.damageType];
    const settingsToChange = {};
    const rollProperties = await buildAttackRoll(
        character,
        "action",
        "Agile Strikes — Unarmed Strike",
        "Dazzling Footwork lets you make an Unarmed Strike as part of the same action used to expend Bardic Inspiration.",
        properties,
        damages,
        damageTypes,
        profile.toHit,
        0,
        false,
        false,
        { weapon_damage_length: 1 },
        settingsToChange
    );
    if (!rollProperties) return;
    rollProperties["waybeyond20-unarmed-strike"] = true;
    rollProperties["waybeyond20-unarmed-attack-ability"] = profile.attackAbility;
    rollProperties["waybeyond20-unarmed-damage-mode"] = profile.damageMode;
    if (Object.keys(settingsToChange).length > 0) character.mergeCharacterSettings(settingsToChange);
    return sendRollWithCharacter("attack", damages[0], rollProperties);
}

async function wayBeyond20OfferAgileStrike() {
    if (!character || !character.hasClassFeature("Dazzling Footwork", true)) return;
    const useStrike = await wayBeyond20ConfirmChoice(
        "Dazzling Footwork: Agile Strikes",
        "You expended Bardic Inspiration. Make an Unarmed Strike as part of the same Bonus Action?",
        "Make Strike",
        "No"
    );
    if (useStrike) await wayBeyond20RollAgileStrike();
}

function wayBeyond20LimitedUseInputForControl(control) {
    const element = control && control.jquery ? control[0] : control;
    if (!element) return null;
    if (element.matches && element.matches("input[type='checkbox']")) return element;
    const nested = element.querySelector ? element.querySelector("input[type='checkbox']") : null;
    if (nested) return nested;
    const forId = element.getAttribute ? element.getAttribute("for") : null;
    if (forId) return document.getElementById(forId);
    return null;
}

function wayBeyond20LimitedUseControlIsVisible(control) {
    const element = control && control.jquery ? control[0] : control;
    if (!element || !element.isConnected) return false;
    const style = window.getComputedStyle ? window.getComputedStyle(element) : null;
    if (style && (style.display === "none" || style.visibility === "hidden")) return false;
    return !!(element.getClientRects && element.getClientRects().length);
}

function wayBeyond20LimitedUseCanonicalControl(control) {
    const element = control && control.jquery ? control[0] : control;
    if (!element) return null;
    const roleControl = element.closest ? element.closest("[role='checkbox']") : null;
    if (roleControl) return roleControl;
    const label = element.closest ? element.closest("label") : null;
    return label || element;
}

function wayBeyond20LimitedUseControlIsUnused(control) {
    const element = control && control.jquery ? control[0] : control;
    if (!element || element.disabled) return false;
    const input = wayBeyond20LimitedUseInputForControl(element);
    if (input) return !input.checked && !input.disabled;
    const ariaChecked = element.getAttribute ? element.getAttribute("aria-checked") : null;
    if (ariaChecked !== null) return ariaChecked !== "true";
    const className = String(element.className || "").toLowerCase();
    return !/(checked|selected|active|used)/.test(className);
}

function wayBeyond20LimitedUseControlMatchesFeature(control, featureName) {
    const element = control && control.jquery ? control[0] : control;
    const needle = String(featureName || "").replace(/\s+/g, " ").trim().toLowerCase();
    if (!element || !needle) return false;

    let node = element;
    for (let depth = 0; node && depth < 12; depth++, node = node.parentElement) {
        const text = String(node.textContent || "").replace(/\s+/g, " ").trim().toLowerCase();
        if (!text.includes(needle)) continue;
        const localControls = node.querySelectorAll ? node.querySelectorAll("[role='checkbox'][aria-label='use' i], input[type='checkbox'][aria-label='use' i]").length : 0;
        const labels = node.querySelectorAll ? Array.from(node.querySelectorAll(
            "h1,h2,h3,h4,h5,h6,strong,[class*='heading'],[class*='title'],[class*='name'],[class*='label']"
        )) : [];
        const hasExactFeatureLabel = labels.some(label =>
            wayBeyond20ElementOwnText(label).replace(/\s+/g, " ").trim().toLowerCase() === needle
        );
        if (hasExactFeatureLabel && localControls > 0 && localControls <= 12) return true;
    }
    return false;
}

function wayBeyond20FindLimitedUseControls(featureName = "") {
    const raw = Array.from(document.querySelectorAll(
        "[role='checkbox'][aria-label='use' i], input[type='checkbox'][aria-label='use' i]"
    ));
    const unique = [];
    const seen = new Set();
    raw.forEach(element => {
        const canonical = wayBeyond20LimitedUseCanonicalControl(element);
        if (!canonical || seen.has(canonical) || !wayBeyond20LimitedUseControlIsVisible(canonical)) return;
        seen.add(canonical);
        unique.push(canonical);
    });

    const featureControls = unique.filter(element => wayBeyond20LimitedUseControlMatchesFeature(element, featureName));
    const labeledUseControls = unique.filter(element => {
        const ariaLabel = String(element.getAttribute ? element.getAttribute("aria-label") || "" : "").toLowerCase();
        const input = wayBeyond20LimitedUseInputForControl(element);
        const inputLabel = String(input && input.getAttribute ? input.getAttribute("aria-label") || "" : "").toLowerCase();
        return ariaLabel === "use" || inputLabel === "use";
    });
    const controls = featureControls.length ? featureControls : (featureName ? [] : labeledUseControls);
    const pane = controls.length
        ? $(controls[0]).closest(".b20-action-pane, .ct-custom-action-pane, .b20-custom-action-pane, .ct-actions, .ddbc-actions, [class*='styles_actions']").first()
        : $();
    return { pane, controls };
}

async function wayBeyond20WaitForLimitedUseSpend(featureName, beforeUnused, attempts = 8) {
    let refreshed = wayBeyond20FindLimitedUseControls(featureName);
    let afterUnused = refreshed.controls.filter(wayBeyond20LimitedUseControlIsUnused).length;
    for (let attempt = 0; attempt < attempts && afterUnused >= beforeUnused; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 150));
        refreshed = wayBeyond20FindLimitedUseControls(featureName);
        afterUnused = refreshed.controls.filter(wayBeyond20LimitedUseControlIsUnused).length;
    }
    return { refreshed, afterUnused, spent: refreshed.controls.length > 0 && afterUnused < beforeUnused };
}

function wayBeyond20RequestPageLimitedUseSpend(featureName, beforeUnused) {
    return new Promise(resolve => {
        const requestId = `waybeyond20-limited-use-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        let settled = false;
        const listener = addCustomEventListener("WayBeyond20LimitedUseResult", (responseId, result) => {
            if (responseId !== requestId || settled) return;
            settled = true;
            document.removeEventListener(...listener);
            resolve(result || null);
        });
        setTimeout(() => {
            if (settled) return;
            settled = true;
            document.removeEventListener(...listener);
            resolve(null);
        }, 2500);
        sendCustomEvent("WayBeyond20SpendLimitedUse", [requestId, featureName, beforeUnused]);
    });
}

async function wayBeyond20SpendLimitedUse(featureName) {
    const result = wayBeyond20FindLimitedUseControls(featureName);
    const unused = result.controls.find(wayBeyond20LimitedUseControlIsUnused);
    const beforeUnused = result.controls.filter(wayBeyond20LimitedUseControlIsUnused).length;
    wayBeyond20CharacterDebug("Limited use spend evaluated", {
        featureName,
        paneFound: result.pane.length,
        controlCount: result.controls.length,
        beforeUnused,
        controls: result.controls.map(wayBeyond20DescribeElement),
        selected: wayBeyond20DescribeElement(unused)
    });
    const methods = [];
    const pageResult = await wayBeyond20RequestPageLimitedUseSpend(featureName, beforeUnused);
    methods.push({ method: "page-context", result: pageResult });

    const effectiveBeforeUnused = beforeUnused || Number(pageResult?.beforeUnused || 0);
    let verification = effectiveBeforeUnused > 0
        ? await wayBeyond20WaitForLimitedUseSpend(featureName, effectiveBeforeUnused, 4)
        : { refreshed: wayBeyond20FindLimitedUseControls(featureName), afterUnused: 0, spent: !!pageResult?.spent };
    if (pageResult?.spent) verification.spent = true;
    if (!verification.spent && unused) {
        const refreshedUnused = verification.refreshed.controls.find(wayBeyond20LimitedUseControlIsUnused) || unused;
        const input = wayBeyond20LimitedUseInputForControl(refreshedUnused);
        const clickTargets = [
            refreshedUnused,
            input,
            refreshedUnused && refreshedUnused.closest ? refreshedUnused.closest("label") : null,
            refreshedUnused ? refreshedUnused.parentElement : null
        ].filter((element, index, values) => element && values.indexOf(element) === index);

        for (const target of clickTargets) {
            try {
                target.scrollIntoView({ block: "nearest", inline: "nearest" });
            } catch (_) {}
            try {
                target.focus({ preventScroll: true });
            } catch (_) {}
            try {
                target.click();
                methods.push({ method: "isolated-native-click", target: wayBeyond20DescribeElement(target) });
            } catch (error) {
                methods.push({ method: "isolated-native-click", target: wayBeyond20DescribeElement(target), error: String(error) });
            }
            verification = await wayBeyond20WaitForLimitedUseSpend(featureName, effectiveBeforeUnused, 3);
            if (verification.spent) break;
        }

        if (!verification.spent && input && typeof HTMLInputElement !== "undefined") {
            try {
                const checkedSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "checked")?.set;
                if (checkedSetter) checkedSetter.call(input, true);
                else input.checked = true;
                input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
                input.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
                methods.push({ method: "isolated-input-change", target: wayBeyond20DescribeElement(input) });
                verification = await wayBeyond20WaitForLimitedUseSpend(featureName, effectiveBeforeUnused, 4);
            } catch (error) {
                methods.push({ method: "isolated-input-change", error: String(error) });
            }
        }
    }

    wayBeyond20CharacterDebug("Limited use spend completed", {
        featureName,
        spent: verification.spent,
        beforeUnused: effectiveBeforeUnused,
        afterUnused: verification.afterUnused,
        refreshedControlCount: verification.refreshed.controls.length,
        methods
    });
    return verification.spent;
}

function wayBeyond20BardicInspirationRemainingUses() {
    const result = wayBeyond20FindLimitedUseControls("Bardic Inspiration");
    if (result.controls.length > 0) {
        return result.controls.filter(wayBeyond20LimitedUseControlIsUnused).length;
    }

    const row = wayBeyond20FindBardicInspirationActionRow();
    if (!row.length) return null;
    const text = String(row.text() || "").replace(/\s+/g, " ").trim();
    const match = text.match(/\((\d+)\s*\/\s*(\d+)\)/);
    return match ? parseInt(match[1]) : null;
}

function wayBeyond20FindBardicInspirationActionRow() {
    let match = $();
    $(".ct-combat-attack,.ddbc-combat-attack").filter(":visible").each(function() {
        const row = $(this);
        const label = row
            .find(".ct-combat-attack__name .ct-combat-attack__label,.ddbc-combat-attack__name .ddbc-combat-attack__label")
            .first()
            .text()
            .replace(/\s+/g, " ")
            .trim();
        if (label !== "Bardic Inspiration") return;
        match = row;
        return false;
    });
    return match;
}

let wayBeyond20BardicInspirationActivationPending = false;

async function wayBeyond20ActivateBardicInspiration(description = "Bardic Inspiration") {
    if (!character || wayBeyond20BardicInspirationActivationPending) return false;
    wayBeyond20BardicInspirationActivationPending = true;
    try {
        const remaining = wayBeyond20BardicInspirationRemainingUses();
        if (remaining !== null && remaining <= 0) {
            wayBeyond20CharacterDebug("Bardic Inspiration activation blocked: no uses remaining", { remaining });
            return false;
        }

        const resourceAllowed = await wayBeyond20PreflightTurnResource("bonusAction", {
            name: "Bardic Inspiration",
            rollType: "activation"
        });
        if (!resourceAllowed) return false;

        const spent = await wayBeyond20SpendLimitedUse("Bardic Inspiration");
        if (!spent) {
            wayBeyond20CharacterDebug("Bardic Inspiration activation failed to spend Limited Use", { remaining });
            return false;
        }

        // The Bonus Action is advisory outside combat. During combat, spend it only after
        // D&D Beyond confirms the Bardic Inspiration use was actually consumed.
        wayBeyond20SpendTurnResource("bonusAction", { forRoll: false });
        wayBeyond20CharacterDebug("Bardic Inspiration activated", {
            die: wayBeyond20GetBardicInspirationDie(),
            description
        });

        await wayBeyond20OfferAgileStrike();
        return true;
    } finally {
        wayBeyond20BardicInspirationActivationPending = false;
        wayBeyond20InjectBardicInspirationButton();
    }
}

function wayBeyond20InjectBardicInspirationButton() {
    if (!wayBeyond20IsMainCharacterSheet() || !character || !character.hasClassFeature("Bardic Inspiration", true)) {
        $(".waybeyond20-bardic-inspire").remove();
        return;
    }

    const row = wayBeyond20FindBardicInspirationActionRow();
    if (!row.length) return;
    row.addClass("waybeyond20-bardic-feature-row");
    row.children().not(".waybeyond20-bardic-feature-card").addClass("waybeyond20-bardic-native-cell");

    let card = row.children(".waybeyond20-bardic-feature-card").first();
    if (!card.length) {
        card = $("<div>").addClass("waybeyond20-bardic-feature-card");
        card.append($("<div>").addClass("waybeyond20-bardic-feature-identity")
            .append($("<strong>").text("Bardic Inspiration"))
            .append($("<span>").text("Bonus Action")));
        card.append($("<span>").addClass("waybeyond20-bardic-feature-range").text("60 ft."));
        card.append($("<span>").addClass("waybeyond20-bardic-feature-die"));
        card.append($("<span>").addClass("waybeyond20-bardic-feature-uses"));
        row.append(card);
    }

    let button = card.find(".waybeyond20-bardic-inspire").first();
    if (!button.length) {
        button = $("<button>")
            .attr("type", "button")
            .addClass("waybeyond20-bardic-inspire")
            .text("Inspire")
            .on("click.waybeyond20-bardic-inspire", async event => {
                event.preventDefault();
                event.stopPropagation();
                await wayBeyond20ActivateBardicInspiration();
            });
        card.append(button);
    }

    const remaining = wayBeyond20BardicInspirationRemainingUses();
    const nativeText = String(row.find(".ct-combat-attack__notes,.ddbc-combat-attack__notes").first().text() || "");
    const nativeCount = nativeText.match(/\((\d+)\s*\/\s*(\d+)\)/);
    const maximum = nativeCount ? parseInt(nativeCount[2]) : null;
    card.find(".waybeyond20-bardic-feature-die").text(wayBeyond20GetBardicInspirationDie().replace(/^1/, ""));
    card.find(".waybeyond20-bardic-feature-uses").text(remaining === null
        ? "Uses unavailable"
        : `${remaining}${maximum !== null ? "/" + maximum : ""} uses`);
    button.prop("disabled", remaining === 0 || wayBeyond20BardicInspirationActivationPending);
    button.attr("title", remaining === null
        ? "Use Bardic Inspiration"
        : `${remaining} Bardic Inspiration use${remaining === 1 ? "" : "s"} remaining`);
}

async function wayBeyond20ChooseHitDie() {
    const choices = { d4: "d4", d6: "d6", d8: "d8", d10: "d10", d12: "d12" };
    return dndbeyondDiceRoller.queryGeneric(
        "Blood and Bone",
        "Select your target\'s Hit Dice size.",
        choices,
        "waybeyond20-blood-and-bone-hit-die",
        ["d4", "d6", "d8", "d10", "d12"],
        "d8"
    );
}

async function wayBeyond20RollBloodAndBone(description = "Triage Expert: Blood and Bone", properties = {}, selectedHitDie = null) {
    const sourceName = character && character._name ? character._name : "Character";
    const hitDie = selectedHitDie || await wayBeyond20ChooseHitDie();
    if (!hitDie) return;

    const rollProperties = {
        name: "Blood and Bone",
        class: sourceName,
        multiclass: false,
        "hit-dice": hitDie,
        description,
        effects: ["Blood and Bone: expend one Hit Point Die"]
    };
    wayBeyond20ApplyBedsideMannerIntent(rollProperties, "hit-dice");
    wayBeyond20AttachTurnResource(rollProperties, "action", {
        name: "Blood and Bone",
        rollType: "hit-dice"
    });
    return sendRollWithCharacter("hit-dice", hitDie, rollProperties);
}

function wayBeyond20BuildBloodAndBoneButton(label, hitDie = null) {
    const button = $("<button>")
        .attr("type", "button")
        .attr("aria-label", label)
        .attr("data-waybeyond20-label", label)
        .addClass("waybeyond20-blood-and-bone-button");
    button.on("click.waybeyond20-blood-and-bone", async event => {
        event.preventDefault();
        event.stopPropagation();
        await wayBeyond20RollBloodAndBone("Triage Expert: Blood and Bone", {}, hitDie);
    });
    return button;
}

function wayBeyond20FindBloodAndBoneActionSnippet() {
    const normalize = value => String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
    const snippets = $(`.ct-actions .ct-actions-list .ct-actions-list__activatable .ct-feature-snippet,
                        .ct-actions div[class*='styles_activatable'] .ct-feature-snippet,
                        .ct-actions .ct-feature-snippet`).filter(":visible");
    let match = $();
    snippets.each(function() {
        const snippet = $(this);
        const heading = snippet.find(".ct-feature-snippet__heading, div[class*='styles_heading']").first();
        if (!heading.length) return;
        const headingText = normalize(wayBeyond20ElementOwnText(heading[0]) || heading.text());
        if (headingText !== "blood and bone") return;
        match = snippet;
        return false;
    });
    return match;
}

function wayBeyond20InjectBloodAndBoneAction() {
    // Remove the legacy standalone row. It was anchored after the last attack row,
    // which could place the controls below D&D Beyond's Bonus Actions heading.
    $(".waybeyond20-blood-and-bone-action").remove();

    if (!wayBeyond20IsMainCharacterSheet() || !character || !character.hasFeat("Triage Expert", true)) {
        $(".waybeyond20-blood-and-bone-inline").remove();
        return;
    }

    const snippet = wayBeyond20FindBloodAndBoneActionSnippet();
    if (!snippet.length) {
        $(".waybeyond20-blood-and-bone-inline").remove();
        return;
    }

    // Keep exactly one activation control set and attach it directly to D&D Beyond's
    // native Blood and Bone Action snippet so the feature exists in one location.
    $(".waybeyond20-blood-and-bone-inline").not(snippet.find(".waybeyond20-blood-and-bone-inline")).remove();
    if (snippet.find(".waybeyond20-blood-and-bone-inline").length) return;

    const activation = $("<div>").addClass("waybeyond20-blood-and-bone-inline");
    activation.append($("<span>").addClass("waybeyond20-blood-and-bone-inline-label").text("Utilize Action"));

    const controls = $("<div>").addClass("waybeyond20-blood-and-bone-controls");
    for (const die of ["d4", "d6", "d8", "d10", "d12"]) {
        controls.append(wayBeyond20BuildBloodAndBoneButton(die, die));
    }
    controls.append(wayBeyond20BuildBloodAndBoneButton("Use"));
    activation.append(controls);

    const content = snippet.find(".ct-feature-snippet__content, div[class*='styles_content']").first();
    (content.length ? content : snippet).append(activation);
}

function wayBeyond20RollAlreadyHasAdvantage(rollProperties = {}) {
    // Hotkeys/sticky roll modifiers win last in sendRoll(), so inspect them first.
    if (key_modifiers.normal_roll || key_modifiers.disadvantage || key_modifiers.super_disadvantage) return false;
    if (key_modifiers.advantage || key_modifiers.super_advantage) return true;

    const explicit = rollProperties.advantage;
    if ([RollType.ADVANTAGE, RollType.SUPER_ADVANTAGE, RollType.OVERRIDE_ADVANTAGE].includes(explicit)) return true;
    if ([RollType.NORMAL, RollType.DISADVANTAGE, RollType.SUPER_DISADVANTAGE, RollType.OVERRIDE_DISADVANTAGE].includes(explicit)) return false;

    const query = String(rollProperties["advantage-query"] || "").toLowerCase();
    if (query.includes("dazzling footwork") && query.includes("advantage") && !query.includes("disadvantage")) return true;

    const configured = character ? parseInt(character.getGlobalSetting("roll-type", RollType.NORMAL)) : RollType.NORMAL;
    return configured === RollType.ADVANTAGE || configured === RollType.SUPER_ADVANTAGE;
}

async function rollSkillCheck(paneClass) {
    const skill_name = $("." + paneClass + "__header-name").text();
    let ability = $("." + paneClass + "__header-ability").text();
    let modifier = $("." + paneClass + "__header-modifier").text();
    const proficiency = $("." + paneClass + "__header-icon .ct-tooltip,." + paneClass + "__header-icon .ddbc-tooltip").attr("data-original-title");

    
    if (ability == "--" && character._abilities.length > 0) {
        let prof = "";
        let prof_val = 0;
        if (proficiency == "Proficiency") {
            prof = "proficiency";
            prof_val = parseInt(character._proficiency);
        } else if (proficiency == "Half Proficiency") {
            prof = "half_proficiency";
            prof_val += Math.floor(character._proficiency / 2);
        } else if (proficiency == "Expertise") {
            prof = "expertise";
            prof_val += character._proficiency * 2;
        }
        const formula = "1d20 + @ability " + (prof != "" ? " + @" + prof : "") + " + @custom_dice";
        let html = '<form>';
        html += '<div class="beyond20-form-row"><label>Roll Formula</label><input type="text" value="' + formula + '" disabled></div>';
        html += '<div class="beyond20-form-row"><label>Select Ability</label><select name="ability">';
        const modifiers = {};
        for (let ability of character._abilities) {
            html += '<option value="' + ability[1] + '">' + ability[0] + '</option>';
            modifiers[ability[1]] = ability[3];
        }
        html += "</select></div>";
        html += '</form>';
        html = await dndbeyondDiceRoller._prompter.prompt("Custom Skill", html, skill_name);
        if (html) {
            ability = html.find('[name="ability"]').val();
            let mod = parseInt(modifiers[ability]);
            if (prof_val)
                mod += prof_val;
            // In case of magical bonus
            if (modifier != "--" && modifier != "+0")
                mod += parseInt(modifier);
            modifier = mod >= 0 ? `+${mod}` : `${mod}`;
        } else { return; } // cancel roll
    }
    //console.log("Skill " + skill_name + " (" + ability + ") : " + modifier);
    const roll_properties = {
        "skill": skill_name,
        "ability": ability,
        "modifier": modifier,
        "proficiency": proficiency
    }
    const adjustments = $(`.${paneClass}__dice-adjustments`);
    let query = "";
    let hasRestriction = false;
    for (const adj of adjustments.find(".ct-dice-adjustment-summary").toArray()) {
        const adv =  $(adj).find(".ddbc-advantage-icon").length > 0;
        const restriction = $(adj).find(".ct-dice-adjustment-summary__restriction").text();
        const origin = $(adj).find(".ct-dice-adjustment-summary__data-origin").text();
        query += `${query ? "\n" : ""}${adv ? "Advantage: " : "Disadvantage : "} ${restriction} ${origin}`;
        hasRestriction |= !!restriction;
    }
    roll_properties["advantage-query"] = query;
    if(character.getGlobalSetting("roll-type", RollType.NORMAL) != RollType.QUERY) {
        const skill_badge_adv =  adjustments.find(".ddbc-advantage-icon").length > 0;
        const skill_badge_disadv = adjustments.find(".ddbc-disadvantage-icon").length > 0;

        if (hasRestriction || (skill_badge_adv && skill_badge_disadv)) {
            roll_properties["advantage"] = RollType.QUERY;
        } else if (skill_badge_adv) {
            roll_properties["advantage"] = RollType.OVERRIDE_ADVANTAGE;
        } else if (skill_badge_disadv) {
            roll_properties["advantage"] = RollType.OVERRIDE_DISADVANTAGE;
        }
    }
    if (ability == "STR" &&
        ((character.hasClassFeature("Rage") && character.getSetting("barbarian-rage", false)) ||
            (character.hasClassFeature("Giant’s Might") && character.getSetting("fighter-giant-might", false)))) {
        roll_properties["advantage"] = RollType.OVERRIDE_ADVANTAGE;
        if(character.hasClassFeature("Rage") && character.getSetting("barbarian-rage", false)) {
            addEffect(roll_properties, "Rage");
        }
    }
    if (skill_name == "Acrobatics" && character.hasClassFeature("Bladesong") && character.getSetting("wizard-bladesong", false)) {
        roll_properties["advantage"] = RollType.OVERRIDE_ADVANTAGE;
    }
    roll_properties.d20 = "1d20";
    // Set Reliable Talent flag if character has the feature and skill is proficient/expertise
    if (character.hasClassFeature("Reliable Talent") && ["Proficiency", "Expertise"].includes(proficiency)) {
        roll_properties.d20 = "1d20min10";
        addEffect(roll_properties, "Reliable Talent");
    }
    // Set Silver Tongue if Deception or Persuasion
    if (character.hasClassFeature("Silver Tongue") && (skill_name === "Deception" || skill_name === "Persuasion")) {
        roll_properties.d20 = "1d20min10";
        addEffect(roll_properties, "Silver Tongue");
    }
    
    // Sorcerer: Clockwork Soul - Trance of Order
    if (character.hasClassFeature("Trance of Order") && character.getSetting("sorcerer-trance-of-order", false))
            roll_properties.d20 = "1d20min10";

    if (character.hasClassFeature("Indomitable Might") && ability == "STR") {
        const min = character.getAbility("STR").score - parseInt(modifier);
        // Check against reliable talent or silver tongue (should be an impossible state)
        const min10 = roll_properties.d20 === "1d20min10";
        if (min10 && min > 10) {
            roll_properties.d20 = `1d20min${min}`
        } else if (!min10) {
            roll_properties.d20 = `1d20min${min}`
        }
    }

    // Mark of Detection Half-Elf - Deductive Intuition
    if (character.hasRacialTrait("Deductive Intuition") && (skill_name == "Investigation" || skill_name == "Insight")) {
        roll_properties.modifier += "+1d4";
    }

    // Mark of Shadow Elf - Cunning Intuition
    if (character.hasRacialTrait("Cunning Intuition") && (skill_name == "Performance" || skill_name == "Stealth")) {
        roll_properties.modifier += "+1d4";
    }

    // Mark of Storm Half-Elf Windwright's Intuition
    if (character.hasRacialTrait("Windwright’s Intuition") && skill_name == "Acrobatics") {
        roll_properties.modifier += "+1d4";
    }

    // Mark of Warding Dwarf - Warder's Intuition
    if (character.hasRacialTrait("Warder’s Intuition") && skill_name == "Investigation") {
        roll_properties.modifier += "+1d4";
    }

    // Mark of Scribing Gnome - Gifted Scribe
    if (character.hasRacialTrait("Gifted Scribe") && skill_name == "History") {
        roll_properties.modifier += "+1d4";
    }

    // Mark of Healing Halfing - Healing Touch
    if (character.hasRacialTrait("Healing Touch") && skill_name == "Medicine") {
        roll_properties.modifier += "+1d4";
    }

    // Mark of Hospitality Halfing - Ever Hospitable
    if (character.hasRacialTrait("Ever Hospitable") && skill_name == "Persuasion") {
        roll_properties.modifier += "+1d4";
    }

    // Mark of Finding Half-Orc/Human - Hunter's Intuition
    if (character.hasRacialTrait("Hunter’s Intuition") && (skill_name == "Perception" || skill_name == "Survival")) {
        roll_properties.modifier += "+1d4";
    }

    // Mark of Handling Human - Wild Intuition
    if (character.hasRacialTrait("Wild Intuition") && (skill_name == "Animal Handling" || skill_name == "Nature")) {
        roll_properties.modifier += "+1d4";
    }

    // Mark of Making Human - Artisan's Intuition
    if (character.hasRacialTrait("Artisan’s Intuition") && skill_name == "Arcana") {
        roll_properties.modifier += "+1d4";
    }

    // Mark of Passage Human - Intuitive Motion
    if (character.hasRacialTrait("Intuitive Motion") && skill_name == "Acrobatics") {
        roll_properties.modifier += "+1d4";
    }

    // Mark of Sentinel Human - Sentinel's Intuition
    if (character.hasRacialTrait("Sentinel’s Intuition") && (skill_name == "Insight" || skill_name == "Perception")) {
        roll_properties.modifier += "+1d4";
    }

    if (character.hasClassFeature("Natural Explorer") && character.getSetting("ranger-natural-explorer", false) &&
        (ability == "WIS" || ability == "INT") && (proficiency == "Proficiency" || proficiency == "Expertise")) {
        roll_properties.modifier += character._proficiency;
    }

    if (skill_name === "Performance" && character.hasClassFeature("Dazzling Footwork", true)) {
        const skillRowAlreadyHasAdvantage = $(".ct-skills__item,.ddbc-skills__item").filter(function() {
            const row = $(this);
            const name = row.find(".ct-skills__col--skill,.ddbc-skills__col--skill").first().text().replace(/\s+/g, " ").trim();
            return name === skill_name && row.find(".ddbc-advantage-icon,[class*='advantage']").length > 0;
        }).length > 0;
        if (!wayBeyond20RollAlreadyHasAdvantage(roll_properties) && !skillRowAlreadyHasAdvantage) {
            const dancing = await wayBeyond20ConfirmChoice(
                "Dazzling Footwork",
                "Does this Charisma (Performance) check involve dancing?",
                "Yes — Dance",
                "No"
            );
            if (dancing) {
                roll_properties["advantage"] = RollType.OVERRIDE_ADVANTAGE;
                addEffect(roll_properties, "Dazzling Footwork");
            }
        } else {
            roll_properties["advantage"] = RollType.OVERRIDE_ADVANTAGE;
            wayBeyond20CharacterDebug("Dazzling Footwork prompt skipped: roll already has Advantage", {
                skill: skill_name,
                advantage: roll_properties.advantage
            });
        }
    }

    return sendRollWithCharacter("skill", "1d20" + modifier, roll_properties);
}

function applyAbilityOrSavingThrowEffects({ rollType, ability_name, ability, modifier, proficiency }) {
    let mod = parseInt(modifier);
    const roll_properties = {
        name: ability_name,
        ability: ability,
        modifier: modifier
    };

    if (rollType === "saving-throw") {
        roll_properties.proficiency = proficiency;
    }

    if (!ability) {
        console.warn("WayBeyond20: could not resolve ability", {
            rollType,
            ability_name,
            ability,
            modifier,
            proficiency
        });
        return;
    }

    if (rollType === "ability") {
        // Remarkable Athlete and Jack of All Trades don't stack.
        // Give priority to Remarkable Athlete because it rounds up.
        if (
            character.hasClassFeature("Remarkable Athlete") &&
            character.getSetting("champion-remarkable-athlete", false) &&
            ["STR", "DEX", "CON"].includes(ability)
        ) {
            mod += Math.ceil(character._proficiency / 2);
            addEffect(roll_properties, "Remarkable Athlete");
        } else if (
            character.hasClassFeature("Jack of All Trades") &&
            character.getSetting("bard-joat", false)
        ) {
            mod += Math.floor(character._proficiency / 2);
            addEffect(roll_properties, "Jack of All Trades");
        }

        if (character.getSetting("custom-ability-modifier", "")) {
            const custom = parseInt(character.getSetting("custom-ability-modifier", "0")) || 0;
            if (custom !== 0) {
                mod += custom;
            }
        }

        // Fey Wanderer Ranger - Otherworldly Glamour
        if (
            character.hasClassFeature("Otherworldly Glamour") &&
            ability === "CHA"
        ) {
            mod += Math.max(character.getAbility("WIS").mod, 1);
            addEffect(roll_properties, "Otherworldly Glamour");
        }

        modifier = mod >= 0 ? `+${mod}` : `${mod}`;
        roll_properties.modifier = modifier;
    }

    if (
        ability === "STR" &&
        (
            (character.hasClassFeature("Rage") && character.getSetting("barbarian-rage", false)) ||
            (character.hasClassFeature("Giant’s Might") && character.getSetting("fighter-giant-might", false))
        )
    ) {
        roll_properties["advantage"] = RollType.OVERRIDE_ADVANTAGE;
        addEffect(roll_properties, "Rage");
    }

    if (character.hasClassFeature("Indomitable Might") && ability === "STR") {
        const min = character.getAbility("STR").score - parseInt(modifier);
        roll_properties.d20 = `1d20min${min}`;
        addEffect(roll_properties, "Indomitable Might");
    }

    // Concentration checks
    if (rollType === "saving-throw" && ability === "CON") {
        const has_warcaster = character.hasFeat("War Caster");
        const has_bladesong =
            character.hasClassFeature("Bladesong") &&
            character.getSetting("wizard-bladesong", false);

        if (has_warcaster || has_bladesong) {
            const confirmation = has_bladesong
                ? 'Your Bladesong whispers: "Is this a Concentration Check?"'
                : "Is this a Concentration Check?";

            if (confirm(confirmation)) {
                if (has_bladesong) {
                    const intelligence = character.getAbility("INT") || { mod: 0 };
                    const bladesongMod = Math.max((parseInt(intelligence.mod) || 0), 1);
                    mod = parseInt(modifier) + bladesongMod;
                    modifier = mod >= 0 ? `+${mod}` : `${mod}`;
                    roll_properties.modifier = modifier;
                    addEffect(roll_properties, "Bladesong");
                }

                if (has_warcaster) {
                    roll_properties["advantage"] = RollType.OVERRIDE_ADVANTAGE;
                    addEffect(roll_properties, "Warcaster");
                }
            }
        }
    }

    if (rollType === "saving-throw" && ability === "DEX" && wayBeyond20HasActiveEffect("Haste")) {
        roll_properties["advantage"] = RollType.OVERRIDE_ADVANTAGE;
        addEffect(roll_properties, "Haste");
    }

    // Wizard - War Magic - Durable Magic
    if (
        rollType === "saving-throw" &&
        character.hasClassFeature("Durable Magic") &&
        character.getSetting("wizard-durable-magic", false)
    ) {
        mod = parseInt(roll_properties.modifier) + 2;
        modifier = mod >= 0 ? `+${mod}` : `${mod}`;
        roll_properties.modifier = modifier;
        addEffect(roll_properties, "Durable Magic");
    }

    // Sorcerer: Clockwork Soul - Trance of Order
    if (
        character.hasClassFeature("Trance of Order") &&
        character.getSetting("sorcerer-trance-of-order", false)
    ) {
        roll_properties.d20 = "1d20min10";
        addEffect(roll_properties, "Trance of Order");
    }

    return sendRollWithCharacter(rollType, "1d20" + roll_properties.modifier, roll_properties);
}

function rollAbilityOrSavingThrow(paneClass, rollType) {
    const ability_string = $("." + paneClass + " .ct-sidebar__heading").text().trim();
    const ability_name = ability_string.split(/\s+/)[0] || "";
    const ability =
        (typeof ability_abbreviations !== "undefined" && ability_abbreviations[ability_name]) ||
        normalizeAbilityName(ability_name);

    const modifier = $(
        `.${paneClass}__modifier .ct-signed-number,` +
        `.${paneClass}__modifier .ddbc-signed-number,` +
        ` .${paneClass} span[class*='styles_modifier'] span[class*='styles_numberDisplay']`
    ).text().replace(/\s+/g, "");

    let proficiency;
    if (rollType === "saving-throw" && ability) {
        proficiency = $(
            `.ddbc-saving-throws-summary__ability--${ability.toLowerCase()} ` +
            `.ddbc-saving-throws-summary__ability-proficiency .ddbc-tooltip`
        ).attr("data-original-title");
    }

    return applyAbilityOrSavingThrowEffects({
        rollType,
        ability_name,
        ability,
        modifier,
        proficiency
    });
}

async function rollSavingThrowFromRow(row) {
    const $row = $(row);
    const abbr = $row
        .find(".ct-saving-throws-summary__ability-name abbr, .ddbc-saving-throws-summary__ability-name abbr")
        .first();

    let ability_name = (abbr.attr("title") || "").trim();
    let ability = (abbr.text() || "").trim().toUpperCase();

    if (!ability_name && ability) {
        const fullNames = {
            STR: "Strength",
            DEX: "Dexterity",
            CON: "Constitution",
            INT: "Intelligence",
            WIS: "Wisdom",
            CHA: "Charisma"
        };
        ability_name = fullNames[ability] || ability;
    }

    if (!ability) {
        ability = normalizeAbilityName(ability_name);
    }

    const modifier = $row.find(
        ".ct-saving-throws-summary__ability-modifier .ct-signed-number, " +
        ".ct-saving-throws-summary__ability-modifier .ddbc-signed-number, " +
        ".ddbc-saving-throws-summary__ability-modifier .ct-signed-number, " +
        ".ddbc-saving-throws-summary__ability-modifier .ddbc-signed-number, " +
        ".ct-saving-throws-summary__ability-modifier span[class*='styles_numberDisplay'], " +
        ".ddbc-saving-throws-summary__ability-modifier span[class*='styles_numberDisplay']"
    ).text().replace(/\s+/g, "");

    const proficiency = $row.find(
        ".ct-saving-throws-summary__ability-proficiency .ct-tooltip, " +
        ".ct-saving-throws-summary__ability-proficiency .ddbc-tooltip, " +
        ".ddbc-saving-throws-summary__ability-proficiency .ct-tooltip, " +
        ".ddbc-saving-throws-summary__ability-proficiency .ddbc-tooltip"
    ).attr("data-original-title");

    return applyAbilityOrSavingThrowEffects({
        rollType: "saving-throw",
        ability_name,
        ability,
        modifier,
        proficiency
    });
}

function rollAbilityCheckFromRow(row) {
    const $row = $(row);

    let ability_name = $row
        .find(".ct-ability-summary__heading .ct-ability-summary__label, .ddbc-ability-summary__heading .ddbc-ability-summary__label")
        .first()
        .text()
        .trim();

    let ability = normalizeAbilityName(ability_name);

    if (!ability) {
        const abbr = $row
            .find(".ct-ability-summary__heading .ct-ability-summary__abbr, .ddbc-ability-summary__heading .ddbc-ability-summary__abbr")
            .first()
            .text()
            .trim()
            .toUpperCase();

        if (abbr) {
            ability = normalizeAbilityName(abbr);
            if (!ability_name) {
                ability_name = abbreviationToAbility(abbr);
            }
        }
    }

    const modifier = $row.find(
        ".ct-ability-summary__primary .ct-signed-number, " +
        ".ct-ability-summary__primary .ddbc-signed-number, " +
        ".ct-ability-summary__primary span[class*='styles_numberDisplay'], " +
        ".ddbc-ability-summary__primary .ct-signed-number, " +
        ".ddbc-ability-summary__primary .ddbc-signed-number, " +
        ".ddbc-ability-summary__primary span[class*='styles_numberDisplay'], " +
        ".ct-ability-summary__secondary .ct-signed-number, " +
        ".ct-ability-summary__secondary .ddbc-signed-number, " +
        ".ct-ability-summary__secondary span[class*='styles_numberDisplay'], " +
        ".ddbc-ability-summary__secondary .ct-signed-number, " +
        ".ddbc-ability-summary__secondary .ddbc-signed-number, " +
        ".ddbc-ability-summary__secondary span[class*='styles_numberDisplay']"
    ).first().text().replace(/\s+/g, "");

    return applyAbilityOrSavingThrowEffects({
        rollType: "ability",
        ability_name,
        ability,
        modifier
    });
}

function rollAbilityCheck() {
    rollAbilityOrSavingThrow("b20-ability-pane", "ability");
}

function rollSavingThrow() {
    const row = $(".ct-saving-throws-summary__ability.beyond20-active-roll, .ddbc-saving-throws-summary__ability.beyond20-active-roll").first();
    if (row.length) {
        return rollSavingThrowFromRow(row[0]);
    }

    return rollAbilityOrSavingThrow("b20-ability-saving-throws-pane", "saving-throw");
}

function rollInitiative() {
    let initiative = $(".ct-combat__summary-group--initiative span[class*='styles_numberDisplay'], .ct-combat-tablet__extra--initiative span[class*='styles_numberDisplay']").text();
    let advantage = $(".ct-combat__summary-group--initiative div[class*='styles_advantage'], .ct-combat-tablet__extra--initiative div[class*='styles_advantage']").length > 0;
    if (initiative == "") {
        // TODO: use label perhaps to find the right section for initiative? 
        // it works now, but it's likely that DDB will update the sheet so that
        // every extra info becomes a styled component as a section with no discernable class
        initiative = $(".ct-combat-mobile__extras > section[class*='styles_boxMobile'] span[class*='styles_numberDisplay']").text();
        advantage = $(".ct-combat-mobile__extras > section[class*='styles_boxMobile'] div[class*='styles_advantage']").length > 0;
    }
    //console.log("Initiative " + ("with" if (advantage else "without") + " advantage ) { " + initiative);

    if (character.getGlobalSetting("initiative-tiebreaker", false)) {
        // Set the tiebreaker to the dexterity score, defaulting to 0 if the abilities array is empty;
        const tiebreaker = character.getAbility("DEX").score;

        // Add tiebreaker as a decimal;
        initiative = parseFloat(initiative) + parseFloat(tiebreaker) / 100;

        // Render initiative as a string that begins with '+' || '-';
        initiative = initiative >= 0 ? '+' + initiative.toFixed(2) : initiative.toFixed(2);
    }
    if (character.hasClassFeature("Assassinate 2024") &&
        character.getSetting("rogue-assassinate-2024", false)) {
        advantage = true;

        const isLocked = character.getSetting("rogue-assassinate-lock", false);
        if(!isLocked) character.mergeCharacterSettings({"rogue-assassinate-2024": false});
    }

    const roll_properties = { "initiative": initiative }
    if (advantage)
        roll_properties["advantage"] = RollType.OVERRIDE_ADVANTAGE;
    wayBeyond20StartCombat("D&D Beyond Initiative", true);
    return sendRollWithCharacter("initiative", "1d20" + initiative, roll_properties);
}


function rollHitDie(multiclass, index) {
    //console.log("Rolling hit die index " + index);
    const hitdie = $(".ct-reset-pane__hitdie").eq(index);
    const class_name = hitdie.find(".ct-reset-pane__hitdie-heading-class").text();
    const text = hitdie.find(".ct-reset-pane__hitdie-heading").text();
    const die = text.split("Hit Die: ")[1].split(" ")[0];
    wayBeyond20AdjustHitDice(die, -1, "hit-die-roll");
    return sendRollWithCharacter("hit-dice", die, {
        "class": class_name,
        "multiclass": multiclass,
        "hit-dice": die
    });
}

/**
 * Split a custom damages line on commas, while ignoring commas inside parenthesis/brackets/curly braces
 * to allow Roll20 macros to work
 * 
 * @param {String} damages   The custom damages line
 */
function split_custom_damages(damages) {
    // Single damage
    if (!damages.includes(",")) return [damages];
    // No parenthesis/brackets/curly braces, so split on the comma
    if (!["(", "[", "{"].some(del => damages.includes(del))) return damages.split(",");

    // Complex situation, actually parse the string
    const result = [];
    const delimiters = [];
    let current_damage = "";
    for (let i = 0; i < damages.length; i++) {
        if (damages[i] === "(") {
            delimiters.push(")");
        } else if (damages[i] === "[") {
            delimiters.push("]");
        } else if (damages[i] === "{") {
            delimiters.push("}");
        }
        if (delimiters.length === 0 && damages[i] === ",") {
            current_damage = current_damage.trim();
            if (current_damage) {
                result.push(current_damage);
                current_damage = "";
            }
            continue;
        }
        current_damage += damages[i];
        if (delimiters.length > 0 && damages[i] === delimiters[delimiters.length - 1]) {
            delimiters.pop();
        }
    }
    current_damage = current_damage.trim();
    if (current_damage) result.push(current_damage);
    return result;
}

function wayBeyond20SplitDamageFormula(formula) {
    const text = String(formula || "").trim();
    if (!text) return { dice: "", todam: "" };

    const diceParts = [];
    const staticParts = [];
    const tokenRegex = /([+-]?\s*\d*d\d+(?:ro<=\d+)?(?:min\d+)?|[+-]?\s*\d+(?:\.\d+)?)/gi;
    let match;
    while ((match = tokenRegex.exec(text)) !== null) {
        const token = match[0].replace(/\s+/g, "");
        if (!token) continue;
        if (token.toLowerCase().includes("d")) {
            diceParts.push(token);
        } else {
            staticParts.push(token);
        }
    }

    return {
        dice: diceParts.join(" + ").replace(/\+ -/g, "- "),
        todam: staticParts.join(" + ").replace(/\+ -/g, "- ")
    };
}

function wayBeyond20NextDamageId(action_pool) {
    return `d${action_pool.length}`;
}

function wayBeyond20IsProbablyMagicalItem(item_type, properties = {}) {
    const text = String(item_type || "").toLowerCase();
    if (properties && properties["Infused"]) return true;
    return /\b(common|uncommon|rare|very rare|legendary|artifact)\b/.test(text);
}

function wayBeyond20AddDamage(action_pool, damages, damage_types, {
    category = "unknown",
    source = "",
    formula = "",
    type = "",
    tohit = "",
    determinant = "",
    tags = []
} = {}) {
    const id = wayBeyond20NextDamageId(action_pool);
    const split = wayBeyond20SplitDamageFormula(formula);
    action_pool.push({
        id,
        category,
        source,
        dice: split.dice,
        tohit,
        todam: split.todam,
        type,
        determinant,
        tags: [...new Set(tags.filter(Boolean))]
    });
    damages.push(formula);
    damage_types.push(type);
    return id;
}

function wayBeyond20DamageRowIndex(row) {
    const idx = parseInt(String(row.id || "").replace(/^d/, ""));
    return Number.isFinite(idx) ? idx : -1;
}

function wayBeyond20JoinFormula(parts) {
    return parts
        .filter(part => part !== undefined && part !== null && String(part).trim() !== "")
        .map(part => String(part).trim())
        .join(" + ")
        .replace(/\+\s*-/g, "- ");
}

function wayBeyond20ApplySavageToFormula(formula) {
    return String(formula || "").replace(/(\d*)d(\d+)((?:ro<=\d+|min\d+)*)/gi, (match, amount, faces, modifiers) => {
        const count = parseInt(amount || "1");
        if (!Number.isFinite(count) || count <= 0) return match;
        return `${count * 2}d${faces}${modifiers || ""}dl${count}`;
    });
}


function wayBeyond20NormalizeActionPoolToDamages(action_pool, damages, damage_types, default_category, default_source, default_tags = []) {
    if (!Array.isArray(action_pool) || !Array.isArray(damages) || !Array.isArray(damage_types)) return;
    const normalized = [];
    for (let i = 0; i < damages.length; i++) {
        let row = action_pool.find(pool_row => wayBeyond20DamageRowIndex(pool_row) === i);
        if (!row && action_pool[i] && i < action_pool.length) {
            row = action_pool[i];
        }
        const split = wayBeyond20SplitDamageFormula(damages[i]);
        if (row) {
            row.id = `d${i}`;
            row.dice = split.dice;
            row.todam = split.todam;
            row.type = damage_types[i] || row.type || "";
            row.determinant = row.determinant || (i === 0 ? "melee-attack" : "hit:d0");
            row.tags = [...new Set((row.tags || []).filter(Boolean))];
            normalized.push(row);
        } else {
            normalized.push({
                id: `d${i}`,
                category: default_category || "unknown",
                source: default_source || "Unknown",
                dice: split.dice,
                tohit: "",
                todam: split.todam,
                type: damage_types[i] || "",
                determinant: i === 0 ? "melee-attack" : "hit:d0",
                tags: [...new Set((default_tags || []).filter(Boolean))]
            });
        }
    }
    action_pool.splice(0, action_pool.length, ...normalized);
}


function wayBeyond20ShouldTrackSpellEffect(concentration, duration) {
    if (concentration) return true;
    const normalizedDuration = String(duration || "").trim().toLowerCase();
    return normalizedDuration !== "" && !normalizedDuration.includes("instantaneous");
}

function wayBeyond20GenerateEffectId() {
    return `e${Date.now().toString(36)}${Math.floor(Math.random() * 100000).toString(36)}`;
}

function wayBeyond20CurrentCharacterName(character) {
    if (!character) return "";
    return String(character._name || character.name || "").trim();
}

function wayBeyond20OwnerLevel(character) {
    if (!character || !character._classes || typeof character._classes !== "object") return "";
    let total = 0;
    for (const level of Object.values(character._classes)) {
        const numeric = parseInt(level);
        if (Number.isFinite(numeric)) total += numeric;
    }
    return total || "";
}

function wayBeyond20ParseEffectLevel(level, castas) {
    const text = String(castas || level || "").toLowerCase();
    if (text.includes("cantrip")) return 0;
    const match = text.match(/(\d+)(?:st|nd|rd|th)?/);
    if (!match) return "";
    const parsed = parseInt(match[1]);
    return Number.isFinite(parsed) ? parsed : "";
}

function wayBeyond20NormalizeEffectFlags(flags) {
    const normalized = [];
    const add = flag => {
        const value = String(flag || "").trim();
        if (value && !normalized.includes(value)) normalized.push(value);
    };
    if (Array.isArray(flags)) flags.forEach(add);
    else if (typeof flags === "string") flags.split(/[ ,|]+/).forEach(add);
    return normalized;
}

function wayBeyond20NormalizeEffectData(data) {
    if (!Array.isArray(data)) return [];
    return data
        .filter(entry => entry && typeof entry === "object" && entry.field)
        .map(entry => ({
            field: String(entry.field || "").trim(),
            value: entry.value !== undefined && entry.value !== null ? entry.value : "",
            string: entry.string !== undefined && entry.string !== null ? String(entry.string) : ""
        }));
}

function wayBeyond20NormalizeTalentText(text="") {
    return String(text || "")
        .replace(/\s+/g, " ")
        .replace(/[“”]/g, '"')
        .replace(/[’]/g, "'")
        .trim();
}

function wayBeyond20TalentTextLower(text="") {
    return wayBeyond20NormalizeTalentText(text).toLowerCase();
}

function wayBeyond20UniquePush(list, value) {
    const normalized = String(value || "").trim();
    if (normalized && !list.includes(normalized)) list.push(normalized);
}

function wayBeyond20WordToNumber(value) {
    if (value === undefined || value === null) return null;
    const text = String(value).trim().toLowerCase();
    if (/^\d+$/.test(text)) return parseInt(text);
    const words = {
        "a": 1,
        "an": 1,
        "one": 1,
        "two": 2,
        "three": 3,
        "four": 4,
        "five": 5,
        "six": 6,
        "seven": 7,
        "eight": 8,
        "nine": 9,
        "ten": 10,
        "eleven": 11,
        "twelve": 12
    };
    return Object.prototype.hasOwnProperty.call(words, text) ? words[text] : null;
}

function wayBeyond20ParseTalentActivation(castingTime="", description="") {
    const raw = wayBeyond20NormalizeTalentText(castingTime || "");
    const text = wayBeyond20TalentTextLower(`${castingTime || ""} ${description || ""}`);
    const activation = {
        raw,
        type: "",
        cost: 1
    };
    if (/\bbonus action\b/.test(text)) activation.type = "bonus-action";
    else if (/\breaction\b/.test(text)) activation.type = "reaction";
    else if (/\baction\b/.test(text)) activation.type = "action";
    else if (/\bminute\b/.test(text)) activation.type = "minutes";
    else if (/\bhour\b/.test(text)) activation.type = "hours";

    const amount = raw.match(/^(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+/i);
    if (amount) {
        const parsed = wayBeyond20WordToNumber(amount[1]);
        if (parsed !== null) activation.cost = parsed;
    }
    return activation;
}

function wayBeyond20ParseTalentComponents(components="", description="") {
    const raw = wayBeyond20NormalizeTalentText(components || "");
    const searchable = raw || wayBeyond20NormalizeTalentText(description || "");
    const result = {
        raw,
        list: []
    };
    const text = searchable.toUpperCase();
    if (/\bV\b|VERBAL/.test(text)) wayBeyond20UniquePush(result.list, "V");
    if (/\bS\b|SOMATIC/.test(text)) wayBeyond20UniquePush(result.list, "S");
    if (/\bM\b|MATERIAL/.test(text)) wayBeyond20UniquePush(result.list, "M");
    return result;
}

function wayBeyond20ParseTalentDuration(duration="", description="") {
    const raw = wayBeyond20NormalizeTalentText(duration || "");
    const text = wayBeyond20TalentTextLower(`${duration || ""} ${description || ""}`);
    const result = {
        raw,
        concentration: false,
        value: "",
        unit: "",
        updateMode: "manual"
    };
    if (/\bconcentration\b/.test(text)) result.concentration = true;
    if (/\binstantaneous\b/.test(text)) {
        result.updateMode = "instantaneous";
        return result;
    }
    const match = text.match(/(?:up to\s+)?(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+(round|rounds|minute|minutes|hour|hours|day|days|year|years|second|seconds)/);
    if (match) {
        result.value = wayBeyond20WordToNumber(match[1]);
        result.unit = match[2].replace(/s$/, "");
        result.updateMode = match[2].toLowerCase();
    } else if (result.concentration) {
        result.updateMode = "special";
    }
    return result;
}

function wayBeyond20ParseTalentTargeting(rangeArea="", description="") {
    const rawRange = wayBeyond20NormalizeTalentText(rangeArea || "");
    const rawDescription = wayBeyond20NormalizeTalentText(description || "");
    const text = wayBeyond20TalentTextLower(`${rangeArea || ""} ${description || ""}`);
    const flags = [];
    const targeting = {
        rawRange,
        rawText: rawDescription,
        min: 1,
        max: 1,
        flags,
        range: rawRange
    };

    const add = flag => wayBeyond20UniquePush(flags, flag);

    if (/\bself\b/.test(text)) add("SELF");
    if (/\banother creature\b|\banother target\b/.test(text)) add("ANOTHER_CREATURE");
    if (/\byou touch\b|\btouch a\b/.test(text)) add("TOUCH");
    if (/\bwilling creature\b|\bwilling target\b/.test(text)) add("WILLING");
    if (/\bcreature\b|\bcreatures\b/.test(text)) add("CREATURE");
    if (/\bobject\b|\bobjects\b/.test(text)) add("OBJECT");
    if (/\bally\b|\ballies\b/.test(text)) add("ALLY");
    if (/\benemy\b|\benemies\b/.test(text)) add("ENEMY");
    if (/\bhostile creature\b|\bhostile creatures\b/.test(text)) add("HOSTILE");
    if (/\bnon[- ]hostile creature\b|\bnon[- ]hostile creatures\b/.test(text)) add("NON-HOSTILE");
    if (/\byou can see\b|\bthat you can see\b/.test(text)) add("CAN_SEE");
    if (/\bcan see or hear you\b|\bcan hear or see you\b/.test(text)) add("CAN_SEE_OR_HEAR_YOU");
    else if (/\bcan hear you\b/.test(text)) add("CAN_HEAR_YOU");
    if (/\bcan understand you\b/.test(text)) add("CAN_UNDERSTAND_YOU");
    if (/\bwithin range\b|\bwithin \d+ feet\b|\bwithin \d+ foot\b/.test(text) || rawRange) add("WITHIN_RANGE");

    const typeFlags = ["ABERRATION", "BEAST", "CELESTIAL", "CONSTRUCT", "DRAGON", "ELEMENTAL", "FEY", "FIEND", "GIANT", "HUMANOID", "MONSTROSITY", "OOZE", "PLANT", "UNDEAD"];
    for (const flag of typeFlags) {
        const pattern = new RegExp(`\\b${flag.toLowerCase()}s?\\b`);
        if (pattern.test(text)) add(flag);
    }

    const upTo = text.match(/\bup to\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:willing\s+)?(?:creature|creatures|object|objects|target|targets)\b/);
    if (upTo) {
        const parsed = wayBeyond20WordToNumber(upTo[1]);
        if (parsed !== null) {
            targeting.min = 0;
            targeting.max = parsed;
        }
    } else {
        const exact = text.match(/\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten|a|an)\s+(?:willing\s+)?(?:creature|object|target)\b/);
        if (exact) {
            const parsed = wayBeyond20WordToNumber(exact[1]);
            if (parsed !== null) {
                targeting.min = parsed;
                targeting.max = parsed;
            }
        }
    }

    return targeting;
}

function wayBeyond20ParseTalentEffectData(description="") {
    const raw = wayBeyond20NormalizeTalentText(description || "");
    const text = raw.toLowerCase();
    const data = [];
    const addData = (field, value="", string="") => {
        data.push({ field, value, string });
    };

    const acBonus = text.match(/\+(\d+)\s+bonus to ac\b/);
    if (acBonus) addData("AC_BONUS", parseInt(acBonus[1]), "");

    const baseArmor = text.match(/base ac becomes\s+(\d+)\s+plus\s+(?:its|the target's|your)?\s*dexterity modifier/);
    if (baseArmor) addData("BASE_ARMOR", parseInt(baseArmor[1]), "DEX");

    if (/\bspeed is doubled\b|\bdoubles? (?:the target's |your )?speed\b/.test(text)) addData("SPEED_MULTIPLIER", 2, "");

    const saveAdv = text.match(/advantage on (strength|dexterity|constitution|intelligence|wisdom|charisma) saving throws?/);
    if (saveAdv) addData("SAVE_ADVANTAGE", 0, saveAdv[1].slice(0, 3).toUpperCase());

    const conditionMatches = raw.match(/(?:gains?|gain|has|have) the ([A-Za-z ]+?) condition/gi) || [];
    for (const match of conditionMatches) {
        const condition = match.replace(/(?:gains?|gain|has|have) the /i, "").replace(/ condition/i, "").trim().toUpperCase().replace(/\s+/g, "_");
        if (condition) addData("CONDITION", 0, condition);
    }

    const bardicDie = text.match(/bardic inspiration dice?\s*\((\d*d\d+)\)|bardic inspiration dice?\s*(\d*d\d+)/);
    if (/gains? one of your bardic inspiration dice?/.test(text)) {
        addData("BARDIC_INSPIRATION", 1, bardicDie ? (bardicDie[1] || bardicDie[2] || "") : "");
    }
    if (/roll one extra die and discard the lowest/.test(text)) {
        addData("HEALING_EXTRA_DIE_DROP_LOWEST", 1, "");
    }
    if (/temporary hp equal to the damage dealt/.test(text)) {
        addData("TEMP_HP_FROM_DAMAGE", 0, "DAMAGE_DEALT");
    }

    return data;
}

function wayBeyond20ParseTalent({name="", kind="spell", properties={}, description="", level="", castas="", spell_source="", concentration=false, duration=""}={}) {
    const parsedDuration = wayBeyond20ParseTalentDuration(duration || properties["Duration"] || "", description);
    if (concentration) parsedDuration.concentration = true;
    return {
        name,
        kind,
        source: wayBeyond20NormalizeTalentText(spell_source || properties["Source"] || ""),
        level: level || "",
        castAt: castas || "",
        activation: wayBeyond20ParseTalentActivation(properties["Casting Time"] || properties["Activation Time"] || properties["Action Type"] || "", description),
        targeting: wayBeyond20ParseTalentTargeting(properties["Range/Area"] || properties["Range"] || "", description),
        components: wayBeyond20ParseTalentComponents(properties["Components"] || "", description),
        duration: parsedDuration,
        effects: wayBeyond20ParseTalentEffectData(description),
        rawText: wayBeyond20NormalizeTalentText(description)
    };
}

function wayBeyond20BuildKnownSpellEffectData(spell_name) {
    const name = String(spell_name || "").trim().toLowerCase();
    if (name === "mage armor") {
        return [
            {
                field: "BASE_ARMOR",
                value: 13,
                string: "DEX"
            }
        ];
    }
    if (name === "haste") {
        return [
            {
                field: "AC_BONUS",
                value: 2,
                string: ""
            },
            {
                field: "SPEED_MULTIPLIER",
                value: 2,
                string: ""
            },
            {
                field: "SAVE_ADVANTAGE",
                value: 0,
                string: "DEX"
            },
            {
                field: "ACTION_GRANT",
                value: 1,
                string: "HASTE_ACTION"
            }
        ];
    }
    return [];
}

function wayBeyond20BuildSpellEffect(character, spell_name, spell_source, level, castas, concentration, duration, properties, talent=null) {
    const flags = ["magical", "spell-effect"];
    if (concentration) flags.push("concentration");
    if (duration) flags.push("buff");

    const effect = {
        id: wayBeyond20GenerateEffectId(),
        name: spell_name,
        owner: wayBeyond20CurrentCharacterName(character),
        source: wayBeyond20CleanEffectText(spell_source || "Spell", spell_name),
        effectLevel: wayBeyond20ParseEffectLevel(level, castas),
        ownerLevel: wayBeyond20OwnerLevel(character),
        ticksLeft: talent && talent.duration && talent.duration.value !== "" ? talent.duration.value : "",
        updateMode: talent && talent.duration && talent.duration.updateMode ? talent.duration.updateMode : (duration || concentration ? "special" : "manual"),
        flags,
        data: talent && Array.isArray(talent.effects) && talent.effects.length > 0 ? talent.effects : wayBeyond20BuildKnownSpellEffectData(spell_name),
        level: level || "",
        castAt: castas || "",
        concentration: !!concentration,
        duration: duration || "",
        startedAt: new Date().toISOString(),
        characterId: character && character._id ? character._id : ""
    };
    if (properties) {
        effect.range = properties["Range/Area"] || "";
        effect.castingTime = properties["Casting Time"] || "";
    }
    if (talent) {
        effect.talent = {
            activation: talent.activation || null,
            targeting: talent.targeting || null,
            components: talent.components || null,
            duration: talent.duration || null
        };
    }
    return effect;
}


function wayBeyond20EffectTargetForCurrentCharacter(character) {
    return {
        key: "self",
        name: wayBeyond20CurrentCharacterName(character),
        relation: "self",
        character: {
            id: character && character._id !== undefined && character._id !== null ? String(character._id) : "",
            name: wayBeyond20CurrentCharacterName(character)
        }
    };
}

function wayBeyond20NormalizeKnownTarget(rawTarget) {
    if (!rawTarget) return null;
    const name = wayBeyond20NormalizeTalentText(rawTarget.name || rawTarget.tokenName || rawTarget.custom || rawTarget.label || "");
    if (!name) return null;
    return {
        key: String(rawTarget.key || rawTarget.characterId || rawTarget.tokenId || name),
        name,
        relation: rawTarget.relation || "unknown",
        tokenId: rawTarget.tokenId ? String(rawTarget.tokenId) : "",
        character: rawTarget.character || (rawTarget.characterId ? { id: String(rawTarget.characterId), name } : { name })
    };
}

function wayBeyond20GetKnownTargetsForTalent(character) {
    const targets = [];
    const seen = new Set();
    const addTarget = rawTarget => {
        const target = rawTarget && rawTarget.relation === "self" ? rawTarget : wayBeyond20NormalizeKnownTarget(rawTarget);
        if (!target || !target.name) return;
        const key = String(target.key || target.name).toLowerCase();
        if (seen.has(key)) return;
        seen.add(key);
        targets.push(target);
    };

    addTarget(wayBeyond20EffectTargetForCurrentCharacter(character));

    const state = wayBeyond20GetTurnTrackerState ? wayBeyond20GetTurnTrackerState() : {};
    const knownTargets = Array.isArray(state.knownTargets) ? state.knownTargets : [];
    knownTargets.forEach(addTarget);

    return targets;
}

function wayBeyond20EffectHasExecutableTargetData(effect) {
    if (!effect || !Array.isArray(effect.data)) return false;
    const executableFields = new Set(["BASE_ARMOR", "AC_BONUS", "SPEED_MULTIPLIER", "SAVE_ADVANTAGE", "ACTION_GRANT"]);
    return effect.data.some(entry => executableFields.has(String(entry && entry.field || "").trim().toUpperCase()));
}

function wayBeyond20TalentTargetsAnotherCreature(talent) {
    if (!talent || !talent.targeting) return false;
    const targeting = talent.targeting || {};
    const flags = Array.isArray(targeting.flags) ? targeting.flags : [];
    const max = Number(targeting.max || 1);
    const pureSelf = flags.includes("SELF") && max === 1 && !flags.some(flag => !["SELF", "WITHIN_RANGE"].includes(flag));
    if (pureSelf) return false;
    return max >= 1 && flags.some(flag => !["SELF", "WITHIN_RANGE"].includes(flag));
}

function wayBeyond20TalentNeedsTargetSelection(talent, effect) {
    if (!effect || !effect.name) return false;
    if (!wayBeyond20TalentTargetsAnotherCreature(talent)) return false;
    // Do not interrupt the player merely because live rules text mentions a target. Ask only
    // when WayBeyond20 has parsed executable effect data that it can actually apply to that target.
    return wayBeyond20EffectHasExecutableTargetData(effect);
}


function wayBeyond20EscapeHtml(value) {
    return String(value === undefined || value === null ? "" : value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

async function wayBeyond20SelectTalentTargets(character, talent, effect) {
    let targets = wayBeyond20GetKnownTargetsForTalent(character);
    const targeting = talent && talent.targeting ? talent.targeting : {};
    const targetFlags = Array.isArray(targeting.flags) ? targeting.flags : [];
    if (targetFlags.includes("ANOTHER_CREATURE")) {
        targets = targets.filter(target => target && target.relation !== "self");
    }
    if (targets.length === 0) return [];
    const minTargets = Math.max(0, Number(targeting.min || 1));
    const maxTargets = Math.max(minTargets || 1, Number(targeting.max || 1));
    const inputName = "waybeyond20-target";
    const idPrefix = `waybeyond20-target-${Date.now()}`;

    const promptParts = [];
    if (targeting.range) promptParts.push(`Range: ${wayBeyond20EscapeHtml(targeting.range)}`);
    const promptText = promptParts.length > 0 ? `<div class="waybeyond20-target-help">${promptParts.join(" &bull; ")}</div>` : "";

    let html = `<form class="waybeyond20-target-form">${promptText}`;
    html += `<div class="waybeyond20-target-instructions">Choose ${maxTargets === 1 ? "a target" : `up to ${maxTargets} targets`}.</div>`;
    html += `<input type="hidden" id="waybeyond20-target-max" value="${maxTargets}">`;
    html += `<div class="waybeyond20-target-grid">`;

    targets.forEach((target, index) => {
        const key = String(target.key || target.name);
        const label = target.relation === "self" ? `${target.name} (self)` : target.name;
        const safeId = `${idPrefix}-${index}`;
        const type = maxTargets === 1 ? "radio" : "checkbox";
        const checked = index === 0 ? " checked" : "";
        html += `<input class="waybeyond20-target-input" type="${type}" id="${safeId}" name="${inputName}" value="${wayBeyond20EscapeHtml(key)}"${checked}>`;
        html += `<label class="waybeyond20-target-button" for="${safeId}">${wayBeyond20EscapeHtml(label)}</label>`;
    });

    html += `</div>`;
    if (maxTargets > 1) {
        html += `<script>(function(){
            var form=document.currentScript && document.currentScript.closest('form');
            if(!form) return;
            var max=parseInt(form.querySelector('#waybeyond20-target-max').value||'1');
            function refresh(){
                var inputs=Array.prototype.slice.call(form.querySelectorAll('.waybeyond20-target-input'));
                var checked=inputs.filter(function(i){return i.checked;}).length;
                inputs.forEach(function(input){ input.disabled = !input.checked && checked >= max; });
            }
            form.addEventListener('change', refresh);
            refresh();
        })();</script>`;
    }
    html += `</form>`;

    const selectedKeys = await new Promise((resolve) => {
        dndbeyondDiceRoller._prompter.prompt(`${effect.name}: Select Target`, html, "Apply").then((html) => {
            if (!html) {
                resolve(null);
                return;
            }
            const selected = [];
            html.find(`input[name='${inputName}']:checked`).each(function() {
                selected.push($(this).val());
            });
            resolve(selected);
        });
    });

    if (!selectedKeys || selectedKeys.length < minTargets) return [];
    const selected = [];
    for (const key of selectedKeys.slice(0, maxTargets)) {
        const target = targets.find(target => String(target.key || target.name) === String(key));
        if (target) selected.push(target);
    }
    return selected;
}

function wayBeyond20ApplySelectedTargetToEffect(character, effect, target) {
    const next = Object.assign({}, effect);
    const currentName = wayBeyond20CurrentCharacterName(character);
    const targetName = target && target.name ? target.name : currentName;
    next.target = targetName;
    next.targetName = targetName;
    next.targetRelation = target && target.relation ? target.relation : (targetName === currentName ? "self" : "unknown");
    if (target && target.tokenId) next.targetTokenId = target.tokenId;
    if (target && target.character) next.targetCharacter = target.character;
    return next;
}

function wayBeyond20SendEffectToTarget(target, effect) {
    if (!target || !effect || !effect.name) return;
    const targetCharacter = target.character || { name: target.name };
    if (typeof chrome !== "undefined" && chrome.runtime && typeof chrome.runtime.sendMessage === "function") {
        chrome.runtime.sendMessage({
            action: "waybeyond20-add-effect",
            character: targetCharacter,
            effect
        });
    }
}

async function wayBeyond20ApplySpellEffectWithTargets(character, settings_to_change, effect, talent) {
    if (!effect || !effect.name) return { activeEffects: wayBeyond20GetTrackedSpellEffects(), concentration: wayBeyond20GetConcentrationEffect() };

    let localUpdate = { activeEffects: wayBeyond20GetTrackedSpellEffects(), concentration: wayBeyond20GetConcentrationEffect() };
    const targetsAnotherCreature = wayBeyond20TalentTargetsAnotherCreature(talent);
    const hasExecutableTargetData = wayBeyond20EffectHasExecutableTargetData(effect);

    // If the rules mention another target but WayBeyond20 currently has nothing mechanical to
    // apply to that target, do not ask a meaningless targeting question and do not misapply the
    // remote effect to the caster. Concentration still belongs to the caster and remains tracked.
    if (targetsAnotherCreature && !hasExecutableTargetData) {
        if (effect.concentration) {
            const casterConcentration = Object.assign({}, effect, {
                id: wayBeyond20GenerateEffectId(),
                target: wayBeyond20CurrentCharacterName(character),
                targetName: wayBeyond20CurrentCharacterName(character),
                targetRelation: "self",
                data: [],
                flags: wayBeyond20NormalizeEffectFlags([...(effect.flags || []), "concentration"])
            });
            localUpdate = wayBeyond20AddSpellEffectToSettings(character, settings_to_change, casterConcentration);
        }
        wayBeyond20CharacterDebug("Target selection skipped: no executable target effect", {
            name: effect.name,
            targeting: talent && talent.targeting ? talent.targeting : null,
            concentration: !!effect.concentration
        });
        return localUpdate;
    }

    let targets = [wayBeyond20EffectTargetForCurrentCharacter(character)];
    if (wayBeyond20TalentNeedsTargetSelection(talent, effect)) {
        targets = await wayBeyond20SelectTalentTargets(character, talent, effect);
        if (!targets || targets.length === 0) return null;
    }

    let appliedLocal = false;
    let appliedRemote = false;

    for (const target of targets) {
        const targetedEffect = wayBeyond20ApplySelectedTargetToEffect(character, effect, target);
        if (target.relation === "self" || wayBeyond20CharacterMatchesMessageCharacter(target.character || target.name)) {
            localUpdate = wayBeyond20AddSpellEffectToSettings(character, settings_to_change, targetedEffect);
            appliedLocal = true;
            continue;
        }

        appliedRemote = true;
        const remoteEffect = Object.assign({}, targetedEffect, {
            id: wayBeyond20GenerateEffectId(),
            concentration: false,
            flags: wayBeyond20NormalizeEffectFlags((targetedEffect.flags || []).filter(flag => flag !== "concentration").concat(targetedEffect.concentration ? ["concentration-dependent"] : []))
        });
        wayBeyond20SendEffectToTarget(target, remoteEffect);
    }

    // A concentration spell cast on another target still belongs to the caster's concentration.
    if (!appliedLocal && appliedRemote && effect.concentration) {
        const casterConcentration = Object.assign({}, effect, {
            id: wayBeyond20GenerateEffectId(),
            target: wayBeyond20CurrentCharacterName(character),
            targetName: wayBeyond20CurrentCharacterName(character),
            targetRelation: "self",
            data: [],
            flags: wayBeyond20NormalizeEffectFlags([...(effect.flags || []), "concentration"])
        });
        localUpdate = wayBeyond20AddSpellEffectToSettings(character, settings_to_change, casterConcentration);
    }

    return localUpdate;
}

function wayBeyond20AddSpellEffectToSettings(character, settings_to_change, effect) {
    if (!character || !settings_to_change || !effect || !effect.name) return { activeEffects: [], concentration: null };
    const existing = character.getSetting("waybeyond20-active-effects", []);
    let activeEffects = Array.isArray(existing) ? existing.slice() : [];

    // Do not block duplicate effects by default. Multiple instances may matter because owner,
    // source, effect level, duration, and dispel behavior can differ. Concentration is the
    // exception because the rules themselves say a new concentration effect ends the previous one.
    if (effect.concentration) {
        activeEffects = activeEffects.filter(active_effect => !active_effect.concentration);
    }

    activeEffects.push(effect);
    settings_to_change["waybeyond20-active-effects"] = activeEffects;
    if (effect.concentration) {
        settings_to_change["waybeyond20-concentration"] = effect;
    }
    return {
        activeEffects,
        concentration: effect.concentration ? effect : (character.getSetting("waybeyond20-concentration", null) || null)
    };
}

function wayBeyond20EscapeRegExp(text) {
    return String(text || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function wayBeyond20CleanEffectText(text, effectName) {
    let cleaned = String(text || "")
        .replace(/Display in VTT/gi, "")
        .replace(/\s+/g, " ")
        .trim();
    const name = String(effectName || "").trim();
    if (name) {
        const escapedName = wayBeyond20EscapeRegExp(name);
        cleaned = cleaned.replace(new RegExp(escapedName + "\\s*$", "i"), "").trim();
    }
    return cleaned;
}

function wayBeyond20FormatEffectTooltip(effect) {
    if (!effect || !effect.name) return "";
    const details = [];
    if (effect.duration) details.push(effect.duration);
    if (effect.castAt) details.push("Cast at " + effect.castAt);
    if (effect.checkTotal !== undefined && effect.checkTotal !== null && effect.checkTotal !== "") details.push("Check " + effect.checkTotal);
    if (effect.hideDc !== undefined && effect.hideDc !== null && effect.hideDc !== "") details.push("Perception DC " + effect.hideDc);
    if (Array.isArray(effect.conditions) && effect.conditions.length > 0) details.push("Conditions: " + effect.conditions.join(", "));
    const source = wayBeyond20CleanEffectText(effect.source, effect.name);
    if (source) details.push(source);
    return effect.name + (details.length > 0 ? " — " + details.join("; ") : "");
}

function wayBeyond20GetTrackedSpellEffects() {
    if (!character) return [];
    const effects = character.getSetting("waybeyond20-active-effects", []);
    if (!Array.isArray(effects)) return [];
    return effects.filter(effect => effect && effect.name);
}

function wayBeyond20GetConcentrationEffect() {
    if (!character) return null;
    const concentration = character.getSetting("waybeyond20-concentration", null);
    if (concentration && concentration.name) return concentration;
    return wayBeyond20GetTrackedSpellEffects().find(effect => effect && effect.concentration && effect.name) || null;
}


function wayBeyond20ParseInteger(value) {
    const match = String(value ?? "").match(/-?\d+/);
    return match ? parseInt(match[0]) : null;
}

function wayBeyond20FormatSigned(value) {
    const numeric = parseInt(value) || 0;
    return numeric >= 0 ? `+${numeric}` : `${numeric}`;
}

function wayBeyond20EffectName(effect) {
    return String(effect && effect.name ? effect.name : "").trim().toLowerCase();
}

function wayBeyond20HasActiveEffect(effectName) {
    const normalized = String(effectName || "").trim().toLowerCase();
    if (!normalized) return false;
    return wayBeyond20GetTrackedSpellEffects().some(effect => wayBeyond20EffectName(effect) === normalized);
}

function wayBeyond20EffectDataEntries(effect) {
    if (!effect || !Array.isArray(effect.data)) return [];
    return effect.data.filter(entry => entry && entry.field);
}

function wayBeyond20EffectHasFlag(effect, flag) {
    const target = String(flag || "").trim().toLowerCase();
    if (!target || !effect || !Array.isArray(effect.flags)) return false;
    return effect.flags.some(value => String(value || "").trim().toLowerCase() === target);
}

function wayBeyond20ResolveEffectDataValue(entry) {
    if (!entry) return null;
    const base = wayBeyond20ParseInteger(entry.value);
    if (base === null) return null;
    const ability = String(entry.string || "").trim().toUpperCase();
    if (ability) {
        const abilityData = character && character.getAbility ? character.getAbility(ability) : null;
        const abilityMod = abilityData && abilityData.mod !== undefined ? parseInt(abilityData.mod) || 0 : 0;
        return base + abilityMod;
    }
    return base;
}

function wayBeyond20BuildActiveEffectMechanics(effects) {
    const mechanics = {
        baseArmor: null,
        acBonus: 0,
        speedMultiplier: 1,
        dexSaveAdvantage: false,
        hasteAction: false,
        notes: []
    };

    const activeEffects = Array.isArray(effects) ? effects : wayBeyond20GetTrackedSpellEffects();
    for (const effect of activeEffects) {
        const name = wayBeyond20EffectName(effect);
        const dataEntries = wayBeyond20EffectDataEntries(effect);

        for (const entry of dataEntries) {
            const field = String(entry.field || "").trim().toUpperCase();
            if (field === "BASE_ARMOR") {
                const value = wayBeyond20ResolveEffectDataValue(entry);
                if (value !== null) {
                    mechanics.baseArmor = mechanics.baseArmor === null ? value : Math.max(mechanics.baseArmor, value);
                    const ability = String(entry.string || "").trim().toUpperCase();
                    mechanics.notes.push(`${effect.name}: base AC becomes ${entry.value}${ability ? " + " + ability : ""}.`);
                }
            } else if (field === "AC_BONUS") {
                const value = wayBeyond20ParseInteger(entry.value);
                if (value !== null) mechanics.acBonus += value;
            } else if (field === "SPEED_MULTIPLIER") {
                const value = wayBeyond20ParseInteger(entry.value);
                if (value !== null && value > mechanics.speedMultiplier) mechanics.speedMultiplier = value;
            } else if (field === "SAVE_ADVANTAGE") {
                const ability = String(entry.string || "").trim().toUpperCase();
                if (ability === "DEX") mechanics.dexSaveAdvantage = true;
            } else if (field === "ACTION_GRANT") {
                const action = String(entry.string || "").trim().toUpperCase();
                if (action === "HASTE_ACTION") mechanics.hasteAction = true;
            }
        }

        // Backward compatibility for effects created by older draft builds before data[] existed.
        if (dataEntries.length === 0) {
            if (name === "mage armor") {
                const dex = character && character.getAbility ? character.getAbility("DEX") : null;
                const dexMod = dex && dex.mod !== undefined ? parseInt(dex.mod) || 0 : 0;
                const mageArmorAc = 13 + dexMod;
                mechanics.baseArmor = mechanics.baseArmor === null ? mageArmorAc : Math.max(mechanics.baseArmor, mageArmorAc);
                mechanics.notes.push(`Mage Armor: base AC becomes ${mageArmorAc} (13 + DEX ${wayBeyond20FormatSigned(dexMod)}).`);
            }

            if (name === "haste") {
                mechanics.acBonus += 2;
                mechanics.speedMultiplier = Math.max(mechanics.speedMultiplier, 2);
                mechanics.dexSaveAdvantage = true;
                mechanics.hasteAction = true;
                mechanics.notes.push("Haste: +2 AC, doubled speed, advantage on DEX saves, and one limited additional action.");
            }
        }
    }

    return mechanics;
}

function wayBeyond20RenderedAttrName(attrName) {
    return String(attrName || "").replace("-base-", "-rendered-");
}

function wayBeyond20GetStoredBaseNumber(element, attrName, fallbackValue) {
    if (!element || element.length === 0) return wayBeyond20ParseInteger(fallbackValue);

    const renderedAttrName = wayBeyond20RenderedAttrName(attrName);
    const storedBase = wayBeyond20ParseInteger(element.attr(attrName));
    const storedRendered = wayBeyond20ParseInteger(element.attr(renderedAttrName));
    const current = wayBeyond20ParseInteger(element.text());

    // If the visible number is the one WayBeyond20 last rendered, the real D&D Beyond
    // value is still the cached native/base number. This prevents our own overlay from
    // becoming the new baseline.
    if (current !== null && storedRendered !== null && current === storedRendered && storedBase !== null) {
        return storedBase;
    }

    // Otherwise D&D Beyond has either rendered normally or refreshed the field after an
    // armor/equipment change. Treat the visible number as the new native/base value.
    if (current !== null) {
        element.attr(attrName, String(current));
        element.removeAttr(renderedAttrName);
        return current;
    }

    return storedBase !== null ? storedBase : wayBeyond20ParseInteger(fallbackValue);
}

function wayBeyond20SetNumericDisplay(selector, attrName, value, options = {}) {
    const elements = $(selector);
    if (elements.length === 0) return;

    const renderedAttrName = wayBeyond20RenderedAttrName(attrName);
    const addBuffedClass = options.addBuffedClass !== false;

    elements.each(function() {
        const element = $(this);
        const current = wayBeyond20ParseInteger(element.text());
        const storedBase = wayBeyond20ParseInteger(element.attr(attrName));
        const storedRendered = wayBeyond20ParseInteger(element.attr(renderedAttrName));

        if (value === null || value === undefined) {
            // When removing a WayBeyond20 overlay, only restore the cached native value if
            // the visible field is still our last rendered value. If D&D Beyond already
            // updated the value, leave it alone.
            if (current !== null && storedRendered !== null && current === storedRendered && storedBase !== null) {
                if (element.text().trim() !== String(storedBase)) element.text(String(storedBase));
            }
            element.removeAttr(attrName);
            element.removeAttr(renderedAttrName);
            element.removeClass("waybeyond20-buffed-stat");
            return;
        }

        // If the current value is not our last overlay, it is D&D Beyond's native value.
        // Refresh the base cache so donning/doffing armor is not overwritten by stale data.
        if (current !== null && !(storedRendered !== null && current === storedRendered && storedBase !== null)) {
            element.attr(attrName, String(current));
        } else if (storedBase === null && current !== null) {
            element.attr(attrName, String(current));
        }

        const replacement = String(value);
        if (element.text().trim() !== replacement) element.text(replacement);
        element.attr(renderedAttrName, replacement);
        if (addBuffedClass) {
            element.addClass("waybeyond20-buffed-stat");
        } else {
            element.removeClass("waybeyond20-buffed-stat");
        }
    });
}

function wayBeyond20EffectSourceLabel(effect) {
    if (!effect || !effect.name) return "WayBeyond20 Effects";
    const names = [];
    const activeEffects = Array.isArray(effect) ? effect : [effect];
    for (const item of activeEffects) {
        if (item && item.name && !names.includes(item.name)) names.push(item.name);
    }
    return names.length ? names.join(", ") : "Effect";
}

function wayBeyond20BuildAcDisplayAdjustment(mechanics, effects = []) {
    const result = {
        adjustment: 0,
        lines: []
    };

    const activeEffects = Array.isArray(effects) ? effects : [];

    for (const effect of activeEffects) {
        const dataEntries = wayBeyond20EffectDataEntries(effect);
        for (const entry of dataEntries) {
            const field = String(entry.field || "").trim().toUpperCase();
            if (field === "AC_BONUS") {
                const value = wayBeyond20ParseInteger(entry.value);
                if (value !== null && value !== 0) {
                    result.adjustment += value;
                    const bonusType = wayBeyond20EffectHasFlag(effect, "magical") ? "Magic Bonus" : "Misc Bonus";
                    result.lines.push({
                        value,
                        bonusType,
                        sourceName: effect && effect.name ? effect.name : "Effect"
                    });
                }
            } else if (field === "BASE_ARMOR") {
                // BASE_ARMOR is stored as the rule text/effect data. Translating it into a D&D Beyond
                // native AC formula is still a separate integration task. Do not silently fake this here.
                // AC_BONUS effects, such as Shield of Faith, can be represented as a visible additive
                // adjustment and breakdown line without changing the D&D Beyond native base calculation.
            }
        }
    }

    // Backward compatibility for old Haste records without data[].
    for (const effect of activeEffects) {
        if (wayBeyond20EffectDataEntries(effect).length > 0) continue;
        if (wayBeyond20EffectName(effect) === "haste") {
            result.adjustment += 2;
            result.lines.push({ value: 2, bonusType: "Magic Bonus", sourceName: "Haste" });
        }
    }

    return result;
}

function wayBeyond20FindArmorClassPopover() {
    const candidates = $("body *").filter(function() {
        if (!wayBeyond20IsVisibleElement(this)) return false;
        const text = String(this.textContent || "").replace(/\s+/g, " ").trim();
        return /^Armor Class:\s*\d+/.test(text);
    });

    if (candidates.length === 0) return $();

    // Prefer the smallest visible container that also contains the Customize section from the AC pane.
    let best = $();
    candidates.each(function() {
        const header = $(this);
        const containers = header.parents("div").toArray();
        for (const container of containers) {
            const element = $(container);
            const text = String(element.text() || "").replace(/\s+/g, " ").trim();
            if (text.includes("Armor Class:") && text.includes("Customize") && text.length < 2500) {
                if (best.length === 0 || text.length < String(best.text() || "").length) best = element;
                break;
            }
        }
    });

    return best;
}

function wayBeyond20PatchArmorClassHeader(pane, acAdjustment) {
    if (!pane || pane.length === 0) return;

    const total = acAdjustment && Array.isArray(acAdjustment.lines)
        ? acAdjustment.lines.reduce((sum, line) => sum + (parseInt(line.value) || 0), 0)
        : 0;

    const header = pane.find("*").addBack().filter(function() {
        if (!wayBeyond20IsVisibleElement(this)) return false;
        return /^Armor Class:\s*\d+/.test(wayBeyond20ElementOwnText(this).trim());
    }).first();

    if (header.length === 0) return;

    const baseAttr = "data-waybeyond20-ac-header-base";
    const renderedAttr = "data-waybeyond20-ac-header-rendered";
    const ownText = wayBeyond20ElementOwnText(header[0]).trim();
    const currentMatch = ownText.match(/^Armor Class:\s*(\d+)/);
    const current = currentMatch ? parseInt(currentMatch[1]) : null;
    const storedBase = wayBeyond20ParseInteger(header.attr(baseAttr));
    const storedRendered = wayBeyond20ParseInteger(header.attr(renderedAttr));

    if (!total) {
        if (current !== null && storedRendered !== null && current === storedRendered && storedBase !== null) {
            header.text(`Armor Class: ${storedBase}`);
        }
        header.removeAttr(baseAttr);
        header.removeAttr(renderedAttr);
        return;
    }

    let base = current;
    if (current !== null && storedRendered !== null && current === storedRendered && storedBase !== null) {
        base = storedBase;
    }

    if (base === null) return;

    const rendered = base + total;
    header.attr(baseAttr, String(base));
    header.attr(renderedAttr, String(rendered));
    header.text(`Armor Class: ${rendered}`);
}

function wayBeyond20FindCustomizeSection(pane) {
    if (!pane || pane.length === 0) return $();

    const customize = pane.find("*").filter(function() {
        if (!wayBeyond20IsVisibleElement(this)) return false;
        return wayBeyond20ElementOwnText(this).trim().toUpperCase() === "CUSTOMIZE";
    }).first();

    if (customize.length === 0) return $();

    let node = customize[0];
    let best = node;
    while (node && node.parentElement && node.parentElement !== pane[0]) {
        const parent = node.parentElement;
        const text = String(parent.textContent || "").replace(/\s+/g, " ").trim();
        best = parent;
        if (text.includes("Customize") && (text.includes("Override") || text.includes("Additional"))) {
            break;
        }
        node = parent;
    }

    return $(best);
}

function wayBeyond20PatchArmorClassBreakdown(acAdjustment) {
    $(".waybeyond20-ac-breakdown-line").remove();

    const pane = wayBeyond20FindArmorClassPopover();
    if (pane.length === 0) return;

    wayBeyond20PatchArmorClassHeader(pane, acAdjustment);

    if (!acAdjustment || !Array.isArray(acAdjustment.lines) || acAdjustment.lines.length === 0) return;

    const lines = acAdjustment.lines.filter(line => line && parseInt(line.value));
    if (lines.length === 0) return;

    const rows = $("<div>").addClass("waybeyond20-ac-breakdown-line").css({
        display: "block",
        width: "100%",
        flex: "0 0 100%",
        clear: "both",
        padding: "0.25em 0",
        borderTop: "1px solid rgba(127, 127, 127, 0.25)",
        borderBottom: "1px solid rgba(127, 127, 127, 0.15)",
        margin: "0.25em 0"
    });

    for (const line of lines) {
        const value = parseInt(line.value) || 0;
        const bonusType = String(line.bonusType || "Magic Bonus").trim();
        const sourceName = String(line.sourceName || "").trim();
        const row = $("<div>").css({
            display: "grid",
            gridTemplateColumns: "2.25em minmax(0, 1fr)",
            columnGap: "0.35em",
            alignItems: "baseline",
            width: "100%",
            lineHeight: "1.5",
            padding: "0.1em 0"
        });
        row.append($("<strong>").text(wayBeyond20FormatSigned(value)).css({
            minWidth: "0",
            textAlign: "left"
        }));
        const label = $("<span>");
        label.append(document.createTextNode(bonusType));
        if (sourceName) {
            label.append(document.createTextNode(" "));
            label.append($("<span>").text(`(${sourceName})`).css({ opacity: 0.75 }));
        }
        row.append(label);
        rows.append(row);
    }

    const customizeSection = wayBeyond20FindCustomizeSection(pane);
    if (customizeSection.length > 0) {
        customizeSection.before(rows);
    } else {
        pane.append(rows);
    }
}

function wayBeyond20ApplyActiveEffectMechanics(effects) {
    if (!character) return;

    const activeEffects = Array.isArray(effects) ? effects : wayBeyond20GetTrackedSpellEffects();
    const mechanics = wayBeyond20BuildActiveEffectMechanics(activeEffects);

    const acSelector = ".ct-armor-class-box__value,.ddbc-armor-class-box__value,.ct-combat-mobile__extra--ac .ct-combat-mobile__extra-value,.ddbc-combat-mobile__extra--ac .ddbc-combat-mobile__extra-value";
    const speedSelector = ".ct-speed-box__box-value .ct-distance-number__number,.ddbc-speed-box__box-value .ddbc-distance-number__number,.ct-combat-mobile__extra--speed .ct-combat-mobile__extra-value .ct-distance-number__number,.ddbc-combat-mobile__extra--speed .ddbc-combat-mobile__extra-value .ddbc-distance-number__number";

    // D&D Beyond does not expose a stable public mutation point for temporary AC effects.
    // Until the true native custom-modifier path is identified, apply only additive AC bonuses
    // as a clean display adjustment: no green buffed-stat class, no native value mutation, and
    // add a WayBeyond20 line to the AC breakdown when the AC pane is open. This keeps Shield of
    // Faith/Haste visible and reversible without pretending the base AC formula changed.
    const acAdjustment = wayBeyond20BuildAcDisplayAdjustment(mechanics, activeEffects);
    const acElement = $(acSelector).first();
    const baseAc = wayBeyond20GetStoredBaseNumber(acElement, "data-waybeyond20-base-ac", character._ac);
    const calculatedAc = baseAc !== null && acAdjustment.adjustment ? baseAc + acAdjustment.adjustment : null;
    wayBeyond20SetNumericDisplay(acSelector, "data-waybeyond20-base-ac", calculatedAc, { addBuffedClass: false });
    wayBeyond20PatchArmorClassBreakdown(acAdjustment);

    const speedElement = $(speedSelector).first();
    const baseSpeed = wayBeyond20GetStoredBaseNumber(speedElement, "data-waybeyond20-base-speed", character._speed);
    let calculatedSpeed = baseSpeed;
    if (calculatedSpeed !== null && mechanics.speedMultiplier && mechanics.speedMultiplier !== 1) {
        calculatedSpeed = calculatedSpeed * mechanics.speedMultiplier;
    }

    const hasSpeedEffect = calculatedSpeed !== null && calculatedSpeed !== baseSpeed;
    wayBeyond20SetNumericDisplay(speedSelector, "data-waybeyond20-base-speed", hasSpeedEffect ? calculatedSpeed : null);
}


function wayBeyond20GetTurnTrackerState() {
    if (!character) return {};
    const state = character.getSetting("waybeyond20-turn-state", {});
    return state && typeof state === "object" ? state : {};
}

function wayBeyond20TurnTrackerStateEquals(a, b) {
    try {
        return JSON.stringify(a || {}) === JSON.stringify(b || {});
    } catch (error) {
        return false;
    }
}

function wayBeyond20SetTurnTrackerState(state, callback = null) {
    if (!character) return;
    const nextState = state || {};
    const currentState = wayBeyond20GetTurnTrackerState();
    if (wayBeyond20TurnTrackerStateEquals(currentState, nextState)) {
        if (callback) callback();
        return;
    }
    character.mergeCharacterSettings({ "waybeyond20-turn-state": nextState }, () => {
        if (callback) callback();
    });
}

function wayBeyond20IsMainCharacterSheet() {
    return /\/characters\/\d+(?:$|[/?#])/.test(window.location.pathname + window.location.search + window.location.hash);
}

function wayBeyond20HasHasteAction(effects = null) {
    const activeEffects = Array.isArray(effects) ? effects : wayBeyond20GetTrackedSpellEffects();
    const mechanics = wayBeyond20BuildActiveEffectMechanics(activeEffects);
    return !!(mechanics.hasteAction || wayBeyond20EffectIsActive(activeEffects, "Haste"));
}

function wayBeyond20BuildTurnResourceDefaults(effects = null) {
    const speed = wayBeyond20GetCurrentDisplayedSpeed();
    const hasHaste = wayBeyond20HasHasteAction(effects);
    return {
        action: 1,
        bonusAction: 1,
        reaction: 1,
        hasteAction: hasHaste ? 1 : 0,
        movement: speed,
        maxAction: 1,
        maxBonusAction: 1,
        maxReaction: 1,
        maxHasteAction: hasHaste ? 1 : 0,
        maxMovement: speed
    };
}

function wayBeyond20NormalizeTurnTrackerState(state, effects = null, options = {}) {
    const current = state && typeof state === "object" ? Object.assign({}, state) : {};
    const defaults = wayBeyond20BuildTurnResourceDefaults(effects);
    if (options.reset || current.action === undefined) current.action = defaults.action;
    if (options.reset || current.bonusAction === undefined) current.bonusAction = defaults.bonusAction;
    if (options.reset || current.reaction === undefined) current.reaction = defaults.reaction;
    if (options.reset || current.movement === undefined) current.movement = defaults.movement;
    if (options.reset || current.maxAction === undefined) current.maxAction = defaults.maxAction;
    if (options.reset || current.maxBonusAction === undefined) current.maxBonusAction = defaults.maxBonusAction;
    if (options.reset || current.maxReaction === undefined) current.maxReaction = defaults.maxReaction;
    current.maxHasteAction = defaults.maxHasteAction;
    current.maxMovement = defaults.maxMovement;
    if (defaults.maxHasteAction > 0) {
        if (options.reset || current.hasteAction === undefined) current.hasteAction = defaults.hasteAction;
    } else {
        current.hasteAction = 0;
    }
    current.action = Math.max(0, wayBeyond20ParseInteger(current.action) ?? defaults.action);
    current.bonusAction = Math.max(0, wayBeyond20ParseInteger(current.bonusAction) ?? defaults.bonusAction);
    current.reaction = Math.max(0, wayBeyond20ParseInteger(current.reaction) ?? defaults.reaction);
    current.hasteAction = Math.max(0, wayBeyond20ParseInteger(current.hasteAction) ?? defaults.hasteAction);
    current.movement = Math.max(0, wayBeyond20ParseInteger(current.movement) ?? defaults.movement);
    return current;
}

function wayBeyond20EffectIsActive(effects, effectName) {
    const normalized = String(effectName || "").trim().toLowerCase();
    if (!normalized) return false;
    const activeEffects = Array.isArray(effects) ? effects : wayBeyond20GetTrackedSpellEffects();
    return activeEffects.some(effect => wayBeyond20EffectName(effect) === normalized);
}

function wayBeyond20GetCurrentDisplayedSpeed() {
    const speedSelector = ".ct-speed-box__box-value .ct-distance-number__number,.ddbc-speed-box__box-value .ddbc-distance-number__number,.ct-combat-mobile__extra--speed .ct-combat-mobile__extra-value .ct-distance-number__number,.ddbc-combat-mobile__extra--speed .ddbc-combat-mobile__extra-value .ct-distance-number__number";
    const displayed = wayBeyond20ParseInteger($(speedSelector).first().text());
    if (displayed !== null) return displayed;
    const characterSpeed = wayBeyond20ParseInteger(character && character._speed !== undefined ? character._speed : "");
    return characterSpeed !== null ? characterSpeed : 0;
}

function wayBeyond20HasActiveCombatState(state) {
    if (!state || state.inCombat !== true) return false;
    if (!String(state.combatSource || "").trim()) return false;
    const startedAt = Number(state.combatStartedAt || 0);
    return Number.isFinite(startedAt) && startedAt > 0;
}

function wayBeyond20SpendTurnResource(resource, options = {}) {
    if (!character || !resource) return false;
    const activeEffects = wayBeyond20GetTrackedSpellEffects();
    const state = wayBeyond20NormalizeTurnTrackerState(wayBeyond20GetTurnTrackerState(), activeEffects);
    if (!wayBeyond20HasActiveCombatState(state)) return false;
    const current = wayBeyond20ParseInteger(state[resource]);
    if (current === null) return false;

    // Never block or intercept a D&D Beyond roll. Resource tracking is advisory;
    // an unavailable resource remains at zero and the native roll continues.
    if (current <= 0) {
        wayBeyond20CharacterDebug("Turn resource unavailable; roll allowed", {
            resource,
            current,
            forRoll: options.forRoll === true
        });
        return false;
    }

    state[resource] = Math.max(0, current - 1);
    wayBeyond20CharacterDebug("Turn resource spent", {
        resource,
        before: current,
        after: state[resource],
        forRoll: options.forRoll === true
    });
    wayBeyond20SetTurnTrackerState(state, wayBeyond20ScheduleActiveEffectBadgeRefresh);
    return true;
}

function wayBeyond20ActivationResource(properties = {}, talent = null, fallback = null) {
    const activation = talent && talent.activation ? talent.activation : null;
    if (activation && Number(activation.cost) === 0) return null;
    let type = activation && activation.type ? String(activation.type) : "";
    if (!type) {
        type = [
            properties["Activation Time"],
            properties["Casting Time"],
            properties["Action Type"],
            properties["Activation"],
            fallback
        ].filter(Boolean).join(" ");
    }
    const normalized = String(type || "").trim().toLowerCase().replace(/[_ ]+/g, "-");
    if (normalized.includes("haste-action")) return "hasteAction";
    if (normalized.includes("bonus-action")) return "bonusAction";
    if (normalized.includes("reaction")) return "reaction";
    if (normalized === "action" || normalized.includes("1-action") || normalized.includes("utilize-action")) return "action";
    return ["action", "bonusAction", "reaction", "hasteAction"].includes(fallback) ? fallback : null;
}

function wayBeyond20TurnResourceName(resource) {
    const names = {
        action: "Action",
        bonusAction: "Bonus Action",
        reaction: "Reaction",
        hasteAction: "Haste Action"
    };
    return names[resource] || "turn resource";
}

async function wayBeyond20PreflightTurnResource(resource, options = {}) {
    if (!character || !resource) return true;
    const activeEffects = wayBeyond20GetTrackedSpellEffects();
    const state = wayBeyond20NormalizeTurnTrackerState(wayBeyond20GetTurnTrackerState(), activeEffects);
    if (!wayBeyond20HasActiveCombatState(state)) return true;
    const current = wayBeyond20ParseInteger(state[resource]);
    if (current === null || current > 0) return true;

    const resourceName = wayBeyond20TurnResourceName(resource);
    wayBeyond20CharacterDebug("Unavailable turn resource warning displayed", {
        resource,
        resourceName,
        current,
        name: options.name || "",
        rollType: options.rollType || ""
    });
    const proceed = await wayBeyond20ConfirmChoice(
        `No ${resourceName} Available`,
        `You have no available ${resourceName} this turn. Do you wish to proceed anyway?`,
        "Proceed",
        "Cancel"
    );
    wayBeyond20CharacterDebug("Unavailable turn resource warning resolved", {
        resource,
        resourceName,
        current,
        proceed,
        name: options.name || "",
        rollType: options.rollType || ""
    });
    return proceed;
}

async function wayBeyond20UseTurnResource(resource, options = {}) {
    if (!character || !resource) return true;
    const activeEffects = wayBeyond20GetTrackedSpellEffects();
    const state = wayBeyond20NormalizeTurnTrackerState(wayBeyond20GetTurnTrackerState(), activeEffects);
    if (!wayBeyond20HasActiveCombatState(state)) return true;
    const current = wayBeyond20ParseInteger(state[resource]);
    if (current === null) return true;

    if (current <= 0) {
        const resourceName = wayBeyond20TurnResourceName(resource);
        wayBeyond20CharacterDebug("Unavailable turn resource warning displayed", {
            resource,
            resourceName,
            current,
            name: options.name || "",
            rollType: options.rollType || ""
        });
        const proceed = await wayBeyond20ConfirmChoice(
            `No ${resourceName} Available`,
            `You have no available ${resourceName} this turn. Do you wish to proceed anyway?`,
            "Proceed",
            "Cancel"
        );
        wayBeyond20CharacterDebug("Unavailable turn resource warning resolved", {
            resource,
            resourceName,
            current,
            proceed,
            name: options.name || "",
            rollType: options.rollType || ""
        });
        return proceed;
    }

    state[resource] = Math.max(0, current - 1);
    wayBeyond20CharacterDebug("Turn resource spent", {
        resource,
        before: current,
        after: state[resource],
        forRoll: true,
        name: options.name || "",
        rollType: options.rollType || ""
    });
    wayBeyond20SetTurnTrackerState(state, wayBeyond20ScheduleActiveEffectBadgeRefresh);
    return true;
}

function wayBeyond20AttachTurnResource(rollProperties, resource, options = {}) {
    if (!rollProperties || !resource) return null;
    rollProperties["waybeyond20-turn-resource"] = {
        resource,
        name: options.name || rollProperties.name || "",
        rollType: options.rollType || ""
    };
    return resource;
}

function wayBeyond20AttachActivationResource(rollProperties, properties = {}, talent = null, fallback = null, options = {}) {
    const resource = wayBeyond20ActivationResource(properties, talent, fallback);
    if (resource) wayBeyond20AttachTurnResource(rollProperties, resource, options);
    return resource;
}

function wayBeyond20BuildTurnResourceChip(label, resource, count, isMovement = false) {
    const chip = $("<span>").addClass("waybeyond20-turn-resource-chip").text(label);
    if (isMovement) {
        chip.addClass("waybeyond20-turn-resource-movement");
        return chip;
    }
    chip.attr("role", "button");
    chip.attr("tabindex", "0");
    chip.attr("data-waybeyond20-resource", resource);
    if ((wayBeyond20ParseInteger(count) ?? 0) <= 0) chip.addClass("waybeyond20-turn-resource-spent");
    const spend = event => {
        event.preventDefault();
        event.stopPropagation();
        wayBeyond20SpendTurnResource(resource);
    };
    chip.on("click", spend);
    chip.on("keydown", event => {
        if (event.key === "Enter" || event.key === " ") spend(event);
    });
    return chip;
}

function wayBeyond20TurnResourceLabel(label, count) {
    const amount = wayBeyond20ParseInteger(count);
    if (amount !== null && amount > 1) return `${label}:${amount}`;
    return label;
}

const WAYBEYOND20_CLASS_HIT_DICE = {
    Artificer: "d8",
    Barbarian: "d12",
    Bard: "d8",
    "Blood Hunter": "d10",
    Cleric: "d8",
    Druid: "d8",
    Fighter: "d10",
    Monk: "d8",
    Paladin: "d10",
    Ranger: "d10",
    Rogue: "d8",
    Sorcerer: "d6",
    Warlock: "d8",
    Wizard: "d6"
};

function wayBeyond20BuildHitDiceDefaults() {
    const pools = {};
    const classes = character && character._classes && typeof character._classes === "object" ? character._classes : {};
    for (const [className, rawLevel] of Object.entries(classes)) {
        const die = WAYBEYOND20_CLASS_HIT_DICE[className];
        const level = Math.max(0, wayBeyond20ParseInteger(rawLevel) ?? 0);
        if (!die || level <= 0) continue;
        if (!pools[die]) pools[die] = { remaining: 0, max: 0 };
        pools[die].remaining += level;
        pools[die].max += level;
    }
    return pools;
}

function wayBeyond20GetHitDiceState() {
    if (!character) return {};
    const defaults = wayBeyond20BuildHitDiceDefaults();
    const stored = character.getSetting("waybeyond20-hit-dice-state", {});
    const state = {};
    for (const [die, fallback] of Object.entries(defaults)) {
        const current = stored && stored[die] && typeof stored[die] === "object" ? stored[die] : {};
        const max = Math.max(0, fallback.max);
        const storedMax = Math.max(0, wayBeyond20ParseInteger(current.max) ?? max);
        const storedRemaining = Math.min(storedMax, Math.max(0, wayBeyond20ParseInteger(current.remaining) ?? storedMax));
        const used = Math.max(0, storedMax - storedRemaining);
        const remaining = Math.max(0, Math.min(max, max - used));
        state[die] = { remaining, max };
    }
    return state;
}

function wayBeyond20SetHitDiceState(state, callback = null, source = "unknown") {
    if (!character) return;
    character.mergeCharacterSettings({ "waybeyond20-hit-dice-state": state || {} }, () => {
        wayBeyond20CharacterDebug("Hit Dice state saved", { state, source });
        if (callback) callback();
    });
}

function wayBeyond20AdjustHitDice(die, delta, source = "manual") {
    const state = wayBeyond20GetHitDiceState();
    if (!state[die]) return false;
    const current = state[die];
    current.remaining = Math.min(current.max, Math.max(0, current.remaining + delta));
    wayBeyond20SetHitDiceState(state, wayBeyond20ScheduleActiveEffectBadgeRefresh, source);
    return true;
}

function wayBeyond20ResetHitDice(source = "manual-reset") {
    const state = wayBeyond20GetHitDiceState();
    for (const pool of Object.values(state)) pool.remaining = pool.max;
    wayBeyond20SetHitDiceState(state, wayBeyond20ScheduleActiveEffectBadgeRefresh, source);
}

function wayBeyond20InjectHitDiceTracker() {
    if (!wayBeyond20IsMainCharacterSheet() || !character) {
        $(".waybeyond20-hit-dice-tracker").remove();
        return;
    }
    const hitPointsHeader = wayBeyond20FindVisibleTextElement("HIT POINTS", { avoidTransientPanels: true, preferCompact: true });
    const container = wayBeyond20FindHitPointsTrackerContainer(hitPointsHeader);
    if (!container.length) return;

    const state = wayBeyond20GetHitDiceState();
    const entries = Object.entries(state).sort((a, b) => parseInt(a[0].slice(1)) - parseInt(b[0].slice(1)));
    if (!entries.length) {
        $(".waybeyond20-hit-dice-tracker").remove();
        return;
    }

    let tracker = container.find(".waybeyond20-hit-dice-tracker").first();
    if (!tracker.length) {
        tracker = $("<div>").addClass("waybeyond20-hit-dice-tracker");
        container.append(tracker);
    }
    const signature = JSON.stringify(state);
    if (tracker.attr("data-waybeyond20-signature") === signature) return;
    tracker.attr("data-waybeyond20-signature", signature).empty();
    tracker.append($("<strong>").text("Hit Dice"));

    for (const [die, pool] of entries) {
        const group = $("<span>").addClass("waybeyond20-hit-dice-pool");
        const spend = $("<button>")
            .attr({ type: "button", title: `Spend one ${die} Hit Die` })
            .text("−")
            .prop("disabled", pool.remaining <= 0)
            .on("click.waybeyond20-hit-dice", event => {
                event.preventDefault();
                event.stopPropagation();
                wayBeyond20AdjustHitDice(die, -1, "manual-minus");
            });
        const count = $("<span>").addClass("waybeyond20-hit-dice-count").text(`${pool.remaining}${die}`);
        const restore = $("<button>")
            .attr({ type: "button", title: `Restore one ${die} Hit Die` })
            .text("+")
            .prop("disabled", pool.remaining >= pool.max)
            .on("click.waybeyond20-hit-dice", event => {
                event.preventDefault();
                event.stopPropagation();
                wayBeyond20AdjustHitDice(die, 1, "manual-plus");
            });
        group.append(spend, count, restore);
        tracker.append(group);
    }

    tracker.append($("<button>")
        .attr({ type: "button", title: "Restore all Hit Dice" })
        .addClass("waybeyond20-hit-dice-reset")
        .text("Reset")
        .on("click.waybeyond20-hit-dice", event => {
            event.preventDefault();
            event.stopPropagation();
            wayBeyond20ResetHitDice("manual-reset");
        }));
}

let wayBeyond20LongRestResetPending = false;

function wayBeyond20InstallLongRestTracker() {
    // This listener is a WayBeyond20 addition. If Chrome reinjects the content
    // script into an existing D&D Beyond tab, replace our previous listener
    // instead of stacking another copy on the page.
    const previousListener = window.__wayBeyond20LongRestTrackerListener;
    if (typeof previousListener === "function") {
        window.removeEventListener("click", previousListener, true);
    }

    const listener = event => {
        const control = event.target && event.target.closest ? event.target.closest("button,[role='button']") : null;
        if (!control || wayBeyond20LongRestResetPending) return;
        const label = String(control.textContent || control.getAttribute("aria-label") || "")
            .replace(/\s+/g, " ").trim().toLowerCase();
        if (!label.includes("long rest") || /(cancel|close|back|dismiss)/.test(label)) return;

        const pane = $(control).closest("[role='dialog'],.ct-sidebar,.ddbc-sidebar,[class*='styles_modal'],[class*='styles_sidebar']");
        if (!pane.length) return;
        const paneText = String(pane.text() || "").replace(/\s+/g, " ").trim().toLowerCase();
        if (!paneText.includes("long rest")) return;

        wayBeyond20LongRestResetPending = true;
        wayBeyond20CharacterDebug("Long Rest completion detected", {
            control: wayBeyond20DescribeElement(control)
        });
        setTimeout(() => {
            if (character) character.updateInfo();
            wayBeyond20ResetHitDice("long-rest");
            wayBeyond20LongRestResetPending = false;
        }, 750);
    };

    window.__wayBeyond20LongRestTrackerListener = listener;
    window.addEventListener("click", listener, true);
}

function wayBeyond20FindHitPointsTrackerContainer(hitPointsHeader) {
    if (!hitPointsHeader || hitPointsHeader.length === 0) return $();
    const preferred = hitPointsHeader.closest(".ct-hit-points-box,.ddbc-hit-points-box,[class*='hit-points'],[class*='HitPoints']").first();
    if (preferred.length > 0) return preferred;

    let candidate = hitPointsHeader.parent();
    for (let i = 0; i < 6 && candidate.length > 0; i++) {
        const text = String(candidate.text() || "").replace(/\s+/g, " ").trim().toUpperCase();
        if (text.includes("CURRENT") && text.includes("MAX") && text.includes("TEMP")) return candidate;
        candidate = candidate.parent();
    }
    return hitPointsHeader.parent();
}

function wayBeyond20StartCombat(source = "D&D Beyond", reset = true) {
    if (!character) return;
    const activeEffects = wayBeyond20GetTrackedSpellEffects();
    const previous = wayBeyond20GetTurnTrackerState();
    let state = wayBeyond20NormalizeTurnTrackerState(previous, activeEffects, {
        reset: reset || !previous.inCombat
    });
    state.inCombat = true;
    state.combatSource = source;
    state.combatStartedAt = state.combatStartedAt || Date.now();
    if (reset || !previous.inCombat) {
        state.localTurnNumber = 1;
    }
    wayBeyond20SetTurnTrackerState(state, wayBeyond20ScheduleActiveEffectBadgeRefresh);
}

function wayBeyond20StartNewTurn() {
    if (!character) return;
    const activeEffects = wayBeyond20GetTrackedSpellEffects();
    const current = wayBeyond20GetTurnTrackerState();
    if (!wayBeyond20HasActiveCombatState(current)) return;
    const state = wayBeyond20NormalizeTurnTrackerState(current, activeEffects, { reset: true });
    state.inCombat = true;
    state.combatSource = current.combatSource || "D&D Beyond";
    state.combatStartedAt = current.combatStartedAt || Date.now();
    state.localTurnNumber = Math.max(1, parseInt(current.localTurnNumber || 1)) + 1;
    state.currentRoll20Turn = current.currentRoll20Turn || null;
    state.lastRoll20TurnKey = current.lastRoll20TurnKey || "";
    state.knownTargets = current.knownTargets || [];
    wayBeyond20SetTurnTrackerState(state, wayBeyond20ScheduleActiveEffectBadgeRefresh);
}

function wayBeyond20EndCombat() {
    if (!character) return;
    const activeEffects = wayBeyond20GetTrackedSpellEffects();
    const state = wayBeyond20NormalizeTurnTrackerState(wayBeyond20GetTurnTrackerState(), activeEffects);
    if (state.combatSource === "Roll20") {
        state.suppressedRoll20TurnKey =
            (state.currentRoll20Turn && state.currentRoll20Turn.turnKey) ||
            state.lastRoll20TurnKey || "";
    }
    state.inCombat = false;
    state.combatSource = "";
    state.combatStartedAt = null;
    state.localTurnNumber = 0;
    state.currentRoll20Turn = null;
    state.lastRoll20TurnKey = "";
    wayBeyond20SetTurnTrackerState(state, wayBeyond20ScheduleActiveEffectBadgeRefresh);
}

function wayBeyond20OpenCombatWindow() {
    if (!character) return;
    const current = wayBeyond20GetTurnTrackerState();
    if (wayBeyond20HasActiveCombatState(current)) {
        wayBeyond20InjectTurnResourceTracker();
        return;
    }
    wayBeyond20StartCombat("Manual Combat", true);
}

function wayBeyond20InjectCombatMenuAction() {
    const popup = $(".beyond20-hotkeys-list").first();
    if (!popup.length) return;
    const list = popup.find("ul").first();
    if (!list.length) return;

    let item = list.find(".waybeyond20-open-combat-menu").first();
    if (!item.length) {
        item = $("<li>")
            .addClass("waybeyond20-open-combat-menu")
            .attr("role", "button")
            .attr("tabindex", "0")
            .text("Combat Window")
            .on("click.waybeyond20-combat-menu keydown.waybeyond20-combat-menu", event => {
                if (event.type === "keydown" && event.key !== "Enter" && event.key !== " ") return;
                event.preventDefault();
                event.stopPropagation();
                wayBeyond20OpenCombatWindow();
            });
        list.prepend(item);
    }
}

function wayBeyond20FindCombatSectionHost() {
    const selectors = [
        ".ct-character-sheet__inner",
        ".ddbc-character-sheet__inner",
        ".ct-character-sheet",
        ".ddbc-character-sheet",
        "[class*='styles_characterSheet']",
        "main"
    ];
    for (const selector of selectors) {
        const candidate = $(selector).filter(":visible").first();
        if (candidate.length > 0) return candidate;
    }
    return $();
}

function wayBeyond20BuildCombatResource(label, resource, count, isMovement = false) {
    const amount = wayBeyond20ParseInteger(count) ?? 0;
    const chip = $("<button>")
        .attr("type", "button")
        .addClass("waybeyond20-combat-resource")
        .attr("data-waybeyond20-resource", resource)
        .text(isMovement ? `${label}: ${amount} ft.` : `${label}: ${amount}`);
    if (isMovement) {
        chip.addClass("waybeyond20-combat-resource-static").prop("disabled", true);
        return chip;
    }
    if (amount <= 0) chip.addClass("waybeyond20-turn-resource-spent");
    chip.on("click.waybeyond20-combat", event => {
        event.preventDefault();
        event.stopPropagation();
        wayBeyond20SpendTurnResource(resource);
    });
    return chip;
}

function wayBeyond20InjectTurnResourceTracker(effects) {
    // v1.43 replaces the tiny floating HP-box chips with a visible Combat section at
    // the bottom of the main sheet. Keep removing the legacy element during upgrades.
    $(".waybeyond20-turn-tracker").remove();
    $(".waybeyond20-turn-tracker-container").removeClass("waybeyond20-turn-tracker-container");

    if (!wayBeyond20IsMainCharacterSheet()) {
        $(".waybeyond20-combat-section").remove();
        return;
    }

    const activeEffects = Array.isArray(effects) ? effects : wayBeyond20GetTrackedSpellEffects();
    const state = wayBeyond20NormalizeTurnTrackerState(wayBeyond20GetTurnTrackerState(), activeEffects);
    if (!wayBeyond20HasActiveCombatState(state)) {
        $(".waybeyond20-combat-section").remove();
        if (state.inCombat) {
            state.inCombat = false;
            state.combatSource = "";
            state.combatStartedAt = null;
            state.localTurnNumber = 0;
            state.currentRoll20Turn = null;
            state.lastRoll20TurnKey = "";
            wayBeyond20SetTurnTrackerState(state);
        }
        return;
    }

    const host = wayBeyond20FindCombatSectionHost();
    if (host.length === 0) return;

    let section = $(".waybeyond20-combat-section").first();
    if (section.length === 0 || section.parent()[0] !== host[0]) {
        section.remove();
        section = $("<section>").addClass("waybeyond20-combat-section");
        host.append(section);
    }

    const signature = JSON.stringify({
        action: state.action,
        bonusAction: state.bonusAction,
        reaction: state.reaction,
        hasteAction: state.hasteAction,
        movement: state.movement,
        maxHasteAction: state.maxHasteAction,
        combatSource: state.combatSource,
        localTurnNumber: state.localTurnNumber,
        currentRoll20Turn: state.currentRoll20Turn
    });
    if (section.attr("data-waybeyond20-signature") === signature) return;
    section.attr("data-waybeyond20-signature", signature).empty();

    const header = $("<div>").addClass("waybeyond20-combat-header");
    const title = $("<div>").addClass("waybeyond20-combat-title").text("Combat");
    const sourceParts = [];
    if (state.combatSource) sourceParts.push(state.combatSource);
    if (state.localTurnNumber) sourceParts.push(`Turn ${state.localTurnNumber}`);
    if (state.currentRoll20Turn && state.currentRoll20Turn.tokenName) {
        sourceParts.push(`Current: ${state.currentRoll20Turn.tokenName}`);
    }
    const source = $("<div>").addClass("waybeyond20-combat-source").text(sourceParts.join(" · "));
    header.append(title, source);

    const resources = $("<div>").addClass("waybeyond20-combat-resources");
    resources.append(wayBeyond20BuildCombatResource("Movement", "movement", state.movement, true));
    resources.append(wayBeyond20BuildCombatResource("Action", "action", state.action));
    resources.append(wayBeyond20BuildCombatResource("Bonus Action", "bonusAction", state.bonusAction));
    resources.append(wayBeyond20BuildCombatResource("Reaction", "reaction", state.reaction));
    if ((wayBeyond20ParseInteger(state.maxHasteAction) ?? 0) > 0) {
        resources.append(wayBeyond20BuildCombatResource("Haste Action", "hasteAction", state.hasteAction));
    }

    const controls = $("<div>").addClass("waybeyond20-combat-controls");
    const newTurn = $("<button>")
        .attr("type", "button")
        .addClass("waybeyond20-combat-control")
        .text("New Turn")
        .on("click.waybeyond20-combat", event => {
            event.preventDefault();
            event.stopPropagation();
            wayBeyond20StartNewTurn();
        });
    const endCombat = $("<button>")
        .attr("type", "button")
        .addClass("waybeyond20-combat-control waybeyond20-combat-end")
        .text("End Combat")
        .on("click.waybeyond20-combat", event => {
            event.preventDefault();
            event.stopPropagation();
            wayBeyond20EndCombat();
        });
    controls.append(newTurn, endCombat);

    section.append(header, resources, controls);
}

function wayBeyond20IsVisibleElement(element) {
    if (!element) return false;
    return !!(element.offsetWidth || element.offsetHeight || element.getClientRects().length);
}

function wayBeyond20ElementOwnText(element) {
    if (!element) return "";
    return Array.from(element.childNodes)
        .filter(node => node.nodeType === Node.TEXT_NODE)
        .map(node => node.textContent)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
}

function wayBeyond20IsInsideTransientPanel(element) {
    if (!element || !element.closest) return false;

    // D&D Beyond often renders detail popups/popovers using generic overlay containers. BUFFS and
    // CONCENTRATION are intended to live on the main character sheet summary widgets, not inside
    // the opened DEFENSES/CONDITIONS detail popup. Keep this intentionally broad but avoid
    // excluding normal sheet sidebars because the compact summary widgets may live in a sidebar.
    const transientSelector = [
        "[role='dialog']",
        "[aria-modal='true']",
        "[data-tippy-root]",
        ".ddbc-modal",
        ".ddbc-popover",
        ".ddbc-tooltip",
        ".ct-popover",
        "[class*='modal']",
        "[class*='popover']",
        "[class*='tooltip']",
        "[class*='flyout']",
        "[class*='overlay']"
    ].join(",");

    return !!element.closest(transientSelector);
}

function wayBeyond20FindVisibleTextElement(label, options = {}) {
    const normalized = String(label || "").trim().toUpperCase();
    if (!normalized) return $();

    // Keep this bounded because it can be called after D&D Beyond sheet mutations. Use own text
    // when available so our injected BUFFS/CONCENTRATION badges do not make the DEFENSES or
    // CONDITIONS labels stop matching on the next refresh.
    const selectors = [
        "h1", "h2", "h3", "h4", "h5", "h6",
        "span", "div", "button",
        "[class*='heading']", "[class*='title']", "[class*='label']"
    ].join(",");
    const candidates = Array.from(document.querySelectorAll(selectors));
    const matches = [];

    for (const element of candidates) {
        if (!wayBeyond20IsVisibleElement(element)) continue;
        if (options.avoidTransientPanels && wayBeyond20IsInsideTransientPanel(element)) continue;

        const ownText = wayBeyond20ElementOwnText(element);
        const fullText = String(element.textContent || "").replace(/\s+/g, " ").trim();
        const textToCheck = ownText || fullText;
        if (!textToCheck || textToCheck.length > 40) continue;
        if (textToCheck.toUpperCase() !== normalized) continue;

        matches.push(element);
    }

    if (matches.length === 0) return $();

    matches.sort((a, b) => {
        const aRect = a.getBoundingClientRect ? a.getBoundingClientRect() : { width: 0, height: 0, top: 0, left: 0 };
        const bRect = b.getBoundingClientRect ? b.getBoundingClientRect() : { width: 0, height: 0, top: 0, left: 0 };
        const aArea = Math.max(1, aRect.width || 0) * Math.max(1, aRect.height || 0);
        const bArea = Math.max(1, bRect.width || 0) * Math.max(1, bRect.height || 0);
        if (options.preferCompact && aArea !== bArea) return aArea - bArea;
        if ((aRect.top || 0) !== (bRect.top || 0)) return (aRect.top || 0) - (bRect.top || 0);
        return (aRect.left || 0) - (bRect.left || 0);
    });

    return $(matches[0]);
}

function wayBeyond20EffectKey(effect) {
    if (!effect) return "";
    if (effect.id) return String(effect.id);
    return [effect.name || "", effect.owner || "", effect.source || "", effect.startedAt || "", effect.duration || "", effect.castAt || ""].join("||");
}

function wayBeyond20IsSelfOwner(effect) {
    const owner = String(effect && effect.owner ? effect.owner : "").trim().toLowerCase();
    const selfName = wayBeyond20CurrentCharacterName(character).toLowerCase();
    return owner && selfName && owner === selfName;
}

function wayBeyond20FormatEffectEndMessage(effect) {
    if (!effect || !effect.name) return "Effect ended.";
    if (wayBeyond20IsSelfOwner(effect)) return `Your ${effect.name} ended.`;
    const owner = String(effect.owner || "").trim();
    if (owner) return `${effect.name} from ${owner} ended.`;
    return `${effect.name} ended.`;
}

function wayBeyond20NotifyEffectEnded(effect) {
    const message = wayBeyond20FormatEffectEndMessage(effect);
    if (typeof alertify !== "undefined" && alertify && alertify.message) {
        alertify.message(message);
    } else {
        console.log("WayBeyond20:", message);
    }
}

function wayBeyond20EffectSummary(effect) {
    if (!effect || !effect.name) return "";
    const details = [];
    if (effect.duration) details.push(effect.duration);
    if (effect.effectLevel !== undefined && effect.effectLevel !== null && effect.effectLevel !== "") details.push("level " + effect.effectLevel);
    if (effect.castAt) details.push("cast at " + effect.castAt);
    if (effect.checkTotal !== undefined && effect.checkTotal !== null && effect.checkTotal !== "") details.push("check " + effect.checkTotal);
    if (effect.hideDc !== undefined && effect.hideDc !== null && effect.hideDc !== "") details.push("DC " + effect.hideDc);
    if (Array.isArray(effect.conditions) && effect.conditions.length > 0) details.push(effect.conditions.join(", "));

    const name = wayBeyond20EffectName(effect);
    const dataEntries = wayBeyond20EffectDataEntries(effect);
    if (dataEntries.length > 0) {
        for (const entry of dataEntries) {
            const field = String(entry.field || "").trim().toUpperCase();
            if (field === "BASE_ARMOR") {
                details.push(`base AC: ${entry.value}${entry.string ? " + " + entry.string : ""}`);
            } else if (field === "AC_BONUS") {
                details.push(`${wayBeyond20FormatSigned(entry.value)} AC`);
            } else if (field === "SPEED_MULTIPLIER") {
                details.push(`speed ×${entry.value}`);
            } else if (field === "SAVE_ADVANTAGE") {
                details.push(`${entry.string || ""} saves adv.`.trim());
            } else if (field === "ACTION_GRANT" && String(entry.string || "").toUpperCase() === "HASTE_ACTION") {
                details.push("haste action");
            }
        }
    } else {
        if (name === "mage armor") details.push("base AC: 13 + DEX");
        if (name === "haste") details.push("+2 AC; speed ×2; DEX saves adv.; limited extra action");
    }

    const owner = String(effect.owner || "").trim();
    if (owner && !wayBeyond20IsSelfOwner(effect)) details.push("from " + owner);

    return effect.name + (details.length > 0 ? " — " + details.join("; ") : "");
}

function wayBeyond20CloseEffectsPopout() {
    $(".waybeyond20-effects-popout").remove();
    $(document).off("mousedown.waybeyond20-effects-popout");
}

function wayBeyond20RemoveTrackedEffect(effectKey) {
    if (!character || !effectKey) return;
    const existing = character.getSetting("waybeyond20-active-effects", []);
    const removedEffect = Array.isArray(existing) ? existing.find(effect => wayBeyond20EffectKey(effect) === effectKey) : null;
    const activeEffects = Array.isArray(existing) ? existing.filter(effect => wayBeyond20EffectKey(effect) !== effectKey) : [];
    const concentration = character.getSetting("waybeyond20-concentration", null);
    const settings_to_change = {
        "waybeyond20-active-effects": activeEffects
    };
    let concentrationForDisplay = concentration;
    if (concentration && wayBeyond20EffectKey(concentration) === effectKey) {
        settings_to_change["waybeyond20-concentration"] = null;
        concentrationForDisplay = null;
    }
    character.mergeCharacterSettings(settings_to_change, () => {
        wayBeyond20CloseEffectsPopout();
        wayBeyond20SendEffectsUpdate(character, activeEffects, concentrationForDisplay);
        if (removedEffect) wayBeyond20NotifyEffectEnded(removedEffect);
    });
}

function wayBeyond20OpenEffectsPopout(anchor, title, effects) {
    wayBeyond20CloseEffectsPopout();
    const safeEffects = Array.isArray(effects) ? effects.filter(effect => effect && effect.name) : [];
    const panel = $("<div>").addClass("waybeyond20-effects-popout");
    const header = $("<div>").addClass("waybeyond20-effects-popout-header");
    header.append($("<span>").text(title));
    header.append($("<button type='button'>").addClass("waybeyond20-effects-popout-close").text("×").on("click", event => {
        event.preventDefault();
        event.stopPropagation();
        wayBeyond20CloseEffectsPopout();
    }));
    panel.append(header);

    if (safeEffects.length === 0) {
        panel.append($("<div>").addClass("waybeyond20-effects-popout-empty").text("No active effects."));
    } else {
        for (const effect of safeEffects) {
            const row = $("<div>").addClass("waybeyond20-effects-popout-row");
            const text = $("<div>").addClass("waybeyond20-effects-popout-text").text(wayBeyond20EffectSummary(effect));
            const endButton = $("<button type='button'>").addClass("waybeyond20-effects-popout-end").text("End").on("click", event => {
                event.preventDefault();
                event.stopPropagation();
                wayBeyond20RemoveTrackedEffect(wayBeyond20EffectKey(effect));
            });
            row.append(text).append(endButton);
            panel.append(row);
        }
    }

    $(document.body).append(panel);
    const offset = anchor && anchor.offset ? anchor.offset() : null;
    if (offset) {
        panel.css({
            top: offset.top + anchor.outerHeight() + 4,
            left: offset.left
        });
    }

    setTimeout(() => {
        $(document).on("mousedown.waybeyond20-effects-popout", event => {
            const target = $(event.target);
            if (target.closest(".waybeyond20-effects-popout,.waybeyond20-effect-badge").length === 0) {
                wayBeyond20CloseEffectsPopout();
            }
        });
    }, 0);
}

function wayBeyond20SetBadgeContent(badge, text) {
    if (!badge || badge.length === 0) return;
    if (badge.text() !== text) badge.text(text);
    badge.removeAttr("title");
}

function wayBeyond20UpsertEffectBadge(anchor, className, text, panelTitle, getEffects) {
    if (!anchor || anchor.length === 0) return;
    anchor.addClass("waybeyond20-effect-header-split");

    let separator = anchor.find("> .waybeyond20-effect-header-separator").first();
    if (separator.length === 0) {
        separator = $("<span>").addClass("waybeyond20-effect-header-separator").text("|");
        anchor.append(separator);
    }

    let badge = anchor.find("> ." + className).first();
    if (badge.length === 0) {
        badge = $("<span>").addClass(className).addClass("waybeyond20-effect-badge");
        anchor.append(badge);
    }
    wayBeyond20SetBadgeContent(badge, text);
    badge.off("click.waybeyond20-effects").on("click.waybeyond20-effects", event => {
        event.preventDefault();
        event.stopPropagation();
        wayBeyond20OpenEffectsPopout(badge, panelTitle || text, getEffects ? getEffects() : []);
    });
}

function wayBeyond20InjectBuffsBadge(effects) {
    const existing = $(".waybeyond20-buffs-badge");
    if (!Array.isArray(effects) || effects.length === 0) {
        const anchors = existing.parent();
        existing.remove();
        anchors.each(function() {
            if ($(this).find("> .waybeyond20-effect-badge").length === 0) {
                $(this).removeClass("waybeyond20-effect-header-split");
                $(this).find("> .waybeyond20-effect-header-separator").remove();
            }
        });
        return;
    }
    const defenseHeader = wayBeyond20FindVisibleTextElement("DEFENSES", { avoidTransientPanels: true, preferCompact: true });
    if (defenseHeader.length === 0) return;
    const names = Array.from(new Set(effects.map(effect => String(effect.name || "").trim()).filter(Boolean)));
    const label = names.length === 1 ? `BUFFS: ${names[0]}` : `BUFFS (${effects.length})`;
    wayBeyond20UpsertEffectBadge(defenseHeader, "waybeyond20-buffs-badge", label, "Active Buffs", () => wayBeyond20GetTrackedSpellEffects());
}

function wayBeyond20InjectConcentrationBadge(concentration) {
    if (!concentration || !concentration.name) {
        const existing = $(".waybeyond20-concentration-badge,.waybeyond20-spell-tab-concentration-badge");
        const anchors = existing.parent();
        existing.remove();
        anchors.each(function() {
            if ($(this).find("> .waybeyond20-effect-badge").length === 0) {
                $(this).removeClass("waybeyond20-effect-header-split");
                $(this).find("> .waybeyond20-effect-header-separator").remove();
            }
        });
        return;
    }

    const conditionHeader = wayBeyond20FindVisibleTextElement("CONDITIONS", { avoidTransientPanels: true, preferCompact: true });
    if (conditionHeader.length > 0) {
        wayBeyond20UpsertEffectBadge(conditionHeader, "waybeyond20-concentration-badge", "CONCENTRATION", "Concentration", () => {
            const current = wayBeyond20GetConcentrationEffect();
            return current ? [current] : [];
        });
    }

    const spellLevelAnchor = $("button,span,div").filter(function() {
        if (!wayBeyond20IsVisibleElement(this)) return false;
        return wayBeyond20ElementOwnText(this).toUpperCase() === "ALL" || String(this.textContent || "").replace(/\s+/g, " ").trim().toUpperCase() === "ALL";
    }).filter(function() {
        const rowText = String(this.parentElement ? this.parentElement.textContent : "").replace(/\s+/g, " ").trim().toUpperCase();
        return rowText.includes("1ST") || rowText.includes("2ND") || rowText.includes("3RD") || rowText.includes("0");
    }).first();

    if (spellLevelAnchor.length > 0) {
        const row = spellLevelAnchor.parent();
        let badge = row.find("> .waybeyond20-spell-tab-concentration-badge").first();
        if (badge.length === 0) {
            badge = $("<span>").addClass("waybeyond20-spell-tab-concentration-badge").addClass("waybeyond20-effect-badge");
            row.append(badge);
        }
        wayBeyond20SetBadgeContent(badge, "CONCENTRATION");
        badge.off("click.waybeyond20-effects").on("click.waybeyond20-effects", event => {
            event.preventDefault();
            event.stopPropagation();
            const current = wayBeyond20GetConcentrationEffect();
            wayBeyond20OpenEffectsPopout(badge, "Concentration", current ? [current] : []);
        });
    }
}

let waybeyond20_effect_badge_refresh_timer = 0;

function wayBeyond20RefreshActiveEffectBadges() {
    waybeyond20_effect_badge_refresh_timer = 0;
    const effects = wayBeyond20GetTrackedSpellEffects();
    const concentration = wayBeyond20GetConcentrationEffect();
    wayBeyond20ApplyActiveEffectMechanics(effects);
    wayBeyond20InjectBuffsBadge(effects);
    wayBeyond20InjectConcentrationBadge(concentration);
    wayBeyond20InjectTurnResourceTracker(effects);
    wayBeyond20InjectHitDiceTracker();
}

function wayBeyond20ScheduleActiveEffectBadgeRefresh() {
    if (waybeyond20_effect_badge_refresh_timer) return;
    waybeyond20_effect_badge_refresh_timer = setTimeout(wayBeyond20RefreshActiveEffectBadges, 300);
}

function wayBeyond20SendEffectsUpdate(character, activeEffects, concentration) {
    // Keep effect tracking local to D&D Beyond for now. Chat announcements were too noisy.
    // Use the newly calculated effect list immediately instead of waiting for character settings
    // to rehydrate. This makes manual test effects and just-cast effects show on the sheet at once.
    const effectsForDisplay = Array.isArray(activeEffects) ? activeEffects.filter(effect => effect && effect.name) : wayBeyond20GetTrackedSpellEffects();
    let concentrationForDisplay = concentration || wayBeyond20GetConcentrationEffect();
    if (concentrationForDisplay && concentrationForDisplay.name && !effectsForDisplay.some(effect => effect && effect.name === concentrationForDisplay.name && effect.source === concentrationForDisplay.source)) {
        effectsForDisplay.push(concentrationForDisplay);
    }
    wayBeyond20ApplyActiveEffectMechanics(effectsForDisplay);
    wayBeyond20InjectBuffsBadge(effectsForDisplay);
    wayBeyond20InjectConcentrationBadge(concentrationForDisplay);
    wayBeyond20InjectTurnResourceTracker(effectsForDisplay);
    wayBeyond20InjectHitDiceTracker();
    wayBeyond20ScheduleActiveEffectBadgeRefresh();
}

function wayBeyond20ParseTestEffectDetail(rawDetail) {
    if (!rawDetail) return {};
    if (typeof rawDetail === "string") {
        try {
            return JSON.parse(rawDetail);
        } catch (error) {
            console.warn("WayBeyond20 could not parse test effect detail", rawDetail, error);
            return {};
        }
    }
    if (typeof rawDetail === "object") return rawDetail;
    return {};
}

function wayBeyond20AddManualTestEffect(rawDetail) {
    if (!character) return;
    const detail = wayBeyond20ParseTestEffectDetail(rawDetail);
    const settings_to_change = {};
    const effect = {
        id: detail.id || wayBeyond20GenerateEffectId(),
        name: detail.name || "WayBeyond20 Test Buff",
        owner: detail.owner || wayBeyond20CurrentCharacterName(character),
        source: detail.source || "WayBeyond20 Manual Test",
        effectLevel: detail.effectLevel !== undefined ? detail.effectLevel : (detail.level !== undefined ? detail.level : "Test"),
        ownerLevel: detail.ownerLevel !== undefined ? detail.ownerLevel : wayBeyond20OwnerLevel(character),
        ticksLeft: detail.ticksLeft !== undefined ? detail.ticksLeft : "",
        updateMode: detail.updateMode || "manual",
        flags: wayBeyond20NormalizeEffectFlags(detail.flags || ["buff"]),
        data: wayBeyond20NormalizeEffectData(detail.data || []),
        level: detail.level || "Test",
        castAt: detail.castAt || detail.cast_at || "",
        concentration: !!detail.concentration,
        duration: detail.duration || "10 minutes",
        startedAt: detail.startedAt || new Date().toISOString(),
        characterId: character && character._id ? character._id : ""
    };
    if (effect.concentration && !effect.flags.includes("concentration")) effect.flags.push("concentration");
    if (detail.range) effect.range = detail.range;
    if (detail.castingTime || detail.casting_time) effect.castingTime = detail.castingTime || detail.casting_time;

    const update = wayBeyond20AddSpellEffectToSettings(character, settings_to_change, effect);
    character.mergeCharacterSettings(settings_to_change, () => {
        wayBeyond20SendEffectsUpdate(character, update.activeEffects, update.concentration);
        console.log("WayBeyond20 added manual test effect", effect);
    });
}

function wayBeyond20AddExternalEffect(rawDetail) {
    if (!character) return;
    const detail = wayBeyond20ParseTestEffectDetail(rawDetail);
    if (!detail || !detail.name) return;

    const settings_to_change = {};
    const effect = {
        id: detail.id || wayBeyond20GenerateEffectId(),
        name: detail.name,
        owner: detail.owner || "",
        source: detail.source || "WayBeyond20",
        effectLevel: detail.effectLevel !== undefined ? detail.effectLevel : (detail.level !== undefined ? detail.level : ""),
        ownerLevel: detail.ownerLevel !== undefined ? detail.ownerLevel : "",
        ticksLeft: detail.ticksLeft !== undefined ? detail.ticksLeft : "",
        updateMode: detail.updateMode || "manual",
        flags: wayBeyond20NormalizeEffectFlags(detail.flags || []),
        data: wayBeyond20NormalizeEffectData(detail.data || []),
        level: detail.level || "",
        castAt: detail.castAt || detail.cast_at || "",
        concentration: !!detail.concentration,
        duration: detail.duration || "",
        startedAt: detail.startedAt || new Date().toISOString(),
        characterId: character && character._id ? character._id : ""
    };
    if (effect.concentration && !effect.flags.includes("concentration")) effect.flags.push("concentration");

    if (detail.range) effect.range = detail.range;
    if (detail.castingTime || detail.casting_time) effect.castingTime = detail.castingTime || detail.casting_time;
    if (detail.checkTotal !== undefined) effect.checkTotal = detail.checkTotal;
    if (detail.hideDc !== undefined) effect.hideDc = detail.hideDc;
    if (detail.dc !== undefined && effect.hideDc === undefined) effect.hideDc = detail.dc;
    if (Array.isArray(detail.conditions)) effect.conditions = detail.conditions;
    if (detail.notes) effect.notes = detail.notes;

    const update = wayBeyond20AddSpellEffectToSettings(character, settings_to_change, effect);
    character.mergeCharacterSettings(settings_to_change, () => {
        wayBeyond20SendEffectsUpdate(character, update.activeEffects, update.concentration);
        console.log("WayBeyond20 added external effect", effect);
    });
}

function wayBeyond20ClearManualTestEffects() {
    if (!character) return;
    const existing = character.getSetting("waybeyond20-active-effects", []);
    const activeEffects = Array.isArray(existing) ? existing.filter(effect => effect && effect.source !== "WayBeyond20 Manual Test") : [];
    const concentration = character.getSetting("waybeyond20-concentration", null);
    const settings_to_change = {
        "waybeyond20-active-effects": activeEffects
    };
    if (concentration && concentration.source === "WayBeyond20 Manual Test") {
        settings_to_change["waybeyond20-concentration"] = null;
    }
    character.mergeCharacterSettings(settings_to_change, () => {
        wayBeyond20SendEffectsUpdate(character, activeEffects, settings_to_change["waybeyond20-concentration"] === null ? null : concentration);
        console.log("WayBeyond20 cleared manual test effects");
    });
}

function wayBeyond20RegisterManualTestEffectEvents() {
    document.addEventListener("WayBeyond20TestEffect", event => {
        wayBeyond20AddManualTestEffect(event.detail);
    });
    document.addEventListener("WayBeyond20ClearTestEffects", () => {
        wayBeyond20ClearManualTestEffects();
    });
}

wayBeyond20RegisterManualTestEffectEvents();

function wayBeyond20ApplySavageAttacker(character, roll_properties, action_pool, settings_to_change) {
    if (!roll_properties || !Array.isArray(action_pool) || action_pool.length === 0) return;
    if (!character.hasFeat("Savage Attacker") && !character.hasFeat("Savage Attacker 2024")) return;
    if (!character.getSetting("savage-attacker", true)) return;
    if (!Array.isArray(roll_properties["damages"]) || !Array.isArray(roll_properties["damage-types"])) return;

    const selected = action_pool.filter(row => {
        const tags = row.tags || [];
        return row.dice && (
            tags.includes("base-weapon") ||
            tags.includes("weapon-effect") ||
            tags.includes("savage-attacker")
        );
    });

    if (selected.length === 0) return;

    const selectedIndices = [...new Set(selected
        .map(wayBeyond20DamageRowIndex)
        .filter(idx => idx >= 0 && idx < roll_properties["damages"].length))]
        .sort((a, b) => a - b);
    if (selectedIndices.length === 0) return;

    // Do not render Savage Attacker directly here.  This D&D Beyond layer is
    // system-neutral; Roll20, Foundry, and generic renderers each get the same
    // intent metadata and can render the dice syntax they support.
    roll_properties["waybeyond20-savage-attacker"] = {
        mode: "double-dice-drop-lowest",
        selected: selected.map(row => row.id),
        selectedDamageIndexes: selectedIndices,
        originalDamages: selectedIndices.map(idx => ({
            index: idx,
            formula: roll_properties["damages"][idx],
            type: roll_properties["damage-types"][idx] || ""
        }))
    };

    const isLocked = character.getSetting("savage-attacker-lock", false);
    if (!isLocked) settings_to_change["savage-attacker"] = false;
}

function isItemATool(item_name, source) {
    return source === "tool, common" ||
        item_name.includes(" Tools") || item_name.includes(" Tool") ||
        item_name.includes(" Kit") ||
        item_name.includes(" Supplies") || 
        item_name.includes(" Set") || 
        item_name === "Wagon" ||
        item_name.includes(" Utensils");
}
function isItemAnInstruction(item_name, item_tags) {
    // Rhythm-Maker’s Drum, +1, +2, +3 don't have the tag
    return item_tags.includes("Instrument") || item_name.includes(" Drum");
}

function handleSpecialMeleeAttacks(damages=[], damage_types=[], properties, settings_to_change={}, { to_hit, action_name="", effects=[] }={}) {
    if (character.hasClass("Barbarian")) {
        // Barbarian: Rage
        const barbarian_level = character.getClassLevel("Barbarian");
        const rage_damage = barbarian_level < 9 ? 2 : (barbarian_level < 16 ? 3 : 4);
        if (character.hasClassFeature("Rage") &&
            character.getSetting("barbarian-rage", false)) {
            damages.push(String(rage_damage));
            damage_types.push("Rage");
            effects.push("Rage");
        }
        if (character.getSetting("barbarian-reckless", false)) {
            effects.push("Reckless Attack");
            const isLocked = character.getSetting("barbarian-reckless-lock", false);
            if(!isLocked) settings_to_change["barbarian-reckless"] = false;
            if (character.hasClassFeature("Rage") && character.getSetting("barbarian-rage", false) && 
                character.hasClassFeature("Frenzy 2024")) {
                damages.push(`${rage_damage}d6`);
                damage_types.push("Frenzy");
                effects.push("Frenzy");
            }
        }
    }

    if (character.hasClass("Druid")) {
        // Druid: Circle of Spores: Symbiotic Entity
        if (character.hasClassFeature("Symbiotic Entity") &&
            character.getSetting("druid-symbiotic-entity", false)) {
                damages.push("1d6");
                damage_types.push("Symbiotic Entity");
        }
    }
    
    if (character.hasClass("Paladin")) {
        // Paladin: Improved Divine Smite
        // Radiant Strikes works on melee and unarmed strikes, while Improved Divine Smite
        // only works on melee weapon attacks, so check for action_name which would indicate a non weapon attack
        if ((character.hasClassFeature("Improved Divine Smite") &&
            character.getSetting("paladin-improved-divine-smite", true) && !action_name) ||
            (character.hasClassFeature("Radiant Strikes") &&
            character.getSetting("paladin-radiant-strikes", true))) {
            damages.push("1d8");
            damage_types.push("Radiant");
        }
    }

    if (character.hasClass("Wizard")) {
        // Wizard: Bladesinging: Song of Victory
        if (character.hasClassFeature("Song of Victory") &&
            character.getSetting("wizard-bladesong", false)) {
            const intelligence = character.getAbility("INT") || {mod: 0};
            const mod = parseInt(intelligence.mod) || 0;
            damages.push(String(Math.max(mod, 1)));
            damage_types.push("Bladesong");
        }
    }

    // Feats
    // Great Weapon Master Feat
    if (to_hit !== null && 
        character.getSetting("great-weapon-master", false) &&
        character.hasFeat("Great Weapon Master") && 
        (this.IsHeavy(properties) || this.IsPoleArmMasterAttack(properties, action_name)))
         {
        to_hit += " - 5";
        damages.push("10");
        damage_types.push("Great Weapon Master");
        const isLocked = character.getSetting("great-weapon-master-lock", false);
        if(!isLocked) settings_to_change["great-weapon-master"] = false;
    }

    if (to_hit !== null && 
        character.getSetting("great-weapon-master-2024", true) &&
        character.hasFeat("Great Weapon Master 2024") &&
        this.IsHeavy(properties) &&
        !this.IsPoleArmMasterAttack(properties, action_name)) {
        const proficiency = parseInt(character._proficiency);
        damages.push(proficiency.toString());
        damage_types.push("Great Weapon Master");
        const isLocked = character.getSetting("great-weapon-master-2024-lock", false);
        if(!isLocked) settings_to_change["great-weapon-master-2024"] = false;
    }
    
    // enhanced unarmed strike
    if(to_hit !== null && 
        character.hasFeat("Tavern Brawler 2024") &&
        includesNormalized(["enhanced unarmed strike", "unarmed strike", "flurry of blows"], action_name)
    ) {
        damages[0] = damages[0].replace(/[0-9]*d[0-9]+/g, "$&ro<=1");
        effects.push("Tavern Brawler");
    }

    // Charger Feat
    if (character.hasFeat("Charger") &&
        character.getSetting("charger-feat")) {
        damages.push("+5");
        damage_types.push("Charger Feat");

        const isLocked = character.getSetting("charger-feat-lock", false);
        if(!isLocked) settings_to_change["charger-feat"] = false;
    } else if (character.hasFeat("Charger 2024") &&
        character.getSetting("charger-feat")) {
            let charge_dmg = "1d8";
            // apply GWF if needed
            if(((properties["Attack Type"] == "Melee" && ((properties["Properties"].includes("Versatile") && character.getSetting("versatile-choice") != "one") || 
                properties["Properties"].includes("Two-Handed"))) ||
                action_name == "Polearm Master - Bonus Attack" ||
                action_name == "Pole Strike")) {
                if(character.hasGreatWeaponFighting(2014)) {
                    charge_dmg += "ro<=2";
                } else if(character.hasGreatWeaponFighting(2024)) {
                    charge_dmg += "min3";
                }
            }

            damages.push(charge_dmg);
            damage_types.push("Charger Feat");

            const isLocked = character.getSetting("charger-feat-lock", false);
            if(!isLocked) settings_to_change["charger-feat"] = false;            
    }
    
    return to_hit;
}

function IsPoleArmMasterAttack(properties, action_name) {
    return (properties["Proficient"] == "Yes" && (action_name.includes("Polearm Master") || action_name.includes("Pole Strike")));
}

function IsHeavy(properties) {
    return ((properties["Properties"] && properties["Properties"].includes("Heavy")) && properties["Proficient"] == "Yes");
}

function handleSpecialRangedAttacks(damages=[], damage_types=[], properties, settings_to_change={}, { to_hit, action_name="", effects=[] }={}) {
    // Feats
    // Sharpshooter Feat
    if (to_hit !== null && 
        character.getSetting("sharpshooter", false) &&
        character.hasFeat("Sharpshooter") &&
        properties["Proficient"] == "Yes") {
        to_hit += " - 5";
        damages.push("10");
        damage_types.push("Sharpshooter");
        const isLocked = character.getSetting("sharpshooter-lock", false);
        if(!isLocked) settings_to_change["sharpshooter"] = false;
    }

    // Feats
    // Great Weapon Master Feat 2024 It applies to longbow and heavy crossbow and any other ranged weapon with heavy property
    if (to_hit !== null && 
        character.getSetting("great-weapon-master-2024", true) &&
        character.hasFeat("Great Weapon Master 2024") &&
        this.IsHeavy(properties)) {
        const proficiency = parseInt(character._proficiency);
        damages.push(proficiency.toString());
        damage_types.push("Great Weapon Master");
        const isLocked = character.getSetting("great-weapon-master-2024-lock", false);
        if(!isLocked) settings_to_change["great-weapon-master-2024"] = false;
    }
    
    return to_hit;
}

function handleSpecialGeneralAttacks(damages=[], damage_types=[], properties, settings_to_change={}, {to_hit, action_name, item_name, spell_name, spell_level}={}) {
    // Racial Traits
    //Protector Aasimar: Radiant Soul Damage
    if (character.hasRacialTrait("Radiant Soul") &&
        character.getSetting("protector-aasimar-radiant-soul", false)) {
        damages.push(character._level);
        damage_types.push("Radiant Soul");
    }

    // MotM Aasimar: Radiant Soul Damage
    if (character.hasRacialTrait("Celestial Revelation: Radiant Soul") &&
        character.getSetting("motm-aasimar-radiant-soul", false)) {
        damages.push(character._proficiency);
        damage_types.push("Radiant Soul");
    }
    
    // MotM Bugbear: Surprise Attack
    if (character.hasRacialTrait("Surprise Attack") &&
        character.getSetting("motm-bugbear-surprise-attack", false)) {
        damages.push("2d6");
        damage_types.push("Surprise Attack");
        const isLocked = character.getSetting("motm-bugbear-surprise-attack-lock", false);
        if(!isLocked) settings_to_change["motm-bugbear-surprise-attack"] = false;
    }

    // Class Specific
    if (character.hasClass("Fighter")) {
        if(character.hasClassFeature("Psionic Power") && action_name) {
            // HACK ALERT: fixes dndbeyond missing mods but incase they are added in the future we ensure the mod is applied if not present if it is present it is not applied
            const intelligence = character.getAbility("INT") || {mod: 0};
            const mod = parseInt(intelligence.mod) || 0;
            const psychic_action = action_name.toLocaleLowerCase();
            if(["psionic power: psionic strike", "psionic power: protective field"].includes(psychic_action)) {
                // Use full modifier, even if deeply negative
                damages[0] = ensureModifier(damages[0], mod);

                if(mod < 0 && ["psionic power: protective field"].includes(psychic_action)) {
                    // Set the min value to 1 + (negative mod) ensures that the results are never negative
                    const minValue = 1 + Math.abs(mod);
                    damages[0] = damages[0].replace(/[0-9]*d[0-9]+/g, match => `${match}min${minValue}`);
                }
            }
        } 
    }

    if (character.hasClass("Cleric")) {
        // Cleric: Blessed Strikes 2024
        const action = item_name || action_name;
        if ((action && to_hit != null) && !["Unarmed Strike"].includes(action) &&
            character.hasClassFeature("Blessed Strikes 2024") &&
            character.hasClassFeature("Blessed Strikes 2024: Divine Strike") &&
            character.getSetting("cleric-blessed-strikes", false)) {
            if(character.hasClassFeature("Improved Blessed Strikes 2024")) damages.push("2d8");
            else damages.push("1d8");
            damage_types.push("Blessed Strikes");

            const isLocked = character.getSetting("cleric-blessed-strikes-lock", false);
            if(!isLocked) settings_to_change["cleric-blessed-strikes"] = false;
        }

        // Cleric: Blessed Strikes 2014 tasha optional rule
        if (((action && to_hit != null) || (spell_name && spell_level.includes("Cantrip"))) &&
            character.hasClassFeature("Blessed Strikes") &&
            character.getSetting("cleric-blessed-strikes-tasha", false)) {
            if(character.hasClassFeature("Improved Blessed Strikes")) damages.push("2d8");
            else damages.push("1d8");
            damage_types.push("Blessed Strikes");

            const isLocked = character.getSetting("cleric-blessed-strikes-tasha-lock", false);
            if(!isLocked) settings_to_change["cleric-blessed-strikes-tasha"] = false;
        }
    }

    if (character.hasClass("Ranger")) {
        // Ranger: Favored Foe
        if (to_hit != null &&
            character.hasClassFeature("Favored Foe") &&
            character.getSetting("ranger-favored-foe", false)) {
            const ranger_level = character.getClassLevel("Ranger");
            damages.push(ranger_level < 6 ? "1d4" : ( ranger_level < 14 ? "1d6" : "1d8"));
            damage_types.push("Favored Foe");
        }
        
        // Ranger: Gathered Swarm
        if (to_hit != null &&
            character.hasClassFeature("Gathered Swarm") &&
            character.getSetting("ranger-gathered-swarm", false)) {
            const ranger_level = character.getClassLevel("Ranger");
            damages.push(ranger_level < 11 ? "1d6" : "1d8");
            damage_types.push("Gathered Swarm");
        }
    }

    if (character.hasClass("Warlock")) {
        // Warlock: The Hexblade: Hexblade's Curse
        if (to_hit != null &&
            character.getSetting("warlock-hexblade-curse", false) &&
            character.hasClassFeature("Hexblade’s Curse") &&
            character._proficiency !== null) {
            damages.push(character._proficiency);
            damage_types.push("Hexblade's Curse");
        }
        
        // Warlock: Genie Patron: Genie's Wrath
        if (to_hit != null &&
            character.hasClassFeature("Genie’s Vessel") &&
            character.getSetting("genies-vessel", false)) {
            damages.push(character._proficiency);
            if (character.hasClassFeature("Genie’s Vessel: Genie's Wrath (Dao)"))
                damage_types.push("Genie's Wrath (Bludgeoning)");
            else if (character.hasClassFeature("Genie’s Vessel: Genie's Wrath (Djinni)"))
                damage_types.push("Genie's Wrath (Thunder)");
            else if (character.hasClassFeature("Genie’s Vessel: Genie's Wrath (Efreeti)"))
                damage_types.push("Genie's Wrath (Fire)");
            else if (character.hasClassFeature("Genie’s Vessel: Genie's Wrath (Marid)"))
                damage_types.push("Genie's Wrath (Cold)");
            else
                damage_types.push("Genie's Wrath");
        }

        // Warlock: The Undead: Grave Touched
        if (to_hit != null &&
            character.hasClassFeature("Grave Touched") &&
            character.getSetting("warlock-grave-touched", false)) {
                damage_types[0] = "Necrotic";
                let highest_dice = 0;
                for (let dmg of damages) {
                    const match = dmg.match(/[0-9]*d([0-9]+)/);
                    if (match) {
                        const sides = parseInt(match[1]);
                        if (sides > highest_dice)
                            highest_dice = sides;
                    }
                }
                if (highest_dice != 0) {
                    damages.push(`1d${highest_dice}`);
                    damage_types.push("Grave Touched")
                }
            }
    }

    return to_hit;
}

function handleSpecialWeaponAttacks(damages=[], damage_types=[], properties, settings_to_change={}, {action_name="", item_customizations=[], item_type="", item_name="", to_hit, effects=[]}={}) {
    // Class Specific
    if (character.hasClass("Artificer")) {
        //Artificer: Battlemaster: Arcane Jolt
        // TODO: Implement for Steel Defender at later date
        if (damages.length > 0 &&
            character.hasClassFeature("Arcane Jolt") &&
            character.getSetting("artificer-arcane-jolt", false) &&
            (properties["Infused"] || item_type.indexOf(", Common") === -1)) {
            damages.push(character._level < 15 ? "2d6" : "4d6");
            damage_types.push("Arcane Jolt");
        }
    }

    if (character.hasClass("Barbarian")) {
        // Barbarian: Path of the Zealot: Divine Fury
        if (character.hasClassFeature("Rage") &&
            character.getSetting("barbarian-rage", false) &&
            character.getSetting("barbarian-divine-fury", true) &&
            character.hasClassFeature("Divine Fury")) {
            const barbarian_level = character.getClassLevel("Barbarian");
            damages.push(`1d6+${Math.floor(barbarian_level / 2)}`);
            damage_types.push("Divine Fury");
        }
    }
    
    if (character.hasClass("Bard")) {
        // Bard: College of Whispers: Psychic blades
        if (character.hasClassFeature("Psychic Blades") &&
            character.getSetting("bard-psychic-blades", false)) {
            const bard_level = character.getClassLevel("Bard");
            let blades_dmg = "2d6";
            if (bard_level < 5)
                blades_dmg = "2d6"
            else if (bard_level < 10)
                blades_dmg = "3d6"
            else if (bard_level < 15)
                blades_dmg = "5d6"
            else
                blades_dmg = "8d6"
            damages.push(blades_dmg);
            damage_types.push("Psychic Blades");
            const isLocked = character.getSetting("bard-psychic-blades-lock", false);
            if(!isLocked) settings_to_change["bard-psychic-blades"] = false;
        }
    }

    if (character.hasClass("Blood Hunter")) {
        // Bloodhunter: Crimson Rite
        if (character.getSetting("bloodhunter-crimson-rite", false) &&
            character.hasClassFeature("Crimson Rite") &&
            ((properties["Attack Type"] == "Ranged" || properties["Attack Type"] == "Melee") ||
            action_name.includes("Predatory Strike") || action_name.includes("Polearm Master"))) {
            const bloodhunter_level = character.getClassLevel("Blood Hunter");
            if (bloodhunter_level > 0) {
                let rite_die = "1d4";
                if (bloodhunter_level <= 4)
                    rite_die = "1d4";
                else if (bloodhunter_level <= 10)
                    rite_die = "1d6";
                else if (bloodhunter_level <= 16)
                    rite_die = "1d8";
                else
                    rite_die = "1d10";
                damages.push(rite_die);
                damage_types.push("Crimson Rite");
            }
        }
    }
    
    if (character.hasClass("Cleric")) {
        // Cleric: Divine Strike 2014
        if (character.hasClassFeature("Divine Strike") &&
            character.getSetting("cleric-divine-strike", true)) {
            const cleric_level = character.getClassLevel("Cleric");
            damages.push(cleric_level < 14 ? "1d8" : "2d8");
            damage_types.push("Divine Strike");

            const isLocked = character.getSetting("cleric-divine-strike-lock", false);
            if(!isLocked) settings_to_change["cleric-divine-strike"] = false;
        }
    }

    if (character.hasClass("Fighter")) {
        // Fighter: Giant’s Might;
        if (character.hasClassFeature("Giant’s Might") &&
            character.getSetting("fighter-giant-might", false)) {
            const fighter_level = character.getClassLevel("Fighter");
            damages.push(fighter_level < 10 ? "1d6" : (fighter_level < 18 ? "1d8" : "1d10"));
            damage_types.push("Giant’s Might");
        }
    }

    if (character.hasClass("Paladin")) {
        // Paladin: Sacred Weapon
        if (to_hit !== null && 
            character.getSetting("paladin-sacred-weapon", false)) {
            const charisma_attack_mod =  Math.max(character.getAbility("CHA").mod, 1);
            to_hit += `+ ${charisma_attack_mod}`;
        }
    }

    if (character.hasClass("Ranger")) {
        // Ranger: Gloom Stalker: Dread Ambusher
        if (character.getSetting("ranger-dread-ambusher", false)) {
            const hasDreadAmbusher = character.hasClassFeature("Dread Ambusher");
            const hasDreadAmbusher2024 = character.hasClassFeature("Dread Ambusher 2024");
            
            if (hasDreadAmbusher || hasDreadAmbusher2024) {
                damages.push(
                    hasDreadAmbusher 
                        ? "1d8" 
                        : (character.hasClassFeature("Stalker’s Flurry 2024") ? "2d8" : "2d6")
                );
                damage_types.push("Dread Ambusher");
                const isLocked = character.getSetting("ranger-dread-ambusher-lock", false);
                if(!isLocked) settings_to_change["ranger-dread-ambusher"] = false;
            }
        }
        
        // Ranger: Hunter: Colossus Slayer
        if (character.hasClassFeature("Hunter’s Prey: Colossus Slayer") &&
            character.getSetting("ranger-colossus-slayer", false)) {
            damages.push("1d8");
            damage_types.push("Colossus Slayer");
        }
        
        // Ranger: Monster Slayer: Slayer's Prey
        if (character.hasClassFeature("Slayer’s Prey") &&
            character.getSetting("ranger-slayers-prey", false)) {
            damages.push("1d6");
            damage_types.push("Slayer’s Prey");
        }
        
        // Ranger: Horizon Walker: Planar Warrior
        if (character.hasClassFeature("Planar Warrior") &&
            character.getSetting("ranger-planar-warrior", false)) {
            const ranger_level = character.getClassLevel("Ranger");
            damages.push(ranger_level < 11 ? "1d8" : "2d8");
            damage_types.push("Planar Warrior");
        }

        // Ranger: Fey Wanderer: Dreadful Strikes
        if (character.hasClassFeature("Dreadful Strikes") &&
            character.getSetting("fey-wanderer-dreadful-strikes")) {
            const ranger_level = character.getClassLevel("Ranger");
            damages.push(ranger_level < 11 ? "1d4" : "1d6");
            damage_types.push("Dreadful Strikes");
        }
    }
    
    if (character.hasClass("Rogue")) {
        // Rogue: Sneak Attack
        const name = action_name || item_name || "";
        if(character.hasClassFeature("Sneak Attack") && character.getSetting("rogue-sneak-attack", false) &&
            (properties["Attack Type"] == "Ranged" ||
            (properties["Properties"] && properties["Properties"].includes("Finesse")) ||
            name.includes("Psychic Blade") ||
            name.includes("Shadow Blade"))) {
            const sneakDieCount = Math.ceil(character._classes["Rogue"] / 2);
            let sneak_attack = `${sneakDieCount}d6`;
            damages.push(sneak_attack);
            damage_types.push("Sneak Attack");
            effects.push("Sneak Attack");

            const isLocked = character.getSetting("rogue-sneak-attack-lock", false);
            if(!isLocked) settings_to_change["rogue-sneak-attack"] = false;
        }
    }

    if (character.hasClass("Warlock")) {
        // Warlock: Eldritch Invocation: Lifedrinker
        if (character.getSetting("eldritch-invocation-lifedrinker", false) &&
            item_customizations.includes("Pact Weapon")) {
            const charisma_damage_mod =  Math.max(character.getAbility("CHA").mod, 1);
            damages.push(`${charisma_damage_mod}`);
            damage_types.push("Lifedrinker");
        }
    }

    return to_hit;
}

function capitalize(str) {
    return str.replace(/\b\w/g, (c) => c.toUpperCase());
}

async function rollItem(force_display = false, force_to_hit_only = false, force_damages_only = false, force_versatile = false, spell_group = null) {
    const prop_list = $(".b20-item-pane .ct-item-detail [role=list] > div");
    const properties = propertyListToDict(prop_list);
    properties["Properties"] = properties["Properties"] || "";
    //console.log("Properties are : " + String(properties));
    const item_name = $(".b20-item-pane .ct-sidebar__heading .ct-item-name,.b20-item-pane .ct-sidebar__heading .ddbc-item-name, .b20-item-pane .ct-sidebar__heading span[class*='styles_itemName']")[0].firstChild.textContent;
    const item_type = $(".ct-item-detail__intro").text();
    const item_tags = $(".ct-item-detail__tags-list .ct-item-detail__tag").toArray().map(elem => elem.textContent);
    const item_customizations = $(".b20-item-pane .ct-item-detail__class-customize-item .ddbc-checkbox--is-enabled .ddbc-checkbox__label").toArray().map(e => e.textContent);
    const source = item_type.trim().toLowerCase();
    const is_tool = isItemATool(item_name, source);
    const is_instrument = isItemAnInstruction(item_name, item_tags);
    const description = descriptionToString(`.ct-item-detail__description, .b20-item-pane div[class*='styles_description']`);
    const quantity = $(".b20-item-pane .ct-simple-quantity .ct-simple-quantity__value .ct-simple-quantity__input").val();
    const is_infused = $(".b20-item-pane .ct-item-detail__infusion");
    const has_mastery = $(".b20-item-pane div[class*='styles_action'] div[class*='styles_label']");
    if(has_mastery.length >0){
        const regex = /Mastery:\s+(.+)/;
        const match = has_mastery.text().trim().match(regex);
        const mastery = match ? match[1].trim() : null;
        if(mastery) properties["Mastery"] = mastery;
    }
    if (is_infused.length > 0)
        properties["Infused"] = true;
    let is_versatile = false;
    if (key_modifiers["display_attack"]) {
        force_display = true;
    }
    if (!force_display && Object.keys(properties).includes("Damage")) {
        const item_full_name = $(".b20-item-pane .ct-sidebar__heading .ct-item-name,.b20-item-pane .ct-sidebar__heading .ddbc-item-name, .b20-item-pane .ct-sidebar__heading span[class*='styles_itemName']").text();
        let to_hit = properties["To Hit"] !== undefined && properties["To Hit"] !== "--" ? properties["To Hit"] : null;
        const settings_to_change = {}

        if (to_hit === null)
            to_hit = findToHit(item_full_name, ".ct-combat-attack--item,.ddbc-combat-attack--item", ".ct-item-name,.ddbc-item-name,span[class*='styles_itemName']", ".ct-combat-attack__tohit,.ddbc-combat-attack__tohit");

        if (to_hit !== null)
            character._cacheToHit(item_full_name, to_hit);
        else
            to_hit = character._getToHitCache(item_full_name);

        const damages = [];
        let damage_types = [];
        const waybeyond20_action_pool = [];
        const waybeyond20_item_category = properties["Attack Type"] ? "weapon" : "item";
        const waybeyond20_item_tags = [];
        if (wayBeyond20IsProbablyMagicalItem(item_type, properties))
            waybeyond20_item_tags.push("magical");
        for (let i = 0; i < prop_list.length; i++) {
            const prop = propertyListToDict(prop_list.eq(i));
            if (Object.keys(prop)[0] == "Damage") {
                const value = prop_list.eq(i).find("> p").filter((idx, el) => el.textContent === prop["Damage"]);
                let damage = value.find(".ct-damage__value,.ddbc-damage__value").text();
                let damage_type = properties["Damage Type"] || "";
                let versatile_damage = value.find(".ct-item-detail__versatile-damage,.ddbc-item-detail__versatile-damage").text().slice(1, -1);

                if(damages.length == 0) {
                    if (versatile_damage != "") {
                        versatile_damage = applyGWFIfRequired(item_name, properties, versatile_damage);
                    } else {
                        damage = applyGWFIfRequired(item_name, properties, damage);
                    }
                }

                if (character.hasClass("Ranger") &&
                    character.hasClassFeature("Planar Warrior") &&
                    character.getSetting("ranger-planar-warrior", false))
                    damage_type = "Force";

                if (versatile_damage != "" && damage_type != "--") {
                    let versatile_choice = character.getSetting("versatile-choice", "both");
                    if (key_modifiers.versatile_one_handed)
                        versatile_choice = "one"
                    if (key_modifiers.versatile_two_handed)
                        versatile_choice = "two";
                    if (force_versatile) {
                        versatile_choice = "two";
                    }
                    if (versatile_choice == "one") {
                        wayBeyond20AddDamage(waybeyond20_action_pool, damages, damage_types, {
                            category: waybeyond20_item_category,
                            source: item_name,
                            formula: damage,
                            type: character.getGlobalSetting("weapon-handedness", false) ? damage_type + " (1-Hand)" : damage_type,
                            tohit: to_hit || "",
                            determinant: "melee-attack",
                            tags: ["base-weapon", ...waybeyond20_item_tags]
                        });
                    } else if (versatile_choice == "two") {
                        wayBeyond20AddDamage(waybeyond20_action_pool, damages, damage_types, {
                            category: waybeyond20_item_category,
                            source: item_name,
                            formula: versatile_damage,
                            type: character.getGlobalSetting("weapon-handedness", false) ? damage_type + " (2-Hand)" : damage_type,
                            tohit: to_hit || "",
                            determinant: "melee-attack",
                            tags: ["base-weapon", ...waybeyond20_item_tags]
                        });
                    } else {
                        wayBeyond20AddDamage(waybeyond20_action_pool, damages, damage_types, {
                            category: waybeyond20_item_category,
                            source: item_name,
                            formula: damage,
                            type: damage_type + " (1-Hand)",
                            tohit: to_hit || "",
                            determinant: "melee-attack",
                            tags: ["base-weapon", ...waybeyond20_item_tags]
                        });
                        wayBeyond20AddDamage(waybeyond20_action_pool, damages, damage_types, {
                            category: waybeyond20_item_category,
                            source: item_name,
                            formula: versatile_damage,
                            type: damage_type + " (2-Hand)",
                            tohit: to_hit || "",
                            determinant: "melee-attack",
                            tags: ["base-weapon", ...waybeyond20_item_tags]
                        });
                        is_versatile = true;
                    }
                } else if (damage != "" && damage_type != "--") {
                    wayBeyond20AddDamage(waybeyond20_action_pool, damages, damage_types, {
                        category: waybeyond20_item_category,
                        source: item_name,
                        formula: damage,
                        type: damage_type,
                        tohit: to_hit || "",
                        determinant: "melee-attack",
                        tags: ["base-weapon", ...waybeyond20_item_tags]
                    });
                }
                const additional_damages = value.find(".ct-item-detail__additional-damage,.ddbc-item-detail__additional-damage");
                for (let j = 0; j < additional_damages.length; j++) {
                    let dmg = additional_damages.eq(j).text();
                    let dmg_type = additional_damages.eq(j).find(".ct-damage-type-icon .ct-tooltip,.ddbc-damage-type-icon .ddbc-tooltip").attr("data-original-title");
                    const dmg_info = additional_damages.eq(j).find(".ct-item-detail__additional-damage-info,.ddbc-item-detail__additional-damage-info").text();
                    if (dmg != "") {
                        dmg = dmg.replace(dmg_info, "");
                        if (dmg_info != "")
                            dmg_type += " (" + dmg_info + ")";

                        dmg = applyGWFIfRequired(item_name, properties, dmg);

                        wayBeyond20AddDamage(waybeyond20_action_pool, damages, damage_types, {
                            category: waybeyond20_item_category,
                            source: item_name,
                            formula: dmg,
                            type: dmg_type,
                            determinant: waybeyond20_action_pool.length > 0 ? `hit:${waybeyond20_action_pool[0].id}` : "hit:d0",
                            tags: ["weapon-effect", ...waybeyond20_item_tags]
                        });
                    }
                }
                break;
            }
        }

        // 2024 brutal strike
        if (character.getSetting("brutal-strike") && character.hasClassFeature("Brutal Strike"))  {  
            // Brutal Strike is a class feature of Barbarian at level 13 and level 17 but it only increases the damage die at level 17
            let strikeDieCount = character.hasClassFeature("Improved Brutal Strike") && character.getClassLevel("Barbarian") >= 17 ? 2 : 1; 
            let brutal_strike_dmg = `${strikeDieCount}d10`;
            
            brutal_strike_dmg = applyGWFIfRequired(item_name, properties, brutal_strike_dmg);
            
            damages.push(brutal_strike_dmg);
            damage_types.push("Brutal Strike");

            settings_to_change["brutal-strike"] = false;
        }

        // Handle Dragon Wing * Ranged Weapons
        if (item_name.includes("Dragon Wing") || item_name === "Flail of Tiamat") {
            damages.splice(2,damages.length - 2);
            let possible_damages = damage_types.splice(1,damage_types.length - 1);
            const damage_type = properties.Notes && possible_damages.reduce((found, damage) => {
                if (found) return found;
                if (properties.Notes.toLowerCase().includes(damage.toLowerCase())) return damage;
                return null;
            }, null);
            if (damage_type) {
                damage_types.push(damage_type);
            }
            else if (item_name.includes("Dragon Wing")) {
                damage_types.push("Infused");
            }
            else if (item_name === "Flail of Tiamat") {
                damage_types.push("Chosen Type");
            }
            else {
                damage_types.push("Extra");
            }
        }

        const weapon_damage_length = damages.length;
        
        // If clicking on a spell group within a item (Green flame blade, Booming blade), then add the additional damages from that spell
        if (spell_group) {
            const group_name = $(spell_group).find(".ct-item-detail__spell-damage-group-name").text();
            const group_origin = $(spell_group).find(".ddbc-data-origin-name").text();
            const group_damages = $(spell_group).find(".ct-item-detail__spell-damage-group-item");
            const spell_damages = [];
            const spell_damage_types = [];
            for (let j = 0; j < group_damages.length; j++) {
                let dmg = group_damages.eq(j).find(".ddbc-damage__value").text();
                let dmg_type = group_damages.eq(j).find(".ddbc-tooltip").attr("data-original-title");
                if (dmg != "") {
                    spell_damages.push(dmg);
                    spell_damage_types.push(dmg_type);
                }
            }
            handleSpecialSpells(group_name, spell_damages, spell_damage_types, {spell_source: group_origin});
            damages.push(...spell_damages);
            damage_types.push(...spell_damage_types.map(t => `${t} (${group_name})`));
        }

        addCustomDamages(character, damages, damage_types);

        // Capitalize all Damage Types to ensure consistency for later processing
        damage_types = damage_types.map(t => capitalize(t.trim()));

        const effects = [];

        to_hit = handleSpecialGeneralAttacks(damages, damage_types, properties, settings_to_change, {to_hit, item_name, effects});

        to_hit = handleSpecialWeaponAttacks(damages, damage_types, properties, settings_to_change, {item_customizations, item_type, to_hit, item_name, effects});

        if (properties["Attack Type"] == "Melee") {
            to_hit = handleSpecialMeleeAttacks(damages, damage_types, properties, settings_to_change, { to_hit, effects });
        }

        if (properties["Attack Type"] == "Ranged") {
            to_hit = handleSpecialRangedAttacks(damages, damage_types, properties, settings_to_change, { to_hit, effects });
        }

        wayBeyond20NormalizeActionPoolToDamages(waybeyond20_action_pool, damages, damage_types, waybeyond20_item_category, item_name, waybeyond20_item_tags);
        
        let critical_limit = 20;
        if (character.hasClassFeature("Hexblade’s Curse") &&
            character.getSetting("warlock-hexblade-curse", false))
            critical_limit = 19;
        if (character.hasClassFeature("Improved Critical"))
            critical_limit = 19;
        if (character.hasClassFeature("Invincible Conqueror") &&
            character.getSetting("paladin-invincible-conqueror", false))
            critical_limit = 19;
        if (character.hasClassFeature("Superior Critical"))
            critical_limit = 18;

        let brutal = 0;
        if (properties["Attack Type"] == "Melee") {
            if (character.getSetting("brutal-critical")) {
                if (character.hasClassFeature("Brutal Critical")) {
                    const barbarian_level = character.getClassLevel("Barbarian");
                    brutal += 1 + Math.floor((barbarian_level - 9) / 4);
                }
                if (character.hasRacialTrait("Savage Attacks"))
                    brutal += 1;
            }
        }

        const roll_properties = await buildAttackRoll(character,
            "item",
            item_name,
            description,
            properties,
            damages,
            damage_types,
            to_hit,
            brutal,
            force_to_hit_only,
            force_damages_only,
            {weapon_damage_length},
            settings_to_change
        );
        if (roll_properties === null) {
            // A query was cancelled, so let's cancel the roll
            return;
        }
        roll_properties["waybeyond20-action-pool"] = waybeyond20_action_pool;
        wayBeyond20ApplySavageAttacker(character, roll_properties, waybeyond20_action_pool, settings_to_change);
        wayBeyond20ApplyBedsideMannerIntent(roll_properties);
        effects.forEach(effect => addEffect(roll_properties, effect));
        if (properties["Mastery"]) {
            roll_properties["mastery"] = properties["Mastery"];
        }
        roll_properties["item-type"] = item_type;
        roll_properties["item-customizations"] = item_customizations;
        roll_properties["is_versatile"] = is_versatile;
        if (quantity) roll_properties["quantity"] = parseInt(quantity);
        if (critical_limit != 20)
            roll_properties["critical-limit"] = critical_limit;
        const custom_critical_limit = parseInt(character.getSetting("custom-critical-limit", ""))
        if (custom_critical_limit) {
            roll_properties["critical-limit"] = custom_critical_limit;
            if (to_hit !== null)
                roll_properties["name"] += ` (CRIT${custom_critical_limit})`;
        }

        // Assassinate: consider all rolls as critical;
        if (character.hasClassFeature("Assassinate") &&
            character.getSetting("rogue-assassinate", false)) {
            roll_properties["critical-limit"] = 1;
            roll_properties["advantage"] = RollType.OVERRIDE_ADVANTAGE;

            const isLocked = character.getSetting("rogue-assassinate-lock", false);
            if(!isLocked) settings_to_change["rogue-assassinate"] = false;
        }
        if (character.hasClassFeature("Assassinate 2024") &&
            character.getSetting("rogue-assassinate-2024", false)) {
            roll_properties["advantage"] = RollType.OVERRIDE_ADVANTAGE;

            const isLocked = character.getSetting("rogue-assassinate-lock", false);
            if(!isLocked) settings_to_change["rogue-assassinate-2024"] = false;
        }
        if (effects.includes("Reckless Attack")) {
            roll_properties["advantage"] = RollType.OVERRIDE_ADVANTAGE;
        }
        // Sorcerer: Clockwork Soul - Trance of Order
        if (character.hasClassFeature("Trance of Order") && character.getSetting("sorcerer-trance-of-order", false))
            roll_properties.d20 = "1d20min10";

        // Apply batched updates to settings, if any:
        if (Object.keys(settings_to_change).length > 0)
            character.mergeCharacterSettings(settings_to_change);

        return sendRollWithCharacter("attack", (roll_properties["damages"] || damages)[0], roll_properties);
    } else if (!force_display && (is_tool || is_instrument) && character._abilities.length > 0) {
        const proficiencies = {}
        proficiencies["None"] = 0;
        proficiencies["Half Proficiency"] = Math.floor(character._proficiency / 2);
        proficiencies["Proficiency"] = parseInt(character._proficiency);
        proficiencies["Expertise"] = character._proficiency * 2;
        const formula = "1d20 + @ability + @proficiency + @custom_dice";
        let html = '<form>';
        html += '<div class="beyond20-form-row"><label>Roll Formula</label><input type="text" value="' + formula + '" disabled></div>';
        html += '<div class="beyond20-form-row"><label>Select Ability</label><select name="ability">';
        const modifiers = {}
        for (let ability of character._abilities) {
            html += '<option value="' + ability[1] + '">' + ability[0] + '</option>';
            modifiers[ability[1]] = ability[3];
        }
        html += "</select></div>";
        html += '<div class="beyond20-form-row"><label>Select Proficiency</label><select name="proficiency">';
        for (let prof in proficiencies) {
            html += '<option value="' + prof + '">' + prof + '</option>';
        }
        html += "</select></div>";
        html += '</form>';
        dndbeyondDiceRoller._prompter.prompt("Using a tool", html, item_name).then((html) => {
            if (html) {
                const ability = html.find('[name="ability"]').val();
                const proficiency = html.find('[name="proficiency"]').val();
                const prof_val = proficiencies[proficiency];
                const modifier = prof_val ? `${modifiers[ability]}${prof_val > 0 ? ' +' : ' -'}${prof_val}` : modifiers[ability];
                const roll_properties = {
                    "skill": item_name,
                    "ability": ability,
                    "modifier": modifier,
                    "proficiency": proficiency
                }
                if (ability == "STR" &&
                    ((character.hasClassFeature("Rage") && character.getSetting("barbarian-rage", false)) ||
                        (character.hasClassFeature("Giant’s Might") && character.getSetting("fighter-giant-might", false)))) {
                    roll_properties["advantage"] = RollType.OVERRIDE_ADVANTAGE;
                    addEffect(roll_properties, "Rage");
                }
                roll_properties.d20 = "1d20";
                // Set Reliable Talent flag if character has the feature and skill is proficient/expertise
                if (character.hasClassFeature("Reliable Talent") && ["Proficiency", "Expertise"].includes(proficiency))
                    roll_properties.d20 = "1d20min10";
                // Sorcerer: Clockwork Soul - Trance of Order
                if (character.hasClassFeature("Trance of Order") && character.getSetting("sorcerer-trance-of-order", false))
                    roll_properties.d20 = "1d20min10";
                // Mark of Storm Half-Elf Windwright's Intuition
                if (character.hasRacialTrait("Windwright’s Intuition") && is_tool && item_name == "Navigator's Tools")
                    roll_properties.modifier += "+1d4";
                // Mark of Warding Dwarf - Warder's Intuition
                if (character.hasRacialTrait("Warder’s Intuition") && is_tool && item_name == "Thieves' Tools")
                    roll_properties.modifier += "+1d4";
                // Mark of Scribing Gnome - Gifted Scribe
                if (character.hasRacialTrait("Gifted Scribe") && is_tool && item_name == "Calligrapher's Supplies")
                    roll_properties.modifier += "+1d4";
                // Mark of Hospitality Halfing - Healing Touch
                if (character.hasRacialTrait("Healing Touch") && is_tool && item_name == "Herbalism Kit")
                    roll_properties.modifier += "+1d4";
                // Mark of Hospitality Halfing - Ever Hospitable
                if (character.hasRacialTrait("Ever Hospitable") && is_tool && (item_name == "Brewer's Supplies" || item_name == "Cook's Utensils"))
                    roll_properties.modifier += "+1d4";
                // Mark of Making Human - Artisan's Intuition
                if (character.hasRacialTrait("Artisan’s Intuition") && is_tool)
                    roll_properties.modifier += "+1d4";
                return sendRollWithCharacter("skill", "1d20" + modifier, roll_properties);
            }
        });
    } else {
        return sendRollWithCharacter("item", 0, {
            "name": item_name,
            "description": description,
            "item-type": item_type,
            "tags": item_tags,
            "quantity": quantity ? parseInt(quantity) : undefined
        });
    }
}

async function rollAction(paneClass, force_to_hit_only = false, force_damages_only = false) {
    if (key_modifiers["display_attack"]) {
        return displayAction(paneClass);
    }
    // b20-action-pane and ct-custom-action-page both use ct-action-detail for the details
    const properties = propertyListToDict($(`.${paneClass} [role=list] > div, .${paneClass} .ct-action-detail [role=list] > div`));
    //console.log("Properties are : " + String(properties));
    const action_name = $(".ct-sidebar__heading").text();
    const action_parent = $(".ct-sidebar__header-parent").text();
    const description = descriptionToString(`.ct-action-detail__description, .${paneClass} div[class*='styles_description']`);
    let to_hit = properties["To Hit"] !== undefined && properties["To Hit"] !== "--" ? properties["To Hit"] : null;

    if (action_name == "Superiority Dice" || action_parent == "Maneuvers") {
        const fighter_level = character.getClassLevel("Fighter");
        let superiority_die = fighter_level < 10 ? "1d8" : (fighter_level < 18 ? "1d10" : "1d12");
        if (action_name === "Maneuvers: Parry")
            superiority_die += " + " + character.getAbility("DEX").mod;
        else if (action_name === "Maneuvers: Rally")
            superiority_die += " + " + character.getAbility("CHA").mod;
        const rollProperties = {
            "name": action_name,
            "description": description,
            "modifier": superiority_die
        };
        wayBeyond20AttachActivationResource(rollProperties, properties, null, null, {
            name: action_name,
            rollType: "custom"
        });
        return sendRollWithCharacter("custom", superiority_die, rollProperties);
    } else if (action_name === "Blood and Bone" && character.hasFeat("Triage Expert", true)) {
        return wayBeyond20RollBloodAndBone(description, properties);
    } else if (action_name === "Bardic Inspiration") {
        return wayBeyond20ActivateBardicInspiration(description);
    } else if (action_parent == "Blade Flourish") {
        const inspiration_die = wayBeyond20GetBardicInspirationDie();
        return sendRollWithCharacter("custom", inspiration_die, {
            "name": action_name,
            "description": description,
            "modifier": inspiration_die
        });
    } else if (action_name.includes("Blood Curse of the Eyeless")) {
        const bloodhunter_level = character.getClassLevel("Blood Hunter");
        let hemocraft_die = bloodhunter_level < 5 ? "1d4" : (bloodhunter_level < 11 ? "1d6" : (bloodhunter_level < 17 ? "1d8" : "1d10"));
        const rollProperties = {
            "name": action_name,
            "description": description,
            "modifier": hemocraft_die
        };
        wayBeyond20AttachActivationResource(rollProperties, properties, null, null, {
            name: action_name,
            rollType: "custom"
        });
        return sendRollWithCharacter("custom", hemocraft_die, rollProperties);
    } else if (Object.keys(properties).includes("Damage") || to_hit !== null || properties["Attack/Save"] !== undefined) {
        const damages = [];
        let damage_types = [];
        if (Object.keys(properties).includes("Damage")) {
            damages.push(properties["Damage"]);
            damage_types.push(properties["Damage Type"] || "");
        }

        const weapon_damage_length = damages.length;

        addCustomDamages(character, damages, damage_types);

        // Capitalize all Damage Types to ensure consistency for later processing
        damage_types = damage_types.map(t => capitalize(t.trim()));

        const settings_to_change = {}
        let brutal = 0;
        let critical_limit = 20;
        if (character.hasClassFeature("Hexblade’s Curse") &&
            character.getSetting("warlock-hexblade-curse", false))
            critical_limit = 19;

        // 2024 brutal strike add extra die and apply GWF
        if (character.getSetting("brutal-strike") && character.hasClassFeature("Brutal Strike"))  {  
            let strikeDieCount = character.hasClassFeature("Improved Brutal Strike") ? 2 : 1; 

            let brutal_strike_dmg = applyGWFIfRequired(action_name, properties, `${strikeDieCount}d10`);

            damages.push(brutal_strike_dmg);
            damage_types.push("Brutal Strike");

            settings_to_change["brutal-strike"] = false;
        }

        // apply for normal die
        if (damages.length != 0) {
            damages[0] = applyGWFIfRequired(action_name, properties, damages[0]);
        }

        const meleeActions = [
            "polearm master",
            "pole strike",
            "unarmed strike",
            "tavern brawler strike",
            "psychic blade",
            "bite",
            "claws",
            "tail",
            "ram",
            "horns",
            "hooves",
            "talons",
            "thunder gauntlets",
            "unarmed fighting",
            "arms of the astral self",
            "shadow blade",
            "predatory strike",
            "enhanced unarmed strike",
            "flurry of blows"
        ];
        const isMeleeAttack = includesNormalized(meleeActions, action_name);
        
        const isRangedAttack = action_name.includes("Lightning Launcher");

        to_hit = handleSpecialGeneralAttacks(damages, damage_types, properties, settings_to_change, {to_hit, action_name});

        if (isMeleeAttack || isRangedAttack) {
            to_hit = handleSpecialWeaponAttacks(damages, damage_types, properties, settings_to_change, {to_hit, action_name});
            if (character.hasClassFeature("Improved Critical"))
                critical_limit = 19;
            if (character.hasClassFeature("Invincible Conqueror") &&
                character.getSetting("paladin-invincible-conqueror", false))
                critical_limit = 19;
            if (character.hasClassFeature("Superior Critical"))
                critical_limit = 18;

            if (character.getSetting("brutal-critical")) {
                if (character.hasClassFeature("Brutal Critical")) {
                    const barbarian_level = character.getClassLevel("Barbarian");
                    brutal += 1 + Math.floor((barbarian_level - 9) / 4);
                }
                if (character.hasRacialTrait("Savage Attacks"))
                    brutal += 1;
            }
        }

        const effects = [];
        if (isMeleeAttack) {
            to_hit = handleSpecialMeleeAttacks(damages, damage_types, properties, settings_to_change, { to_hit, action_name, effects });
        }

        if (isRangedAttack) {
            to_hit = handleSpecialRangedAttacks(damages, damage_types, properties, settings_to_change, { to_hit, action_name, effects });
        }

        // Circle of Spores - Symbiotic Entity
        if (character.hasClassFeature("Symbiotic Entity") &&
        character.getSetting("druid-symbiotic-entity", false) &&
            action_name === "Halo of Spores") {
            damages[0] = damages[0].replace(/1d/g, "2d");
        }

        const roll_properties = await buildAttackRoll(character,
            "action",
            action_name,
            description,
            properties,
            damages,
            damage_types,
            to_hit,
            brutal,
            force_to_hit_only,
            force_damages_only,
            {weapon_damage_length},
            settings_to_change);

        if (roll_properties === null) {
            // A query was cancelled, so let's cancel the roll
            return;
        }
        effects.forEach(effect => addEffect(roll_properties, effect));
        wayBeyond20ApplyBedsideMannerIntent(roll_properties);
        if (critical_limit != 20)
            roll_properties["critical-limit"] = critical_limit;

        const custom_critical_limit = parseInt(character.getSetting("custom-critical-limit", ""))
        if (custom_critical_limit) {
            roll_properties["critical-limit"] = custom_critical_limit;
            if (to_hit !== null)
                roll_properties["name"] += ` (CRIT${custom_critical_limit})`;
        }

        // Asssassinate: consider all rolls as critical;
        if (character.hasClassFeature("Assassinate") &&
            character.getSetting("rogue-assassinate", false)) {
            roll_properties["critical-limit"] = 1;
            roll_properties["advantage"] = RollType.OVERRIDE_ADVANTAGE;
            
            const isLocked = character.getSetting("rogue-assassinate-lock", false);
            if(!isLocked) settings_to_change["rogue-assassinate"] = false;
        }
        if (character.hasClassFeature("Assassinate 2024") &&
            character.getSetting("rogue-assassinate-2024", false)) {
            roll_properties["advantage"] = RollType.OVERRIDE_ADVANTAGE;

            const isLocked = character.getSetting("rogue-assassinate-lock", false);
            if(!isLocked) settings_to_change["rogue-assassinate-2024"] = false;
        }
        // Sorcerer: Clockwork Soul - Trance of Order
        if (character.hasClassFeature("Trance of Order") && character.getSetting("sorcerer-trance-of-order", false))
            roll_properties.d20 = "1d20min10";

        // Apply batched updates to settings, if any:
        if (Object.keys(settings_to_change).length > 0)
            character.mergeCharacterSettings(settings_to_change);

        if (!force_damages_only) {
            wayBeyond20AttachActivationResource(roll_properties, properties, null, "action", {
                name: action_name,
                rollType: "attack"
            });
        }
        return sendRollWithCharacter("attack", damages[0], roll_properties);
    } else {
        const rollProperties = {
            "name": action_name,
            "description": description,
            "source-type": "action"
        };
        wayBeyond20AttachActivationResource(rollProperties, properties, null, null, {
            name: action_name,
            rollType: "trait"
        });
        return sendRollWithCharacter("trait", 0, rollProperties);
    }
}

function handleSpecialSpells(spell_name, damages=[], damage_types=[], {spell_source="", spell_level="Cantrip", castas}={}) {
    // Handle special spells;
    // Absorb Elements
    if (spell_name == "Absorb Elements" && damages.length == 5 &&
        damage_types[0] == "Acid" && damage_types[1] == "Cold" && damage_types[2] == "Fire" &&
        damage_types[3] == "Lightning" && damage_types[4] == "Thunder") {
        const dmg = damages[0];
        damages.length = 0;
        damage_types.length = 0;
        damages.push(dmg);
        damage_types.push("Triggering Type");
    }

    // Handle Hunter's Mark
    if (spell_name == "Hunter's Mark" && damages.length == 3 &&
        damage_types[0] == "Bludgeoning" && damage_types[1] == "Piercing" && damage_types[2] == "Slashing") {
        const dmg = damages[0];
        damages.length = 0;
        damage_types.length = 0;
        damages.push(dmg);
        damage_types.push("Weapon Type");
    }

    // Artificer
    if (character.hasClass("Artificer")) {
        // Artificer: Arcane Firearm
        if (damages.length > 0 &&
            character.hasClassFeature("Arcane Firearm") &&
            character.getSetting("artificer-arcane-firearm", false) &&
            spell_source.includes("Artificer")) {
            damages.push("1d8");
            damage_types.push("Arcane Firearm");
        }
    }

    // Bard
    if (character.hasClass("Bard")) {
        // Bard: College of Spirits: Spiritual Focus
        if (damages.length > 0 &&
            character.hasClassFeature("Spiritual Focus") &&
            character.getSetting("bard-spiritual-focus", false) &&
            spell_source.includes("Bard") &&
            parseInt(character.getClassLevel("Bard")) >= 6) {
                damages.push("1d6");
                damage_types.push("Spiritual Focus");
            }
    }

    // Druid
    if (character.hasClass("Druid")) {
        // Druid: Wildfire Druid: Enhanced Bond
        if (character.hasClassFeature("Enhanced Bond") &&
            character.getSetting("wildfire-spirit-enhanced-bond", false) &&
            damages.length > 0) {
            for (let i = 0; i < damages.length; i++){
                if (damage_types[i] === "Fire") {
                    damages.push("1d8");
                    damage_types.push("Enhanced Bond");
                    break;
                }
            }
        }
    }

    // Warlock
    if (character.hasClass("Warlock")) {
        // Warlock: The Celestial: Radiant Soul
        if (character.hasClassFeature("Radiant Soul") &&
            character.getSetting("warlock-the-celestial-radiant-soul", false) &&
            damages.length > 0) {
            for (let i = 0; i < damages.length; i++){
                if (damage_types[i] === "Fire" || damage_types[i] === "Radiant") {
                    damages.push(`${parseInt(character.getAbility("CHA").mod)}`);
                    damage_types.push("Radiant Soul");
                    break;
                }
            }
        }
    }

    // Wizard
    if (character.hasClass("Wizard")) {
        // Wizard: School of Evocation: Empowered Evocation
        if (character.hasClassFeature("Empowered Evocation") &&
            character.getSetting("empowered-evocation", false) &&
            spell_level.includes("Evocation") &&
            spell_source.includes("Wizard")) {
            damages.push(`${parseInt(character.getAbility("INT").mod)}`);
            damage_types.push("Empowered Evocation");
        }
    }
    
    // NOTE: Below this line are things that work on ALL damages, they should stay there
    // Artificer
    if (character.hasClass("Artificer")) {
        if (character.hasClassFeature("Alchemical Savant") &&
            character.getSetting("artificer-alchemical-savant", false) &&
            damages.length > 0) {
            const alchemical_savant_regex = /[0-9]+d[0-9]+/g;
            for (let i = 0; i < damages.length; i++){
                if ((damage_types[i] === "Acid" || damage_types[i] === "Fire" || damage_types[i] === "Necrotic" || damage_types[i] === "Poison") &&
                    alchemical_savant_regex.test(damages[i])) {
                    damages.push(`${character.getAbility("INT").mod < 2 ? 1 : character.getAbility("INT").mod}`);
                    damage_types.push("Alchemical Savant");
                    break;
                }
            }
        }
    }
    
    // Check for Draconic Sorcerer's Elemental Affinity;
    let elementalAffinity = null;
    for (let feature of character._class_features) {
        const match = feature.match("Elemental Affinity \\((.*)\\)") || feature.match("Elemental Affinity: (.*) Damage");
        if (match) {
            elementalAffinity = match[1];
            break;
        }
    }
    if (elementalAffinity && damage_types.includes(elementalAffinity)) {
        for (let ability of character._abilities) {
            if (ability[1] == "CHA" && ability[3] != "" && ability[3] != "0") {
                damages.push(ability[3]);
                damage_types.push(elementalAffinity + " (Elemental Affinity)");
            }
        }
    }
    
    // Check for Elemental Adept Feats
    const elementalAdepts = [];
    for (let feature of character._feats) {
        const match = feature.match("Elemental Adept \\((.*)\\)");
        if (match) {
            elementalAdepts.push(match[1]);
        }
    }
    for (let elementalAdept of elementalAdepts) {
        for (let i = 0; i < damages.length; i++) {
            if (damage_types[i] === elementalAdept) {
                damages[i] = damages[i].replace(/([0-9]*)d([0-9]+)([^\s+-]*)(.*)/g, (match, amount, faces, roll_mods, mods) => {
                    return new Array(parseInt(amount) || 1).fill(`1d${faces}${roll_mods}min2`).join(" + ") + mods;
                });
            }
        }
    }

    //Handle Flames of Phlegethos
    if (damages.length > 0 &&
        character.hasFeat("Flames of Phlegethos")) {
        for (i = 0; i < damages.length; i++) {
            if (damage_types[i] === "Fire")
                damages[i] = damages[i].replace(/[0-9]*d[0-9]+/g, "$&ro<=1");
        }
    }

}
    
function wayBeyond20HasScrollSpellcasting() {
    return character.hasClassFeature("Spellcasting: Scrolls", true);
}

function wayBeyond20GetSpellcastingModifier(source) {
    if (!source) return null;
    const modifier = character._spell_modifiers ? character._spell_modifiers[source] : null;
    if (modifier === null || modifier === undefined || modifier === "") return null;
    return parseInt(modifier);
}

function wayBeyond20GetSpellcastingAttack(source) {
    if (!source) return null;
    const attack = character._spell_attacks ? character._spell_attacks[source] : null;
    if (attack === null || attack === undefined || attack === "") return null;
    return `${attack}`;
}

function wayBeyond20GetSpellcastingSave(source) {
    if (!source) return null;
    const save = character._spell_saves ? character._spell_saves[source] : null;
    if (save === null || save === undefined || save === "") return null;
    return `${save}`;
}

function wayBeyond20LooksLikeSpellScroll(spell_source="", properties={}) {
    const searchable = [
        spell_source || "",
        properties["Source"] || "",
        properties["Item"] || "",
        properties["Type"] || "",
        properties["Notes"] || ""
    ].join(" ").toLowerCase();

    return searchable.includes("spell scroll") || searchable.includes("scroll");
}

function wayBeyond20NormalizeSpellcastingSource(source="") {
    return `${source || ""}`.replace(/\s+/g, " ").trim();
}

function wayBeyond20FindSpellcastingSourceFromText(text="") {
    const normalizedText = wayBeyond20NormalizeSpellcastingSource(text);
    if (!normalizedText) return null;

    const maps = [character._spell_modifiers || {}, character._spell_attacks || {}, character._spell_saves || {}];
    for (let spellMap of maps) {
        for (let source in spellMap) {
            if (!source || source === "Scrolls") continue;
            const normalizedSource = wayBeyond20NormalizeSpellcastingSource(source);
            if (!normalizedSource) continue;
            if (normalizedText === normalizedSource || normalizedText.includes(normalizedSource)) return source;
        }
    }

    return null;
}

function wayBeyond20SpellDescriptionUsesSpellcastingModifier(description="") {
    return `${description || ""}`.toLowerCase().includes("spellcasting ability modifier");
}

function wayBeyond20GetScrollSpellcastingChoices() {
    const choices = {};
    const modifiers = character._spell_modifiers || {};
    for (let source in modifiers) {
        if (modifiers[source] === null || modifiers[source] === undefined || `${modifiers[source]}` === "") continue;
        choices[source] = `${source} (${modifiers[source]})`;
    }
    return choices;
}

function wayBeyond20ScrollSpellcastingChoiceKey(spell_name="", spell_source="") {
    return `${spell_name || "Unknown Spell"}|${spell_source || "Unknown Source"}`.toLowerCase();
}

async function wayBeyond20ResolveSpellcastingSource(spell_name="", spell_source="", properties={}, settings_to_change={}) {
    const choices = wayBeyond20GetScrollSpellcastingChoices();
    const order = Object.keys(choices).sort((a, b) => {
        if (a === "Scrolls") return 1;
        if (b === "Scrolls") return -1;
        return a.localeCompare(b);
    });
    if (order.length === 0) return {cancelled: false, source: null};

    // WayBeyond20: First preserve D&D Beyond/Beyond20's normal class spellcasting path.
    // If the spell pane identifies a real spellcasting source, use that source and do
    // not let the UMD Scrolls fallback overwrite it.
    const explicitSource = wayBeyond20FindSpellcastingSourceFromText(spell_source) ||
        wayBeyond20FindSpellcastingSourceFromText(properties["Source"]) ||
        wayBeyond20FindSpellcastingSourceFromText(properties["Spellcasting"]) ||
        wayBeyond20FindSpellcastingSourceFromText(properties["Class"]);
    if (explicitSource) return {cancelled: false, source: explicitSource};

    const hasScrolls = Object.prototype.hasOwnProperty.call(choices, "Scrolls");
    const looksLikeScroll = wayBeyond20LooksLikeSpellScroll(spell_source, properties);

    // WayBeyond20: Use Magic Device creates a fallback spellcasting path for spells
    // being cast without any normal spellcasting source. This is intentionally general:
    // if the pane is a spell roll, no ordinary class source was detected, and UMD has
    // supplied Spellcasting: Scrolls, use that path instead of leaving the spellcasting
    // modifier effectively null/+0.
    if (hasScrolls && !looksLikeScroll) return {cancelled: false, source: "Scrolls"};

    if (order.length === 1) return {cancelled: false, source: order[0]};

    const choiceKey = wayBeyond20ScrollSpellcastingChoiceKey(spell_name, spell_source);
    const rememberedChoices = character.getSetting("waybeyond20-scroll-spellcasting-choices", {});
    const remembered = rememberedChoices[choiceKey];
    if (remembered && choices[remembered]) return {cancelled: false, source: remembered};

    const source = await dndbeyondDiceRoller.queryGeneric(
        "Spellcasting Ability",
        "Choose spellcasting ability",
        choices,
        "waybeyond20-scroll-spellcasting",
        order,
        remembered || order[0],
        {prefix: `${spell_name || "This spell"} can use more than one spellcasting path.`}
    );
    if (source === null) return {cancelled: true, source: null};

    settings_to_change["waybeyond20-scroll-spellcasting-choices"] = {
        ...rememberedChoices,
        [choiceKey]: source
    };
    return {cancelled: false, source};
}

function wayBeyond20ApplyScrollSpellcastingToRollInput(to_hit, properties={}, spellcasting_source=null) {
    if (!spellcasting_source) return to_hit;

    const spellAttack = wayBeyond20GetSpellcastingAttack(spellcasting_source);
    if (to_hit !== null && spellAttack !== null) {
        to_hit = spellAttack;
    }

    const spellSave = wayBeyond20GetSpellcastingSave(spellcasting_source);
    if (spellSave !== null && properties["Attack/Save"] !== undefined) {
        const saveParts = `${properties["Attack/Save"]}`.trim().split(/\s+/);
        if (saveParts.length >= 1) {
            properties["Attack/Save"] = `${saveParts[0]} ${spellSave}`;
        }
    }

    return to_hit;
}

function wayBeyond20ApplySpellcastingModifierToHealing(damages=[], damage_types=[], {spellcasting_source=null, description=""}={}) {
    if (!wayBeyond20SpellDescriptionUsesSpellcastingModifier(description)) return;
    const spellcastingModifier = wayBeyond20GetSpellcastingModifier(spellcasting_source);
    if (spellcastingModifier === null) return;

    for (let i = 0; i < damages.length; i++) {
        if (!String(damage_types[i] || "").includes("Healing")) continue;
        if (!/[0-9]*d[0-9]+/.test(damages[i])) continue;
        damages[i] = ensureModifier(damages[i], spellcastingModifier);
        damage_types[i] = damage_types[i] || "Healing";
        break;
    }
}

function wayBeyond20ApplySpellcastingModifierToDamage(damages=[], damage_types=[], {spellcasting_source=null, description=""}={}) {
    if (!wayBeyond20SpellDescriptionUsesSpellcastingModifier(description)) return;
    const spellcastingModifier = wayBeyond20GetSpellcastingModifier(spellcasting_source);
    if (spellcastingModifier === null) return;

    for (let i = 0; i < damages.length; i++) {
        if (!/[0-9]*d[0-9]+/.test(damages[i])) continue;
        if (String(damage_types[i] || "").includes("Healing")) continue;
        damages[i] = ensureModifier(damages[i], spellcastingModifier);
    }
}

function handleSpecialHealingSpells(spell_name, damages=[], damage_types=[], {spell_source="", spell_level="Cantrip", castas, settings_to_change, properties={}, spellcasting_source=null, description=""}={}) {
    wayBeyond20ApplySpellcastingModifierToHealing(damages, damage_types, {spellcasting_source, description});

    // Feat: Healer
    if (
        character.hasFeat("Healer 2024") &&
        character.getSetting("healer-rerolls-feat-2024", "false")
    ) {
        damages[0] = damages[0].replace(/[0-9]*d[0-9]+/g, "$&ro<=1")
    }

    // Artificer
    if (character.hasClass("Artificer")) {
        if (character.hasClassFeature("Alchemical Savant") &&
            character.getSetting("artificer-alchemical-savant", false)) {
            const alchemical_savant_regex = /[0-9]+d[0-9]+/g;
            for (let i = 0; i < damages.length; i++){
                if (damage_types[i] === "Healing" && alchemical_savant_regex.test(damages[i])) {
                    damages.push(`${character.getAbility("INT").mod < 2 ? 1 : character.getAbility("INT").mod}`);
                    damage_types.push("Alchemical Savant Healing");
                    break;
                }
            }
        }
    }

    // Bard
    if (character.hasClass("Bard")) {
        // Bard: College of Spirits: Spiritual Focus
        if (damages.length > 0 &&
            character.hasClassFeature("Spiritual Focus") &&
            character.getSetting("bard-spiritual-focus", false) &&
            spell_source.includes("Bard") &&
            parseInt(character.getClassLevel("Bard")) >= 6) {
                damages.push("1d6");
                damage_types.push("Spiritual Focus Healing");
            }
    }

    // Druid
    if (character.hasClass("Druid")) {    
        if (character.hasClassFeature("Enhanced Bond") &&
            character.getSetting("wildfire-spirit-enhanced-bond", false)) {
            for (let i = 0; i < damages.length; i++){
                if (damage_types[i] === "Healing") {
                    damages.push("1d8");
                    damage_types.push("Enhanced Bond Healing");
                    break;
                }
            }
        }
    }
    
    // Supreme Healing and Circle of Mortality must ALWAYS be at the end, as they max all healing dice
    if (character.hasClass("Cleric")) {
        if (character.hasClassFeature("Supreme Healing") ||
            (character.hasClassFeature("Circle of Mortality") &&
            character.getSetting("cleric-circle-of-mortality", false))) {
            for (let i = 0; i < damages.length; i++) {
                if (!damage_types[i].includes("Healing")) continue;
                damages[i] = damages[i].replace(/([0-9]*)d([0-9]+)?/, (match, dice, faces) => {
                    return String(parseInt(dice || 1) * parseInt(faces));
                });
            }
            if (character.hasClassFeature("Circle of Mortality")) {
                settings_to_change["cleric-circle-of-mortality"] = false;
            }
        }
    }
}

async function rollSpell(force_display = false, force_to_hit_only = false, force_damages_only = false) {
    const properties = propertyListToDict($(".ct-spell-pane .ct-spell-detail [role=list] > div"));
    //console.log("Properties are : " + String(properties));
    const spell_source = $(".ct-sidebar__header-parent").text() || $(".ct-sidebar__header > div").text();
    const spell_full_name = $(".ct-sidebar__heading .ct-spell-name,.ct-sidebar__heading .ddbc-spell-name, .ct-sidebar__heading span[class*='styles_spellName']").text();
    const spell_name = $(".ct-sidebar__heading .ct-spell-name,.ct-sidebar__heading .ddbc-spell-name, .ct-sidebar__heading span[class*='styles_spellName']")[0].firstChild.textContent;
    const description = descriptionToString(`.ct-spell-pane .ct-spell-detail__description, .ct-spell-pane div[class*='styles_description']`);
    const damage_modifiers = $(".ct-spell-pane .ct-spell-caster__modifiers--damages .ct-spell-caster__modifier--damage");
    const healing_modifiers = $(".ct-spell-pane .ct-spell-caster__modifiers--healing .ct-spell-caster__modifier--hp");
    const temp_hp_modifiers = $(".ct-spell-pane .ct-spell-caster__modifiers--healing .ct-spell-caster__modifier--temp");
    const castas = $(".ct-spell-caster__casting-level-current").text();
    const level = $(".ct-spell-pane .ct-spell-detail__level-school-item").toArray().map((i) => i.textContent).join(" ");
    const ritual = $(".ct-spell-pane .ct-spell-name__icon--ritual,.ct-spell-pane .ddbc-spell-name__icon--ritual, .ct-spell-pane .ct-sidebar__header-primary ddbc-ritual-icon").length > 0;
    let concentration = $(".ct-spell-pane .ct-spell-name__icon--concentration,.ct-spell-pane .ddbc-spell-name__icon--concentration, .ct-spell-pane .ct-sidebar__header-primary ddbc-concentration-icon").length > 0;
    let duration = properties["Duration"] || "";
    if (duration.includes("Concentration")) {
        duration = duration.replace("Concentration, ", "");
        concentration = true;
    } else {
        concentration = false;
    }

    const waybeyond20_talent = wayBeyond20ParseTalent({
        name: spell_name,
        kind: "spell",
        properties,
        description,
        level,
        castas,
        spell_source,
        concentration,
        duration
    });
    
    // Find the icon with the AoE effect (<i class="i-aoe-sphere">) and convert it to a word
    const range_shape = $(".ct-spell-pane .ct-spell-detail__properties .ct-spell-detail__range-shape .ddbc-aoe-type-icon");
    const aoe_class = (range_shape.attr("class") || "").split(" ").find(c => c.startsWith("ddbc-aoe-type-icon--"));
    // Remove class prefix and capitalize first letter
    const aoe_shape = aoe_class ? aoe_class.replace(/^ddbc-aoe-type-icon--(.)/, (_, g) => g.toUpperCase()) : undefined;

    let to_hit = properties["To Hit"] !== undefined && properties["To Hit"] !== "--" ? properties["To Hit"] : null;

    if (to_hit === null)
        to_hit = findToHit(spell_full_name, ".ct-combat-attack--spell,.ddbc-combat-attack--spell", ".ct-spell-name,.ddbc-spell-name,span[class*='styles_spellName']", ".ct-combat-attack__tohit,.ddbc-combat-attack__tohit");
    if (to_hit === null)
        to_hit = findToHit(spell_full_name, ".ct-spells-spell,.ddbc-spells-spell", ".ct-spell-name,.ddbc-spell-name,span[class*='styles_spellName']", ".ct-spells-spell__tohit,.ddbc-spells-spell__tohit");

    if (key_modifiers["display_attack"]) {
        force_display = true;
    }
    if (!force_display && (damage_modifiers.length > 0 || healing_modifiers.length > 0 || temp_hp_modifiers.length > 0 || to_hit !== null || properties["Attack/Save"] !== undefined)) {
        const damages = [];
        let damage_types = [];
        const settings_to_change = {}
        const waybeyond20_scroll_spellcasting = await wayBeyond20ResolveSpellcastingSource(spell_name, spell_source, properties, settings_to_change);
        if (waybeyond20_scroll_spellcasting.cancelled) return;
        to_hit = wayBeyond20ApplyScrollSpellcastingToRollInput(to_hit, properties, waybeyond20_scroll_spellcasting.source);
        
        for (let modifier of damage_modifiers.toArray()) {
            const dmg = $(modifier).find(".ct-spell-caster__modifier-amount,.ddbc-spell-caster__modifier-amount").text();
            const dmgtype = $(modifier).find(".ct-damage-type-icon .ct-tooltip,.ddbc-damage-type-icon .ddbc-tooltip").attr("data-original-title") || "";
            damages.push(dmg);
            damage_types.push(dmgtype);
        }

        addCustomDamages(character, damages, damage_types);

        // Capitalize all Damage Types to ensure consistency for later processing
        damage_types = damage_types.map(t => capitalize(t.trim()));

        if (damages.length > 0) {
            wayBeyond20ApplySpellcastingModifierToDamage(damages, damage_types, {spellcasting_source: waybeyond20_scroll_spellcasting.source, description});

            to_hit = handleSpecialGeneralAttacks(damages, damage_types, properties, settings_to_change, {to_hit, spell_name, spell_level: level});
        
            handleSpecialSpells(spell_name, damages, damage_types, {spell_level: level, spell_source, castas});
        }

        // We can then add healing types
        for (let modifier of healing_modifiers.toArray()) {
            let dmg = $(modifier).find(".ct-spell-caster__modifier-amount").text();
            if (dmg.startsWith("Regain "))
                dmg = dmg.slice(7);
            if (dmg.endsWith(" Hit Points"))
                dmg = dmg.slice(0, -11);
            if (dmg.length > 0) {
                damages.push(dmg);
                damage_types.push("Healing");
            }
        }

        // We can then add temp healing types
        for (let modifier of temp_hp_modifiers.toArray()) {
            let dmg = $(modifier).find(".ct-spell-caster__modifier-amount").text();
            if (dmg.startsWith("Regain "))
                dmg = dmg.slice(7);
            if (dmg.endsWith(" Temp Hit Points"))
                dmg = dmg.slice(0, -16);
            if (dmg.length > 0) {
                damages.push(dmg);
                damage_types.push("Temp HP");
            }
        }
        if (healing_modifiers.length > 0) {
            handleSpecialHealingSpells(spell_name, damages, damage_types, {spell_level: level, spell_source, castas, settings_to_change, properties, spellcasting_source: waybeyond20_scroll_spellcasting.source, description});
        }

        let critical_limit = 20;
        if (character.hasClassFeature("Hexblade’s Curse") &&
            character.getSetting("warlock-hexblade-curse", false))
            critical_limit = 19;
        if (spell_full_name === "Blade of Disaster")
            critical_limit = 18;
        const roll_properties = await buildAttackRoll(character,
            "spell",
            spell_name,
            description,
            properties,
            damages,
            damage_types,
            to_hit,
            0,
            force_to_hit_only,
            force_damages_only,
            {},
            settings_to_change);

        if (roll_properties === null) {
            // A query was cancelled, so let's cancel the roll
            return;
        }
        roll_properties["waybeyond20-talent"] = waybeyond20_talent;
        wayBeyond20ApplyBedsideMannerIntent(roll_properties);
        // If it's an AoE, then split the range property appropriately
        if (aoe_shape) {
            const [range, aoe] = properties["Range/Area"].split("/");
            roll_properties['range'] = range;
            roll_properties['aoe'] = aoe;
            roll_properties['aoe-shape'] = aoe_shape;
        }

        if (critical_limit != 20)
            roll_properties["critical-limit"] = critical_limit;
        const custom_critical_limit = parseInt(character.getSetting("custom-critical-limit", ""))
        if (custom_critical_limit) {
            roll_properties["critical-limit"] = custom_critical_limit;
            if (to_hit !== null)
                roll_properties["name"] += ` (CRIT${custom_critical_limit})`;
        }

        const spell_properties = {
            "level-school": level,
            "concentration": concentration,
            "duration": duration,
            "casting-time": properties["Casting Time"] || "",
            "components": properties["Components"] || "",
            "ritual": ritual
        }
        for (let key in spell_properties)
            roll_properties[key] = spell_properties[key];

        if (castas != "" && !level.startsWith(castas))
            roll_properties["cast-at"] = castas;

        let waybeyond20_spell_effect_update = null;
        if (!force_display && wayBeyond20ShouldTrackSpellEffect(concentration, duration)) {
            const waybeyond20_spell_effect = wayBeyond20BuildSpellEffect(character, spell_name, spell_source, level, castas, concentration, duration, properties, waybeyond20_talent);
            waybeyond20_spell_effect_update = await wayBeyond20ApplySpellEffectWithTargets(character, settings_to_change, waybeyond20_spell_effect, waybeyond20_talent);
            if (waybeyond20_spell_effect_update === null) return;
            roll_properties["waybeyond20-spell-effect"] = waybeyond20_spell_effect;
            if (concentration) roll_properties["waybeyond20-concentration"] = waybeyond20_spell_effect;
        }

        // Asssassinate: consider all rolls as critical;
        if (character.hasClassFeature("Assassinate") &&
            character.getSetting("rogue-assassinate", false)) {
            roll_properties["critical-limit"] = 1;
            roll_properties["advantage"] = RollType.OVERRIDE_ADVANTAGE;
            
            const isLocked = character.getSetting("rogue-assassinate-lock", false);
            if(!isLocked) settings_to_change["rogue-assassinate"] = false;
        }
        if (character.hasClassFeature("Assassinate 2024") &&
            character.getSetting("rogue-assassinate-2024", false)) {
            roll_properties["advantage"] = RollType.OVERRIDE_ADVANTAGE;

            const isLocked = character.getSetting("rogue-assassinate-lock", false);
            if(!isLocked) settings_to_change["rogue-assassinate-2024"] = false;
        }
        // Sorcerer: Clockwork Soul - Trance of Order
        if (character.hasClassFeature("Trance of Order") && character.getSetting("sorcerer-trance-of-order", false))
            roll_properties.d20 = "1d20min10";
        // Spells: Toll the Dead
        // HACK: using versatile to allow toll the dead to roll both damage types separate
        if(spell_full_name.toLowerCase() === "toll the dead" && character.getSetting("toll-choice") === "both")
            roll_properties["is_versatile"] = true;
        // Apply batched updates to settings, if any:
        if (Object.keys(settings_to_change).length > 0) {
            character.mergeCharacterSettings(settings_to_change, () => {
                if (waybeyond20_spell_effect_update) {
                    wayBeyond20SendEffectsUpdate(character, waybeyond20_spell_effect_update.activeEffects, waybeyond20_spell_effect_update.concentration);
                }
            });
        } else if (waybeyond20_spell_effect_update) {
            wayBeyond20SendEffectsUpdate(character, waybeyond20_spell_effect_update.activeEffects, waybeyond20_spell_effect_update.concentration);
        }
        if (!force_display && !force_damages_only) {
            wayBeyond20AttachActivationResource(roll_properties, properties, waybeyond20_talent, null, {
                name: spell_name,
                rollType: "spell-attack"
            });
        }
        return sendRollWithCharacter("spell-attack", damages[0] || "", roll_properties);
    } else {
        const roll_properties = {
            "name": spell_name,
            "level-school": level,
            "range": (properties["Range/Area"] || ""),
            "concentration": concentration,
            "duration": duration,
            "casting-time": (properties["Casting Time"] || ""),
            "components": (properties["Components"] || ""),
            "ritual": ritual,
            "description": description,
            "waybeyond20-talent": waybeyond20_talent
        }
        // If it's an AoE, then split the range property appropriately
        if (aoe_shape) {
            const [range, aoe] = properties["Range/Area"].split("/");
            roll_properties['range'] = range;
            roll_properties['aoe'] = aoe;
            roll_properties['aoe-shape'] = aoe_shape;
        }
        if (castas != "" && !level.startsWith(castas))
            roll_properties["cast-at"] = castas;
        if (!force_display && wayBeyond20ShouldTrackSpellEffect(concentration, duration)) {
            const settings_to_change = {};
            const waybeyond20_spell_effect = wayBeyond20BuildSpellEffect(character, spell_name, spell_source, level, castas, concentration, duration, properties, waybeyond20_talent);
            const waybeyond20_spell_effect_update = await wayBeyond20ApplySpellEffectWithTargets(character, settings_to_change, waybeyond20_spell_effect, waybeyond20_talent);
            if (waybeyond20_spell_effect_update === null) return;
            roll_properties["waybeyond20-spell-effect"] = waybeyond20_spell_effect;
            if (concentration) roll_properties["waybeyond20-concentration"] = waybeyond20_spell_effect;
            character.mergeCharacterSettings(settings_to_change, () => {
                wayBeyond20SendEffectsUpdate(character, waybeyond20_spell_effect_update.activeEffects, waybeyond20_spell_effect_update.concentration);
            });
        }
        if (!force_display && !force_damages_only) {
            wayBeyond20AttachActivationResource(roll_properties, properties, waybeyond20_talent, null, {
                name: spell_name,
                rollType: "spell-card"
            });
        }
        return sendRollWithCharacter("spell-card", 0, roll_properties);
    }
}

async function displayItem() {
    return rollItem(true);
}

async function displaySpell() {
    return rollSpell(true);
}

function displayFeature(paneClass) {
    const source_types = {
        "b20-class-feature-pane": "Class",
        "ct-racial-trait-pane": "Race",
        "b20-racial-trait-pane": "Race",
        "b20-feat-pane": "Feat"
    }
    const name = $(".ct-sidebar__heading").text();
    const source = $(".ct-sidebar__header-parent").text();
    const source_type = source_types[paneClass];
    let description = descriptionToString(`.${paneClass} .ct-snippet__content,.${paneClass} .ddbc-snippet__content, .${paneClass} div[class*='styles_description']`);
    const choices = $(`.${paneClass} .ct-feature-snippet__choices .ct-feature-snippet__choice`);
    if (choices.length > 0) {
        description += "\n";
        for (const choice of choices.toArray()) {
            const choiceText = descriptionToString(choice);
            description = `${description}\n> ${choiceText}`;
        }
    }
    return sendRollWithCharacter("trait", 0, {
        "name": name,
        "source": source,
        "source-type": source_type,
        "description": description
    });
}

function displayTrait() {
    const trait = $(".ct-sidebar__heading").text();
    const description = descriptionToString(".ct-trait-pane__input, .ct-trait-pane textarea, .ct-trait-pane div[class*='styles_description']");
    return sendRollWithCharacter("trait", 0, {
        "name": trait,
        "description": description
    });
}

function displayBackground() {
    const background = $(".ct-sidebar__heading").text();
    const description = descriptionToString(".ct-background-pane__description > p, div[class*='styles_pane'] .ddbc-html-content > p");
    return sendRollWithCharacter("trait", 0, {
        name: background,
        source: "Background",
        description: description
    });
}

function displayAction(paneClass) {
    const action_name = $(".ct-sidebar__heading").text();
    const description = descriptionToString(`.ct-action-detail__description, .${paneClass} div[class*='styles_description']`);
    return sendRollWithCharacter("trait", 0, {
        "name": action_name,
        "description": description,
        "source-type": "action"
    });
}

function displayInfusion() {
    const infusion = $(".ct-sidebar__heading").text();
    const description = descriptionToString(".ct-infusion-choice-pane__description, .ct-infusion-choice-pane div[class*='styles_description']");
    return sendRollWithCharacter("trait", 0, {
        "name": infusion,
        "description": description,
        "item-type": "Infusion",
    });
}
function displayProficiencies(group) {
    const label = $(group).find(".ct-proficiency-groups__group-label").text().trim();
    const proficiencies = $(group).find(".ct-proficiency-groups__group-items").text().trim();
    return sendRollWithCharacter("trait", 0, {
        "name": label,
        "source-type": "Proficiency",
        "description": proficiencies
    });
}

function handleCustomText(paneClass) {
    const customRolls = {
        before: [],
        replace:[],
        after:  []
    };
    // Relative to normal roll msg
    const rollOrderTypes = ["before", "after", "replace"];
    const pane = $(`.${paneClass}`);
    const notes = descriptionToString(pane.find("[role=list] > div:contains('Note')"));
    const description = descriptionToString(pane.find(".ct-action-detail__description, .ct-spell-detail__description, .ct-item-detail__description, .ddbc-action-detail__description, .ddbc-spell-detail__description, .ddbc-item-detail__description, div[class*='styles_description']"));

    // Look for all the roll orders
    for (const rollOrder of rollOrderTypes) {
        // Use global, multiline and dotall flags
        try {
            const regexp = new RegExp(`\\[\\[${rollOrder}\\]\\]\\s*(.+?)\\s*\\[\\[/${rollOrder}\\]\\]`, "gms");
            const matches = [...notes.matchAll(regexp), ...description.matchAll(regexp)];
            customRolls[rollOrder] = matches.map(([match, content]) => content)
        } catch (err) {
            // Ignore errors that might be caused by DOTALL regexp flag not being supported by the browser
        }
    }
    
    return customRolls;
}

async function execute(paneClass, {force_to_hit_only = false, force_damages_only = false, force_versatile = false, spell_group=null}={}) {
    console.log("WayBeyond20: Executing panel : " + paneClass, force_to_hit_only, force_damages_only, force_versatile);
    const rollCustomText = async (customTextList) => {
        for (const customText of customTextList) {
            await sendRollWithCharacter("chat-message", 0, {
                name: "",
                message: customText
            });
        }
     };
     
    const customTextRolls = handleCustomText(paneClass);
    await rollCustomText(customTextRolls.before);
    if (customTextRolls.replace.length > 0) {
        await rollCustomText(customTextRolls.replace);
    } else {
        try {
            pauseHotkeyHandling();
            if (["ct-skill-pane", "ct-custom-skill-pane"].includes(paneClass))
                await rollSkillCheck(paneClass);
            else if (paneClass == "b20-ability-pane")
                await rollAbilityCheck();
            else if (paneClass == "b20-ability-saving-throws-pane")
                await rollSavingThrow();
            else if (paneClass == "b20-initiative-pane")
                await rollInitiative();
            else if (paneClass == "b20-item-pane")
                await rollItem(false, force_to_hit_only, force_damages_only, force_versatile, spell_group);
            else if (["b20-action-pane", "ct-custom-action-pane", "b20-custom-action-pane"].includes(paneClass))
                await rollAction(paneClass, force_to_hit_only, force_damages_only);
            else if (paneClass == "ct-spell-pane")
                await rollSpell(false, force_to_hit_only, force_damages_only);
            else
                await displayPanel(paneClass);
        } finally {
            resumeHotkeyHandling();
        }
    }
    await rollCustomText(customTextRolls.after);
}

function displayPanel(paneClass) {
    console.log("WayBeyond20: Displaying panel : " + paneClass);
    try {
        pauseHotkeyHandling();
        if (paneClass == "b20-item-pane")
            return displayItem();
        else if (paneClass == "ct-infusion-choice-pane")
            return displayInfusion();
        else if (paneClass == "ct-spell-pane")
            return displaySpell();
        else if (["b20-class-feature-pane", "ct-racial-trait-pane", "b20-racial-trait-pane", "b20-feat-pane"].includes(paneClass))
            return displayFeature(paneClass);
        else if (paneClass == "ct-trait-pane")
            return displayTrait();
        else if (["b20-action-pane", "ct-custom-action-pane", "b20-custom-action-pane"].includes(paneClass))
            return displayAction(paneClass);
        else if (paneClass == "b20-background-pane")
            return displayBackground();
        else
            alertify.alert("Not recognizing the currently open sidebar");
    } finally {
        resumeHotkeyHandling();
    }
}

function findModifiers(character, custom_roll) {
    const sibling = custom_roll.nextSibling;
    if (sibling && sibling.nodeName == "#text") {
        const strong = $(custom_roll).find("strong");
        const img = $(custom_roll).find("img");
        let roll_formula = img.attr("x-beyond20-roll");
        let text = sibling.textContent;
        let text_len = 0;
        while (text_len != text.length) {
            // If text length changes, we can check again for another modifier;
            text_len = text.length;

            find_static_modifier = (name, value, { add_your = true } = {}) => {
                // Define the modifier strings to check
                const mod_strings = add_your 
                    ? [` + your ${name}`, ` plus your ${name}`] 
                    : [name];
                
                for (const mod_string of mod_strings) {
                    if (text.toLowerCase().startsWith(mod_string)) {
                        strong.append(text.substring(0, mod_string.length));
                        roll_formula += " + " + value;
                        text = text.substring(mod_string.length);
                        break; // Exit loop once a match is found
                    }
                }
            };

            for (let ability of character._abilities)
                find_static_modifier(ability[0].toLowerCase() + " modifier", ability[3]);
            for (let class_name in character._classes) {
                const half_level = Math.min(1, Math.floor(character._classes[class_name] / 2));
                find_static_modifier(class_name.toLowerCase() + " level", character._classes[class_name]);
                find_static_modifier(" + half your " + class_name.toLowerCase() + " level", half_level, {add_your: false});
            }
            find_static_modifier("proficiency bonus", character._proficiency);
            find_static_modifier(" + PB", character._proficiency, { add_your: false });
            find_static_modifier("ac", character._ac);
            find_static_modifier("armor class", character._ac);

            find_spell_modifier = (suffix, obj) => {
                let default_spell_mod = null;
                for (let class_name in obj) {
                    default_spell_mod = default_spell_mod === null ? obj[class_name] : default_spell_mod;
                    find_static_modifier(class_name.toLowerCase() + " " + suffix, obj[class_name]);
                }
                if (default_spell_mod)
                    find_static_modifier(suffix, default_spell_mod);
            }
            find_spell_modifier("spell modifier", character._spell_modifiers);
            find_spell_modifier("spell attack", character._spell_attacks);
            find_spell_modifier("spell save dc", character._spell_saves);
            find_spell_modifier("save dc", character._spell_saves);
        }

        if (sibling.textContent !== text) {
            sibling.textContent = text;
            img.attr("x-beyond20-roll", roll_formula);
        }
    }
}


function checkAndInjectDiceToRolls(selector, name = "") {
    if (!settings["subst-dndbeyond"])
        return;

    const added = injectDiceToRolls(selector, character, name);

    // Don't parse if nothing new was added
    if (added === 0) return;

    for (const custom_roll of $(selector).find(".ct-beyond20-custom-roll").toArray()) {
        findModifiers(character, custom_roll);
    }
}

function addRollButtonEx(paneClass, where, options) {
    addRollButton(character, () => execute(paneClass), where, options);
}

function addDisplayButtonEx(paneClass, where, options) {
    addDisplayButton(() => displayPanel(paneClass), where, options);
}

var lastItemName = "";
var lastSpellName = "";
var lastSpellLevel = "";
function injectRollButton(paneClass) {
    const pane = $(`.${paneClass}`);
    if (["ct-custom-skill-pane",
        "ct-skill-pane",
        "b20-ability-pane",
        "b20-ability-saving-throws-pane",
        "b20-initiative-pane"].includes(paneClass)) {
        if (isRollButtonAdded())
            return;
        addRollButtonEx(paneClass, ".ct-sidebar__heading");
    } else if (["b20-class-feature-pane", "ct-racial-trait-pane", "b20-racial-trait-pane", "b20-feat-pane"].includes(paneClass)) {
        if (isRollButtonAdded())
            return;
        addRollButtonEx(paneClass, ".ct-sidebar__heading", { image: false });
        const name = $(".ct-sidebar__heading").text();
        checkAndInjectDiceToRolls("." + paneClass + " .ct-snippet__content,." + paneClass + " .ddbc-snippet__content", name);
    } else if (paneClass === "b20-background-pane") {
        if (isRollButtonAdded())
            return;
        addRollButtonEx(paneClass, ".ct-sidebar__heading", { image: false });
        const name = $(".ct-sidebar__heading").text();
        checkAndInjectDiceToRolls(`.${paneClass} .ct-background-pane__description, div[class*='styles_pane'] .ddbc-html-content`, name);
    } else if (paneClass == "ct-trait-pane") {
        if (isRollButtonAdded())
            return;
        addRollButtonEx(paneClass, ".ct-sidebar__heading", { image: false });
    } else if (paneClass == "b20-item-pane") {
        const item_name = $(".b20-item-pane .ct-sidebar__heading .ct-item-name,.b20-item-pane .ct-sidebar__heading .ddbc-item-name, .b20-item-pane .ct-sidebar__heading span[class*='styles_itemName']").text();
        if (isRollButtonAdded() && item_name == lastItemName)
            return;
        lastItemName = item_name;
        removeRollButtons(pane);

        checkAndInjectDiceToRolls(".ct-item-detail__description", item_name);
        const properties = propertyListToDict($(".b20-item-pane .ct-item-detail [role=list] > div"));
        if (Object.keys(properties).includes("Damage")) {
            addRollButtonEx(paneClass, ".ct-sidebar__heading", { small: true });
            addDisplayButtonEx(paneClass, ".ct-sidebar__header .ct-beyond20-roll");
            const spell_damage_groups = $(".b20-item-pane .ct-item-detail__spell-damage-group");
            for (const group of spell_damage_groups.toArray()) {
                const header = $(group).find(".ct-item-detail__spell-damage-group-header");
                addRollButton(character, () => execute(paneClass, {spell_group: group}), header, {small: true, append: true});
            }
        } else {
            const item_type = $(".ct-item-detail__intro").text().trim().toLowerCase();
            const item_tags = $(".ct-item-detail__tags-list .ct-item-detail__tag").toArray().map(elem => elem.textContent);
            const is_tool = isItemATool(item_name, item_type);
            const is_instrument =  item_tags.includes("Instrument");
            if (is_tool || is_instrument) {
                addRollButtonEx(paneClass, ".ct-sidebar__heading", { small: true, text: `Use ${is_tool? "Tool" : "Instrument"}` });
                addDisplayButtonEx(paneClass, ".ct-sidebar__header .ct-beyond20-roll");
            } else {
                addDisplayButtonEx(paneClass, ".ct-sidebar__heading", { append: false, small: false });
            }
            addRollButtonEx(paneClass, ".ct-item-detail__actions", { small: true, append: true, image: false });
        }
    } else if (paneClass == "ct-infusion-choice-pane") {
        const infusion_name = $(".ct-infusion-choice-pane .ct-sidebar__heading").text();
        if (isRollButtonAdded() && infusion_name == lastItemName)
            return;
        lastItemName = infusion_name;
        removeRollButtons(pane);

        checkAndInjectDiceToRolls(".ct-infusion-choice-pane__description", infusion_name);
        addDisplayButtonEx(paneClass, ".ct-sidebar__heading", { append: false, small: false });
    } else if (["b20-action-pane", "ct-custom-action-pane", "b20-custom-action-pane"].includes(paneClass)) {
        if (isRollButtonAdded())
            return;

        const properties = propertyListToDict($(`.${paneClass} [role=list] > div, .${paneClass} .ct-action-detail [role=list] > div`));
        const action_name = $(".ct-sidebar__heading").text();
        const action_parent = $(".ct-sidebar__header-parent").text();
        const to_hit = properties["To Hit"] !== undefined && properties["To Hit"] !== "--" ? properties["To Hit"] : null;
        if (action_name == "Superiority Dice" || action_parent == "Maneuvers" ||
            action_name == "Bardic Inspiration" || action_parent == "Blade Flourish" ||
            action_name.includes("Blood Curse of the Eyeless") ||
            (properties["Damage"] !== undefined || to_hit !== null || properties["Attack/Save"] !== undefined)) {
            addRollButtonEx(paneClass, ".ct-sidebar__heading", { small: true });
            addDisplayButtonEx(paneClass, ".ct-sidebar__header .ct-beyond20-roll");
        } else {
            addRollButtonEx(paneClass, ".ct-sidebar__heading");
        }
        checkAndInjectDiceToRolls(".ct-action-detail__description,.ddbc-action-detail__description", action_name);
    } else if (paneClass == "ct-spell-pane") {
        const spell_name = $(".ct-sidebar__heading .ct-spell-name,.ct-sidebar__heading .ddbc-spell-name, .ct-sidebar__heading span[class*='styles_spellName']")[0].firstChild.textContent;
        const spell_full_name = $(".ct-sidebar__heading .ct-spell-name,.ct-sidebar__heading .ddbc-spell-name, .ct-sidebar__heading span[class*='styles_spellName']").text();
        const spell_level = $(".ct-spell-caster__casting-level-current").text();
        if (isRollButtonAdded() && spell_full_name == lastSpellName && spell_level == lastSpellLevel)
            return;
        lastSpellName = spell_full_name;
        lastSpellLevel = spell_level;
        removeRollButtons(pane);
        checkAndInjectDiceToRolls(".ct-spell-pane .ct-spell-detail__description", spell_name);

        const damages = $(".ct-spell-pane .ct-spell-caster__modifiers--damages .ct-spell-caster__modifier");
        const healings = $(".ct-spell-pane .ct-spell-caster__modifiers--healing .ct-spell-caster__modifier");
        const properties = propertyListToDict($(".ct-spell-pane .ct-spell-detail [role=list] > div"));
        let to_hit = properties["To Hit"] !== undefined && properties["To Hit"] !== "--" ? properties["To Hit"] : null;
        if (to_hit === null)
            to_hit = findToHit(spell_full_name, ".ct-combat-attack--spell,.ddbc-combat-attack--spell", ".ct-spell-name,.ddbc-spell-name,span[class*='styles_spellName']", ".ct-combat-attack__tohit,.ddbc-combat-attack__tohit");
        if (to_hit === null)
            to_hit = findToHit(spell_full_name, ".ct-spells-spell,.ddbc-spells-spell", ".ct-spell-name,.ddbc-spell-name,span[class*='styles_spellName']", ".ct-spells-spell__tohit,.ddbc-spells-spell__tohit");

        if (damages.length > 0 || healings.length > 0 || to_hit !== null || properties["Attack/Save"] !== undefined) {
            addRollButtonEx(paneClass, ".ct-sidebar__heading", { text: "Cast on VTT", small: true });
            addDisplayButtonEx(paneClass, ".ct-sidebar__header .ct-beyond20-roll");
        } else {
            //addRollButtonEx(paneClass, ".ct-sidebar__heading", text="Cast on VTT", image=false);
            addDisplayButtonEx(paneClass, ".ct-sidebar__heading", { append: false, small: false });
        }

        if (spell_name == "Animate Objects") {
            const rows = $(".ct-spell-detail__description table tbody tr,.ddbc-spell-detail__description table tbody tr");
            for (let row of rows.toArray()) {
                const size = $(row).find("td").eq(0);
                const desc = $(row).find("td").eq(5);

                const m = desc.text().match(/(\+[0-9]+) to hit, ([0-9]*d[0-9]+(?:\s*[-+]\s*[0-9]+)) damage/)
                if (m) {
                    const to_hit = m[1];
                    const dmg = m[2];
                    //console.log("Match for ", size, " : ", to_hit, dmg);
                    const sizeStr = size.text().trim();

                    const id = addRollButton(character, async () => {
                        const props = await buildAttackRoll(character,
                            "action",
                            spell_name + " (" + sizeStr + ")",
                            sizeStr + " animated object",
                            {},
                            [dmg],
                            ["Bludgeoning"], to_hit);
                        if (props) {
                            sendRollWithCharacter("attack", "1d20" + to_hit, props);
                        }
                    }, size, { small: true, append: true, image: false, text: "Attack" });
                    $(`#${id}`).css({ "float": "", "text-align": "" });
                }
            }
        }

        $(".ct-spell-caster__casting-action > button,.ddbc-spell-caster__casting-action > button").off('click').on('click', (event) => {
            execute(paneClass);
        });
    } else if (paneClass == "ct-reset-pane") {
        const hitdice = $(".ct-reset-pane__hitdie");
        if (hitdice.length > 0) {
            if (isHitDieButtonAdded())
                return;
            removeRollButtons(pane);
            addHitDieButtons(rollHitDie);
        } else {
            if (!isHitDieButtonAdded())
                return
            removeRollButtons(pane);
        }
    } else if (paneClass == "b20-health-manage-pane") {
        const deathsaves = $(".b20-health-manage-pane .ct-health-manager__deathsaves, .b20-health-manage-pane div[class*='styles_deathSavesGroups']");
        if (deathsaves.length > 0) {
            if (isRollButtonAdded(deathsaves) || isCustomRollIconsAdded(deathsaves))
                return;
            
            // Check for Advantage/Disadvantage Badges, as Lineages: Reborn advantage on Death Saves or similar will supply
            const skill_badge_adv = $(".b20-health-manage-pane .ct-health-manager__deathsaves .ddbc-advantage-icon, .b20-health-manage-pane div[class*='styles_diceAdjustments'] span[class*='ddbc-advantage-icon']").length > 0;
            const skill_badge_disadv = $(".b20-health-manage-pane .ct-health-manager__deathsaves .ddbc-disadvantage-icon, .b20-health-manage-pane div[class*='styles_diceAdjustments'] span[class*='ddbc-disadvantage-icon']").length > 0;
            let deathSaveRollType = RollType.NORMAL;
            if (skill_badge_adv && skill_badge_disadv) {
                deathSaveRollType = RollType.QUERY;
            } else if (skill_badge_adv) {
                deathSaveRollType = RollType.OVERRIDE_ADVANTAGE;
            } else if (skill_badge_disadv) {
                deathSaveRollType = RollType.OVERRIDE_DISADVANTAGE;
            }
            
            addIconButton(character, () => {
                const adjustments = $(".ct-saving-throws-box__info .ct-dice-adjustment-summary");
                let modifier = "";
                // Aura of protection grants bonus to saves and is listed as an adjustment
                // but it should not apply when the character is unconscious
                let removeAuraOfProtection = character.hasClassFeature("Aura of Protection");
                for (const adjustment of adjustments.toArray()) {
                    const desc = $(adjustment).find(".ct-dice-adjustment-summary__description").text().trim();
                    if (desc !== "on saves") continue;
                    const pos = $(adjustment).find(".ddbc-bonus-positive-svg").length > 0;
                    const amount = parseInt($(adjustment).find(".ct-dice-adjustment-summary__value").text().trim()) || 0;
                    if (!amount) continue;
                    if (removeAuraOfProtection && amount === Math.max(character.getAbility("CHA").mod, 1)) {
                        removeAuraOfProtection = false;
                        continue;
                    }
                    modifier += `${pos ? "+" : "-"} ${amount} `;
                }
                if (character.hasClassFeature("Diamond Soul") && character.getSetting("monk-diamond-soul", false)) {
                    modifier += `+ ${parseInt(character._proficiency)} `;
                }
                sendRollWithCharacter("death-save", "1d20" + modifier, {
                    "modifier": modifier,
                    "advantage": deathSaveRollType
                })
            }, ".b20-health-manage-pane div[class*='styles_deathSavesGroups'] div[class*='styles_container']:first", { custom: true });
        }
    } else if (paneClass == "b20-creature-pane") {
        if (isRollButtonAdded() || isCustomRollIconsAdded()) {
            if (creature)
                creature.updateInfo();
            return;
        }
        const base = ".b20-creature-pane div[class*='styles_block']";
        const creatureType = $(".ct-sidebar__header > div:first-child").text();
        creature = new MonsterExtras("Creature", base, settings, {creatureType, character});
        creature.parseStatBlock();
        creature.updateInfo();
    } else if (paneClass == "ct-vehicle-pane") {
        if (isRollButtonAdded() || isCustomRollIconsAdded())
            return;
        const base = $(".ct-vehicle-block").length > 0 ? ".ct-vehicle-block" : ".ddbc-vehicle-block";
        monster = new Monster("Extra-Vehicle", base, settings, {character});
        monster.parseStatBlock();
    } else if (paneClass == "ct-condition-manage-pane") {
        const j_conditions = $(".ct-condition-manage-pane .ct-toggle-field--enabled,.ct-condition-manage-pane .ddbc-toggle-field--is-enabled, .ct-condition-manage-pane button[class*='styles_toggle'][class*='styles_checked']").closest(".ct-condition-manage-pane__condition");
        let exhaustion_level = $(".ct-condition-manage-pane__condition--special .ct-number-bar__option--active,.ct-condition-manage-pane__condition--special .ddbc-number-bar__option--active, .ct-condition-manage-pane__condition--special button[class*='styles_bar'][class*='styles_active']").text();
        const conditions = [];
        for (let cond of j_conditions.toArray()) {
            const condition_name = $(cond).find(".ct-condition-manage-pane__condition-name").text();
            conditions.push(condition_name);
        }
        if (exhaustion_level == "")
            exhaustion_level = 0;
        else
            exhaustion_level = parseInt(exhaustion_level);

        character.updateConditions(conditions, exhaustion_level);
        removeRollButtons(pane);
    } else if (paneClass == "ct-proficiencies-pane") {
        const proficiencies = $(".ct-proficiencies-pane .ct-proficiency-groups .ct-proficiency-groups__group");
        if (isRollButtonAdded())
            return;
        for (const group of proficiencies.toArray()) {
            addRollButton(character, () => displayProficiencies(group), group, { small: true, prepend: true, image: false });
        }
    } else if (paneClass == "b20-character-manage-pane") {
        const avatar = $(".b20-character-manage-pane .ddbc-character-avatar__portrait");
        const char_name = $(".b20-character-manage-pane div[class*='styles_characterName'] h1").text().trim();
        const avatar_link = avatar.attr("src");
        if (!avatar_link || isRollButtonAdded())
            return;
        const button = addDisplayButton(() => sendRoll(character, "avatar", avatar_link, { "name": char_name }), avatar, { small: true, append: false, image: false });
        $(button).css({"text-align": "center"});
    } else {
        removeRollButtons(pane);
    }
}


function injectRollToSpellAttack() {
    const groups = $(".ct-spells-level-casting__info-group,.ddbc-spells-level-casting__info-group");

    for (let group of groups.toArray()) {
        const label = $(group).find(".ct-spells-level-casting__info-label,.ddbc-spells-level-casting__info-label");
        if (label.text() == "Spell Attack") {
            if (label.hasClass("beyond20-rolls-added"))
                return;
            label.addClass("beyond20-rolls-added");
            const icon = chrome.runtime.getURL("images/icons/badges/spell20.png");
            const items = $(group).find(".ct-spells-level-casting__info-item,.ddbc-spells-level-casting__info-item");
            for (let item of items.toArray()) {
                const modifier = item.textContent;
                let name = "Spell Attack";
                if (items.length > 1)
                    name += "(" + item.getAttribute("data-original-title") + ")";
                const img = E.img({
                    class: "ct-beyond20-spell-attack-icon ct-beyond20-spell-attack",
                    'x-beyond20-name': name, 'x-beyond20-modifier': modifier, src: icon
                });
                item.append(img);
            }
            $(".ct-beyond20-spell-attack-icon").css("margin-left", "3px");
            $(".ct-beyond20-spell-attack").on('click', (event) => {
                const name = $(event.currentTarget).attr("x-beyond20-name");
                const mod = $(event.currentTarget).attr("x-beyond20-modifier");
                sendRollWithCharacter("spell-attack", "1d20" + mod, {
                    name: name,
                    "to-hit": mod,
                    rollAttack: true,
                    description: "Spell Attack",
                    components: ""
                });
            });
        }
    }
}

function injectRollToSnippets() {
    const groups = $(`.ct-actions .ct-actions-list .ct-actions-list__activatable .ct-feature-snippet,
                        .ct-actions div[class*='styles_activatable'] .ct-feature-snippet,
                        .ct-features .ct-class-detail .ct-feature-snippet, .ct-features .ct-feature-snippet--class,
                        .ct-features .ct-race-detail .ct-feature-snippet, .ct-features .ct-feature-snippet--racial-trait,
                        .ct-features .ct-feats-detail .ct-feature-snippet, .ct-features .ct-feature-snippet--feat`);
                        
    for (let group of groups.toArray()) {
        const snippet = $(group);
                
        // Not the most optimal, but avoids double-adding dice. Problem is that the dice get cleared out by
        // DDB when a panel is opened, so we can't mark the snippet itself with a custom class, as that doesn't
        // get modified.
        if (snippet.find(".ct-beyond20-custom-roll").length > 0)
            continue;

        const name = snippet.find(".ct-feature-snippet__heading, div[class*='styles_heading']")[0].childNodes[0].textContent.trim();
        const content = snippet.find(".ct-feature-snippet__content, div[class*='styles_content']");
        checkAndInjectDiceToRolls(content, name);
        // DDB now displays tooltips on the modifiers, so it's not "1d4+3" it's "1d4<span>+3</span>" which causes
        // WayBeyond20 to see it as two separate formulas, a "1d4" and a "+3" which rolls as "1d20 + 3"
        // We need to find these and fix them manually
        const customRolls = content.find(".ct-beyond20-custom-roll");
        for (const customRoll of customRolls.toArray()) {
            const leftFormula = customRoll.textContent || "";
            let modifier = customRoll.nextSibling;
            let operator = "";
            if (!modifier) {
                // Handle the use case of both left and right formulas having a modifier tooltip
                const closestTooltip = $(customRoll).closest(".ddbc-tooltip");
                // Ensure we got the right setup of "<ddbc-tooltip><custom roll></ddbc-tooltip><ddbc-tooltip><custom roll></ddbc-tooltip>"
                if (leftFormula.trim() === closestTooltip.text().trim()) {
                    modifier = closestTooltip[0].nextSibling;
                }
            }
            if (!modifier) {
                // Handle the use case of <strong>1d6</strong>+6
                const parent = customRoll.parentElement;
                if (parent && parent.nodeName === "STRONG" && parent.textContent.trim() === leftFormula) {
                    modifier = parent.nextSibling;
                }
            }
            if (modifier && modifier.nodeName === "#text" &&
                ["+", "-", ""].includes(modifier.textContent.trim())) {
                operator = modifier.textContent.trim();
                modifier = modifier.nextSibling;
            }
            if (!modifier ||
                modifier.nodeName !== "SPAN" ||
                !modifier.classList.contains("ddbc-tooltip")) continue;
            // We found one! Let's grab the formula from both and replace the calculated one
            let rightFormula = modifier.textContent || "";
            if ($(modifier).find("span > u.ct-beyond20-custom-roll").length === 0) {
                // Handle the use case of <roll> + <tooltip>5</tooltip>
                if (!operator || !rightFormula.match(/[0-9]+/)) continue;
                rightFormula = `${operator}${rightFormula}`;
            } else {
                // Ensure we got the right setup of "<custom roll><ddbc-tooltip><custom roll></ddbc-tooltip>"
                if (rightFormula.trim() !== $(modifier).find("u.ct-beyond20-custom-roll").text()) continue;
                $(customRoll).find("img.ct-beyond20-custom-icon").hide();
            }
            
            const formula = `${leftFormula}${rightFormula}`;
            $(customRoll).find("img.ct-beyond20-custom-icon").attr("x-beyond20-roll", formula)
            $(modifier).find("img.ct-beyond20-custom-icon").attr("x-beyond20-roll", formula);
        }
    }

}
function showHotkeysList(popup) {
    popup.removeClass('beyond20-hotkeys-hidden');
}
function hideHotkeysList(popup) {
    popup.addClass('beyond20-hotkeys-hidden');
}

function injectSettingsButton() {
    if ($(".ct-beyond20-settings").length > 0)
        return;

    const desktop_gap = $(".ct-character-header-desktop__group--gap");
    const tablet_gap = $(".ct-character-header-tablet__group--gap");
    const mobile_gap = $(".ct-character-header-mobile__group--gap");

    let button_type = null;
    let gap = null;
    let span_text = "WayBeyond20";
    let icon = chrome.runtime.getURL("images/icons/badges/normal20.png");
    if (desktop_gap.length > 0) {
        button_type = "desktop";
        gap = desktop_gap;
    } else if (tablet_gap.length > 0) {
        button_type = "tablet";
        gap = tablet_gap;
    } else if (mobile_gap.length > 0) {
        button_type = "mobile";
        gap = mobile_gap;
        span_text = "\u00A0\u00A0"; // Add 2 non breaking spaces as padding;
        icon = chrome.runtime.getURL("images/icons/badges/normal32.png");
    } else {
        return;
    }

    const button = E.div({ class: "ct-character-header-" + button_type + "__group ct-character-header-" + button_type + "__group--beyond20" },
        E.div({ class: "ct-character-header-" + button_type + "__button ct-beyond20-settings-button" },
            E.img({ class: "ct-beyond20-settings", src: icon }),
            E.span({ class: "ct-character-header-" + button_type + "__button-label" }, span_text)
        )
    );

    gap.after(button);
    $(button).on('click', (event) => alertQuickSettings());

    const hotkeys_button = E.div({ class: "ct-character-header-" + button_type + "__group ct-character-header-" + button_type + "__group--beyond20-hotkeys" },
        E.div({ class: "beyond20-hotkeys-popup beyond20-hotkeys-list beyond20-hotkeys-hidden"})
    );
    const hotkeys_popup = $(hotkeys_button).find(".beyond20-hotkeys-popup");

    gap.after(hotkeys_button);
    $(hotkeys_button).on('mouseenter', (event) => showHotkeysList(hotkeys_popup)).on('mouseleave', (event) => hideHotkeysList(hotkeys_popup));
    $(button).on('mouseenter', (event) => showHotkeysList(hotkeys_popup)).on('mouseleave', (event) => hideHotkeysList(hotkeys_popup));
    updateHotkeysList(hotkeys_popup);
}

let previousButton = null;
function injectCustomRollButton() {
    if (!DigitalDiceManager.isEnabled()) // nothing to do when digital dice menu does not exist
        return;

    let rollButton = document.querySelector("button[data-testid=diceRollButton]"),
        resetButton = document.querySelector("button[data-testid=diceClearButton]");

    // We have to wait until dice menu is completely initialized.
    if (!rollButton)
        return;

    const currentlyInjected = previousButton !== null && rollButton.dataset.b20roll !== undefined;
    if (!settings["use-digital-dice"]) { // inject or update button
        if (!currentlyInjected) {
            // store a reference to the previous button so we can revert our changes if the user switches the setting off again
            previousButton = rollButton;

            // remove existing click event by replacing element with itself
            const newButton = rollButton.cloneNode(true);
            rollButton.replaceWith(newButton);
            rollButton = newButton;

            const resetButtonClicked = () => {
                // make sure the reset button's event handler has run so we don't get the old disabled attribute
                requestAnimationFrame(() => {
                    // update button enabled state
                    const newDisabledState = resetButton.disabled || !DigitalDiceManager.parseCurrentSelection().length;
                    rollButton.disabled = rollButton.ariaDisabled = newDisabledState;
                });
            };

            // add an additional event handler to the reset button to sync the buttons' disabled states
            if(resetButton) {
                resetButton.removeEventListener("click", resetButtonClicked);
                resetButton.addEventListener("click", resetButtonClicked);
            }

            // add our custom click handler for rolling
            rollButton.addEventListener("click", async () => {
                const selectedDice = DigitalDiceManager.parseCurrentSelection();

                if (!selectedDice.length) {
                    // This should not happen unless DDB page changes as button is hidden when no dice are selected
                    console.warn("Roll button clicked but no dice were selected. Ignoring.");
                    return;
                }

                await sendRollWithCharacter("custom", selectedDice.join(" + "), { name: "custom: roll" });

                // close the panel again
                $(".dice-rolling-panel > button").click();
            });

            // set a flag so we can later determine whether we have already injected our custom event handler
            rollButton.dataset.b20roll = "1";

            // hide the whisper toggle buttons if they exist. We've got our own settings for whispering rolls
            const toggleContainer = document.querySelector("button[data-testid=diceRollToSelfButton]")?.parentNode;
            toggleContainer && (toggleContainer.style.display = "none");

            // hide the 3D dice settings container as those dice won't get used
            const diceSettingsContainer = document.querySelector("div[class*=_shared3dDiceContainer]"); // cannot use '.class' selector as class is prefixed with a random value
            diceSettingsContainer && (diceSettingsContainer.style.display = "none");
        }

        // update label
        const labelElement = document.querySelector("span[class*=_rollToLabel]");
        if (labelElement) {
            let label = "Rolling to everyone";
            if (key_modifiers.whisper || settings["whisper-type"] === WhisperType.YES.toString())
                label = "Rolling to DM";
            else if (settings["whisper-type"] === WhisperType.QUERY.toString())
                label = "Rolling to (ask)";

            if (labelElement.textContent !== label)
                labelElement.textContent = label;
        }

        // update button enabled state
        const newDisabledState = resetButton && resetButton.disabled || !DigitalDiceManager.parseCurrentSelection().length;
        rollButton.disabled = rollButton.ariaDisabled = newDisabledState;

    } else if (currentlyInjected) { // revert custom button we injected previously
        rollButton.replaceWith(previousButton);
        previousButton = null;

        // show the whisper toggle buttons again
        const toggleContainer = document.querySelector("button[data-testid=diceRollToSelfButton]")?.parentNode
        toggleContainer && (toggleContainer.style.display = "");

        // show the 3D dice settings container again
        const diceSettingsContainer = document.querySelector("div[class*=_shared3dDiceContainer]");
        diceSettingsContainer && (diceSettingsContainer.style.display = "");
    }
}

var quick_roll = false;
var quick_roll_force_attack = false;
var quick_roll_force_damage = false;
var quick_roll_force_versatile = false;
var quick_roll_timeout = 0;


function deactivateQuickRolls() {
    let abilities = $(".ddbc-ability-summary .ddbc-ability-summary__primary .integrated-dice__container");
    // If digital dice are disabled, look up where the modifier is
    if (abilities.length === 0)
        abilities = $(".ct-quick-info__abilities .ddbc-ability-summary .ddbc-ability-summary__secondary .ddbc-signed-number, .ct-quick-info__abilities .ddbc-ability-summary .ddbc-ability-summary__primary .ddbc-signed-number, .ct-quick-info__abilities .ddbc-ability-summary .ddbc-ability-summary__secondary span[class*='styles_numberDisplay'], .ct-quick-info__abilities .ddbc-ability-summary .ddbc-ability-summary__primary span[class*='styles_numberDisplay'], .ct-main-mobile__abilities .ddbc-ability-summary .ddbc-ability-summary__secondary .ddbc-signed-number, .ct-main-mobile__abilities .ddbc-ability-summary .ddbc-ability-summary__primary .ddbc-signed-number, .ct-main-mobile__abilities .ddbc-ability-summary .ddbc-ability-summary__secondary span[class*='styles_numberDisplay'], .ct-main-mobile__abilities .ddbc-ability-summary .ddbc-ability-summary__primary span[class*='styles_numberDisplay']");
    const saving_throws = $(".ct-saving-throws-summary__ability .ct-saving-throws-summary__ability-modifier,.ddbc-saving-throws-summary__ability .ddbc-saving-throws-summary__ability-modifier");
    const skills = $(".ct-skills .ct-skills__list .ct-skills__col--modifier,.ddbc-skills .ddbc-skills__list .ddbc-skills__col--modifier");
    const actions = $(".ct-combat-attack .ct-combat-attack__icon,.ddbc-combat-attack .ddbc-combat-attack__icon");
    const actions_to_hit = $(".ddbc-combat-attack .ddbc-combat-attack__tohit .integrated-dice__container");
    const actions_damage = $(".ddbc-combat-attack .ddbc-combat-attack__damage .integrated-dice__container");
    const spells = $(".ct-spells-spell .ct-spells-spell__action,.ddbc-spells-spell .ddbc-spells-spell__action");
    const spells_to_hit = $(".ct-spells-spell .ct-spells-spell__tohit .integrated-dice__container, .ddbc-spells-spell .ddbc-spells-spell__tohit .integrated-dice__container");
    const spells_damage = $(".ct-spells-spell .ct-spells-spell__damage .integrated-dice__container, .ddc-spells-spell .ddc-spells-spell__damage .integrated-dice__container");
    const initiative = $(".ct-combat__summary-group--initiative .integrated-dice__container, .ct-combat__summary-group--initiative span[class*='styles_numberDisplay'], .ct-combat-tablet__extra--initiative .integrated-dice__container, .ct-combat-tablet__extra--initiative span[class*='styles_numberDisplay'], .ct-combat-mobile__extras > section[class*='styles_boxMobile'] .integrated-dice__container, .ct-combat-mobile__extras > section[class*='styles_boxMobile'] span[class*='styles_numberDisplay']").eq(0);

    hideTooltipIfDestroyed();
    deactivateTooltipListeners(initiative);
    deactivateTooltipListeners(abilities);
    deactivateTooltipListeners(saving_throws);
    deactivateTooltipListeners(skills);
    deactivateTooltipListeners(actions);
    deactivateTooltipListeners(actions_to_hit);
    deactivateTooltipListeners(actions_damage);
    deactivateTooltipListeners(spells);
    deactivateTooltipListeners(spells_to_hit);
    deactivateTooltipListeners(spells_damage);

    return {
        initiative,
        abilities, saving_throws, skills,
        actions, actions_to_hit, actions_damage,
        spells, spells_to_hit, spells_damage
    };
}

function activateQuickRolls() {
    // quick rolling, don't mess up our tooltip;
    if (quick_roll)
        return;
    const beyond20_tooltip = getQuickRollTooltip();

    const {
        initiative,
        abilities, saving_throws, skills,
        actions, actions_to_hit, actions_damage,
        spells, spells_to_hit, spells_damage
    } = deactivateQuickRolls();

    if (!settings["quick-rolls"])
        return;

    activateTooltipListeners(initiative, 'up', beyond20_tooltip, (el) => {
        el.closest("div[class*='styles_value']").trigger('click');

        if ($(".b20-initiative-pane").length)
            execute("b20-initiative-pane");
        else
            quick_roll = true;
    });
    for (let ability of abilities.toArray()) {
        activateTooltipListeners($(ability), 'down', beyond20_tooltip, (el) => {
            const row = el.closest(".ct-ability-summary,.ddbc-ability-summary");
            if (row.length > 0) {
                rollAbilityCheckFromRow(row[0]);
            }
        });
    }

    for (let [idx, save] of saving_throws.toArray().entries()) {
        activateTooltipListeners($(save), idx < 3 ? 'left' : 'right', beyond20_tooltip, (el) => {
            const name = el.closest(".ct-saving-throws-summary__ability,.ddbc-saving-throws-summary__ability")
                .find(".ct-saving-throws-summary__ability-name,.ddbc-saving-throws-summary__ability-name")
                .trigger('click').text().slice(0, 3).toLowerCase();
            // If same save ability, clicking will be a noop && it won't modify it;
            const pane_name = $(".b20-ability-saving-throws-pane .ct-sidebar__heading").text().slice(0, 3).toLowerCase();
            if (name == pane_name)
                execute("b20-ability-saving-throws-pane");
            else
                quick_roll = true;
        });
    }

    for (let skill of skills.toArray()) {
        activateTooltipListeners($(skill), 'left', beyond20_tooltip, (el) => {
            const name = el.closest(".ct-skills__item,.ddbc-skills__item")
                .find(".ct-skills__col--skill,.ddbc-skills__col--skill")
                .trigger('click').text();
            let pane = null;
            let paneClass = null;
            // If same skill, clicking will be a noop && it won't modify the document;
            for (paneClass of ["ct-skill-pane", "ct-custom-skill-pane"]) {
                pane = $("." + paneClass);
                if (pane.length > 0)
                    break;
            }
            const pane_name = pane.find(".ct-sidebar__heading ." + paneClass + "__header-name").text();

            if (name == pane_name)
                execute(paneClass);
            else
                quick_roll = true;
        });
    }

    const activateQRAction = (action, force_to_hit_only, force_damages_only, force_versatile) => {
        action = $(action);
        // To the right for attack and damage, to the left for to hit
        const position = force_to_hit_only ? 'left' : 'right';
        activateTooltipListeners(action, position, beyond20_tooltip, (el) => {
            const name = el.closest(".ct-combat-attack,.ddbc-combat-attack")
                .find(".ct-combat-attack__name .ct-combat-attack__label,.ddbc-combat-attack__name .ddbc-combat-attack__label")
                .trigger('click').text();
            let pane = null;
            let paneClass = null;
            // Need to check all types of panes to find the right one;
            for (paneClass of ["b20-item-pane", "b20-action-pane", "ct-custom-action-pane", "b20-custom-action-pane", "ct-spell-pane"]) {
                pane = $("." + paneClass);
                if (pane.length > 0)
                    break;
            }
            const pane_name = pane.find(".ct-sidebar__heading").text();

            if (name == pane_name) {
                execute(paneClass, {force_to_hit_only, force_damages_only, force_versatile});
            } else {
                quick_roll_force_attack = force_to_hit_only;
                quick_roll_force_damage = force_damages_only;
                quick_roll_force_versatile = force_versatile;
                quick_roll = true;
            }
        });
    }

    for (let action of actions.toArray()) {
        activateQRAction(action, false, false);
    }
    for (let action of actions_to_hit.toArray()) {
        activateQRAction(action, true, false);
    }
    for (let action of actions_damage.toArray()) {
        activateQRAction(action, false, true, action.previousElementSibling !== null);
    }

    const activateQRSpell = (spell, force_to_hit_only, force_damages_only) => {
        spell = $(spell);
        // To the right for attack and damage, to the left for to hit
        const position = force_to_hit_only ? 'left' : 'right';
        activateTooltipListeners(spell, position, beyond20_tooltip, (el) => {
            const name_element = el.closest(".ct-spells-spell,.ddbc-spells-spell")
                .find(".ct-spell-name,.ddbc-spell-name,span[class*='styles_spellName']");
            const name = name_element.trigger('click').text();
            // If same item, clicking will be a noop && it won't modify the document;
            const pane_name = $(".ct-spell-pane .ct-sidebar__heading .ct-spell-name,.ct-spell-pane .ct-sidebar__heading .ddbc-spell-name, .ct-spell-pane .ct-sidebar__heading span[class*='styles_spellName']").text();
            if (name == pane_name) {
                // For spells, check the spell level. DNDB doesn't switch to the right level when clicking the spell if
                // it's already the right spell (but wrong level)
                const castas = $(".ct-spell-caster__casting-level-current").text()
                const level = el.closest(".ct-content-group").find(".ct-content-group__header-content").text();
                const pane_level = castas === "" ? "Cantrip" : `${castas} Level`;
                if (pane_level.toLowerCase() === level.toLowerCase()) {
                    execute("ct-spell-pane", {force_to_hit_only, force_damages_only});
                } else {
                    // Trigger a click elsewhere to cause the sidepanel to change and then force it again to display the right level spell
                    $(".ddbc-character-tidbits__menu-callout").trigger('click');
                    name_element.trigger('click');
                    quick_roll_force_attack = force_to_hit_only;
                    quick_roll_force_damage = force_damages_only;
                    quick_roll_force_versatile = false;
                    quick_roll = true;
                }
            } else {
                quick_roll_force_attack = force_to_hit_only;
                quick_roll_force_damage = force_damages_only;
                quick_roll_force_versatile = false;
                quick_roll = true;
            }
        });
    }
    for (let spell of spells.toArray()) {
        activateQRSpell(spell, false, false);
    }
    for (let spell of spells_to_hit.toArray()) {
        activateQRSpell(spell, true, false);
    }
    for (let spell of spells_damage.toArray()) {
        activateQRSpell(spell, false, true);
    }
}

function executeQuickRoll(paneClass) {
    quick_roll_timeout = 0;
    console.log("EXECUTING QUICK ROLL!");
    execute(paneClass, {
        force_to_hit_only: quick_roll_force_attack,
        force_damages_only: quick_roll_force_damage,
        force_versatile: quick_roll_force_versatile
    });
    quick_roll_force_attack = false;
    quick_roll_force_damage = false;
    quick_roll_force_versatile = false;
    quick_roll = false;
}

function documentModified(mutations, observer) {
    if (isExtensionDisconnected()) {
        deactivateQuickRolls();
        observer.disconnect();
        return;
    }

    character.updateInfo();
    injectRollToSpellAttack();
    injectRollToSnippets();
    injectSettingsButton();
    wayBeyond20InjectCombatMenuAction();
    wayBeyond20ScheduleActiveEffectBadgeRefresh();
    injectCustomRollButton();
    wayBeyond20InjectBloodAndBoneAction();
    wayBeyond20InjectBardicInspirationButton();
    activateQuickRolls();
    if (character._features_needs_refresh && !character._features_refresh_warning_displayed) {
        character._features_refresh_warning_displayed = true;
        alertify.alert("This is a new or recently leveled-up character sheet and WayBeyond20 needs to parse its information. <br/>Please select the <strong>'Features &amp; Traits'</strong> panel on your DnDBeyond Character Sheet for WayBeyond20 to parse this character's features and populate the character-specific options.");
    }


    const customRoll = DigitalDiceManager.updateNotifications();
    if (customRoll && settings['use-digital-dice']) {
        dndbeyondDiceRoller.sendCustomDigitalDice(character, customRoll);
    }

    const SUPPORTED_PANES = [
        "ct-custom-skill-pane",
        "ct-skill-pane",
        "ct-racial-trait-pane",
        "ct-trait-pane",
        "ct-infusion-choice-pane",
        "ct-custom-action-pane",
        "ct-spell-pane",
        "ct-reset-pane",
        "ct-vehicle-pane",
        "ct-condition-manage-pane",
        "ct-proficiencies-pane",
        "ct-extra-manage-pane"
    ]

    const SPECIAL_PANES = {
        ability: "b20-ability-pane",
        savingThrow: "b20-ability-saving-throws-pane",
        initiative: "b20-initiative-pane",
        action: "b20-action-pane",
        customAction: "b20-custom-action-pane",
        feat: "b20-feat-pane",
        feature: "b20-class-feature-pane",
        racialTrait: "b20-racial-trait-pane",
        character: "b20-character-manage-pane",
        creature: "b20-creature-pane",
        background: "b20-background-pane",
        healthManager: "b20-health-manage-pane",
        itemPanel: "b20-item-pane"
    }

    function handlePane(paneClass) {
        console.log("WayBeyond20: New side panel is : " + paneClass);
        injectRollButton(paneClass);
        if (quick_roll) {
            if (quick_roll_timeout > 0) clearTimeout(quick_roll_timeout);
            quick_roll_timeout = setTimeout(() => executeQuickRoll(paneClass), 50);
        }
    }

    function markPane(sidebar, paneClass) {
        if (!sidebar.parent().hasClass(paneClass)) {
            sidebar.parent().addClass(paneClass);
        }
    }
    
    const pane = $(SUPPORTED_PANES.map(pane => `.${pane}`).join(","));
    if (pane.length > 0) {
        pane.each((_, div) => handlePane(div.className));
    } else {
        const sidebar = $(".ct-sidebar__portal .ct-sidebar__header");
        if (sidebar.length > 0) {
            const sideBarHeader = sidebar.text().toLowerCase();
            // Look for initiative followed by a modifier value.
            // This should be safe against translated pages since chrome will translate the text after
            // the page is modified, giving us enoguh time to catch "Initiative" string and add the class name
            // to the div, before the text gets translated
            const initRegex = /\bInitiative\s\(([-+]?\d+)\)/i;
            if (sidebar.parent().find("svg[class*='ddbc-ability-icon']").length > 0 && sidebar.find("div[class*='styles_interactive']").length === 0) { // not saving throw
                const paneClass = SPECIAL_PANES.ability;
                markPane(sidebar, paneClass);
                handlePane(paneClass);
            } else if (sidebar.parent().find("svg[class*='ddbc-ability-icon']").length > 0 && sidebar.find("div[class*='styles_interactive']").length > 0) {
                // Saving throws have no specific class, but the preview icon has the ddbc-ability-icon class
                // so we can use that to detect saving throws (excluding ability scores, already handled above)
                // Also checking for saving throws text bit exist since dndbeyond added that.
                const paneClass = SPECIAL_PANES.savingThrow;
                markPane(sidebar, paneClass);
                handlePane(paneClass);
            } else if (sideBarHeader.match(initRegex)) {
                const paneClass = SPECIAL_PANES.initiative;
                markPane(sidebar, paneClass);
                handlePane(paneClass);
            } else if (sidebar.find("span[class*='ddbc-action-name']").length > 0) {
                const paneClass = SPECIAL_PANES.action;
                markPane(sidebar, paneClass);
                handlePane(paneClass);
            } else if (sidebar.parent().find(".ct-custom-action-pane__actions").length > 0) {
                // In case DDB remove the ct-custom-action-pane class from the sidebar
                const paneClass = SPECIAL_PANES.customAction;
                markPane(sidebar, paneClass);
                handlePane(paneClass);
            } else if (sidebar.parent().find("div[class*='ct-item-detail']").length > 0) {
                const paneClass = SPECIAL_PANES.itemPanel;
                markPane(sidebar, paneClass);
                handlePane(paneClass);
            } else if (sidebar.parent().find(".ct-feature-snippet--feat").length > 0) {
                const paneClass = SPECIAL_PANES.feat;
                markPane(sidebar, paneClass);
                handlePane(paneClass);
            } else if (sidebar.parent().find(".ct-feature-snippet--class").length > 0) {
                const paneClass = SPECIAL_PANES.feature;
                markPane(sidebar, paneClass);
                handlePane(paneClass);
            } else if (sidebar.parent().find(".ct-feature-snippet--racial-trait").length > 0) {
                // In case DDB remove the ct-racial-trait-pane class from the sidebar
                const paneClass = SPECIAL_PANES.racialTrait;
                markPane(sidebar, paneClass);
                handlePane(paneClass);
            } else if (Array.from(sidebar.parent().find("h4, h5"))
                    .some(e => e.textContent.includes("Suggested Characteristics"))) {
                const paneClass = SPECIAL_PANES.background;
                markPane(sidebar, paneClass);
                handlePane(paneClass);
            } else if (sidebar.parent().find("div[class*='styles_block'] section[class*='styles_creatureBlock']").length > 0) {
                const paneClass = SPECIAL_PANES.creature;
                markPane(sidebar, paneClass);
                handlePane(paneClass);
            } else if (Array.from(sidebar.parent().find("h1, h2"))
                .some(e => e.textContent.includes("HP Management"))) {
                    const paneClass = SPECIAL_PANES.healthManager;
                    markPane(sidebar, paneClass);
                    handlePane(paneClass);
                }
        } else {
            // Special panes with now headers
            const avatarPane = $(".ct-sidebar__inner div[class*='styles_characterManagePane']");
            if (avatarPane.length > 0) {
                const paneClass = SPECIAL_PANES.character;
                markPane(avatarPane, paneClass);
                handlePane(paneClass);
            }
        }
    }
}

function updateSettings(new_settings = null) {

    if (new_settings) {
        settings = new_settings;
        character.setGlobalSettings(settings);
        key_bindings = getKeyBindings(settings)
        if (settings['hotkeys-bindings']) {
            updateHotkeysList();
        }
        sendCustomEvent("NewSettings", [settings, chrome.runtime.getURL("")]);
    } else {
        getStoredSettings((saved_settings) => {
            sendCustomEvent("Loaded", [saved_settings]);
            updateSettings(saved_settings);
            documentModified();
        });
    }
}

function wayBeyond20NormalizeNameForTokenMatch(name) {
    return String(name || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function wayBeyond20CharacterMatchesMessageCharacter(messageCharacter) {
    if (!character) return false;
    const target = messageCharacter || {};
    const targetId = target.id !== undefined && target.id !== null ? String(target.id) : "";
    const currentId = character._id !== undefined && character._id !== null ? String(character._id) : "";
    if (targetId && currentId) return targetId === currentId;

    const targetName = wayBeyond20NormalizeNameForTokenMatch(target.name || target);
    const currentName = wayBeyond20NormalizeNameForTokenMatch(character._name);
    return !!targetName && !!currentName && targetName === currentName;
}

function wayBeyond20BindRoll20Token(request) {
    if (!request || !request.tokenId) return;
    const requestCharacter = request.character || { name: request.characterName };
    if (!wayBeyond20CharacterMatchesMessageCharacter(requestCharacter)) return;

    const settings_to_change = {
        "waybeyond20-roll20-token-id": String(request.tokenId),
        "waybeyond20-roll20-token-ids": Array.isArray(request.tokenIds) ? request.tokenIds.map(id => String(id)) : [String(request.tokenId)]
    };
    character.mergeCharacterSettings(settings_to_change, () => wayBeyond20ScheduleActiveEffectBadgeRefresh());
}

let wayBeyond20LastObservedRoll20TokenId = "";
let wayBeyond20LastObservedRoll20WasCharacter = false;

function wayBeyond20ResetTurnResourcesFromRoll20(turnInfo) {
    if (!character || !turnInfo) return;
    const activeEffects = wayBeyond20GetTrackedSpellEffects();
    const previousState = wayBeyond20GetTurnTrackerState();
    let state = wayBeyond20NormalizeTurnTrackerState(previousState, activeEffects);

    wayBeyond20CharacterDebug("Roll20 turn update received", { turnInfo, previousState });

    if (turnInfo.active === false) {
        if (!state.inCombat && !state.suppressedRoll20TurnKey) return;
        state.inCombat = false;
        state.combatSource = "";
        state.combatStartedAt = null;
        state.localTurnNumber = 0;
        state.currentRoll20Turn = null;
        state.lastRoll20TurnKey = "";
        state.suppressedRoll20TurnKey = "";
        wayBeyond20LastObservedRoll20TokenId = "";
        wayBeyond20LastObservedRoll20WasCharacter = false;
        wayBeyond20SetTurnTrackerState(state, wayBeyond20ScheduleActiveEffectBadgeRefresh);
        return;
    }

    const turnTokenId = String(turnInfo.tokenId || "");
    const turnKey = String(turnInfo.turnKey || `${turnTokenId}|${turnInfo.pr || ""}|${turnInfo.custom || ""}`);
    if (state.suppressedRoll20TurnKey) {
        if (state.suppressedRoll20TurnKey === turnKey) {
            wayBeyond20CharacterDebug("Roll20 turn update suppressed after manual End Combat", { turnKey });
            return;
        }
        state.suppressedRoll20TurnKey = "";
    }

    const wasOutOfCombat = !wayBeyond20HasActiveCombatState(previousState);
    state.inCombat = true;
    state.combatSource = "Roll20";
    state.combatStartedAt = state.combatStartedAt || Date.now();
    if (wasOutOfCombat) {
        state = wayBeyond20NormalizeTurnTrackerState(state, activeEffects, { reset: true });
        state.localTurnNumber = 0;
    }

    const storedTokenId = String(character.getSetting("waybeyond20-roll20-token-id", "") || "");
    const storedTokenIds = character.getSetting("waybeyond20-roll20-token-ids", []);
    const tokenIds = Array.isArray(storedTokenIds) ? storedTokenIds.map(id => String(id)) : [];
    const tokenName = wayBeyond20NormalizeNameForTokenMatch(turnInfo.tokenName || turnInfo.custom || "");
    const characterName = wayBeyond20NormalizeNameForTokenMatch(character._name);
    const tokenNameMatches = !!tokenName && !!characterName && (
        tokenName === characterName ||
        tokenName === `${characterName} - leveled up` ||
        characterName === `${tokenName} - leveled up`
    );
    const isThisCharactersTurn = !!turnTokenId && (
        turnTokenId === storedTokenId || tokenIds.includes(turnTokenId) || tokenNameMatches
    );
    const persistedWasThisCharactersTurn = !!(previousState.currentRoll20Turn && previousState.currentRoll20Turn.isThisCharactersTurn);
    const wasThisCharactersTurn = wayBeyond20LastObservedRoll20TokenId
        ? wayBeyond20LastObservedRoll20WasCharacter
        : persistedWasThisCharactersTurn;

    if (tokenNameMatches && !tokenIds.includes(turnTokenId)) {
        const nextTokenIds = Array.from(new Set(tokenIds.concat(turnTokenId)));
        character.mergeCharacterSettings({
            "waybeyond20-roll20-token-id": storedTokenId || turnTokenId,
            "waybeyond20-roll20-token-ids": nextTokenIds
        });
        wayBeyond20CharacterDebug("Roll20 token matched by character name", {
            turnTokenId,
            tokenName: turnInfo.tokenName || "",
            characterName: character._name,
            nextTokenIds
        });
    }

    // Reset once on the transition from another combatant to this character.
    // Duplicate messages from Roll20 popouts carry the same active token and must
    // not increment the turn repeatedly.
    if (isThisCharactersTurn && (!wasThisCharactersTurn || wasOutOfCombat)) {
        const firstRoll20CharacterTurn = !String(state.lastRoll20TurnKey || "");
        const nextTurnNumber = wasOutOfCombat || firstRoll20CharacterTurn
            ? 1
            : Math.max(0, wayBeyond20ParseInteger(state.localTurnNumber) ?? 0) + 1;
        state = wayBeyond20NormalizeTurnTrackerState(state, activeEffects, { reset: true });
        state.localTurnNumber = nextTurnNumber;
        state.lastRoll20TurnKey = turnKey;
        wayBeyond20CharacterDebug("Roll20 character turn started", {
            turnKey,
            turnNumber: nextTurnNumber,
            matchedByTokenId: turnTokenId === storedTokenId || tokenIds.includes(turnTokenId),
            matchedByName: tokenNameMatches
        });
    }

    wayBeyond20LastObservedRoll20TokenId = turnTokenId;
    wayBeyond20LastObservedRoll20WasCharacter = isThisCharactersTurn;

    state.currentRoll20Turn = {
        tokenId: turnTokenId,
        custom: turnInfo.custom || "",
        tokenName: turnInfo.tokenName || "",
        pr: turnInfo.pr || "",
        turnKey,
        isThisCharactersTurn
    };
    if (Array.isArray(turnInfo.targets)) {
        state.knownTargets = turnInfo.targets;
    }

    wayBeyond20SetTurnTrackerState(state, wayBeyond20ScheduleActiveEffectBadgeRefresh);
}

function handleMessage(request, sender, sendResponse) {
    console.log("Received message:", request);
    if (request.action == "settings") {
        if (request.type == "general") {
            updateSettings(request.settings);
        } else if (request.type == "character" && request.id == character._id) {
            character.updateSettings(request.settings);
            wayBeyond20ScheduleActiveEffectBadgeRefresh();
        } else {
            console.log("Ignoring character settings, for ID: ", request.id);
        }
    } else if (request.action == "get-character") {
        character.updateInfo();
        sendResponse(character.getDict());
    } else if (request.action == "waybeyond20-add-effect") {
        const target = request.character || {};
        const targetId = target.id !== undefined && target.id !== null ? String(target.id) : "";
        const currentId = character && character._id !== undefined && character._id !== null ? String(character._id) : "";
        if (targetId && currentId && targetId !== currentId) return;
        if (!targetId && target.name && character && character._name && target.name !== character._name) return;
        wayBeyond20AddExternalEffect(request.effect || {});
    } else if (request.action == "waybeyond20-token-binding") {
        wayBeyond20BindRoll20Token(request);
    } else if (request.action == "waybeyond20-turn-update") {
        wayBeyond20ResetTurnResourcesFromRoll20(request.current || {});
    } else if (request.action == "waybeyond20-damage-result") {
        if (!wayBeyond20CharacterMatchesMessageCharacter(request.character || {})) return;
        const totalDamage = Number(request.totalDamage || 0);
        if (Number.isFinite(totalDamage) && totalDamage > 0) {
            wayBeyond20SetTemporaryHitPoints(totalDamage);
        }
    } else if (request.action == "open-options") {
        alertFullSettings();
    }
}

let ddbRollHijackInstalled = false;

function swallowRollEvent(event) {
    event.preventDefault();
    event.stopPropagation();
    if (typeof event.stopImmediatePropagation === "function") {
        event.stopImmediatePropagation();
    }
}

function handleCombatAttackIntegratedDie(button) {
    const row = button.closest(".ct-combat-attack, .ddbc-combat-attack");
    if (!row) return false;

    const isToHit = !!button.closest(".ct-combat-attack__tohit, .ddbc-combat-attack__tohit");
    const damageCell = button.closest(".ct-combat-attack__damage, .ddbc-combat-attack__damage");
    const isDamage = !!damageCell;
    const forceVersatile = !!(damageCell && damageCell.previousElementSibling);

    const name = $(row)
        .find(".ct-combat-attack__name .ct-combat-attack__label, .ddbc-combat-attack__name .ddbc-combat-attack__label")
        .first()
        .text()
        .trim();

    let pane = null;
    let paneClass = null;

    for (paneClass of ["b20-item-pane", "b20-action-pane", "ct-custom-action-pane", "b20-custom-action-pane", "ct-spell-pane"]) {
        pane = $("." + paneClass);
        if (pane.length > 0) break;
    }

    const paneName = pane && pane.length
        ? pane.find(".ct-sidebar__heading").text().trim()
        : "";

    if (name && paneName === name && paneClass) {
        const waitForPane = async () => {
            const paneSelectors = {
                "b20-item-pane": ".ct-item-detail",
                "b20-action-pane": ".ct-available-actions",
                "ct-custom-action-pane": ".ct-custom-action-pane",
                "b20-custom-action-pane": ".ct-available-actions",
                "ct-spell-pane": ".ct-spell-details"
            };
            const selector = paneSelectors[paneClass];
            for (let i = 0; i < 5; i++) {
                if ($(selector).length > 0) break;
                await new Promise(resolve => setTimeout(resolve, 50));
            }
            execute(paneClass, {
                force_to_hit_only: isToHit,
                force_damages_only: isDamage,
                force_versatile: forceVersatile
            });
        };
        waitForPane();
    } else {
        quick_roll_force_attack = isToHit;
        quick_roll_force_damage = isDamage;
        quick_roll_force_versatile = forceVersatile;
        quick_roll = true;

        $(row)
            .find(".ct-combat-attack__name .ct-combat-attack__label, .ddbc-combat-attack__name .ddbc-combat-attack__label")
            .first()
            .trigger("click");
    }

    return true;
}

function handleSpellIntegratedDie(button) {
    const row = button.closest(".ct-spells-spell, .ddbc-spells-spell");
    if (!row) return false;

    const isToHit = !!button.closest(".ct-spells-spell__tohit, .ddbc-spells-spell__tohit");
    const isDamage = !!button.closest(".ct-spells-spell__damage, .ddbc-spells-spell__damage");

    const nameElement = $(row)
        .find(".ct-spell-name, .ddbc-spell-name, span[class*='styles_spellName']")
        .first();

    const spellName = nameElement.text().trim();
    const paneName = $(".ct-spell-pane .ct-sidebar__heading .ct-spell-name, .ct-spell-pane .ct-sidebar__heading .ddbc-spell-name, .ct-spell-pane .ct-sidebar__heading span[class*='styles_spellName']")
        .text()
        .trim();

    if (spellName && spellName === paneName) {
        const castas = $(".ct-spell-caster__casting-level-current").text();
        const level = $(row).closest(".ct-content-group").find(".ct-content-group__header-content").text();
        const paneLevel = castas === "" ? "Cantrip" : `${castas} Level`;

        if (paneLevel.toLowerCase() === level.toLowerCase()) {
            const waitForSpellPane = async () => {
                for (let i = 0; i < 5; i++) {
                    if ($(".ct-spell-details").length > 0) break;
                    await new Promise(resolve => setTimeout(resolve, 50));
                }
                execute("ct-spell-pane", {
                    force_to_hit_only: isToHit,
                    force_damages_only: isDamage
                });
            };
            waitForSpellPane();
        } else {
            $(".ddbc-character-tidbits__menu-callout").trigger("click");
            nameElement.trigger("click");

            quick_roll_force_attack = isToHit;
            quick_roll_force_damage = isDamage;
            quick_roll_force_versatile = false;
            quick_roll = true;
        }
    } else {
        quick_roll_force_attack = isToHit;
        quick_roll_force_damage = isDamage;
        quick_roll_force_versatile = false;
        quick_roll = true;

        nameElement.trigger("click");
    }

    return true;
}

function handleAbilityIntegratedDie(target) {
    const row = target.closest(".ct-ability-summary, .ddbc-ability-summary");
    if (!row) return false;

    resetHijackQuickRollState();
    rollAbilityCheckFromRow(row);
    return true;
}

function handleSavingThrowIntegratedDie(target) {
    const row = target.closest(".ct-saving-throws-summary__ability, .ddbc-saving-throws-summary__ability");
    if (!row) return false;

    resetHijackQuickRollState();

    $(".ct-saving-throws-summary__ability.beyond20-active-roll, .ddbc-saving-throws-summary__ability.beyond20-active-roll")
        .removeClass("beyond20-active-roll");

    $(row).addClass("beyond20-active-roll");

    rollSavingThrowFromRow(row);
    return true;
}

function handleSkillIntegratedDie(target) {
    const row = target.closest(".ct-skills__item, .ddbc-skills__item");
    if (!row) return false;

    const label = $(row)
        .find(".ct-skills__col--skill, .ddbc-skills__col--skill")
        .first();

    const name = label.text().trim();

    let pane = null;
    let paneClass = null;

    for (const cls of ["ct-skill-pane", "ct-custom-skill-pane"]) {
        const found = $("." + cls);
        if (found.length > 0) {
            pane = found;
            paneClass = cls;
            break;
        }
    }

    const paneName = pane && paneClass
        ? pane.find(".ct-sidebar__heading ." + paneClass + "__header-name").text().trim()
        : "";

    if (name && paneName && name === paneName && paneClass) {
        resetHijackQuickRollState();
        execute(paneClass);
    } else {
        resetHijackQuickRollState();
        quick_roll = true;
        label.trigger("click");
    }

    return true;
}

function handleInitiativeIntegratedDie(target) {
    const row = target.closest(
        ".ct-combat__summary-group--initiative, " +
        ".ct-combat-tablet__extra--initiative, " +
        ".ct-combat-mobile__extras > section[class*='styles_boxMobile']"
    );
    if (!row) return false;

    if ($(".b20-initiative-pane").length) {
        resetHijackQuickRollState();
        execute("b20-initiative-pane");
    } else {
        resetHijackQuickRollState();
        quick_roll = true;

        const valueContainer = target.closest("div[class*='styles_value']");
        if (valueContainer) {
            $(valueContainer).trigger("click");
        } else {
            $(target).trigger("click");
        }
    }

    return true;
}

function resetHijackQuickRollState() {
    quick_roll = false;
    quick_roll_force_attack = false;
    quick_roll_force_damage = false;
    quick_roll_force_versatile = false;

    if (quick_roll_timeout > 0) {
        clearTimeout(quick_roll_timeout);
        quick_roll_timeout = 0;
    }
}

let ddbHijackPointerHandled = false;

function canHandleDDBRollTarget(target) {
    if (!target || !target.closest) return false;
    return !!(
        target.closest(".ct-combat-attack, .ddbc-combat-attack") ||
        target.closest(".ct-spells-spell, .ddbc-spells-spell") ||
        target.closest(".ct-ability-summary, .ddbc-ability-summary") ||
        target.closest(".ct-saving-throws-summary__ability, .ddbc-saving-throws-summary__ability") ||
        target.closest(".ct-skills__item, .ddbc-skills__item") ||
        target.closest(
            ".ct-combat__summary-group--initiative, " +
            ".ct-combat-tablet__extra--initiative, " +
            ".ct-combat-mobile__extras > section[class*='styles_boxMobile']"
        )
    );
}

function installDDBRollHijack() {
    if (ddbRollHijackInstalled) return;
    ddbRollHijackInstalled = true;

    const selector = [
        "button.integrated-dice__container.beyond20-quick-roll-area",
        "button.integrated-dice__container",

        ".ct-saving-throws-summary__ability .ct-saving-throws-summary__ability-modifier",
        ".ddbc-saving-throws-summary__ability .ddbc-saving-throws-summary__ability-modifier",

        ".ct-skills .ct-skills__list .ct-skills__col--modifier",
        ".ddbc-skills .ddbc-skills__list .ddbc-skills__col--modifier",

        ".ct-combat__summary-group--initiative .integrated-dice__container",
        ".ct-combat__summary-group--initiative span[class*='styles_numberDisplay']",
        ".ct-combat-tablet__extra--initiative .integrated-dice__container",
        ".ct-combat-tablet__extra--initiative span[class*='styles_numberDisplay']",
        ".ct-combat-mobile__extras > section[class*='styles_boxMobile'] .integrated-dice__container",
        ".ct-combat-mobile__extras > section[class*='styles_boxMobile'] span[class*='styles_numberDisplay']",

        ".ddbc-ability-summary .ddbc-ability-summary__primary .integrated-dice__container",
        ".ct-quick-info__abilities .ddbc-ability-summary .ddbc-ability-summary__secondary .ddbc-signed-number",
        ".ct-quick-info__abilities .ddbc-ability-summary .ddbc-ability-summary__primary .ddbc-signed-number",
        ".ct-quick-info__abilities .ddbc-ability-summary .ddbc-ability-summary__secondary span[class*='styles_numberDisplay']",
        ".ct-quick-info__abilities .ddbc-ability-summary .ddbc-ability-summary__primary span[class*='styles_numberDisplay']",
        ".ct-main-mobile__abilities .ddbc-ability-summary .ddbc-ability-summary__secondary .ddbc-signed-number",
        ".ct-main-mobile__abilities .ddbc-ability-summary .ddbc-ability-summary__primary .ddbc-signed-number",
        ".ct-main-mobile__abilities .ddbc-ability-summary .ddbc-ability-summary__secondary span[class*='styles_numberDisplay']",
        ".ct-main-mobile__abilities .ddbc-ability-summary .ddbc-ability-summary__primary span[class*='styles_numberDisplay']"
    ].join(", ");

    const routeTarget = (target) => {
        if (!target) return false;
        if (handleCombatAttackIntegratedDie(target)) return true;
        if (handleSpellIntegratedDie(target)) return true;
        if (handleInitiativeIntegratedDie(target)) return true;
        if (handleAbilityIntegratedDie(target)) return true;
        if (handleSavingThrowIntegratedDie(target)) return true;
        if (handleSkillIntegratedDie(target)) return true;
        return false;
    };

    const interceptPointer = (event) => {
        if (event.button !== 0) return;
        const target = event.target.closest(selector);
        if (!target || !canHandleDDBRollTarget(target)) return;

        ddbHijackPointerHandled = true;
        swallowRollEvent(event);

        const handled = routeTarget(target);
        if (!handled) {
            ddbHijackPointerHandled = false;
        }
    };

    const interceptClick = (event) => {
        if (event.button !== 0) return;
        const target = event.target.closest(selector);
        if (!target || !canHandleDDBRollTarget(target)) return;

        if (ddbHijackPointerHandled) {
            swallowRollEvent(event);
            ddbHijackPointerHandled = false;
            return;
        }

        swallowRollEvent(event);
        routeTarget(target);
    };

    window.addEventListener("pointerdown", interceptPointer, true);

    window.addEventListener("click", interceptClick, true);

    window.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;

        const target = event.target.closest(selector);
        if (!target || !canHandleDDBRollTarget(target)) return;

        swallowRollEvent(event);
        routeTarget(target);
    }, true);

    console.log("WayBeyond20: DDB roll hijack installed.");
}

var settings = getDefaultSettings();
var character = new Character(settings);
var creature = null;
updateSettings();
installDDBRollHijack();
wayBeyond20InstallLongRestTracker();
wayBeyond20InstallGameLogDebugRelay();
chrome.runtime.onMessage.addListener(handleMessage);
observer = new window.MutationObserver(documentModified);
observer.observe(document, { subtree: true, childList: true, characterData: true });
chrome.runtime.sendMessage({ "action": "activate-icon" });
sendCustomEvent("disconnect");
injectPageScript(chrome.runtime.getURL('dist/dndbeyond_mb.js'));
addCustomEventListener("SendMessage", _sendCustomMessageToBeyond20);
