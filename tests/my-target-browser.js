const {chromium}=require(process.env.WB20_PLAYWRIGHT || 'playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
function fn(source,name){const start=source.search(new RegExp('^(?:async )?function '+name+'\\(','m'));assert.ok(start>=0,name);const next=source.slice(start+1).search(/^(?:function |async function |const |let |var |class )/m);return source.slice(start,next<0?undefined:start+1+next);}
const source=read('src/dndbeyond/content-scripts/character.js');
// Producer preserves each token identity and initiative (including zero).
const ctx=vm.createContext({wayBeyond20GetGraphicName:id=>id==='a'?'Goblin':'Ogre',wayBeyond20ReadTokenPosition:()=>null});
vm.runInContext(fn(read('src/roll20/page-script.js'),'wayBeyond20ReadTurnOrderTargets'),ctx);
assert.deepEqual(JSON.parse(vm.runInContext('JSON.stringify(wayBeyond20ReadTurnOrderTargets([{id:"a",pr:0},{id:"b",pr:18},{id:"-1",pr:99}]))',ctx)).map(t=>[t.tokenId,t.initiative]),[['a','0'],['b','18']]);
(async()=>{
    const browser=await chromium.launch({channel:'chrome',headless:true});
    try {
        const page=await browser.newPage({viewport:{width:1200,height:800},colorScheme:'dark'});
        await page.setContent('<div class="ct-saving-throws-box" style="display:none;color:rgb(0,0,0)"><div class="ddbc-box-background"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 281 200"><path fill="#fefefe" d="M0 0H281V200H0Z"/><path fill="#c53131" d="M0 0H281V4H0Z"/></svg></div></div><main></main>');
        await page.addScriptTag({path:path.join(root,'libs/jquery-3.4.1.min.js')});
        await page.addStyleTag({path:path.join(root,'src/extension/beyond20.css')});
        await page.addStyleTag({content:'main { min-height: 1px; }'});
        await page.addScriptTag({content:fn(read('src/dndbeyond/content-scripts/portent.js'),'wayBeyond20ApplySheetTheme')});
        await page.addScriptTag({content:`
            var state={inCombat:true,combatSource:'Roll20',combatStartedAt:1,action:1,bonusAction:1,reaction:1,movement:30,
                currentRoll20Turn:{tokenId:'one',tokenName:'Goblin'},
                knownTargets:[{tokenId:'one',name:'Goblin',initiative:'18'},{tokenId:'two',name:'Goblin',initiative:'0'},
                    {tokenId:'three',name:'Ogre Zombie (choirmaster)',initiative:'13'}]};
            var character={},wb20QuickDamageTypes=['Fire','Piercing','Cold'];
            function wayBeyond20GetTurnTrackerState(){return state;}
            function wayBeyond20SetTurnTrackerState(s,cb){state=JSON.parse(JSON.stringify(s));if(cb)cb();}
            function wayBeyond20ScheduleActiveEffectBadgeRefresh(){wayBeyond20InjectTurnResourceTracker();}
            function wayBeyond20GetTrackedSpellEffects(){return [];}
            function wayBeyond20NormalizeTurnTrackerState(s){return {...s};}
            function wayBeyond20IsMainCharacterSheet(){return true;}
            var waybeyond20_effect_badge_refresh_timer=0, placementRefreshes=0;
            function wayBeyond20RefreshActiveEffectBadges(){waybeyond20_effect_badge_refresh_timer=0;placementRefreshes++;wayBeyond20InjectTurnResourceTracker();}
            function wayBeyond20ParseInteger(n){return Number.isFinite(Number(n))?Number(n):null;}
            function wayBeyond20SpendTurnResource(){throw new Error('Target controls must not spend economy');}
            function wayBeyond20StartNewTurn(){state={...state,localTurnNumber:2};wayBeyond20ScheduleActiveEffectBadgeRefresh();}
            function wayBeyond20EndCombat(){state={...state,inCombat:false};wayBeyond20ScheduleActiveEffectBadgeRefresh();}
            ${['wayBeyond20HasActiveCombatState','wayBeyond20BuildCombatResource','wayBeyond20FindCombatSectionHost','wayBeyond20InjectTurnResourceTracker'].map(n=>fn(source,n)).join('\n')}
            ${fn(source,'wayBeyond20ScheduleActiveEffectBadgeRefresh').replace('function wayBeyond20ScheduleActiveEffectBadgeRefresh(', 'function schedulePlacementRefresh(')}
        `});
        await page.addScriptTag({path:path.join(root,'src/dndbeyond/content-scripts/my-target.js')});
        await page.evaluate(()=>wayBeyond20InjectTurnResourceTracker());
        // Bill's longer side names must clear the rim without raising the header.
        await page.evaluate(()=>{
            window.savedNames=state.knownTargets.map(t=>t.name);
            state.knownTargets[1].name='Swarm of Quippers 1';state.knownTargets[2].name='Swarm of Quippers 2';
            wayBeyond20InjectTurnResourceTracker();
        });
        assert.equal(await page.evaluate(()=>{
            const names=[...document.querySelectorAll('.wb20-compass-previous .wb20-compass-name,.wb20-compass-next .wb20-compass-name')].map(e=>{
                const range=document.createRange();range.selectNodeContents(e);return range.getBoundingClientRect();
            });
            const path=document.querySelector('.wb20-compass-rim path'),matrix=path.getScreenCTM();
            for(let i=0;i<=400;i++){
                const p=path.getPointAtLength(path.getTotalLength()*i/400).matrixTransform(matrix);
                if(names.some(r=>p.x>=r.left&&p.x<=r.right&&p.y>=r.top-1&&p.y<=r.bottom+1))return {point:{x:p.x,y:p.y},names:names.map(r=>({left:r.left,right:r.right,top:r.top,bottom:r.bottom}))};
            }
            return true;
        }),true,'compass rim must not cross the side names');
        if(process.env.WB20_TARGET_SCREENSHOT)await page.locator('main').screenshot({path:process.env.WB20_TARGET_SCREENSHOT.replace('.png','-curve.png')});
        await page.evaluate(()=>{state.knownTargets.forEach((t,i)=>t.name=window.savedNames[i]);wayBeyond20InjectTurnResourceTracker();});
        assert.equal(await page.locator('.wb20-compass-previous .wb20-compass-name').textContent(),'Ogre Zombie (choirmaster)');
        assert.equal(await page.locator('.wb20-compass-current .wb20-compass-name').textContent(),'Goblin');
        assert.equal(await page.locator('.wb20-compass-next .wb20-compass-name').textContent(),'Goblin');
        assert.equal(await page.locator('.wb20-compass-advancing').count(),0);
        const beforeBrowsing=await page.evaluate(()=>JSON.stringify(state));
        await page.getByRole('button',{name:'Preview next combatant: Goblin',exact:true}).click();
        assert.equal(await page.locator('.wb20-compass-current .wb20-compass-caption').textContent(),'Viewing');
        await page.getByRole('button',{name:'Preview next combatant: Ogre Zombie (choirmaster)',exact:true}).click();
        assert.equal(await page.locator('.wb20-compass-current .wb20-compass-name').textContent(),'Ogre Zombie (choirmaster)');
        await page.getByRole('button',{name:'Back to current turn',exact:true}).click();
        assert.equal(await page.locator('.wb20-compass-current .wb20-compass-caption').textContent(),'Current turn');
        assert.equal(await page.evaluate(()=>JSON.stringify(state)),beforeBrowsing);
        // Selection follows the centered token, not its duplicate display name.
        await page.getByRole('button',{name:'Preview next combatant: Goblin',exact:true}).click();
        await page.getByRole('button',{name:'Select Target',exact:true}).click();
        assert.equal(await page.getByLabel('Choose my target',{exact:true}).inputValue(),'two');
        assert.equal(await page.locator('.wb20-compass-current .wb20-compass-caption').textContent(),'Viewing');
        assert.deepEqual(await page.evaluate(()=>[state.action,state.bonusAction,state.reaction]),[1,1,1]);
        await page.getByRole('button',{name:'Back to current turn',exact:true}).click();
        await page.evaluate(()=>{state.currentRoll20Turn={tokenId:'two',tokenName:'Goblin'};state.knownTargets.push(state.knownTargets.shift());wayBeyond20InjectTurnResourceTracker();});
        assert.equal(await page.locator('.wb20-compass-previous .wb20-compass-name').textContent(),'Goblin');
        assert.equal(await page.locator('.wb20-compass-next .wb20-compass-name').textContent(),'Ogre Zombie (choirmaster)');
        assert.equal(await page.locator('.wb20-compass-advancing').count(),1);
        await page.emulateMedia({reducedMotion:'reduce'});
        assert.equal(await page.locator('.wb20-compass-current .wb20-compass-name').evaluate(e=>getComputedStyle(e).animationName),'none');
        await page.emulateMedia({reducedMotion:'no-preference'});
        // A rename/order edit updates neighbors without treating it as a new turn.
        await page.evaluate(()=>{state.knownTargets[1].name='Ogre Zombie';wayBeyond20InjectTurnResourceTracker();});
        assert.equal(await page.locator('.wb20-compass-next .wb20-compass-name').textContent(),'Ogre Zombie');
        assert.equal(await page.locator('.wb20-compass-advancing').count(),0);
        const choose=page.getByLabel('Choose my target',{exact:true});
        await choose.selectOption('one');
        // OS dark mode must not override the character's light sheet theme.
        const palette=()=>page.locator('.wb20-my-target').evaluate(e=>({color:getComputedStyle(e).color,
            frame:e.parentElement.style.backgroundImage,surface:getComputedStyle(e.querySelector('option')).backgroundColor,
            input:getComputedStyle(e.querySelector('input')).color}));
        let colors=await palette();
        assert.equal(colors.color,'rgb(0, 0, 0)');assert.equal(colors.surface,'rgb(254, 254, 254)');
        assert.equal(colors.input,colors.color);assert.match(colors.frame,/c53131/i);
        // Theme-only updates retain the input node and its unfinished entry.
        await page.getByLabel('Attack total',{exact:true}).fill('9');
        await page.evaluate(()=>{
            window.targetInput=document.querySelector('.wb20-target-attacks input');
            const native=document.querySelector('.ct-saving-throws-box');native.style.color='#eeeeee';
            native.querySelector('path').setAttribute('fill','#222222');
            wayBeyond20InjectTurnResourceTracker();
        });
        colors=await palette();assert.equal(colors.color,'rgb(238, 238, 238)');assert.equal(colors.surface,'rgb(34, 34, 34)');
        assert.equal(colors.input,colors.color);
        assert.equal(await page.evaluate(()=>window.targetInput===document.querySelector('.wb20-target-attacks input')),true);
        assert.equal(await page.getByLabel('Attack total',{exact:true}).inputValue(),'9');
        // Record/initiative/resource updates must retain drafts and native input
        // nodes, not just theme/position-only updates.
        await page.getByText('Damage & history',{exact:true}).click();
        await page.getByLabel('Damage amount',{exact:true}).fill('7.5');
        await page.getByLabel('Recorded damage type',{exact:true}).selectOption('Cold');
        await page.getByLabel('Attack total',{exact:true}).focus();
        assert.deepEqual(await page.evaluate(()=>{
            const attack=document.querySelector('[aria-label="Attack total"]');
            const damage=document.querySelector('[aria-label="Damage amount"]');
            const before=scrollY;
            state.targetRecords={...state.targetRecords,one:{observations:[{total:18,hit:true}],damage:[]}};
            state.knownTargets.find(t=>t.tokenId==='one').initiative='19';
            state.action=0;
            wayBeyond20InjectTurnResourceTracker();
            return {same:attack===document.querySelector('[aria-label="Attack total"]') && damage===document.querySelector('[aria-label="Damage amount"]'),
                attack:attack.value,damage:damage.value,focused:document.activeElement===attack,
                open:document.querySelector('.wb20-target-history').open,
                type:document.querySelector('[aria-label="Recorded damage type"]').value,scroll:scrollY===before};
        }),{same:true,attack:'9',damage:'7.5',focused:true,open:true,type:'Cold',scroll:true});
        // Simulate the production debounce: type the NEXT entry before the
        // previous entry's refresh arrives. Only the submitted field clears.
        await page.evaluate(()=>{
            window.immediateRefresh=wayBeyond20ScheduleActiveEffectBadgeRefresh;
            wayBeyond20ScheduleActiveEffectBadgeRefresh=()=>{};
        });
        await page.getByRole('button',{name:'Add damage',exact:true}).click();
        assert.equal(await page.getByLabel('Damage amount',{exact:true}).inputValue(),'');
        await page.getByLabel('Damage amount',{exact:true}).fill('8');
        await page.evaluate(()=>wayBeyond20InjectTurnResourceTracker());
        assert.equal(await page.getByLabel('Damage amount',{exact:true}).inputValue(),'8');
        assert.equal(await page.getByLabel('Attack total',{exact:true}).inputValue(),'9');
        await page.getByRole('button',{name:'Hit',exact:true}).click();
        assert.equal(await page.getByLabel('Attack total',{exact:true}).inputValue(),'');
        await page.getByLabel('Attack total',{exact:true}).fill('10');
        await page.evaluate(()=>wayBeyond20InjectTurnResourceTracker());
        assert.equal(await page.getByLabel('Attack total',{exact:true}).inputValue(),'10');
        assert.equal(await page.getByLabel('Damage amount',{exact:true}).inputValue(),'8');
        await choose.selectOption('two');
        await page.evaluate(()=>wayBeyond20InjectTurnResourceTracker());
        assert.equal(await page.getByLabel('Attack total',{exact:true}).inputValue(),'','Never carry a draft to another enemy');
        await page.evaluate(()=>{
            wayBeyond20ScheduleActiveEffectBadgeRefresh=window.immediateRefresh;
            state.action=1;state.targetRecords={};state.knownTargets.find(t=>t.tokenId==='one').initiative='18';
            wb20TargetChoose('one');
        });
        await page.getByLabel('Attack total',{exact:true}).fill('9');
        await page.evaluate(()=>{window.targetInput=document.querySelector('.wb20-target-attacks input');});
        // DDB can append its rebuilt sheet AFTER our existing wrapper. Repair
        // ordering without rebuilding controls, changing battle state or scrolling.
        const placement = await page.evaluate(()=>{
            const section=document.querySelector('.waybeyond20-combat-section');
            const wrapper=section.parentElement, input=window.targetInput;
            const before=JSON.stringify(state), compass=document.querySelector('.wb20-turn-compass');
            const sheet=document.createElement('div');sheet.className='ct-character-sheet-desktop';
            sheet.textContent='Rebuilt character sheet';sheet.style.height='60px';
            wrapper.parentElement.append(sheet);
            input.focus({preventScroll:true});
            const scrollBefore=scrollY;
            wayBeyond20InjectTurnResourceTracker();
            return {below:sheet.nextElementSibling===wrapper,
                sameSection:document.querySelector('.waybeyond20-combat-section')===section,
                sameInput:document.querySelector('.wb20-target-attacks input')===input,
                sameCompass:document.querySelector('.wb20-turn-compass')===compass,
                focused:document.activeElement===input,value:input.value,
                stateUnchanged:JSON.stringify(state)===before,scrollUnchanged:scrollY===scrollBefore};
        });
        assert.deepEqual(placement,{below:true,sameSection:true,sameInput:true,sameCompass:true,
            focused:true,value:'9',stateUnchanged:true,scrollUnchanged:true});
        // A newly available preferred host also moves, rather than destroys,
        // the existing tracker. Stable refreshes must not keep moving it.
        assert.equal(await page.evaluate(()=>{
            const wrapper=document.querySelector('.wb20-combat-layout'), input=window.targetInput;
            const preferred=document.createElement('div');preferred.className='ct-character-sheet__inner';
            document.querySelector('main').append(preferred);
            preferred.append(document.querySelector('.ct-character-sheet-desktop'));
            const before=JSON.stringify(state);
            wayBeyond20InjectTurnResourceTracker();
            const observer=new MutationObserver(()=>{});
            observer.observe(preferred,{childList:true});
            for(let i=0;i<5;i++)wayBeyond20InjectTurnResourceTracker();
            const moves=observer.takeRecords().length;observer.disconnect();
            return preferred.lastElementChild===wrapper && document.querySelector('.wb20-target-attacks input')===input &&
                input.value==='9' && document.activeElement===input && JSON.stringify(state)===before && moves===0;
        }),true,'host changes preserve controls and stable refreshes do not reorder');
        // Exercise the existing debounced update path, not just direct refresh.
        await page.evaluate(()=>{
            window.placementObserver=new MutationObserver(()=>schedulePlacementRefresh());
            const host=document.querySelector('.ct-character-sheet__inner');
            window.placementObserver.observe(host,{childList:true});
            host.append(document.querySelector('.ct-character-sheet-desktop'));
        });
        await page.waitForFunction(()=>document.querySelector('.ct-character-sheet__inner').lastElementChild.classList.contains('wb20-combat-layout'));
        await page.waitForFunction(()=>placementRefreshes>=2 && !waybeyond20_effect_badge_refresh_timer);
        assert.equal(await page.evaluate(()=>{window.placementObserver.disconnect();return placementRefreshes;}),2,
            'one correction and its observer follow-up settle without a mutation loop');
        await page.evaluate(()=>{
            const native=document.querySelector('.ct-saving-throws-box');native.style.color='#000000';
            native.querySelector('path').setAttribute('fill','#fefefe');wayBeyond20InjectTurnResourceTracker();
        });
        assert.equal(await page.locator('.wb20-target-ac').textContent(),'AC: ??');
        for(const [total,hit,ac] of [[18,true,'≤18'],[12,false,'13–18'],[15,true,'13–15'],[14,false,'15']]) {
            await page.getByLabel('Attack total',{exact:true}).fill(String(total));
            await page.getByRole('button',{name:hit?'Hit':'Miss',exact:true}).click();
            assert.equal(await page.locator('.wb20-target-ac').textContent(),'AC: '+ac);
        }
        await page.getByRole('button',{name:'Undo',exact:true}).click();
        assert.equal(await page.locator('.wb20-target-ac').textContent(),'AC: 13–15');
        await page.getByLabel('Attack total',{exact:true}).fill('14');
        await page.getByRole('button',{name:'Miss',exact:true}).click();
        await choose.selectOption('two');
        assert.equal(await page.locator('.wb20-target-ac').textContent(),'AC: ??');
        assert.match(await page.locator('.wb20-target-summary').textContent(),/Initiative: 0/);
        await choose.selectOption('one');
        assert.equal(await page.locator('.wb20-target-ac').textContent(),'AC: 15');
        await page.getByText('Damage & history',{exact:true}).click();
        await page.getByLabel('Damage amount',{exact:true}).fill('11');
        await page.getByLabel('Recorded damage type',{exact:true}).selectOption('Fire');
        await page.getByRole('button',{name:'Add damage',exact:true}).click();
        assert.equal(await page.locator('.wb20-target-damage-total').textContent(),'Damage: 11');
        await page.getByRole('button',{name:'New Turn',exact:true}).click();
        assert.equal(await page.locator('.wb20-target-ac').textContent(),'AC: 15');
        // Fresh hover data is for the viewed token, independent of selected target.
        await page.evaluate(()=>{
            character={_name:'Goblin',getSetting:(key,fallback)=>key==='waybeyond20-roll20-token-id'?'two':fallback};
            state.knownTargets.forEach((t,i)=>t.position={pageId:'map',x:i*70,y:0,scale:5,units:'ft'});
            wayBeyond20InjectTurnResourceTracker();
        });
        await page.getByRole('button',{name:'Preview previous combatant: Goblin',exact:true}).click();
        await page.locator('.wb20-compass-current').focus();
        assert.equal(await page.getByRole('tooltip').isVisible(),true);
        assert.match(await page.getByRole('tooltip').textContent(),/AC: 15/);
        assert.match(await page.getByRole('tooltip').textContent(),/Recorded damage: 11/);
        assert.match(await page.getByRole('tooltip').textContent(),/Fire: 11/);
        assert.match(await page.getByRole('tooltip').textContent(),/Distance: 10 ft/);
        const stableHeight=await page.locator('.waybeyond20-combat-section').evaluate(e=>e.getBoundingClientRect().height);
        await page.getByLabel('Attack total',{exact:true}).fill('17');
        await page.locator('.wb20-compass-current').hover();
        await page.evaluate(()=>{
            window.targetInput=document.querySelector('.wb20-target-attacks input');
            state.knownTargets.find(t=>t.tokenId==='one').position.x=210;
            wayBeyond20InjectTurnResourceTracker();
        });
        assert.match(await page.getByRole('tooltip').textContent(),/Distance: 15 ft/);
        assert.equal(await page.locator('.wb20-turn-compass').getAttribute('data-view-token'),'one');
        assert.equal(await page.getByLabel('Choose my target',{exact:true}).inputValue(),'one');
        assert.equal(await page.evaluate(()=>window.targetInput===document.querySelector('.wb20-target-attacks input')),true);
        assert.equal(await page.getByLabel('Attack total',{exact:true}).inputValue(),'17');
        assert.equal(await page.locator('.waybeyond20-combat-section').evaluate(e=>e.getBoundingClientRect().height),stableHeight);
        if(process.env.WB20_TARGET_SCREENSHOT) await page.screenshot({path:process.env.WB20_TARGET_SCREENSHOT.replace('.png','-hover.png')});
        await page.locator('.wb20-compass-current').press('Escape');
        assert.equal(await page.getByRole('tooltip').count(),0);
        await page.getByRole('button',{name:'Back to current turn',exact:true}).click();
        // Simulate reload of settings/DOM; retain the per-token notes and choice.
        await page.evaluate(()=>{state=JSON.parse(JSON.stringify(state));document.querySelector('main').replaceChildren();wayBeyond20InjectTurnResourceTracker();});
        assert.equal(await choose.inputValue(),'one');
        assert.equal(await page.locator('.wb20-target-ac').textContent(),'AC: 15');
        await page.evaluate(()=>{for(let i=0;i<5;i++)wayBeyond20InjectTurnResourceTracker();});
        assert.equal(await page.locator('.wb20-my-target').count(),1);
        assert.equal(await page.locator('.waybeyond20-combat-section').count(),1);
        const geometry=()=>page.evaluate(()=>{
            const c=document.querySelector('.waybeyond20-combat-section').getBoundingClientRect();
            const t=document.querySelector('.wb20-my-target').getBoundingClientRect();
            const bar=document.querySelector('.waybeyond20-combat-toolbar').getBoundingClientRect();
            const buttons=[...document.querySelectorAll('.waybeyond20-combat-toolbar button')].map(e=>e.getBoundingClientRect().y);
            const fields=[...document.querySelectorAll('.wb20-my-target > :not(details)')].map(e=>e.getBoundingClientRect());
            return {cy:c.y,ty:t.y,cb:c.bottom,tb:t.bottom,ch:c.height,th:t.height,barBottom:bar.bottom,buttons,
                targetOneLine:Math.max(...fields.map(r=>r.top))<Math.min(...fields.map(r=>r.bottom)),
                overflow:document.documentElement.scrollWidth>innerWidth,
                nested:document.querySelector('.wb20-my-target').parentElement.classList.contains('waybeyond20-combat-section')};
        });
        let bounds=await geometry();assert.ok(bounds.nested);assert.ok(bounds.ty>=bounds.barBottom);assert.ok(bounds.tb<bounds.cb);
        assert.ok(bounds.ch<220);assert.equal(new Set(bounds.buttons).size,1);assert.ok(bounds.targetOneLine);assert.equal(bounds.overflow,false);
        assert.ok(await page.evaluate(()=>{
            const header=document.querySelector('.waybeyond20-combat-header').getBoundingClientRect();
            const compass=document.querySelector('.wb20-turn-compass').getBoundingClientRect();
            return compass.height<=49 && Math.abs(header.x+header.width/2-compass.x-compass.width/2)<1;
        }));
        assert.doesNotMatch(await page.locator('.waybeyond20-combat-source').textContent(),/Current:/);
        if(process.env.WB20_TARGET_SCREENSHOT)await page.locator('main').screenshot({path:process.env.WB20_TARGET_SCREENSHOT});
        // Browsing and a real turn update must not grow the header or jump up
        // a long character page. This is a local browser fixture, not live DDB.
        await page.evaluate(()=>{
            const top=document.createElement('div');top.id='scroll-test-top';top.style.height='1500px';
            const bottom=document.createElement('div');bottom.id='scroll-test-bottom';bottom.style.height='1000px';
            document.body.prepend(top);document.body.append(bottom);window.scrollTo(0,1450);
        });
        const scrollBefore=await page.evaluate(()=>scrollY);
        const headerHeight=await page.locator('.waybeyond20-combat-header').evaluate(e=>e.getBoundingClientRect().height);
        await page.getByRole('button',{name:'Preview next combatant: Ogre Zombie',exact:true}).click();
        assert.equal(await page.evaluate(()=>scrollY),scrollBefore);
        assert.equal(await page.locator('.waybeyond20-combat-header').evaluate(e=>e.getBoundingClientRect().height),headerHeight);
        if(process.env.WB20_TARGET_SCREENSHOT)await page.locator('main').screenshot({path:process.env.WB20_TARGET_SCREENSHOT.replace('.png','-browse.png')});
        await page.getByRole('button',{name:'Back to current turn',exact:true}).click();
        assert.equal(await page.evaluate(()=>scrollY),scrollBefore);
        await page.evaluate(()=>{state.currentRoll20Turn={tokenId:'three',tokenName:'Ogre Zombie'};wayBeyond20InjectTurnResourceTracker();});
        assert.equal(await page.evaluate(()=>scrollY),scrollBefore);
        await page.evaluate(()=>{document.getElementById('scroll-test-top').remove();document.getElementById('scroll-test-bottom').remove();window.scrollTo(0,0);});
        // Extra resources and longer target names wrap naturally, without hiding controls.
        await page.evaluate(()=>{state.maxHasteAction=1;state.hasteAction=1;state.knownTargets[0].name='Ogre Zombie (choirmaster)';wayBeyond20InjectTurnResourceTracker();});
        assert.equal(await page.getByRole('button',{name:'Haste Action: 1',exact:true}).count(),1);
        for(const width of [980,760,390,320]) {
            await page.setViewportSize({width,height:800});
            bounds=await geometry();assert.ok(bounds.nested);assert.ok(bounds.ty>=bounds.barBottom);assert.equal(bounds.overflow,false);
        }
        await page.setViewportSize({width:390,height:800});
        await page.getByText('Damage & history',{exact:true}).click();
        assert.equal(await page.getByLabel('Damage amount',{exact:true}).isVisible(),true);
        bounds=await geometry();assert.equal(bounds.overflow,false);
        assert.deepEqual(await page.evaluate(()=>[state.action,state.bonusAction,state.reaction]),[1,1,1]);
        await page.evaluate(()=>{state.knownTargets=[{tokenId:'three',name:'Ogre Zombie'}];wayBeyond20InjectTurnResourceTracker();});
        assert.equal(await page.locator('.wb20-compass-next .wb20-compass-name').textContent(),'—');
        await page.evaluate(()=>{state.currentRoll20Turn=null;wayBeyond20InjectTurnResourceTracker();});
        assert.equal(await page.locator('.wb20-compass-current .wb20-compass-name').textContent(),'Manual turn');
        assert.equal(await page.getByRole('button',{name:'Select Target',exact:true}).isDisabled(),true);
        await page.getByRole('button',{name:'End Combat',exact:true}).click();
        assert.equal(await page.locator('.wb20-combat-layout').count(),0);
        // Real Select Target button + TaleSpire return consumer, including a
        // late settings snapshot and repeated native picks. No live board.
        await page.addScriptTag({path:path.join(root,'src/dndbeyond/content-scripts/talespire.js')});
        await page.evaluate(()=>{
            window.settings={'vtt-tab':{vtt:'talespire'}};window.targetValues={};
            character.getSetting=(key,fallback)=>targetValues[key]??fallback;
            character.mergeCharacterSettings=(values,callback)=>{Object.assign(targetValues,structuredClone(values));callback?.();};
            window.wayBeyond20GetTurnTrackerState=()=>wb20TSGetState();
            window.wayBeyond20SetTurnTrackerState=(value,callback)=>wb20TSSetState(value,callback);
            window.wayBeyond20ScheduleActiveEffectBadgeRefresh=()=>{state=wb20TSGetState();wayBeyond20InjectTurnResourceTracker();};
            window.wayBeyond20TurnTrackerStateEquals=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
            window.targetSnapshot={v:1,campaignId:'campaign',boardId:'board',tracking:true,activeIndex:0,
                order:[{id:'one',name:'Goblin'},{id:'two',name:'Other'}],creatures:[{id:'one',name:'Goblin'},{id:'two',name:'Other'}],
                units:{name:'ft',numberPerTile:5},targetId:'one',targetSession:'session',targetRevision:1};
            wb20TSApplySnapshot(targetSnapshot);window.staleTargetState=structuredClone(wb20TSGetState());
        });
        await page.getByRole('button',{name:'Preview next combatant: Other',exact:true}).click();
        await page.getByRole('button',{name:'Select Target',exact:true}).click();
        assert.equal(await page.getByLabel('Choose my target',{exact:true}).inputValue(),'ts:campaign|board:two');
        await page.evaluate(()=>{wb20TSSetState(staleTargetState);wb20TSApplySnapshot(targetSnapshot,true);});
        assert.equal(await page.getByLabel('Choose my target',{exact:true}).inputValue(),'ts:campaign|board:two');
        await page.evaluate(()=>wb20TSApplySnapshot({...targetSnapshot,targetRevision:2},true));
        assert.equal(await page.getByLabel('Choose my target',{exact:true}).inputValue(),'ts:campaign|board:one');
        console.log('PASS My Target: sheet theme instead of OS theme, theme-only refresh retains input, exact AC sequence, undo, distinct token identities, initiative zero, gross damage, persisted selection/notes, duplicate prevention, desktop/mobile layout, unchanged economy and End Combat cleanup. Fixture only.');
    } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
