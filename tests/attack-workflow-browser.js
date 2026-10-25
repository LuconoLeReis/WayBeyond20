// Isolated browser only: real shared prompt, theme reader and candidate outcome UI.
const {chromium}=require(process.env.WB20_PLAYWRIGHT||'playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
(async()=>{
    const browser=await chromium.launch({channel:'chrome',headless:true});
    try {
        const page=await browser.newPage(), errors=[];
        page.on('pageerror',error=>errors.push(error.message));
        await page.setContent('<div class="ct-saving-throws-box" style="color:rgb(20,30,40);background:rgb(250,245,230);border:1px solid rgb(130,40,50)"></div>');
        for(const file of ['libs/jquery-3.4.1.min.js','libs/alertify.min.js','src/common/utils.js',
            'src/dndbeyond/content-scripts/portent.js','src/dndbeyond/content-scripts/resources.js',
            'src/dndbeyond/base/attack-workflow.js']) await page.addScriptTag({path:path.join(root,file)});
        for(const file of ['libs/css/alertify.css','src/extension/beyond20.css']) await page.addStyleTag({path:path.join(root,file)});
        await page.evaluate(()=>{
            initializeAlertify();window.dndbeyondDiceRoller={_prompter:{prompt:wayBeyond20Prompt}};
            window.results=[{total:18,isDiscarded:()=>false},{total:25,isDiscarded:()=>false},{total:7,isDiscarded:()=>true}];
            window.ask=()=>{window.answer=wb20ConfirmAttackOutcome('<img src=x onerror="window.bad=true">',results);};
        });
        for(const outcome of ['hit','miss']) {
            await page.evaluate(()=>ask());
            await page.getByLabel('Outcome').waitFor();
            assert.equal(await page.getByRole('button',{name:'Continue',exact:true}).isDisabled(),true);
            assert.equal(await page.getByLabel('Attack result',{exact:true}).locator('option').count(),2);
            assert.equal(await page.locator('.wb20-resource-dialog').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(250, 245, 230)');
            assert.equal(await page.locator('.wb20-attack-outcome img').count(),0);
            await page.getByLabel('Attack result',{exact:true}).selectOption('1');
            await page.getByLabel('Outcome').selectOption(outcome);
            assert.equal(await page.getByRole('button',{name:'Continue',exact:true}).isDisabled(),false);
            await page.getByRole('button',{name:'Continue',exact:true}).click();
            const decision=await page.evaluate(async()=>{const value=await answer;return {hit:value.hit,total:value.roll.total};});
            assert.deepEqual(decision,{hit:outcome==='hit',total:25});
        }
        await page.evaluate(()=>{document.querySelector('.ct-saving-throws-box').style.backgroundColor='rgb(25,30,35)';ask();});
        await page.getByLabel('Outcome').waitFor();
        assert.equal(await page.locator('.wb20-resource-dialog').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(25, 30, 35)');
        await page.getByRole('button',{name:'Skip',exact:true}).click();
        assert.equal(await page.evaluate(async()=>(await answer).hit),null);
        assert.equal(await page.evaluate(()=>window.bad),undefined);
        assert.deepEqual(errors,[]);
        console.log('PASS secondary outcome dialog: Hit/Miss/Skip, kept-result selection, escaping, two sheet themes; isolated browser only.');
    } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
