// Offline fixture of the native two-stage pool control observed on DDB.
// Preview changes are discarded on remount unless the pool's own Confirm is clicked.
const {chromium} = require(process.env.WB20_PLAYWRIGHT || 'playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const source=fs.readFileSync(path.join(root,'src/dndbeyond/content-scripts/character.js'),'utf8');
function fn(name){
    const start=source.search(new RegExp(`^(?:async )?function ${name}\\(`,'m'));
    assert.ok(start>=0,name);
    const end=source.slice(start+1).search(/^(?:(?:async )?function |const |let |class )/m);
    return source.slice(start,end<0?undefined:start+1+end);
}
(async()=>{
    const browser=await chromium.launch({channel:'chrome',headless:true});
    try{
        const page=await browser.newPage();
        await page.setContent('<div id="pool"></div><button id="unrelated">Confirm</button>');
        await page.addScriptTag({path:path.join(root,'libs/jquery-3.4.1.min.js')});
        await page.addScriptTag({content:`
            var character={}, persisted=15, preview=15, confirms=0, decreases=0, unrelated=0;
            var failConfirm=false, omitConfirm=false, ignoreDecrease=false, changeOwner=false;
            document.querySelector('#unrelated').onclick=()=>unrelated++;
            function render(){
                document.querySelector('#pool').innerHTML='<div class="ct-feature-snippet__action"><div class="ct-feature-snippet__action-summary">Lay On Hands: Healing Pool: 1 Bonus Action</div><div class="ct-slot-manager-large"><button class="button-action-decrease">Minus</button><div class="ct-slot-manager-large__value--cur">'+preview+'</div>'+(preview!==persisted?'<div class="ct-slot-manager-large__diff"><div class="ct-slot-manager-large__diff-explain">'+(preview-persisted)+'</div><div class="ct-slot-manager-large__diff-actions">'+(omitConfirm?'':'<button>Confirm</button>')+'<button>Clear</button></div></div>':'')+'</div></div>';
                document.querySelector('.button-action-decrease').onclick=()=>{decreases++;if(!ignoreDecrease){preview--;render();}if(changeOwner)character={};};
                for(const button of document.querySelectorAll('.ct-slot-manager-large__diff-actions button')){
                    button.onclick=()=>{if(button.textContent==='Confirm'){confirms++;if(!failConfirm)persisted=preview;}else preview=persisted;render();};
                }
            }
            function reset(){persisted=preview=15;confirms=decreases=unrelated=0;failConfirm=omitConfirm=ignoreDecrease=changeOwner=false;render();}
            function wayBeyond20ParseInteger(value){return parseInt(value);}
            function wayBeyond20ElementOwnText(element){return element.textContent;}
            ${['wayBeyond20NormalizeFeatureLabel','wayBeyond20ActionSummaryParts','wayBeyond20FindNumericFeaturePool','wayBeyond20SpendNumericFeaturePool'].map(fn).join('\n')}
            reset();
        `});
        const spend=amount=>page.evaluate(amount=>wayBeyond20SpendNumericFeaturePool('Lay On Hands: Healing Pool',amount),amount);
        assert.equal(await spend(1),true);
        assert.equal(await page.evaluate(()=>persisted),14,'Native Confirm must persist the staged spend');
        await page.evaluate(()=>{preview=persisted;render();});
        assert.equal(await page.locator('.ct-slot-manager-large__value--cur').innerText(),'14','Remount preserves confirmed pool');
        assert.deepEqual(await page.evaluate(()=>[confirms,decreases,unrelated]),[1,1,0]);
        await page.evaluate(()=>reset());
        assert.equal(await spend(10),true);
        assert.deepEqual(await page.evaluate(()=>[persisted,confirms,decreases]),[5,1,10],'Combined allocation confirms once');
        await page.evaluate(()=>{reset();preview=13;render();});
        assert.equal(await spend(1),false,'Never commit another pending manual allocation');
        assert.deepEqual(await page.evaluate(()=>[persisted,confirms,decreases]),[15,0,0]);
        await page.evaluate(()=>{reset();failConfirm=true;});
        assert.equal(await spend(1),false,'An ignored Confirm is not success');
        assert.equal(await page.evaluate(()=>confirms),1,'No automatic repeated confirmation');
        await page.evaluate(()=>{reset();omitConfirm=true;});
        assert.equal(await spend(1),false,'Never click an unrelated Confirm');
        assert.equal(await page.evaluate(()=>unrelated),0);
        await page.evaluate(()=>{reset();ignoreDecrease=true;});
        assert.equal(await spend(1),false);
        assert.equal(await page.evaluate(()=>confirms),0);
        await page.evaluate(()=>reset());
        assert.equal(await spend(16),false,'Do not silently spend a partial allocation');
        assert.equal(await page.evaluate(()=>decreases),0);
        await page.evaluate(()=>{reset();changeOwner=true;});
        assert.equal(await spend(1),false,'Character navigation must not commit another sheet');
        assert.deepEqual(await page.evaluate(()=>[persisted,confirms]),[15,0]);
        console.log('PASS LOH native confirmation: persisted remount, one combined commit, manual pending guard, failed/missing confirmation, ignored decrement and insufficient pool.');
    }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
