// Offline browser regression: real capture listeners, row routing, execute and
// quick-roll handoff. Native DDB and dice delivery are modeled, not live acceptance.
const {chromium} = require(process.env.WB20_PLAYWRIGHT || 'playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const source=fs.readFileSync(path.join(root,'src/dndbeyond/content-scripts/character.js'),'utf8');
const installerSource=process.env.WB20_ICON_INSTALLER_SOURCE ? fs.readFileSync(process.env.WB20_ICON_INSTALLER_SOURCE,'utf8') : source;
const utils=fs.readFileSync(path.join(root,'src/dndbeyond/base/utils.js'),'utf8');
function fn(name,code=source){
    const start=code.search(new RegExp(`^(?:async )?function ${name}\\(`,'m'));
    assert.ok(start>=0,name);
    const end=code.slice(start+1).search(/^(?:(?:async )?function |const |let |var |class )/m);
    return code.slice(start,end<0?undefined:start+1+end);
}
(async()=>{
    const browser=await chromium.launch({channel:'chrome',headless:true});
    try{
        const page=await browser.newPage();
        page.setDefaultTimeout(8000);
        await page.setContent(`<div class="ddbc-combat-attack"><span class="ddbc-combat-attack__icon" role="button" tabindex="0">Attack</span><span class="ddbc-combat-attack__name"><span class="ddbc-combat-attack__label">Test sword</span></span><span class="ddbc-combat-attack__tohit"><button class="integrated-dice__container">+5</button></span></div><div class="b20-item-pane"><h2 class="ct-sidebar__heading">Test sword</h2><div class="ct-item-detail"></div></div><button id="other">Other</button>`);
        await page.addScriptTag({path:path.join(root,'libs/jquery-3.4.1.min.js')});
        await page.addScriptTag({content:fs.readFileSync(path.join(root,'src/dndbeyond/content-scripts/attack-handoff.js'),'utf8')});
        await page.addScriptTag({content:`
            var ddbRollHijackInstalled=false,ddbHijackPointerHandled=false;
            var quick_roll=false,quick_roll_force_attack=false,quick_roll_force_damage=false,
                quick_roll_force_versatile=false,quick_roll_force_mode=null,quick_roll_mode_target=null,quick_roll_timeout=0;
            var character={};
            var wayBeyond20AttackMenuClose=null,last_character_used=null;
            var button_class='',button_class_small='';
            var E=new Proxy({}, {get:(_,tag)=>(attrs,...children)=>{
                const el=document.createElement(tag);Object.entries(attrs).forEach(([k,v])=>el.setAttribute(k,v));
                children.forEach(child=>el.append(child));return el;
            }});
            function getRollTypeButtonClass(){return '';}
            function getBadgeIconFromClass(){return '';}
            function propertyListToDict(){return {'To Hit':'+5'};}
            var calls=[],nativeClicks=0,menus=0;
            var nativeDismiss=false;
            // Native outside-click listener is registered before the extension.
            window.addEventListener('click',event=>{
                if(nativeDismiss && !event.target.closest('.ct-sidebar__portal'))
                    document.querySelectorAll('.ct-sidebar__portal').forEach(el=>el.remove());
            },true);
            var RollType={NORMAL:0,QUERY:2,ADVANTAGE:3,DISADVANTAGE:4};
            function handleCustomText(){return {before:[],replace:[],after:[]};}
            function pauseHotkeyHandling(){} function resumeHotkeyHandling(){}
            function rollItem(...args){calls.push(['item',...args]);}
            function rollAction(...args){calls.push(['action',...args]);}
            function rollSpell(...args){calls.push(['spell',...args]);}
            function handleSpellIntegratedDie(){return false;}
            function handleInitiativeIntegratedDie(){return false;}
            function handleAbilityIntegratedDie(){return false;}
            function handleSavingThrowIntegratedDie(){return false;}
            function handleSkillIntegratedDie(){return false;}
            ${['wayBeyond20ShowAttackMenu','addRollButton'].map(n=>fn(n,utils)).join('\n')}
            ${['swallowRollEvent','canHandleDDBRollTarget','wayBeyond20DDBRollInputAvailable','installDDBRollHijack','wayBeyond20QueueCombatAttackIcon','handleCombatAttackIntegratedDie','execute','executeQuickRoll','resetHijackQuickRollState','addRollButtonEx'].map(n=>fn(n,n==='installDDBRollHijack'?installerSource:source)).join('\n')}
            addRollButtonEx('b20-item-pane','.ct-sidebar__heading',{image:false});
            installDDBRollHijack();installDDBRollHijack();
            document.addEventListener('click',()=>nativeClicks++);
            document.addEventListener('contextmenu',()=>menus++);
        `});
        const icon=page.getByRole('button',{name:'Attack',exact:true});
        await icon.click({button:'right'});
        assert.equal(await page.evaluate(()=>calls.length),0,'Opening options must not enter preflight');
        await page.getByRole('radio',{name:'Advantage',exact:true}).click();
        assert.equal(await page.evaluate(()=>calls.length),0,'Selecting alone must not roll');
        await page.getByRole('button',{name:'ROLL FULL ATTACK',exact:true}).click();
        await page.waitForFunction(()=>calls.length===1);
        assert.deepEqual(await page.evaluate(()=>calls[0]),['item',false,false,false,false,null,3]);
        assert.equal(await page.evaluate(()=>menus),0);
        const clicksBefore=await page.evaluate(()=>nativeClicks);
        await icon.click();
        await page.waitForFunction(()=>calls.length===2);
        assert.equal(await page.evaluate(()=>calls[1].at(-1)),null,'Next left click uses saved mode');
        assert.equal(await page.evaluate(()=>nativeClicks),clicksBefore,'No duplicate native roll');
        await page.getByRole('button',{name:'Other',exact:true}).click({button:'right'});
        assert.equal(await page.evaluate(()=>menus),1,'Unrelated context menus preserved');
        await icon.press('Shift+F10');
        assert.equal(await page.evaluate(()=>calls.length),2);
        await page.getByRole('radio',{name:'Disadvantage',exact:true}).click();
        await page.getByRole('button',{name:'ROLL FULL ATTACK',exact:true}).click();
        await page.waitForFunction(()=>calls.length===3);
        assert.equal(await page.evaluate(()=>calls[2].at(-1)),4);
        await icon.press('Enter');
        await page.waitForFunction(()=>calls.length===4);
        assert.equal(await page.evaluate(()=>calls[3].at(-1)),null);
        // A different/missing sidebar must preserve the mode across the observer handoff.
        await page.evaluate(()=>document.querySelector('.ct-sidebar__heading').textContent='Other sword');
        await icon.click({button:'right'});
        assert.equal(await page.evaluate(()=>quick_roll),false,'No pane navigation until Roll');
        await page.getByRole('button',{name:'ROLL FULL ATTACK',exact:true}).click();
        await page.waitForFunction(()=>wb20CombatHandoff!==null);
        assert.deepEqual(await page.evaluate(()=>[!!wb20CombatHandoff,wb20CombatHandoff.options.force_roll_mode,calls.length]),[true,0,4]);
        await page.evaluate(()=>{document.querySelector('.ct-sidebar__heading').textContent='Test sword';wb20ContinueCombatHandoff();});
        await page.waitForFunction(()=>calls.length===5);
        assert.equal(await page.evaluate(()=>calls[4].at(-1)),0);
        assert.deepEqual(await page.evaluate(()=>[quick_roll,quick_roll_force_mode]),[false,null]);
        await page.evaluate(async()=>{
            await execute('b20-action-pane',{force_roll_mode:2});
            await execute('ct-spell-pane',{force_roll_mode:2});
            quick_roll_force_mode=2;resetHijackQuickRollState();
        });
        assert.equal(await page.evaluate(()=>calls[5].at(-1)),2);
        assert.equal(await page.evaluate(()=>calls[6].at(-1)),2);
        assert.equal(await page.evaluate(()=>quick_roll_force_mode),null);
        await page.evaluate(()=>{document.querySelector('.ct-sidebar__heading').textContent='Other sword';});
        await icon.click({button:'right'});
        await page.getByRole('button',{name:'ROLL FULL ATTACK',exact:true}).click();
        await page.waitForFunction(()=>wb20CombatHandoff!==null);
        await page.evaluate(()=>wb20ContinueCombatHandoff());
        assert.equal(await page.evaluate(()=>calls.length),7,'No query mode applied to a different pane');
        assert.equal(await page.evaluate(()=>quick_roll_force_mode),null);
        // Escape, outside dismissal, stale character and sidebar identity do no work.
        await icon.click({button:'right'});await page.keyboard.press('Escape');
        assert.equal(await page.locator('.waybeyond20-attack-menu').count(),0);
        await icon.click({button:'right'});await page.mouse.click(600,400);
        assert.equal(await page.locator('.waybeyond20-attack-menu').count(),0);
        assert.equal(await page.evaluate(()=>calls.length),7);
        const red=page.locator('.ct-beyond20-roll-button');
        await red.click({button:'right'});
        assert.equal(await page.evaluate(()=>calls.length),7,'Red button options precede off-turn/preflight');
        await page.getByRole('radio',{name:'Disadvantage',exact:true}).click();
        await page.getByRole('button',{name:'ROLL FULL ATTACK',exact:true}).click();
        assert.equal(await page.evaluate(()=>calls.length),8);
        assert.equal(await page.evaluate(()=>calls[7].at(-1)),4);
        await red.press('Shift+F10');
        await page.evaluate(()=>{character={};});
        await page.getByRole('button',{name:'ROLL FULL ATTACK',exact:true}).click();
        assert.equal(await page.evaluate(()=>calls.length),8,'Stale owner does not roll');
        await red.click({button:'right'});
        await page.evaluate(()=>document.querySelector('.ct-sidebar__heading').textContent='Changed');
        await page.getByRole('button',{name:'ROLL FULL ATTACK',exact:true}).click();
        assert.equal(await page.evaluate(()=>calls.length),8,'Stale pane does not roll');
        // The reported Fangs/Claws action pane and spell attack use the same menu.
        for (const paneClass of ['b20-action-pane','ct-spell-pane']) {
            await page.evaluate(cls=>{
                const pane=document.querySelector('.b20-item-pane,.b20-action-pane,.ct-spell-pane');
                pane.className=cls;
                document.querySelectorAll('.ct-beyond20-roll').forEach(el=>el.remove());
                addRollButtonEx(cls,'.ct-sidebar__heading',{image:false});
            },paneClass);
            const before=await page.evaluate(()=>calls.length);
            await page.locator('.ct-beyond20-roll-button').click({button:'right'});
            assert.equal(await page.evaluate(()=>calls.length),before);
            await page.getByRole('radio',{name:'Advantage',exact:true}).click();
            await page.getByRole('button',{name:'ROLL FULL ATTACK',exact:true}).click();
            assert.equal(await page.evaluate(()=>calls.length),before+1);
            assert.equal(await page.evaluate(()=>calls.at(-1).at(-1)),3);
        }
        // The real observer is called repeatedly while DDB renders. A pending
        // roll must not be postponed forever by mutations arriving <50ms apart.
        await page.addScriptTag({content:`
            var settings={},DigitalDiceManager={updateNotifications:()=>null};
            function isExtensionDisconnected(){return false;}
            ${['injectRollToSpellAttack','injectRollToSnippets','injectSettingsButton','wayBeyond20InjectCombatMenuAction','wayBeyond20ScheduleActiveEffectBadgeRefresh','injectCustomRollButton','wayBeyond20InjectBloodAndBoneAction','wayBeyond20InjectBardicInspirationButton','wayBeyond20InjectLayOnHandsControls','activateQuickRolls','wayBeyond20RefreshCombinedActions','injectRollButton'].map(n=>`function ${n}(){}`).join('\n')}
            ${fn('documentModified')}
        `});
        const beforeChurn=await page.evaluate(()=>calls.length);
        await page.evaluate(()=>{
            character.updateInfo=()=>{};
            document.querySelector('.ct-spell-pane').classList.add('extra-native-class');
            quick_roll=true;quick_roll_force_mode=null;
            documentModified();
            window.churn=setInterval(()=>documentModified(),10);
        });
        await page.waitForFunction(n=>calls.length===n+1,beforeChurn,{timeout:1000});
        await page.evaluate(()=>clearInterval(window.churn));
        assert.equal(await page.evaluate(()=>calls.at(-1)[0]),'spell');
        // Compose the real icon listener with the real document observer and
        // delayed DDB-shaped action pane, rather than manually calling the
        // quick-roll continuation after changing a heading.
        const beforeHandoff=await page.evaluate(()=>{
            resetHijackQuickRollState();
            document.querySelectorAll('.b20-item-pane,.b20-action-pane,.ct-spell-pane,.ct-beyond20-roll').forEach(el=>el.remove());
            document.querySelector('.ddbc-combat-attack__label').textContent='Test sword';
            document.querySelector('.ddbc-combat-attack__label').onclick=()=>setTimeout(()=>{
                const portal=document.createElement('div');portal.className='ct-sidebar__portal';
                portal.innerHTML='<div><header class="ct-sidebar__header"><h1 class="ct-sidebar__heading"><span class="ddbc-action-name">Test sword</span></h1></header><div class="ct-available-actions"></div></div>';
                document.body.append(portal);
            },10);
            window.handoffObserver=new MutationObserver(documentModified);
            window.handoffObserver.observe(document.body,{subtree:true,childList:true,characterData:true});
            return calls.length;
        });
        await icon.click();
        await page.waitForFunction(n=>calls.length===n+1,beforeHandoff,{timeout:1500});
        assert.equal(await page.evaluate(()=>calls.at(-1)[0]),'action');
        assert.deepEqual(await page.evaluate(()=>[quick_roll,quick_roll_mode_target]),[false,null]);
        await page.evaluate(()=>window.handoffObserver.disconnect());
        // DDB may synchronously open the requested pane from the synthetic name
        // click, then dismiss it on the still-unfinished outer icon click.
        const beforeDismiss=await page.evaluate(()=>{
            resetHijackQuickRollState();
            document.querySelectorAll('.ct-sidebar__portal').forEach(el=>el.remove());
            document.querySelector('.ddbc-combat-attack__label').onclick=null;
            window.nativeOpen=event=>{
                if(!event.target.closest('.ddbc-combat-attack__label'))return;
                const portal=document.createElement('div');portal.className='ct-sidebar__portal';
                portal.innerHTML='<div><header class="ct-sidebar__header"><h1 class="ct-sidebar__heading"><span class="ddbc-action-name">Test sword</span></h1></header><div class="ct-action-detail"></div></div>';
                document.body.append(portal);
            };
            document.addEventListener('click',window.nativeOpen);
            nativeDismiss=true;
            window.handoffObserver.observe(document.body,{subtree:true,childList:true,characterData:true});
            return calls.length;
        });
        await icon.click();
        await page.waitForFunction(n=>calls.length===n+1,beforeDismiss,{timeout:1500});
        assert.equal(await page.evaluate(()=>calls.at(-1)[0]),'action');
        await icon.click({button:'right'});
        await page.getByRole('radio',{name:'Advantage',exact:true}).click();
        await page.getByRole('button',{name:'ROLL FULL ATTACK',exact:true}).click();
        await page.waitForFunction(n=>calls.length===n+2,beforeDismiss,{timeout:1500});
        assert.equal(await page.evaluate(()=>calls.at(-1).at(-1)),3);
        await page.evaluate(()=>{nativeDismiss=false;window.handoffObserver.disconnect();document.removeEventListener('click',window.nativeOpen);});
        const staleQueue=await page.evaluate(async()=>{
            const before=calls.length,icon=document.querySelector('.ddbc-combat-attack__icon');
            wayBeyond20QueueCombatAttackIcon(icon);character={};
            await new Promise(resolve=>setTimeout(resolve,20));
            wayBeyond20QueueCombatAttackIcon(icon);icon.remove();
            await new Promise(resolve=>setTimeout(resolve,20));
            return calls.length-before;
        });
        assert.equal(staleQueue,0,'Queued icon rejects changed character and disconnected caller');
        // Final roll construction must attach the explicit query to the request,
        // not a mutable global preference or a later damage/rider roll.
        for(const name of ['rollItem','rollAction','rollSpell']){
            assert.match(fn(name),/if \(force_roll_mode !== null && roll_properties.rollAttack\) \{\s*roll_properties.advantage = force_roll_mode;/);
            assert.match(fn(name),/roll_properties\["waybeyond20-query-attack-mode"\] = force_roll_mode === RollType.QUERY;/);
            assert.match(fn(name),/roll_properties\["waybeyond20-explicit-attack-mode"\] = force_roll_mode;/);
        }
        console.log('PASS shared icon/red-button menu: options BEFORE preflight, Adv/Flat/Dis, explicit Roll only, Escape/outside/stale cancellation, keyboard, one routing, ordinary next click, native-menu isolation, deferred pane handoff');
    }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
