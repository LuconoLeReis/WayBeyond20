// Official Symbiote API 0.1. No eval, server, native library or campaign writes.
var wb20TaleSpireReady = Promise.resolve();
var wb20TaleSpireQueue = Promise.resolve();
var wb20TaleSpireRecent = [];
try { wb20TaleSpireRecent = JSON.parse(localStorage.getItem('wb20-received-v1') || '[]'); } catch (_) {}
if (!Array.isArray(wb20TaleSpireRecent)) wb20TaleSpireRecent = [];

function wb20TaleSpireStatus(text) {
    document.getElementById('status').textContent = text;
}
function wb20TaleSpireSafeText(value, max = 200) {
    // Unity chat supports rich text; incoming browser labels are plain text.
    return String(value || '').replace(/[<>]/g, c => c === '<' ? '‹' : '›')
        .replace(/[\u0000-\u001f]/g, ' ').slice(0, max);
}
async function wb20TaleSpireCall(promise) {
    const result = await promise;
    if (result && result.cause) throw new Error(String(result.cause));
    return result;
}
function wb20TaleSpireResultValue(result, depth = 0, budget = {nodes: 0}) {
    if (!result || depth > 45 || ++budget.nodes > 180) throw new Error('Invalid WB20 dice detail.');
    if (Object.keys(result).length === 1 && Number.isInteger(result.value) && Math.abs(result.value) <= 2147483647) return result.value;
    if (Object.keys(result).length === 2 && /^d(4|6|8|10|12|20|100)$/.test(result.kind) &&
        Array.isArray(result.results) && result.results.length > 0 && result.results.length <= 100 &&
        result.results.every(value => Number.isInteger(value) && value >= 1 && value <= Number(result.kind.slice(1))))
        return result.results.reduce((sum, value) => sum + value, 0);
    if (Object.keys(result).length === 2 && ['+', '-'].includes(result.operator) && Array.isArray(result.operands) && result.operands.length === 2) {
        const left = wb20TaleSpireResultValue(result.operands[0], depth + 1, budget);
        const right = wb20TaleSpireResultValue(result.operands[1], depth + 1, budget);
        return result.operator === '+' ? left + right : left - right;
    }
    throw new Error('Invalid WB20 dice detail.');
}
function wb20TaleSpireValidate(packet) {
    if (!packet || packet.v !== 1 || !/^[a-zA-Z0-9-]{10,80}$/.test(packet.id) ||
        !['board', 'gms'].includes(packet.audience) || !Array.isArray(packet.rows) || packet.rows.length > 20)
        throw new Error('Invalid WB20 message.');
    for (const key of ['who', 'title'])
        if (typeof packet[key] !== 'string' || packet[key].length > 160) throw new Error('Invalid WB20 label.');
    for (const row of packet.rows) {
        if (!row || typeof row.name !== 'string' || row.name.length > 160 ||
            typeof row.formula !== 'string' || row.formula.length > 500 ||
            !Number.isInteger(row.total) || Math.abs(row.total) > 2147483647)
            throw new Error('Invalid WB20 result.');
        if (row.diceResult != null && wb20TaleSpireResultValue(row.diceResult) !== row.total)
            throw new Error('WB20 dice detail does not match its total.');
    }
    return packet;
}
function wb20TaleSpireRemember(id) {
    wb20TaleSpireRecent.push(id);
    wb20TaleSpireRecent = wb20TaleSpireRecent.slice(-200);
    try { localStorage.setItem('wb20-received-v1', JSON.stringify(wb20TaleSpireRecent)); } catch (_) {}
}
async function wb20TaleSpireReceive(packet) {
    wb20TaleSpireValidate(packet);
    if (wb20TaleSpireRecent.includes(packet.id)) return false;
    const board = await wb20TaleSpireCall(TS.boards.whereAmI());
    if (!board || !board.id) throw new Error('Load a TaleSpire board first.');
    // Record before the game API to prevent duplicated output on reentrant URLs
    // or a reload after an ambiguous game response. Failed handoffs are not retried.
    wb20TaleSpireRemember(packet.id);
    const who = wb20TaleSpireSafeText(packet.who, 100);
    const title = wb20TaleSpireSafeText(packet.title, 140);
    const summary = `${who} — ${title}`;
    if (packet.rows.length && packet.audience === 'board') {
        const groups = packet.rows.map(row => ({
            name: `${summary}: ${wb20TaleSpireSafeText(row.name, 140)}${row.critical ? ' [Critical]' : ''}${row.failure ? ' [Critical failure]' : ''} (${wb20TaleSpireSafeText(row.formula, 500)})`,
            // Report the actual WB20 total, never invent or reroll die faces.
            result: row.diceResult || {value: row.total}
        }));
        await wb20TaleSpireCall(TS.dice.sendDiceResult(groups));
    } else {
        // sendDiceResult has no audience parameter. Never use it for whispers.
        const lines = [summary, ...packet.rows.map(row => `${wb20TaleSpireSafeText(row.name, 140)}: ${row.total} (${wb20TaleSpireSafeText(row.formula, 500)})`)];
        const chunks = [];
        for (const line of lines) for (let i = 0; i < line.length; i += 380) chunks.push(line.slice(i, i + 380));
        for (const chunk of chunks) await wb20TaleSpireCall(TS.chat.send(chunk, packet.audience));
    }
    const item = document.createElement('li');
    item.textContent = `${summary}: ${packet.rows.length ? packet.rows.map(row => row.total).join(', ') : 'card'}${packet.audience === 'gms' ? ' — GMs only' : ''}`;
    const history = document.getElementById('history');
    history.prepend(item);
    while (history.children.length > 12) history.lastElementChild.remove();
    wb20TaleSpireStatus('Received from WB20. No additional dice rolled.');
    // Small opt-in-to-install diagnostic, no character data or formula dump.
    try { await TS.debug.log({event: 'wb20-received', id: packet.id, rows: packet.rows.length, audience: packet.audience}); } catch (_) {}
    return true;
}
function wb20TaleSpireMessage(event) {
    if (event.kind !== 'urlMessageReceived') return;
    const encoded = event.payload?.str;
    wb20TaleSpireQueue = wb20TaleSpireQueue.then(async () => {
        await wb20TaleSpireReady;
        if (typeof encoded !== 'string' || encoded.length > 7500 || !/^[A-Za-z0-9_-]+$/.test(encoded))
            throw new Error('Invalid WB20 URL payload.');
        const bytes = Uint8Array.from(atob(encoded.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
        await wb20TaleSpireReceive(JSON.parse(new TextDecoder().decode(bytes)));
    }).catch(error => { wb20TaleSpireStatus(`Not sent: ${String(error.message || error)}. No automatic retry.`); });
    return wb20TaleSpireQueue;
}
function wb20TaleSpireState(event) {
    if (event.kind !== 'hasInitialized') return;
    // A disconnected optional board feed must never prevent ordinary roll output.
    if (typeof wb20ReturnState === 'function') Promise.resolve().then(()=>wb20ReturnState(event)).catch(error=>{
        const node=document.getElementById('return-status');
        if (node) node.textContent='Board connection unavailable: '+String(error.message || error);
        try {TS.debug.log({event:'wb20-return-init-error',message:String(error.message || error)}).catch(()=>{});} catch (_) {}
    });
    wb20TaleSpireReady = (async () => {
        const prefix = await wb20TaleSpireCall(TS.urls.createUrlPrefixForThisSymbiote());
        document.getElementById('connection').value = prefix;
        const copy = document.getElementById('copy');
        copy.disabled = false;
        copy.onclick = async () => {
            try { await wb20TaleSpireCall(TS.system.clipboard.setText(prefix)); wb20TaleSpireStatus('Connection copied. Paste it into WB20 settings.'); }
            catch (_) { document.getElementById('connection').select(); wb20TaleSpireStatus('Select and copy the connection above.'); }
        };
        const test = document.getElementById('test');
        test.disabled = false;
        test.onclick = async () => {
            test.disabled = true;
            try { await wb20TaleSpireReceive({v: 1, id: crypto.randomUUID(), who: 'WB20 connector test', title: 'Fixed diagnostic result', audience: 'board', rows: [{name: 'Test only', formula: '20 (fixed, not rolled)', total: 20}]}); }
            catch (error) { wb20TaleSpireStatus(`Test failed: ${String(error.message || error)}`); }
            finally { test.disabled = false; }
        };
        wb20TaleSpireStatus('Ready. Copy the connection into WB20.');
        try { await TS.debug.log({event: 'wb20-ready', prefix}); } catch (_) {}
    })().catch(error => { wb20TaleSpireStatus(`Connection unavailable: ${String(error.message || error)}`); throw error; });
    return wb20TaleSpireReady;
}
