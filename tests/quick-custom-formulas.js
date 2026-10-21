const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
function fn(source,name){const start=source.search(new RegExp('^(?:async )?function '+name+'\\(','m'));assert.ok(start>=0);const next=source.slice(start+1).search(/^(?:function |async function |const |class |let |var )/m);return source.slice(start,next<0?undefined:start+1+next);}
const ctx=vm.createContext({console,Roll:class {constructor(formula){this.formula=formula;}}});
const quick=read('src/dndbeyond/content-scripts/quick-list.js');
vm.runInContext(read('src/common/dice.js')+ '\n'+quick.slice(quick.indexOf('function wb20QuickSimpleFormula('),quick.indexOf('async function wb20QuickRollCustom('))+'\n'+fn(read('src/roll20/content-script.js'),'genRoll'),ctx);
const fvtt=read('src/fvtt/page-script.js');
vm.runInContext(fvtt.slice(fvtt.indexOf('class FVTTRoll '),fvtt.indexOf('class FVTTRoller ')),ctx);
const formula=s=>vm.runInContext(`wb20QuickFormula(${JSON.stringify(s)})`,ctx);
for(const s of ['4d6dl1+1d4+3','2d20kh1+5','3d20kl1','4d6dh1','2d6ro<=2+1d4ro<=1','2d6ro<=2kh1min6+1d4min2','d20-2.5']) assert.ok(formula(s),s);
for(const s of ['2d6*2','(2d6+3)','1d6!','1d6r<6','2d20kh3','2d6ro<=7','101d4','1d6+100001','1d6min100001','2d6kh1dl1','1d6;alert(1)','1d6+@str','1d6+','1d6+1d6garbage','1d6kh1<img>']) assert.equal(formula(s),null,s);
async function total(input,sequence){ctx.input=formula(input);ctx.sequence=sequence;return vm.runInContext(`(async()=>{const r=new DNDBRoll(input);let i=0;for(const d of r.dice)d.rollSingleDie=()=>sequence[i++];await r.roll();return r.total;})()`,ctx);}
(async()=>{
    ctx.input='{F:3d6}+{P:1d6+6}+{D:3d8}';
    const parts=vm.runInContext('wb20QuickFormulaParts(input)',ctx);
    assert.deepEqual(JSON.parse(JSON.stringify(parts.parts)),[
        {type:'Fire',formula:'3d6'},{type:'Piercing',formula:'1d6+6'},{type:'Divine',formula:'3d8'}]);
    assert.deepEqual(JSON.parse(vm.runInContext('JSON.stringify(wb20QuickFormulaParts("{Fire:1d6}+{F:2d6}+4", "Cold").parts)',ctx)),[
        {type:'Fire',formula:'1d6+2d6'},{type:'Cold',formula:'4'}]);
    for(const s of ['{F:100d6}+1d6','{Fire:3d6','{Bad:1d6}','{Fire:1d6}+','{Fire:1d6}{Cold:1d6}','{F:{P:1d6}}','{Fire:1d6;alert(1)}'])assert.equal(formula(s),null,s);
    assert.equal(formula('{Fire:3d6}+{Piercing:1d6+6}'),'{Fire:3d6}+{Piercing:1d6+6}');
    assert.equal(vm.runInContext('wb20QuickFormulaParts("-{Fire:1d6-2}").parts[0].formula',ctx),'-1d6+2');
    assert.equal(await total('4d6dl1+1d4+3',[1,2,5,6,4]),20);
    assert.equal(await total('2d20kh1+5',[3,18]),23);
    assert.equal(await total('2d6ro<=2',[1,2,5,6]),11);
    assert.equal(await total('2d6ro<=2kh1min6+1d4min2',[1,3,2,1]),8);
    assert.equal(await total('-2d6min6',[1,2]),-6);
    ctx.input=formula('-2d6min6');
    assert.equal(vm.runInContext('genRoll(input)',ctx),'[[- {2d6, 0d0 + 6}kh1]]');
    const f=formula('2d6ro<=2kh1min6+1d4ro<=1min2');ctx.input=f;
    assert.equal(vm.runInContext('genRoll(input)',ctx),'[[{2d6ro<2kh1, 0d0 + 6}kh1 + {1d4ro<1, 0d0 + 2}kh1]]');
    assert.equal(vm.runInContext('new FVTTRoll(input)._roll.formula',ctx),'{2d6r<=2kh1, 6}kh1 + {1d4r<=1, 2}kh1');
    assert.match(read('src/roll20/content-script.js'),/"r1": request\["waybeyond20-custom-formula"\] \? genRoll\(request.roll\)/,'Validated custom formulas bypass prose dice substitution');
    // Exercise the real shared typed renderer with deterministic dice, without
    // a VTT or character. One resolution batch, no reroll for subtotals.
    vm.runInContext(read('src/common/roll_renderer.js'),ctx);
    const result=await vm.runInContext(`(async()=>{
        let resolved=0; const renderer=new Beyond20RollRenderer({roll:f=>new DNDBRoll(f),resolveRolls:async(n,rs)=>{
            resolved++; for(const r of rs){for(const d of r.dice)d.rollSingleDie=()=>2;await r.roll();}
        }},null,null);
        renderer.postDescription=async(req,title,source,attributes,description,attacks,info,damage)=>({
            title,whisper:req.whisper, parts:damage.map(([t,r])=>[t,r.total]),resolved});
        const parsed=wb20QuickFormulaParts('{F:3d6}+{P:1d6+6}+{D:3d8}');
        return renderer.handleRollRequest({type:'custom',name:'Test',modifier:parsed.display,whisper:1,'waybeyond20-damage-parts':parsed.parts});
    })()`,ctx);
    assert.equal(result.resolved,1);assert.equal(result.whisper,1);
    assert.deepEqual(JSON.parse(JSON.stringify(result.parts)),[['Fire',6],['Piercing',8],['Divine',6]]);
    assert.match(result.title,/\{P:1d6\+6\}/);
    ctx.getDiscordChannel=()=>null;ctx.postToDiscord=async()=>undefined;
    ctx.WhisperType={NO:0,YES:1,HIDE_NAMES:2};
    const rendered=await vm.runInContext(`(async()=>{
        let output; const renderer=new Beyond20RollRenderer({roll:f=>new DNDBRoll(f),resolveRolls:async(n,rs)=>{
            for(const r of rs){for(const d of r.dice)d.rollSingleDie=()=>2;await r.roll();}
        }},null,{postHTML:(...args)=>output=args});
        const parsed=wb20QuickFormulaParts('{Fire:3d6}+{Piercing:1d6+6}+{Radiant:3d8}');
        await renderer.handleRollRequest({type:'custom',character:{name:'Test',settings:{}},name:'Test',modifier:parsed.display,whisper:1,'waybeyond20-damage-parts':parsed.parts});
        return {html:output[2],whisper:output[4],total:output[12].Damage.total};
    })()`,ctx);
    assert.equal(rendered.total,20);assert.equal(rendered.whisper,1);
    for(const type of ['Fire','Piercing','Radiant'])assert.ok(rendered.html.includes(type+':'));
    console.log('PASS custom grammar, deterministic keep/drop/reroll/minimum totals, damage formula transport and Roll20/Foundry translation. No live VTT acceptance implied.');
})().catch(e=>{console.error(e);process.exitCode=1;});
