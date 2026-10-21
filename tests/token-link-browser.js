// Isolated rendered UI; does not connect to Roll20 or change a live character.
const {chromium}=require(process.env.WB20_PLAYWRIGHT || 'playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const source=fs.readFileSync(path.join(root,'src/dndbeyond/content-scripts/character.js'),'utf8');
function fn(name){
    const start=source.search(new RegExp('^(?:async )?function '+name+'\\(','m'));
    assert.ok(start>=0,name);
    const end=source.slice(start+1).search(/^(?:(?:async )?function |const |let |var |class )/m);
    return source.slice(start,end<0?undefined:start+1+end);
}
(async()=>{
    const browser=await chromium.launch({channel:'chrome',headless:true});
    try {
        const page=await browser.newPage();
        await page.setContent('<div class="beyond20-hotkeys-list"><ul></ul></div><div id="prompt"></div>');
        await page.addScriptTag({path:path.join(root,'libs/jquery-3.4.1.min.js')});
        await page.addScriptTag({content:`
            var state={inCombat:true,localTurnNumber:2,action:0,bonusAction:1,reaction:0,movement:15,
                currentRoll20Turn:{tokenId:'enemy',tokenName:'Zombie'},selectedTargetKey:'enemy',
                knownTargets:[{tokenId:'enemy',name:'Zombie',initiative:'13'},
                    {tokenId:'self',name:'Calan',initiative:'10.17'}]};
            var saved={'waybeyond20-roll20-token-id':'old','waybeyond20-roll20-token-ids':['old','other']};
            var writes=[],notices=[],refreshes=0;
            var character={_name:'Calan',getSetting:(key,fallback)=>saved[key]??fallback,
                mergeCharacterSettings(data,callback){writes.push(data);Object.assign(saved,data);callback();}};
            function wayBeyond20GetTurnTrackerState(){return state;}
            function wayBeyond20ScheduleActiveEffectBadgeRefresh(){refreshes++;}
            function wayBeyond20OpenCombatWindow(){throw Error('Must not change combat');}
            var alertify={message:text=>notices.push(text),warning:text=>notices.push(text)};
            var dndbeyondDiceRoller={_prompter:{prompt:(title,html,yes,no)=>new Promise(resolve=>{
                const host=document.getElementById('prompt');host.innerHTML='<h2>'+title+'</h2>'+html;
                for(const [text,ok] of [[yes,true],[no,false]]){
                    const button=document.createElement('button');button.textContent=text;
                    button.onclick=()=>{const result=ok?$(host.querySelector('form')):null;host.replaceChildren();resolve(result);};
                    host.append(button);
                }
            })}};
            ${fn('wayBeyond20ChooseRoll20Token')}
            ${fn('wayBeyond20InjectCombatMenuAction')}
            wayBeyond20InjectCombatMenuAction();wayBeyond20InjectCombatMenuAction();
        `});
        const link=page.getByRole('button',{name:'Link My Token',exact:true});
        assert.equal(await link.count(),1);
        const original=await page.evaluate(()=>JSON.stringify(state));
        await link.click();
        assert.equal(await page.getByLabel('My Roll20 token').inputValue(),'self','unique name preselected when old link is missing');
        await page.getByRole('button',{name:'Cancel',exact:true}).click();
        assert.equal(await page.evaluate(()=>writes.length),0);
        await link.press('Enter');
        await page.getByRole('button',{name:'Link token',exact:true}).click();
        assert.deepEqual(await page.evaluate(()=>saved),{'waybeyond20-roll20-token-id':'self','waybeyond20-roll20-token-ids':['self']});
        assert.equal(await page.evaluate(()=>JSON.stringify(state)),original);
        assert.equal(await page.evaluate(()=>refreshes),1);
        // Reopen with an exact persisted ID; duplicate names remain distinguishable.
        await page.evaluate(()=>state.knownTargets.push({tokenId:'self2',name:'Calan',initiative:'8'}));
        await link.click();
        assert.equal(await page.getByLabel('My Roll20 token').inputValue(),'self');
        assert.match(await page.getByLabel('My Roll20 token').textContent(),/Calan · Initiative 10.17 · self/);
        await page.getByLabel('My Roll20 token').selectOption('self2');
        await page.evaluate(()=>state.knownTargets=state.knownTargets.filter(t=>t.tokenId!=='self2'));
        await page.getByRole('button',{name:'Link token',exact:true}).click();
        assert.equal(await page.evaluate(()=>writes.length),1,'removed token is not linked');
        assert.match(await page.evaluate(()=>notices.at(-1)),/no longer in the turn order/);
        await link.click();
        await page.evaluate(()=>character={_name:'Different character'});
        await page.getByRole('button',{name:'Link token',exact:true}).click();
        assert.equal(await page.evaluate(()=>writes.length),1,'navigation does not bind the old character');
        await page.evaluate(()=>state.knownTargets=[]);
        await link.click();
        assert.match(await page.evaluate(()=>notices.at(-1)),/turn order first/);
        console.log('PASS token link: menu deduplication, keyboard, default and persisted ID, Cancel, exact single-token replacement, unchanged battle/counters/target, duplicates, removed-token and owner guards. Fixture only.');
    } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
