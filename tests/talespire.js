const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto').webcrypto;
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'src/talespire/bridge.js'), 'utf8');
const receiver = fs.readFileSync(path.join(root, 'companions/talespire/WayBeyond20/bridge.js'), 'utf8');
const prefix = 'talespire://symbiote/test-prefix/';
function sender() {
    const updates = [];
    const chrome = {runtime: {lastError: null}, tabs: {update: (id, data, cb) => {updates.push({id, ...data}); cb();}}};
    const c = vm.createContext({chrome, settings: {'talespire-url': prefix}, crypto, TextEncoder, btoa});
    vm.runInContext(source, c);
    return {c, updates, chrome};
}
function game(saved = new Map()) {
    const calls = [], history = {children: [], prepend(item) {this.children.unshift(item);}};
    const nodes = {history, status: {}, connection: {}, copy: {}, test: {}};
    const TS = {boards: {whereAmI: async () => ({id: 'test-board'})},
        dice: {sendDiceResult: async groups => {calls.push({kind: 'dice', groups}); return 'result-id';}},
        chat: {send: async (text, audience) => {calls.push({kind: 'chat', text, audience});}},
        urls: {createUrlPrefixForThisSymbiote: async () => prefix},
        system: {clipboard: {setText: async value => calls.push({kind: 'clipboard', value})}},
        debug: {log: async () => {}}};
    const c = vm.createContext({TS, crypto, TextDecoder, Uint8Array, atob,
        localStorage: {getItem: key => saved.get(key), setItem: (key, value) => saved.set(key, value)},
        document: {getElementById: id => nodes[id], createElement: () => ({})}});
    vm.runInContext(receiver, c);
    return {c, calls, TS, saved, nodes};
}
function message(whisper = 0) {
    return {action: 'rendered-roll', title: 'Élan / 火', character: 'Test player', whisper,
        attack_rolls: [{formula: '1d20+6', total: 19}, {formula: '1d20+6', total: 9, discarded: true}],
        damage_rolls: [['Fire', {formula: '3d6', total: 12}], ['Piercing', {formula: '1d6+3', total: 7}]], total_damages: {Total: {formula: '12+7', total: 19}}};
}
(async () => {
    const s = sender(), m = message();
    const packet = s.c.wayBeyond20TaleSpirePacket(m);
    assert.equal(packet.rows.length, 3, 'discarded d20 and duplicate total excluded');
    const url = s.c.wayBeyond20TaleSpireURL(prefix, packet);
    assert(url.startsWith(prefix));
    const g = game();
    await g.c.wb20TaleSpireState({kind: 'hasInitialized'});
    assert.equal(g.nodes.connection.value, prefix);
    await g.c.wb20TaleSpireMessage({kind: 'urlMessageReceived', payload: {str: url.slice(prefix.length)}});
    assert.equal(g.calls.length, 1);
    assert.equal(g.calls[0].kind, 'dice');
    assert.equal(g.calls[0].groups[0].result.value, 19);
    assert(g.calls[0].groups[0].name.includes('Élan / 火'));
    assert(g.calls[0].groups[0].name.includes('1d20+6'));
    assert.equal(g.calls[0].groups[1].result.value, 12);
    assert.equal(g.calls[0].groups[2].result.value, 7);
    const detailed = message();
    detailed.attack_rolls[0].parts = [{faces: 20, total: 13, rolls: [{roll: 13}]}, '+', 6];
    detailed.damage_rolls[0][1].parts = [{faces: 6, total: 12, rolls: [{roll: 1, discarded: true}, {roll: 3}, {roll: 4}, {roll: 5}]}];
    detailed.damage_rolls[1][1].parts = [{faces: 6, total: 4, rolls: [{roll: 4}]}, '+', 3];
    const detailPacket = s.c.wayBeyond20TaleSpirePacket(detailed), detailGame = game();
    await detailGame.c.wb20TaleSpireReceive(detailPacket);
    assert.equal(detailGame.calls[0].groups[0].result.operands[0].kind, 'd20');
    assert.equal(detailGame.calls[0].groups[0].result.operands[0].results[0], 13);
    assert.equal(detailGame.calls[0].groups[0].result.operands[1].value, 6);
    assert.equal(JSON.stringify(detailGame.calls[0].groups[1].result.results), '[3,4,5]');
    const tampered = JSON.parse(JSON.stringify(detailPacket)); tampered.id += '-bad'; tampered.rows[0].diceResult.operands[0].results[0] = 20;
    await assert.rejects(() => detailGame.c.wb20TaleSpireReceive(tampered), /match/);
    const adjusted = {total: 8, parts: [{faces: 6, total: 5, rolls: [{roll: 2}]}, '+', 3]};
    assert.equal(detailGame.c.wb20TaleSpireResultValue(s.c.wayBeyond20TaleSpireDiceResult(adjusted)), 8);
    assert.equal(s.c.wayBeyond20TaleSpireDiceResult({total: 99, parts: [1]}), null);
    assert.equal(s.c.wayBeyond20TaleSpireDiceResult({total: 2, parts: [{faces: 3, total: 2, rolls: [{roll: 2}]}]}), null);
    assert.equal(detailGame.c.wb20TaleSpireResultValue(s.c.wayBeyond20TaleSpireDiceResult({total: -2, parts: ['-', {faces: 4, total: 3, rolls: [{roll: 3}]}, '+', 1]})), -2);
    const malformed = JSON.parse(JSON.stringify(detailPacket)); malformed.id += '-invalid'; malformed.rows[0].diceResult = {kind: 'd20', results: [21]};
    await assert.rejects(() => detailGame.c.wb20TaleSpireReceive(malformed), /detail/);
    vm.runInContext(fs.readFileSync(path.join(root, 'src/common/dice.js'), 'utf8'), s.c);
    const actual = vm.runInContext("(() => { const r = new DNDBRoll('1d20+6'); r.dice[0]._rolls = [{roll: 13}]; r.dice[0].calculateTotal(); r.calculateTotal(); return r.toJSON(); })()", s.c);
    assert.equal(detailGame.c.wb20TaleSpireResultValue(s.c.wayBeyond20TaleSpireDiceResult(actual)), 19, 'real serialized WB20 roll preserves its dice');
    assert.equal(await g.c.wb20TaleSpireReceive(packet), false);
    const reloaded = game(g.saved);
    assert.equal(await reloaded.c.wb20TaleSpireReceive(packet), false, 'reload does not replay accepted URL');
    const privatePacket = s.c.wayBeyond20TaleSpirePacket(message(1));
    await g.c.wb20TaleSpireReceive(privatePacket);
    assert(g.calls.slice(1).every(c => c.kind === 'chat' && c.audience === 'gms'));
    const hidden = s.c.wayBeyond20TaleSpirePacket(message(3));
    assert.equal(hidden.who, 'Hidden creature'); assert.equal(hidden.title, 'Hidden roll');
    const bad = message(); bad.attack_rolls[0].total = NaN;
    assert.throws(() => s.c.wayBeyond20TaleSpirePacket(bad), /total/);
    for (const value of ['https://example.com/', 'talespire://asset/test/', 'javascript:alert(1)', prefix+'\n']) {
        if (value.endsWith('\n')) continue; // harmless surrounding whitespace is trimmed
        assert.throws(() => s.c.wayBeyond20TaleSpirePrefix(value), /connection/);
    }
    assert.throws(() => s.c.wayBeyond20TaleSpirePacket(message(2)), /audience/);
    assert.throws(() => s.c.wayBeyond20TaleSpirePacket({action: 'roll'}), /resolved/);
    const long = {...packet, rows: Array.from({length: 20}, () => ({name: 'x'.repeat(140), formula: 'x'.repeat(500), total: 1}))};
    assert.throws(() => s.c.wayBeyond20TaleSpireURL(prefix, long), /large/);
    let answer;
    const savedPrefix = s.c.settings['talespire-url'];
    s.c.settings['talespire-url'] = '';
    s.c.wayBeyond20SendTaleSpire(message(), {tab:{id:7}}, result=>answer=result);
    assert.equal(answer.error,null,'unconfigured connection is quiet');
    assert.equal(answer.success,false,'quiet fallback never claims VTT delivery');
    assert.equal(answer.vtt[0],'dndbeyond');
    assert.equal(s.updates.length,0,'idle connector never launches a protocol');
    s.c.settings['talespire-url'] = savedPrefix;
    s.c.wayBeyond20SendTaleSpire(m, {tab: {id: 7}}, result => answer = result);
    assert.equal(answer.success, true); assert.equal(s.updates.length, 1); assert.equal(s.updates[0].id, 7);
    assert(s.updates[0].url.startsWith(prefix));
    s.chrome.runtime.lastError = {message: 'Protocol rejected'};
    s.c.wayBeyond20SendTaleSpire(message(), {tab: {id: 7}}, result => answer = result);
    assert.equal(answer.success, false); assert.equal(answer.error, 'Protocol rejected');
    s.c.wayBeyond20SendTaleSpire({action: 'hp-update'}, {tab: {id: 7}}, result => answer = result);
    assert.equal(s.updates.length, 2, 'passive sync must never launch the game');
    s.c.wayBeyond20SendTaleSpire(message(), {}, result => answer = result);
    assert.equal(answer.success, false);
    const markup = s.c.wayBeyond20TaleSpirePacket(message()); markup.who = '<link=bad>name';
    await g.c.wb20TaleSpireReceive(markup);
    assert(!g.calls.at(-1).groups[0].name.includes('<'));
    const failing = game(); failing.TS.dice.sendDiceResult = async () => {throw Error('game rejected');};
    const failedPacket = s.c.wayBeyond20TaleSpirePacket(message());
    await assert.rejects(() => failing.c.wb20TaleSpireReceive(failedPacket), /game rejected/);
    assert.equal(await failing.c.wb20TaleSpireReceive(failedPacket), false, 'ambiguous game failure is not replayed');
    const noBoard = game(); noBoard.TS.boards.whereAmI = async () => null;
    await assert.rejects(() => noBoard.c.wb20TaleSpireReceive(packet), /board first/);
    assert.equal(noBoard.calls.length, 0);
    const concurrent = game();
    await Promise.all([concurrent.c.wb20TaleSpireMessage({kind: 'urlMessageReceived', payload: {str: url.slice(prefix.length)}}),
        concurrent.c.wb20TaleSpireMessage({kind: 'urlMessageReceived', payload: {str: url.slice(prefix.length)}})]);
    assert.equal(concurrent.calls.length, 1, 'serialized duplicate URL only posts once');
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'companions/talespire/WayBeyond20/manifest.json')));
    assert.equal(manifest.api.subscriptions.urls.onUrlMessage, 'wb20TaleSpireMessage');
    assert.equal(manifest.api.subscriptions.symbiote.onStateChangeEvent, 'wb20TaleSpireState');
    console.log('PASS TaleSpire resolved-result URL handoff, Unicode/formulas/types, private audience, no reroll, duplicate/reload/concurrency, protocol failure, validation and no passive writes. Mock game API only.');
})().catch(e => {console.error(e); process.exitCode = 1;});
