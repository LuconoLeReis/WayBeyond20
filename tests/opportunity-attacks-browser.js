// Offline native-shaped DOM with real chooser, execute, item/action builders and
// bounded grant. Dice/VTT delivery is modeled, so this is not live acceptance.
const {chromium} = require(process.env.WB20_PLAYWRIGHT || "playwright");
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "src/dndbeyond/content-scripts/character.js"), "utf8");
function fn(name, sourceText = source) {
    const source = sourceText;
    const start = source.search(new RegExp(`^(?:async )?function ${name}\\(`, "m"));
    assert.ok(start >= 0, name);
    const end = source.slice(start + 1).search(/^(?:(?:async )?function |const |let |var |class )/m);
    return source.slice(start, end < 0 ? undefined : start + 1 + end);
}
(async () => {
    const browser = await chromium.launch({channel:"chrome", headless:true});
    try {
        const page = await browser.newPage({viewport:{width:1000,height:800}});
        page.setDefaultTimeout(7000);
        await page.setContent(`<div id="actions">${[
            ["Test claw","Melee Attack","action"],["Test sword","Melee Weapon","item"],
            ["Test bow","Ranged Weapon","item"],["Test spell","Melee Spell Attack","spell"]
        ].map(([name,meta,pane]) => `<div class="ddbc-combat-attack" data-pane="${pane}" style="display:flex">
            <span class="ddbc-combat-attack__name"><button class="ddbc-combat-attack__label">${name}</button>
            <span class="ddbc-combat-attack__meta-item">${meta}</span></span>
            <span class="ddbc-combat-attack__tohit">+5</span><span class="ddbc-combat-attack__damage">1d6+3</span></div>`).join("")}</div>
            <div id="sidebar"></div><div id="prompt"></div>`);
        await page.addScriptTag({path:path.join(root,"libs/jquery-3.4.1.min.js")});
        await page.addStyleTag({path:path.join(root,"src/extension/beyond20.css")});
        await page.addScriptTag({content:`
            var state={inCombat:true,combatSource:"Roll20",combatStartedAt:1,localTurnNumber:1,
                currentRoll20Turn:{turnKey:"enemy",isThisCharactersTurn:false}};
            var sent=[],warnings=[],costs=[],fail=false,paneInvalid=false,opens=0,rerenderOnOpen=false,dismissOnConfirm=false;
            var character={hasClass:()=>false,hasClassFeature:()=>false,hasFeat:()=>false,hasRacialTrait:()=>false,
                _settings:{},getSetting(k,d){return this._settings[k]??d;},
                mergeCharacterSettings(data,cb){Object.assign(this._settings,data);if(cb)cb();},
                getGlobalSetting:(k,d)=>d,_cacheToHit(){},hasGreatWeaponFighting:()=>false};
            var RollType={NORMAL:0,ADVANTAGE:3,DISADVANTAGE:4,QUERY:2}, key_modifiers={};
            function wayBeyond20GetTurnTrackerState(){return state;}
            function wayBeyond20HasActiveCombatState(){return state.inCombat;}
            function wayBeyond20EscapeFollowupText(s){return String(s).replace(/</g,"&lt;");}
            var alertify={warning:m=>warnings.push(m)};
            document.addEventListener("click",event=>{
                if(dismissOnConfirm && event.target.textContent==="Make attack")
                    document.querySelector("#sidebar").replaceChildren();
            });
            var dndbeyondDiceRoller={_prompter:{prompt:(title,html,yes,no)=>new Promise(resolve=>{
                const host=document.querySelector("#prompt");host.innerHTML="<h2>"+title+"</h2>"+html;
                for(const [name,result] of [[yes,true],[no,false]]){
                    const b=document.createElement("button");b.textContent=name;b.type="button";
                    b.onclick=()=>{const response=result?$(host.querySelector("form")):null;host.replaceChildren();resolve(response);};
                    host.append(b);
                }
            })}};
            function propertyListToDict(list){
                const props={};
                list.each((i,el)=>{props[el.dataset.key]=el.querySelector("p").textContent;});
                return props;
            }
            document.querySelectorAll(".ddbc-combat-attack__label").forEach(label=>label.onclick=()=>{
                opens++;
                const item=label.closest("[data-pane]").dataset.pane==="item";
                const props={"Attack Type":paneInvalid?"Ranged":"Melee","To Hit":"+5",Damage:"1d6+3",
                    "Damage Type":"Slashing",Properties:"Finesse",Reach:"5 ft.","Action Type":"1 Action"};
                if(!item && !paneInvalid){delete props["Attack Type"];delete props.Properties;props["Range/Area"]="5ft. Reach";}
                document.querySelector("#sidebar").innerHTML='<div class="'+(item?"b20-item-pane":"b20-action-pane")+'">'+
                    '<h2 class="ct-sidebar__heading">'+(item?'<span class="ddbc-item-name">'+label.textContent+'</span>':label.textContent)+'</h2>'+
                    '<div class="'+(item?"ct-item-detail":"ct-action-detail")+'"><div role="list">'+
                    Object.entries(props).map(([k,v])=>'<div data-key="'+k+'"><p>'+(k==="Damage"?'<span class="ddbc-damage__value">'+v+'</span>':v)+'</p></div>').join("")+
                    '</div></div></div>';
                if(rerenderOnOpen){
                    const row=label.closest(".ddbc-combat-attack");
                    const replacement=row.cloneNode(true);
                    replacement.querySelector(".ddbc-combat-attack__label").onclick=label.onclick;
                    row.replaceWith(replacement);
                }
            });
            function resetHijackQuickRollState(){}
            function handleCustomText(){return {before:[],replace:[],after:[]};}
            function pauseHotkeyHandling(){} function resumeHotkeyHandling(){}
            function wayBeyond20ActionDescription(){return "An unarmed strike";}
            async function wayBeyond20RollPaladinSpecialAction(){return {handled:false};}
            function addCustomDamages(){}
            function includesNormalized(a,v){return a.includes(v.toLowerCase());}
            ${fn("applyGWFIfRequired",fs.readFileSync(path.join(root,"src/dndbeyond/base/utils.js"),"utf8"))}
            function addEffect(){}
            function wayBeyond20ApplyBedsideMannerIntent(){}
            function wayBeyond20CommitAfterDispatch(){}
            function wayBeyond20AttachNativeActionUse(){}
            function wayBeyond20ActivationResource(){return "action";}
            function wayBeyond20AttachAttackActionResource(args){args["waybeyond20-turn-resource"]={resource:"action",actionType:"Attack"};}
            function wayBeyond20IsSmiteEligibleAttack(){return true;}
            function descriptionToString(){return "A melee attack";}
            function isItemATool(){return false;} function isItemAnInstruction(){return false;}
            function wayBeyond20IsProbablyMagicalItem(){return false;}
            function wayBeyond20AddDamage(pool,ds,ts,row){pool.push(row);ds.push(row.formula);ts.push(row.type);}
            function wayBeyond20NormalizeActionPoolToDamages(){}
            function wayBeyond20ApplySavageAttacker(){}
            async function buildAttackRoll(owner,kind,name,description,properties,damages,types,tohit){
                return {name,description,damages,"damage-types":types,"to-hit":tohit,rollAttack:true,rollDamage:true};
            }
            async function sendRollWithCharacter(type,fallback,args){
                const activation=args["waybeyond20-attack-activation"];
                return wayBeyond20PerformGrantedAttack(activation,args,async()=>{
                    if(fail)return false;
                    costs.push(args["waybeyond20-turn-resource"]?.resource);
                    sent.push({name:args.name,mode:args.advantage,context:args["waybeyond20-attack-context"],
                        damages:args.damages,resource:args["waybeyond20-turn-resource"]?.resource});
                    return true;
                });
            }
            ${["wayBeyond20AttackActivationTurnKey","wayBeyond20CreateAttackActivation","wayBeyond20PerformGrantedAttack",
                "handleSpecialMeleeAttacks","handleSpecialWeaponAttacks","handleSpecialGeneralAttacks",
                "capitalize","rollItem","rollAction","execute","wayBeyond20MaybeAddSmite","wayBeyond20RefreshNaturalAttackIcons"].map(name=>fn(name)).join("\n")}
        `});
        await page.addScriptTag({path:path.join(root,"src/dndbeyond/content-scripts/opportunity-attacks.js")});
        await page.addScriptTag({content:"var wayBeyond20AttackMenuClose=null;\n"+
            fn("wayBeyond20ShowAttackMenu",fs.readFileSync(path.join(root,"src/dndbeyond/base/utils.js"),"utf8"))});
        await page.evaluate(()=>{
            const root=document.querySelector("#actions");
            wayBeyond20OpportunityRow(root);wayBeyond20OpportunityRow(root);
            const row=root.querySelector(".wb20-opportunity-attack");
            row.dataset.wb20ListLayout="row";row.dataset.wb20ActionCost="reaction";
        });
        assert.equal(await page.locator(".wb20-opportunity-attack").count(),1);
        assert.equal(await page.locator(".wb20-opportunity-attack button").first().evaluate(el=>getComputedStyle(el).borderTopColor),"rgb(197, 49, 49)");
        const open=()=>page.getByRole("button",{name:"Choose different Attack",exact:true}).click();
        await open();
        assert.equal(await page.locator(".wb20-opportunity-rules").getAttribute("open"),null,"Rules start collapsed");
        assert.equal(await page.getByLabel("Attack",{exact:true}).count(),1,"Attack has an accessible label");
        assert.equal(await page.getByLabel("Roll with",{exact:true}).count(),1,"Roll mode has an accessible label");
        await page.setViewportSize({width:375,height:800});
        assert.ok(await page.locator(".wb20-opportunity-prompt").evaluate(el =>
            Array.from(el.querySelectorAll("select")).every(s =>
                s.getBoundingClientRect().right <= el.getBoundingClientRect().right + 1 &&
                s.getBoundingClientRect().height >= 36)),"Choices fit narrow layout with usable height");
        await page.getByText("Trigger and rules reminder",{exact:true}).click();
        assert.equal(await page.locator(".wb20-opportunity-rules").getAttribute("open"),"","Rules expand without submitting");
        assert.equal(await page.evaluate(()=>sent.length),0);
        await page.setViewportSize({width:1000,height:800});
        assert.deepEqual(await page.locator('select[name="attack"] option').allTextContents(),["Test claw | +5 | 1d6+3","Test sword | +5 | 1d6+3"]);
        await page.getByRole("button",{name:"Cancel",exact:true}).click();
        assert.deepEqual(await page.evaluate(()=>[opens,sent.length,costs.length]),[0,0,0]);
        await open();
        await page.locator('[name="mode"]').selectOption("3");
        await page.getByRole("button",{name:"Make attack",exact:true}).click();
        await page.waitForFunction(()=>sent.length===1);
        assert.deepEqual(await page.evaluate(()=>[sent[0].name,sent[0].mode,sent[0].resource,sent[0].context.isOwnTurn]),["Test claw",3,"reaction",false]);
        await open();
        await page.locator('[name="attack"]').selectOption("1");
        await page.locator('[name="mode"]').selectOption("4");
        await page.getByRole("button",{name:"Make attack",exact:true}).click();
        await page.waitForFunction(()=>sent.length===2);
        assert.deepEqual(await page.evaluate(()=>[sent[1].name,sent[1].mode,sent[1].resource,sent[1].damages]),["Test sword",4,"reaction",["1d6+3"]]);
        await open();
        await page.evaluate(()=>state.currentRoll20Turn.turnKey="next");
        await page.getByRole("button",{name:"Make attack",exact:true}).click();
        assert.equal(await page.evaluate(()=>sent.length),2,"turn change cancels before opening another pane");
        await page.evaluate(()=>{paneInvalid=true;document.querySelector("#sidebar").replaceChildren();});
        await open();
        await page.getByRole("button",{name:"Make attack",exact:true}).click();
        await page.waitForFunction(()=>warnings.length>0);
        assert.equal(await page.evaluate(()=>sent.length),2,"full pane is revalidated");
        await page.evaluate(()=>{paneInvalid=false;fail=true;});
        await open();
        await page.getByRole("button",{name:"Make attack",exact:true}).click();
        await page.waitForFunction(()=>!wayBeyond20OpportunityPending);
        assert.equal(await page.evaluate(()=>costs.length),2,"failed send spends nothing");
        await page.evaluate(()=>{fail=false;rerenderOnOpen=true;});
        await open();
        await page.getByRole("button",{name:"Make attack",exact:true}).click();
        await page.waitForFunction(()=>!wayBeyond20OpportunityPending);
        assert.equal(await page.evaluate(()=>sent.length),3,"A native row rerender while opening its validated pane must not silently cancel the attack");
        await page.evaluate(()=>{dismissOnConfirm=true;rerenderOnOpen=false;});
        await open();
        await page.getByRole("button",{name:"Make attack",exact:true}).click();
        await page.waitForFunction(()=>!wayBeyond20OpportunityPending);
        assert.equal(await page.evaluate(()=>sent.length),4,"Chooser confirmation must finish its outside-click dismissal before opening native details");
        await page.evaluate(()=>{
            rerenderOnOpen=false;
            wayBeyond20OpportunityRow(document.querySelector("#actions"));
        });
        const oa=page.locator(".wb20-opportunity-attack");
        assert.equal(await oa.locator(".wb20-talent-category").innerText(),"Test sword");
        assert.equal(await oa.locator(".ddbc-combat-attack__action").innerText(),"+5");
        assert.equal(await oa.locator(".ddbc-combat-attack__damage").innerText(),"1d6+3");
        await oa.locator(".wb20-feature-option-icon").click();
        await page.waitForFunction(()=>!wayBeyond20OpportunityPending);
        assert.equal(await page.evaluate(()=>sent.length),5,"Saved default fires directly with known turn");
        assert.equal(await page.locator('#prompt select[name="attack"]').count(),0,"Shortcut skips attack chooser");
        assert.equal(await page.evaluate(()=>sent.at(-1).name),"Test sword");
        await oa.locator(".wb20-feature-option-icon").click({button:"right"});
        assert.equal(await page.getByRole("dialog",{name:"Attack roll options"}).count(),1);
        await page.getByRole("radio",{name:"Disadvantage",exact:true}).click();
        assert.equal(await page.evaluate(()=>sent.length),5,"Selecting roll mode does not attack");
        await page.getByRole("button",{name:"ROLL FULL ATTACK",exact:true}).click();
        await page.waitForFunction(()=>!wayBeyond20OpportunityPending);
        assert.equal(await page.evaluate(()=>sent.length),6);
        assert.equal(await page.evaluate(()=>sent.at(-1).mode),4,"Default shortcut uses chosen right-click mode");
        await page.evaluate(()=>{
            state.combatSource="Manual Combat";
            wayBeyond20OpportunityRow(document.querySelector("#actions"));
        });
        await oa.locator(".wb20-feature-option-icon").click();
        assert.equal(await page.locator('#prompt select[name="attack"]').count(),0);
        assert.equal(await page.locator('#prompt select[name="ownTurn"]').count(),1,"Unknown turn is asked, not guessed");
        await page.getByRole("button",{name:"Cancel",exact:true}).click();
        assert.equal(await page.evaluate(()=>sent.length),6,"Cancelling turn prompt spends nothing");
        await page.evaluate(()=>{
            state.combatSource="Roll20";
            const native=document.querySelector('[data-pane="item"]');
            // The remembered choice is a live lookup, not a stale numeric snapshot.
            native.querySelector(".ddbc-combat-attack__tohit").textContent="+7";
            wayBeyond20OpportunityRow(document.querySelector("#actions"));
        });
        assert.equal(await oa.locator(".ddbc-combat-attack__action").innerText(),"+7");
        await page.evaluate(()=>{
            const native=document.querySelector('[data-pane="item"]');
            native.parentElement.append(native.cloneNode(true));
            wayBeyond20OpportunityRow(document.querySelector("#actions"));
        });
        assert.equal(await oa.locator(".wb20-talent-category").innerText(),"Choose an attack","Ambiguous defaults do not choose an arbitrary duplicate");
        await oa.locator(".wb20-feature-option-icon").click();
        assert.equal(await page.locator('#prompt select[name="attack"]').count(),1);
        await page.getByRole("button",{name:"Cancel",exact:true}).click();
        await page.evaluate(()=>{
            window.previousCharacter=character;
            character={getSetting:(k,d)=>d};
            wayBeyond20OpportunityRow(document.querySelector("#actions"));
        });
        assert.equal(await oa.locator(".wb20-talent-category").innerText(),"Choose an attack","Default belongs to its character");
        await page.evaluate(()=>{character=previousCharacter;});
        assert.equal(await page.locator(".wb20-opportunity-attack").count(),1);
        await page.evaluate(()=>{
            const host=document.createElement("div");host.id="icons";
            for(const name of ["Unarmed Strike","Fangs/Claws (Dexterity)","Fangs/Claws (Strength)"]){
                const row=document.createElement("div");row.className="ddbc-combat-attack";
                row.innerHTML='<button class="ddbc-combat-attack__icon"><svg viewBox="0 0 20 20"><path d="'+
                    (name==="Unarmed Strike"?"M1 1h5v5z":"M2 2h9v9z")+'"/></svg></button>'+
                    '<span class="ddbc-combat-attack__label">'+name+'</span>';
                row.querySelector("button").onclick=()=>row.dataset.clicked="yes";
                host.append(row);
            }
            document.body.append(host);
            wayBeyond20RefreshNaturalAttackIcons();wayBeyond20RefreshNaturalAttackIcons();
        });
        assert.equal(await page.locator('#icons [data-wb20-unarmed-icon]').count(),2);
        assert.deepEqual(await page.locator('#icons .wb20-natural-original').evaluateAll(es=>es.map(e=>getComputedStyle(e).display)),["none","none"]);
        await page.locator("#icons button").nth(1).click();
        assert.equal(await page.locator("#icons .ddbc-combat-attack").nth(1).getAttribute("data-clicked"),"yes","icon wrapper retains its click handler");
        console.log("Opportunity Attack browser fixture: row, melee-only chooser, cancellation, real native item/action builders, modes, Reaction-only payment, stale turn and failed send passed.");
    } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
