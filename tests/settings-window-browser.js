// Isolated settings-window fixture. Never attaches to a user's Chrome profile.
const {chromium} = require(process.env.WB20_PLAYWRIGHT || 'playwright');
const fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const boot = `<script>
if(window.self===window.top){window.testMessages=[];}
const data={settings:{"migrated-sync-settings":true}};
window.chrome={runtime:{
 getURL:p=>location.origin+'/'+p,
 getManifest:()=>({version:'test'}),
 sendMessage:(m,cb)=>{
  top.testMessages.push(m);
  if(m.action==='get-current-tab')cb({id:1,url:'https://www.dndbeyond.com/characters/123',title:'Fixture'});
  else if(m.action==='forward'){
   if(m.message.action==='get-character')cb({id:123,name:'Fixture',classes:{Bard:3},settings:{},
    'racial-traits':[],'class-features':[],'feats':[]});
   if(m.message.action==='open-options')parent.setTimeout(()=>parent.alertFullSettings(),0);
  }
 }
},storage:{local:{
 get:(q,cb)=>cb(typeof q==='object'?Object.assign({},q,data):data),
 set:(q,cb)=>{Object.assign(data,q);if(cb)cb();},
 remove:(q,cb)=>{if(cb)cb();}
}}};
</script>`;
const server=http.createServer((req,res)=>{
 const pathname=new URL(req.url,'http://fixture').pathname;
 if(pathname==='/fixture'){
  res.setHeader('Content-Type','text/html');
  res.end(`<html><head><link rel="stylesheet" href="/libs/css/alertify.css">
   <link rel="stylesheet" href="/libs/css/alertify-themes/default.css"></head>
   <body><button id="quick" onclick="alertQuickSettings()">WB20</button>
   ${boot}<script src="/libs/alertify.min.js"></script>
   <script src="/src/common/utils.js"></script></body></html>`);
  return;
 }
 const file=path.resolve(root,'.'+pathname);
 if(pathname==='/dist/popup.js'||pathname==='/dist/options.js'){
  const entry=pathname.endsWith('/popup.js')?'popup':'options';
  res.setHeader('Content-Type','text/javascript');
  res.end(['src/common/constants.js','src/common/utils.js','libs/FileSaver.min.js',
   'src/common/settings.js',`src/extension/${entry}.js`].map(p=>fs.readFileSync(path.join(root,p),'utf8')).join('\n'));
  return;
 }
 if(!file.startsWith(root+path.sep)||!fs.existsSync(file)){res.writeHead(404);res.end();return;}
 res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.html')?'text/html':'application/octet-stream');
 let content=fs.readFileSync(file);
 if(file.endsWith('.html'))content=content.toString().replace('<head>','<head>'+boot);
 res.end(content);
});
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{
  const page=await browser.newPage();
  const errors=[];
  page.on('pageerror',e=>{errors.push(e.message);console.error('PAGE ERROR',e.message);});
  await page.goto(`http://127.0.0.1:${server.address().port}/fixture`);
  await page.locator('#quick').click();
  const quick=page.frameLocator('.ajs-content iframe');
  await quick.getByText('More Options',{exact:true}).waitFor();
  console.log('Quick settings rendered');
  await quick.getByText('▼ Effects',{exact:true}).click();
  await quick.getByText('▼ Effects',{exact:true}).click();
  await page.evaluate(()=>window.originalFrame=document.querySelector('.ajs-content iframe'));
  await quick.getByText('More Options',{exact:true}).click();
  await page.frameLocator('.ajs-content iframe').getByRole('button',{name:'Advanced Options',exact:true}).waitFor({timeout:5000});
  console.log('Full settings rendered');
  assert.deepEqual(errors,[]);
  // Observe the existing host-message transition, not a preferred implementation.
  assert.equal(await page.evaluate(()=>window.testMessages.some(m=>m.message?.action==='open-options')),true);
  assert.equal(page.isClosed(),false,'Containing sheet remains open');
  await page.frameLocator('.ajs-content iframe').getByRole('button',{name:'Advanced Options',exact:true}).click();
  await page.frameLocator('.ajs-content iframe').getByRole('button',{name:'Basic Options',exact:true}).waitFor();
  await page.locator('.ajs-footer button').click();
  await page.locator('#quick').click();
  await page.frameLocator('.ajs-content iframe').getByText('More Options',{exact:true}).waitFor();
  console.log('Settings transition, advanced switch, close and reopen passed');
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
