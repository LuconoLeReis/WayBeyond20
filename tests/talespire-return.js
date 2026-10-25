const assert=require('node:assert/strict'), fs=require('node:fs'), path=require('node:path'), vm=require('node:vm');
const {createBridge,normalizeSnapshot}=require('../companions/talespire/local-bridge.cjs');
const root=path.resolve(__dirname,'..'), ext='abcdefghijklmnopabcdefghijklmnop';
function snapshot() {return {v:1,campaignId:'campaign',boardId:'board',tracking:true,order:[{id:'enemy',name:'Enemy',kind:'creature'},{id:'calan',name:'Calan',kind:'creature'}],activeIndex:0,
    creatures:[{id:'enemy',name:'Enemy',boardId:'board',position:{x:3,y:4,z:12,locId:0}},{id:'calan',name:'Calan',boardId:'board',position:{x:0,y:0,z:0,locId:0}},{id:'other',name:'Other',boardId:'board',position:{x:1,y:1,z:0,locId:0}}],units:{name:'ft',numberPerTile:5},targetId:'enemy',targetRevision:1};}
function sheet() {
    const store={'waybeyond20-turn-state':{action:0,bonusAction:0,reaction:0,combatSource:'Roll20'},'waybeyond20-talespire-mini':{campaignId:'campaign',id:'calan'}};
    let writes=0;
    const c=vm.createContext({settings:{'vtt-tab':{vtt:'talespire'}},character:{getSetting:(key,fallback)=>store[key] ?? fallback,mergeCharacterSettings:(values,callback)=>{Object.assign(store,values); writes++; callback?.();}},
        setInterval:()=>{},Date,console,wayBeyond20GetTrackedSpellEffects:()=>[],wayBeyond20ScheduleActiveEffectBadgeRefresh:()=>{},
        wayBeyond20NormalizeTurnTrackerState:(s,e,options={})=>({...{action:1,bonusAction:1,reaction:1},...s,...(options.reset?{action:1,bonusAction:1,reaction:1,attacksRemaining:0}:{})}),
        wayBeyond20TurnTrackerStateEquals:(a,b)=>JSON.stringify(a)===JSON.stringify(b)});
    vm.runInContext(fs.readFileSync(path.join(root,'src/dndbeyond/content-scripts/talespire.js'),'utf8'),c);
    vm.runInContext(fs.readFileSync(path.join(root,'src/dndbeyond/content-scripts/my-target.js'),'utf8'),c);
    return {c,store,writes:()=>writes};
}
(async()=>{
    const state=normalizeSnapshot(snapshot()); assert.equal(state.creatures.length,3);
    assert.throws(()=>normalizeSnapshot({...snapshot(),creatures:Array(201).fill({})}),/snapshot/);
    const s=sheet(); s.c.wb20TSApplySnapshot(state);
    let saved=s.c.wb20TSGetState(); assert.equal(saved.combatSource,'TaleSpire'); assert.equal(saved.currentRoll20Turn.isThisCharactersTurn,false);
    assert.equal(saved.extraTargets.length,1,'out of initiative targets never added to compass');
    assert.equal(s.c.wb20TargetDistance(saved,saved.knownTargets[0]),'65 ft','3D distance includes height');
    assert.equal(s.store['waybeyond20-turn-state'].action,0,'Roll20 counters never overwritten');
    saved.action=0; saved.bonusAction=0; saved.reaction=0; s.c.wb20TSSetState(saved);
    const count=s.writes(); s.c.wb20TSApplySnapshot(state,true); assert.equal(s.c.wb20TSGetState().reaction,0); assert.equal(s.writes(),count,'duplicate snapshot does not save');
    s.c.wayBeyond20GetTurnTrackerState=()=>s.c.wb20TSGetState();
    s.c.wayBeyond20SetTurnTrackerState=(value,callback)=>s.c.wb20TSSetState(value,callback);
    const stale=structuredClone(s.c.wb20TSGetState());
    s.c.wb20TargetChoose(s.c.wb20TSKey('other'));
    s.c.wb20TSApplySnapshot(state,true);
    assert.equal(s.c.wb20TSGetState().selectedTargetKey,s.c.wb20TSKey('other'),'sheet choice survives repeated board pick');
    s.c.wb20TSSetState(stale); // Delayed settings snapshot must not replay the older pick.
    s.c.wb20TSApplySnapshot(state,true);
    assert.equal(s.c.wb20TSGetState().selectedTargetKey,s.c.wb20TSKey('other'),'sheet choice survives stale settings plus poll');
    s.c.wb20TSApplySnapshot({...state,targetRevision:state.targetRevision+1},true);
    assert.equal(s.c.wb20TSGetState().selectedTargetKey,s.c.wb20TSKey('enemy'),'new explicit board pick still replaces target');
    const own={...state,activeIndex:1}; s.c.wb20TSApplySnapshot(own,true);
    saved=s.c.wb20TSGetState(); assert.equal(saved.action,1); assert.equal(saved.localTurnNumber,1);
    saved.reaction=0; s.c.wb20TSSetState(saved); s.c.wb20TSApplySnapshot(own,true); assert.equal(s.c.wb20TSGetState().reaction,0,'same own turn never resets');
    s.c.wb20TSApplySnapshot(state,true); s.c.wb20TSApplySnapshot(own,false); assert.equal(s.c.wb20TSGetState().reaction,0,'reconnect is not new turn');
    const wrong=JSON.parse(JSON.stringify(saved.knownTargets[0])); wrong.position.locId=4;
    assert.equal(s.c.wb20TargetDistance(saved,wrong),null,'cross-sub-board distance refused');
    const foreign={...state,campaignId:'second'}; s.c.wb20TSApplySnapshot(foreign,true); assert.equal(s.c.wb20TSGetState().currentRoll20Turn.isThisCharactersTurn,false,'binding scoped to campaign');
    s.c.wb20TSApplySnapshot(own,false); assert.equal(s.c.wb20TSGetState().reaction,0,'campaign return restores state without reset');
    saved=s.c.wb20TSGetState(); saved.suppressedRoll20TurnKey=saved.currentRoll20Turn.turnKey; saved.inCombat=false; s.c.wb20TSSetState(saved);
    s.c.wb20TSApplySnapshot(own,true); assert.equal(s.c.wb20TSGetState().inCombat,false,'manual End Combat stays ended on duplicate native turn');
    assert.equal(s.store['waybeyond20-turn-state'].reaction,0);
    let clock=10000;
    const bridge=createBridge({extensionId:ext,now:()=>clock}); await new Promise(resolve=>bridge.server.listen(0,'127.0.0.1',resolve));
    try {
        const base='http://127.0.0.1:'+bridge.server.address().port;
        assert.equal((await fetch(base+'/pair',{headers:{Origin:'https://evil.test','X-WB20-Extension':ext}})).status,403);
        assert.equal((await fetch(base+'/pair',{headers:{Origin:'null','X-WB20-Extension':ext}})).status,403);
        assert.equal((await fetch(base+'/state')).status,401);
        const pair=await (await fetch(base+'/pair',{headers:{Origin:'chrome-extension://'+ext,'X-WB20-Extension':ext}})).json(); assert.equal(pair.key,bridge.key);
        const headers={Authorization:'Bearer '+pair.key,'Content-Type':'application/json'};
        assert.equal((await fetch(base+'/state',{method:'POST',headers,body:JSON.stringify(snapshot())})).status,200);
        const live=await (await fetch(base+'/state',{headers})).json(); assert.equal(live.connected,true); assert.equal(live.snapshot.activeIndex,0);
        clock+=11000; assert.equal((await (await fetch(base+'/state',{headers})).json()).connected,false,'stale feed is disconnected, not combat ended');
        assert.equal((await fetch(base+'/state',{method:'POST',headers,body:'invalid'})).status,400);
        assert.equal((await fetch(base+'/state',{method:'POST',headers,body:'x'.repeat(131073)})).status,413);
        assert.equal((await fetch(base+'/command',{method:'POST',headers,body:JSON.stringify({type:'set-hp'})})).status,400,'no game write command');
        await fetch(base+'/command',{method:'POST',headers,body:JSON.stringify({type:'pick-target'})});
        assert.equal((await (await fetch(base+'/commands',{headers})).json()).length,1);
        assert.equal((await (await fetch(base+'/commands',{headers})).json()).length,0,'no command replay');
    } finally {await new Promise(resolve=>bridge.server.close(resolve));}
    console.log('PASS TaleSpire loopback pairing, read-only protocol, scoped mini link, native order vs extra targets, 3D distance, no duplicate/reconnect reset and Roll20 isolation. Native game acceptance separate.');
})().catch(error=>{console.error(error);process.exitCode=1;});
