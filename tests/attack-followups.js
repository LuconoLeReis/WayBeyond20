const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const source = read('src/dndbeyond/content-scripts/character.js');
function fn(name) {
    return extractFunction(name, source);
}
function extractFunction(name, code) {
    const start = code.search(new RegExp(`^(?:async )?function ${name}\\(`, 'm'));
    assert.notEqual(start, -1, name);
    const rest = code.slice(start);
    const next = rest.slice(rest.indexOf('\n') + 1).search(/^(?:async )?function |^(?:const|let|var|class) /m);
    return next < 0 ? rest : rest.slice(0, rest.indexOf('\n') + 1 + next);
}
function roll(total, critical = false, formula = '1d8+3') {
    return {total, formula, isDiscarded: () => false, isCriticalHit: () => critical};
}
function sandbox({hit = true, chooseSmite = true, fail = '', smites = true, savage = false,
    elemental = true, draining = false, combat = true, useSavage = true} = {}) {
    const log = [], values = {}, state = {inCombat: combat, combatStartedAt: 10, localTurnNumber: 1,
        currentRoll20Turn: {turnKey: 'a'}};
    const c = {
        console, Promise, Date, Math, Set, Map, Array, Object, String, Number,
        RollType: {NORMAL: 0}, DAMAGE_FLAGS: {REGULAR:1,VERSATILE:2,ADDITIONAL:4,HEALING:8,CRITICAL:16,CONDITIONAL:32},
        character: { hasRacialTrait: () => false, hasFeat: () => savage,
            getSetting: (key, fallback) => values[key] ?? fallback,
            mergeCharacterSettings: changes => Object.assign(values, changes)},
        $: () => ({css: () => undefined}),
        wayBeyond20ActiveCharacterSheetTab: () => 'Inventory',
        wayBeyond20RestoreCharacterSheetTab: tab => log.push(`tab:${tab}`),
        wayBeyond20BuildSmiteOptions: async () => smites ? {} : null,
        wayBeyond20MayHaveSmiteAfterHit: () => smites,
        wayBeyond20NormalizeAttackSemantics() {},
        wayBeyond20ApplyDrainingAttackIntent: args => {if(draining) args['waybeyond20-temp-hp-on-hit'] = true;},
        wayBeyond20GetTrackedSpellEffects: () => [],
        wayBeyond20CharacterDebug() {},
        wayBeyond20PreflightLimitedUse: async () => ({allowed:true,tracked:true}),
        wayBeyond20PreflightTurnResource: async () => true,
        wayBeyond20SpendTurnResource: resource => log.push(`spend:${resource}`),
        wayBeyond20SpendLimitedUse: async resource => {log.push(`spend:${resource}`);return true;},
        wayBeyond20SpendSpellSlot: async level => {log.push(`slot:${level}`);return true;},
        wayBeyond20SpendPaladinSmiteFreeUse: async () => {log.push('free-use');return true;},
        wayBeyond20TrackSelfFeatureEffect: name => log.push(`effect:${name}`),
        wayBeyond20GetTurnTrackerState: () => state,
        wayBeyond20HasActiveCombatState: s => s.inCombat,
        wayBeyond20SendRuntimeMessage: async () => ({ok:true,response:{id:12}}),
        wayBeyond20MaybeAddSmite: async args => {
            log.push('smite-choice');
            if(!chooseSmite) return null;
            args.damages = ['2d8']; args['damage-types'] = ['Radiant (Divine Smite)'];
            args['waybeyond20-smite'] = {fuel:'spell-slot',slotLevel:1};
            args['waybeyond20-turn-resource'] = {resource:'bonusAction'};
            args['waybeyond20-elemental-after-cast'] = true;
            return {smite:{name:'Divine Smite'}};
        },
        wayBeyond20MaybeAddElementalStrike: async args => {
            log.push('elemental-choice');
            if(!elemental) return null;
            args.damages=['2d4','2d4'];args['damage-types']=['Fire','Fire (second creature)'];
            args['waybeyond20-limited-use']={feature:'Channel Divinity'};
            return {name:'Efreeti’s Fury'};
        },
        sendRoll: async (character, type, fallback, args) => {
            const phase=args['waybeyond20-followup-phase']; log.push(`send:${phase}`);
            if(phase === fail) return false;
            const attacks=args.rollAttack ? [roll(19,true)] : [];
            const damages=args.rollDamage ? (args.damages || []).map((formula,i) => [
                `${args['damage-types'][i]} Damage`, roll(5,false,formula),
                phase === 'elemental' && i === 1 ? 32 : 1]) : [];
            const request={...args,whisper:1,character:{name:'Test',settings:{}}};
            if(args['waybeyond20-capture-result']) args['waybeyond20-capture-result'](request,attacks,damages);
            if(phase === 'base') c.lastBase=request;
            if(phase === 'damage') c.lastDamage=request;
            return true;
        },
        dndbeyondDiceRoller: {
            _prompter:{prompt:async (title,html,yes,no) => {
                log.push(`prompt:${title}`);
                return title === 'Attack result' ? hit : useSavage;
            }},
            _roller:{roll:formula => roll(9,false,formula), resolveRolls:async () => log.push('reroll'),
                applyDamageBasedTempHP:async total => log.push(`thp:${total}`)},
            postDescription:async (...args) => {c.replacement=args[8];log.push('replacement');}
        },
        alertify:{warning:message => log.push('warning')}
    };
    vm.createContext(c);
    vm.runInContext(read('src/dndbeyond/content-scripts/attack-followups.js') + '\n' +
        ['sendRollWithCharacter','wayBeyond20DispatchRollWithCharacter','wayBeyond20ApplySavageAttacker',
            'wayBeyond20DamageRowIndex','wayBeyond20AttackActivationTurnKey',
            'wayBeyond20CreateAttackActivation','wayBeyond20PerformGrantedAttack'].map(fn).join('\n'), c);
    c.log=log;c.values=values;c.state=state;
    c.attack = (overrides={}) => ({name:'Test weapon',rollAttack:true,rollDamage:true,'to-hit':'+5',
        damages:['1d8+3'],'damage-types':['Slashing'], 'critical-damages':['1d8'],
        'critical-damage-types':['Slashing'], 'waybeyond20-smite-eligible':true,
        'waybeyond20-turn-resource':{resource:'action'},...overrides});
    return c;
}
const count=(c,event)=>c.log.filter(x=>x===event).length;
async function test(name, body) {await body();console.log('PASS',name);}
(async()=>{
    await test('granted reaction attack spends once, never again for immediate or deferred damage',async()=>{
        for (const deferred of [false,true]) {
            const c=sandbox({smites:true,draining:true});
            const activation=c.wayBeyond20CreateAttackActivation({resource:'reaction',attacks:1});
            await c.sendRollWithCharacter('attack','',c.attack({
                rollDamage:!deferred,'waybeyond20-attack-activation':activation,
                'waybeyond20-attack-context':{kind:'opportunity',isOwnTurn:false,turnKey:activation.turnKey}}));
            if(deferred) {
                c.state.currentRoll20Turn.turnKey = 'later-own-turn';
                const id=c.lastBase['waybeyond20-attack-continuation'].id;
                await Promise.all([c.wayBeyond20ContinueAttackDamage(id),c.wayBeyond20ContinueAttackDamage(id)]);
            }
            assert.equal(count(c,'spend:reaction'),1);
            assert.equal(count(c,'spend:action'),0);
            assert.equal(count(c,'smite-choice'),0,'off-turn attack never offers a Bonus Action, even when damage is deferred to another turn');
            assert.equal(count(c,'send:damage'),1);
            assert.equal(count(c,'thp:5'),1,'Draining retains its event-based trigger');
            assert.equal(activation.remaining,0);
            assert.equal(c.lastDamage['waybeyond20-attack-activation'],undefined);
        }
    });
    await test('overlapping prompts cannot replace the active title/resolver or leave stale roll-mode contents',async()=>{
        const shown=[];
        let active=null;
        const c={Promise,alertify:{Beyond20Prompt:(title,html,yes,no,resolve)=>{
            // Alertify 1.12 only runs prepare() when its singleton is not already open.
            // Calling it while open updates the title/settings, not the rendered body.
            if(active) {active.title=title;active.resolve=resolve;return active;}
            const dialog={title,html,resolve,close:()=>{active=null;}};
            active=dialog;shown.push(dialog);return dialog;
        }}};
        vm.createContext(c);
        vm.runInContext(extractFunction('wayBeyond20Prompt',read('src/common/utils.js')),c);
        const dice=read('src/dndbeyond/base/dice.js');
        vm.runInContext(dice.slice(dice.indexOf('class DNDBPrompter'),dice.indexOf('const dndbeyondDiceRoller'))+
            '\nthis.Prompter=DNDBPrompter;',c);
        const prompter=new c.Prompter();
        const first=prompter.prompt('Longsword','Select roll mode','Roll','Cancel');
        const generic=read('src/generic-site/renderer.js'), roll20=read('src/roll20/renderer.js');
        vm.runInContext(generic.slice(generic.indexOf('class GenericPrompter'),generic.indexOf('var roll_renderer'))+
            roll20.slice(roll20.indexOf('class Roll20Prompter'),roll20.indexOf('var roll_renderer'))+
            '\nthis.Generic=GenericPrompter;this.Roll20=Roll20Prompter;',c);
        const second=new c.Generic().prompt('Elemental Strike','four elemental choices','Choose','No Elemental Strike');
        await Promise.resolve();
        assert.equal(active.title,'Longsword');assert.equal(active.html,'Select roll mode');
        active.resolve('normal');assert.equal(await first,'normal');
        await Promise.resolve();
        assert.equal(active.title,'Elemental Strike');assert.equal(active.html,'four elemental choices');
        active.resolve(null);assert.equal(await second,null);assert.equal(active,null);
        const third=new c.Roll20().prompt('Smite','Smite choices');await Promise.resolve();
        active.resolve('selected');assert.equal(await third,'selected');
        assert.deepEqual(shown.map(d=>d.title),['Longsword','Elemental Strike','Smite']);
    });
    await test('real sendRoll and renderer query only the attack; damage, Smite and Elemental retain resolved privacy',async()=>{
        const c=sandbox();
        Object.assign(c, {crypto:require('node:crypto').webcrypto, key_modifiers:{},cleanRoll:String,
            WhisperType:{NO:0,YES:1,QUERY:2,HIDE_NAMES:3},CriticalRules:{PHB:0},
            wayBeyond20ExtensionContextAvailable:()=>true,
            DigitalDiceManager:{isEnabled:()=>false},
            wayBeyond20RollDeliveries:new WeakMap(),wayBeyond20ResolvedRollHooks:new WeakMap(),
            wayBeyond20TrackRollDelivery:()=>({invoked:false}),
            wayBeyond20NotifyDispatchFailure:message=>{throw Error(message);},
            wayBeyond20CaptureResolvedRoll:(request,attacks,damages)=>
                c.wayBeyond20ResolvedRollHooks.get(request)?.(request,attacks,damages)});
        Object.assign(c.RollType,{QUERY:2,DOUBLE:1,ADVANTAGE:3,DISADVANTAGE:4,THRICE:5,
            SUPER_ADVANTAGE:6,SUPER_DISADVANTAGE:7,OVERRIDE_ADVANTAGE:8,OVERRIDE_DISADVANTAGE:9});
        Object.assign(c.character,{type:()=> 'Character',
            getDict:()=>({type:'Character',name:'Fixture',settings:{}}),
            getGlobalSetting:(key,fallback)=>['roll-type','whisper-type'].includes(key)?2:fallback});
        vm.runInContext(read('src/common/dice.js')+'\n'+read('src/common/roll_renderer.js')+
            '\nthis.Renderer=Beyond20RollRenderer;this.Roll=DNDBRoll;'+
            extractFunction('sendRoll',read('src/dndbeyond/base/utils.js')),c);
        const prompts=[],requests=[];
        c.dndbeyondDiceRoller=new c.Renderer({roll:formula=>new c.Roll(formula),
            resolveRolls:async(name,rolls)=>Promise.all(rolls.map(r=>r.roll()))},
            {prompt:async(title,html)=>{
                prompts.push({title,html});
                return html.includes('whisper-mode') ? {find:()=>({val:()=> '1'})} :
                    html.includes('roll-mode') ? {find:()=>({val:()=> '0'})} : true;
            }},null);
        c.dndbeyondDiceRoller.postDescription=async request=>{requests.push(request);return true;};
        await c.sendRollWithCharacter('attack','1d8+3',c.attack());
        assert.deepEqual(prompts.map(p=>p.title),['Test weapon','Test weapon','Attack result']);
        assert.deepEqual(requests.map(r=>r.name),['Test weapon','Test weapon','Divine Smite','Efreeti’s Fury']);
        assert.ok(requests.every(r=>r.whisper===1 && r.advantage===0));
        assert.deepEqual(Array.from(requests[1].damages),['1d8+3']);
        assert.deepEqual(Array.from(requests[2].damages),['2d8']);
        assert.deepEqual(Array.from(requests[3].damages),['2d4','2d4']);
        assert.equal(count(c,'slot:1'),1);assert.equal(count(c,'spend:Channel Divinity'),1);
        // Explicit icon menu wins over a held hotkey, without changing preferences.
        c.character.getGlobalSetting=(key,fallback)=>key==='roll-type'?0:key==='whisper-type'?1:fallback;
        c.key_modifiers.advantage=true;
        for(const selected of [3,4,null]){
            const before=requests.length;
            c.dndbeyondDiceRoller._prompter.prompt=async(title,html)=>{
                assert.match(html,/roll-mode/);
                assert.match(html,/Advantage/);assert.match(html,/Disadvantage/);
                return selected===null?null:{find:()=>({val:()=>String(selected)})};
            };
            const sent=await c.sendRoll(c.character,'attack','1d20+5',{
                name:'Icon test',rollAttack:true,rollDamage:false,'to-hit':'+5',
                advantage:2,'waybeyond20-query-attack-mode':true,'waybeyond20-capture-result':()=>{}});
            if(selected===null){assert.equal(sent,false);assert.equal(requests.length,before);}
            else {assert.equal(requests.at(-1).advantage,selected);assert.equal(requests.at(-1)['waybeyond20-query-attack-mode'],undefined);}
        }
        // Already-chosen menu values bypass the late prompt and held hotkeys.
        c.dndbeyondDiceRoller._prompter.prompt=()=>{throw Error('Menu choice asked twice');};
        for(const mode of [0,3,4]) {
            await c.sendRoll(c.character,'attack','1d20+5',{
                name:'Chosen mode',rollAttack:true,rollDamage:false,'to-hit':'+5',
                advantage:mode,'waybeyond20-explicit-attack-mode':mode,'waybeyond20-capture-result':()=>{}});
            assert.equal(requests.at(-1).advantage,mode);
            assert.equal(requests.at(-1)['waybeyond20-explicit-attack-mode'],undefined);
        }
        delete c.key_modifiers.advantage;
        c.dndbeyondDiceRoller._prompter.prompt=()=>{throw Error('Leaked icon mode to ordinary roll');};
        await c.sendRoll(c.character,'attack','1d20+5',{name:'Ordinary next attack',rollAttack:true,rollDamage:false,'to-hit':'+5','waybeyond20-capture-result':()=>{}});
        assert.equal(requests.at(-1).advantage,0);
    });
    await test('confirmed hit sends weapon damage before Smite and Elemental, with exactly-once costs',async()=>{
        const c=sandbox();await c.sendRollWithCharacter('attack','1d8',c.attack());
        const order=['send:base','spend:action','prompt:Attack result','send:damage','smite-choice','send:smite',
            'spend:bonusAction','slot:1','elemental-choice','send:elemental','spend:Channel Divinity'];
        let last=-1;for(const event of order){const next=c.log.indexOf(event);assert.ok(next>last,event);last=next;}
        assert.equal(count(c,'spend:action'),1);assert.equal(count(c,'spend:bonusAction'),1);
        assert.equal(c.lastBase.rollDamage,false);assert.equal(c.lastDamage.rollCritical,true);
        assert.equal(c.lastDamage.whisper,1);assert.equal(c.lastDamage['to-hit'],undefined);
    });
    await test('Miss preserves attack cost but spends no slot, CD, or damage',async()=>{
        const c=sandbox({hit:false});await c.sendRollWithCharacter('attack','',c.attack());
        assert.equal(count(c,'spend:action'),1);assert.equal(count(c,'smite-choice'),0);assert.equal(count(c,'send:damage'),0);
    });
    await test('failed attack neither asks hit nor spends resources',async()=>{
        const c=sandbox({fail:'base'});assert.equal(await c.sendRollWithCharacter('attack','',c.attack()),false);
        assert.equal(count(c,'spend:action'),0);assert.equal(count(c,'prompt:Attack result'),0);
    });
    await test('No Smite keeps weapon damage; declined Elemental keeps Smite',async()=>{
        const a=sandbox({chooseSmite:false});await a.sendRollWithCharacter('attack','',a.attack());
        assert.equal(count(a,'send:damage'),1);assert.equal(count(a,'slot:1'),0);
        const b=sandbox({elemental:false});await b.sendRollWithCharacter('attack','',b.attack());
        assert.equal(count(b,'slot:1'),1);assert.equal(count(b,'spend:Channel Divinity'),0);assert.equal(count(b,'send:damage'),1);
    });
    await test('failed Smite never offers Elemental; failed Elemental never spends CD',async()=>{
        const a=sandbox({fail:'smite'});await a.sendRollWithCharacter('attack','',a.attack());
        assert.equal(count(a,'slot:1'),0);assert.equal(count(a,'elemental-choice'),0);
        const b=sandbox({fail:'elemental'});await b.sendRollWithCharacter('attack','',b.attack());
        assert.equal(count(b,'slot:1'),1);assert.equal(count(b,'spend:Channel Divinity'),0);
    });
    await test('with Smite helper disabled and no other riders the existing dispatch is unchanged',async()=>{
        const c=sandbox({smites:false});await c.sendRollWithCharacter('attack','',c.attack());
        assert.equal(count(c,'prompt:Attack result'),0);assert.equal(count(c,'spend:action'),1);assert.equal(c.lastBase.rollDamage,true);
    });
    await test('starting/cancelling/missing an attack never probes Spells; discovery is deferred to damage',async()=>{
        for(const options of [{hit:false},{fail:'base'},{}]){
            const c=sandbox(options);
            c.wayBeyond20BuildSmiteOptions=()=>{throw Error('Early Spells probe');};
            await c.sendRollWithCharacter('attack','',c.attack({rollDamage:false}));
            assert.equal(count(c,'smite-choice'),0);
            assert.ok(!c.log.some(entry=>entry.startsWith('tab:')));
        }
    });
    await test('Smite eligibility uses observed capabilities, not a class gate or hidden tab click',async()=>{
        const c={wayBeyond20PreparedSmiteCache:null,enabled:true,bonus:true,rows:[],
            wayBeyond20CharacterHelperEnabled:()=>c.enabled,
            wayBeyond20HasAvailableBonusAction:()=>c.bonus,
            wayBeyond20FindSmiteRows:()=>c.rows};
        vm.createContext(c);vm.runInContext(fn('wayBeyond20MayHaveSmiteAfterHit'),c);
        assert.equal(c.wayBeyond20MayHaveSmiteAfterHit(),true,'Unknown prepared list is not absent');
        c.wayBeyond20PreparedSmiteCache=[];
        assert.equal(c.wayBeyond20MayHaveSmiteAfterHit(),false,'Observed no Smite skips helper');
        c.rows=[{name:'Divine Smite',prepared:true}];
        assert.equal(c.wayBeyond20MayHaveSmiteAfterHit(),true,'Actual spell accepted without a class prerequisite');
        c.enabled=false;assert.equal(c.wayBeyond20MayHaveSmiteAfterHit(),false);
        c.enabled=true;c.bonus=false;assert.equal(c.wayBeyond20MayHaveSmiteAfterHit(),false);
    });
    await test('damage-only entry has no attack cost; deferred button never repeats hit, Smite or resource use',async()=>{
        const c=sandbox();const args=c.attack({rollAttack:false});delete args['waybeyond20-turn-resource'];
        await c.sendRollWithCharacter('attack','',args);assert.equal(count(c,'spend:action'),0);
        const d=sandbox();await d.sendRollWithCharacter('attack','',d.attack({rollDamage:false}));
        assert.equal(count(d,'send:damage'),0);
        assert.equal(count(d,'smite-choice'),0);assert.equal(count(d,'slot:1'),0);
        const id=d.lastBase['waybeyond20-attack-continuation'].id;
        await Promise.all([d.wayBeyond20ContinueAttackDamage(id),d.wayBeyond20ContinueAttackDamage(id)]);
        assert.equal(count(d,'send:damage'),1);assert.equal(count(d,'smite-choice'),1);
        assert.equal(count(d,'prompt:Attack result'),1);assert.equal(count(d,'spend:action'),1);
        assert.ok(d.log.indexOf('send:damage')<d.log.indexOf('send:smite'));
        assert.equal(count(d,'slot:1'),1);assert.equal(count(d,'spend:Channel Divinity'),1);
    });
    await test('failed weapon damage does not offer or spend optional riders',async()=>{
        const c=sandbox({fail:'damage'});await c.sendRollWithCharacter('attack','',c.attack());
        assert.equal(count(c,'spend:action'),1);assert.equal(count(c,'smite-choice'),0);
        assert.equal(count(c,'slot:1'),0);assert.equal(count(c,'spend:Channel Divinity'),0);
    });
    await test('missed deferred attack cannot roll damage through its stale button',async()=>{
        const c=sandbox({hit:false});await c.sendRollWithCharacter('attack','',c.attack({rollDamage:false}));
        assert.equal(await c.wayBeyond20ContinueAttackDamage(c.lastBase['waybeyond20-attack-continuation'].id),false);
        assert.equal(count(c,'send:damage'),0);
    });
    await test('Draining waits for hit/damage and excludes second-target elemental damage',async()=>{
        const c=sandbox({draining:true});await c.sendRollWithCharacter('attack','',c.attack());
        assert.equal(c.lastBase['waybeyond20-temp-hp-on-hit'],undefined);
        assert.ok(c.log.indexOf('thp:15')>c.log.indexOf('send:damage'));
        const d=sandbox({draining:true,hit:false});await d.sendRollWithCharacter('attack','',d.attack());
        assert.ok(!d.log.some(x=>x.startsWith('thp:')));
    });
    await test('unarmed semantics trigger Draining independently of attack name or Smite flag',async()=>{
        for (const name of ['Bardic Damage','Agile Strikes','Any renamed unarmed technique']) {
            for (const hit of [true,false]) {
                const c=sandbox({smites:false,hit});
                c.character.hasRacialTrait=(trait,substring)=>['Draining Attack','Natural Attack (Fangs/Claws)']
                    .some(value=>substring ? value.includes(trait) : value===trait);
                vm.runInContext(['addEffect','wayBeyond20RollIsUnarmedStrike',
                    'wayBeyond20NormalizeAttackSemantics','wayBeyond20ApplyDrainingAttackIntent'].map(fn).join('\n'),c);
                const args=c.attack({name,'attack-type':'Unarmed Strike','attack-source':'action',
                    'waybeyond20-smite-eligible':false});
                await c.sendRollWithCharacter('attack','1d6+3',args);
                assert.equal(count(c,'prompt:Attack result'),1,'Ask whether the unarmed strike hit');
                assert.equal(count(c,'thp:5'),hit ? 1 : 0,'Award once only after confirmed hit and damage');
                assert.equal(count(c,'smite-choice'),0);
            }
        }
        const c=sandbox({smites:false});
        vm.runInContext(['wayBeyond20RollIsUnarmedStrike','wayBeyond20NormalizeAttackSemantics'].map(fn).join('\n'),c);
        for (const traits of [['Draining Attack'],['Natural Attack'],[]]) {
            c.character.hasRacialTrait=trait=>traits.includes(trait);
            assert.equal(c.wayBeyond20NeedsAttackFollowup(c.attack({
                'attack-type':'Unarmed Strike','waybeyond20-smite-eligible':false})),false,'Both rule prerequisites required');
        }
        c.character.hasRacialTrait=()=>true;
        assert.equal(c.wayBeyond20NeedsAttackFollowup(c.attack({name:'Agile Strikes',
            'attack-source':'item','attack-type':'Melee','waybeyond20-smite-eligible':false})),false,
            'A familiar name alone does not make an unrelated weapon unarmed');
    });
    await test('Savage selects existing weapon rows, not riders; prompt replaces old auto-transform',async()=>{
        const c=sandbox({savage:true,smites:false});const args=c.attack();const changes={};
        c.wayBeyond20ApplySavageAttacker(c.character,args,[{id:'d0',dice:'1d8+3',tags:['base-weapon']}],changes);
        assert.equal(args['waybeyond20-savage-attacker'].mode,'post-result');assert.deepEqual(changes,{});
        await c.sendRollWithCharacter('attack','',args);
        assert.ok(c.log.indexOf('prompt:Savage Attacker')>c.log.indexOf('send:damage'));
        assert.equal(count(c,'reroll'),1);assert.equal(count(c,'replacement'),1);
    });
    await test('Savage decline is quiet for remaining attacks; new current turn permits a new offer',async()=>{
        const c=sandbox({useSavage:false});const request={};
        const intent={mode:'post-result',originalDamages:[{type:'Slashing'}]};
        const damage=[['Slashing Damage',roll(5),1]];
        await c.wayBeyond20ResolveSavageAttacker(request,damage,intent);
        await c.wayBeyond20ResolveSavageAttacker(request,damage,intent);
        assert.equal(count(c,'prompt:Savage Attacker'),1);assert.equal(count(c,'reroll'),0);
        c.state.currentRoll20Turn.turnKey='b';await c.wayBeyond20ResolveSavageAttacker(request,damage,intent);
        assert.equal(count(c,'prompt:Savage Attacker'),2);
    });
    await test('Savage compares whole weapon+critical package; Smite/secondary rows untouched',async()=>{
        const c=sandbox();let results=[1,2];c.dndbeyondDiceRoller._roller.roll=formula=>roll(results.shift(),false,formula);
        const original=roll(5),crit=roll(6,false,'1d8'),smite=roll(18),secondary=roll(8);
        const damage=[['Slashing Damage',original,1],['Slashing Critical Damage',crit,17],
            ['Radiant (Divine Smite) Damage',smite,4],['Fire (second creature) Damage',secondary,32]];
        await c.wayBeyond20ResolveSavageAttacker({},damage,{mode:'post-result',originalDamages:[{type:'Slashing'}]});
        assert.equal(results.length,0);assert.equal(damage[0][1],original);assert.equal(damage[1][1],crit);
        assert.equal(damage[2][1],smite);assert.equal(damage[3][1],secondary);
    });
    await test('Savage outside tracked combat stays available, and old opt-out behavior is preserved',async()=>{
        const c=sandbox({combat:false,savage:true});const damage=[['Slashing Damage',roll(5),1]], intent={mode:'post-result',originalDamages:[{type:'Slashing'}]};
        await c.wayBeyond20ResolveSavageAttacker({},damage,intent);await c.wayBeyond20ResolveSavageAttacker({},damage,intent);
        assert.equal(count(c,'prompt:Savage Attacker'),2);
        c.values['savage-attacker-prompt']=false;const args=c.attack(),changes={};
        c.wayBeyond20ApplySavageAttacker(c.character,args,[{id:'d0',dice:'1d8',tags:['base-weapon']}],changes);
        assert.equal(args['waybeyond20-savage-attacker'].mode,'reroll-formula-keep-higher');
        assert.equal(changes['savage-attacker'],false);
    });
    await test('shared renderer forwards deferred damage without resolving another roll on VTT',async()=>{
        const c={console,chrome:{runtime:{sendMessage:m=>{c.message=m;}}}};vm.createContext(c);
        vm.runInContext(read('src/common/roll_renderer.js')+'\nthis.Renderer=Beyond20RollRenderer;',c);
        const renderer=new c.Renderer(null,null,null);
        renderer.handleRollRequest({rollAttack:false,rollDamage:true,'waybeyond20-attack-continuation':{tab:12,id:'test'}});
        assert.equal(c.message.action,'forward');assert.equal(c.message.message.id,'test');
    });
    await test('real shared renderer and native dice resolve both spell riders and capture their results',async()=>{
        const c={console,Math,crypto:require('node:crypto').webcrypto,
            RollType:{NORMAL:0,DOUBLE:1,ADVANTAGE:3,DISADVANTAGE:4,THRICE:5,SUPER_ADVANTAGE:6,SUPER_DISADVANTAGE:7},
            CriticalRules:{PHB:0}, captures:[],
            wayBeyond20CaptureResolvedRoll:(request,attacks,damages)=>c.captures.push({request,attacks,damages})};
        vm.createContext(c);
        vm.runInContext(read('src/common/dice.js')+'\n'+read('src/common/roll_renderer.js')+
            '\nthis.Renderer=Beyond20RollRenderer;this.Roll=DNDBRoll;',c);
        const renderer=new c.Renderer({roll:formula=>new c.Roll(formula),
            resolveRolls:async(name,rolls)=>Promise.all(rolls.map(r=>r.roll()))},null,null);
        renderer.postDescription=async()=>true;
        for(const name of ['Divine Smite','Efreeti’s Fury']) {
            await renderer.handleRollRequest({type:'spell-attack',character:{type:'Character',settings:{}},
                name,description:'',rollAttack:false,rollDamage:true,rollCritical:name==='Divine Smite',
                damages:['2d4'],'damage-types':['Fire'],'critical-damages':['2d4'],'critical-damage-types':['Fire']});
        }
        assert.equal(c.captures.length,2);assert.equal(c.captures[0].damages.length,2);
        assert.equal(c.captures[1].damages.length,1);
        assert.ok(c.captures.every(x=>x.damages.every(([,r])=>r.total>=2)));
    });
    await test('both Roll20 templates hide managed damage links but retain deferred and ordinary links',async()=>{
        const roll20=read('src/roll20/content-script.js');
        for(const renderer of ['handleRenderedRoll','handleOGLRenderedRoll']) {
            for(const managed of [true,false,undefined]) {
                const c={console,Math,RollType:{ADVANTAGE:3,DISADVANTAGE:4},
                    settings:{}, $:()=>({val:()=> '0'}), hooks:0, cards:[],
                    convertRollToText:()=> '12', displayExtraInfo:()=> '',
                    postChatMessage:()=>{}, wayBeyond20SendResolvedDamageToDDB:()=>{},
                    hookRollDamages:()=>c.hooks++,
                    template:(request,type,props)=>{c.cards.push(props);return '';},
                    createTable:(request,title,props)=>{c.cards.push(props);return '';}};
                vm.createContext(c);vm.runInContext(extractFunction(renderer,roll20),c);
                await c[renderer]({request:{type:'attack',damages:['1d8'],rollAttack:true,
                    rollDamage:false,'waybeyond20-managed-damage':managed},
                    attributes:{},roll_info:[],attack_rolls:[{total:12}],damage_rolls:[],
                    total_damages:{},title:'Test weapon',character:'Test'});
                assert.equal(c.hooks,managed ? 0 : 1,`${renderer}: managed=${managed}`);
                assert.equal(JSON.stringify(c.cards).includes('beyond20-rendered-roll-button'),!managed);
            }
        }
    });
    await test('Savage keeps each complete versatile critical package, never a mix of best dice',async()=>{
        const c=sandbox();const totals=[10,4,1,9];
        c.dndbeyondDiceRoller._roller.roll=formula=>roll(totals.shift(),false,formula);
        const damage=[['Slashing (1-Hand) Damage',roll(6),1],
            ['Slashing (2-Hand) Damage',roll(5,false,'1d10+3'),2],
            ['Slashing (1-Hand) Critical Damage',roll(7,false,'1d8'),17],
            ['Slashing (2-Hand) Critical Damage',roll(4,false,'1d10'),18],
            ['Radiant (Divine Smite) Damage',roll(12,false,'2d8'),4]];
        await c.wayBeyond20ResolveSavageAttacker({},damage,{mode:'post-result',originalDamages:[
            {type:'Slashing (1-Hand)'},{type:'Slashing (2-Hand)'}]});
        assert.deepEqual(damage.map(([,r])=>r.total),[6,4,7,9,12]);
        assert.equal(totals.length,0);
    });
    await test('Savage offer resets on manual new turn and new combat, not repeated attacks',async()=>{
        const c=sandbox({useSavage:false});c.state.currentRoll20Turn=null;
        const intent={mode:'post-result',originalDamages:[{type:'Slashing'}]};
        const damage=[['Slashing Damage',roll(5),1]];
        for(let i=0;i<2;i++) await c.wayBeyond20ResolveSavageAttacker({},damage,intent);
        assert.equal(count(c,'prompt:Savage Attacker'),1);
        c.state.localTurnNumber++;
        await c.wayBeyond20ResolveSavageAttacker({},damage,intent);
        assert.equal(count(c,'prompt:Savage Attacker'),2);
        c.state.combatStartedAt++;c.state.localTurnNumber=1;
        await c.wayBeyond20ResolveSavageAttacker({},damage,intent);
        assert.equal(count(c,'prompt:Savage Attacker'),3);
    });
    await test('Draining uses the kept Savage result plus primary riders only, after replacement',async()=>{
        const c=sandbox({draining:true,savage:true});const args=c.attack();
        c.wayBeyond20ApplySavageAttacker(c.character,args,[{id:'d0',dice:'1d8+3',tags:['base-weapon']}],{});
        await c.sendRollWithCharacter('attack','',args);
        assert.equal(count(c,'thp:19'),1); // kept weapon 9 + Smite 5 + first-target fire 5
        assert.ok(c.log.indexOf('thp:19')>c.log.indexOf('replacement'));
        assert.ok(c.log.indexOf('replacement')<c.log.indexOf('smite-choice'));
        assert.ok(c.log.indexOf('thp:19')>c.log.indexOf('send:elemental'));
        assert.equal(c.lastDamage['waybeyond20-temp-hp-on-hit'],undefined);
    });
    await test('deferred continuation cannot apply to a different character after navigation',async()=>{
        const c=sandbox({draining:true});await c.sendRollWithCharacter('attack','',c.attack({rollDamage:false}));
        const id=c.lastBase['waybeyond20-attack-continuation'].id;
        c.character={...c.character};
        assert.equal(await c.wayBeyond20ContinueAttackDamage(id),false);
        assert.equal(count(c,'send:damage'),0);assert.ok(!c.log.some(x=>x.startsWith('thp:')));
    });
    console.log('Attack follow-up checks passed. No live browser acceptance is implied.');
})().catch(error=>{console.error(error);process.exitCode=1;});
