// Retained command name; test feature consumers, not class permission.
const assert=require('node:assert/strict');
const {fixture,form}=require('./shared-resources');
(async()=>{
    let c=fixture(['Hand of Harm','Physician’s Touch','Stunning Strike'],0);
    c.forms.push(form({poison:true}),form({}));
    await c.wb20FeatureAfterDamage({name:'Unarmed Strike',rollCritical:true},{request:{whisper:1},damages:[['base',{total:6},1]]});
    assert.equal(c.sent.length,2);assert.equal(c.native.focus,0);assert.equal(c.state.action,1);assert.equal(c.state.reaction,1);
    assert.equal(c.sent[0].rollCritical,true);assert.equal(c.sent[0]['critical-damages'][0],'1d6');assert.equal(c.sent[0].whisper,1);assert.equal(c.sent[1]['save-dc'],13);assert.ok(c.sent[0].description.includes('Poisoned'));
    assert.equal(c.wb20Resource('turn-use:Hand of Harm').remaining,0);await c.wb20SetResource('turn-use:Hand of Harm',1);assert.equal(c.wb20ResourceStore().turns['Hand of Harm'],undefined,'Correction restores once-per-turn availability');
    c=fixture(['Hand of Harm']);await c.wb20FeatureAfterDamage({name:'Unarmed Strike'},{request:{},damages:[['base',{total:0},1]]});assert.equal(c.sent.length,0);
    c=fixture(['Empowered Strikes']);c.forms.push(form({type:'force'}));const attack={name:'Unarmed Strike',rollAttack:true,'damage-types':['Bludgeoning']};assert.equal(await c.wb20FeaturePrepareAttack(attack),true);assert.equal(attack['damage-types'][0],'Force');
    c=fixture(['Disciplined Survivor']);const save={modifier:'+5',name:'Wisdom'};c.wb20FeatureRememberSave('saving-throw',save);save['waybeyond20-capture-result']({whisper:1},[{total:4}],[]);c.forms.push(form({}));assert.equal(await c.wb20FeatureRerollSave(),true);assert.equal(c.native.focus,1);assert.equal(await c.wb20FeatureRerollSave(),false);
    const death={modifier:'+2'};c.wb20FeatureRememberSave('death-save',death);death['waybeyond20-capture-result']({whisper:1},[{total:3}],[]);c.forms.push(form({}));assert.equal(await c.wb20FeatureRerollSave(),true);assert.equal(c.sent.at(-1).type,'death-save');
    c=fixture(['Heightened Focus','Flurry of Blows','Hand of Healing','Flurry of Healing and Harm']);c.wb20FeatureProfile();await c.wb20SetResource('Flurry of Healing and Harm',3);
    c.forms.push(form({heals:2,mercy:true}),form({target:'First ally',condition:'None'}),form({}),form({target:'Second ally',condition:'None'}),form({}));
    assert.equal(await c.wb20FeatureActivate('Flurry of Blows'),true);assert.equal(c.sent.length,3);assert.equal(c.native.focus,1);assert.equal(c.state.bonusAction,0);assert.equal(c.wb20Resource('Flurry of Healing and Harm').remaining,2);
    c=fixture(['Perfect Focus']);c.native.max=6;c.native.focus=1;await c.wb20FeatureInitiative();assert.equal(c.native.focus,4);
    c=fixture(['Uncanny Metabolism'],3);c.wb20FeatureProfile();await c.wb20SetResource('Uncanny Metabolism',1);c.forms.push(form({}));await c.wb20FeatureInitiative();assert.equal(c.native.focus,3);assert.equal(c.wb20Resource('Uncanny Metabolism').remaining,0);
    for(const features of [['Slow Fall'],['Superior Defense'],['Hand of Ultimate Mercy'],['Evasion']]){c=fixture(features,0);assert.ok(c.wb20FeatureActions().some(([name])=>name===features[0]));}
    c=fixture(['Focus-granting feat']);assert.equal(c.wb20FeatureActions().length,0);
    console.log('PASS feature consumers: independent ownership, Harm/critical/privacy, Stunning, Empowered Strikes, save/death-save rerolls, enhanced healing Flurry, initiative recovery, high-level features without class gates.');
})().catch(error=>{console.error(error);process.exitCode=1;});
