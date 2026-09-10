var advancedOptions = false;

function createOptionList() {
    $("main .beyond20-options").remove();
    const options = [];
    for (let option in options_list) {
        const child = createHTMLOption(option, false, options_list, {advanced: advancedOptions});
        if (child)
            options.push(child);
    }
    $("main").prepend(E.ul({ class: "list-group beyond20-options" }, ...options));
}

function save_settings() {
    saveSettings((settings) => {
        if (chrome.runtime.lastError) {
            console.log('Chrome Runtime Error', chrome.runtime.lastError.message);
        } else {
            chrome.runtime.sendMessage({ "action": "settings", "type": "general", "settings": settings });
            $('.success').toggleClass('show');
            setTimeout(() => $('.success').toggleClass('show'), 3000);
        }
    });
}

function gotSettings(stored_settings) {
    $("ul").removeClass("disabled");
}

function setupHTML() {
    createOptionList();
    $("ul").addClass("disabled");
    initializeSettings(gotSettings);
    $('.beyond20-option-input').change(save_settings);
    $(".beyond20-options").on("markaChanged", save_settings);
    $(document).on('click', 'a', function (ev) {
        const href = this.getAttribute('href');
        if (href.length > 0 && href != "#") 
            window.open(this.href);
        return false;
    });
}

function setupOptionsMenu() {
    setupHTML();
    $('#save').on('click', save_settings);
    $('#advanced').on('click', (ev) => {
        advancedOptions = !advancedOptions;
        $(ev.target).text(advancedOptions ? "Basic Options" : "Advanced Options");
        setupHTML();
    });
    $('#display-current-settings').on('click', wayBeyond20DisplayCurrentSettings);
    $('#copy-current-settings').on('click', () => wayBeyond20CopyTextArea('#settings-report', '#copy-current-settings'));
    $('#close-current-settings').on('click', () => $('#settings-report-panel').addClass('hide'));
    $('#display-debug-log').on('click', wayBeyond20DisplayDebugLog);
    $('#refresh-debug-log').on('click', wayBeyond20DisplayDebugLog);
    $('#copy-debug-log').on('click', () => wayBeyond20CopyTextArea('#debug-log', '#copy-debug-log'));
    $('#clear-debug-log').on('click', wayBeyond20ClearDebugLog);
    $('#close-debug-log').on('click', () => $('#debug-log-panel').addClass('hide'));

}


function wayBeyond20FormatCurrentSettingValue(value, definition = null) {
    if (value === undefined) return "(unset)";
    if (definition && definition.type === "bool") return value ? "On" : "Off";
    if (definition && definition.type === "combobox" && definition.choices) {
        const label = definition.choices[String(value)];
        if (label !== undefined) return `${label} [${String(value)}]`;
    }
    if (value === null) return "None";
    if (typeof value === "object") {
        try {
            return JSON.stringify(value, null, 2).replace(/\n/g, "\n    ");
        } catch (error) {
            return String(value);
        }
    }
    return String(value);
}

function wayBeyond20AppendCurrentSettingsSection(lines, heading, values, definitions) {
    lines.push(heading);
    lines.push("=".repeat(heading.length));
    const defaults = getDefaultSettings(definitions);
    const current = Object.assign({}, defaults, values || {});
    const knownKeys = Object.keys(definitions);
    for (const key of knownKeys) {
        const definition = definitions[key] || {};
        if (definition.type === "migrate") continue;
        const label = definition.title || definition.short || key;
        const flags = [];
        if (definition.advanced) flags.push("advanced");
        if (definition.hidden) flags.push("hidden");
        const suffix = flags.length ? ` (${flags.join(", ")})` : "";
        lines.push(`${label}${suffix}`);
        lines.push(`  Key: ${key}`);
        lines.push(`  Value: ${wayBeyond20FormatCurrentSettingValue(current[key], definition)}`);
        lines.push("");
    }

    const extraKeys = Object.keys(values || {}).filter(key => !knownKeys.includes(key)).sort();
    if (extraKeys.length > 0) {
        lines.push("Additional stored values");
        lines.push("------------------------");
        for (const key of extraKeys) {
            lines.push(`${key}: ${wayBeyond20FormatCurrentSettingValue(values[key])}`);
        }
        lines.push("");
    }
}

function wayBeyond20BuildCurrentSettingsReport(storage) {
    const lines = [
        "WayBeyond20 Current Settings",
        `Generated: ${new Date().toLocaleString()}`,
        `Version: ${chrome.runtime.getManifest().version}`,
        ""
    ];

    wayBeyond20AppendCurrentSettingsSection(lines, "Global settings", storage.settings || {}, options_list);

    const characterKeys = Object.keys(storage)
        .filter(key => /^character-\d+$/.test(key))
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    if (characterKeys.length === 0) {
        lines.push("Character-specific settings");
        lines.push("===========================");
        lines.push("No character-specific settings are currently stored.");
        lines.push("");
    } else {
        for (const key of characterKeys) {
            const id = key.substring("character-".length);
            wayBeyond20AppendCurrentSettingsSection(
                lines,
                `Character-specific settings — ID ${id}`,
                storage[key] || {},
                character_settings
            );
        }
    }

    const otherKeys = Object.keys(storage)
        .filter(key => key !== "settings" && !key.startsWith("character-"))
        .sort();
    if (otherKeys.length > 0) {
        lines.push("Other extension storage");
        lines.push("=======================");
        for (const key of otherKeys) {
            const value = storage[key];
            if (key === WAYBEYOND20_DEBUG_LOG_STORAGE_KEY) {
                const count = Array.isArray(value) ? value.length : 0;
                lines.push(`${key}: ${count} saved entries (use Display Debug Log)`);
            // Report configured integration data without exposing stored channel secrets.
            } else if (key.toLowerCase().includes("discord")) {
                lines.push(`${key}: ${value ? "Configured" : "Not configured"}`);
            } else {
                lines.push(`${key}: ${wayBeyond20FormatCurrentSettingValue(value)}`);
            }
        }
        lines.push("");
    }

    return lines.join("\n");
}

function wayBeyond20DisplayCurrentSettings() {
    storageGetEverything(storage => {
        $("#settings-report").val(wayBeyond20BuildCurrentSettingsReport(storage || {}));
        $("#settings-report-panel").removeClass("hide");
        $("#settings-report").trigger("focus");
    });
}

async function wayBeyond20CopyTextArea(textareaSelector, buttonSelector) {
    const report = $(textareaSelector).val();
    try {
        await navigator.clipboard.writeText(report);
        $(buttonSelector).text('Copied');
        setTimeout(() => $(buttonSelector).text('Copy'), 1200);
    } catch (error) {
        const textarea = $(textareaSelector)[0];
        textarea.focus();
        textarea.select();
        document.execCommand('copy');
    }
}

function wayBeyond20FormatDebugLog(entries) {
    const rows = Array.isArray(entries) ? entries : [];
    const lines = [
        "WayBeyond20 Debug Log",
        `Displayed: ${new Date().toLocaleString()}`,
        `Version: ${chrome.runtime.getManifest().version}`,
        `Entries: ${rows.length}`,
        ""
    ];
    if (rows.length === 0) {
        lines.push("No debug entries are currently saved.");
        return lines.join("\n");
    }
    for (const entry of rows) {
        const timestamp = entry && entry.timestamp ? entry.timestamp : "(no timestamp)";
        const scope = entry && entry.scope ? entry.scope : "WayBeyond20";
        const event = entry && entry.event ? entry.event : "event";
        const context = [];
        if (entry && entry.page) context.push(entry.page);
        if (entry && entry.tabId !== undefined) context.push(`tab ${entry.tabId}`);
        lines.push(`[${timestamp}] [${scope}] ${event}${context.length ? ` — ${context.join(" · ")}` : ""}`);
        if (entry && entry.details !== null && entry.details !== undefined) {
            lines.push(wayBeyond20FormatCurrentSettingValue(entry.details));
        }
        lines.push("");
    }
    return lines.join("\n");
}

function wayBeyond20DisplayDebugLog() {
    storageGet(WAYBEYOND20_DEBUG_LOG_STORAGE_KEY, [], entries => {
        $("#debug-log").val(wayBeyond20FormatDebugLog(entries));
        $("#debug-log-panel").removeClass("hide");
        $("#debug-log").trigger("focus");
        const textarea = $("#debug-log")[0];
        textarea.scrollTop = textarea.scrollHeight;
    });
}

function wayBeyond20ClearDebugLog() {
    storageSet(WAYBEYOND20_DEBUG_LOG_STORAGE_KEY, [], () => {
        wayBeyond20DisplayDebugLog();
        $("#clear-debug-log").text("Cleared");
        setTimeout(() => $("#clear-debug-log").text("Clear"), 1200);
    });
}

setupOptionsMenu();