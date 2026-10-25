// Isolated Chromium UI fixture, never the user's browser or TaleSpire client.
const {chromium} = require(process.env.WB20_PLAYWRIGHT || 'playwright');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
(async () => {
    const browser = await chromium.launch({channel: 'chrome', headless: true});
    try {
        const page = await browser.newPage({viewport: {width: 430, height: 850}});
        await page.route('https://wb20.test/**', route => route.fulfill({body: '<html></html>', contentType: 'text/html'}));
        await page.goto('https://wb20.test/');
        await page.setContent(fs.readFileSync(path.join(root, 'companions/talespire/WayBeyond20/index.html'), 'utf8'));
        await page.evaluate(() => {
            window.recorded = [];
            window.TS = {
                boards: {whereAmI: async () => ({id: 'test-board'})},
                urls: {createUrlPrefixForThisSymbiote: async () => 'talespire://symbiote/test-prefix/'},
                system: {clipboard: {setText: async text => recorded.push({copy: text})}},
                dice: {sendDiceResult: async groups => recorded.push({groups})},
                chat: {send: async (text, audience) => recorded.push({text, audience})},
                debug: {log: async () => {}}
            };
        });
        await page.addScriptTag({path: path.join(root, 'companions/talespire/WayBeyond20/bridge.js')});
        await page.evaluate(() => wb20TaleSpireState({kind: 'hasInitialized'}));
        await page.getByRole('button', {name: 'Copy connection', exact: true}).click();
        assert.equal(await page.getByRole('textbox', {name: 'TaleSpire connection'}).inputValue(), 'talespire://symbiote/test-prefix/');
        await page.getByRole('button', {name: 'Test board link', exact: true}).click();
        await page.getByText('Received from WB20. No additional dice rolled.', {exact: true}).waitFor();
        assert.equal(await page.evaluate(() => recorded.filter(x => x.groups).length), 1);
        assert.equal(await page.evaluate(() => recorded.find(x => x.groups).groups[0].result.value), 20);
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        if (process.env.WB20_TALESPIRE_SCREENSHOT) await page.screenshot({path: process.env.WB20_TALESPIRE_SCREENSHOT});
        await page.setContent('<div id="options"></div>');
        await page.addScriptTag({path: path.join(root, 'libs/jquery-3.4.1.min.js')});
        await page.addScriptTag({path: path.join(root, 'src/common/utils.js')});
        await page.addScriptTag({path: path.join(root, 'src/common/settings.js')});
        await page.evaluate(() => {
            document.getElementById('options').appendChild(createVTTTabSetting('vtt-tab', false));
            setVTTTabSetting('vtt-tab', {'vtt-tab': {id: 0, title: null, vtt: 'talespire'}});
        });
        assert.equal(await page.locator('#vtt-tab').innerText(), 'TaleSpire');
        assert.equal(await page.evaluate(() => getVTTTabSetting('vtt-tab').vtt), 'talespire');
        assert.equal(await page.locator('.dropdown-menu').getByText('TaleSpire', {exact: true}).count(), 1);
        console.log('PASS TaleSpire companion rendered UI, copy/test, narrow layout and actual destination-setting round trip. Mock game API only.');
    } finally {await browser.close();}
})().catch(error => {console.error(error); process.exitCode = 1;});
