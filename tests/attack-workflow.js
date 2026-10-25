const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {sandbox, count, fn} = require('./attack-followups');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
function adapterFunction(file, name) {
    const source=read(file), start=source.search(new RegExp(`^(?:async )?function ${name}\\(`,'m'));
    assert.ok(start>=0,name);
    const next=source.slice(start+1).search(/^(?:function |async function |const |let |var |class )/m);
    return source.slice(start,next<0?undefined:start+1+next);
}
const hitForm = (outcome='hit', index='0') => ({find: selector => ({val: () => selector.includes('outcome') ? outcome : index})});
function candidate(options) {
    const c = sandbox(options);
    vm.runInContext(read('src/dndbeyond/base/attack-workflow.js') + '\n' +
        read('src/dndbeyond/content-scripts/attack-workflow-character.js'), c);
    c.sendRollWithCharacter = () => {throw Error('Secondary workflow re-entered legacy attack entry');};
    const prompt=c.dndbeyondDiceRoller._prompter.prompt;
    c.dndbeyondDiceRoller._prompter.prompt=async (...args)=>{
        const result=await prompt(...args);
        return args[0]==='Attack result' && result===true ? hitForm() : result;
    };
    return c;
}
function withTarget(c) {
    vm.runInContext(read('src/dndbeyond/content-scripts/my-target.js')+'\n'+
        ['wayBeyond20GetTurnTrackerState','wayBeyond20TurnTrackerStateEquals','wayBeyond20SetTurnTrackerState'].map(fn).join('\n'),c);
    c.settings={'vtt-tab':{vtt:'roll20'}};
    c.values['waybeyond20-turn-state']={inCombat:true,combatSource:'Roll20',combatStartedAt:10,selectedTargetKey:'A',
        knownTargets:[{tokenId:'A',name:'Zombie A'},{tokenId:'B',name:'Zombie B'}],targetRecords:{A:{observations:[],damage:[]}}};
    c.wayBeyond20ScheduleActiveEffectBadgeRefresh=()=>{};
    return c;
}
const d20 = (total, natural=total-5, discarded=false) => ({total,
    dice:[{faces:20,rolls:[{roll:natural}]}],isDiscarded:()=>discarded,isCriticalHit:()=>natural===20});
async function test(name, run) { await run(); console.log('PASS', name); }
(async () => {
    await test('candidate character path matches ancestor prompts, rolls, spends and riders', async () => {
        for (const options of [{}, {hit:false}, {chooseSmite:false}, {fail:'base'}, {fail:'damage'},
            {smites:false,draining:true}, {smites:false,draining:false}, {smites:true,draining:true},
            {fail:'smite'}, {fail:'elemental'}]) {
            const old = sandbox(options), next = candidate(options);
            const before = next.attack();
            const oldResult = await old.sendRollWithCharacter('attack', '', old.attack());
            const operation = next.wb20CreateCharacterAttackWorkflow('attack', '', before, 'test:weapon');
            const newResult = await operation.run();
            assert.deepEqual(next.log, old.log, JSON.stringify(options));
            // The secondary fixes the ancestor's ignored damage failure result.
            assert.equal(newResult, options.fail === 'damage' ? false : oldResult);
            assert.equal(before['waybeyond20-followup-phase'], undefined);
            assert.equal(before['waybeyond20-turn-resource'].resource, 'action');
        }
    });
    await test('same operation cannot roll, spend or award twice under concurrent calls', async () => {
        const c = candidate({smites:false, draining:true});
        const op = c.wb20CreateCharacterAttackWorkflow('attack', '', c.attack(), 'test:fangs');
        const first = op.run();
        assert.equal(op.run(), first);
        assert.deepEqual(await Promise.all([first, op.run()]), [true,true]);
        assert.equal(count(c,'send:base'),1); assert.equal(count(c,'send:damage'),1);
        assert.equal(count(c,'spend:action'),1); assert.equal(count(c,'thp:5'),1);
        assert.equal(await op.continueDamage(),true);
        assert.equal(count(c,'send:damage'),1);
    });
    await test('Savage, Smite and Elemental share the operation without re-entering the legacy entry', async () => {
        const old=sandbox({draining:true,savage:true}), next=candidate({draining:true,savage:true});
        const args=next.attack(), baseline=old.attack();
        for (const [c, properties] of [[old,baseline],[next,args]])
            c.wayBeyond20ApplySavageAttacker(c.character,properties,[{id:'d0',dice:'1d8+3',tags:['base-weapon']}],{});
        const types=[],send=next.sendRoll;
        next.sendRoll=async(owner,type,fallback,properties)=>{
            types.push([properties['waybeyond20-followup-phase'],type]);
            return send(owner,type,fallback,properties);
        };
        await old.sendRollWithCharacter('attack','',baseline);
        const op=next.wb20CreateCharacterAttackWorkflow('attack','',args,'test:all-riders');
        assert.equal(await op.run(),true);
        assert.deepEqual(next.log,old.log);
        assert.equal(count(next,'thp:19'),1);
        assert.deepEqual(types,[['base','attack'],['damage','attack'],['smite','spell-attack'],['elemental','spell-attack']]);
    });
    await test('deferred damage is explicit, single use, with no premature resource repeat', async () => {
        const c = candidate({smites:false,draining:true});
        const op = c.wb20CreateCharacterAttackWorkflow('attack','',c.attack({rollDamage:false}),'test:deferred');
        assert.equal(await op.continueDamage(),false);
        assert.equal(await op.run(),true);
        assert.equal(count(c,'send:damage'),0); assert.equal(count(c,'spend:action'),1);
        assert.deepEqual(await Promise.all([op.continueDamage(),op.continueDamage()]),[true,true]);
        assert.equal(count(c,'send:damage'),1); assert.equal(count(c,'spend:action'),1);
        assert.equal(count(c,'thp:5'),1);
        assert.ok(c.lastBase['waybeyond20-attack-continuation'].id.startsWith('workflow-'));
        assert.equal(await c.wayBeyond20ContinueAttackDamage(c.lastBase['waybeyond20-attack-continuation'].id),true);
        assert.equal(count(c,'send:damage'),1);
    });
    await test('changing characters rejects pending work rather than awarding the new character', async () => {
        const c = candidate({smites:false,draining:true});
        const op = c.wb20CreateCharacterAttackWorkflow('attack','',c.attack({rollDamage:false}),'test:owner');
        await op.run(); c.character = {...c.character};
        assert.equal(await op.continueDamage(),false);
        assert.equal(count(c,'send:damage'),0); assert.equal(count(c,'thp:5'),0);
    });
    await test('navigation during damage delivery cannot apply follow-ups to the new character', async () => {
        const c=candidate({draining:true}), send=c.sendRoll;
        c.sendRoll=async(owner,type,fallback,args)=>{
            const result=await send(owner,type,fallback,args);
            if (args['waybeyond20-followup-phase']==='damage') c.character={...c.character};
            return result;
        };
        const op=c.wb20CreateCharacterAttackWorkflow('attack','',c.attack(),'test:navigate-during-damage');
        assert.equal(await op.run(),false);
        assert.equal(count(c,'send:damage'),1);
        assert.equal(count(c,'smite-choice'),0);
        assert.ok(!c.log.some(value=>value.startsWith('thp:')));
        await op.run(); await op.continueDamage();
        assert.equal(count(c,'send:damage'),1);
    });
    await test('character operations serialize unresolved choices through the ancestor queue', async () => {
        const c = candidate({smites:false,draining:true}); let answer;
        c.dndbeyondDiceRoller._prompter.prompt = async () => new Promise(resolve => {answer=resolve;});
        const first=c.wb20CreateCharacterAttackWorkflow('attack','',c.attack(),'test:first');
        const second=c.wb20CreateCharacterAttackWorkflow('attack','',c.attack(),'test:second');
        const a=first.run(), b=second.run();
        await new Promise(resolve=>setImmediate(resolve));
        assert.equal(count(c,'send:base'),1);
        answer(hitForm()); await a;
        await new Promise(resolve=>setImmediate(resolve));
        assert.equal(count(c,'send:base'),2);
        answer(hitForm()); await b;
        assert.equal(count(c,'thp:5'),2);
    });
    await test('queued unperformed attack cannot borrow the next turn after another choice delays it', async () => {
        const c=candidate({smites:false,draining:true});let answer;
        c.dndbeyondDiceRoller._prompter.prompt=async()=>new Promise(resolve=>{answer=resolve;});
        const first=c.wb20CreateCharacterAttackWorkflow('attack','',c.attack(),'test:already-performed');
        const next=c.wb20CreateCharacterAttackWorkflow('attack','',c.attack(),'test:queued');
        const a=first.run(),b=next.run();await new Promise(resolve=>setImmediate(resolve));
        c.state.localTurnNumber++;answer(hitForm());
        assert.equal(await a,true);assert.equal(await b,false);
        assert.equal(count(c,'send:base'),1);assert.equal(count(c,'spend:action'),1);
    });
    await test('cancelled preflight sends nothing and spends nothing', async () => {
        const c = candidate({smites:false,draining:true});
        c.wayBeyond20PreflightTurnResource=async()=>false;
        const op=c.wb20CreateCharacterAttackWorkflow('attack','',c.attack(),'test:cancel');
        assert.equal(await op.run(),false);
        assert.equal(c.log.length,0);
    });
    await test('granted reaction pays its own currency once, retaining deferred critical/privacy context', async () => {
        const c = candidate({smites:true,draining:true});
        const activation=c.wayBeyond20CreateAttackActivation({resource:'reaction',attacks:1});
        const op=c.wb20CreateCharacterAttackWorkflow('attack','',c.attack({rollDamage:false,
            'waybeyond20-attack-activation':activation,
            'waybeyond20-attack-context':{kind:'opportunity',isOwnTurn:false,turnKey:activation.turnKey}}),'test:reaction');
        await op.run(); await op.continueDamage();
        assert.equal(count(c,'spend:reaction'),1); assert.equal(count(c,'spend:action'),0);
        assert.equal(count(c,'smite-choice'),0); assert.equal(activation.remaining,0);
        assert.equal(c.lastDamage.whisper,1); assert.equal(c.lastDamage.rollCritical,true);
    });
    await test('real shared resource and feature modules pay Flurry once and Harm once', async () => {
        for (const deferred of [false,true]) {
            const c=candidate({smites:false,draining:true});
            Object.assign(c.character,{_id:'feature-owner',_class_features:['Monk’s Focus','Hand of Harm','Hand of Healing'],
                _proficiency:2,getClassLevel:()=>3,getAbility:()=>({mod:'+3'}),
                mergeCharacterSettings:(values,callback)=>{Object.assign(c.values,values);callback?.();}});
            vm.runInContext(read('src/dndbeyond/content-scripts/resources.js'),c);
            c.wb20RegisterResource({name:'Focus Points',max:3,reset:'short'});
            await c.wb20SetResource('Focus Points',3);
            vm.runInContext(read('src/dndbeyond/content-scripts/feature-activations.js'),c);
            c.dndbeyondDiceRoller._prompter.prompt=async title=>{
                c.log.push('prompt:'+title);return title==='Attack result' ? hitForm() : {find:()=>({prop:()=>false})};
            };
            const activation=c.wayBeyond20CreateAttackActivation({resource:'bonusAction',attacks:2});
            const op=c.wb20CreateCharacterAttackWorkflow('attack','',c.attack({name:'Unarmed Strike',rollDamage:!deferred,
                'waybeyond20-smite-eligible':false,'waybeyond20-attack-activation':activation,
                ...c.wb20FeatureCost({focus:1}),'waybeyond20-unarmed-strike':true}),'test:flurry');
            assert.equal(await op.run(),true);
            if (deferred) {
                assert.equal(c.wb20Resource('Focus Points').remaining,2);
                await op.continueDamage();
            }
            assert.equal(c.wb20Resource('Focus Points').remaining,1);
            assert.equal(count(c,'spend:bonusAction'),1); assert.equal(count(c,'spend:action'),0);
            assert.equal(activation.remaining,1); assert.equal(count(c,'prompt:Hand of Harm'),1);
            assert.equal(count(c,'thp:10'),1);
        }
    });
    await test('miss/skip never becomes an asserted miss or a damage award', async () => {
        const c = candidate({hit:false,draining:true});
        const op = c.wb20CreateCharacterAttackWorkflow('attack','',c.attack(),'test:skip');
        assert.equal(await op.run(),true);
        assert.equal(await op.continueDamage(),false);
        assert.equal(count(c,'send:damage'),0);
        assert.equal(op.context.trace.includes('observe-hit'),false);
    });
    await test('real VTT damage callbacks do not repeat an award owned by the shared sheet continuation', async () => {
        const c=withTarget(candidate({smites:false,draining:true})), messages=[];
        c.wayBeyond20SendCustomMessageToExtension=message=>messages.push(message);
        c.wayBeyond20FvttSend=message=>messages.push(message);
        c.wayBeyond20DebugLog=()=>{};
        c.character.hasRacialTrait=(trait,substring)=>['Draining Attack','Natural Attack (Fangs/Claws)']
            .some(value=>substring ? value.includes(trait) : value===trait);
        vm.runInContext(['addEffect','wayBeyond20RollIsUnarmedStrike','wayBeyond20NormalizeAttackSemantics',
            'wayBeyond20ApplyDrainingAttackIntent'].map(fn).join('\n'),c);
        vm.runInContext(adapterFunction('src/roll20/content-script.js','wayBeyond20SendResolvedDamageToDDB')+'\n'+
            adapterFunction('src/fvtt/page-script.js','wayBeyond20FvttResolvedDamage'),c);
        const op=c.wb20CreateCharacterAttackWorkflow('attack','',c.attack({name:'Fangs/Claws (Dexterity)',
            'attack-source':'action','attack-type':'Melee'}),'test:award-owner');
        assert.equal(await op.run(),true);
        assert.equal(count(c,'thp:5'),1);
        const damage=[['Slashing Damage',{total:5},c.DAMAGE_FLAGS.REGULAR]];
        c.wayBeyond20SendResolvedDamageToDDB({request:c.lastDamage,damage_rolls:damage});
        c.wayBeyond20FvttResolvedDamage(c.lastDamage,damage);
        assert.equal(messages.length,0,'the continuation owns the full damage and rider total');
        // Destination-resolved ancestor rolls still need the return path.
        const request={...c.lastDamage};delete request['waybeyond20-await-hit'];
        c.wayBeyond20SendResolvedDamageToDDB({request,damage_rolls:damage});
        c.wayBeyond20FvttResolvedDamage(request,damage);
        assert.equal(messages.length,2);
        assert.ok(messages.every(message=>message.totalDamage===5));
    });
    await test('standalone unarmed damage can apply Draining after explicit hit without inventing a d20 or spending another action', async () => {
        const c=withTarget(candidate({smites:false,draining:true}));
        const op=c.wb20CreateCharacterAttackWorkflow('attack','',c.attack({rollAttack:false}),'test:damage-only');
        assert.equal(await op.run(),true);
        assert.equal(count(c,'send:base'),0);
        assert.equal(count(c,'send:damage'),1);
        assert.equal(count(c,'spend:action'),0);
        assert.equal(count(c,'thp:5'),1);
        assert.equal(op.context.observationStatus,'no-single-result');
        assert.equal(c.wayBeyond20GetTurnTrackerState().targetRecords.A.observations.length,0);
        assert.equal(await op.continueDamage(),true);
        assert.equal(count(c,'send:damage'),1);
    });
    await test('save-based spell damage keeps transport ownership without a fabricated attack or AC observation', async () => {
        const c=withTarget(candidate({smites:false,draining:false}));
        const args=c.attack({name:'Save spell',rollAttack:false,'to-hit':undefined,
            'waybeyond20-smite-eligible':false,'save-dc':14,'save-ability':'DEX'});
        const op=c.wb20CreateCharacterAttackWorkflow('spell-attack','',args,'test:save-spell');
        assert.equal(await op.run(),true);
        assert.equal(count(c,'send:undefined'),1);
        assert.equal(count(c,'prompt:Attack result'),0);
        assert.equal(count(c,'thp:5'),0);
        assert.equal(c.wayBeyond20GetTurnTrackerState().targetRecords.A.observations.length,0);
        assert.equal(op.context.trace.includes('observe-hit'),false);
    });
    await test('shared lifecycle preserves explicit target and skips unknown hit observations', async () => {
        const c = candidate(); let selected = 'zombie-A', recorded = [], sends = 0;
        const adapter = {
            isCurrent:()=>true, prepare:async()=>true, needsHit:()=>true,
            dispatch:async()=>{sends++;selected='zombie-B';return {accepted:true,attacks:[],request:null};},
            confirmHit:async()=>true,
            observeHit:async(ctx,result,hit)=>recorded.push([ctx.targetKey,hit]),
            finishDamage:async()=>true
        };
        const op = c.wb20CreateAttackWorkflow({actor:{},caller:'test:target',rollType:'attack',
            targetKey:selected,args:{rollAttack:true,rollDamage:true}},adapter);
        await op.run(); await op.run();
        assert.deepEqual(recorded,[['zombie-A',true]]); assert.equal(sends,1);
        assert.equal(selected,'zombie-B');
    });
    await test('errors retain the failed operation; replay cannot repeat its side effects', async () => {
        const c = candidate(); let sends = 0;
        const op = c.wb20CreateAttackWorkflow({actor:{},caller:'test:failure',rollType:'attack',args:{}},{
            isCurrent:()=>true,prepare:async()=>true,needsHit:()=>false,
            dispatch:async()=>{sends++;throw Error('transport failed');},
            confirmHit:async()=>true,finishDamage:async()=>true
        });
        await assert.rejects(op.run(),/transport failed/);
        await assert.rejects(op.run(),/transport failed/); assert.equal(sends,1);
    });
    await test('actual target writer records captured enemy, preserves selection, and persists exact AC bounds', async () => {
        const c=withTarget(candidate());
        for (const [total,hit] of [[18,true],[12,false],[15,true],[14,false]]) {
            const context={actor:c.character,targetKey:'A',boardKey:'roll20',combatSource:'Roll20',combatStartedAt:10};
            c.wayBeyond20SetTurnTrackerState({...c.wayBeyond20GetTurnTrackerState(),selectedTargetKey:'B'});
            assert.equal(c.wb20TargetObserveAttack(context,d20(total),hit),true);
            assert.equal(c.wb20TargetObserveAttack(context,d20(total),hit),false);
        }
        const state=c.wayBeyond20GetTurnTrackerState();
        assert.equal(state.selectedTargetKey,'B');
        assert.equal(state.targetRecords.A.observations.length,4);
        assert.equal(c.wb20TargetAC(state.targetRecords.A.observations),'15');
        assert.equal(state.targetRecords.B,undefined);
    });
    await test('target writer rejects changed source/combat, ambiguous dice and natural auto outcomes', async () => {
        const c=withTarget(candidate());
        const context=()=>({actor:c.character,targetKey:'A',boardKey:'roll20',combatSource:'Roll20',combatStartedAt:10});
        for(const [roll,hit] of [[d20(25,20),true],[d20(6,1),false],[d20(17,12,true),true],
            [{total:17,dice:[],isDiscarded:()=>false},true]])
            assert.equal(c.wb20TargetObserveAttack(context(),roll,hit),false);
        assert.equal(c.wb20TargetObserveAttack({...context(),boardKey:'fvtt'},d20(18),true),false);
        assert.equal(c.wb20TargetObserveAttack({...context(),combatStartedAt:9},d20(18),true),false);
        assert.equal(c.wb20TargetObserveAttack({...context(),combatSource:'Foundry'},d20(18),true),false);
        assert.equal(c.wayBeyond20GetTurnTrackerState().targetRecords.A.observations.length,0);
        assert.equal(c.wb20TargetObserveAttack(context(),d20(24,19),true),true,'expanded crit is not natural20');
    });
    await test('targeted attack without feature riders still records hit/miss through the candidate', async () => {
        for(const outcome of ['hit','miss','']) {
            const c=withTarget(candidate({smites:false}));
            c.dndbeyondDiceRoller._prompter.prompt=async()=>hitForm(outcome);
            const send=c.sendRoll;
            c.sendRoll=async(owner,type,fallback,args)=>{
                const capture=args['waybeyond20-capture-result'];
                if(capture) args['waybeyond20-capture-result']=(request,attacks,damages)=>capture(request,
                    args.rollAttack ? [d20(18)] : attacks,damages);
                return send(owner,type,fallback,args);
            };
            const op=c.wb20CreateCharacterAttackWorkflow('attack','',c.attack({'waybeyond20-smite-eligible':false}),'test:targeted');
            assert.equal(await op.run(),true);
            const observations=c.wayBeyond20GetTurnTrackerState().targetRecords.A.observations;
            assert.equal(observations.length,outcome ? 1 : 0);
            if(outcome) assert.equal(observations[0].hit,outcome==='hit');
            assert.equal(count(c,'send:damage'),outcome==='hit' ? 1 : 0);
        }
    });
    await test('actual unarmed/Draining classifiers work for fangs, renamed unarmed attacks and weapon exclusions', async () => {
        for(const [properties,expected] of [
            [{name:'Fangs/Claws (Dexterity)','attack-source':'action','attack-type':'Melee'},1],
            [{name:'Any renamed technique','attack-source':'action','attack-type':'Unarmed Strike'},1],
            [{name:'Fangs','attack-source':'item','attack-type':'Melee'},0],
            [{name:'Claws','attack-source':'spell','attack-type':'Melee'},0]]) {
            const c=candidate({smites:false});
            c.character.hasRacialTrait=(trait,substring)=>['Draining Attack','Natural Attack (Fangs/Claws)']
                .some(value=>substring ? value.includes(trait) : value===trait);
            vm.runInContext(['addEffect','wayBeyond20RollIsUnarmedStrike','wayBeyond20NormalizeAttackSemantics',
                'wayBeyond20ApplyDrainingAttackIntent'].map(fn).join('\n'),c);
            await c.wb20CreateCharacterAttackWorkflow('attack','',c.attack({
                'waybeyond20-smite-eligible':false,...properties}),'test:real-classification').run();
            assert.equal(count(c,'thp:5'),expected,properties.name);
        }
    });
    await test('selected result controls critical damage when another active result is a natural20', async () => {
        const c=candidate({draining:true});
        c.dndbeyondDiceRoller._prompter.prompt=async()=>hitForm('hit','1');
        const send=c.sendRoll;
        c.sendRoll=async(owner,type,fallback,args)=>{
            const capture=args['waybeyond20-capture-result'];
            if(capture && args.rollAttack) args['waybeyond20-capture-result']=(request,attacks,damages)=>capture(request,[d20(25,20),d20(18)],damages);
            return send(owner,type,fallback,args);
        };
        await c.wb20CreateCharacterAttackWorkflow('attack','',c.attack(),'test:chosen-roll').run();
        assert.equal(c.lastDamage.rollCritical,false);
    });
    await test('destination change while hit choice is open cannot redirect remaining damage', async () => {
        const c=candidate({draining:true}); let destination={id:1,vtt:'fvtt',title:'First'};
        c.character.getGlobalSetting=(key,fallback)=>key==='vtt-tab' ? destination : fallback;
        c.dndbeyondDiceRoller._prompter.prompt=async()=>{destination={id:2,vtt:'fvtt',title:'Second'};return hitForm();};
        const op=c.wb20CreateCharacterAttackWorkflow('attack','',c.attack(),'test:destination');
        assert.equal(await op.run(),false); assert.equal(count(c,'send:damage'),0);
        assert.ok(!c.log.some(value=>value.startsWith('thp:')));
    });
    await test('in-place destination edits cannot move the operation routing snapshot', async () => {
        const c=candidate({draining:true}), destination={id:1,vtt:'fvtt',title:'First'};
        c.character.getGlobalSetting=(key,fallback)=>key==='vtt-tab' ? destination : fallback;
        c.dndbeyondDiceRoller._prompter.prompt=async()=>{destination.id=2;destination.title='Second';return hitForm();};
        const op=c.wb20CreateCharacterAttackWorkflow('attack','',c.attack(),'test:mutated-destination');
        assert.equal(await op.run(),false);
        assert.equal(op.context.destination.id,1);assert.equal(count(c,'send:damage'),0);
    });
    await test('real character dispatcher and transport stop a destination change during privacy or advantage query', async () => {
        for(const query of ['privacy','advantage']) {
            const c=candidate({smites:false,draining:false});let destination={id:1,vtt:'roll20',title:'First'},sends=0;
            c.WhisperType={NO:0,YES:1,QUERY:2,HIDE_NAMES:3};
            c.RollType={NORMAL:0,QUERY:2,ADVANTAGE:3,DISADVANTAGE:4,SUPER_ADVANTAGE:6,
                SUPER_DISADVANTAGE:7,OVERRIDE_ADVANTAGE:8,OVERRIDE_DISADVANTAGE:9};c.key_modifiers={};
            c.character.type=()=> 'Character';c.character.getDict=()=>({name:'Test',type:'Character'});
            c.character.getGlobalSetting=(key,fallback)=>key==='vtt-tab'?destination:
                key==='whisper-type'&&query==='privacy'?2:key==='roll-type'&&query==='advantage'?2:fallback;
            c.cleanRoll=value=>value;c.wayBeyond20ExtensionContextAvailable=()=>true;
            c.wayBeyond20NotifyDispatchFailure=message=>{throw Error(message);};
            c.wayBeyond20SendRuntimeMessage=async()=>{sends++;return {ok:true,response:{}};};
            c.beyond20SendMessageFailure=()=>{};c.DigitalDiceManager={isEnabled:()=>false};
            c.dndbeyondDiceRoller.queryWhisper=async()=>{destination.id=2;return 1;};
            c.dndbeyondDiceRoller.queryAdvantage=async()=>{destination.id=2;return 3;};
            vm.runInContext(adapterFunction('src/dndbeyond/base/utils.js','sendRoll'),c);
            const op=c.wb20CreateCharacterAttackWorkflow('attack','1d20+5',c.attack(),'test:query-guard');
            assert.equal(await op.run(),false,query);assert.equal(sends,0,query);
            assert.equal(count(c,'spend:action'),0,query);
        }
    });
    await test('opt-in gate keeps legacy default and executes only one route when enabled', async () => {
        for (const enabled of [false,true]) {
            const c=candidate({smites:false,draining:true}); let entries=0;
            const factory=c.wb20CreateCharacterAttackWorkflow;
            c.wb20CreateCharacterAttackWorkflow=(...args)=>{entries++;return factory(...args);};
            c.character.getGlobalSetting=(key,fallback)=>key==='waybeyond20-secondary-attacks' ? enabled : fallback;
            vm.runInContext(fn('sendRollWithCharacter'),c);
            assert.equal(await c.sendRollWithCharacter('attack','',c.attack()),true);
            assert.equal(entries,enabled ? 1 : 0);
            assert.equal(count(c,'send:base'),1); assert.equal(count(c,'send:damage'),1);
            assert.equal(count(c,'spend:action'),1); assert.equal(count(c,'thp:5'),1);
        }
    });
    await test('cards and already-owned continuations do not start another secondary attack', async () => {
        const c=candidate({smites:false});
        c.character.getGlobalSetting=(key,fallback)=>key==='waybeyond20-secondary-attacks' ? true : fallback;
        c.wb20CreateCharacterAttackWorkflow=()=>{throw Error('Unexpected secondary entry');};
        vm.runInContext(fn('sendRollWithCharacter'),c);
        await c.sendRollWithCharacter('trait','',{});
        await c.sendRollWithCharacter('attack','',c.attack({rollAttack:false,rollDamage:false}));
        await c.sendRollWithCharacter('attack','',c.attack({'waybeyond20-followup-phase':'damage'}));
    });
    console.log('Secondary workflow checks passed; VM transport boundaries are mocked. No live acceptance.');
})().catch(error=>{console.error(error);process.exitCode=1;});
