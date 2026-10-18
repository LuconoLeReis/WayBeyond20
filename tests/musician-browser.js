// Offline Chromium regression: multiple extension contexts share one page DOM.
// No user profile, live character, or network is used.
const { chromium } = require(process.env.WB20_PLAYWRIGHT || "playwright");
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "src/dndbeyond/content-scripts/character.js"), "utf8");
const musician = source.slice(source.indexOf("function wayBeyond20ShowMusicianRestReminder("), source.indexOf("// A rest is a span"));
const tracker = source.slice(source.indexOf("function wayBeyond20InstallLongRestTracker("), source.indexOf("function wayBeyond20FindHitPointsTrackerContainer("));
(async () => {
    const browser = await chromium.launch({channel:"chrome", headless:true});
    try {
        const page = await browser.newPage();
        await page.setContent('<html><body><div class="ct-sidebar">Long Rest<button class="ct-button--is-confirming">Take Long Rest</button></div></body></html>');
        await page.addStyleTag({path:path.join(root,"libs/css/alertify.css")});
        const cdp = await page.context().newCDPSession(page);
        const {frameTree} = await cdp.send("Page.getFrameTree");
        const contexts = [];
        const run = async (contextId, expression) => {
            const response = await cdp.send("Runtime.evaluate", {contextId, expression, returnByValue:true});
            assert.ok(!response.exceptionDetails, JSON.stringify(response.exceptionDetails));
            return response.result.value;
        };
        for (const name of ["extension-before-reload", "extension-after-reload"]) {
            const {executionContextId} = await cdp.send("Page.createIsolatedWorld", {frameId:frameTree.frame.id, worldName:name});
            contexts.push(executionContextId);
            for(const file of ["libs/jquery-3.4.1.min.js", "libs/alertify.min.js", "src/common/utils.js"])
                await run(executionContextId,fs.readFileSync(path.join(root,file),"utf8"));
            await run(executionContextId, musician + '\n' + tracker + `
                var character={_id:"fixture",hasFeat:()=>true,updateInfo(){},mergeCharacterSettings(){}};
                var wayBeyond20LongRestResetPending=false;
                var resetCount=0;
                function wayBeyond20CharacterHelperEnabled(){return true;}
                function wayBeyond20CharacterDebug(){}
                function wayBeyond20DescribeElement(){return null;}
                function wayBeyond20EndCombat(){resetCount++;}
                function wayBeyond20InvalidateSmiteSpellCache(){}
                function wayBeyond20ResetHitDice(){}
                function wayBeyond20ExpireEffectsForRest(){}
                function wayBeyond20RestWizardResources(){}
                initializeAlertify();
                wayBeyond20InstallLongRestTracker();
            `);
        }
        // One real click is delivered to both isolated contexts.
        await page.getByRole("button",{name:"Take Long Rest",exact:true}).click();
        await page.waitForFunction(()=>document.querySelector('.alertify:not(.ajs-hidden)'));
        // Wait past both rest callbacks and the modal transition, not just the first opener.
        await page.waitForTimeout(1100);
        assert.equal(await page.locator('.alertify:not(.ajs-hidden)').count(),1,"One rest must create exactly one Musician window across isolated contexts");
        assert.equal((await Promise.all(contexts.map(id=>run(id,"resetCount")))).reduce((a,b)=>a+b,0),1,"One rest must run its resource resets only once");
        // Even repeated reminder requests must not produce a second queued window.
        for(const id of contexts) await run(id,'wayBeyond20ShowMusicianRestReminder("long"); void 0');
        assert.equal(await page.locator('.alertify:not(.ajs-hidden)').count(),1);
        await page.getByRole("button",{name:"Done",exact:true}).click();
        await page.waitForTimeout(500);
        assert.equal(await page.locator('.alertify:not(.ajs-hidden)').count(),0,"Dismiss must not reveal a queued duplicate");
        // A genuinely later rest still works and can be closed normally.
        await page.getByRole("button",{name:"Take Long Rest",exact:true}).click();
        await page.getByRole("button",{name:"Done",exact:true}).waitFor({state:"visible"});
        await page.waitForTimeout(900);
        assert.equal(await page.locator('.alertify:not(.ajs-hidden)').count(),1);
        assert.equal((await Promise.all(contexts.map(id=>run(id,"resetCount")))).reduce((a,b)=>a+b,0),2);
        await page.getByRole("button",{name:"Close",exact:true}).click();
        await page.waitForTimeout(500);
        assert.equal(await page.locator('.alertify:not(.ajs-hidden)').count(),0);
        console.log("PASS Musician: two isolated contexts, one rest/reset/window, duplicate requests coalesced, dismissal, later rest.");
    } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
