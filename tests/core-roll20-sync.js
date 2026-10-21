const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../src/roll20/page-script.js'), 'utf8');
const start = source.indexOf('async function wayBeyond20SyncCoreStats(');
const end = source.indexOf('\nfunction createHitpointIntegrantEntry(', start);
assert.ok(start >= 0 && end > start);
const implementation = source.slice(start, end);
const ddbSource = fs.readFileSync(path.join(__dirname, '../src/dndbeyond/base/character.js'), 'utf8');
const ddbStart = ddbSource.indexOf('    syncCoreRoll20Data() {');
const ddbEnd = ddbSource.indexOf('\n    updateHP() {', ddbStart);
assert.ok(ddbStart >= 0 && ddbEnd > ddbStart);
const ddbImplementation = ddbSource.slice(ddbStart, ddbEnd);
const base = {
    name: 'Calan Avrenson',
    abilities: {str: 11, dex: 17, con: 15, int: 14, wis: 14, cha: 18},
    proficiency: 2, ac: 17, speed: 30,
    passives: {perception: 16, investigation: 13, insight: 13},
    senses: {darkvision: 60}, sensesComplete: true,
    skills: {perception: 6}, skillProficiencies: {perception: 2, stealth: 1, arcana: 0.5, athletics: 0},
    saves: {str: 0, dex: 5, con: 2, int: 2, wis: 2, cha: 6},
    saveProficiencies: {str: 0, dex: 1, con: 0, int: 0, wis: 0, cha: 1}
};

function fixture(sheet = 'dnd2024byroll20', names = ['Calan Avrenson']) {
    const posted = [];
    const attrs = new Map();
    const integrants = {};
    const characters = names.map((name, index) => ({
        id: `c${index}`, attributes: {name},
        attribs: {
            find: predicate => [...attrs.values()].find(predicate),
            create: ({name, current}) => {
                const entry = {
                    attributes: {name, current}, saves: 0,
                    set(key, value) { this.attributes[key] = value; },
                    save() { this.saves++; }
                };
                attrs.set(name, entry);
                return entry;
            }
        },
        characterSheet: {
            shortName: sheet,
            state: {characters: {[`c${index}`]: {attributes: {store: {integrants: {integrants}}}}}},
            headlessRelay: {postMessage: change => posted.push(change)}
        }
    }));
    const context = vm.createContext({window: {Campaign: {characters}},
        loadCharacterAttributes: async () => {}, console, Date});
    vm.runInContext(implementation, context);
    return {sync: core => context.wayBeyond20SyncCoreStats(core), attrs, posted, integrants, characters};
}

function ddbFixture(sensesText, enabled = true, proficiencyLabel = 'Proficient') {
    const sent = [];
    const panel = sensesText == null ? [] : [{textContent: sensesText, innerText: sensesText}];
    const skillRow = {
        querySelector: selector => selector.includes('--skill') ? {textContent: 'Perception'} :
            selector.includes('--modifier') ? {textContent: '+6'} :
            selector.includes('--proficiency') ? {querySelector: () => ({
                getAttribute: key => key === 'aria-label' ? proficiencyLabel : null})} : null
    };
    const saveRows = ['str', 'dex', 'con', 'int', 'wis', 'cha'].map((abbr, i) => ({
        querySelector: selector => selector.includes('name') ? {textContent: abbr} :
            selector.includes('modifier') ? {textContent: ['+0', '+5', '+2', '+2', '+2', '+6'][i]} :
            selector.includes('proficiency') ? {querySelector: () => ({getAttribute: key =>
                key === 'aria-label' ? ([1, 5].includes(i) ? 'Proficient' : 'Not Proficient') : null})} : null
    }));
    const context = vm.createContext({
        document: {querySelectorAll: selector => selector.includes('senses') ? panel :
            selector.includes('saving-throws') ? saveRows : [skillRow]},
        chrome: {runtime: {sendMessage: (message, callback) => {
            sent.push(message); callback({success: true});
        }, lastError: null}},
        Date, console
    });
    vm.runInContext(`class Reader {${ddbImplementation}}; globalThis.Reader = Reader`, context);
    const reader = new context.Reader();
    Object.assign(reader, {
        _settings: {}, _name: 'Calan Avrenson', _id: '123',
        _abilities: [['Strength', 'STR', '11'], ['Dexterity', 'DEX', '17'],
            ['Constitution', 'CON', '15'], ['Intelligence', 'INT', '14'],
            ['Wisdom', 'WIS', '14'], ['Charisma', 'CHA', '18']],
        _proficiency: '+2', _ac: '17', _speed: 30,
        _lastCoreRoll20Sync: '', _lastCoreRoll20Attempt: 0,
        getGlobalSetting: () => enabled
    });
    return {reader, sent};
}

(async () => {
    const ddb = ddbFixture('16 Passive Perception\n13 Passive Investigation\n13 Passive Insight\nDarkvision 60 ft.');
    ddb.reader.syncCoreRoll20Data();
    assert.equal(ddb.sent.length, 1);
    assert.equal(ddb.sent[0].core.passives.perception, 16);
    assert.equal(ddb.sent[0].core.senses.darkvision, 60);
    assert.equal(ddb.sent[0].core.skills.perception, 6);
    assert.equal(ddb.sent[0].core.skillProficiencies.perception, 1);
    assert.equal(ddb.sent[0].core.saves.dex, 5);
    assert.equal(ddb.sent[0].core.saveProficiencies.dex, 1);
    assert.equal(ddb.sent[0].core.saveProficiencies.con, 0);
    for (const [label, rank] of [['Expert', 2], ['Expertise', 2], ['Proficiency', 1],
        ['Half Proficient', 0.5], ['Half Proficiency', 0.5], ['Not Proficient', 0]]) {
        const labeled = ddbFixture(null, true, label);
        labeled.reader.syncCoreRoll20Data();
        assert.equal(labeled.sent[0].core.skillProficiencies.perception, rank, label);
    }
    const unknown = ddbFixture(null, true, 'Unknown');
    unknown.reader.syncCoreRoll20Data();
    assert.equal(Object.keys(unknown.sent[0].core.skillProficiencies).length, 0);
    ddb.reader.syncCoreRoll20Data();
    assert.equal(ddb.sent.length, 1, 'same DDB snapshot should not resend');
    const disabled = ddbFixture('16 Passive Perception\n13 Passive Insight\nDarkvision 60 ft.', false);
    disabled.reader.syncCoreRoll20Data();
    assert.equal(disabled.sent.length, 0, 'sync must remain opt-in');
    const absentPanel = ddbFixture(null);
    absentPanel.reader.syncCoreRoll20Data();
    assert.equal(absentPanel.sent[0].core.sensesComplete, false);

    const f = fixture();
    await f.sync(base);
    assert.equal(f.attrs.get('wb20_dex').attributes.current, '17');
    assert.equal(f.attrs.get('wb20_proficiency_bonus').attributes.current, '2');
    assert.equal(f.attrs.get('wb20_passive_perception').attributes.current, '16');
    assert.equal(f.attrs.get('wb20_darkvision_ft').attributes.current, '60');
    assert.equal(f.attrs.get('wb20_skill_perception').attributes.current, '6');
    assert.equal(f.posted.length, 1);
    const changes = f.posted[0].character.attributes.store.integrants.integrants;
    assert.equal(changes['wb20-core-dex'].type, 'Ability Score');
    assert.equal(changes['wb20-core-ac'].type, 'Armor Class');
    assert.equal(changes['wb20-sense-darkvision'].type, 'Sense');
    Object.assign(f.integrants, changes);
    await f.sync(base);
    assert.equal(f.posted.length, 1, 'unchanged 2024 values should not be reposted');
    assert.equal([...f.attrs.values()].reduce((n, entry) => n + entry.saves, 0), 0);

    await f.sync({...base, ac: 18, senses: {}});
    assert.equal(f.attrs.get('wb20_ac').attributes.current, '18');
    assert.equal(f.attrs.get('wb20_darkvision_ft').attributes.current, '0');
    const changed = f.posted[1].character.attributes.store.integrants.integrants;
    assert.equal(changed['wb20-core-ac'].valueFormula.flatValue, 18);
    assert.equal(changed['wb20-sense-darkvision']._enabled, false);

    const missingPanel = fixture();
    await missingPanel.sync({...base, sensesComplete: false, senses: {}});
    assert.equal(missingPanel.attrs.has('wb20_darkvision_ft'), false,
        'an unreadable DDB senses panel must not erase existing vision');

    const duplicate = fixture('dnd2024byroll20', ['Calan Avrenson', 'calan avrenson']);
    await duplicate.sync(base);
    assert.equal(duplicate.attrs.size, 0, 'ambiguous character names must not write');
    assert.equal(duplicate.posted.length, 0);

    const invalid = fixture();
    await invalid.sync({...base, abilities: {...base.abilities, cha: 0}});
    assert.equal(invalid.attrs.size, 0, 'invalid ability must not partially write');
    assert.equal(invalid.posted.length, 0);

    const old = fixture('ogl5e');
    await old.sync(base);
    assert.equal(old.attrs.get('dexterity_base').attributes.current, '17');
    assert.equal(old.attrs.get('dexterity').attributes.current, '17',
        'the displayed OGL score must not depend on a sheet worker');
    assert.equal(old.attrs.get('dexterity_mod').attributes.current, '3');
    assert.equal(old.attrs.get('pb').attributes.current, '2');
    assert.equal(old.attrs.get('ac').attributes.current, '17');
    assert.equal(old.attrs.get('speed').attributes.current, '30');
    assert.equal(old.attrs.get('passive_wisdom').attributes.current, '16');
    assert.equal(old.attrs.get('perception_bonus').attributes.current, '6');
    assert.equal(old.attrs.get('darkvision').attributes.current, '60');
    assert.equal(old.attrs.get('wb20_skill_proficiency_perception').attributes.current, '2');
    assert.equal(old.attrs.get('perception_type').attributes.current, '2');
    assert.equal(old.attrs.get('perception_prof').attributes.current, '(@{pb}*@{perception_type})');
    assert.equal(old.attrs.get('stealth_prof').attributes.current, '(@{pb}*@{stealth_type})');
    assert.equal(old.attrs.get('arcana_prof').attributes.current, '0', 'half proficiency is not a checked native proficiency');
    assert.equal(old.attrs.get('athletics_prof').attributes.current, '0');
    assert.equal(old.attrs.get('dexterity_save_bonus').attributes.current, '5');
    assert.equal(old.attrs.get('dexterity_save_prof').attributes.current, '(@{pb})');
    assert.equal(old.attrs.get('constitution_save_bonus').attributes.current, '2');
    assert.equal(old.attrs.get('constitution_save_prof').attributes.current, '0');
    assert.equal(old.attrs.get('wb20_save_dex').attributes.current, '5');
    assert.equal(old.attrs.get('wb20_save_proficiency_dex').attributes.current, '1');
    await old.sync(base);
    assert.equal([...old.attrs.values()].reduce((n, entry) => n + entry.saves, 0), 0,
        'unchanged legacy values should not be saved again');
    await old.sync({...base, skillProficiencies: {}, saves: {}, saveProficiencies: {}});
    assert.equal(old.attrs.get('perception_type').attributes.current, '2', 'missing ranks must not clear expertise');
    assert.equal(old.attrs.get('dexterity_save_bonus').attributes.current, '5', 'missing saves must not clear totals');
    await old.sync({...base, skillProficiencies: {perception: 0}, saveProficiencies: {dex: 0}});
    assert.equal(old.attrs.get('perception_prof').attributes.current, '0', 'explicit removal clears proficiency');
    assert.equal(old.attrs.get('dexterity_save_prof').attributes.current, '0');
    for (const key of ['hp', 'hp_temp', 'hit_dice', 'class_resource', 'other_resource'])
        assert.equal(old.attrs.has(key), false, `core sync must never write resource ${key}`);
    await old.sync({...base, ac: 18, senses: {}});
    assert.equal(old.attrs.get('ac').attributes.current, '18');
    assert.equal(old.attrs.get('darkvision').attributes.current, '0');
    assert.equal(old.posted.length, 0);
    console.log('PASS core Roll20 sync: 2024 and 2014 fields, idempotency, update, missing senses, duplicate and invalid guard.');
})().catch(error => { console.error(error); process.exitCode = 1; });
