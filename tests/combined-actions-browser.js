// Offline rendered-DOM regression. Live DDB acceptance still requires a reload.
const {chromium} = require(process.env.WB20_PLAYWRIGHT || 'playwright');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'src/dndbeyond/content-scripts/character.js'), 'utf8');
function fn(name) {
    const start = source.search(new RegExp(`^(?:async )?function ${name}\\(`, 'm'));
    assert.ok(start >= 0, name);
    const end = source.slice(start + 1).search(/^(?:(?:async )?function |const |let |var |class )/m);
    return source.slice(start, end < 0 ? undefined : start + 1 + end);
}
function row(name) {
    const values = {Sword:['5 ft.','2d6+3'], 'Bardic Damage':['20 (60) ft.','1d6'], 'Bardic Inspiration':['--','1d6'], Riposte:['10 ft.','1d10+2']}[name];
    return `<div class="ddbc-combat-attack" style="display:flex;align-items:center;padding:4px 0"><span class="ddbc-combat-attack__icon wb20-full-attack" role="button" tabindex="0">⚔</span><span class="ddbc-combat-attack__name"><span class="ddbc-combat-attack__label">${name}</span></span><div class="ddbc-combat-attack__range">${values[0]}</div><div class="ddbc-combat-attack__action">+5</div><div class="ddbc-combat-attack__damage"><span class="ddbc-damage__value">${values[1]}</span></div><span class="ddbc-combat-attack__notes">(2/4)</span></div>`;
}
function group(heading, names) {
    return `<div class="styles_actionsList__test"><div>${heading}</div><div><div class="styles_attackTable__test"><div>ATTACK　 RANGE　 HIT / DC　 DAMAGE　 NOTES</div><div>${names.map(row).join('')}</div></div><div>Original explanatory text and controls</div></div></div>`;
}
(async () => {
    const browser = await chromium.launch({channel: 'chrome', headless: true});
    try {
        const page = await browser.newPage({viewport: {width: 900, height: 700}});
        await page.setContent(`<div id="actions" style="width:600px">${group('ACTIONS • Attacks per Action: 1', ['Sword', 'Bardic Damage'])}${group('BONUS ACTIONS', ['Bardic Inspiration'])}${group('REACTIONS', ['Riposte'])}</div>`);
        await page.addStyleTag({path: path.join(root, 'src/extension/beyond20.css')});
        await page.evaluate(()=>{
            for(const identity of document.querySelectorAll('.ddbc-combat-attack__name')){
                const meta=document.createElement('span');
                meta.className='ddbc-combat-attack__meta-item';
                meta.textContent='Melee Attack';
                identity.append(meta);
            }
        });
        await page.addStyleTag({content:'.ddbc-combat-attack__meta-item {display:block;font-family:"Arial Narrow",monospace;font-size:10px;font-weight:400;line-height:10px;color:rgb(117,131,139);text-transform:none;} .ddbc-combat-attack__label {display:block;}'}); 
        await page.addScriptTag({path: path.join(root, 'libs/jquery-3.4.1.min.js')});
        await page.addScriptTag({content: `
            var saved = {}, activations = 0, remaining = 2, nativeClicks = 0;
            var character = {hasClassFeature:()=>true, getSetting:(key,fallback)=>saved[key]??fallback,
                mergeCharacterSettings:(data,cb)=>{Object.assign(saved,data);if(cb)cb();}};
            var wayBeyond20BardicInspirationActivationPending = false;
            function wayBeyond20IsMainCharacterSheet(){return true;}
            function wayBeyond20BardicInspirationRemainingUses(){return remaining;}
            function wayBeyond20GetBardicInspirationDie(){return '1d6';}
            async function wayBeyond20ActivateBardicInspiration(){activations++;}
            ${['wayBeyond20FindBardicInspirationActionRow','wayBeyond20InjectBardicInspirationButton','wayBeyond20ActionListMetadata','wayBeyond20ActionSortValue','wayBeyond20FillHitDieChoices','wayBeyond20CollectFeatureOptions','wayBeyond20MatchActionTypography','wayBeyond20RefreshNaturalAttackIcons','wayBeyond20RefreshCombinedActions'].map(fn).join('\n')}
            var originals=Array.from(document.querySelectorAll('.ddbc-combat-attack')).map(row=>[row,row.parentElement]);
            originals[0][0].querySelector('.wb20-full-attack').addEventListener('click',()=>nativeClicks++);
            wayBeyond20InjectBardicInspirationButton();wayBeyond20RefreshCombinedActions();
        `});
        const visualOrder = () => page.locator('.ddbc-combat-attack').evaluateAll(es => es.map(e=>({name:e.querySelector('.ddbc-combat-attack__label,.wb20-feature-option-name').textContent,y:e.getBoundingClientRect().y})).sort((a,b)=>a.y-b.y).map(e=>e.name));
        const sortBy = async key => {
            await page.getByLabel('Sort action list', {exact:true}).click();
            await page.locator(`[data-sort="${key}"]`).click();
            assert.equal(await page.locator('.wb20-action-sort-control').getAttribute('open'),null);
        };
        assert.deepEqual(await visualOrder(), ['Sword','Bardic Damage','Bardic Inspiration','Riposte']);
        assert.deepEqual(await page.locator('.ddbc-combat-attack').evaluateAll(es => es.map(e => e.dataset.wb20ActionCost)), ['action','special','bonusAction','reaction']);
        assert.deepEqual(await page.locator('.wb20-full-attack').evaluateAll(es => es.map(e => getComputedStyle(e).borderTopColor)), ['rgb(0, 168, 59)','rgb(128, 128, 128)','rgb(36, 107, 209)','rgb(197, 49, 49)']);
        assert.equal(await page.locator('.wb20-attacks-per-action').innerText(), 'Attacks per Action: 1');
        assert.deepEqual(await page.locator('.wb20-action-legend-badge').allTextContents(), ['Actions','Bonus Actions','Reactions','Free/Special']);
        const legendHelp = await page.locator('.wb20-action-legend-badge').evaluateAll(es =>
            es.map(e => ({title:e.title, accessible:e.getAttribute('aria-label'), tabIndex:e.tabIndex})));
        for (const [index, color] of ['Green:', 'Blue:', 'Red:', 'Gray:'].entries()) {
            assert.ok(legendHelp[index].title.startsWith(color));
            assert.ok(legendHelp[index].accessible.includes(legendHelp[index].title));
            assert.equal(legendHelp[index].tabIndex,0);
        }
        assert.match(legendHelp[3].title,/gray does not mean unlimited/);
        assert.deepEqual(await page.locator('.wb20-action-legend-badge').evaluateAll(es=>es.map(e=>getComputedStyle(e).borderTopColor)), ['rgb(0, 168, 59)','rgb(36, 107, 209)','rgb(197, 49, 49)','rgb(128, 128, 128)']);
        // Available panel width, not screen width, determines whether Sort wraps.
        const geometry = () => page.evaluate(() => {
            const box=document.querySelector('.wb20-action-list-sort').getBoundingClientRect();
            const legend=document.querySelector('.wb20-action-list-legend').getBoundingClientRect();
            const sort=document.querySelector('.wb20-action-sort-control').getBoundingClientRect();
            return {right:box.right,sortRight:sort.right,legendTop:legend.top,legendBottom:legend.bottom,sortTop:sort.top,sortBottom:sort.bottom,
                overflow:document.querySelector('.wb20-action-list-sort').scrollWidth>box.width+1};
        });
        await page.setViewportSize({width:1200,height:700});
        await page.evaluate(()=>document.getElementById('actions').style.width='1000px');
        let bounds=await geometry();
        assert.ok(bounds.sortTop<bounds.legendBottom && bounds.legendTop<bounds.sortBottom,'Wide panel uses one line');
        assert.ok(Math.abs(bounds.right-bounds.sortRight)<1,'Sort flush right');
        await page.evaluate(()=>document.getElementById('actions').style.width='600px');
        bounds=await geometry();
        assert.ok(bounds.sortBottom>bounds.legendTop,'View and Sort sit beside or below the legend at 600px');
        assert.ok(Math.abs(bounds.right-bounds.sortRight)<1,'Wrapped Sort still flush right');
        assert.equal(bounds.overflow,false);
        await page.evaluate(()=>{document.querySelector('.styles_actionsList__test').firstElementChild.textContent='ACTIONS • Attacks per Action: 2';wayBeyond20RefreshCombinedActions();});
        assert.equal(await page.locator('.wb20-attacks-per-action').innerText(),'Attacks per Action: 2','Native count updates');
        await page.locator('.wb20-inspire-icon').click();
        assert.equal(await page.evaluate(()=>activations),1);
        await page.locator('.waybeyond20-bardic-inspire').click();
        assert.equal(await page.evaluate(()=>activations),2);
        await page.evaluate(()=>{remaining=0;wayBeyond20InjectBardicInspirationButton();});
        assert.equal(await page.locator('.wb20-inspire-icon').isEnabled(),false);
        assert.equal(await page.locator('.waybeyond20-bardic-inspire').isEnabled(),false);
        await sortBy('name');
        assert.deepEqual(await visualOrder(), ['Bardic Damage','Bardic Inspiration','Riposte','Sword']);
        assert.equal(await page.evaluate(()=>saved['waybeyond20-action-list-sort']),'name');
        assert.equal(await page.evaluate(()=>originals.every(([row,parent])=>row.parentElement===parent)),true,'Never move native rows');
        await page.locator('.ddbc-combat-attack').first().locator('.wb20-full-attack').click();
        assert.equal(await page.evaluate(()=>nativeClicks),1,'Existing native listener retained');
        await sortBy('damage');
        assert.deepEqual(await visualOrder(), ['Sword','Riposte','Bardic Damage','Bardic Inspiration'],'Sorts average damage, not inspiration die');
        await sortBy('range');
        assert.deepEqual(await visualOrder(), ['Bardic Inspiration','Bardic Damage','Riposte','Sword'],'Uses normal range, not long range');
        assert.equal(await page.locator('.wb20-action-sort-control summary').innerText(),'Sort');
        await page.getByLabel('Sort action list',{exact:true}).click();
        await page.keyboard.press('Escape');
        assert.equal(await page.locator('.wb20-action-sort-control').getAttribute('open'),null);
        await page.getByLabel('Sort action list',{exact:true}).click();
        await page.locator('.wb20-attacks-per-action').click();
        assert.equal(await page.locator('.wb20-action-sort-control').getAttribute('open'),null,'Outside click closes');
        // Same native column positions for the rebuilt Inspiration row.
        const columns = await page.evaluate(() => {
            const native=document.querySelector('.ddbc-combat-attack');
            const bard=document.querySelector('.waybeyond20-bardic-feature-card');
            return ['name','range','action','damage','notes'].map(field=>[
                native.querySelector('.ddbc-combat-attack__'+field).getBoundingClientRect().x,
                bard.querySelector('.ddbc-combat-attack__'+field).getBoundingClientRect().x]);
        });
        assert.ok(columns.every(([left,right])=>Math.abs(left-right)<1),'Bardic/native columns identical');
        await page.evaluate(() => {
            window.detailsOpened=0;window.featureUses=0;
            const groups=document.querySelectorAll('.styles_actionsList__test');
            for(const [index,name] of [[0,'Blood and Bone'],[1,'Quick Step'],[2,'Protect Ally'],[0,'Sword'],[1,'Bardic Inspiration: Agile Strikes']]){
                const snippet=document.createElement('div');snippet.className='ct-feature-snippet';
                snippet.innerHTML='<div class="ct-feature-snippet__heading">'+name+'</div><div>Description</div>';
                snippet.firstChild.addEventListener('click',()=>detailsOpened++);
                if(name==='Blood and Bone'){
                    const button=document.createElement('button');
                    button.className='waybeyond20-blood-and-bone-button';button.dataset.waybeyond20Label='Use';
                    button.addEventListener('click',()=>featureUses++);snippet.append(button);
                    window.hitDieChoices=[];
                    for(const die of ['d4','d6','d8','d10','d12']){
                        const choice=document.createElement('button');
                        choice.className='waybeyond20-blood-and-bone-button';
                        choice.dataset.waybeyond20Label=die;
                        choice.addEventListener('click',()=>hitDieChoices.push(die));
                        snippet.append(choice);
                    }
                }
                groups[index].lastElementChild.append(snippet);
            }
            wayBeyond20RefreshCombinedActions();
        });
        await sortBy('economy');
        assert.deepEqual(await visualOrder(),['Sword','Bardic Damage','Blood and Bone','Bardic Inspiration','Quick Step','Riposte','Protect Ally']);
        assert.equal(await page.locator('.wb20-feature-option').count(),3,'No duplicate shortcut for existing attack');
        assert.equal(await page.locator('.wb20-linked-feature').count(),1,'Agile Strikes merges into Bardic Damage');
        const merged = page.locator('.ddbc-combat-attack').filter({has:page.locator('.wb20-linked-feature')});
        assert.equal(await merged.locator('.ddbc-combat-attack__label').innerText(),'Bardic Damage','Native dispatch identity retained');
        assert.equal(await merged.locator('.ddbc-damage__value').innerText(),'1d6','Native damage retained');
        assert.equal(await merged.getAttribute('data-wb20-action-cost'),'special','Merged attack stays free/special');
        await page.getByRole('button',{name:'Agile Strikes rules for Bardic Damage',exact:true}).click();
        assert.equal(await page.evaluate(()=>detailsOpened),1,'Merged details link opens original feature');
        assert.deepEqual(await page.locator('.wb20-feature-option').evaluateAll(es=>es.map(e=>e.dataset.wb20ActionCost)),['action','bonusAction','reaction']);
        await page.getByRole('button',{name:'Action: Use Blood and Bone',exact:true}).click();
        await page.getByRole('button',{name:'Reaction: Open details for Protect Ally',exact:true}).click();
        assert.equal(await page.evaluate(()=>featureUses),1);
        assert.equal(await page.evaluate(()=>detailsOpened),2);
        const blood = page.locator('.wb20-feature-option').filter({hasText:'Blood and Bone'});
        assert.equal(await blood.locator('.wb20-talent-category').innerText(),'Heal Ally');
        assert.equal(await page.locator('.waybeyond20-bardic-feature-card .wb20-talent-category').innerText(),'Help Ally');
        assert.equal(await page.locator('.wb20-feature-option-cost').count(),0,'Cost subtitles removed');
        assert.equal(await page.locator('.ddbc-combat-attack__meta-item').first().innerText(),'Melee Attack','Native attack category unchanged');
        const categoryStyles=await page.evaluate(()=>{
            const props=['fontFamily','fontSize','fontWeight','fontStyle','lineHeight','letterSpacing','color','opacity','textTransform'];
            const read=el=>props.map(p=>getComputedStyle(el)[p]);
            return {native:read(document.querySelector('.ddbc-combat-attack__meta-item')),
                added:Array.from(document.querySelectorAll('.wb20-talent-category')).map(read)};
        });
        assert.ok(categoryStyles.added.every(style=>JSON.stringify(style)===JSON.stringify(categoryStyles.native)),'Talent subtitles match native attack typography exactly');
        for(const [field,text] of [['range','5 ft Touch'],['action','--']]){
            assert.equal(await blood.locator('.ddbc-combat-attack__'+field).innerText(),text);
            assert.equal(await blood.locator('.ddbc-combat-attack__'+field+' button').count(),0);
        }
        const useDie=blood.getByRole('button',{name:'Blood and Bone: choose Target Hit Die',exact:true});
        assert.equal(await useDie.innerText(),'Target\nHit Die');
        assert.equal(await useDie.locator('.wb20-hit-die-label-full').evaluate(e=>getComputedStyle(e).whiteSpace),'pre','Keep Hit Die together after the explicit line break');
        await useDie.click();
        assert.equal(await page.evaluate(()=>featureUses),2,'Damage button invokes the existing Use chooser once');
        await page.setViewportSize({width:375,height:700});
        assert.equal(await useDie.innerText(),'HP Die','Phone label is compact, accessible name remains explicit');
        await page.setViewportSize({width:1200,height:700});
        const choices=blood.locator('.ddbc-combat-attack__notes');
        assert.deepEqual(await choices.locator('button').allTextContents(),['d4','d6','d8','d10','d12']);
        const dieSizes=await choices.locator('button').evaluateAll(es=>es.map(e=>({
            width:e.getBoundingClientRect().width,
            label:e.querySelector('span').getBoundingClientRect().width,
            padding:parseFloat(getComputedStyle(e).paddingLeft)+parseFloat(getComputedStyle(e).paddingRight)
        })));
        assert.ok(dieSizes.every(s=>Math.abs(s.width-dieSizes[4].width)<0.1),'All five die shortcuts have equal width');
        assert.ok(dieSizes.every(s=>Math.abs(s.width-s.label-s.padding-2)<0.1),'Only widest label, comfortable padding and borders determine width: '+JSON.stringify(dieSizes));
        assert.ok(await blood.evaluate(row=>row.querySelector('.wb20-hit-die-use').getBoundingClientRect().right <= row.querySelector('.ddbc-combat-attack__notes').getBoundingClientRect().left),'Target Hit Die stays out of Notes');
        for(const die of ['d4','d6','d8','d10','d12']){
            await choices.getByRole('button',{name:`Blood and Bone: use ${die} Hit Die`,exact:true}).click();
        }
        assert.deepEqual(await page.evaluate(()=>hitDieChoices),['d4','d6','d8','d10','d12'],'Each choice forwards once to the existing die control');
        assert.equal(await page.evaluate(()=>featureUses),2,'Die shortcuts bypass the generic chooser');
        const hitDieColumns = await blood.evaluate(row => {
            const native=document.querySelector('.ddbc-combat-attack:not(.wb20-feature-option)');
            return ['range','action','damage','notes'].map(field => [
                row.querySelector('.ddbc-combat-attack__'+field).getBoundingClientRect().x,
                native.querySelector('.ddbc-combat-attack__'+field).getBoundingClientRect().x]);
        });
        assert.ok(hitDieColumns.every(([left,right])=>Math.abs(left-right)<1),'Hit Die choices align with the attack columns');
        assert.deepEqual(await blood.evaluate(row=>['range','damage'].map(kind=>wayBeyond20ActionSortValue(row,kind,'Blood and Bone'))),[5,null],'Sort by actual range; target Hit Die is not a fixed damage amount');
        await blood.evaluate(row=>{
            const owner=character;
            character={};
            row.querySelector('.wb20-hit-die-choices .wb20-hit-die-choice').click();
            row.querySelector('.wb20-hit-die-use').click();
            character=owner;
        });
        assert.equal(await page.evaluate(()=>hitDieChoices.length),5,'Old-character shortcuts cannot activate');
        assert.equal(await page.evaluate(()=>featureUses),2,'Old-character chooser cannot activate');
        await page.evaluate(()=>{
            document.querySelector('.ct-feature-snippet [data-waybeyond20-label="Use"]').disabled=true;
            wayBeyond20RefreshCombinedActions();
        });
        assert.equal(await useDie.isDisabled(),true,'Chooser mirrors native disabled state');
        await page.evaluate(()=>{
            document.querySelector('.ct-feature-snippet [data-waybeyond20-label="Use"]').disabled=false;
            const button=document.querySelector('.ct-feature-snippet [data-waybeyond20-label="d4"]');
            window.detachedD4=button;
            button.remove();
            wayBeyond20RefreshCombinedActions();
        });
        assert.equal(await choices.getByRole('button',{name:'Blood and Bone: use d4 Hit Die',exact:true}).isDisabled(),true,
            'A missing native die control stays visible but cannot execute');
        await page.evaluate(()=>{
            document.querySelector('.ct-feature-snippet').append(detachedD4);
            wayBeyond20RefreshCombinedActions();
        });
        assert.equal(await choices.getByRole('button',{name:'Blood and Bone: use d4 Hit Die',exact:true}).isDisabled(),false);
        await page.evaluate(()=>{
            document.querySelector('.ct-feature-snippet [data-waybeyond20-label="d8"]').disabled=true;
            wayBeyond20RefreshCombinedActions();
        });
        assert.equal(await blood.getByRole('button',{name:'Blood and Bone: use d8 Hit Die',exact:true}).isDisabled(),true);
        await page.evaluate(()=>{
            document.querySelector('.ct-feature-snippet [data-waybeyond20-label="d8"]').disabled=false;
            wayBeyond20RefreshCombinedActions();
        });
        const choiceBounds=await choices.evaluate(cell=>{
            const box=cell.getBoundingClientRect();
            return Array.from(cell.querySelectorAll('button')).every(button=>{
                const b=button.getBoundingClientRect();
                return b.left>=box.left && b.right<=box.right+1;
            });
        });
        assert.equal(choiceBounds,true,'Die buttons wrap within Notes without overlapping another column');
        const rowPresentation = () => page.locator('[data-wb20-list-layout="row"]').evaluateAll(rows =>
            rows.map(row => {
                const style = getComputedStyle(row);
                return {border:style.borderBottomStyle, width:style.borderBottomWidth,
                    padding:style.paddingTop, height:row.getBoundingClientRect().height,
                    columns:Array.from(row.querySelectorAll('.ddbc-combat-attack__range,.ddbc-combat-attack__action,.ddbc-combat-attack__damage,.ddbc-combat-attack__notes'))
                        .filter(cell=>getComputedStyle(cell).display!=='none').map(cell=>cell.getBoundingClientRect().x)};
            }));
        const viewAs = async value => {
            await page.getByLabel('Talent list view',{exact:true}).click();
            await page.locator(`[data-view="${value}"]`).click();
            assert.equal(await page.locator('.wb20-action-view-control').getAttribute('open'),null);
        };
        const standardRows = await rowPresentation();
        assert.ok(standardRows.every(row=>row.border==='dotted' && row.width==='1px' && row.padding==='8px'),
            'Standard gives native and added talent rows identical separators and spacing');
        const orderBeforeView = await visualOrder();
        const usesBeforeView = await page.evaluate(()=>[activations,featureUses,hitDieChoices.length,nativeClicks]);
        await viewAs('compact');
        assert.equal(await page.evaluate(()=>saved['waybeyond20-action-list-view']),'compact','View uses character persistence');
        const compactRows = await rowPresentation();
        assert.ok(compactRows.every(row=>row.width==='0px' && row.padding==='2px'),'Compact removes all row separators and tightens spacing');
        assert.ok(compactRows.every((row,i)=>row.height<standardRows[i].height),'Compact is shorter without shrinking the text or buttons');
        assert.deepEqual(compactRows.map(row=>row.columns),standardRows.map(row=>row.columns),'View does not shift columns');
        assert.deepEqual(await visualOrder(),orderBeforeView,'View does not change ordering');
        assert.deepEqual(await page.evaluate(()=>[activations,featureUses,hitDieChoices.length,nativeClicks]),usesBeforeView,
            'Changing presentation never executes a talent');
        await page.evaluate(()=>wayBeyond20RefreshCombinedActions());
        assert.equal(await page.locator('[data-view="compact"]').getAttribute('aria-pressed'),'true','Refresh retains selection');
        await page.getByLabel('Talent list view',{exact:true}).click();
        await page.keyboard.press('Escape');
        assert.equal(await page.locator('.wb20-action-view-control').getAttribute('open'),null,'Escape dismisses View');
        await page.getByLabel('Talent list view',{exact:true}).click();
        await page.locator('.wb20-attacks-per-action').click();
        assert.equal(await page.locator('.wb20-action-view-control').getAttribute('open'),null,'Outside click dismisses View');
        await page.evaluate(()=>{
            const owner=character;
            character={mergeCharacterSettings:()=>{throw new Error('Stale view control wrote another character');}};
            document.querySelector('[data-view="standard"]').click();
            character=owner;
        });
        await viewAs('standard');
        assert.deepEqual(await rowPresentation(),standardRows,'Standard restores the full row presentation');
        await page.evaluate(()=>{saved['waybeyond20-action-list-view']='unexpected';wayBeyond20RefreshCombinedActions();});
        assert.equal(await page.locator('#actions').getAttribute('data-wb20-list-view'),'standard','Unknown preferences safely default to Standard');
        await viewAs('compact');
        if(process.env.WB20_ACTIONS_SCREENSHOT) await page.screenshot({path:process.env.WB20_ACTIONS_SCREENSHOT});
        // Sheet labels may override the row/body font, including after a theme change.
        await page.addStyleTag({content: '.ddbc-combat-attack__label {font-family: "Arial Narrow", monospace; font-size: 14px; font-weight: 400; line-height: 16px; letter-spacing: .2px;}'});
        await page.evaluate(()=>wayBeyond20RefreshCombinedActions());
        const typography = await page.evaluate(()=>{
            const properties=['fontFamily','fontSize','fontWeight','lineHeight','letterSpacing'];
            const read=e=>properties.map(key=>getComputedStyle(e)[key]);
            return {native:read(document.querySelector('.ddbc-combat-attack__label')),
                added:Array.from(document.querySelectorAll('.wb20-feature-option-name,.waybeyond20-bardic-feature-identity strong')).map(read)};
        });
        assert.ok(typography.added.every(value=>JSON.stringify(value)===JSON.stringify(typography.native)),
            'Feature and Inspiration labels use the native sheet typography');
        await sortBy('name');
        assert.deepEqual(await visualOrder(),['Bardic Damage','Bardic Inspiration','Blood and Bone','Protect Ally','Quick Step','Riposte','Sword']);
        await sortBy('damage');
        assert.deepEqual((await visualOrder()).slice(0,3),['Sword','Riposte','Bardic Damage']);
        const mutations = await page.evaluate(() => {
            const observer=new MutationObserver(()=>{});observer.observe(document.getElementById('actions'),{subtree:true,childList:true,attributes:true,characterData:true});
            for(let i=0;i<5;i++){wayBeyond20InjectBardicInspirationButton();wayBeyond20RefreshCombinedActions();}
            const records=observer.takeRecords().map(r=>({type:r.type,attribute:r.attributeName,tag:r.target.tagName,cls:r.target.className}));observer.disconnect();return records;
        });
        assert.deepEqual(mutations,[],'Repeated refresh must not churn DOM');
        await page.evaluate(()=>{saved['waybeyond20-combined-actions']=false;wayBeyond20RefreshCombinedActions();});
        assert.equal(await page.locator('[data-wb20-list-layout]').count(),0,'Disabled restores native layout');
        assert.equal(await page.locator('[data-wb20-list-view]').count(),0,'Opt-out removes view styling');
        assert.equal(await page.locator('.wb20-action-list-sort').count(),0);
        assert.equal(await page.locator('.wb20-feature-option').count(),0,'Opt-out removes shortcuts, not native details');
        assert.equal(await page.locator('.wb20-linked-feature').count(),0,'Opt-out removes merge annotation');
        await page.evaluate(()=>document.querySelectorAll('.ct-feature-snippet').forEach(el=>el.remove()));
        await page.evaluate(()=>{saved={};wayBeyond20RefreshCombinedActions();});
        assert.deepEqual(await visualOrder(), ['Sword','Bardic Damage','Bardic Inspiration','Riposte'],'New character uses default sort');
        assert.equal(await page.locator('#actions').getAttribute('data-wb20-list-view'),'standard','New character uses Standard view');
        // Native filter/rerender: remove/reinsert group, preserve original parent contract.
        await page.evaluate(()=>{document.querySelector('.styles_actionsList__test').remove();wayBeyond20RefreshCombinedActions();});
        assert.equal(await page.locator('.wb20-action-list-sort').count(),1);
        assert.deepEqual(await visualOrder(),['Bardic Inspiration','Riposte']);
        await page.setViewportSize({width:375,height:700});
        await page.evaluate(()=>document.getElementById('actions').style.width='100%');
        assert.equal(await page.locator('.wb20-inspire-icon').isVisible(),true);
        bounds=await geometry();
        assert.equal(bounds.overflow,false,'Legend wraps safely on phone-width panel');
        assert.ok(Math.abs(bounds.right-bounds.sortRight)<1);
        assert.equal(await page.locator('.wb20-attacks-per-action').isVisible(),false,'Missing native count is not invented');
        await page.evaluate(()=>{
            const root=document.getElementById('actions');
            root.innerHTML='<div class="styles_actionsList__test"><div>REACTIONS</div><div><div class="ct-feature-snippet"><div class="ct-feature-snippet__heading">Protect Ally</div></div></div></div>';
            wayBeyond20RefreshCombinedActions();
        });
        assert.equal(await page.locator('.wb20-action-fallback-header').count(),1,'Features-only list has columns');
        assert.deepEqual(await visualOrder(),['Protect Ally']);
        await page.evaluate(()=>{
            const snippet=document.querySelector('.ct-feature-snippet');
            snippet.firstElementChild.textContent='Bardic Inspiration: Agile Strikes';
            wayBeyond20RefreshCombinedActions();
        });
        assert.deepEqual(await visualOrder(),['Bardic Inspiration: Agile Strikes'],'Keep feature when corresponding attack is absent');
        await page.addScriptTag({path:path.join(root,'src/dndbeyond/content-scripts/quick-list.js')});
        await page.evaluate(()=>{
            wb20QuickSession().scanned=true;
            wb20QuickSession().spells=[{key:"test-spell",name:"Test Revival",source:"Cleric",level:3,cost:"extended",time:"1 minute",effect:"Revival",range:"Touch",hit:"—",notes:"V"}];
            saved["waybeyond20-quick-list"]=JSON.stringify({custom:[{id:"test",name:"Custom Dice",formula:"1d6+3",cost:"reaction"}]});
            document.querySelector(".wb20-action-list-sort").remove();
            wayBeyond20RefreshCombinedActions();
        });
        assert.equal(await page.getByRole('button',{name:'Manage quick list',exact:true}).count(),1);
        assert.equal(await page.locator('.wb20-extended-legend').count(),0,'Default-hidden categories do not clutter the legend');
        assert.equal(await page.locator('.wb20-quick-row').filter({hasText:'Spell: Resurrect'}).isVisible(),false);
        await page.evaluate(()=>{
            const entry=document.getElementById("actions")._wb20QuickEntries.find(e=>e.name==="Spell: Resurrect");
            wb20QuickSave({shown:[wb20QuickRowKey(entry)]});
        });
        assert.equal(await page.locator('.wb20-extended-legend').count(),1);
        assert.equal(await page.locator('.wb20-quick-row').filter({hasText:'Spell: Resurrect'}).isVisible(),true);
        await page.evaluate(()=>{
            const entry=document.getElementById("actions")._wb20QuickEntries.find(e=>e.name==="Custom Dice");
            wb20QuickSave({hidden:[wb20QuickRowKey(entry)]});
        });
        assert.equal(await page.locator('.wb20-quick-row').filter({hasText:'Custom Dice'}).isVisible(),false);
        await page.evaluate(()=>wb20QuickSave({hidden:[]}));
        assert.equal(await page.locator('.wb20-quick-row').filter({hasText:'Custom Dice'}).isVisible(),true);
        assert.equal(await page.evaluate(()=>{
            const observer=new MutationObserver(()=>{});
            observer.observe(document.getElementById("actions"),{subtree:true,childList:true,attributes:true,characterData:true});
            for(let i=0;i<5;i++)wayBeyond20RefreshCombinedActions();
            const n=observer.takeRecords().length;observer.disconnect();return n;
        }),0,"Quick rows do not create a mutation-observer loop");
        await page.evaluate(()=>{saved["waybeyond20-combined-actions"]=false;wayBeyond20RefreshCombinedActions();});
        assert.equal(await page.locator('.wb20-quick-row,[data-wb20-user-hidden]').count(),0,"Opt-out removes quick rows and all visibility overrides");
        console.log('PASS combined actions: native ownership, colored cost vs grouping, sorting, persistence hook, activation parity, disabled state, refresh idempotence, opt-out, rerender, narrow viewport');
    } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
