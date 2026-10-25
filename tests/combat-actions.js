const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const {fixture,form} = require('./shared-resources');
function setup() {
    const c = fixture(['Extra Attack']);
    vm.runInContext(fs.readFileSync(path.join(__dirname,'../src/dndbeyond/content-scripts/combat-actions.js'),'utf8'),c);
    c.wayBeyond20GetCurrentDisplayedSpeed=()=>30;
    c.attack=()=>c.sendRollWithCharacter('attack','1d6',{name:'Weapon',rollAttack:true,
        'waybeyond20-turn-resource':{resource:'action',actionType:'Attack'}});
    c.check=async(resource)=>c.state[resource]>0 || c.override;
    c.wayBeyond20PreflightTurnResource=resource=>c.check(resource);
    return c;
}
(async()=>{
    let c=setup();
    assert.equal(c.wb20QueuedAttackCount(c.state),0);
    await c.attack(); assert.equal(c.state.action,0);assert.equal(c.wb20QueuedAttackCount(c.state),1);
    await c.attack(); assert.equal(c.wb20QueuedAttackCount(c.state),0);
    assert.equal(await c.attack(),false);assert.equal(c.sent.length,2,'cancel sends no attack');
    c.override=true;assert.equal(await c.attack(),true);assert.equal(c.state.attacksRemaining,0);assert.equal(c.state.action,0);
    c=setup();await c.wb20TakeCombatAction('Attack');assert.equal(c.state.action,0);assert.equal(c.state.attacksRemaining,2);assert.equal(c.sent.length,1);
    assert.match(c.sent[0].description,/queuing 2 attacks/);assert.equal(c.sent[0].type,'trait','explicit Attack sends one descriptive card, not an attack roll');
    await c.attack();assert.equal(c.state.attacksRemaining,1);
    const turn=c.wayBeyond20AttackActivationTurnKey();
    c.state.featureGrants={surge:{name:'Extra Action',unit:'action',remaining:1,max:1,turnKey:turn,excludes:['Magic']}};
    assert.equal(c.wb20QueuedAttackCount(c.state),1,'unconverted extra Action is not an attack');
    await c.wb20TakeCombatAction('Attack');assert.equal(c.state.attacksRemaining,3);assert.equal(c.state.featureGrants.surge.remaining,0);
    assert.equal(c.wb20QueuedAttackCount(c.state),3,'queue can exceed standard denominator');
    assert.equal(await c.wb20SetResource('attacksRemaining',5),true,'Correction can repair additive queues');
    c=setup();c.state.action=0;c.state.hasteAction=1;
    await c.wb20TakeCombatAction('Attack','hasteAction');assert.equal(c.state.hasteAction,0);assert.equal(c.state.hasteAttacksRemaining,1);assert.equal(c.state.attacksRemaining,0);
    assert.match(c.sent[0].description,/queuing 1 attack\./,'message uses the actual Haste allowance');
    assert.equal(await c.sendRollWithCharacter('trait',0,{name:'Attack replacement',
        'waybeyond20-turn-resource':{resource:'action',actionType:'Attack'}}),false,'Haste queue cannot pay an attack replacement');
    assert.equal(c.state.hasteAttacksRemaining,1);await c.attack();assert.equal(c.state.hasteAttacksRemaining,0);
    assert.equal(await c.attack(),false);
    c=setup();c.fail=true;assert.equal(await c.wb20TakeCombatAction('Attack'),false);assert.equal(c.state.action,1);assert.equal(c.state.attacksRemaining,0,'failed Attack announcement does not spend or queue');
    c=setup();c.state.action=0;c.state.hasteAction=1;c.forms.push(form({}));await c.wb20TakeCombatAction('Dash','hasteAction');
    assert.equal(c.state.hasteAction,0);assert.equal(c.state.movement,30);assert.equal(c.wb20QueuedAttackCount(c.state),0);
    assert.equal(await c.wb20TakeCombatAction('Dodge','hasteAction'),false,'Haste does not pay Dodge');
    for (const name of ['Dash','Disengage','Dodge','Help','Hide','Influence','Search','Study','Utilize']) {
        c=setup();assert.equal(await c.wb20TakeCombatAction(name),false);assert.equal(c.state.action,1,`${name} cancel preserves Action`);assert.equal(c.sent.length,0);
    }
    c=setup();c.forms.push(form({details:'Ally by the gate'}));await c.wb20TakeCombatAction('Help');assert.equal(c.state.action,0);assert.ok(c.sent[0].description.includes('Ally by the gate'));
    c=setup();c.forms.push(form({}));c.fail=true;assert.equal(await c.wb20TakeCombatAction('Dodge'),false);assert.equal(c.state.action,1);assert.equal(c.state.combatActionEffects,undefined);
    c=setup();c.forms.push(form({}));await c.wb20TakeCombatAction('Dodge');assert.ok(c.state.combatActionEffects.Dodge);assert.equal(c.state.action,0);
    assert.equal(c.wb20ActiveCombatActionEffects(c.state).length,1);c.character._conditions=['Incapacitated'];assert.equal(c.wb20ActiveCombatActionEffects(c.state).length,0);
    c=setup();c.forms.push(form({}));await c.wb20TakeCombatAction('Disengage');c.state.currentRoll20Turn={isThisCharactersTurn:false};assert.equal(c.wb20ActiveCombatActionEffects(c.state).length,0);
    c=setup();let clicked=0;c.wayBeyond20CharacterSheetTab=()=>({click:()=>clicked++});
    assert.equal(await c.wb20TakeCombatAction('Magic'),true);assert.equal(clicked,1);assert.equal(c.state.action,1,'opening Magic is not an activation');
    c=setup();c.state.action=0;c.state.featureGrants={surge:{unit:'action',remaining:1,max:1,turnKey:c.wayBeyond20AttackActivationTurnKey(),excludes:['Magic']}};
    assert.equal(await c.sendRollWithCharacter('spell',0,{name:'Magic','waybeyond20-turn-resource':{resource:'action',actionType:'Magic'}}),false);assert.equal(c.state.featureGrants.surge.remaining,1);
    c=setup();c.state.featureGrants={flurry:{unit:'attack',remaining:2,turnKey:c.wayBeyond20AttackActivationTurnKey()},future:{unit:'action',remaining:1,turnKey:c.wayBeyond20AttackActivationTurnKey()}};
    assert.equal(c.wb20QueuedAttackCount(c.state),2,'feature attacks count, unconverted feature Actions do not');
    c=setup();c.state.currentRoll20Turn={isThisCharactersTurn:false};c.override=true;
    await c.wb20TakeCombatAction('Attack');assert.equal(c.state.action,1);assert.equal(c.state.attacksRemaining,0);
    c=setup();c.onSend=()=>c.state.localTurnNumber++;c.forms.push(form({}));await c.wb20TakeCombatAction('Dash');assert.equal(c.state.action,1);assert.equal(c.state.movement,undefined,'stale turn does not receive Dash movement');
    console.log('PASS combat actions: automatic purchase, additive explicit queue, polite override/cancel, extra Action restrictions, Haste single attack and replacement isolation, action cancellation/failure, effects, Magic deferred cost, source counts and stale-turn guards.');
})().catch(error=>{console.error(error);process.exitCode=1;});
