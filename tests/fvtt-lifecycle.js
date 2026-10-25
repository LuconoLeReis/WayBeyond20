// Foundry return path: combat/turn observation, token identity, distance, damage return,
// relay safety and hook lifecycle. Mocked Foundry APIs only; this is not live acceptance.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const read = p => fs.readFileSync(path.join(__dirname, '..', p), 'utf8').replace(/\r\n/g, '\n');
function fn(source, name) {
    const start = source.search(new RegExp('^(?:async )?function ' + name + '\\(', 'm'));
    assert.ok(start >= 0, name);
    const end = source.slice(start + 1).search(/^(?:async function |function |const |let |var |class )/m);
    return source.slice(start, end < 0 ? undefined : start + 1 + end);
}
function block(source, from, to) {
    const start = source.indexOf(from), end = source.indexOf(to, start);
    assert.ok(start >= 0 && end > start, from);
    return source.slice(start, end);
}
const pageScript = read('src/fvtt/page-script.js');
const contentScript = read('src/fvtt/content-script.js');
const receiver = read('src/dndbeyond/content-scripts/character.js');
const myTarget = read('src/dndbeyond/content-scripts/my-target.js');
const returnPath = block(pageScript, '// ---- WayBeyond20 Foundry return path', 'function setSettings(');

// ---------- minimal Foundry world ----------
function makeHooks() {
    let next = 1;
    const table = {};
    return {
        table,
        on(hook, f) { const id = next++; (table[hook] = table[hook] || []).push({ id, f }); return id; },
        once(hook, f) { return this.on(hook, f); },
        off(hook, id) { table[hook] = (table[hook] || []).filter(h => h.id !== id); },
        call(hook, ...args) { for (const h of table[hook] || []) h.f(...args); },
        count() { return Object.values(table).reduce((n, list) => n + list.length, 0); }
    };
}
function makeWorld(version) {
    const v9 = version.startsWith('9');
    const scene = v9 ? { id: 'scene1', data: { grid: 100, gridDistance: 5, gridUnits: 'ft' } }
        : { id: 'scene1', grid: { size: 100, distance: 5, units: 'ft' } };
    const tokens = new Map();
    scene.tokens = { get: id => tokens.get(id) };
    const addToken = (id, name, x, y, extra = {}) => {
        const fields = { _id: id, name, x, y, width: 1, height: 1, hidden: false, ...extra };
        const t = v9 ? { id, parent: scene, data: fields } : { id, parent: scene, ...fields };
        tokens.set(id, t);
        return t;
    };
    const combatant = (id, tokenId, name, initiative, extra = {}) => {
        const fields = { _id: id, tokenId, sceneId: 'scene1', name, initiative, hidden: false, ...extra };
        return v9 ? { id, name, data: fields, get token() { return tokens.get(tokenId); } }
            : { id, ...fields, get token() { return tokens.get(tokenId); } };
    };
    return { scene, tokens, addToken, combatant, v9 };
}
function makeCombat(world, turns, round = 1, turn = 0) {
    const fields = { _id: 'combat1', round, turn };
    const combat = world.v9 ? { id: 'combat1', data: fields } : { id: 'combat1', ...fields };
    combat.turns = turns;
    Object.defineProperty(combat, 'started', { get: () => (world.v9 ? combat.data.round : combat.round) > 0 });
    Object.defineProperty(combat, 'combatant', { get: () => turns[world.v9 ? combat.data.turn : combat.turn] });
    combat.setTurn = (r, t) => { const d = world.v9 ? combat.data : combat; d.round = r; d.turn = t; };
    return combat;
}

function makeContext(version, isGM = false) {
    const messages = [];
    const timers = [];
    const hooks = makeHooks();
    const c = vm.createContext({
        console, Hooks: hooks, game: { ready: true, user: { isGM }, combat: null, scenes: null },
        canvas: { scene: null }, DAMAGE_FLAGS: { MESSAGE: 0, REGULAR: 1, VERSATILE: 2, HEALING: 4, CONDITIONAL: 8 },
        fvttVersion: version,
        setTimeout: f => { timers.push(f); return timers.length; }, clearTimeout: id => { timers[id - 1] = null; },
        sendCustomEvent: (name, args) => { assert.equal(name, 'SendMessage'); messages.push(args[0]); }
    });
    vm.runInContext(`
        const fvtt_isNewer = (a, b) => parseFloat(a) > parseFloat(b);
        const docData = doc => fvtt_isNewer(fvttVersion, "10") ? doc.document || doc : doc.data;`, c);
    vm.runInContext(returnPath, c);
    const flush = () => { while (timers.length) { const f = timers.shift(); if (f) f(); } };
    return { c, messages, hooks, flush };
}

// ---------- DDB receiver, unchanged real code ----------
let state, settingsStore;
function makeReceiver() {
    state = { inCombat: false, action: 1, bonusAction: 1, reaction: 1, movement: 30, attacksRemaining: 0, localTurnNumber: 0 };
    settingsStore = {};
    const r = vm.createContext({
        console,
        character: { _id: 'c1', _name: 'Calan',
            getSetting: (k, f) => k in settingsStore ? settingsStore[k] : f,
            mergeCharacterSettings: (s, cb) => { Object.assign(settingsStore, s); if (cb) cb(); } },
        wayBeyond20GetTrackedSpellEffects: () => [], wayBeyond20GetTurnTrackerState: () => state,
        wayBeyond20SetTurnTrackerState: s => { state = s; }, wayBeyond20ScheduleActiveEffectBadgeRefresh: () => {},
        wayBeyond20CharacterDebug: () => {},
        wayBeyond20ParseInteger: v => Number.isFinite(Number(v)) ? Math.trunc(Number(v)) : null,
        wayBeyond20BuildTurnResourceDefaults: () => ({ action: 1, bonusAction: 1, reaction: 1, movement: 30,
            maxAction: 1, maxBonusAction: 1, maxReaction: 1, maxMovement: 30, maxHasteAction: 0, hasteAction: 0 })
    });
    for (const name of ['wayBeyond20NormalizeNameForTokenMatch', 'wayBeyond20CharacterMatchesMessageCharacter',
        'wayBeyond20BindRoll20Token', 'wayBeyond20NormalizeTurnTrackerState', 'wayBeyond20HasActiveCombatState',
        'wayBeyond20ResetTurnResourcesFromRoll20'])
        vm.runInContext(fn(receiver, name), r);
    vm.runInContext(fn(myTarget, 'wb20TargetDistance'), r);
    vm.runInContext('let wayBeyond20LastObservedRoll20TokenId=""; let wayBeyond20LastObservedRoll20WasCharacter=false;', r);
    // Route exactly as background.js does: turn/binding messages go to the DDB handler.
    r.deliver = m => {
        if (m.action === 'waybeyond20-turn-update') r.wayBeyond20ResetTurnResourcesFromRoll20(m.current || {}, m.source || 'Roll20');
        else if (m.action === 'waybeyond20-token-binding') r.wayBeyond20BindRoll20Token(m);
    };
    return r;
}
const counters = () => [state.action, state.bonusAction, state.reaction, state.localTurnNumber];
const spend = () => { state = { ...state, action: 0, bonusAction: 0, reaction: 0 }; };

for (const version of ['13.345', '9.280']) {
    const label = `Foundry ${version}`;
    const { c, messages, hooks, flush } = makeContext(version);
    const r = makeReceiver();
    let delivered = 0;
    const publish = () => { c.wayBeyond20FvttPublishTurn(); while (delivered < messages.length) r.deliver(messages[delivered++]); };
    const world = makeWorld(version);
    world.addToken('tokSelf', 'Calan', 0, 0);
    world.addToken('tokMob', 'Zombie', 300, 0);
    world.addToken('tokGhost', 'Secret Lich', 500, 0, { hidden: true });
    const turns = [world.combatant('cbMob', 'tokMob', 'Zombie', 18),
        world.combatant('cbSelf', 'tokSelf', 'Calan', 12),
        world.combatant('cbGhost', 'tokGhost', 'Secret Lich', 5, { hidden: true })];
    c.game.scenes = { get: () => world.scene };

    c.game.ready = false; publish();
    assert.equal(messages.length, 0, `${label}: unknown world state is never reported as an ended battle`);
    c.game.ready = true; publish();
    assert.equal(messages.length, 1); assert.equal(messages[0].current.active, false);
    assert.equal(messages[0].source, 'Foundry');
    publish(); assert.equal(messages.length, 1, `${label}: repeated inactive is silent`);

    const combat = makeCombat(world, turns, 0, 0);
    c.game.combat = combat; publish();
    assert.equal(messages.length, 1, `${label}: a created but unstarted encounter is not combat`);

    combat.setTurn(1, 0); publish();
    assert.equal(state.inCombat, true); assert.equal(state.combatSource, 'Foundry', `${label}: Foundry turns are recorded as Foundry`);
    assert.deepEqual(counters(), [1, 1, 1, 0], `${label}: another combatant's turn starts combat without a character turn`);
    const first = messages.at(-1).current;
    assert.equal(first.tokenId, 'tokMob');
    assert.deepEqual([...first.targets.map(t => t.name)], ['Zombie', 'Calan'], `${label}: players never receive hidden combatants`);
    publish(); assert.equal(messages.length, 2, `${label}: identical observations are silent`);

    combat.setTurn(1, 1); publish();
    assert.deepEqual(counters(), [1, 1, 1, 1], `${label}: own turn matched by token name starts turn 1`);
    assert.deepEqual([...settingsStore['waybeyond20-foundry-token-ids']], ['tokSelf'], `${label}: name match records the Foundry token`);
    spend();
    publish(); assert.deepEqual(counters(), [0, 0, 0, 1], `${label}: duplicate turn report does not refill`);

    // Distance uses the real D&D Beyond reader: 300 px on a 100 px / 5 ft grid is 15 ft.
    const view = { combatSource: 'Foundry', knownTargets: state.knownTargets };
    const mob = view.knownTargets.find(t => t.key === 'tokMob');
    assert.equal(r.wb20TargetDistance(view, mob), '15 ft', `${label}: Foundry grid distance`);
    const moved = world.tokens.get('tokMob');
    (world.v9 ? moved.data : moved).x = 500; publish();
    assert.equal(r.wb20TargetDistance({ combatSource: 'Foundry', knownTargets: state.knownTargets },
        state.knownTargets.find(t => t.key === 'tokMob')), '25 ft');
    assert.deepEqual(counters(), [0, 0, 0, 1], `${label}: token movement is not a new turn`);

    combat.setTurn(1, 2); publish();
    const hiddenTurn = messages.at(-1).current;
    assert.match(hiddenTurn.tokenId, /^hidden:/); assert.equal(hiddenTurn.custom, ''); assert.equal(hiddenTurn.tokenName, '');
    assert.equal(JSON.stringify(hiddenTurn).includes('Lich'), false, `${label}: a hidden turn leaks no name`);
    combat.setTurn(2, 0); publish();
    combat.setTurn(2, 1); publish();
    assert.deepEqual(counters(), [1, 1, 1, 2], `${label}: next own turn resets once after a hidden turn`);

    // Reinjection: a fresh page script re-reports the same turn; spent counters survive.
    spend();
    c.wayBeyond20FvttStopCombatObserver(); publish();
    assert.deepEqual(counters(), [0, 0, 0, 2], `${label}: reload re-report keeps spent counters`);

    c.game.combat = null; publish();
    assert.equal(state.inCombat, false, `${label}: deleted encounter ends combat`);
    assert.equal(state.localTurnNumber, 0);

    // Explicit token link from initiative.
    c.wayBeyond20FvttBindTokens('Calan', [{ id: 'tokOther' }], 'initiative'); publish();
    assert.equal(settingsStore['waybeyond20-foundry-token-id'], 'tokOther');
    c.wayBeyond20FvttBindTokens('Someone Else', [{ id: 'tokX' }], 'initiative'); publish();
    assert.equal(settingsStore['waybeyond20-foundry-token-id'], 'tokOther', `${label}: other character's binding ignored`);
    const before = messages.length;
    c.wayBeyond20FvttBindTokens('Calan', [], 'initiative');
    assert.equal(messages.length, before, `${label}: no controlled token, no binding`);

    // Hook lifecycle: one set of hooks, no duplicates on restart, full removal on stop.
    c.game.combat = combat;
    c.wayBeyond20FvttStartCombatObserver();
    const registered = hooks.count();
    assert.equal(registered, 8);
    c.wayBeyond20FvttStartCombatObserver();
    assert.equal(hooks.count(), registered, `${label}: restarting never duplicates hooks`);
    flush(); const afterStart = messages.length;
    hooks.call('updateCombat'); hooks.call('updateCombatant'); hooks.call('canvasReady');
    flush();
    assert.ok(messages.length <= afterStart + 1, `${label}: bursts coalesce into at most one report`);
    const quiet = messages.length;
    hooks.call('updateToken', { id: 'tokMob' }, { elevation: 5 }); flush();
    hooks.call('updateToken', { id: 'notInCombat' }, { x: 1 }); flush();
    assert.equal(messages.length, quiet, `${label}: irrelevant token changes are ignored`);
    (world.v9 ? world.tokens.get('tokMob').data : world.tokens.get('tokMob')).x = 600;
    hooks.call('updateToken', { id: 'tokMob' }, { x: 600 }); flush();
    assert.equal(messages.length, quiet + 1, `${label}: combatant movement refreshes targets`);
    c.wayBeyond20FvttStopCombatObserver();
    assert.equal(hooks.count(), 0, `${label}: stop removes every WayBeyond20 hook`);
    hooks.call('updateCombat'); flush();
    assert.equal(messages.length, quiet + 1, `${label}: nothing reports after teardown`);
}

// Foundry 14 keeps x/y at the pre-move value until the move animation finishes (never, in a
// background tab). Positions must come from the saved source. Observed live on v14.369.
{
    const { c } = makeContext('14.369');
    const scene = { id: 's14', grid: { size: 100, distance: 5, units: 'ft' } };
    const token = { id: 'z', parent: scene, name: 'Zombie', x: 1000, y: 300, width: 1, height: 1, hidden: false,
        _source: { x: 800, y: 300, width: 1, height: 1, hidden: false } };
    const p = c.wayBeyond20FvttTokenPosition(token);
    assert.equal(p.x, 595, 'saved x 800 (centre 850) on a 100 px grid is 595 Roll20 units, not the stale 1000');
    token._source.hidden = true;
    assert.equal(c.wayBeyond20FvttTokenPosition(token), null, 'saved hidden flag wins');
}

// Roll privacy: Foundry 14 replaced core.rollMode (now null) with core.messageMode and maps the
// legacy "roll" to the user's chat mode. Verified live on v14.369 with real chat messages.
for (const [version, settings, expectQuery, expectOptions] of [
    ['13.345', { rollMode: 'gmroll' }, 'gmroll', { rollMode: 'gmroll' }],
    ['14.369', { rollMode: null, messageMode: 'gm' }, 'gmroll', { messageMode: 'gm' }],
    ['14.369', { rollMode: null, messageMode: 'self' }, 'selfroll', { messageMode: 'self' }],
    ['14.369', { rollMode: null, messageMode: 'ic' }, 'publicroll', { messageMode: 'public' }]]) {
    const ctx = vm.createContext({ console, CONST: { DICE_ROLL_MODES: { PUBLIC: 'publicroll' } }, fvttVersion: version,
        WhisperType: { NO: 0, YES: 1, QUERY: 2, HIDE_NAMES: 3 },
        game: { settings: { get: (_s, k) => settings[k] } } });
    vm.runInContext('const fvtt_isNewer = (a, b) => parseFloat(a) > parseFloat(b);', ctx);
    vm.runInContext(block(pageScript, '// Foundry 14 replaced the core', 'class FVTTRoll extends').replace('class FVTTDisplayer {', 'globalThis.FVTTDisplayer = class {'), ctx);
    const d = new ctx.FVTTDisplayer();
    assert.equal(d._whisperToRollMode(2), expectQuery, version + ' query follows the chat mode');
    assert.equal(d._whisperToRollMode(0), 'publicroll', version + ' a public roll stays explicitly public');
    assert.equal(d._whisperToRollMode(1), 'gmroll');
    assert.deepEqual({ ...ctx.wayBeyond20FvttMessageOptions(d._whisperToRollMode(2)) }, expectOptions);
}
assert.ok(pageScript.includes('} else if (rollMode == "selfroll") {'), 'self rolls whisper only to the roller');

// The Foundry page script runs in the page's own world, where chrome.runtime does not exist.
// Every file bundled into it must load there without throwing (CHANGELOG_URL broke it since 1.62).
{
    const gulp = read('gulpfile.js');
    const deps = gulp.slice(gulp.indexOf('const ROLL_RENDERER_DEPS'), gulp.indexOf(']', gulp.indexOf('const ROLL_RENDERER_DEPS')));
    const files = [...deps.matchAll(/"([^"]+.js)"/g)].map(m => m[1]).filter(f => f.startsWith('src/common/') && !f.includes('sandbox'));
    assert.ok(files.includes('src/common/constants.js'), 'constants.js is part of the Foundry page bundle');
    for (const file of ['src/common/constants.js']) {
        const ctx = vm.createContext({ console, chrome: {}, navigator: { userAgent: 'Chrome' }, window: {}, document: {} });
        assert.doesNotThrow(() => vm.runInContext(read(file), ctx), file + ' must load without chrome.runtime');
    }
}

// Rolling initiative on the sheet starts WB20's local "D&D Beyond Initiative" combat. A VTT that
// then reports turns must take over; only another VTT's combat may block it. Found live 2026-10-21.
{
    const { c, messages } = makeContext('14.369');
    const r = makeReceiver();
    state = { inCombat: true, combatSource: 'D&D Beyond Initiative', localTurnNumber: 1, action: 1, bonusAction: 1, reaction: 1 };
    const world = makeWorld('14.369');
    world.addToken('tokMob', 'Zombie', 300, 0); world.addToken('tokSelf', 'Calan', 0, 0);
    c.game.scenes = { get: () => world.scene };
    c.game.combat = makeCombat(world, [world.combatant('m', 'tokMob', 'Zombie', 18), world.combatant('s', 'tokSelf', 'Calan', 2)], 3, 0);
    c.wayBeyond20FvttPublishTurn(); r.deliver(messages.at(-1));
    assert.equal(state.combatSource, 'Foundry', 'a local initiative combat hands over to Foundry');
    assert.equal(state.currentRoll20Turn.tokenId, 'tokMob');
    state = { ...state, combatSource: 'Roll20' };
    c.game.combat.setTurn(3, 1); c.wayBeyond20FvttPublishTurn(); r.deliver(messages.at(-1));
    assert.equal(state.combatSource, 'Roll20', 'another VTT combat still blocks an unselected Foundry report');
}

// A Foundry tab is registered before WB20 adds the world name to its title. "Send rolls to this
// World" compares that title, so the stored tab must follow title changes. Found live 2026-10-23
// ("Virtual Table Top Not Found" for every roll while a specific Foundry world was selected).
{
    const bg = read('src/extension/background.js');
    const ctx = vm.createContext({ console, URL, fvtt_tabs: [], sent: [], mergeSettings: () => {},
        sendMessageWithLog: (id) => ctx.sent.push(id), fvttTitle: t => t.replace(' • Foundry Virtual Tabletop', '') });
    for (const name of ['wayBeyond20UrlOrigin', 'isFVTTTabAdded', 'addFVTTTab', 'filterVTTTab']) vm.runInContext(fn(bg, name), ctx);
    ctx.addFVTTTab({ id: 7, title: 'Foundry Virtual Tabletop' });
    ctx.addFVTTTab({ id: 7, title: 'Chult After Hours • Foundry Virtual Tabletop' });
    assert.equal(ctx.fvtt_tabs.length, 1, 'one entry per tab');
    assert.equal(ctx.filterVTTTab({}, { id: 0, title: 'Chult After Hours' }, ctx.fvtt_tabs, ctx.fvttTitle), true, 'the selected world matches');
    assert.deepEqual([...ctx.sent], [7]);
    Object.assign(ctx, {isFVTT: title => title.includes('Foundry Virtual Tabletop'),
        isCustomTabAdded: () => false, isRoll20TabAdded: () => false});
    vm.runInContext(fn(bg, 'onTabsUpdated'), ctx);
    ctx.onTabsUpdated(7, {title:'Renamed World • Foundry Virtual Tabletop'},
        {id:7,title:'Renamed World • Foundry Virtual Tabletop'});
    assert.equal(ctx.filterVTTTab({}, {id:7,title:'Renamed World'}, ctx.fvtt_tabs, ctx.fvttTitle), true,
        'real title-update handler refreshes routing without another registration');
    assert.equal(ctx.filterVTTTab({}, {id:0,title:'Chult After Hours'}, ctx.fvtt_tabs, ctx.fvttTitle), false,
        'old world title no longer receives a roll');
    ctx.onTabsUpdated(99, {title:'Other • Foundry Virtual Tabletop'},
        {id:99,title:'Other • Foundry Virtual Tabletop'});
    assert.equal(ctx.fvtt_tabs.length,1,'an unregistered title update does not authorize a new tab');
}

// The MV3 worker sleeps after ~30 s idle and forgets fvtt_tabs while Foundry's content scripts
// keep running. Every send re-validates live tabs (found live 2026-10-23), and only those are
// destinations: a cached registration never revives a tab that navigated away, closed, or moved
// to another origin (Ian's review of 1.73.12).
{
    const bg = read('src/extension/background.js');
    const utils = read('src/common/utils.js');
    const sent = [];
    let liveTabs = [];
    let origins = ['http://localhost/*', '*://*.dndbeyond.com/*'];
    const ctx = vm.createContext({ console, URL, fvtt_tabs: [], currentPermissions: { origins: [] }, mergeSettings: () => {},
        sendMessageWithLog: id => sent.push(id), wayBeyond20PrepareRequestForTarget: r => r,
        chrome: { tabs: { query: (_q, cb) => cb(liveTabs) }, permissions: { getAll: cb => cb({ origins }) } } });
    for (const name of ['urlMatches', 'isFVTT', 'fvttTitle']) vm.runInContext(fn(utils, name), ctx);
    for (const name of ['wayBeyond20UrlOrigin', 'isFVTTTabAdded', 'addFVTTTab', 'filterVTTTab', 'wayBeyond20WithFVTTTabs',
        'wayBeyond20QueryFVTTTabs', 'wayBeyond20HasHostPermission', 'sendMessageToFVTT', 'onTabsUpdated']) vm.runInContext(fn(bg, name), ctx);
    Object.assign(ctx, { isCustomTabAdded: () => false, isRoll20TabAdded: () => false });
    const send = (limit) => { sent.length = 0; let failed = null;
        ctx.sendMessageToFVTT({ action: 'roll' }, limit, f => { failed = f; }); return { failed, sent: [...sent] }; };
    const world = { id: 0, title: 'Chult After Hours', vtt: 'fvtt' };
    const foundry = { id: 9, title: 'Chult After Hours • Foundry Virtual Tabletop', url: 'http://localhost:30000/game' };

    // Worker just woke: empty cache, live permitted Foundry tab is found.
    liveTabs = [foundry, { id: 4, title: 'Other • Foundry Virtual Tabletop', url: 'https://no-permission.example/game' },
        { id: 3, title: 'Inbox', url: 'https://mail.example/' }];
    assert.deepEqual(send(world), { failed: false, sent: [9] }, 'empty cache: selected world found');
    assert.deepEqual(send(null), { failed: false, sent: [9] }, 'unrestricted send skips tabs without permission');

    // Renamed world: the selected title no longer matches.
    liveTabs = [{ ...foundry, title: 'New Name • Foundry Virtual Tabletop' }];
    assert.deepEqual(send(world), { failed: true, sent: [] }, 'renamed world does not match the old selection');

    // Same tab id navigated away from Foundry: never a destination, even though it was cached.
    liveTabs = [foundry]; send(null);
    liveTabs = [{ id: 9, title: 'Inbox', url: 'https://mail.example/' }];
    assert.deepEqual(send(null), { failed: true, sent: [] }, 'same id, different document: not sent');
    assert.equal(ctx.fvtt_tabs.length, 0, 'the stale registration is dropped');

    // Closed tab.
    liveTabs = [foundry]; send(null); liveTabs = [];
    assert.deepEqual(send(world), { failed: true, sent: [] }, 'closed tab: not found, roll falls back locally');

    // A registration made without permanent permission (one-time activation) holds on its own
    // origin, but not after the tab moves to another Foundry server.
    origins = [];
    const activated = { id: 12, title: 'Chult After Hours • Foundry Virtual Tabletop', url: 'http://192.168.1.50:30000/game' };
    ctx.fvtt_tabs = [activated]; liveTabs = [activated];
    assert.deepEqual(send(world), { failed: false, sent: [12] }, 'activated tab works on its own origin');
    liveTabs = [{ ...activated, url: 'https://other-foundry.example/game' }];
    assert.deepEqual(send(world), { failed: true, sent: [] }, 'registration does not carry to a new origin');

    // Composed producer and consumer (Ian, review of 1.73.13): the real title-update handler runs
    // before the query. A refreshed snapshot on a new origin must not carry the old trust.
    origins = [];
    ctx.fvtt_tabs = [{ ...activated, title: 'First • Foundry Virtual Tabletop' }];
    const moved = { id: 12, title: 'Second • Foundry Virtual Tabletop', url: 'https://other-foundry.example/game' };
    ctx.onTabsUpdated(12, { title: moved.title }, moved);
    liveTabs = [moved];
    assert.deepEqual(send(null), { failed: true, sent: [] }, 'title refresh across origins does not rebind trust');
    assert.equal(ctx.fvtt_tabs.length, 0, 'the crossed registration is dropped');
    // A legitimate rename on the same origin keeps working through the same sequence.
    ctx.fvtt_tabs = [{ ...activated, title: 'First • Foundry Virtual Tabletop' }];
    const renamed = { ...activated, title: 'Chult After Hours • Foundry Virtual Tabletop' };
    ctx.onTabsUpdated(12, { title: renamed.title }, renamed);
    liveTabs = [renamed];
    assert.deepEqual(send(world), { failed: false, sent: [12] }, 'same-origin rename still routes the selected world');

    // A Roll20 limit never routes to Foundry.
    liveTabs = [foundry]; origins = ['http://localhost/*'];
    assert.deepEqual(send({ id: 0, title: null, vtt: 'roll20' }), { failed: true, sent: [] });
}
// GM view: hidden combatants are listed for the GM but their positions are not exported.
{
    const { c, messages } = makeContext('13.345', true);
    const world = makeWorld('13.345');
    world.addToken('tokGhost', 'Secret Lich', 500, 0, { hidden: true });
    world.addToken('tokSelf', 'Calan', 0, 0);
    c.game.combat = makeCombat(world, [world.combatant('cbGhost', 'tokGhost', 'Secret Lich', 5, { hidden: true }),
        world.combatant('cbSelf', 'tokSelf', 'Calan', 1)], 1, 0);
    c.wayBeyond20FvttPublishTurn();
    const ghost = messages[0].current.targets.find(t => t.key === 'tokGhost');
    assert.equal(ghost.position, null); assert.equal(ghost.positionStatus, 'Combatant is hidden');
    assert.equal(messages[0].current.tokenId, 'tokGhost', 'GM sees the real current combatant');
    // A token that is merely hidden (not the combatant) still has no exported position.
    c.game.combat.turns[1] = world.combatant('cbSelf', 'tokSelf', 'Calan', 1);
    world.tokens.get('tokSelf').hidden = true;
    c.wayBeyond20FvttPublishTurn();
    const self = messages.at(-1).current.targets.find(t => t.key === 'tokSelf');
    assert.equal(self.position, null); assert.equal(self.positionStatus, 'Token is hidden');
}

// Damage return keeps the Roll20 award rule: intent only, regular rows only.
{
    const { c, messages } = makeContext('13.345');
    const rows = [['Slashing', { total: 7 }, 1], ['Healing', { total: 5 }, 4], ['Versatile', { total: 9 }, 2],
        ['Second target', { total: 4 }, 8], ['note', 'text', 0], ['Necrotic', { total: 3 }, 1]];
    c.wayBeyond20FvttResolvedDamage({ character: { id: 'c1', name: 'Calan' } }, rows);
    assert.equal(messages.length, 0, 'no intent, no award');
    c.wayBeyond20FvttResolvedDamage({ character: { id: 'c1', name: 'Calan' }, 'waybeyond20-temp-hp-on-hit': { mode: 'damage-dealt' } }, rows);
    assert.equal(messages[0].action, 'waybeyond20-damage-result'); assert.equal(messages[0].totalDamage, 10);
    assert.equal(messages[0].source, 'Foundry');
    c.wayBeyond20FvttResolvedDamage({ character: { name: 'Calan' }, effects: ['Draining Attack'], 'waybeyond20-unarmed-strike': true },
        [['Bludgeoning', { total: 0 }, 1]]);
    assert.equal(messages.length, 1, 'zero damage awards nothing');
}

// Content-script relay: allowlist, Foundry source only, silent once orphaned.
{
    const listeners = {};
    const sent = [];
    let lastError = null;
    const ctx = vm.createContext({
        console,
        addCustomEventListener: (name, f) => { listeners[name] = f; },
        chrome: { runtime: { get lastError() { return lastError; }, sendMessage: (m, cb) => { sent.push(m); cb && cb(); } } }
    });
    vm.runInContext(block(contentScript, 'const WB20_FVTT_RETURN_ACTIONS', 'function updateSettings('), ctx);
    const relay = listeners.SendMessage;
    relay({ action: 'waybeyond20-turn-update', source: 'Foundry', current: {} });
    relay({ action: 'roll', source: 'Foundry' });
    relay({ action: 'waybeyond20-add-effect', source: 'Foundry' });
    relay({ action: 'waybeyond20-turn-update', source: 'Roll20' });
    relay(null);
    assert.deepEqual(sent.map(m => m.action), ['waybeyond20-turn-update'], 'only Foundry return envelopes are relayed');
    lastError = { message: 'Extension context invalidated.' };
    relay({ action: 'waybeyond20-damage-result', source: 'Foundry' });
    lastError = null;
    relay({ action: 'waybeyond20-damage-result', source: 'Foundry' });
    assert.equal(sent.length, 2, 'an orphaned content script goes quiet');
}

// The page script reaches the DDB character through background.js, which already routes
// these three actions from any VTT tab to D&D Beyond.
{
    const background = read('src/extension/background.js');
    for (const action of ['waybeyond20-turn-update', 'waybeyond20-token-binding', 'waybeyond20-damage-result'])
        assert.ok(new RegExp(`request\\.action == "${action}"[\\s\\S]{0,400}sendMessageToBeyond\\(request\\)`).test(background), action);
    assert.ok(/registered_events\.push\(addCustomEventListener\("disconnect", wayBeyond20FvttStopCombatObserver\)\)/.test(pageScript));
    assert.ok(/addCustomEventListener\("UpdateEffects", updateEffects\)/.test(pageScript), 'effects-update now has a page consumer');
}

// Initiative added through Foundry links the controlled tokens to the rolling character;
// tracked effects get a chat line with the text escaped.
{
    const { c, messages } = makeContext('13.345');
    const updates = [], creates = [], chats = [];
    Object.assign(c, {
        ui: { notifications: { warn: m => { throw Error('unexpected warning ' + m); } } },
        CONST: { CHAT_MESSAGE_STYLES: { EMOTE: 3 } },
        ChatMessage: { create: d => chats.push(d) },
        roll_renderer: { _displayer: { _getSpeakerByName: n => ({ alias: n }) } },
        $: () => { let s = ''; const o = { text: v => { s = v; return o; }, html: () => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') }; return o; }
    });
    c.canvas = { scene: { id: 'scene1' }, tokens: { controlled: [{ id: 'tokA', document: { hidden: false }, actor: null, scene: null }] } };
    c.game.combat = { getCombatantByToken: () => null,
        updateEmbeddedDocuments: async (_t, d) => updates.push(d), createEmbeddedDocuments: async (_t, d) => creates.push(d) };
    vm.runInContext(fn(pageScript, 'addInitiativeToCombat'), c);
    vm.runInContext(fn(pageScript, 'updateEffects'), c);
    c.addInitiativeToCombat({ total: 17 }, { character: { name: 'Calan' } }).then(() => {
        assert.equal(creates.length, 1);
        const binding = messages.find(m => m.action === 'waybeyond20-token-binding');
        assert.ok(binding, 'initiative creates a token binding');
        assert.equal(binding.character.name, 'Calan'); assert.equal(binding.tokenId, 'tokA');
        c.updateEffects({}, 'Calan', [{ name: 'Bless <b>', concentration: true, duration: '1 min' }], { name: 'Bless <b>' });
        assert.equal(chats.length,0,'passive effects stay out of VTT chat');
        c.updateEffects({}, 'Calan', [], null);
        assert.equal(chats.length,0,'ending effects stays out of VTT chat');
        assert.ok(pageScript.includes("addInitiativeToCombat(initiative, request.request)"), 'rendered initiative passes its original request');
        console.log('PASS Foundry initiative token link and quiet effects bookkeeping (mocked).');
    }).catch(e => { console.error(e); process.exit(1); });
}

console.log('PASS Foundry return path (v13 and v9 data shapes): readiness, inactive/unstarted, turn reset with the real DDB receiver, ' +
    'duplicate and reload safety, hidden combatants, grid distance, token binding, damage award, relay allowlist, hook lifecycle. ' +
    'Mocked Foundry APIs only; no live acceptance is implied.');
