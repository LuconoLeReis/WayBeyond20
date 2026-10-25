// Native-shaped controls + actual shared resource code; no live account.
const {chromium}=require(process.env.WB20_PLAYWRIGHT||'playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),source=fs.readFileSync(path.join(root,'src/dndbeyond/content-scripts/character.js'),'utf8');
function unit(name){const start=new RegExp(`^(?:async )?function ${name}\\(`,'m').exec(source);assert.ok(start,name);const tail=source.slice(start.index+start[0].length),end=/^(?:async )?function |^(?:const|let|var|class) /m.exec(tail);return source.slice(start.index,end?start.index+start[0].length+end.index:undefined);}
const pool=(name,total,used)=>`<div class="ct-feature-snippet"><h3 class="ct-feature-snippet__heading">${name}</h3>${Array.from({length:total},(_,i)=>`<button type="button" role="checkbox" aria-label="use" aria-checked="${i<used}">use</button>`).join('')}</div>`;
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1200,height:850}}),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.setContent(`<body><div class="ct-saving-throws-box" style="color:rgb(20,30,40);background:rgb(250,245,230);border:1px solid rgb(130,40,50)"></div><div id="toolbar"><div class="wb20-action-list-controls"></div></div><div id="list"></div>${pool('Focus Points',3,1)}${pool('Bardic Inspiration',4,1)}<div class="ct-feature-snippet"><h3 class="ct-feature-snippet__heading">Healing Pool</h3><div class="ct-slot-manager-large"><span class="ct-slot-manager-large__value--cur">12</span><span class="ct-slot-manager-large__value--max">15</span><button class="button-action-decrease">−</button><button class="button-action-increase">+</button></div></div><div id="native-attacks">${['Action','Bonus Action'].map(cost=>`<div class="ct-combat-attack"><button aria-label="Unarmed Strike: ${cost}. Roll attack and damage"></button><span class="ct-combat-attack__label">Unarmed Strike</span><span class="ct-combat-attack__tohit">+6</span><span class="ct-combat-attack__damage">1d6+4</span></div>`).join('')}</div></body>`);
  for(const file of ['libs/jquery-3.4.1.min.js','libs/alertify.min.js','src/common/utils.js','src/dndbeyond/content-scripts/portent.js','src/dndbeyond/content-scripts/resources.js','src/dndbeyond/content-scripts/feature-activations.js'])await page.addScriptTag({path:path.join(root,file)});
  for(const file of ['libs/css/alertify.css','src/extension/beyond20.css'])await page.addStyleTag({path:path.join(root,file)});
  const names=['wayBeyond20ElementOwnText','wayBeyond20NormalizeFeatureLabel','wayBeyond20LimitedUseInputForControl','wayBeyond20LimitedUseControlIsVisible','wayBeyond20LimitedUseCanonicalControl','wayBeyond20LimitedUseControlIsUnused','wayBeyond20LimitedUseSelectors','wayBeyond20LimitedUseLabelsWithin','wayBeyond20LimitedUseLabelText','wayBeyond20LimitedUseControlOwnerLabel','wayBeyond20LimitedUseControlMatchesFeature','wayBeyond20FindLimitedUseControls','wayBeyond20WaitForLimitedUseSpend','wayBeyond20SpendLimitedUse'];
  await page.addScriptTag({content:names.map(unit).join('\n')});
  await page.evaluate(()=>{
   window.values={};window.state={inCombat:true,combatSource:'Manual',combatStartedAt:1,localTurnNumber:1,action:1,bonusAction:1,reaction:1,attacksRemaining:0};
   window.character={_id:'feat-owner',_class_features:[],_feats:['Hand of Healing'],_racial_traits:[],getClassLevel:()=>0,getAbility:()=>({mod:'+3'}),_proficiency:2,getSetting:(key,fallback)=>values[key]??fallback,mergeCharacterSettings:(data,callback)=>{Object.assign(values,structuredClone(data));callback?.();}};
   window.wayBeyond20GetTurnTrackerState=()=>structuredClone(state);window.wayBeyond20SetTurnTrackerState=value=>Object.assign(state,value);
   window.wayBeyond20AttacksPerAttackAction=()=>2;
   window.wayBeyond20AttackActivationTurnKey=()=>JSON.stringify([state.localTurnNumber]);window.wayBeyond20HasActiveCombatState=()=>state.inCombat;
   window.wayBeyond20CharacterDebug=()=>{};window.wayBeyond20ParseInteger=value=>Number.isFinite(Number(value))?Number(value):null;
   window.wayBeyond20DescribeElement=()=>({});window.wayBeyond20RequestPageLimitedUseSpend=async()=>({spent:false});window.wayBeyond20LiveFeatureRules=()=>[];
   window.wayBeyond20ScheduleActiveEffectBadgeRefresh=()=>{wb20FeatureRows(document.querySelector('#list'));wb20FeatureToolbar(document.querySelector('#toolbar'));};
   window.dndbeyondDiceRoller={_prompter:{prompt:wayBeyond20Prompt}};initializeAlertify();
   document.querySelectorAll('[role="checkbox"]').forEach(control=>control.onclick=()=>control.setAttribute('aria-checked',String(control.getAttribute('aria-checked')!=='true')));
   const widget=document.querySelector('.ct-slot-manager-large');let saved=12;
   widget.querySelectorAll('button').forEach(button=>button.onclick=()=>{const delta=button.classList.contains('button-action-increase')?1:-1;const current=widget.querySelector('[class*="value--cur"]');current.textContent=String(Number(current.textContent)+delta);let diff=widget.querySelector('.ct-slot-manager-large__diff');if(!diff){diff=document.createElement('div');diff.className='ct-slot-manager-large__diff';diff.innerHTML='<span class="ct-slot-manager-large__diff-explain"></span><button>Confirm</button>';widget.append(diff);diff.querySelector('button').onclick=()=>{saved=Number(current.textContent);diff.remove();};}diff.querySelector('span').textContent=String(Number(current.textContent)-saved);});
   wayBeyond20ScheduleActiveEffectBadgeRefresh();
  });
  assert.equal(await page.locator('.wb20-feature-row').count(),1);
  assert.equal(await page.evaluate(()=>wb20FeatureNativeEntry().row.querySelector('button').getAttribute('aria-label')),'Unarmed Strike: Action. Roll attack and damage');
  assert.equal(await page.evaluate(()=>wb20Resource('Focus Points').remaining),2);
  await page.evaluate(()=>{window.correcting=wb20CorrectResources();});
  await page.getByLabel('Focus Points remaining').waitFor();
  assert.equal(await page.getByLabel('Focus Points remaining').inputValue(),'2');assert.equal(await page.getByLabel('Bardic Inspiration remaining').inputValue(),'3');assert.equal(await page.getByLabel('Healing Pool remaining').inputValue(),'12');
  const standard=page.getByLabel('# of Attacks (standard) remaining');
  assert.equal(await standard.inputValue(),'0');assert.equal(await standard.getAttribute('max'),null,'additive queue is not capped by the per-Action denominator');
  assert.equal(await standard.locator('..').locator('span').textContent(),'/ 2');
  assert.equal(await page.locator('.wb20-resource-dialog').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(250, 245, 230)');
  await page.getByLabel('Focus Points remaining').fill('3');await page.getByLabel('Healing Pool remaining').fill('14');await page.getByRole('button',{name:'Save corrections',exact:true}).click();await page.evaluate(()=>correcting);
  assert.equal(await page.evaluate(()=>wb20Resource('Focus Points').remaining),3);assert.equal(await page.evaluate(()=>wb20Resource('Healing Pool').remaining),14);assert.equal(await page.evaluate(()=>wb20Resource('Bardic Inspiration').remaining),3);
  assert.equal(await page.locator('.ct-slot-manager-large__diff').count(),0);
  await page.evaluate(()=>{window.correcting=wb20CorrectResources();});await page.getByLabel('Focus Points remaining').fill('0');await page.getByRole('button',{name:'Cancel',exact:true}).click();await page.evaluate(()=>correcting);assert.equal(await page.evaluate(()=>wb20Resource('Focus Points').remaining),3);
  await page.evaluate(()=>{state.maxHasteAction=1;state.hasteAction=1;state.featureGrants={flurry:{name:'Flurry of Blows attacks',turnKey:wayBeyond20AttackActivationTurnKey(),remaining:1,max:2}};window.correcting=wb20CorrectResources();});
  assert.equal(await page.getByLabel('Haste attack action remaining').inputValue(),'1');
  assert.equal(await page.getByLabel('Haste attack action remaining').locator('..').locator('span').textContent(),'/ 1');
  assert.equal(await page.getByLabel('Flurry of Blows attacks remaining').locator('..').locator('span').textContent(),'/ 2');
  await standard.fill('2');await page.getByRole('button',{name:'Save corrections',exact:true}).click();await page.evaluate(()=>correcting);
  assert.equal(await page.evaluate(()=>state.attacksRemaining),2);assert.equal(await page.evaluate(()=>state.hasteAction),1);
  await page.evaluate(()=>{const theme=document.querySelector('.ct-saving-throws-box');theme.style.backgroundColor='rgb(25,30,35)';theme.style.color='rgb(240,240,240)';window.correcting=wb20CorrectResources();});
  await page.getByLabel('Focus Points remaining').waitFor();assert.equal(await page.locator('.wb20-resource-dialog').evaluate(el=>getComputedStyle(el).color),'rgb(240, 240, 240)');await page.getByRole('button',{name:'Cancel',exact:true}).click();await page.evaluate(()=>correcting);
  assert.deepEqual(errors,[]);console.log('PASS resource browser: native ownership/partial pools, numeric increase/Confirm, native restore, unchanged/cancel preservation, no class gate, duplicate Unarmed rows, themed Correction light/dark. Isolated fixture only.');
  await page.evaluate(()=>{values['waybeyond20-feature-controls']=false;wayBeyond20ScheduleActiveEffectBadgeRefresh();});
  assert.equal(await page.locator('.wb20-feature-row,.wb20-feature-focus,.wb20-feature-rules').count(),0,'presentation switch hides controls');
  assert.equal(await page.evaluate(()=>wb20Resource('Focus Points').remaining),3,'presentation switch leaves shared resource processing intact');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
