// Read-only game observations. The only native operation is the user's picking tool.
var wb20ReturnTimer, wb20ReturnBusy=false, wb20ReturnPicking='', wb20ReturnTarget='', wb20ReturnTargetRevision=0;
var wb20ReturnTracking=false, wb20ReturnContext='';
var wb20ReturnSession=crypto.randomUUID();
var wb20ReturnLastStatus='';
function wb20ReturnNotice(text) {
    document.getElementById('return-status').textContent=text;
    if (text !== wb20ReturnLastStatus) {
        wb20ReturnLastStatus=text;
        try {TS.debug.log({event:'wb20-return-status',message:text}).catch(()=>{});} catch (_) {}
    }
}
async function wb20ReturnFetch(route, data) {
    const response=await fetch('http://127.0.0.1:48874'+route,{method:data === undefined?'GET':'POST',
        headers:{Authorization:'Bearer '+wb20LocalReturnKey,...(data === undefined?{}:{'Content-Type':'application/json'})},
        ...(data === undefined?{}:{body:JSON.stringify(data)}),signal:AbortSignal.timeout(3500)});
    if (!response.ok) throw Error('Local helper unavailable');
    return response.json();
}
async function wb20ReturnPick() {
    if (wb20ReturnPicking) return;
    wb20ReturnPicking=await wb20TaleSpireCall(TS.picking.startPicking());
    document.getElementById('return-status').textContent='Click a mini on the board to choose your target. Escape cancels.';
}
function wb20ReturnPicked(event) {
    if (event.payload?.id !== wb20ReturnPicking) return;
    wb20ReturnPicking='';
    if (event.kind === 'pickingCompleted' && event.payload.kindOfPicked === 'creature') {
        wb20ReturnTarget=event.payload.idOfPicked; wb20ReturnTargetRevision++;
    }
    wb20ReturnPoll();
}
async function wb20ReturnPoll() {
    if (wb20ReturnBusy || !wb20LocalReturnKey) return;
    wb20ReturnBusy=true;
    try {
        const board=await wb20TaleSpireCall(TS.boards.whereAmI());
        const campaign=await wb20TaleSpireCall(TS.campaigns.whereAmI());
        if (!board?.id || !campaign?.id) throw Error('Load a board to connect');
        const context=campaign.id+'|'+board.id;
        if (wb20ReturnContext !== context) {
            wb20ReturnContext=context; wb20ReturnTracking=false; wb20ReturnTarget=''; wb20ReturnTargetRevision++;
            document.getElementById('follow-turns').checked=false;
        }
        const queue=await wb20TaleSpireCall(TS.initiative.getQueue());
        const selected=await wb20TaleSpireCall(TS.creatures.getSelectedCreatures());
        const owned=await wb20TaleSpireCall(TS.creatures.getCreaturesOwnedByPlayer(await wb20TaleSpireCall(TS.players.whoAmI())));
        // Do not enumerate hidden campaign creatures. Start with exposed turns,
        // the player's own minis, their selection, and explicitly picked target.
        const order=(queue?.items || []).filter(c=>c.kind === 'creature').slice(0,200);
        const ids=[...new Set([...order.map(c=>c.id),...(selected || []).map(c=>c.id),...(owned || []).map(c=>c.id),wb20ReturnTarget].filter(Boolean))].slice(0,200);
        const info=ids.length?await wb20TaleSpireCall(TS.creatures.getMoreInfo(ids)):[];
        const creatures=(Array.isArray(info)?info:[]).filter(c=>c.boardId === board.id && !c.isExplicitlyHidden)
            .map(c=>({id:c.id,name:c.name,boardId:c.boardId,position:c.position}));
        const visible=new Set(creatures.map(c=>c.id));
        const nativeCurrent=queue?.items?.[queue.activeItemIndex]?.id;
        const visibleOrder=order.filter(c=>visible.has(c.id));
        const units=await wb20TaleSpireCall(TS.units.getDistanceUnitsForThisCampaign());
        await wb20ReturnFetch('/state',{v:1,campaignId:campaign.id,boardId:board.id,creatures,order:visibleOrder,
            activeIndex:visibleOrder.findIndex(c=>c.id === nativeCurrent),activeHidden:!!nativeCurrent && !visible.has(nativeCurrent),units,tracking:wb20ReturnTracking,
            targetId:wb20ReturnTarget,targetRevision:wb20ReturnTargetRevision,targetSession:wb20ReturnSession});
        for (const command of await wb20ReturnFetch('/commands')) if (command.type === 'pick-target') await wb20ReturnPick();
        wb20ReturnNotice(`Connected · ${creatures.length} minis · ${wb20ReturnTracking?'following turns':'turn following paused'}`);
    } catch (error) {wb20ReturnNotice(String(error.message || error));}
    finally {wb20ReturnBusy=false;}
}
function wb20ReturnState(event) {
    if (event.kind !== 'hasInitialized') return;
    clearInterval(wb20ReturnTimer);
    const follow=document.getElementById('follow-turns');
    follow.onchange=()=>{wb20ReturnTracking=follow.checked; wb20ReturnPoll();};
    document.getElementById('pick-target').onclick=()=>wb20ReturnPick().catch(error=>{document.getElementById('return-status').textContent=String(error.message || error);});
    wb20ReturnTimer=setInterval(wb20ReturnPoll,1500);
    wb20ReturnPoll();
}
