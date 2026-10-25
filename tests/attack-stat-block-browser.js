// Offline producer -> shared lifecycle -> real sendRoll characterization.
// Actual stat-block parsers/button callbacks run against representative DOM.
// The runtime/dice renderer are boundaries, not live DDB/VTT acceptance.
const {chromium} = require(process.env.WB20_PLAYWRIGHT || 'playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
function fn(file,name,source=read(file)){
    const start=source.search(new RegExp(`^(?:async )?function ${name}\\(`,'m'));
    assert.ok(start>=0,name);
    const end=source.slice(start+1).search(/^(?:(?:async )?function |const |let |var |class )/m);
    return source.slice(start,end<0?undefined:start+1+end);
}
const common='src/common/utils.js',utils='src/dndbeyond/base/utils.js';
const transport=process.env.WB20_TRANSPORT_SOURCE ? fn(utils,'sendRoll',fs.readFileSync(process.env.WB20_TRANSPORT_SOURCE,'utf8')) : fn(utils,'sendRoll');
const helpers=[fn(common,'cleanRoll'),fn(common,'reMatchAll'),fn(utils,'damagesToCrits'),
    fn(utils,'addCustomDamages'),fn('src/dndbeyond/content-scripts/character.js','split_custom_damages'),transport].join('\n');
const options=[
    {kind:'Monster',type:'Monster'},
    {kind:'MonsterExtras',type:'Monster'},
    {kind:'Monster',type:'Vehicle'},
    {kind:'MonsterExtras',type:'Creature',form:'Familiar'},
    {kind:'Monster',type:'Creature',form:'Wild Shape'},
    {kind:'MonsterExtras',type:'Creature',form:'Wild Shape 2024'},
    {kind:'MonsterExtras',type:'Extra-Vehicle'}
];
(async()=>{
    const browser=await chromium.launch({channel:'chrome',headless:true});
    try {
        let page;
        for(const setup of options){
            const results=[];
            for(const mode of ['ancestor','off','on']){
                if(page)await page.close();
                page=await browser.newPage();
                await page.setContent('<main id="fixture"></main>');
                await page.addScriptTag({path:path.join(root,'libs/jquery-3.4.1.min.js')});
                await page.addScriptTag({content:`
                    var requests=[], local=[], operations=[], buttons=[], notifications=[], key_modifiers={}, settings={
                        'waybeyond20-secondary-attacks':${mode==='on'}, 'auto-roll-damage':true,
                        'roll-type':0,'whisper-type':0,'whisper-type-monsters':3,
                        'vtt-tab':{id:7,vtt:'roll20',title:'Test'}};
                    var RollType={NORMAL:0,QUERY:2,ADVANTAGE:3,DISADVANTAGE:4,SUPER_ADVANTAGE:6,
                        SUPER_DISADVANTAGE:7,OVERRIDE_ADVANTAGE:8,OVERRIDE_DISADVANTAGE:9};
                    var WhisperType={NO:0,YES:1,QUERY:2,HIDE_NAMES:3};
                    var CriticalRules={PHB:0,HOMEBREW_MAX:1,HOMEBREW_DOUBLE:2,HOMEBREW_MOD:3,HOMEBREW_REROLL:4};
                    class CharacterBase {
                        constructor(type,global){this._type=type;this._global_settings=global;this._url='https://www.dndbeyond.com/monsters/test';}
                        type(){return this._type;}
                        getSetting(key,fallback='',values=null){return (values||this._settings||{})[key]??fallback;}
                        getGlobalSetting(key,fallback=''){return this._global_settings[key]??fallback;}
                    }
                    function addRollButton(actor,callback,block,options){
                        const id='roll'+buttons.length;buttons.push({actor,callback,options});
                        $(block).append('<button id="'+id+'">'+options.text+'</button>');
                        $('#'+id).on('click',()=>{local.push(callback());});return id;
                    }
                    function descriptionToString(el){return el.textContent;}
                    function addEffect(args,name){(args.effects||=[]).push(name);}
                    function adjustRollAndKeyModifiersWithDisadvantage(req){req.advantage=4;}
                    function wayBeyond20ExtensionContextAvailable(){return true;}
                    function wayBeyond20NotifyDispatchFailure(message){notifications.push(message);}
                    async function wayBeyond20SendRuntimeMessage(req){requests.push(JSON.parse(JSON.stringify(req)));return {ok:true,response:{success:true}};}
                    function beyond20SendMessageFailure(){}
                    var dndbeyondDiceRoller={queryWhisper:async()=>1,queryAdvantage:async()=>3,
                        handleRollRequest:async()=>{throw Error('Unexpected local dice capture');}};
                    var DigitalDiceManager={isEnabled:()=>false};
                `});
                await page.addScriptTag({content:helpers});
                await page.addScriptTag({content:read('src/dndbeyond/base/attack-workflow.js')+'\n'+read('src/dndbeyond/base/attack-workflow-stat-block.js')});
                let classes=read('src/dndbeyond/base/monster.js')+'\n'+read('src/dndbeyond/base/extras.js');
                if(mode==='ancestor')classes=classes.replace(/return wb20SendStatBlockAttack\(this, "1d20" \+ \(roll_properties\["to-hit"\] \|\| ""\),\s*roll_properties, "(?:Monster|MonsterExtras)\.lookForActions"\);/g,
                    'return sendRoll(this,"attack","1d20"+(roll_properties["to-hit"]||""),roll_properties);');
                await page.addScriptTag({content:classes});
                const result=await page.evaluate(async setup=>{
                    const parent={hasClass:()=>true,hasClassFeature:()=>true,getClassLevel:()=>10,
                        getSetting:(key,fallback)=>({'custom-damage-dice':'Fire: 1d4','barbarian-rage':true,
                            'druid-improved-lunar-radiance':true,'druid-circle-of-mutation-circle-forms':true,
                            'discord-target':'private-group'})[key]??fallback,
                        getDict:()=>({name:'Parent sheet',settings:{'effects-bless':true}})};
                    // Represents the page's custom-damage owner; not the rolled actor.
                    window.character=parent;
                    const actor=setup.kind==='Monster' ? new Monster(setup.type,null,settings,{character:parent,creatureType:setup.form}) :
                        new MonsterExtras(setup.type,'.mon-stat-block-2024',settings,{character:parent,creatureType:setup.form});
                    actor._name='Test creature';actor._id='creature-17';actor._hp=18;actor._max_hp=25;
                    const desc='<p><strong>Bite.</strong> Melee Weapon Attack: +5 to hit, reach 5 ft., one target. Hit: 7 (1d8 + 3) piercing damage.</p>'+
                        '<p><strong>Roar.</strong> Each creature must make a DC 12 Wisdom saving throw.</p>'+
                        '<p><strong>Watchful.</strong> The creature watches the door.</p>';
                    $('#fixture').html(setup.kind==='Monster' ? '<div class="mon-stat-block__description-blocks"><div class="mon-stat-block__description-block"><div class="mon-stat-block__description-block-content">'+desc+'</div></div></div>' :
                        '<h2 class="mon-stat-block-2024__description-block-heading">Actions</h2><div class="mon-stat-block-2024__description-block-content ddbc-html-content">'+desc+'</div>');
                    if(setup.kind==='Monster')actor._base='.mon-stat-block';
                    const create=wb20CreateAttackWorkflow;
                    window.wb20CreateAttackWorkflow=(...args)=>{const op=create(...args);operations.push(op);return op;};
                    actor.lookForActions($('#fixture'),true,false);
                    // Click after changing hotkeys/settings: producers must rebuild fresh.
                    settings['auto-roll-damage']=false;
                    key_modifiers={'custom_modifier:2':true,'custom_damage:Cold: 1d6':true,advantage:true};
                    await buttons.find(b=>b.options.text==='Bite').callback();
                    key_modifiers={display_attack:true};
                    await buttons.find(b=>b.options.text==='Bite').callback();
                    key_modifiers={};
                    await buttons.find(b=>b.options.text==='Roar').callback();
                    await buttons.find(b=>b.options.text==='Watchful').callback();
                    return {requests,operationCount:operations.length,
                        contexts:operations.map(op=>({caller:op.context.caller,actor:op.context.actor===actor,
                            hitOwner:op.context.hitOwner,resourceOwner:op.context.resourceOwner,
                            targetKey:op.context.targetKey,trace:op.context.trace})),
                        nativeParentUntouched:!parent.spent};
                },setup);
                results.push(result);
            }
            assert.deepEqual(results[1].requests,results[0].requests,setup.kind+' default ancestor');
            assert.deepEqual(results[2].requests,results[0].requests,JSON.stringify(setup)+' candidate parity');
            assert.equal(results[2].operationCount,2,'Bite and save-only Roar are attack requests; cards are not');
            for(const c of results[2].contexts){
                assert.equal(c.actor,true);assert.equal(c.hitOwner,'destination');assert.equal(c.resourceOwner,null);
                assert.equal(c.targetKey,null);assert.deepEqual(c.trace,['prepare','choose-hit-handling','dispatch']);
            }
            const bite=results[2].requests[0];
            assert.equal(bite.character.name,'Test creature');assert.equal(bite.character.id,'creature-17');
            assert.equal(bite.character.hp,18);assert.equal(bite.rollDamage,false);assert.equal(bite.advantage,3);
            assert.equal(bite['to-hit'],'+5 + 2');assert.ok(bite['damage-types'].includes('Cold'));
            assert.equal(bite.whisper,['Monster','Vehicle'].includes(setup.type)?3:0);
            assert.ok(!Object.keys(bite).some(k=>/capture-result|await-hit|turn-resource/.test(k)));
            assert.equal(results[2].requests[1].type,'trait');assert.equal(results[2].requests[3].type,'trait');
            console.log('PASS actual producers/transport parity',setup.kind,setup.type,setup.form||'');
        }
        // Engine ownership and idempotence, using the real stat-block adapter.
        const guards=await page.evaluate(async()=>{
            const actor=new Monster('Monster',null,settings);actor._name='Guard';actor._id='guard';
            const args={name:'Bite',rollAttack:true,rollDamage:true,damages:['1d8'], 'damage-types':['Piercing']};
            const start=requests.length,op=wb20CreateStatBlockAttackWorkflow(actor,'1d20+5',args,'test:guard');
            const a=op.run(),b=op.run();await Promise.all([a,b]);await op.continueDamage();
            const once=requests.length-start;
            const stale=wb20CreateStatBlockAttackWorkflow(actor,'1d20+5',args,'test:stale');
            actor._id='replacement';const staleResult=await stale.run();
            const changed=wb20CreateStatBlockAttackWorkflow(actor,'1d20+5',args,'test:route');
            settings['vtt-tab'].id=99;const routeResult=await changed.run();
            const parent=wb20CreateStatBlockAttackWorkflow(actor,'1d20+5',args,'test:parent');
            actor._parent_character={};const parentResult=await parent.run();
            const source=document.createElement('section');document.body.append(source);actor._stat_block=$(source);
            const detached=wb20CreateStatBlockAttackWorkflow(actor,'1d20+5',args,'test:detached');
            source.remove();const detachedResult=await detached.run();
            return {same:a===b,once,staleResult,routeResult,parentResult,detachedResult,total:requests.length-start,
                original:args.damages,trace:op.context.trace};
        });
        assert.equal(guards.same,true);assert.equal(guards.once,1);assert.equal(guards.total,1);
        assert.equal(guards.staleResult,false);assert.equal(guards.routeResult,false);
        assert.equal(guards.parentResult,false);assert.equal(guards.detachedResult,false);
        assert.deepEqual(guards.original,['1d8']);
        console.log('PASS one dispatch, stale actor/destination rejection, no invented damage continuation');
        const queryGuard=await page.evaluate(async()=>{
            const actor=new Monster('Monster',null,settings);actor._name='Query';actor._id='query';
            settings['whisper-type-monsters']=0;settings['whisper-type']=2;
            dndbeyondDiceRoller.queryWhisper=async()=>{settings['vtt-tab'].id++;return 1;};
            const start=requests.length,op=wb20CreateStatBlockAttackWorkflow(actor,'1d20+5',
                {name:'Bite',rollAttack:true,rollDamage:true},'test:query-ownership');
            return {result:await op.run(),sent:requests.length-start};
        });
        assert.deepEqual(queryGuard,{result:false,sent:0});
        console.log('PASS destination change during privacy query stops before transport');
        const failures=await page.evaluate(async()=>{
            const actor=new Monster('Monster',null,settings);actor._name='Cancel';actor._id='cancel';
            const args={name:'Bite',rollAttack:true,rollDamage:true};
            settings['whisper-type-monsters']=0;settings['whisper-type']=2;
            dndbeyondDiceRoller.queryWhisper=async()=>null;
            const count=requests.length,op=wb20CreateStatBlockAttackWorkflow(actor,'1d20+5',args,'test:cancel');
            const cancelled=await op.run(),again=await op.run();
            settings['whisper-type']=0;
            let attempts=0;
            window.wayBeyond20SendRuntimeMessage=async()=>{attempts++;return {ok:false,error:'test transport failure'};};
            const failed=wb20CreateStatBlockAttackWorkflow(actor,'1d20+5',args,'test:failure');
            const result=await failed.run(),retry=await failed.run();
            return {cancelled,again,result,retry,attempts,sent:requests.length-count,notifications};
        });
        assert.deepEqual(failures,{cancelled:false,again:false,result:false,retry:false,
            attempts:1,sent:0,notifications:['test transport failure']});
        console.log('PASS privacy cancellation and failed transport cannot repeat a dispatch');
    } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
