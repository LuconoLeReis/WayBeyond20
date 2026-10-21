// Actual quick-list module with native-shaped rows. Delivery is modeled;
// live casting/resource acceptance remains a separate gate.
const {chromium} = require(process.env.WB20_PLAYWRIGHT || "playwright");
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root,"src/dndbeyond/content-scripts/character.js"),"utf8");
function fn(name) {
    const start = source.search(new RegExp(`^(?:async )?function ${name}\\(`,"m"));
    assert.ok(start >= 0,name);
    const end = source.slice(start+1).search(/^(?:(?:async )?function |const |let |var |class )/m);
    return source.slice(start,end < 0 ? undefined : start+1+end);
}
(async()=>{
    const browser = await chromium.launch({channel:"chrome",headless:true});
    try {
        const page = await browser.newPage({viewport:{width:900,height:800}});
        await page.route("https://wb20.test/**", route => route.fulfill({body:"<html></html>",contentType:"text/html"}));
        await page.goto("https://wb20.test/");
        await page.setContent('<button role="radio" aria-checked="true">Actions</button><button role="radio" aria-checked="false">Spells</button><div id="spells"></div><div id="actions"></div><div id="prompt"></div>');
        await page.addScriptTag({path:path.join(root,"libs/jquery-3.4.1.min.js")});
        await page.addStyleTag({path:path.join(root,"src/extension/beyond20.css")});
        await page.addScriptTag({content:`
            var saved={},casts=[],rolls=[],warnings=[],fail=false,refreshes=0;
            var character={getSetting:(k,d)=>saved[k]??d,mergeCharacterSettings:(p,cb)=>{Object.assign(saved,p);if(cb)cb();}};
            var wayBeyond20NativeCastPending=false;
            function wayBeyond20RefreshCombinedActions(){refreshes++;const r=document.querySelector("#actions");r._wb20QuickEntries=wb20QuickRows(r);}
            function wayBeyond20EscapeFollowupText(s){return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
            function wayBeyond20NormalizeFeatureLabel(s){return String(s).trim().toLowerCase();}
            ${["wayBeyond20NativeSpellIdentity","wayBeyond20NativeSpellPaneMatches","wayBeyond20CharacterSheetTab","wayBeyond20ActiveCharacterSheetTab","wayBeyond20RestoreCharacterSheetTab"].map(fn).join("\n")}
            function wayBeyond20SpellRowLevel(row){return Number(row.dataset.level);}
            function wayBeyond20AttachTurnResource(args,cost){args.cost=cost;}
            async function sendRollWithCharacter(type,formula,args){if(fail)return false;rolls.push({type,formula,...args});return true;}
            async function wayBeyond20RunNativeSpellCast(row,action){casts.push({name:wayBeyond20NativeSpellIdentity(row).name,action});}
            var alertify={warning:m=>warnings.push(m)};
            var dndbeyondDiceRoller={_prompter:{prompt:(title,html,yes,no)=>new Promise(resolve=>{
                const host=document.querySelector("#prompt");host.innerHTML="<h2>"+title+"</h2>"+html;
                for(const [name,ok] of [[yes,true],[no,false]]){const b=document.createElement("button");b.textContent=name;
                    b.onclick=()=>{const response=ok?$(host.querySelector("form")):null;host.replaceChildren();resolve(response);};host.append(b);}
            })}};
            // React commits the selected tab after the click handler returns.
            document.querySelectorAll("[role=radio]").forEach(button=>button.onclick=()=>setTimeout(()=>{
                document.querySelectorAll("[role=radio]").forEach(b=>b.setAttribute("aria-checked",String(b===button)));
                if(button.textContent==="Actions") document.querySelector(".ct-spell-pane")?.remove();
                if(typeof wb20QuickRows === 'function') wayBeyond20RefreshCombinedActions();
            },25));
            function spell(name,source,time,effect,level=1,action="Cast",hit="--"){
                return '<div class="ct-spells-spell" data-level="'+level+'"><div class="ct-spells-spell__action">'+(action==="At Will"?action:'<button>'+action+'</button>')+'</div><span class="ct-spell-name">'+name+'</span><span class="ct-spells-spell__meta">'+source+'</span><div class="ct-spells-spell__activation"><span data-original-title="'+time+'">'+time+'</span></div><div class="ct-spells-spell__range">60 ft.</div><div class="ct-spells-spell__attacking">'+hit+'</div><div class="ct-spells-spell__damage">'+effect+'</div><div class="ct-spells-spell__notes">V</div></div>';
            }
            document.querySelector("#spells").innerHTML=[
                spell("Test Mend","Bard","1 action","Healing"),spell("Test Mend","Cleric","1 action","Healing"),
                spell("Swift Mend","Bard","1 bonus action","Healing"),
                spell("Test Reaction","Feat","1 reaction","Buff"),
                spell("Test Revival","Cleric","1 minute","Revival"),
                spell("Odd Homebrew","Species","1 hour","Mystery"),
                spell("Radiant Smite","Paladin","1 bonus action","Damage"),
                spell("Spark","Wizard","1 action","Damage",0,"At Will","+5"),
                spell("Not Prepared","Wizard","1 action","Damage",1,"Prepare")
            ].join("");
            document.querySelectorAll(".ct-spells-spell .ct-spell-name").forEach(label=>label.onclick=()=>{
                document.querySelector(".ct-spell-pane")?.remove();
                const identity=wayBeyond20NativeSpellIdentity(label.closest(".ct-spells-spell"));
                const pane=document.createElement("div");pane.className="ct-spell-pane";
                pane.innerHTML='<header class="ct-sidebar__header"><div class="ct-sidebar__header-parent"></div><div class="ct-sidebar__header-primary"><h1 class="ct-sidebar__heading"><span class="ct-spell-name"></span></h1></div></header><span class="ct-spell-caster__casting-level-current"></span><div class="ct-spell-detail__level-school"><span class="ct-spell-detail__level-school-item">Evocation</span><span class="ct-spell-detail__level-school-item">Cantrip</span></div><div class="ct-spell-detail__description"></div>';
                pane.querySelector(".ct-sidebar__header-parent").textContent=identity.source;
                pane.querySelector(".ct-spell-name").textContent=identity.name;
                pane.querySelector(".ct-spell-caster__casting-level-current").textContent=identity.level;
                pane.querySelector(".ct-spell-detail__description").textContent="Native rules for "+identity.name+". <not HTML>";
                document.body.append(pane);
            });
        `});
        await page.addScriptTag({path:path.join(root,"src/dndbeyond/content-scripts/quick-list.js")});
        const cantripMatches = await page.evaluate(()=>{
            const pane=document.createElement("div");pane.className="ct-spell-pane";
            pane.innerHTML='<header class="ct-sidebar__header"><div>Wizard</div><div class="ct-sidebar__header-primary"><h1 class="ct-sidebar__heading"><span class="ct-spell-name">Spark</span></h1></div></header><div class="ct-spell-detail__level-school"><span class="ct-spell-detail__level-school-item">Evocation</span><span class="ct-spell-detail__level-school-item">Cantrip</span></div>';
            document.body.append(pane);
            const identity={name:"Spark",source:"Wizard",level:0};
            const result=[wayBeyond20NativeSpellPaneMatches(identity),wayBeyond20NativeSpellPaneMatches({...identity,source:"Bard"}),wayBeyond20NativeSpellPaneMatches({...identity,level:1})];
            pane.remove();return result;
        });
        assert.deepEqual(cantripMatches,[true,false,false],"Cantrip can follow the school label; source and casting level must still match");
        await page.evaluate(()=>{wb20QuickObserveSpells();wayBeyond20RefreshCombinedActions();});
        let groups = await page.evaluate(()=>wb20QuickGroups().map(g=>({name:g.name,cost:g.cost,time:g.time,count:g.spells.length})));
        assert.equal(groups.length,7);
        assert.equal(groups.find(g=>g.name==="Spell: Healing"&&g.cost==="action").count,2,"Multiclass sources remain distinct choices");
        assert.equal(groups.find(g=>g.name==="Spell: Resurrect").cost,"extended","One minute is not free");
        assert.equal(groups.find(g=>g.name==="Spell: Other").time,"1 hour");
        assert.equal(groups.find(g=>g.name==="Spell: Smite").cost,"bonusAction");
        assert.ok(!await page.evaluate(()=>wb20QuickSession().spells.some(s=>s.name==="Not Prepared")));
        assert.deepEqual(await page.evaluate(()=>document.querySelector('#actions')._wb20QuickEntries.filter(e=>!wb20QuickIsHidden(e)).map(e=>e.name)),
            ['Spell: Healing','Spell: Healing','Cantrip: Attack'],'Only damage/attack and healing categories default on');
        const row = page.locator(".wb20-quick-row").filter({hasText:"Spell: Healing"}).first();
        assert.equal(await row.locator("button").isEnabled(),false);
        const guarded = await page.evaluate(async()=>{
            const spell=wb20QuickSession().spells.find(s=>s.name==="Test Mend");
            const sidebar=document.createElement('div');sidebar.className='ct-sidebar__portal';sidebar.innerHTML='<header class="ct-sidebar__header">Existing feature details</header>';document.body.append(sidebar);
            await wb20QuickLoadDescription(spell.key);
            const result=[wayBeyond20ActiveCharacterSheetTab().textContent,sidebar.textContent,wb20QuickSettings().descriptions?.[spell.key]||null];
            sidebar.remove();return result;
        });
        assert.deepEqual(guarded,['Actions','Existing feature details',null],'Description loading leaves an existing sidebar alone');
        await page.evaluate(()=>{
            const portal=document.createElement('div');portal.id='empty-sidebar';portal.className='ct-sidebar__portal';
            portal.style.cssText='width:100%;height:0';document.body.append(portal);
        });
        await row.locator("select").selectOption({index:1});
        await page.waitForFunction(()=>!wb20QuickSession().pending);
        await page.waitForFunction(()=>document.querySelector('[role=radio]').getAttribute("aria-checked")==="true");
        assert.equal(await page.evaluate(()=>casts.length),0,"Changing selection does not cast");
        await page.evaluate(()=>document.querySelector('#empty-sidebar').remove());
        assert.equal(await row.locator('.wb20-spell-choice-caption').textContent(),'Test Mend','Closed control shows only the name');
        assert.match(await row.locator('select').getAttribute('title'),/Native rules for Test Mend/,'Hover uses native description');
        assert.equal(await page.evaluate(()=>{
            const other=wb20QuickSession().spells.find(s=>s.name==='Test Mend'&&s.source==='Cleric');
            return wb20QuickSettings().descriptions?.[other.key]||null;
        }),null,'A same-named spell from another source never borrows its description');
        const failureCleanup=await page.evaluate(async()=>{
            const original=wb20QuickVisitSpells;
            wb20QuickVisitSpells=async()=>{throw new Error('Modeled missing pane');};
            try { await wb20QuickLoadDescription('missing'); return [wb20QuickSession().pending,wb20QuickSession().loadingDescription]; }
            finally { wb20QuickVisitSpells=original; }
        });
        assert.deepEqual(failureCleanup,[false,false],'A failed description lookup releases both locks');
        assert.equal(await row.locator('not').count(),0,'Description remains text');
        await row.locator('select').scrollIntoViewIfNeeded();
        await page.mouse.move(890,790);
        await row.locator('select').evaluate(e=>e.blur());
        const beforeHover=await row.locator('select').boundingBox();
        assert.equal(await row.locator('select').evaluate(e=>getComputedStyle(e).borderTopColor),'rgba(0, 0, 0, 0)');
        await row.locator('select').hover();
        assert.notEqual(await row.locator('select').evaluate(e=>getComputedStyle(e).borderTopColor),'rgba(0, 0, 0, 0)');
        assert.deepEqual(await row.locator('select').boundingBox(),beforeHover,'Hover border does not shift layout');
        assert.equal(await page.evaluate(()=>casts.length),0,'Hover never casts');
        await page.setViewportSize({width:375,height:800});
        assert.equal(await row.locator('.wb20-spell-choice-caption').textContent(),'Test Mend');
        assert.ok((await row.locator('select').boundingBox()).width<=375,'Dropdown stays bounded on a narrow viewport');
        await page.setViewportSize({width:900,height:800});
        await page.mouse.move(890,790);
        await row.locator('select').focus();
        assert.notEqual(await row.locator('select').evaluate(e=>getComputedStyle(e).borderTopColor),'rgba(0, 0, 0, 0)','Keyboard focus reveals the border');
        assert.equal(await row.locator(".ddbc-combat-attack__range").textContent(),"60 ft.");
        await row.locator("button").click();
        await page.waitForFunction(()=>casts.length===1);
        await page.waitForFunction(()=>document.querySelector('[role=radio]').getAttribute("aria-checked")==="true");
        assert.equal(await page.evaluate(()=>casts[0].name),"Test Mend");
        assert.equal(await page.getByRole("radio",{name:"Actions",exact:true}).getAttribute("aria-checked"),"true","Native cast restores original tab");
        await page.evaluate(()=>{document.querySelector("#actions").replaceChildren();wayBeyond20RefreshCombinedActions();});
        assert.notEqual(await row.locator("select").inputValue(),"","Selection survives DOM replacement");
        await page.evaluate(()=>{wb20QuickManage(document.querySelector("#actions"));});
        await page.locator('[name="visible-0"]').uncheck();
        await page.getByRole("button",{name:"Cancel",exact:true}).click();
        assert.equal(await page.evaluate(()=>wb20QuickSettings().hidden?.length||0),0,"Cancel preserves visibility");
        await page.evaluate(()=>{wb20QuickManage(document.querySelector("#actions"));});
        await page.locator('[name="visible-0"]').uncheck();
        await page.locator('.wb20-quick-checks label').filter({hasText:'Spell: Buff'}).locator('input').check();
        await page.getByText("Custom lines",{exact:true}).click();
        await page.locator('[name="custom-new-name"]').fill('My <custom> roll');
        await page.locator('[name="custom-new-formula"]').fill("4d6dl1+1d4+3");
        await page.locator('[name="custom-new-damageType"]').selectOption('Fire');
        await page.locator('[name="custom-new-cost"]').selectOption("reaction");
        await page.getByRole("button",{name:"Save",exact:true}).click();
        assert.ok(await page.evaluate(()=>wb20QuickSettings().hidden.includes(wb20QuickRowKey(document.querySelector('#actions')._wb20QuickEntries[0]))));
        assert.equal(await page.evaluate(()=>wb20QuickIsHidden(document.querySelector('#actions')._wb20QuickEntries.find(e=>e.name==='Spell: Buff'))),false,'Manage can explicitly enable a default-hidden category');
        const custom = page.locator(".wb20-quick-row").filter({hasText:"My <custom> roll"});
        assert.equal(await custom.locator("custom").count(),0,"Names render as text, not HTML");
        await custom.locator("button").click();
        await page.waitForFunction(()=>rolls.length===1);
        assert.equal(await page.evaluate(()=>rolls[0].cost),"reaction");
        assert.equal(await page.evaluate(()=>rolls[0]['damage-type']),'Fire');
        assert.equal(await page.evaluate(()=>rolls[0].formula),'4d6dl1+1d4+3');
        assert.equal(await page.evaluate(()=>rolls[0].name),'My <custom> roll (Fire damage)');
        assert.equal(await page.evaluate(()=>rolls[0].whisper),undefined,'Custom rows preserve normal privacy settings');
        assert.equal(await page.evaluate(()=>rolls[0]['waybeyond20-custom-formula']),true);
        assert.match(await custom.locator('.ddbc-combat-attack__damage').textContent(),/Fire/);
        await page.evaluate(()=>fail=true);
        await custom.locator("button").click();
        assert.equal(await page.evaluate(()=>rolls.length),1,"Failed custom dispatch is not successful payment");
        assert.deepEqual(await page.evaluate(()=>["2d6+3","d20-1","1d6+1d4+2"].map(wb20QuickFormula)),["2d6+3","d20-1","1d6+1d4+2"]);
        assert.ok(await page.evaluate(()=>["alert(1)","1d6;fetch('/')","101d6","0d6","2d999","1e9","@STR",""].every(f=>wb20QuickFormula(f)===null)));
        await page.evaluate(()=>{wb20QuickManage(document.querySelector("#actions"));});
        await page.getByText("Custom lines",{exact:true}).click();
        await page.locator('[name="custom-0-name"]').fill("Renamed");
        await page.locator('[name="custom-0-formula"]').fill("{Fire:3d6}+{Piercing:1d6+6}+2");
        await page.getByRole("button",{name:"Save",exact:true}).click();
        assert.equal(await page.locator(".wb20-quick-row").filter({hasText:"Renamed"}).count(),1);
        await page.evaluate(()=>fail=false);
        await page.locator('.wb20-quick-row').filter({hasText:'Renamed'}).locator('button').click();
        assert.deepEqual(await page.evaluate(()=>rolls.at(-1)['waybeyond20-damage-parts']),[
            {type:'Fire',formula:'3d6+2'},{type:'Piercing',formula:'1d6+6'}]);
        await page.evaluate(()=>{wb20QuickManage(document.querySelector("#actions"));});
        await page.getByText("Custom lines",{exact:true}).click();
        await page.locator('[name="remove-0"]').check();
        await page.getByRole("button",{name:"Save",exact:true}).click();
        assert.equal(await page.evaluate(()=>wb20QuickSettings().custom.length),0);
        await page.evaluate(()=>{
            var old=character;character={getSetting:(k,d)=>d,mergeCharacterSettings:()=>{}};
            wb20QuickObserveSpells();wayBeyond20RefreshCombinedActions();
        });
        assert.equal(await row.locator("select").inputValue(),"","Selections are character-scoped");
        assert.equal(await page.evaluate(()=>wb20QuickSettings().hidden?.length||0),0);
        assert.equal(await page.evaluate(()=>wb20QuickIsHidden(document.querySelector('#actions')._wb20QuickEntries.find(e=>e.name==='Spell: Buff'))),true,'Other characters retain quiet defaults');
        await page.evaluate(()=>{wb20QuickSession().scanned=false;wb20QuickSession().spells=[];wb20QuickDiscover();});
        await page.waitForFunction(()=>wb20QuickSession().scanned&&!wb20QuickSession().pending);
        await page.waitForFunction(()=>document.querySelector('[role=radio]').getAttribute("aria-checked")==="true");
        assert.equal(await page.getByRole("radio",{name:"Actions",exact:true}).getAttribute("aria-checked"),"true","Cold discovery restores Actions");
        assert.ok(await page.evaluate(()=>wb20QuickGroups().length>0),"Cold discovery populates every supported class without setup");
        await page.evaluate(()=>{
            const row=Array.from(document.querySelectorAll(".ct-spells-spell")).find(r=>wayBeyond20NativeSpellIdentity(r).name==="Test Reaction");
            row.querySelector("button").disabled=true;
            window.reactionKey=wb20QuickReadSpells().find(s=>s.name==="Test Reaction").key;
        });
        const beforeCasts=await page.evaluate(()=>casts.length);
        await page.evaluate(()=>wb20QuickCast(reactionKey));
        assert.equal(await page.evaluate(()=>casts.length),beforeCasts,"Unavailable native cast never executes");
        await page.evaluate(()=>document.querySelectorAll(".ct-spells-spell").forEach(r=>{
            if(wayBeyond20NativeSpellIdentity(r).name==="Test Reaction")r.remove();
        }));
        await page.evaluate(()=>wb20QuickCast(reactionKey));
        assert.equal(await page.evaluate(()=>casts.length),beforeCasts,"Stale remembered spell never substitutes a different spell");
        // Model a sheet reload with remembered choices but no cached descriptions.
        await page.getByRole('radio',{name:'Actions',exact:true}).click();
        await page.waitForFunction(()=>wayBeyond20ActiveCharacterSheetTab().textContent==='Actions');
        await page.evaluate(()=>{
            saved={};character={getSetting:(k,d)=>saved[k]??d,mergeCharacterSettings:(p,cb)=>{Object.assign(saved,p);if(cb)cb();}};
            wb20QuickSessions.delete(character);wb20QuickObserveSpells();
            const selected=Object.fromEntries(wb20QuickGroups().map(g=>[g.key,g.spells[0].key]));
            saved['waybeyond20-quick-list']=JSON.stringify({selected});
            wb20QuickSessions.delete(character);
            window.autoVisits=0;document.querySelectorAll('[role=radio]')[1].addEventListener('click',()=>autoVisits++);
            wb20QuickDiscover();
        });
        await page.waitForFunction(()=>Object.keys(wb20QuickSettings().descriptions||{}).length===3&&!wb20QuickSession().pending).catch(async error=>{
            console.error(await page.evaluate(()=>({settings:wb20QuickSettings(),session:wb20QuickSession(),attempts:[...wb20QuickSession().descriptionAttempts||[]],tab:wayBeyond20ActiveCharacterSheetTab()?.textContent,visits:autoVisits})));throw error;
        });
        await page.waitForFunction(()=>wayBeyond20ActiveCharacterSheetTab().textContent==='Actions');
        assert.equal(await page.evaluate(()=>autoVisits),2,'Cold discovery plus one batch for all remembered visible spells');
        assert.equal(await page.evaluate(()=>casts.length),beforeCasts,'Automatic descriptions never cast');
        assert.equal(await page.evaluate(()=>wb20QuickMissingDescriptions().length),0);
        assert.equal(await page.evaluate(()=>Object.keys(wb20QuickSettings().descriptions).some(k=>k.includes('Odd Homebrew'))),false,'Hidden category selections are not loaded unnecessarily');
        await page.evaluate(()=>{wb20QuickSessions.delete(character);wb20QuickDiscover();});
        await page.waitForFunction(()=>autoVisits===3&&wb20QuickSession().scanned&&!wb20QuickSession().pending);
        await page.waitForFunction(()=>wayBeyond20ActiveCharacterSheetTab().textContent==='Actions');
        assert.equal(await page.evaluate(()=>wb20QuickMissingDescriptions().length),0,'Reload uses cached descriptions');
        const blocked = await page.evaluate(()=>{
            saved['waybeyond20-quick-list']=JSON.stringify({...wb20QuickSettings(),descriptions:{}});
            wb20QuickSession().managing=true;wayBeyond20RefreshCombinedActions();
            return !!wb20QuickSession().descriptionTimer;
        });
        assert.equal(blocked,false,'An open manager defers automatic loading');
        await page.evaluate(()=>{wb20QuickSession().managing=false;wayBeyond20RefreshCombinedActions();});
        await page.waitForFunction(()=>Object.keys(wb20QuickSettings().descriptions||{}).length===3&&!wb20QuickSession().pending);
        await page.waitForFunction(()=>wayBeyond20ActiveCharacterSheetTab().textContent==='Actions');
        await page.evaluate(()=>{
            saved['waybeyond20-quick-list']=JSON.stringify({...wb20QuickSettings(),descriptions:{}});
            wb20QuickSession().descriptionAttempts.clear();
            window.realVisit=wb20QuickVisitSpells;window.failedLookups=0;
            wb20QuickVisitSpells=async()=>{failedLookups++;throw new Error('Modeled description failure');};
            wayBeyond20RefreshCombinedActions();
        });
        await page.waitForFunction(()=>failedLookups===1&&!wb20QuickSession().pending);
        assert.equal(await page.evaluate(()=>wb20QuickMissingDescriptions().length),0,'Failed automatic batch is bounded, not an endless retry');
        await page.evaluate(()=>{wb20QuickVisitSpells=realVisit;});
        console.log("PASS universal quick list, including automatic remembered-description batching, cache reuse, manager deferral and bounded failure; no casting");
    } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
