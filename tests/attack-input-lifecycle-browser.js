// Real capture handlers in two independent content-script-shaped closures.
// An extension reload invalidates the first while DOM/listeners remain alive.
const {chromium}=require(process.env.WB20_PLAYWRIGHT||'playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..'),source=fs.readFileSync(path.join(root,'src/dndbeyond/content-scripts/character.js'),'utf8');
const installer=process.env.WB20_INPUT_ANCESTOR_SOURCE ? fs.readFileSync(process.env.WB20_INPUT_ANCESTOR_SOURCE,'utf8') : source;
function fn(name,code=source){const start=code.search(new RegExp(`^(?:async )?function ${name}\\(`,'m'));assert.ok(start>=0,name);
 const end=code.slice(start+1).search(/^(?:(?:async )?function |const |let |var |class )/m);return code.slice(start,end<0?undefined:start+1+end);}
(async()=>{
 const orphan={isExtensionDisconnected:()=>true};vm.createContext(orphan);
 vm.runInContext(fn('wayBeyond20DDBRollInputAvailable')+'\n'+fn('handleCombatAttackIntegratedDie'),orphan);
 assert.equal(orphan.handleCombatAttackIntegratedDie({closest(){throw Error('Orphan reached row/hover/menu handling');}}),false);
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{
  const page=await browser.newPage();
  await page.setContent('<div class="ddbc-combat-attack"><div class="ddbc-combat-attack__icon" role="button" tabindex="0" aria-label="Full attack">Attack</div><div class="ddbc-combat-attack__label">Fangs</div><div class="ddbc-combat-attack__tohit"><button class="integrated-dice__container">+5</button></div></div>');
  await page.addScriptTag({path:path.join(root,'libs/jquery-3.4.1.min.js')});
  const instance=name=>`(()=>{
   let disconnected=false,ddbRollHijackInstalled=false,ddbHijackPointerHandled=false;
   const character={},calls=[];
   function isExtensionDisconnected(){return disconnected;}
   function wb20CancelCombatHandoff(){}
   function handleCombatAttackIntegratedDie(target,mode=null){calls.push({kind:target.closest('.ddbc-combat-attack__tohit')?'hit':'full',mode});return true;}
   function handleSpellIntegratedDie(){return false;}function handleInitiativeIntegratedDie(){return false;}
   function handleAbilityIntegratedDie(){return false;}function handleSavingThrowIntegratedDie(){return false;}function handleSkillIntegratedDie(){return false;}
   function wayBeyond20ShowAttackMenu(target,callback,current){if(current())callback(3);}
   ${['swallowRollEvent','canHandleDDBRollTarget','wayBeyond20DDBRollInputAvailable','wayBeyond20QueueCombatAttackIcon'].map(n=>fn(n)).join('\n')}
   ${fn('installDDBRollHijack',installer)}
   installDDBRollHijack();
   window[${JSON.stringify(name)}]={calls,invalidate(){disconnected=true;}};
  })();`;
  await page.addScriptTag({content:instance('oldInstance')});
  await page.getByRole('button',{name:'Full attack',exact:true}).click();
  assert.equal(await page.evaluate(()=>oldInstance.calls.length),1,'Initial listener works');
  await page.evaluate(()=>oldInstance.invalidate());
  await page.addScriptTag({content:instance('activeInstance')});
  await page.getByRole('button',{name:'Full attack',exact:true}).click();
  assert.equal(await page.evaluate(()=>activeInstance.calls.length),1,'Orphan must not swallow the new full attack');
  await page.getByRole('button',{name:'+5',exact:true}).click();
  await page.getByRole('button',{name:'Full attack',exact:true}).press('Enter');
  await page.getByRole('button',{name:'Full attack',exact:true}).click({button:'right'});
  await page.getByRole('button',{name:'Full attack',exact:true}).press('Shift+F10');
  assert.equal(await page.evaluate(()=>oldInstance.calls.length),1,'Invalidated context never handles another input');
  assert.deepEqual(await page.evaluate(()=>activeInstance.calls),[
   {kind:'full',mode:null},{kind:'hit',mode:null},{kind:'full',mode:null},{kind:'full',mode:3},{kind:'full',mode:3}]);
  console.log('PASS invalidated first listener yields pointer/click/numeric/keyboard/context menu to active instance');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
