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
const producer = read('src/roll20/page-script.js');
const receiver = read('src/dndbeyond/content-scripts/character.js');
let raw = '';
let loading = true;
let readyState = 'complete';
let page = {id:'map'};
let state = {inCombat:true,combatSource:'Roll20',combatStartedAt:1,localTurnNumber:2,
    action:0,bonusAction:0,reaction:0,movement:10,attacksRemaining:1,hasteAttacksRemaining:1,
    combatActionEffects:{Dodge:{name:'Dodge'},Disengage:{name:'Disengage'}},
    lastRoll20TurnKey:'old',currentRoll20Turn:{tokenId:'mob',isThisCharactersTurn:false},
    selectedTargetKey:'mob',targetRecords:{mob:{damage:[{amount:8}]}}};
const messages = [];
const c = vm.createContext({console,Campaign:{get:()=>raw,activePage:()=>page},
    document:{get readyState(){return readyState;},getElementById:()=>({getClientRects:()=>loading?[{}]:[]})},
    character:{_name:'Calan',getSetting:(k,f)=>k==='waybeyond20-roll20-token-id'?'self':k==='waybeyond20-roll20-token-ids'?['self']:f},
    wayBeyond20GetTrackedSpellEffects:()=>[],wayBeyond20GetTurnTrackerState:()=>state,
    wayBeyond20SetTurnTrackerState:s=>{state=s;},wayBeyond20ScheduleActiveEffectBadgeRefresh:()=>{},
    wayBeyond20CharacterDebug:()=>{},wayBeyond20NormalizeNameForTokenMatch:s=>String(s||'').toLowerCase(),
    wayBeyond20ParseInteger:v=>Number.isFinite(Number(v))?Math.trunc(Number(v)):null,
    wayBeyond20BuildTurnResourceDefaults:()=>({action:1,bonusAction:1,reaction:1,movement:30,
        maxAction:1,maxBonusAction:1,maxReaction:1,maxMovement:30,maxHasteAction:0,hasteAction:0}),
    wayBeyond20GetGraphicName:id=>id==='self'?'Calan':'Zombie',
    wayBeyond20ReadTurnOrderTargets:order=>order.map(e=>({key:e.id,tokenId:e.id})),
    sendCustomEvent:(_name,args)=>{messages.push(args[0]);c.wayBeyond20ResetTurnResourcesFromRoll20(args[0].current);}});
for(const name of ['wayBeyond20NormalizeTurnTrackerState','wayBeyond20HasActiveCombatState','wayBeyond20ResetTurnResourcesFromRoll20'])
    vm.runInContext(fn(receiver,name),c);
for(const name of ['wayBeyond20ReadCurrentTurn','wayBeyond20PollCurrentTurn']) vm.runInContext(fn(producer,name),c);
vm.runInContext('let wayBeyond20LastTurnOrderKey=""; let wayBeyond20LastObservedRoll20TokenId=""; let wayBeyond20LastObservedRoll20WasCharacter=false;',c);
const counters = () => [state.action,state.bonusAction,state.reaction,state.movement,state.attacksRemaining,state.localTurnNumber];
const poll = () => c.wayBeyond20PollCurrentTurn();
const order = ids => {raw=JSON.stringify(ids.map(id=>({id,pr:10,_pageid:'map'})));poll();};
poll();
assert.equal(messages.length,0,'loading empty order must not announce ended combat');
assert.deepEqual(counters(),[0,0,0,10,1,2]);
loading=false;raw=undefined;poll();assert.equal(messages.length,0,'missing campaign data is not empty combat');
raw='[]';page=null;poll();assert.equal(messages.length,0,'missing page means not ready');
page={id:'map'};readyState='loading';poll();assert.equal(messages.length,0,'document loading means not ready');
readyState='complete';order(['mob','self','other']);
assert.deepEqual(counters(),[0,0,0,10,1,2],'same current combatant after reload preserves spent resources');
poll();assert.equal(messages.length,1,'identical polls are silent');
order(['self','other','mob']);assert.deepEqual(counters(),[1,1,1,30,0,3],'own turn resets once');
assert.equal(state.hasteAttacksRemaining,0,'new own turn clears queued Haste attacks');
assert.equal(Object.keys(state.combatActionEffects).length,0,'next own start expires Dodge and Help');
state={...state,action:0,bonusAction:0,reaction:0,movement:5,attacksRemaining:1};
// A new page-script session and a new DDB receiver must both preserve a spent own turn.
vm.runInContext('wayBeyond20LastTurnOrderKey="";wayBeyond20LastObservedRoll20TokenId="";wayBeyond20LastObservedRoll20WasCharacter=false;',c);
loading=true;raw='';poll();loading=false;order(['self','other','mob']);
assert.deepEqual(counters(),[0,0,0,5,1,3]);
order(['other','mob','self']);assert.deepEqual(counters(),[0,0,0,5,1,3]);
order(['mob','self','other']);assert.deepEqual(counters(),[0,0,0,5,1,3]);
order(['self','other','mob']);assert.deepEqual(counters(),[1,1,1,30,0,4]);
assert.equal(state.selectedTargetKey,'mob');assert.equal(state.targetRecords.mob.damage[0].amount,8);
// A genuinely loaded empty order still ends combat; this is not a blanket suppression.
raw='[]';poll();assert.equal(state.inCombat,false);assert.equal(state.localTurnNumber,0);
const count=messages.length;poll();assert.equal(messages.length,count);
order(['mob','self','other']);assert.equal(state.inCombat,true);assert.equal(state.localTurnNumber,0);
order(['self','other','mob']);assert.equal(state.localTurnNumber,1);
console.log('PASS real Roll20 producer/character receiver: startup, refresh, spent counters, own-turn reset, duplicate polls, target preservation, genuine end/restart.');
