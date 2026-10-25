// Official TaleSpire Symbiote URL handoff. No server, remote relay or native DLL.
// A browser handoff is acceptance, not acknowledgment from the game.
function wayBeyond20TaleSpirePrefix(value) {
    const prefix = String(value || '').trim();
    if (!/^talespire:\/\/symbiote\/[A-Za-z0-9._~%+=/-]{1,512}\/$/.test(prefix) ||
        prefix.includes('/../') || /%0[ad]/i.test(prefix))
        throw new Error('Open the WayBeyond20 Symbiote in TaleSpire, copy its connection, and paste it into WB20 settings.');
    return prefix;
}

function wayBeyond20TaleSpireDiceResult(roll) {
    // Preserve WB20's actual die faces and arithmetic. Never ask TaleSpire to roll.
    if (!Array.isArray(roll.parts) || !roll.parts.length || roll.parts.length > 40) return null;
    let result = null, total = 0, sign = '+';
    for (const part of roll.parts) {
        if (part === '+' || part === '-') { sign = part; continue; }
        let operand, value;
        if (Number.isInteger(part)) { operand = {value: part}; value = part; }
        else if (part && [4, 6, 8, 10, 12, 20, 100].includes(part.faces) && Array.isArray(part.rolls)) {
            const kept = part.rolls.filter(die => !die.discarded);
            if (!kept.length || kept.length > 100 || kept.some(die => !Number.isInteger(die.roll) || die.roll < 1 || die.roll > part.faces)) return null;
            operand = {kind: 'd' + part.faces, results: kept.map(die => die.roll)};
            value = kept.reduce((sum, die) => sum + die.roll, 0);
            // Minimums and other WB20 adjustments remain arithmetic, not invented faces.
            if (!Number.isInteger(part.total)) return null;
            if (part.total !== value) operand = {operator: '+', operands: [operand, {value: part.total - value}]};
            value = part.total;
        } else return null; // Unsupported shapes retain the exact total/formula below.
        if (!result) result = sign === '-' ? {operator: '-', operands: [{value: 0}, operand]} : operand;
        else result = {operator: sign, operands: [result, operand]};
        total += sign === '-' ? -value : value;
        sign = '+';
    }
    return total === roll.total ? result : null;
}

function wayBeyond20TaleSpirePacket(message) {
    if (message.action !== 'rendered-roll') throw new Error('TaleSpire requires a resolved roll. Refresh the D&D Beyond tab after selecting TaleSpire.');
    const whisper = Number(message.whisper);
    if (![0, 1, 3].includes(whisper)) throw new Error('Resolve the roll audience before sending to TaleSpire.');
    const text = (value, max) => String(value || '').replace(/[\u0000-\u001f]/g, ' ').slice(0, max);
    const who = whisper === 3 ? 'Hidden creature' : text(message.character, 100);
    const title = whisper === 3 ? 'Hidden roll' : text(message.title, 140);
    const rows = [];
    const add = (name, roll) => {
        if (!roll || roll.discarded) return;
        if (!Number.isInteger(roll.total) || Math.abs(roll.total) > 2147483647)
            throw new Error('TaleSpire cannot display this non-integer or oversized roll total.');
        const formula = String(roll.formula || '');
        if (formula.length > 500) throw new Error('This formula is too long for the TaleSpire handoff.');
        rows.push({name: text(name, 140), formula, total: roll.total,
            diceResult: wayBeyond20TaleSpireDiceResult(roll),
            critical: !!roll['critical-success'], failure: !!roll['critical-failure']});
    };
    for (const roll of message.attack_rolls || []) add(title, roll);
    for (const [label, roll] of message.damage_rolls || []) {
        if (roll && typeof roll === 'object') add(label, roll);
    }
    // Some custom/card renderers provide only totals, not component rolls.
    if (!(message.damage_rolls || []).some(row => row[1] && typeof row[1] === 'object'))
        for (const [label, roll] of Object.entries(message.total_damages || {})) add(label, roll);
    if (rows.length > 20) throw new Error('This roll has too many parts for a single TaleSpire handoff.');
    if (!message['waybeyond20-talespire-id']) message['waybeyond20-talespire-id'] = crypto.randomUUID();
    return {v: 1, id: message['waybeyond20-talespire-id'], who, title,
        audience: whisper === 1 ? 'gms' : 'board', rows};
}

function wayBeyond20TaleSpireURL(prefix, packet) {
    const json = JSON.stringify(packet);
    const encoded = btoa(Array.from(new TextEncoder().encode(json), b => String.fromCharCode(b)).join(''))
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const url = wayBeyond20TaleSpirePrefix(prefix) + encoded;
    if (url.length > 7500) throw new Error('This roll is too large for the TaleSpire URL handoff.');
    return url;
}

function wayBeyond20SendTaleSpire(message, sender, sendResponse) {
    const respond = (success, error = null) => sendResponse({success, error, vtt: ['talespire'], request: message});
    // Never forward sheet state to a URL, or accidentally fall through to Roll20.
    if (!['roll', 'rendered-roll'].includes(message.action)) { respond(false); return; }
    // Missing configuration is idle, not a reason to nag on every roll.
    // Preserve the resolved local result without claiming TaleSpire delivery.
    if (!String(settings['talespire-url'] || '').trim()) {
        sendResponse({success:false,error:null,vtt:['dndbeyond'],request:message}); return;
    }
    try {
        if (!sender.tab || !Number.isInteger(sender.tab.id)) throw new Error('Send TaleSpire rolls from an open D&D Beyond tab.');
        const url = wayBeyond20TaleSpireURL(settings['talespire-url'], wayBeyond20TaleSpirePacket(message));
        // External-protocol navigation hands the URL to Windows without replacing
        // the DDB document. Chrome may ask the player to allow TaleSpireUrlRelay.
        chrome.tabs.update(sender.tab.id, {url}, () => {
            const error = chrome.runtime.lastError;
            respond(!error, error ? String(error.message || error) : null);
        });
    } catch (error) { respond(false, String(error.message || error)); }
}
