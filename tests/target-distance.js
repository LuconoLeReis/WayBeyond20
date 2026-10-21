const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const read = p => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
function fn(source, name) {
    const start = source.search(new RegExp('^function ' + name + '\\(', 'm'));
    assert.ok(start >= 0, name);
    const end = source.slice(start + 1).search(/^(?:function |const |let |var |class )/m);
    return source.slice(start, end < 0 ? undefined : start + 1 + end);
}
const roll20 = read('src/roll20/page-script.js');
const char = read('src/dndbeyond/content-scripts/character.js');
const target = read('src/dndbeyond/content-scripts/my-target.js');
const graphics = [{id:'self',attributes:{name:'Calan',layer:'objects',left:0,top:0}},
    {id:'mob',attributes:{name:'Zombie',layer:'objects',left:210,top:280,bar1_value:99}},
    {id:'hidden',attributes:{name:'Secret',layer:'gmlayer',left:70,top:70}}];
const page = {id:'map',attributes:{scale_number:5,scale_units:'ft'},thegraphics:{models:graphics}};
let order = [{id:'self',pr:0,_pageid:'map'},{id:'mob',pr:18,_pageid:'map'}];
const messages=[];
const c = vm.createContext({console,Campaign:{activePage:()=>page,get:()=>JSON.stringify(order)},
    document:{readyState:'complete',getElementById:()=>null},
    sendCustomEvent:(_name,args)=>messages.push(JSON.parse(JSON.stringify(args[0])))});
for(const name of ['wayBeyond20GetGraphicName','wayBeyond20ReadTokenPosition','wayBeyond20ReadTurnOrderTargets',
    'wayBeyond20ReadCurrentTurn','wayBeyond20PollCurrentTurn']) vm.runInContext(fn(roll20,name),c);
vm.runInContext('let wayBeyond20LastTurnOrderKey="";',c);
assert.equal(c.wayBeyond20ReadTokenPosition('hidden'),null);
const hiddenDiagnostic={};
c.wayBeyond20ReadTokenPosition('hidden',hiddenDiagnostic);
assert.match(hiddenDiagnostic.reason,/Tokens layer/);
assert.equal(c.wayBeyond20ReadTokenPosition('missing'),null);
assert.deepEqual(Object.keys(c.wayBeyond20ReadTokenPosition('mob')).sort(),['pageId','scale','units','x','y']);
c.wayBeyond20PollCurrentTurn(); c.wayBeyond20PollCurrentTurn();
assert.equal(messages.length,1,'unchanged polls are silent');
graphics[1].attributes.left=280;
c.wayBeyond20PollCurrentTurn();
assert.equal(messages.length,2,'movement sends a position refresh');
assert.equal(messages[0].current.turnKey,messages[1].current.turnKey,'movement does not become a new turn');
graphics[1].attributes.layer='gmlayer';c.wayBeyond20PollCurrentTurn();
assert.equal(messages[2].current.targets[1].position,null,'hidden geometry is cleared');
graphics[1].attributes.layer='objects';graphics[1].attributes.left=null;
assert.equal(c.wayBeyond20ReadTokenPosition('mob'),null,'missing is not zero');
graphics[1].attributes.left=210;
graphics[1].attributes._pageid='different';
assert.equal(c.wayBeyond20ReadTokenPosition('mob'),null);
delete graphics[1].attributes._pageid;
page.attributes.scale_number=0;assert.equal(c.wayBeyond20ReadTokenPosition('mob'),null);page.attributes.scale_number=5;
const scaleDiagnostic={};
page.attributes.scale_number=undefined;c.wayBeyond20ReadTokenPosition('mob',scaleDiagnostic);
assert.match(scaleDiagnostic.reason,/scale/);page.attributes.scale_number=5;
vm.runInContext(fn(target,'wb20TargetDistance'),c);
c.character={_name:'Calan',getSetting:(_key,fallback)=>fallback};
const state={knownTargets:JSON.parse(JSON.stringify(c.wayBeyond20ReadTurnOrderTargets(order)))};
assert.equal(c.wb20TargetDistance(state,state.knownTargets[1]),'25 ft');
state.knownTargets[1].position.pageId='other';assert.equal(c.wb20TargetDistance(state,state.knownTargets[1]),null);
state.knownTargets[1].position.pageId='map';
state.knownTargets.push({...state.knownTargets[0],tokenId:'duplicate'});
assert.equal(c.wb20TargetDistance(state,state.knownTargets[1]),null,'duplicate character names are ambiguous');
c.character.getSetting=(key,fallback)=>key==='waybeyond20-roll20-token-id'?'self':fallback;
assert.equal(c.wb20TargetDistance(state,state.knownTargets[1]),'25 ft','explicit binding resolves duplicate names');
c.character.getSetting=(key,fallback)=>key==='waybeyond20-roll20-token-id'?'missing':fallback;
assert.equal(c.wb20TargetDistance(state,state.knownTargets[1]),null,'missing explicit binding does not guess');
const bindingDiagnostic={};
c.wb20TargetDistance(state,state.knownTargets[1],bindingDiagnostic);
assert.match(bindingDiagnostic.reason,/linked token is not in this turn order/);
// Run the real character receiver twice with the same turn and new coordinates.
c.state={inCombat:true,combatSource:'Roll20',combatStartedAt:1,localTurnNumber:4,action:0,bonusAction:0,reaction:0,
    currentRoll20Turn:{tokenId:'self',isThisCharactersTurn:true},lastRoll20TurnKey:messages[0].current.turnKey};
c.character={_name:'Calan',getSetting:(key,fallback)=>key==='waybeyond20-roll20-token-id'?'self':key==='waybeyond20-roll20-token-ids'?['self']:fallback};
c.wayBeyond20GetTrackedSpellEffects=()=>[];
c.wayBeyond20GetTurnTrackerState=()=>c.state;
c.wayBeyond20NormalizeTurnTrackerState=(s,_effects,options)=>{assert.notEqual(options?.reset,true,'movement cannot reset resources');return {...s};};
c.wayBeyond20SetTurnTrackerState=s=>c.state=s;
c.wayBeyond20ScheduleActiveEffectBadgeRefresh=()=>{};
c.wayBeyond20CharacterDebug=()=>{};
c.wayBeyond20NormalizeNameForTokenMatch=s=>String(s||'').toLowerCase();
vm.runInContext('let wayBeyond20LastObservedRoll20TokenId=""; let wayBeyond20LastObservedRoll20WasCharacter=false;',c);
vm.runInContext(fn(char,'wayBeyond20HasActiveCombatState'),c);
vm.runInContext(fn(char,'wayBeyond20ResetTurnResourcesFromRoll20'),c);
c.wayBeyond20ResetTurnResourcesFromRoll20(messages[0].current);
c.wayBeyond20ResetTurnResourcesFromRoll20(messages[1].current);
assert.deepEqual([c.state.action,c.state.bonusAction,c.state.reaction,c.state.localTurnNumber],[0,0,0,4]);
assert.equal(c.state.knownTargets[1].position.x,280);
c.state.inCombat=false;c.state.suppressedRoll20TurnKey=messages[0].current.turnKey;
c.wayBeyond20ResetTurnResourcesFromRoll20(messages[1].current);
assert.equal(c.state.inCombat,false,'movement cannot reopen manually ended combat');
console.log('PASS target geometry: scoped fields/layer/page, distance and identity, movement-only updates, unchanged turn key/resources and ended-combat suppression.');
