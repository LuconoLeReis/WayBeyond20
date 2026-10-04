const DICE_REGEXP = /(^|[^\w])(?:(?:(?:(\d*[dD]\d+(?:ro(?:=|<|<=|>|>=)[0-9]+)?(?:min[0-9]+)?)((?:(?:\s*[-−+]\s*\d+)|(?:\s*[0+]\s*\d*[dD]\d+))*))|((?:[-−+]\s*\d+)+)))($|[^\w])/gm;

function replaceRollsCallback(match, replaceCB) {
    let dice = match[2];
    let modifiers = match[3];
    if (dice === undefined) {
        dice = "";
        modifiers = match[4];
    }
    if (modifiers) {
        modifiers = modifiers.replace(/−/g, "-");
    }
    dice = dice.replace("D", "d");

    const replacement = replaceCB(dice, modifiers);
    if (replacement === null) return match[0];
    else return `${match[1]}${replacement}${match[5]}`;
}

function replaceRolls(text, replaceCB) {
    return text.replace(DICE_REGEXP, (...match) => replaceRollsCallback(match, replaceCB));
}

// Used to clean various dice.includes(imperfections) roll strings;
function cleanRoll(rollText) {
    //clean adjacent '+'s (Roll20 treats it as a d20);
    //eg: (1d10 + + 2 + 3) -> (1d10 + 2 + 3);
    rollText = (rollText || "").toString();
    // Replace Unicode minus sign (U+2212) with ASCII hyphen-minus (U+002D)
    rollText = rollText.replace(/\u2212/g, "-");
    rollText = rollText.replace(/\+ \+/g, '+').replace(/\+ \-/g, '-');
    return rollText;
}

// Taken from https://stackoverflow.com/questions/45985198/the-best-practice-to-detect-whether-a-browser-extension-is-running-on-chrome-or; No Longer works
// new browser detection using user agent now
function getBrowser() {
    const ua = navigator.userAgent;

    if (/Firefox\//.test(ua)) return "Firefox";
    // 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36 Edg/143.0.0.0'
    if (/Edg\//.test(ua)) return "Edge";
    if (
        (/Brave\//.test(ua) || (navigator.brave && typeof navigator.brave.isBrave === "function")) ||
        (/OPR\//.test(ua)) ||
        (/Safari\//.test(ua) && !/Chrome\//.test(ua) && !/Chromium\//.test(ua)) ||
        (/Chrome\//.test(ua))
     ) return "Chrome"; // if brave, opera, safari or chrome just return chrome
    
    return "Chrome";
}

function getPlatform() {
    let platform;
    if (navigator.userAgentData && navigator.userAgentData.platform) {
        // This is the official way to do it but it's not supported by anything but Edge
        platform = navigator.userAgentData.platform;
    } else if (navigator.platform) {
        // And this is supposed to be deprecated...
        platform = navigator.platform;
    } else {
        return "Unknown";
    }
    if (platform.includes("Windows") || platform.includes("Win32")) {
        return "Windows";
    } else if (platform.includes("Mac")) {
        return "Mac";
    } else {
        return platform;
    }
}

function isExtensionDisconnected() {
    try {
        chrome.runtime.getURL("");
        return false;
    } catch (err) {
        return true;
    }
}

// Taken from https://stackoverflow.com/questions/9515704/insert-code-into-the-page-context-using-a-content-script;
function injectPageScript(url, callback = null) {
    const s = document.createElement('script');
    s.src = url;
    s.charset = "UTF-8";
    s.onload = () => {
        s.remove();
        if (callback)
            callback();
    }
        ; (document.head || document.documentElement).appendChild(s);
}

function injectCSS(css) {
    const s = document.createElement('style');
    s.textContent = css;
    (document.head || document.documentElement).appendChild(s);
}

function sendCustomEvent(name, data = []) {
    if (getBrowser() === "Firefox")
        data = cloneInto(data, window);
    const event = new CustomEvent("Beyond20_" + name, { "detail": data });
    document.dispatchEvent(event);
}

function addCustomEventListener(name, callback) {
    const event = ["Beyond20_" + name, (evt) => {
        const detail = evt.detail || [];
        callback(...detail)
    }, false];
    document.addEventListener(...event);
    return event;
}

function roll20Title(title) {
    return title.replace(" | Roll20", "");
}

function isRoll20(title) {
    return title.includes("| Roll20");
}

function isFVTT(title) {
    return title.includes("Foundry Virtual Tabletop");
}

function fvttTitle(title) {
    return title.replace(" • Foundry Virtual Tabletop", "");
}

function urlMatches(url, matching) {
    return url.match(matching.replace(/\*/g, "[^]*")) !== null;
}

function isCustomDomainUrl(tab) {
    // FVTT is handled separately from custom domains
    if (isFVTT(tab.title)) return false;
    for (const url of ((settings || {})["custom-domains"] || [])) {
        if (urlMatches(tab.url, url)) return true;
    }
    return false;
}

function isSupportedVTT(tab) {
    return SUPPORTED_VTT_URLS.some(url => urlMatches(tab.url, url))
}

function alertSettings(url, title) {
    if (alertify.Beyond20Settings === undefined)
        alertify.dialog('Beyond20Settings', function () { return {}; }, false, "alert");

    const popup = chrome.runtime.getURL(url);
    const img = E.img({ src: chrome.runtime.getURL("images/icons/icon32.png"), style: "margin-right: 3px;" })
    const iframe = E.iframe({ src: popup, style: "width: 100%; height: 100%;", frameborder: "0", scrolling: "yes" });
    const dialog = alertify.Beyond20Settings(img.outerHTML + title, iframe);
    const width = Math.min(720, window.innerWidth / 2); // 720px width or 50% on small screens
    dialog.set('padding', false).set('resizable', true).set('overflow', false).resizeTo(width, "80%");

}
function alertQuickSettings() {
    alertSettings("popup.html", "WayBeyond20 Quick Settings");
}
function alertFullSettings() {
    alertSettings("options.html", "WayBeyond20 Settings");
}

function isListEqual(list1, list2) {
    const list1_str = list1.join(",");
    const list2_str = list2.join(",");
    return list1_str == list2_str;

}
function isObjectEqual(obj1, obj2) {
    const obj1_str = Object.entries(obj1).join(",");
    const obj2_str = Object.entries(obj2).join(",");
    return obj1_str == obj2_str;
}

// replaces matchAll, requires a non global regexp
function reMatchAll(regexp, string) {
    const matches = string.match(new RegExp(regexp, "gm"));
    if (matches) {
        let start = 0;
        return matches.map(group0 => {
            const match = group0.match(regexp);
            match.index = string.indexOf(group0, start);
            start = match.index;
            return match;
        });
    }
    return matches;
}

/**
 * Some users somehow inject html into their comments which include alertify classes
 * which can negatively impact how the page renders. We should remove those in order
 * to clean up the page
 */
function cleanupAlertifyComments() {
    const comments = $(".listing-comments");
    comments.find(".alertify, .alertify-notifier").remove();
}

E = new Proxy({}, {
    get: function (obj, name) {
        return new Proxy(function () { }, {
            apply: (target, thisArg, argumentsList) => {
                const attributes = argumentsList[0] || {};
                const children = argumentsList.slice(1);
                const e = document.createElement(name);
                for (const [name, value] of Object.entries(attributes))
                    e.setAttribute(name, value);
                for (const child of children)
                    e.append(child);
                return e;
            }
        });
    }
});


// Lay on Hands window (Bill's specification, 2026-09-15): an amount box with [−]/[+] steppers
// (Heal only; Purify Poison has a fixed cost) and one confirm button per target. A confirm click
// resolves the prompt with the form (data-selected = self|other, data-amount) and closes it;
// later clicks are ignored. The footer confirm button is hidden, so Enter, Cancel and close all
// resolve without a target, which the caller treats as Cancel.
function wayBeyond20WireLayOnHandsForm(form, { okButton = null, resolve, close }) {
    // One touch, one Bonus Action, with the pool allocated across the selected options. The pool
    // line is a working preview only: nothing is committed until Confirm dispatches successfully.
    if (okButton) okButton.style.display = "none";
    const input = form.querySelector("input[name='lay-on-hands-amount']");
    const error = form.querySelector(".waybeyond20-lay-on-hands-error");
    const remainingLabel = form.querySelector("[data-lay-on-hands-remaining]");
    const usingLabel = form.querySelector("[data-lay-on-hands-using]");
    const minusButton = form.querySelector("button[data-lay-on-hands-step='-1']");
    const plusButton = form.querySelector("button[data-lay-on-hands-step='1']");
    const rawPool = form.getAttribute("data-pool");
    const pool = /^\d+$/.test(String(rawPool || "")) ? parseInt(rawPool) : null;
    const purifyCost = parseInt(form.getAttribute("data-purify-cost")) || 0;
    const optionButtons = Array.from(form.querySelectorAll("button[data-lay-on-hands-option]"));

    const isSelected = key => {
        const button = optionButtons.find(candidate => candidate.getAttribute("data-lay-on-hands-option") === key);
        return !!button && button.getAttribute("aria-pressed") === "true";
    };
    const healingAmount = () => {
        if (!isSelected("healing") || !input) return 0;
        const value = String(input.value === undefined || input.value === null ? "" : input.value).trim();
        return /^\d+$/.test(value) ? parseInt(value) : NaN;
    };
    const allocated = () => {
        const healing = healingAmount();
        return (Number.isFinite(healing) ? healing : 0) + (isSelected("purify") ? purifyCost : 0);
    };
    const showError = text => { if (error) error.textContent = text; };

    const sync = () => {
        for (const button of optionButtons) {
            const key = button.getAttribute("data-lay-on-hands-option");
            const selected = button.getAttribute("aria-pressed") === "true";
            button.classList.toggle("waybeyond20-lay-on-hands-option-selected", selected);
            const panel = form.querySelector(`[data-for-option="${key}"]`);
            if (panel) panel.hidden = !selected;
            // Purify Poison is offered whenever the pool can pay for it at all. It is not held
            // hostage by the healing amount: the amount box is prefilled with the whole pool, so
            // gating on "unallocated" points greyed Purify out on every full pool (1.65.3, Bill
            // live 2026-10-04). Choosing Purify makes room for itself instead -- see the toggle.
            if (key === "purify" && pool !== null) {
                const affordable = pool >= purifyCost;
                button.disabled = !affordable;
                button.classList.toggle("waybeyond20-lay-on-hands-option-disabled", !affordable);
            } else if (key === "purify") {
                button.disabled = false;
                button.classList.remove("waybeyond20-lay-on-hands-option-disabled");
            }
        }
        const using = allocated();
        if (usingLabel) usingLabel.textContent = String(using);
        if (remainingLabel && pool !== null) {
            remainingLabel.textContent = String(Math.max(0, pool - using));
        }
        // The steppers grey out at their limits rather than silently doing nothing: + is dead
        // at the top of the pool (or at pool - 5 with Purify in), - is dead at 1.
        const healingOn = isSelected("healing");
        const amount = healingAmount();
        const ceiling = pool === null ? Infinity : pool - (isSelected("purify") ? purifyCost : 0);
        const setStep = (button, disabled) => {
            if (!button) return;
            button.disabled = disabled;
            button.classList.toggle("waybeyond20-lay-on-hands-step-disabled", disabled);
        };
        setStep(minusButton, !healingOn || !(Number.isFinite(amount) && amount > 1));
        setStep(plusButton, !healingOn || (Number.isFinite(amount) && amount >= ceiling));
    };

    form.addEventListener("submit", event => event.preventDefault());
    form.addEventListener("input", () => { showError(""); sync(); });
    form.addEventListener("click", event => {
        const origin = event.target && event.target.closest ? event.target : null;
        if (!origin || form.getAttribute("data-selected")) return;

        const option = origin.closest("button[data-lay-on-hands-option]");
        if (option) {
            event.preventDefault();
            if (option.disabled) return;
            const key = option.getAttribute("data-lay-on-hands-option");
            const turningOn = option.getAttribute("aria-pressed") !== "true";
            option.setAttribute("aria-pressed", turningOn ? "true" : "false");
            // The option just chosen takes priority, and the other one makes room for it. With a
            // known pool, healing may claim at most pool - 5 once Purify is in; if that leaves no
            // healing at all, Healing switches off rather than sit at an impossible amount.
            if (turningOn && pool !== null && input) {
                const other = optionButtons.find(candidate => candidate !== option);
                const otherOn = !!other && other.getAttribute("aria-pressed") === "true";
                const room = pool - purifyCost;
                if (key === "purify" && otherOn) {
                    const healing = healingAmount();
                    if (room < 1) other.setAttribute("aria-pressed", "false");
                    else if (!Number.isFinite(healing) || healing > room) input.value = String(room);
                } else if (key === "healing" && otherOn) {
                    const value = String(input.value === undefined || input.value === null ? "" : input.value).trim();
                    const healing = /^\d+$/.test(value) ? parseInt(value) : NaN;
                    if (room < 1) other.setAttribute("aria-pressed", "false");
                    else if (!Number.isFinite(healing) || healing > room) input.value = String(room);
                }
            }
            showError("");
            sync();
            return;
        }

        const step = origin.closest("button[data-lay-on-hands-step]");
        if (step) {
            event.preventDefault();
            if (!input || step.disabled) return;
            const current = healingAmount();
            const ceiling = pool === null ? Infinity : pool - (isSelected("purify") ? purifyCost : 0);
            const next = (Number.isFinite(current) ? current : 0) + (parseInt(step.getAttribute("data-lay-on-hands-step")) || 0);
            input.value = String(Math.min(ceiling, Math.max(1, next)));
            showError("");
            sync();
            return;
        }

        const confirm = origin.closest("button[data-lay-on-hands-target]");
        if (!confirm) return;
        event.preventDefault();
        const healing = healingAmount();
        if (!isSelected("healing") && !isSelected("purify")) {
            showError("Choose Healing, Purify Poison, or both.");
            return;
        }
        if (isSelected("healing") && (!Number.isFinite(healing) || healing < 1)) {
            showError("Enter a whole number of at least 1.");
            return;
        }
        form.setAttribute("data-selected", confirm.getAttribute("data-lay-on-hands-target"));
        form.setAttribute("data-healing", isSelected("healing") ? String(healing) : "0");
        form.setAttribute("data-purify", isSelected("purify") ? "1" : "0");
        form.querySelectorAll("button").forEach(button => { button.disabled = true; });
        resolve(form);
        // Closing runs the cancel callback, which cannot change a resolved prompt.
        close();
    });

    sync();
}

function initializeAlertify() {
    alertify.set("alert", "title", "WayBeyond20");
    alertify.set("notifier", "position", "top-center");

    alertify.defaults.transition = "zoom";
    if (alertify.Beyond20Prompt === undefined) {
        const factory = function () {
            return {
                "settings": {
                    "content": undefined,
                    "ok_label": undefined,
                    "cancel_label": undefined,
                    "resolver": undefined,
                },
                "main": function (title, content, ok_label, cancel_label, resolver) {
                    this.set('title', title);
                    this.set('content', content);
                    this.set('resolver', resolver);
                    this.set('ok_label', ok_label);
                    this.set("cancel_label", cancel_label);
                },
                "setup": () => {
                    return {
                        "buttons": [
                            {
                                "text": alertify.defaults.glossary.ok,
                                "key": 13, //keys.ENTER;
                                "className": alertify.defaults.theme.ok,
                            },
                            {
                                "text": alertify.defaults.glossary.cancel,
                                "key": 27, //keys.ESC;
                                "invokeOnClose": true,
                                "className": alertify.defaults.theme.cancel,
                            }
                        ],
                        "focus": {
                            "element": 0,
                            "select": true
                        },
                        "options": {
                            "maximizable": false,
                            "resizable": false
                        }
                    }
                },
                "build": () => { },
                "prepare": function () {
                    this.elements.content.innerHTML = this.get('content');
                    this.__internal.buttons[0].element.innerHTML = this.get('ok_label');
                    this.__internal.buttons[1].element.innerHTML = this.get('cancel_label');
                    // The dialog instance is reused. Clear a Proceed lock left by an earlier
                    // Smite or Elemental Strike query that was cancelled before a choice.
                    const okButton = this.__internal.buttons[0].element;
                    okButton.disabled = false;
                    okButton.removeAttribute("aria-disabled");
                    okButton.classList.remove("waybeyond20-query-proceed-disabled");
                    okButton.style.display = "";

                    // WayBeyond20 smite queries use two radio groups. Keep the
                    // Proceed button disabled until both groups contain a legal
                    // selection. Fuel choices are also constrained by the
                    // selected spell's minimum slot level; Paladin's Smite is
                    // legal only for Divine Smite.
                    const smiteForm = this.elements.content.querySelector("form.waybeyond20-smite-query");
                    if (smiteForm) {
                        const proceed = this.__internal.buttons[0].element;
                        const syncSmiteChoices = () => {
                            const smite = smiteForm.querySelector("input[name='smite-type']:checked");
                            const fuelInputs = Array.from(smiteForm.querySelectorAll("input[name='smite-fuel']"));
                            fuelInputs.forEach(input => {
                                const isFreeDivine = input.getAttribute("data-smite-fuel") === "paladin-smite";
                                const smiteLevel = Math.max(1, parseInt(smite && smite.getAttribute("data-smite-level")) || 1);
                                const slotLevel = parseInt(input.getAttribute("data-slot-level")) || 0;
                                const isDivineSmite = !!smite && String(smite.value || "").trim().toLowerCase() === "divine smite";
                                const legal = !smite || (isFreeDivine ? isDivineSmite : slotLevel >= smiteLevel);
                                input.disabled = !legal;
                                const label = input.closest("label");
                                if (label) label.classList.toggle("waybeyond20-smite-option-disabled", !legal);
                                if (!legal && input.checked) input.checked = false;
                            });
                            smiteForm.querySelectorAll("input[name='smite-type'],input[name='smite-fuel']").forEach(input => {
                                const label = input.closest("label");
                                if (label) label.classList.toggle("waybeyond20-smite-option-selected", input.checked);
                            });
                            const fuel = smiteForm.querySelector("input[name='smite-fuel']:checked");
                            const ready = !!(smite && fuel && !fuel.disabled);
                            proceed.disabled = !ready;
                            proceed.setAttribute("aria-disabled", String(!ready));
                            proceed.classList.toggle("waybeyond20-query-proceed-disabled", !ready);
                        };
                        smiteForm.addEventListener("change", syncSmiteChoices);
                        smiteForm.addEventListener("click", () => setTimeout(syncSmiteChoices, 0));
                        syncSmiteChoices();
                    }

                    // Elemental Strike chooser: each option is an action button. The first
                    // click resolves the prompt with that option and closes it; the footer
                    // confirm button is hidden and later clicks are ignored. Cancel/close
                    // still resolves null through the callback.
                    const elementalForm = this.elements.content.querySelector("form.waybeyond20-elemental-strike-query");
                    if (elementalForm) {
                        const dialog = this;
                        const resolver = this.get('resolver');
                        okButton.style.display = "none";
                        elementalForm.addEventListener("submit", event => event.preventDefault());
                        elementalForm.addEventListener("click", event => {
                            const button = event.target && event.target.closest
                                ? event.target.closest("button[data-elemental-strike]")
                                : null;
                            if (!button) return;
                            event.preventDefault();
                            if (elementalForm.getAttribute("data-selected")) return;
                            elementalForm.setAttribute("data-selected", button.getAttribute("data-elemental-strike"));
                            elementalForm.querySelectorAll("button[data-elemental-strike]").forEach(choice => {
                                choice.disabled = true;
                            });
                            resolver.call(dialog, $(elementalForm));
                            // Closing runs the cancel callback, which cannot change a resolved prompt.
                            dialog.close();
                        });
                    }

                    const layOnHandsForm = this.elements.content.querySelector("form.waybeyond20-lay-on-hands-query");
                    if (layOnHandsForm) {
                        const dialog = this;
                        const resolver = this.get('resolver');
                        wayBeyond20WireLayOnHandsForm(layOnHandsForm, {
                            okButton,
                            resolve: form => resolver.call(dialog, $(form)),
                            close: () => dialog.close()
                        });
                    }
                },
                "callback": function (closeEvent) {
                    if (closeEvent.index == 0) {
                        this.get('resolver').call(this, $(this.elements.content.firstElementChild));
                    } else {
                        this.get('resolver').call(this, null);
                    }
                }
            }
        }
        alertify.dialog('Beyond20Prompt', factory, false, "prompt");
    }


    if (alertify.Beyond20Roll === undefined)
        alertify.dialog('Beyond20Roll', function () { return {}; }, false, "alert");

}

const bouncedFallbackRenders = {};
function simpleHash(input) {
    let hash = 0;
    for (let i = 0; i < input.length; i++) {
        const char = input.charCodeAt(i);
        hash = (hash << 5) - hash + char;
        hash |= 0; // Convert to 32-bit integer
    }
    return hash;
}

function forwardMessageToDOM(request) {
    if (request.action == "hp-update") {
        sendCustomEvent("UpdateHP", [request, request.character.name, request.character.hp, request.character["max-hp"], request.character["temp-hp"]]);
    } else if (request.action === "update-combat") {
        sendCustomEvent("UpdateCombat", [request, request.combat, settings]);
    } else if (request.action == "conditions-update") {
        sendCustomEvent("UpdateConditions", [request, request.character.name, request.character.conditions, request.character.exhaustion]);
    } else if (request.action == "effects-update") {
        sendCustomEvent("UpdateEffects", [request, request.character.name, request.effects || [], request.concentration || null]);
    } else if (request.action == "roll") {
        // Let's run it through the roll renderer and let the site decide to use
        // the original request or the rendered version
        // Requires roll_renderer to be set (currently in generic-site and ddb pages)
        roll_renderer.handleRollRequest(request);
    } else if (request.action == "rendered-roll") {
        // Hash the original request to be able to match it with the rendered one in case of fallback
        // But don't use the whole request since it can change by the time we render it (original-whisper is added)
        const reqHash = simpleHash(JSON.stringify({
            action: request.request.action,
            type: request.request.type,
            character: request.request.character,
            roll: request.request.roll,
            name: request.request.name,
            ability: request.request.ability,
            modifier: request.request.modifier,
            description: request.request.description
        }));
        if (request.rendered === "fallback") {
            // This is a fallback render, if we're sending it from DDB, we might end up with
            // a double render, so bounce this one for 500ms to let the real render happen if it's
            // going to, then override the fallback render if we do.
            bouncedFallbackRenders[reqHash] = setTimeout(() => {
                delete bouncedFallbackRenders[reqHash];
                sendCustomEvent("RenderedRoll", [request]);
            }, 500);
        } else {
            clearTimeout(bouncedFallbackRenders[reqHash]);
            delete bouncedFallbackRenders[reqHash];
            sendCustomEvent("RenderedRoll", [request]);
        }
    }
}

// see https://stackoverflow.com/a/2117523
function uuidv4() {
    return "10000000-1000-4000-8000-100000000000".replace(/[018]/g, c =>
        (+c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> +c / 4).toString(16)
    );
}
