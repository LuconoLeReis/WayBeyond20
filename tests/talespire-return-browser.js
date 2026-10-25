// Isolated Chromium fixture only. Does not connect to the user's browser/game.
const {chromium}=require(process.env.WB20_PLAYWRIGHT || 'playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
(async()=>{
    const browser=await chromium.launch({channel:'chrome',headless:true});
    try {
        const page=await browser.newPage({viewport:{width:430,height:950}});
        await page.route('https://wb20.test/**',route=>route.fulfill({body:'<html></html>',contentType:'text/html'}));
        let posted=null,commands=[];
        await page.route('http://127.0.0.1:48874/**',route=>{
            const req=route.request(),url=new URL(req.url());
            if (req.method()==='OPTIONS') return route.fulfill({status:204,headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Authorization, Content-Type'}});
            if (url.pathname==='/state') posted=req.postDataJSON();
            const result=url.pathname==='/commands'?commands.splice(0):{ok:true};
            return route.fulfill({json:result,headers:{'Access-Control-Allow-Origin':'*'}});
        });
        await page.goto('https://wb20.test/');
        await page.setContent(fs.readFileSync(path.join(root,'companions/talespire/WayBeyond20/index.html'),'utf8'));
        await page.evaluate(()=>{
            window.wb20LocalReturnKey='a'.repeat(64);
            window.TS={boards:{whereAmI:async()=>({id:'board'})},campaigns:{whereAmI:async()=>({id:'campaign'})},
                initiative:{getQueue:async()=>({items:[{id:'calan',name:'Calan',kind:'creature'},{id:'secret',name:'Hidden',kind:'creature'}],activeItemIndex:0})},
                players:{whoAmI:async()=>({id:'player'})},creatures:{getSelectedCreatures:async()=>[],getCreaturesOwnedByPlayer:async()=>[{id:'calan'}],
                    getMoreInfo:async()=>[{id:'calan',name:'Calan',boardId:'board',position:{x:0,y:0,z:0,locId:0}},{id:'secret',name:'Hidden',boardId:'board',isExplicitlyHidden:true,position:{x:1,y:1,z:0,locId:0}}]},
                units:{getDistanceUnitsForThisCampaign:async()=>({name:'ft',numberPerTile:5})},picking:{startPicking:async()=> 'pick-1'}};
        });
        await page.addScriptTag({path:path.join(root,'companions/talespire/WayBeyond20/bridge.js')});
        await page.addScriptTag({path:path.join(root,'companions/talespire/WayBeyond20/return-feed.js')});
        await page.evaluate(()=>wb20ReturnState({kind:'hasInitialized'}));
        await page.getByText('Connected · 1 minis · turn following paused',{exact:true}).waitFor();
        assert.equal(posted.creatures.length,1,'hidden mini stripped'); assert.equal(posted.order.length,1); assert.equal(posted.tracking,false);
        await page.getByRole('checkbox',{name:'Follow this board’s turn order'}).check();
        await page.getByText('Connected · 1 minis · following turns',{exact:true}).waitFor();
        assert.equal(posted.tracking,true);
        await page.getByRole('button',{name:'Choose target on board'}).click();
        await page.getByText('Click a mini on the board to choose your target. Escape cancels.',{exact:true}).waitFor();
        await page.evaluate(()=>wb20ReturnPicked({kind:'pickingCompleted',payload:{id:'wrong',kindOfPicked:'creature',idOfPicked:'secret'}}));
        assert.equal(await page.evaluate(()=>wb20ReturnTarget),'','wrong picking session ignored');
        await page.evaluate(()=>wb20ReturnPicked({kind:'pickingCompleted',payload:{id:'pick-1',kindOfPicked:'creature',idOfPicked:'calan'}}));
        await page.getByText('Connected · 1 minis · following turns',{exact:true}).waitFor();
        assert.equal(await page.evaluate(()=>wb20ReturnTarget),'calan');
        assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
        // Real DDB control construction in a fixture: linking saves only the
        // chosen ID; repeated position updates do not replace input nodes.
        await page.setContent('<div class="ct-character-header-desktop"></div><section class="waybeyond20-combat-section"></section>');
        await page.addScriptTag({path:path.join(root,'libs/jquery-3.4.1.min.js')});
        await page.evaluate(()=>{
            window.settings={'vtt-tab':{vtt:'talespire'}}; window.values={};
            window.character={getSetting:(key,fallback)=>values[key]??fallback,mergeCharacterSettings:(next,callback)=>{Object.assign(values,next);callback?.();}};
            window.wayBeyond20NormalizeTurnTrackerState=(state)=>({...{action:1,bonusAction:1,reaction:1},...state});
            window.wayBeyond20GetTrackedSpellEffects=()=>[]; window.wayBeyond20ScheduleActiveEffectBadgeRefresh=()=>{};
            window.wayBeyond20TurnTrackerStateEquals=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
            window.wayBeyond20IsMainCharacterSheet=()=>true;
            window.wayBeyond20Prompt=async(title,html)=>{document.body.insertAdjacentHTML('beforeend',html);return null;};
            window.warnings=[];window.alertify={warning:message=>warnings.push(message)};
            window.chrome={runtime:{lastError:null,sendMessage:(_request,callback)=>callback({connected:false,ok:false})}};
        });
        await page.addScriptTag({path:path.join(root,'src/dndbeyond/content-scripts/talespire.js')});
        await page.evaluate(async()=>{wb20TSConnected=false;wb20TSRenderStatus();await wb20TSLinkMini();await wb20TSRefresh();});
        await page.getByText('TaleSpire: not connected',{exact:true}).waitFor();
        assert.equal(await page.getByRole('button',{name:'Link mini',exact:true}).isDisabled(),true);
        assert.equal(await page.getByRole('button',{name:'Pick target in TaleSpire',exact:true}).isDisabled(),true);
        assert.equal(await page.evaluate(()=>warnings.length),0,'offline polling/linking never nags');
        await page.evaluate(()=>{wb20TSConnected=true;wb20TSRenderStatus();});
        await page.getByRole('button',{name:'Pick target in TaleSpire',exact:true}).click();
        await page.getByText('TaleSpire: not connected',{exact:true}).waitFor();
        assert.equal(await page.evaluate(()=>warnings.length),0,'disconnect during target picking is quiet');
        await page.evaluate(()=>{wb20TSConnected=true;wb20TSFeed={v:1,campaignId:'campaign',boardId:'board',creatures:[{id:'calan',name:'Calan'}]};wb20TSContext='campaign|board';wb20TSRenderStatus();});
        await page.getByRole('button',{name:'Link mini',exact:true}).click();
        await page.getByRole('combobox',{name:'TaleSpire character mini'}).waitFor();
        assert.equal(await page.getByRole('combobox').locator('option').count(),2);
        assert.equal(await page.evaluate(()=>Object.keys(values).length),0,'opening link chooser does not write');
        console.log('PASS isolated TaleSpire return UI: paused default, hidden filtering, native picker identity, target handling, narrow layout and DDB mini chooser. Mock game only.');
    } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
