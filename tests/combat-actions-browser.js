const {chromium}=require(process.env.WB20_PLAYWRIGHT || 'playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const source=fs.readFileSync(path.join(root,'src/dndbeyond/content-scripts/character.js'),'utf8');
function unit(name) {
    const start=new RegExp(`^(?:async )?function ${name}\\(`,'m').exec(source);
    const tail=source.slice(start.index+start[0].length),end=/^(?:async )?function |^(?:const|let|var|class) /m.exec(tail);
    return source.slice(start.index,end?start.index+start[0].length+end.index:source.length);
}
(async()=>{
    const browser=await chromium.launch({channel:'chrome',headless:true});
    try {
        const page=await browser.newPage({viewport:{width:1100,height:700}});
        await page.setContent(`<body><div id="host" style="margin-top:300px;--wb20-sheet-surface:rgb(30,40,50);--wb20-sheet-ink:rgb(240,230,220);--wb20-sheet-accent:rgb(190,70,120)"></div><button id="outside">Outside</button><div class="ct-skills__item"><span class="ct-skills__col--skill">Perception</span></div><div class="ct-skill-pane"><span class="ct-skill-pane__header-name">Perception</span><span class="ct-skill-pane__header-ability">WIS</span><span class="ct-skill-pane__header-modifier">+5</span></div></body>`);
        await page.addScriptTag({path:path.join(root,'libs/jquery-3.4.1.min.js')});
        for(const file of ['src/dndbeyond/content-scripts/resources.js','src/dndbeyond/content-scripts/combat-actions.js']) await page.addScriptTag({path:path.join(root,file)});
        await page.addStyleTag({path:path.join(root,'src/extension/beyond20.css')});
        await page.addScriptTag({content:['rollSkillCheck','wayBeyond20CharacterSheetTab','wayBeyond20NormalizeFeatureLabel','applyAbilityOrSavingThrowEffects'].map(unit).join('\n')});
        await page.evaluate(()=>{
            window.state={inCombat:true,combatSource:'Manual',combatStartedAt:1,localTurnNumber:1,action:1,attacksRemaining:0};
            window.character={getGlobalSetting:(_,fallback)=>fallback,getSetting:(_,fallback)=>fallback,hasClassFeature:()=>false,hasRacialTrait:()=>false};
            window.wayBeyond20GetTurnTrackerState=()=>structuredClone(state);window.wayBeyond20SetTurnTrackerState=value=>Object.assign(state,value);
            window.wayBeyond20AttackActivationTurnKey=()=>String(state.localTurnNumber);window.wayBeyond20HasActiveCombatState=()=>state.inCombat;
            window.wayBeyond20GetCurrentDisplayedSpeed=()=>30;window.wayBeyond20ScheduleActiveEffectBadgeRefresh=()=>{};
            window.wayBeyond20AttacksPerAttackAction=()=>2;window.wayBeyond20CharacterDebug=()=>{};
            window.wayBeyond20GetTrackedSpellEffects=()=>[];window.addEffect=(args,name)=>{args.effects=[...(args.effects || []),name];};
            window.RollType={NORMAL:0,QUERY:1,OVERRIDE_ADVANTAGE:3,OVERRIDE_DISADVANTAGE:4};
            window.alertify={warning:message=>{throw Error(message);}};
            window.sent=[];window.sendRollWithCharacter=async(type,fallback,args)=>{sent.push({type,fallback,args});return true;};
            $('#host').append(wb20BuildCombatActionMenu('Action','action',1),wb20BuildCombatActionMenu('Haste Action','hasteAction',1));
        });
        const standard=page.locator('.wb20-action-menu').first(),toggle=standard.locator('>button');
        await toggle.hover();assert.equal(await standard.locator('.wb20-action-choices button').count(),11);
        assert.equal(await standard.locator('.wb20-action-choices').isVisible(),true);
        assert.equal(await standard.locator('.wb20-action-choices').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(30, 40, 50)');
        assert.equal(await standard.locator('.wb20-action-choices').evaluate(el=>getComputedStyle(el).color),'rgb(240, 230, 220)');
        await toggle.focus();await page.keyboard.press('ArrowDown');assert.equal(await page.locator(':focus').textContent(),'Attack');
        await page.keyboard.press('Escape');assert.equal(await toggle.getAttribute('aria-expanded'),'false');
        await toggle.click();assert.equal(await standard.locator('.wb20-action-choices').isVisible(),true,'click works after focus/hover');
        assert.equal(await page.locator('.wb20-action-menu').nth(1).locator('.wb20-action-choices button').count(),5);
        await page.evaluate(async()=>{
            const spells=document.createElement('button');spells.textContent='Spells';spells.setAttribute('role','radio');
            spells.onclick=()=>{window.openedSpells=true;};document.body.append(spells);
            await wb20TakeCombatAction('Magic');
        });
        assert.equal(await page.evaluate(()=>openedSpells),true,'Magic uses the real native-tab helper return type');
        assert.equal(await page.evaluate(()=>state.action),1);
        await page.evaluate(()=>{window.skillDone=wb20RollCombatSkill('Perception',{resource:'action',actionType:'Search',takeAction:true},'At the gate');});
        assert.equal(await page.evaluate(()=>skillDone),true);assert.equal(await page.evaluate(()=>sent[0].args.modifier),'+5');
        assert.equal(await page.evaluate(()=>sent[0].args['waybeyond20-turn-resource'].actionType),'Search');
        assert.equal(await page.evaluate(()=>sent[0].args.description),'Search action: At the gate');
        await page.evaluate(()=>rollSkillCheck('ct-skill-pane'));
        assert.equal(await page.evaluate(()=>sent[1].args['waybeyond20-turn-resource']),undefined,'ordinary skill use has no leftover Action charge');
        await page.evaluate(()=>{
            state.combatActionEffects={Dodge:{name:'Dodge',turnKey:'1'}};
            window.dex=applyAbilityOrSavingThrowEffects({rollType:'saving-throw',ability_name:'Dexterity',ability:'DEX',modifier:'+3'});
        });
        assert.equal(await page.evaluate(()=>sent.at(-1).args.advantage),3,'Dodge reaches the actual Dexterity-save preparation');
        await page.evaluate(()=>document.querySelector('#host').style.setProperty('--wb20-sheet-surface','rgb(250,245,230)'));
        assert.equal(await standard.locator('.wb20-action-choices').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(250, 245, 230)');
        console.log('PASS combat Action browser: 11 choices, 5 Haste choices, hover/click/keyboard/Escape, live theme inheritance, native skill roll preparation and no leaked action context. Isolated browser only.');
    } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
