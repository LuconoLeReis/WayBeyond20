// Isolated Chromium fixture, not a live D&D Beyond character. No player state or network writes.
// Supply WB20_PLAYWRIGHT when Playwright is provided by the host rather than this repo.
const { chromium } = require(process.env.WB20_PLAYWRIGHT || "playwright");
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const root = path.resolve(__dirname, "..");
(async () => {
    const browser = await chromium.launch({channel: "chrome", headless: true});
    try {
        const page = await browser.newPage({viewport:{width:1200,height:800}});
        await page.route('https://wb20-portent.test/**',route=>route.fulfill({body:'<html></html>',contentType:'text/html'}));
        await page.goto('https://wb20-portent.test/');
        const errors=[];page.on("pageerror",error=>errors.push(error.message));
        await page.setContent(`<html><head></head><body><main style="margin:24px">
            <div class="ct-character-header-desktop" style="height:100px;display:flex;align-items:center">
            <div class="ct-character-header-desktop__group-tidbits" style="min-width:0">
            <div class="ddbc-character-tidbits"><div class="ddbc-character-tidbits__heading"><h1 style="margin:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:24px;line-height:34px">Wizard - isolated Portent fixture</h1></div>
            <div style="height:17px">Wizard 3</div><div style="height:14px">Level 3</div></div></div></div>
            <div class="ddbc-ability-summary"><div class="ddbc-ability-summary__primary">16</div></div>
            <div class="ddbc-defenses-summary__heading">DEFENSES</div>
            <section class="waybeyond20-combat-section">Combat fixture</section>
            <p>This page is test scaffolding, not a live character sheet.</p></main></body></html>`);
        for(const file of ["libs/css/alertify.css","src/extension/beyond20.css"])
            await page.addStyleTag({path:path.join(root,file)});
        await page.addStyleTag({content:`body {background:#eee;color:#242527;font:16px Arial} .ddbc-ability-summary {background:#fff;border:2px solid #a7222b;border-radius:8px;color:#242527;width:80px} .ddbc-ability-summary__primary{font:28px Georgia} .ddbc-defenses-summary__heading{font:bold 12px Arial}`});
        const headerBaseline=await page.locator('.ct-character-header-desktop').boundingBox();
        const nameBaseline=await page.locator('.ddbc-character-tidbits__heading').boundingBox();
        for(const file of ["libs/jquery-3.4.1.min.js","libs/alertify.min.js","src/common/utils.js","src/dndbeyond/content-scripts/portent.js"])
            await page.addScriptTag({path:path.join(root,file)});
        const characterSource=fs.readFileSync(path.join(root,"src/dndbeyond/content-scripts/character.js"),"utf8");
        const musician=characterSource.slice(characterSource.indexOf("function wayBeyond20ShowMusicianRestReminder("),characterSource.indexOf("// A rest is a span"));
        await page.addScriptTag({content:musician});
        await page.evaluate(()=>{
            window.RollType={NORMAL:0};
            window.values={"waybeyond20-portent":{dice:[{id:"a",value:17,used:false},{id:"b",value:3,used:false}],selected:null}};
            window.character={_id:"fixture",hasClassFeature:name=>name==="Portent",getSetting:(key,fallback)=>values[key]??fallback,
                mergeCharacterSettings:(update,cb)=>{Object.assign(values,structuredClone(update));cb?.();}};
            window.wayBeyond20IsMainCharacterSheet=()=>true;
            window.wayBeyond20ScheduleActiveEffectBadgeRefresh=()=>wayBeyond20InjectPortent();
            window.wayBeyond20GetTurnTrackerState=()=>({inCombat:false});
            window.addEffect=(req,effect)=>(req.effects||=[]).push(effect);
            initializeAlertify();
            window.dndbeyondDiceRoller={_prompter:{prompt:wayBeyond20Prompt}};
            window.dispatches=[];
            window.nameClicks=0;
            document.querySelector('.ddbc-character-tidbits__heading').addEventListener('click',()=>window.nameClicks++);
            window.startTestRoll=()=>{
                const req={type:"saving-throw",name:"Wisdom saving throw",modifier:"+4",character:{settings:{}}};
                window.outcome=null;
                window.pending=wayBeyond20PortentDispatch(character,req,async()=>{dispatches.push(req);return true;}).then(result=>window.outcome=result);
            };
            wayBeyond20InjectPortent();
            wayBeyond20ApplySheetTheme(document.querySelector('.waybeyond20-combat-section'));
        });
        const seventeen=page.getByRole("button",{name:"Portent 17",exact:true});
        await seventeen.click();
        await page.waitForFunction(()=>document.querySelector('[aria-pressed="true"]'));
        await seventeen.click();
        await page.waitForFunction(()=>!document.querySelector('[aria-pressed="true"]'));
        await seventeen.click();
        await page.waitForFunction(()=>document.querySelector('[aria-pressed="true"]'));
        await page.evaluate(()=>{startTestRoll();});
        await page.getByRole("button",{name:"No, roll normally",exact:true}).click();
        await page.waitForFunction(()=>outcome===true);
        assert.equal(await page.evaluate(()=>values['waybeyond20-portent'].dice[0].used),false);
        assert.equal(await page.evaluate(()=>dispatches[0]['waybeyond20-portent-value']),undefined);
        await seventeen.click();
        await page.waitForFunction(()=>document.querySelector('[aria-pressed="true"]'));
        await page.evaluate(()=>{startTestRoll();});
        await page.getByRole("button",{name:"Cancel",exact:true}).click();
        await page.waitForFunction(()=>outcome===false);
        assert.equal(await page.evaluate(()=>values['waybeyond20-portent'].selected),"a");
        await page.evaluate(()=>{startTestRoll();});
        await page.getByLabel("Automatically proceed in the future without this warning.").check();
        await page.getByRole("button",{name:"Yes",exact:true}).click();
        await page.waitForFunction(()=>outcome===true);
        assert.equal(await page.evaluate(()=>values['waybeyond20-portent'].dice[0].used),true);
        assert.equal(await page.evaluate(()=>values['portent-auto-proceed']),true);
        assert.equal(await page.getByRole("button",{name:"Portent 17, spent",exact:true}).isDisabled(),true);
        await page.getByRole("button",{name:"Portent Settings",exact:true}).click();
        await page.getByLabel("Portent Prompts",{exact:true}).check();
        await page.getByLabel("Attack roll total threshold",{exact:true}).fill("19");
        await page.getByLabel("Automatically proceed with a manually selected die without a warning").uncheck();
        await page.getByRole("button",{name:"Save",exact:true}).click();
        await page.waitForFunction(()=>values['portent-threshold-attack']==='19');
        await page.locator('.alertify:not(.ajs-hidden)').waitFor({state:'hidden'});
        assert.equal(await page.evaluate(()=>values['portent-auto-proceed']),false);
        assert.equal(await page.evaluate(()=>window.nameClicks),0,"Portent controls must not open the native character sidebar");
        await page.evaluate(()=>{values['waybeyond20-portent']={dice:[],selected:null};wayBeyond20InjectPortent();});
        await page.getByRole("button",{name:"Set today's dice",exact:true}).click();
        await page.getByRole("button",{name:"Cancel",exact:true}).click();
        await page.locator('.alertify:not(.ajs-hidden)').waitFor({state:'hidden'});
        assert.equal(await page.evaluate(()=>window.nameClicks),0,"First-use setup must not open the native character sidebar");
        assert.equal(await page.evaluate(()=>values['waybeyond20-portent'].dice.length),0);
        const light=await page.evaluate(()=>getComputedStyle(document.querySelector('.waybeyond20-portent')).backgroundColor);
        assert.equal(light,"rgb(255, 255, 255)");
        await page.addStyleTag({content:'.ddbc-ability-summary{background:#252629;color:#f2f3f5;border-color:#73bde4} body{background:#18191b;color:#f2f3f5}'});
        await page.evaluate(()=>{wayBeyond20InjectPortent();wayBeyond20ApplySheetTheme(document.querySelector('.waybeyond20-combat-section'));});
        assert.equal(await page.evaluate(()=>getComputedStyle(document.querySelector('.waybeyond20-portent')).backgroundColor),"rgb(37, 38, 41)");
        assert.equal(await page.evaluate(()=>getComputedStyle(document.querySelector('.waybeyond20-combat-section')).borderColor),"rgb(115, 189, 228)");
        for(const width of [1200,375]) {
            await page.setViewportSize({width,height:800});
            const header=await page.locator('.ct-character-header-desktop').boundingBox();
            const name=await page.locator('.ddbc-character-tidbits__heading').boundingBox();
            const panel=await page.locator('.waybeyond20-portent').boundingBox();
            assert.equal(header.height,headerBaseline.height,"Native header height must not change");
            assert.equal(name.y,nameBaseline.y,"Native name must not move up or down");
            assert.equal(name.height,nameBaseline.height,"Native heading must not wrap");
            assert.ok(panel.y>=header.y && panel.y+panel.height<=header.y+header.height,"Panel must stay inside header");
            assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
            if(process.env.WB20_SCREENSHOTS) {
                fs.mkdirSync(process.env.WB20_SCREENSHOTS,{recursive:true});
                await page.screenshot({path:path.join(process.env.WB20_SCREENSHOTS,`portent-fixture-${width}.png`),fullPage:true,animations:"disabled"});
            }
        }
        await page.evaluate(()=>{
            document.querySelector('.ddbc-ability-summary').insertAdjacentHTML('afterbegin','<div class="ddbc-box-background"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 60"><path fill="#FEFEFE" d="M0 0H100V60H0Z"/><path fill="#C53131" d="M0 0H100V3H0Z"/></svg></div>');
            wayBeyond20InjectPortent();
            wayBeyond20ApplySheetTheme(document.querySelector('.waybeyond20-combat-section'));
        });
        for (const selector of ['.waybeyond20-portent','.waybeyond20-combat-section']) {
            assert.match(await page.locator(selector).evaluate(el=>el.style.backgroundImage),/data:image\/svg\+xml/);
            assert.equal(await page.locator(selector).evaluate(el=>el.style.borderColor),'transparent');
        }
        await page.locator('.waybeyond20-combat-section').evaluate(el=>{
            el.innerHTML='<div class="waybeyond20-combat-header"><span class="waybeyond20-combat-title">Combat</span><span>Roll20: Current player</span></div><div><button>Movement: 30 ft.</button> <button>Action: 1</button></div><div style="text-align:right"><button>New Turn</button> <button>End Combat</button></div>';
        });
        for (const width of [1400,375]) {
            await page.setViewportSize({width,height:800});
            const inset=await page.locator('.waybeyond20-combat-section').evaluate(el=>{
                const box=el.getBoundingClientRect(), style=getComputedStyle(el);
                return {left:parseFloat(style.paddingLeft),right:parseFloat(style.paddingRight),top:parseFloat(style.paddingTop),bottom:parseFloat(style.paddingBottom),width:box.width,
                    contained:[...el.querySelectorAll('button,.waybeyond20-combat-title')].every(child=>{const r=child.getBoundingClientRect();return r.left>=box.left+24 && r.right<=box.right-24 && r.top>=box.top+20 && r.bottom<=box.bottom-20;})};
            });
            assert.ok(inset.left>=Math.max(24,inset.width*.04) && inset.right>=24,'Decorative frame needs a proportional horizontal safety inset');
            assert.ok(inset.contained,'Combat title and controls must stay inside the frame-safe content area');
        }
        await page.setViewportSize({width:1400,height:800});
        await page.evaluate(()=>{
            const header=document.querySelector('.ct-character-header-desktop');
            header.style.cssText='width:1200px;height:100px;padding:10px 10px 15px;box-sizing:border-box';
            document.querySelector('h1').textContent='Windwhistle "Wiz" Stormcastle';
            for(const [suffix,width,label] of [['beyond20',90,'WB20'],['share',106,'Share'],['short-rest',137,'Short Rest'],['long-rest',130,'Long Rest'],['builder',40,'Builder']]) {
                const item=document.createElement('div');item.className='ct-character-header-desktop__group--'+suffix;
                item.style.cssText='width:'+width+'px;height:30px';item.textContent=label;header.append(item);
            }
            const campaign=document.createElement('div');campaign.className='styles_container__fixture';
            campaign.style.cssText='width:260px;height:30px';campaign.textContent='Campaign: Example Adventure';header.append(campaign);
        });
        assert.equal(await page.locator('h1').evaluate(el=>el.scrollWidth<=el.clientWidth),true,'Full name must fit beside the complete editable-sheet toolbar');
        const desktopHeader=await page.locator('.ct-character-header-desktop').boundingBox();
        for(const selector of ['.ddbc-character-tidbits__heading','.waybeyond20-portent']) {
            const bounds=await page.locator(selector).boundingBox();
            assert.ok(bounds.y>=desktopHeader.y && bounds.y+bounds.height<=desktopHeader.y+desktopHeader.height);
        }
        if(process.env.WB20_SCREENSHOTS) await page.screenshot({path:path.join(process.env.WB20_SCREENSHOTS,'portent-editable-header-dev3.png'),animations:'disabled'});
        await page.evaluate(()=>{
            window.wayBeyond20CharacterHelperEnabled=()=>true;
            character.hasFeat=()=>true;
            window.musicianClosed=false;
            wayBeyond20ShowMusicianRestReminder("long").then(()=>window.musicianClosed=true);
        });
        await page.getByRole("button",{name:"Done",exact:true}).waitFor({state:"visible"});
        assert.equal(await page.evaluate(()=>window.musicianClosed),false);
        assert.equal(await page.locator('.alertify:not(.ajs-hidden)').count(),1);
        await page.getByRole("button",{name:"Done",exact:true}).click();
        await page.waitForFunction(()=>window.musicianClosed);
        await page.locator('.alertify:not(.ajs-hidden)').waitFor({state:'hidden'});
        await page.evaluate(()=>{
            window.wayBeyond20CharacterHelperEnabled=()=>false;
            wayBeyond20ShowMusicianRestReminder("short");
        });
        assert.equal(await page.locator('.alertify:not(.ajs-hidden)').count(),0);
        await page.evaluate(()=>window.beforeReroll=JSON.stringify(values['waybeyond20-portent']));
        await page.locator('.waybeyond20-portent').getByRole('button',{name:'Reroll Portent',exact:true}).click();
        await page.getByRole('button',{name:'Cancel',exact:true}).click();
        assert.equal(await page.evaluate(()=>JSON.stringify(values['waybeyond20-portent'])),await page.evaluate(()=>beforeReroll));
        await page.locator('.waybeyond20-portent').getByRole('button',{name:'Reroll Portent',exact:true}).click();
        await page.locator('.alertify:not(.ajs-hidden)').getByRole('button',{name:'Reroll Portent',exact:true}).click();
        await page.waitForFunction(()=>JSON.stringify(values['waybeyond20-portent']) !== beforeReroll);
        assert.equal(await page.evaluate(()=>values['waybeyond20-portent'].dice.every(die=>!die.used)),true);
        assert.equal(await page.evaluate(()=>values['waybeyond20-portent'].selected),null);
        assert.deepEqual(errors,[]);
        console.log("PASS Chromium fixture: select/deselect, No, Cancel, Yes, one spend, settings, native theme light/dark and narrow layout. Real jQuery and Alertify. Not live DDB acceptance.");
    } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
