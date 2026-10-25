// Real pointer gestures at the bottom of a long sheet, with a delayed refresh.
const {chromium}=require(process.env.WB20_PLAYWRIGHT || 'playwright');
const path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
(async()=>{
    const browser=await chromium.launch({channel:'chrome',headless:true});
    try {
        const page=await browser.newPage({viewport:{width:1200,height:700}});
        await page.setContent('<div style="height:1600px"></div><section class="waybeyond20-combat-section"></section>');
        await page.addScriptTag({path:path.join(root,'libs/jquery-3.4.1.min.js')});
        await page.addStyleTag({path:path.join(root,'src/extension/beyond20.css')});
        await page.addScriptTag({content:`
            var state, saved, refreshTimer, character={}, wb20QuickDamageTypes=['Radiant'];
            function wayBeyond20GetTurnTrackerState(){return state;}
            function wayBeyond20SetTurnTrackerState(s,cb){state=structuredClone(s);saved=structuredClone(s);if(cb)cb();}
            function wayBeyond20ScheduleActiveEffectBadgeRefresh(){
                clearTimeout(refreshTimer);refreshTimer=setTimeout(()=>wb20TargetMount($('section'),state),100);
            }
            function seed(){
                state={action:1,bonusAction:1,reaction:1,selectedTargetKey:'mob',knownTargets:[{tokenId:'mob',name:'Zombie',initiative:'13'}],
                    targetRecords:{mob:{observations:[{total:19,hit:true}],damage:[{amount:8,type:'Radiant'}]}}};
                saved=structuredClone(state);$('section').empty().removeAttr('data-target-signature');
                wb20TargetMount($('section'),state);$('details').prop('open',true);window.scrollTo(0,99999);
            }
        `});
        await page.addScriptTag({path:path.join(root,'src/dndbeyond/content-scripts/my-target.js')});
        // Also cover the gap BEFORE pointerdown: the pointer is already aimed
        // at the next control when the previous save's delayed paint arrives.
        for(const beforeDown of [true,false]) for(const damageFirst of [false,true]) {
            await page.evaluate(()=>seed());
            const first=damageFirst?'Undo damage':'Undo',second=damageFirst?'Undo':'Undo damage';
            await page.getByRole('button',{name:first,exact:true}).click();
            const box=await page.getByRole('button',{name:second,exact:true}).boundingBox();
            await page.mouse.move(box.x+box.width/2,box.y+box.height/2);
            if(beforeDown) await page.evaluate(()=>new Promise(resolve=>setTimeout(resolve,180)));
            await page.mouse.down();
            if(!beforeDown) assert.equal(await page.evaluate(()=>$('.wb20-my-target').data('pointerHeld')),true);
            // First save finishes while the second button is held. Removing a
            // history line can shrink the page and move the button under it.
            await page.evaluate(()=>new Promise(resolve=>setTimeout(resolve,180)));
            await page.mouse.up();
            await page.waitForFunction(()=>state.targetRecords.mob.observations.length===0 && state.targetRecords.mob.damage.length===0,{},{timeout:1500});
            assert.deepEqual(await page.evaluate(()=>saved.targetRecords.mob),{observations:[],damage:[]});
            assert.deepEqual(await page.evaluate(()=>[saved.action,saved.bonusAction,saved.reaction]),[1,1,1]);
            await page.evaluate(()=>{state=structuredClone(saved);$('section').empty();wb20TargetMount($('section'),state);});
            assert.equal(await page.locator('.wb20-target-ac').textContent(),'AC: ??');
            assert.equal(await page.locator('.wb20-target-damage-total').textContent(),'Damage: 0');
        }
        // Keyboard clicks do not rely on a pointer gesture, and still save both.
        await page.evaluate(()=>seed());
        await page.getByRole('button',{name:'Undo',exact:true}).press('Enter');
        await page.getByRole('button',{name:'Undo damage',exact:true}).press('Space');
        assert.deepEqual(await page.evaluate(()=>saved.targetRecords.mob),{observations:[],damage:[]});
        // Cancelling a pointer gesture releases the deferred render without
        // undoing anything or leaving the panel permanently paused.
        await page.evaluate(()=>seed());
        const cancelBox=await page.getByRole('button',{name:'Undo',exact:true}).boundingBox();
        await page.mouse.move(cancelBox.x+5,cancelBox.y+5);await page.mouse.down();
        await page.evaluate(()=>{
            state.knownTargets[0].initiative='14';wb20TargetMount($('section'),state);
            window.dispatchEvent(new PointerEvent('pointercancel'));
        });
        await page.mouse.move(1190,10);await page.mouse.up();
        await page.waitForFunction(()=>document.querySelector('.wb20-target-summary').textContent.includes('Initiative: 14'));
        assert.equal(await page.evaluate(()=>state.targetRecords.mob.observations.length),1);
        assert.equal(await page.evaluate(()=>$('.wb20-my-target').data('pointerHeld')),false);
        // DDB can replace markup without preserving JS handlers. A matching
        // signature on cloned markup must not make the panel permanently inert.
        await page.evaluate(()=>{
            seed();
            $('.wb20-target-attacks input').val('16');
            $('.wb20-target-history input').val('9');
            $('.wb20-target-history select').val('Radiant');
            const section=document.querySelector('section');
            section.replaceWith(section.cloneNode(true));
            // Native cloneNode resets option selection to its default. Model
            // the replacement markup's retained selection, then reconcile it.
            $('.wb20-target-history select').val('Radiant');
            wb20TargetMount($('section'),state);
            wb20TargetMount($('section'),state);
        });
        assert.deepEqual(await page.evaluate(()=>[
            $('.wb20-target-attacks input').val(),$('.wb20-target-history input').val(),
            $('.wb20-target-history select').val(),$('.wb20-target-history').prop('open')]),['16','9','Radiant',true]);
        await page.getByRole('button',{name:'Undo',exact:true}).click();
        assert.equal(await page.evaluate(()=>saved.targetRecords.mob.observations.length),0,
            'Undo still saves after a same-signature markup replacement');
        const idleRefreshes=await page.evaluate(async()=>{
            seed();
            state.currentRoll20Turn={tokenId:'mob',tokenName:'Zombie'};
            $('section').prepend(wb20BuildTurnCompass(state));
            wb20TargetMount($('section'),state);
            let refreshes=0;
            const observer=new MutationObserver(()=>{
                if (++refreshes>=12) {observer.disconnect();return;}
                setTimeout(()=>wb20TargetMount($('section'),state),5);
            });
            observer.observe(document.querySelector('section'),{subtree:true,childList:true,characterData:true});
            wb20TargetMount($('section'),state);
            await new Promise(resolve=>setTimeout(resolve,120));
            observer.disconnect();return refreshes;
        });
        assert.ok(idleRefreshes<=1,`Unchanged compass must settle; saw ${idleRefreshes} self-triggered refreshes`);
        console.log('PASS rapid AC/damage Undo, keyboard, cancellation, saved-state reload, cloned panel recovery and idle observer settling. Browser fixture only.');
    } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
