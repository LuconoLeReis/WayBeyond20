// Native-shaped isolated header. Does not connect to or rest a real character.
const {chromium}=require(process.env.WB20_PLAYWRIGHT || "playwright");
const path=require("node:path"),assert=require("node:assert/strict");
const root=path.resolve(__dirname,"..");
const group=(name,text)=>`<div class="ct-character-header-desktop__group ct-character-header-desktop__group--${name}"><div class="ct-character-header-desktop__button" role="button" tabindex="0"><span class="ct-character-header-desktop__button-label">${text}</span></div></div>`;
const html=`<div class="ct-character-header-desktop">
<div class="ct-character-header-desktop__group-tidbits"><div class="ddbc-character-tidbits"><div class="name">Dr. Rhonen</div><div class="ddbc-character-tidbits__menu-callout"><button>Manage</button></div><div>M Elf Monk 3</div><small>Level 3</small></div></div>
<div class="ct-character-header-desktop__group--gap"></div>
<div class="ct-character-header-desktop__group--beyond20-hotkeys"></div>
<div class="ct-character-header-desktop__group--beyond20"><div class="ct-character-header-desktop__button ct-beyond20-settings-button">WB20</div></div>
${group("share","Share")}${group("short-rest","Short Rest")}${group("long-rest","Long Rest")}
<div class="native-campaign"><div data-testid="campaign-summary"><span>Campaign:</span><span>Chult After Hours</span></div><span><a href="/games/8097217" aria-label="Launch Game"><div class="styles_campaignButtonGroup__fixture"><div class="styles_campaignButton__fixture"><svg aria-hidden="true"><path fill="white" d="M0 0H10V10H0Z"/></svg></div></div></a></span><div><span><div role="button" aria-roledescription="Game Log" class="styles_campaignButtonGroup__fixture"><div class="styles_campaignButton__fixture"><svg aria-hidden="true"><path fill="white" d="M0 0H10V10H0Z"/></svg></div></div></span></div></div>
<div class="ct-character-header-desktop__group--builder"><a href="#builder" aria-label="Go to builder"><svg aria-hidden="true"><path fill="white" d="M0 0H10V10H0Z"/></svg></a></div>
<div class="wb20-ts-status"><span class="wb20-ts-label">TaleSpire: return helper disconnected</span><button>Link mini</button><button>Pick target in TaleSpire</button></div>
</div><button id="outside">Outside header</button><div class="ct-saving-throws-box" style="color:rgb(32,40,48);background:rgb(244,240,224);border:1px solid rgb(40,100,80)"><div class="ddbc-box-background"><svg viewBox="0 0 100 100"><rect width="100" height="100" fill="rgb(244,240,224)"/><path d="M0 0H100V3H0Z" fill="rgb(40,100,80)"/></svg></div></div>`;
(async()=>{
    const browser=await chromium.launch({channel:"chrome",headless:true});
    try {
        const page=await browser.newPage({viewport:{width:1440,height:700}});
        await page.route("https://wb20.test/**",route=>route.fulfill({body:"<html></html>",contentType:"text/html"}));
        await page.goto("https://wb20.test/characters/123456789"); await page.setContent(html);
        await page.addStyleTag({content:"body{margin:0;background:#252525;color:#fff;font:12px Arial}.ct-character-header-desktop{box-sizing:border-box;margin:auto;max-width:1200px;height:100px}.ct-character-header-desktop__button{border:1px solid #4f7e61}.name{font-size:20px}.wb20-ts-status button{font-size:10px}"});
        await page.addStyleTag({path:path.join(root,"src/extension/beyond20.css")});
        await page.evaluate(()=>{
            window.nativeClicks={manage:0,wb20:0,share:0,short:0,long:0,log:0};
            window.corrections=0;window.wb20CorrectResources=async()=>{corrections++;};
            window.headerLinks=[];
            for(const label of ['Launch Game','Go to builder']) {
                document.querySelector(`a[aria-label="${label}"]`).addEventListener('click',event=>{
                    event.preventDefault();headerLinks.push([label,event.currentTarget.getAttribute('href')]);
                });
            }
            const watch=(selector,key)=>document.querySelector(selector).addEventListener("click",()=>nativeClicks[key]++);
            watch(".ddbc-character-tidbits__menu-callout button","manage");watch(".ct-beyond20-settings-button","wb20");
            watch(".ct-character-header-desktop__group--share > div","share");watch(".ct-character-header-desktop__group--short-rest > div","short");watch(".ct-character-header-desktop__group--long-rest > div","long");watch('[aria-roledescription="Game Log"]',"log");
            window.originalParents=Array.from(document.querySelectorAll(".ct-character-header-desktop > *")).map(node=>[node,node.parentElement]);
        });
        await page.addScriptTag({path:path.join(root,"src/dndbeyond/content-scripts/portent.js")});
        await page.addScriptTag({path:path.join(root,"src/dndbeyond/content-scripts/header.js")});
        await page.evaluate(()=>{wb20RefreshCompactHeader();for(let i=0;i<5;i++)wb20RefreshCompactHeader();});
        assert.equal(await page.locator(".wb20-header-manage").count(),1);
        assert.equal(await page.locator(".wb20-header-rest").count(),1);
        await page.getByRole('button',{name:'Correction',exact:true}).click();assert.equal(await page.evaluate(()=>corrections),1);
        const icons=await page.evaluate(()=>[...document.querySelectorAll('[data-wb20-header-role="campaign"] svg,.ct-character-header-desktop__group--builder svg')].map(el=>({center:el.getBoundingClientRect().y+el.getBoundingClientRect().height/2,fill:getComputedStyle(el.querySelector('path')).fill})));
        assert.ok(Math.max(...icons.map(x=>x.center))-Math.min(...icons.map(x=>x.center))<=1,'all three icons vertically centered');
        assert.ok(icons.every(x=>x.fill==='rgb(40, 100, 80)'),'native white paths follow selected sheet accent');
        assert.equal(await page.locator(".wb20-header-caption").count(),0,"icons have no added visible captions");
        const colors=()=>page.locator(".wb20-header-rest-menu").evaluate(el=>({ink:getComputedStyle(el).color,surface:getComputedStyle(el).backgroundColor}));
        assert.deepEqual(await colors(),{ink:"rgb(32, 40, 48)",surface:"rgb(244, 240, 224)"});
        await page.evaluate(()=>{const native=document.querySelector('.ct-saving-throws-box');native.style.color='rgb(240, 235, 230)';native.querySelector('rect').setAttribute('fill','rgb(30, 35, 45)');native.querySelector('path').setAttribute('fill','rgb(180, 130, 70)');});
        await page.waitForFunction(()=>getComputedStyle(document.querySelector('.wb20-header-rest-menu')).backgroundColor==='rgb(30, 35, 45)');
        assert.deepEqual(await colors(),{ink:"rgb(240, 235, 230)",surface:"rgb(30, 35, 45)"},"theme changes refresh foreground and opaque menu surface");
        assert.equal(await page.locator('.wb20-header-manage').evaluate(el=>getComputedStyle(el).backgroundImage.includes('data:image/svg+xml')),true,"native sheet frame reused");
        assert.equal(await page.locator('[data-testid="campaign-summary"] > span:last-child').evaluate(el=>getComputedStyle(el).borderBottomWidth),'1px');
        assert.equal(await page.evaluate(()=>originalParents.every(([node,parent])=>node.parentElement===parent)),true,"native nodes never reparented");
        await page.getByRole("button",{name:"Manage",exact:true}).click();
        await page.getByRole("button",{name:"WB20",exact:true}).press("Enter");
        await page.getByRole("button",{name:"Share",exact:true}).click();
        await page.getByRole("button",{name:"Game Log",exact:true}).press("Space");
        assert.deepEqual(await page.evaluate(()=>nativeClicks),{manage:1,wb20:1,share:1,short:0,long:0,log:1});
        await page.getByRole('link',{name:'Launch Game',exact:true}).click();
        await page.getByRole('link',{name:'Go to builder',exact:true}).click();
        assert.deepEqual(await page.evaluate(()=>headerLinks),[['Launch Game','/games/8097217'],['Go to builder','#builder']],
            'compact layout preserves native Maps and builder link activation');
        // Native sidebar opens from its own control, then dismisses on an
        // outside click. Forwarding Manage inside the proxy's same click used
        // to open it and immediately close it when the outer click bubbled.
        await page.evaluate(()=>{
            document.querySelector('.ddbc-character-tidbits__menu-callout button').addEventListener('click',()=>{
                document.querySelector('#native-manage-pane')?.remove();
                const pane=document.createElement('aside');pane.id='native-manage-pane';pane.textContent='Manage character';document.body.append(pane);
            });
            document.addEventListener('click',event=>{
                if(!event.target.closest('.ddbc-character-tidbits__menu-callout')) document.querySelector('#native-manage-pane')?.remove();
            });
        });
        await page.getByRole('button',{name:'Manage',exact:true}).click();
        await page.waitForFunction(()=>document.querySelector('#native-manage-pane'),{},{timeout:1000});
        await page.getByRole('button',{name:'Outside header',exact:true}).click();
        const rest=page.getByRole("button",{name:"Rest",exact:true});
        await rest.click();assert.equal(await rest.getAttribute("aria-expanded"),"true");
        assert.equal(await page.evaluate(()=>nativeClicks.short+nativeClicks.long),0,"opening Rest does not take/open a rest");
        await page.getByRole("menuitem",{name:"Short Rest",exact:true}).click();
        await page.waitForFunction(()=>nativeClicks.short===1);
        await rest.click();await page.getByRole("menuitem",{name:"Long Rest",exact:true}).click();
        await page.waitForFunction(()=>nativeClicks.long===1);
        await rest.click();await page.keyboard.press("Escape");
        assert.equal(await rest.getAttribute("aria-expanded"),"false");assert.equal(await rest.evaluate(el=>el===document.activeElement),true);
        await rest.click();await page.getByRole("button",{name:"Outside header"}).click();
        assert.equal(await rest.getAttribute("aria-expanded"),"false");
        for(const width of [1200,1280,1440,1920]) {
            await page.setViewportSize({width,height:700});
            const boxes=await page.evaluate(()=>{
                const rect=selector=>{const r=document.querySelector(selector).getBoundingClientRect();return{x:r.x,y:r.y,w:r.width,h:r.height,right:r.right,bottom:r.bottom};};
                return {header:rect(".ct-character-header-desktop"),manage:rect(".wb20-header-manage"),wb20:rect(".ct-character-header-desktop__group--beyond20"),share:rect(".ct-character-header-desktop__group--share"),campaign:rect('[data-wb20-header-role="campaign"]'),ts:rect(".wb20-ts-status"),scroll:document.documentElement.scrollWidth};
            });
            assert.equal(boxes.header.h,100);assert.equal(boxes.manage.x,boxes.wb20.x);assert.equal(boxes.share.x,boxes.wb20.x);
            assert.equal(boxes.share.bottom-boxes.manage.y,boxes.campaign.h,"panels match height");
            assert.ok(boxes.campaign.right<=boxes.ts.x,"campaign leaves a dedicated status column");assert.ok(boxes.ts.right<=boxes.header.right+1);
            assert.ok(boxes.scroll<=width,"header does not widen viewport");
        }
        await page.evaluate(()=>{window.statusFixture=document.querySelector('.wb20-ts-status');statusFixture.remove();});
        const aligned=await page.evaluate(()=>{const header=document.querySelector('.ct-character-header-desktop').getBoundingClientRect(), campaign=document.querySelector('[data-wb20-header-role="campaign"]').getBoundingClientRect(), builder=document.querySelector('.ct-character-header-desktop__group--builder').getBoundingClientRect();return{gap:header.right-campaign.right,builder:builder.x>=campaign.x&&builder.right<=campaign.right&&builder.y>campaign.y+45};});
        assert.ok(aligned.gap<=11,"controls align right when status lives in Combat");assert.equal(aligned.builder,true,"builder occupies campaign bottom-right without reparenting");
        await page.evaluate(()=>document.querySelector('.ct-character-header-desktop').append(statusFixture));
        await page.evaluate(()=>{const h=document.querySelector(".ct-character-header-desktop");h.classList.add("waybeyond20-header-with-portent");const p=document.createElement("div");p.className="waybeyond20-portent";p.textContent="Portent 12 · 18";h.append(p);});
        assert.equal(await page.locator(".waybeyond20-portent").evaluate(el=>Math.round(el.getBoundingClientRect().height)),64);
        await page.setViewportSize({width:1190,height:700});
        assert.equal(await page.locator(".wb20-header-rest").isVisible(),false);
        assert.equal(await page.locator(".ct-character-header-desktop__group--short-rest").isVisible(),true,"native small-screen rest remains available");
        await page.setViewportSize({width:1440,height:700});
        // React may replace its controls; forwarding must resolve the fresh one.
        await page.evaluate(()=>{const old=document.querySelector(".ddbc-character-tidbits__menu-callout button");const fresh=old.cloneNode(true);fresh.onclick=()=>nativeClicks.manage+=10;old.replaceWith(fresh);wb20RefreshCompactHeader();});
        await page.getByRole("button",{name:"Manage",exact:true}).click();
        await page.waitForFunction(()=>nativeClicks.manage===12);
        // Injected boxes can also be copied without their listeners. Repair
        // only our own controls; native React controls stay in their parents.
        await page.evaluate(()=>{
            for(const selector of ['.wb20-header-manage','.wb20-header-rest']) {
                const old=document.querySelector(selector);old.replaceWith(old.cloneNode(true));
            }
            for(let i=0;i<4;i++)wb20RefreshCompactHeader();
        });
        await page.getByRole('button',{name:'Manage',exact:true}).click();
        await page.waitForFunction(()=>nativeClicks.manage===22);
        await page.getByRole('button',{name:'Correction',exact:true}).click();
        assert.equal(await page.evaluate(()=>corrections),2,'one repaired Correction handler');
        await rest.click();await page.getByRole('menuitem',{name:'Short Rest',exact:true}).click();
        await page.waitForFunction(()=>nativeClicks.short===2);
        await rest.click();await page.getByRole('menuitem',{name:'Long Rest',exact:true}).click();
        await page.waitForFunction(()=>nativeClicks.long===2);
        await page.evaluate(async()=>{
            document.querySelector('.wb20-header-manage button').click();
            history.pushState({},'', '/characters/different');
            await new Promise(resolve=>setTimeout(resolve,0));
        });
        assert.equal(await page.evaluate(()=>nativeClicks.manage),22,'a queued click cannot manage another character');
        console.log("PASS compact header: native ownership/clicks, keyboard, Rest open-only/cancel, themed surfaces/frame and live theme refresh, right alignment, campaign dividers and icon-only row, equal-height panels, 1200-1920 widths, Portent, small-screen fallback, refresh and replaced controls. Isolated fixture only.");
    } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
