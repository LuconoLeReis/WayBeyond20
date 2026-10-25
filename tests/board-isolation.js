// Real DDB state, binding and receiver functions; no browser/game writes.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../src/dndbeyond/content-scripts/character.js'),'utf8');
function fn(name) {
    const start=source.search(new RegExp('^function '+name+'\\(','m'));
    assert(start>=0,name);
    const rest=source.slice(start+1),end=rest.search(/^(?:async function |function |const |let |var |class )/m);
    return source.slice(start,end<0?undefined:start+1+end);
}
const saved={'waybeyond20-roll20-token-id':'roll-token','waybeyond20-roll20-token-ids':['roll-token'],
    'waybeyond20-turn-state':{inCombat:true,combatSource:'Roll20',combatStartedAt:1,action:0,bonusAction:0,reaction:0,movement:5,localTurnNumber:3,
        currentRoll20Turn:{tokenId:'roll-token',isThisCharactersTurn:true},lastRoll20TurnKey:'roll-3',targetRecords:{mob:{note:'keep'}}}};
const c=vm.createContext({console,settings:{'vtt-tab':{vtt:'fvtt'}},character:{_id:'char',_name:'Hero',
    getSetting:(key,fallback)=>saved[key]??fallback,mergeCharacterSettings:(values,callback)=>{Object.assign(saved,values);callback?.();}},
    wayBeyond20GetTrackedSpellEffects:()=>[],wayBeyond20ScheduleActiveEffectBadgeRefresh:()=>{},wayBeyond20CharacterDebug:()=>{},
    wayBeyond20ParseInteger:value=>Number.isFinite(Number(value))?Math.trunc(Number(value)):null,
    wayBeyond20BuildTurnResourceDefaults:()=>({action:1,bonusAction:1,reaction:1,movement:30,maxAction:1,maxBonusAction:1,maxReaction:1,maxMovement:30,maxHasteAction:0,hasteAction:0})});
for(const name of ['wayBeyond20GetTurnTrackerState','wayBeyond20TurnTrackerStateEquals','wayBeyond20SetTurnTrackerState',
    'wayBeyond20NormalizeTurnTrackerState','wayBeyond20HasActiveCombatState','wayBeyond20NormalizeNameForTokenMatch',
    'wayBeyond20CharacterMatchesMessageCharacter','wayBeyond20BindRoll20Token','wayBeyond20ResetTurnResourcesFromRoll20']) vm.runInContext(fn(name),c);
vm.runInContext('let wayBeyond20LastObservedRoll20TokenId="";let wayBeyond20LastObservedRoll20WasCharacter=false;',c);
const rollBefore=JSON.stringify(saved);
c.wayBeyond20BindRoll20Token({source:'Roll20',character:{id:'char'},tokenId:'wrong'});
c.wayBeyond20ResetTurnResourcesFromRoll20({active:false},'Roll20');
assert.equal(JSON.stringify(saved),rollBefore,'nonselected VTT cannot bind/end selected tracker');
c.wayBeyond20BindRoll20Token({source:'Foundry',character:{id:'other'},tokenId:'wrong'});
assert.equal(JSON.stringify(saved),rollBefore,'other character cannot bind');
c.wayBeyond20BindRoll20Token({source:'Foundry',character:{id:'char'},tokenId:'foundry-token'});
assert.equal(saved['waybeyond20-foundry-token-id'],'foundry-token');
assert.equal(saved['waybeyond20-roll20-token-id'],'roll-token');
const turn={active:true,tokenId:'foundry-token',tokenName:'Different token label',turnKey:'world|1|1|hero',targets:[]};
c.wayBeyond20ResetTurnResourcesFromRoll20(turn,'Foundry');
assert.equal(c.wayBeyond20GetTurnTrackerState().combatSource,'Foundry');
assert.equal(c.wayBeyond20GetTurnTrackerState().currentRoll20Turn.isThisCharactersTurn,true,'explicit Foundry ID identifies own turn');
assert.equal(c.wayBeyond20GetTurnTrackerState().localTurnNumber,1);
c.wayBeyond20SetTurnTrackerState({...c.wayBeyond20GetTurnTrackerState(),action:0,bonusAction:0,reaction:0});
c.wayBeyond20ResetTurnResourcesFromRoll20(turn,'Foundry');
assert.equal(c.wayBeyond20GetTurnTrackerState().action,0,'duplicate turn never refills');
c.settings['vtt-tab'].vtt='roll20';
assert.equal(c.wayBeyond20GetTurnTrackerState().action,0);
assert.equal(c.wayBeyond20GetTurnTrackerState().localTurnNumber,3,'original Roll20 state preserved');
assert.equal(c.wayBeyond20GetTurnTrackerState().targetRecords.mob.note,'keep');
c.wayBeyond20ResetTurnResourcesFromRoll20({active:false},'Foundry');
assert.equal(c.wayBeyond20GetTurnTrackerState().inCombat,true,'inactive foreign source cannot end combat');
c.settings['vtt-tab'].vtt='fvtt';
assert.equal(c.wayBeyond20GetTurnTrackerState().action,0,'switching back restores spent Foundry state');
assert.equal(c.wayBeyond20GetTurnTrackerState().localTurnNumber,1);
delete c.settings['vtt-tab'];
const current=saved['waybeyond20-turn-state'];
c.wayBeyond20ResetTurnResourcesFromRoll20({active:false},'Foundry');
assert.equal(saved['waybeyond20-turn-state'],current,'automatic routing cannot overwrite an active different source');
console.log('PASS real DDB board isolation: source routing, separate bindings/state, own-turn match, duplicate safety and switch-back preservation.');
