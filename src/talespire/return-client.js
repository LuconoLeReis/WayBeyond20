// Background-only HTTP client. Only fixed loopback URLs; never fetch a game-supplied URL.
var wb20TaleSpireReturnKey='';
async function wb20TaleSpireReturnRequest(route, data) {
    if (!['/state','/command'].includes(route)) throw Error('Invalid return request');
    if (!wb20TaleSpireReturnKey) {
        const pair=await fetch('http://127.0.0.1:48874/pair',{headers:{'X-WB20-Extension':chrome.runtime.id},signal:AbortSignal.timeout(2500)});
        if (!pair.ok) throw Error('WB20 local helper is not paired');
        const result=await pair.json();
        if (!/^[a-f0-9]{64}$/.test(result.key)) throw Error('Invalid helper pairing');
        wb20TaleSpireReturnKey=result.key;
    }
    const response=await fetch('http://127.0.0.1:48874'+route,{method:data?'POST':'GET',
        headers:{Authorization:'Bearer '+wb20TaleSpireReturnKey,...(data?{'Content-Type':'application/json'}:{})},
        ...(data?{body:JSON.stringify(data)}:{}),signal:AbortSignal.timeout(2500)});
    if (response.status === 401) wb20TaleSpireReturnKey='';
    if (!response.ok) throw Error('WB20 local helper unavailable');
    return response.json();
}
function wb20TaleSpireReturnMessage(request,sender,respond) {
    if (settings['vtt-tab']?.vtt !== 'talespire' || !/^https:\/\/(?:www\.)?dndbeyond\.com\/characters\/\d+(?:\/|$)/.test(sender.tab?.url || '')) {
        respond({connected:false}); return;
    }
    const operation=request.action === 'wb20-talespire-pick'
        ? wb20TaleSpireReturnRequest('/command',{type:'pick-target'}) : wb20TaleSpireReturnRequest('/state');
    operation.then(respond,()=>respond({connected:false}));
}
