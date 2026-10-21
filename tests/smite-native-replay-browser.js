// Offline integration: real native-Cast interceptor plus real free-Smite resource
// spender, sharing a DOM across page and extension worlds. Never uses a live profile.
const { chromium } = require(process.env.WB20_PLAYWRIGHT || "playwright");
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const root = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");
const source = read("src/dndbeyond/content-scripts/character.js");
const broker = read("src/dndbeyond/page-scripts/message-broker.js");
function fn(name) {
    const start = source.search(new RegExp(`^(?:async )?function ${name}\\(`, "m"));
    assert.ok(start >= 0, name);
    const end = source.slice(start + 1).search(/^(?:(?:async )?function |const |let |class )/m);
    return source.slice(start, end < 0 ? undefined : start + 1 + end);
}
(async () => {
    const browser = await chromium.launch({ channel: "chrome", headless: true });
    try {
        const page = await browser.newPage();
        await page.setContent(`<div class="ct-spells-spell">
            <span class="ct-spells-spell__label ddbc-spell-name">Divine Smite</span>
            <div class="ct-spells-spell__meta">Paladin's Smite</div><span id="uses">1/LR</span>
            <div class="ct-spells-spell__action"><button>Use</button></div></div>`);
        await page.evaluate(() => {
            window.nativeUses = 0;
            document.querySelector('button').addEventListener('click', () => {
                window.nativeUses++;
                document.querySelector('#uses').textContent = '1/LR (Used)';
            });
        });
        const cdp = await page.context().newCDPSession(page);
        const { frameTree } = await cdp.send("Page.getFrameTree");
        const contexts = [];
        async function run(contextId, expression) {
            const response = await cdp.send("Runtime.evaluate", { contextId, expression, returnByValue: true, awaitPromise: true });
            assert.ok(!response.exceptionDetails, JSON.stringify(response.exceptionDetails));
            return response.result.value;
        }
        for (const worldName of ["extension-one", "extension-two"]) {
            const { executionContextId: id } = await cdp.send("Page.createIsolatedWorld", { frameId: frameTree.frame.id, worldName });
            contexts.push(id);
            await run(id, read("libs/jquery-3.4.1.min.js"));
            await run(id, `
                const wayBeyond20NativeCastReplays = new WeakSet();
                let wayBeyond20NativeCastPending = false;
                var character = {}, casts = 0;
                function wayBeyond20SpellRowLevel(){return 1;}
                function wayBeyond20CharacterDebug(){}
                function wayBeyond20InvalidateSmiteSpellCache(){}
                function wayBeyond20ActiveCharacterSheetTab(){return null;}
                function wayBeyond20CharacterSheetTab(){return null;}
                var alertify = {warning(message){throw Error(message);}};
                ${["wayBeyond20NativeSpellIdentity", "wayBeyond20CommitNativeSpellCast", "wayBeyond20InstallNativeSpellCasting",
                    "wayBeyond20NormalizeFeatureLabel", "wayBeyond20PaladinSmiteUseTextIsUsed", "wayBeyond20LivePaladinSmiteUse",
                    "wayBeyond20WaitForPaladinSmiteUsed", "wayBeyond20SpendPaladinSmiteFreeUse"].map(fn).join("\n")}
                async function wayBeyond20RunNativeSpellCast(){casts++;}
                async function wayBeyond20RequestPagePaladinSmiteSpend(){return {spent:false};}
                wayBeyond20InstallNativeSpellCasting();
            `);
        }
        const pageSpend = broker.slice(broker.indexOf("    function b20PaladinSmiteUseEntry()"), broker.indexOf("    function spendPaladinSmiteUse("));
        await page.addScriptTag({ content: pageSpend + '\nfunction b20InvokeLimitedUseReactHandler(){return null;}' });
        const totalCasts = async () => (await Promise.all(contexts.map(id => run(id, "casts")))).reduce((a,b) => a+b,0);
        const reset = () => page.evaluate(() => { window.nativeUses = 0; document.querySelector('#uses').textContent = '1/LR'; });

        // This accounting click follows a Smite that already rolled. It must NOT cast again.
        const spent = await page.evaluate(() => b20SpendPaladinSmiteUseInPage());
        assert.equal(await totalCasts(), 0, "Free-Smite accounting click must not start a second spell cast");
        assert.equal(spent.spent, true);
        assert.equal(await page.evaluate(() => window.nativeUses), 1);
        await reset();
        assert.equal(await run(contexts[0], "wayBeyond20SpendPaladinSmiteFreeUse()"), true, "Content fallback spends the original use");
        assert.equal(await totalCasts(), 0, "Fallback accounting must not cast again either");
        assert.equal(await page.evaluate(() => window.nativeUses), 1);
        await reset();
        await run(contexts[0], `wayBeyond20CommitNativeSpellCast(character,
            wayBeyond20NativeSpellIdentity(document.querySelector('.ct-spells-spell')), 'use')()`);
        assert.equal(await totalCasts(), 0, "A direct cast's resource replay is bypassed in every extension world");
        assert.equal(await page.evaluate(() => window.nativeUses), 1);
        assert.equal(await page.locator('[data-waybeyond20-resource-replay]').count(), 0, "Replay marker never lingers");

        // Real subsequent activations are not disabled by the resource replay guard.
        await reset();
        await page.getByRole('button', {name:'Use', exact:true}).click();
        assert.equal(await totalCasts(), 1, "A fresh player click casts exactly once");
        assert.equal(await page.evaluate(() => window.nativeUses), 0, "Player preflight doesn't spend before dispatch");
        // Failed accounting must not leave a bypass marker on the control.
        await run(contexts[0], `
            var replayButton = document.querySelector('button');
            var savedClick = replayButton.click;
            replayButton.click = () => {throw Error('fixture native click failed');};
            try {
                wayBeyond20CommitNativeSpellCast(character,
                    wayBeyond20NativeSpellIdentity(document.querySelector('.ct-spells-spell')), 'use')();
            } catch (error) {
                if (error.message !== 'fixture native click failed') throw error;
            } finally {replayButton.click = savedClick;}
        `);
        assert.equal(await page.locator('[data-waybeyond20-resource-replay]').count(), 0, "Thrown replay cleans up its marker");
        await page.getByRole('button', {name:'Use', exact:true}).click();
        assert.equal(await totalCasts(), 2, "Later player casts remain available after a failed replay");
        console.log('PASS Smite native replay: page spend, fallback, cross-world direct commit, subsequent player click.');
    } finally { await browser.close(); }
})().catch(error => {console.error(error); process.exitCode = 1;});
