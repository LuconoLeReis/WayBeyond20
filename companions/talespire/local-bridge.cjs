// WB20-owned loopback return feed. Node built-ins only; no game writes.
const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const PORT = 48874;
const label = (v, max = 140) => String(v || '').replace(/[\u0000-\u001f]/g, ' ').slice(0, max);
function normalizeSnapshot(input) {
    if (!input || input.v !== 1 || typeof input.boardId !== 'string' || !input.boardId || input.boardId.length > 128 ||
        !Array.isArray(input.creatures) || input.creatures.length > 200 || !Array.isArray(input.order) || input.order.length > 200)
        throw Error('Invalid board snapshot');
    const creatures = input.creatures.map(c => {
        if (!c || typeof c.id !== 'string' || !c.id || c.id.length > 128) throw Error('Invalid mini');
        const p = c.position;
        const position = p && [p.x, p.y, p.z, p.locId].every(Number.isFinite) && [p.x, p.y, p.z].every(n => Math.abs(n) < 1e7)
            ? {x:p.x, y:p.y, z:p.z, locId:p.locId} : null;
        return {id:c.id, name:label(c.name), boardId:label(c.boardId,128), position};
    });
    if (new Set(creatures.map(c => c.id)).size !== creatures.length) throw Error('Duplicate mini');
    const order = input.order.map(c => {
        if (!c || c.kind !== 'creature' || typeof c.id !== 'string' || c.id.length > 128) throw Error('Invalid turn entry');
        return {id:c.id, name:label(c.name), kind:'creature'};
    });
    const activeIndex = Number.isInteger(input.activeIndex) && input.activeIndex >= 0 && input.activeIndex < order.length ? input.activeIndex : -1;
    const scale = input.units?.numberPerTile;
    return {v:1, boardId:input.boardId, campaignId:label(input.campaignId,128), creatures, order, activeIndex,
        tracking:input.tracking === true, activeHidden:input.activeHidden === true,
        targetId:creatures.some(c => c.id === input.targetId) ? input.targetId : '',
        targetRevision:Number.isSafeInteger(input.targetRevision) && input.targetRevision >= 0 ? input.targetRevision : 0,
        targetSession:label(input.targetSession,80),
        units:{name:label(input.units?.name,24), numberPerTile:Number.isFinite(scale) && scale > 0 && scale < 1e6 ? scale : null}};
}
function createBridge({key = crypto.randomBytes(32).toString('hex'), extensionId, now = Date.now} = {}) {
    if (!/^[a-p]{32}$/.test(extensionId || '')) throw Error('A Chrome extension ID is required');
    let snapshot = null, updatedAt = 0, commands = [];
    const server = http.createServer(async (req,res) => {
        const origin = req.headers.origin || '';
        const host = req.headers.host || '';
        const finish = (status, data) => {res.writeHead(status, {'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}); res.end(JSON.stringify(data));};
        if (!/^127\.0\.0\.1:\d+$/.test(host)) return finish(403,{error:'Invalid host'});
        // Pairing is only available to the configured extension, not web pages.
        const extensionOrigin = `chrome-extension://${extensionId}`;
        const pairing = req.url === '/pair';
        if (pairing && origin && origin !== extensionOrigin) return finish(403,{error:'Wrong pairing origin'});
        if (origin) res.setHeader('Access-Control-Allow-Origin',origin);
        res.setHeader('Vary','Origin');
        res.setHeader('Access-Control-Allow-Methods','GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers','Authorization, Content-Type, X-WB20-Extension');
        res.setHeader('Access-Control-Allow-Private-Network','true');
        if (req.method === 'OPTIONS') return finish(204,{});
        if (pairing && req.method === 'GET' && req.headers['x-wb20-extension'] === extensionId) return finish(200,{key});
        if (req.headers.authorization !== `Bearer ${key}`) return finish(401,{error:'Not paired'});
        try {
            if (req.method === 'GET' && req.url === '/state') return finish(200,{connected:!!snapshot && now()-updatedAt < 10000, snapshot, updatedAt});
            if (req.method === 'GET' && req.url === '/commands') {const pending = commands; commands=[]; return finish(200,pending);}
            if (req.method !== 'POST' || !['/state','/command'].includes(req.url)) return finish(404,{error:'Unknown route'});
            let size=0; const chunks=[];
            for await (const chunk of req) {size+=chunk.length; if (size > 131072) return finish(413,{error:'Too large'}); chunks.push(chunk);}
            const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            if (req.url === '/state') {snapshot=normalizeSnapshot(value); updatedAt=now(); return finish(200,{ok:true});}
            if (value?.type !== 'pick-target' || commands.length >= 10) return finish(400,{error:'Invalid command'});
            commands.push({type:'pick-target', id:crypto.randomUUID()});
            return finish(200,{ok:true});
        } catch (_) {return finish(400,{error:'Invalid data'});}
    });
    server.requestTimeout=5000; server.headersTimeout=5000;
    return {server,key};
}
module.exports={createBridge,normalizeSnapshot,PORT};
if (require.main === module) {
    const extensionId=process.argv[2], symbiote=path.resolve(process.argv[3] || '');
    if (!fs.existsSync(path.join(symbiote,'manifest.json'))) throw Error('Pass the installed WB20 Symbiote directory');
    const bridge=createBridge({extensionId});
    bridge.server.once('error',error=>{console.error(`WB20 return helper: ${error.code || 'failed'}`); process.exitCode=1;});
    bridge.server.listen(PORT,'127.0.0.1',()=>{
        // Generated local configuration is deliberately excluded from source/releases.
        fs.writeFileSync(path.join(symbiote,'local-config.js'),`var wb20LocalReturnKey = ${JSON.stringify(bridge.key)};\n`);
        console.log(`WB20 read-only TaleSpire return feed listening on 127.0.0.1:${PORT}`);
    });
}
