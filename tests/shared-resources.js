// Actual shared dispatcher + resource engine, with native counters as the boundary.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const characterSource=fs.readFileSync(path.join(root,'src/dndbeyond/content-scripts/character.js'),'utf8');
function unit(name){const start=new RegExp(`^(?:async )?function ${name}\\(`,'m').exec(characterSource);assert.ok(start,name);const tail=characterSource.slice(start.index+start[0].length),end=/^(?:async )?function |^(?:const|let|var|class) /m.exec(tail);return characterSource.slice(start.index,end?start.index+start[0].length+end.index:undefined);}
function fixture(features=['Flurry of Blows','Martial Arts','Hand of Healing','Hand of Harm'],level=0){
    const settings={},native={focus:2,max:3},state={inCombat:true,combatSource:'Manual',combatStartedAt:1,localTurnNumber:1,action:1,bonusAction:1,reaction:1,attacksRemaining:0,featureGrants:{}};
    const c={console,Promise,Number,String,Math,Date,Map,WeakMap,Set,Object,Array,JSON,setTimeout,clearTimeout,
        character:{_id:'feature-owner',_class_features:[],_feats:features,_racial_traits:[],_proficiency:2,_speed:30,
            getClassLevel:()=>level,getAbility:()=>({mod:'+3'}),getSetting:(key,fallback)=>settings[key]??fallback,
            hasClassFeature:name=>features.includes(name),hasRacialTrait:()=>false,mergeCharacterSettings:(values,callback)=>{Object.assign(settings,structuredClone(values));callback?.();}},
        wayBeyond20GetTurnTrackerState:()=>structuredClone(state),wayBeyond20SetTurnTrackerState:value=>Object.assign(state,structuredClone(value)),
        wayBeyond20NormalizeTurnTrackerState:value=>({...value}),wayBeyond20GetTrackedSpellEffects:()=>[],
        wayBeyond20ParseInteger:value=>Number.isFinite(Number(value))?Number(value):null,
        wayBeyond20ScheduleActiveEffectBadgeRefresh(){},wayBeyond20CharacterDebug(){},wayBeyond20NormalizeAttackSemantics(){},wayBeyond20ApplyDrainingAttackIntent(){},
        wayBeyond20LiveFeatureRules:()=>[{name:'Focus-granting feat',text:'You gain 3 Focus Points. You regain them after a Short Rest.'}],
        wayBeyond20PreflightTurnResource:async()=>c.allow,
        wayBeyond20ConfirmChoice:async()=>c.override,
        $:()=>({css:()=>undefined}),alertify:{warning:message=>c.warnings.push(message),message:message=>c.warnings.push(message)},
        DAMAGE_FLAGS:{HEALING:8,VERSATILE:2,CONDITIONAL:32},RollType:{NORMAL:0},
        forms:[],warnings:[],sent:[],allow:true,override:false,fail:false,
        dndbeyondDiceRoller:{_prompter:{prompt:async()=>c.forms.shift()||null}},
        sendRoll:async(owner,type,fallback,args)=>{c.sent.push({type,...args});if(c.onSend)await c.onSend();if(c.fail)return false;args['waybeyond20-capture-result']?.({whisper:1},[{total:6}],[['base',{total:6},1]]);return true;},
        wayBeyond20TrackSelfFeatureEffect(){},wayBeyond20ApplyHealingToSelf:async()=>({applied:true}),wayBeyond20SetTemporaryHitPoints:async()=>true,
        wayBeyond20SelfHasCondition:()=>false,wayBeyond20RemoveConditionFromSelf:async()=>true
    };
    vm.createContext(c);
    vm.runInContext(fs.readFileSync(path.join(root,'src/dndbeyond/content-scripts/resources.js'),'utf8'),c);
    c.wb20NativeResources=()=>new Map([['focus points',{name:'Focus Points',kind:'native',max:native.max,remaining:native.focus}]]);
    c.wayBeyond20FindLimitedUseControls=()=>({controls:Array.from({length:native.max},(_,i)=>({unused:i<native.focus,click:()=>native.focus++}))});
    c.wayBeyond20LimitedUseControlIsUnused=control=>control.unused;
    c.wayBeyond20SpendLimitedUse=async()=>{if(native.focus>0){native.focus--;return true;}return false;};
    for(const name of ['wayBeyond20HasActiveCombatState','wayBeyond20SpendTurnResource','wayBeyond20AttacksPerAttackAction','wayBeyond20AttacksRemainingInAttackAction','wayBeyond20SpendAttackAction','wayBeyond20AttackActivationTurnKey','wayBeyond20CreateAttackActivation','wayBeyond20PerformGrantedAttack','wayBeyond20AttachTurnResource','wayBeyond20DispatchRollWithCharacter','sendRollWithCharacter'])vm.runInContext(unit(name),c);
    vm.runInContext(fs.readFileSync(path.join(root,'src/dndbeyond/content-scripts/feature-activations.js'),'utf8'),c);
    c.wayBeyond20NeedsAttackFollowup=()=>false;
    c.wb20FeatureNativeEntry=()=>({name:'Unarmed Strike',damage:'1d6+3'});
    c.wayBeyond20OpenGrantedAttack=async(entry,context)=>c.sendRollWithCharacter('attack','1d6+3',{name:'Unarmed Strike',rollAttack:true,
        'waybeyond20-attack-activation':context.activation,...(context.featureCost?c.wb20FeatureCost(context.featureCost):{}),
        'waybeyond20-turn-resource':{resource:'action',actionType:'Attack'}});
    return Object.assign(c,{settings,native,state});
}
const form=values=>({find:selector=>{const key=selector.match(/name="([^"]+)"/)?.[1];return{val:()=>values[key],prop:()=>!!values[key]};}});
module.exports={fixture,form};
(async()=>{
    let c=fixture();assert.equal(c.wb20FeatureProfile().level,0);assert.equal(c.wb20Resource('Focus Points').remaining,2,'native partial use, not a new full pool');
    assert.ok(c.wb20FeatureActions().some(([name])=>name==='Flurry of Blows'),'feat owner needs no Monk levels');
    assert.equal(c.wb20FeatureActions().some(([name])=>name==='Slow Fall'),false,'Focus does not grant unrelated features');
    c.forms.push(null);assert.equal(await c.wb20FeatureActivate('Flurry of Blows'),false);assert.equal(c.native.focus,2);assert.equal(c.state.bonusAction,1);
    c.forms.push(form({heals:0}),null);assert.equal(await c.wb20FeatureActivate('Flurry of Blows'),true);
    assert.equal(c.native.focus,1);assert.equal(c.state.bonusAction,0);assert.equal(c.state.action,1);
    assert.equal(c.state.featureGrants['flurry of blows'].remaining,1,'partial cancel preserves granted attack');
    c.forms.push(form({heals:0}));assert.equal(await c.wb20FeatureActivate('Flurry of Blows'),true);
    assert.equal(c.native.focus,1);assert.equal(c.state.bonusAction,0,'resume costs no second Bonus Action or Focus');
    assert.equal(c.state.featureGrants['flurry of blows'].remaining,0);
    c.state.featureGrants['flurry of blows'].remaining=1;c.state.localTurnNumber++;
    assert.equal(c.wayBeyond20CreateAttackActivation({resource:'bonusAction',attacks:2,source:'Flurry of Blows'}).paid,false,'old-turn grants cannot be borrowed');
    c=fixture();c.fail=true;c.forms.push(form({heals:0}));assert.equal(await c.wb20FeatureActivate('Flurry of Blows'),false);assert.equal(c.native.focus,2);assert.equal(c.state.bonusAction,1);
    c=fixture(['Hand of Healing']);c.forms.push(form({target:'Ally',condition:'None'}));assert.ok(await c.wb20FeatureActivate('Hand of Healing'));assert.equal(c.native.focus,1);assert.equal(c.state.action,0);assert.equal(c.state.bonusAction,1);
    assert.equal(c.settings['waybeyond20-monk-2024'],undefined,'no class-specific resource storage');
    c=fixture();assert.equal(await c.wb20SetResource('Focus Points',3,{expected:2}),true);assert.equal(c.native.focus,3,'Correction restores real native use');
    assert.equal(c.settings['waybeyond20-resources'].history.at(-1).reason,'Correction');assert.equal(await c.wb20SetResource('Focus Points',2,{expected:1}),false,'stale Correction is refused');
    c=fixture();c.forms.push(null);await c.wb20CorrectResources();assert.equal(c.native.focus,2);assert.equal(c.state.action,1,'Correction cancel is read-only');
    c=fixture();const cost=()=>({name:'Shared feature','waybeyond20-resource-costs':[{name:'Focus Points',amount:2}]});
    const outcomes=await Promise.all([c.sendRollWithCharacter('trait',0,cost()),c.sendRollWithCharacter('trait',0,cost())]);assert.equal(outcomes[0],true);assert.equal(outcomes[1],false);assert.equal(c.native.focus,0,'serialized activations do not overdraw');
    c=fixture();await c.sendRollWithCharacter('trait',0,{name:'Combined costs','waybeyond20-resource-costs':[{name:'Focus Points',amount:1},{name:'Focus Points',amount:1}]});assert.equal(c.native.focus,0,'same-resource costs are summed');
    c=fixture(['Borrowed feature']);await c.sendRollWithCharacter('trait',0,{name:'Borrowed feature',description:'You can expend 1 Focus Point to use this feature.'});assert.equal(c.native.focus,1,'live costs use owned resource names without class handlers');
    assert.equal(c.wb20ReadFeatureCosts('Expend 1 Focus Point or expend 2 Focus Points.').length,0,'ambiguous alternatives are not auto-charged');
    c=fixture(['Extra Attack']);const attack=()=>c.sendRollWithCharacter('attack','1d6',{name:'Attack',rollAttack:true,'waybeyond20-turn-resource':{resource:'action',actionType:'Attack'}});
    await attack();assert.equal(c.state.action,0);assert.equal(c.state.attacksRemaining,1);await attack();assert.equal(c.state.action,0);assert.equal(c.state.attacksRemaining,0,'feat-granted Extra Attack shares Action');
    c.state.hasteAction=1;await attack();assert.equal(c.state.hasteAction,0);assert.equal(c.state.attacksRemaining,0,'Haste buys only one attack');
    c=fixture(['Extra Attack','Some feature']);c.state.action=0;
    await c.sendRollWithCharacter('trait',0,{name:'Some feature','source-type':'action',description:'On your turn, you can take one additional action, except the Magic action. You can use this only once per turn.'});
    assert.equal(c.state.featureGrants['some feature:action'].remaining,1,'live rule grants a separate extra Action without a class gate');
    await c.sendRollWithCharacter('attack','1d6',{name:'Granted attack',rollAttack:true,'waybeyond20-turn-resource':{resource:'action',actionType:'Attack'}});
    assert.equal(c.state.featureGrants['some feature:action'].remaining,0);assert.equal(c.state.attacksRemaining,1,'extra Action grants the same owned Extra Attack benefit');
    assert.equal(c.wb20ReadActionGrant('You gain one additional action, which can only be used to Dash.'),null,'unknown restriction is never erased');
    c=fixture();c.state.inCombat=false;await c.sendRollWithCharacter('trait',0,{name:'Outside combat',...c.wb20FeatureCost({focus:1}),'waybeyond20-turn-resource':{resource:'bonusAction'}});assert.equal(c.native.focus,1);assert.equal(c.state.bonusAction,1,'feature costs still apply outside combat, turn currency does not');
    c=fixture();c.onSend=()=>{c.state.localTurnNumber++;};await c.sendRollWithCharacter('trait',0,{name:'Stale turn',...c.wb20FeatureCost({focus:1})});assert.equal(c.native.focus,2);assert.ok(c.warnings.length);
    c=fixture();c.wb20RegisterResource({name:'Test Dice',max:4,reset:'long'});assert.equal(c.wb20Resource('Test Dice').remaining,null,'unknown count is not silently filled');
    await c.wb20SetResource('Test Dice',2);await c.wb20ResourcesRest(c.character,'short');assert.equal(c.wb20Resource('Test Dice').remaining,2);await c.wb20ResourcesRest(c.character,'long');assert.equal(c.wb20Resource('Test Dice').remaining,4);assert.equal(c.native.focus,2,'native rest is not double-applied');
    c=fixture(['Hand of Harm']);assert.equal(c.wb20FeatureNeedsHit({name:'Unarmed Strike'}),true,'Harm does not require Mercy class or Healing');assert.equal(c.wb20FeatureNeedsHit({name:'Longsword'}),false);
    assert.equal(c.wb20FeatureEvasion(11,false,false),5);assert.equal(c.wb20FeatureEvasion(11,true,false),0);assert.equal(c.wb20FeatureDeflection(c.wb20FeatureProfile(),20,10,['Fire']),null);
    c=fixture(['Deflect Energy']);assert.equal(c.wb20FeatureDeflection(c.wb20FeatureProfile(),20,30,['Fire']).remaining,0,'owned feature, not class level');
    const privacy={CharacterBase:class{type(){return 'test';}}};vm.createContext(privacy);
    vm.runInContext(fs.readFileSync(path.join(root,'src/dndbeyond/base/character.js'),'utf8')+'\nthis.TestCharacter=Character;',privacy);
    const character=Object.create(privacy.TestCharacter.prototype);character._settings={'waybeyond20-resources':{history:[{reason:'private correction'}]},'waybeyond20-monk-2024':{focus:1},keep:true};
    assert.equal(character.getDict().settings['waybeyond20-resources'],undefined,'local resource history must not enter roll messages');assert.equal(character.getDict().settings.keep,true);
    console.log('PASS shared resources: non-Monk feature ownership, native partial pools, real Correction restore, stale/cancel guards, serialized/summed costs, partial grant resume, healing replacement, failure, Extra Attack, Haste, outside combat, rest and feature math. Isolated boundary only.');
})().catch(error=>{console.error(error);process.exitCode=1;});
