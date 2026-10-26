// Desktop browser smoke check. Uses an isolated server and temporary accounts.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const {spawn}=require('node:child_process');
const {createServer}=require('../server');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));

async function main(){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'vision-browser-'));
 const profile=path.join(directory,'edge');
 const usersFile=path.join(directory,'users.json'),salt=crypto.randomBytes(16).toString('hex');
 fs.writeFileSync(usersFile,JSON.stringify([{id:'vision-check',account:'vision-check',name:'测试账号',role:'用户',salt,passwordHash:crypto.scryptSync('VisionTest123',salt,64).toString('hex')}]));
 const server=createServer({usersFile,dataDir:path.join(directory,'health')});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const base='http://127.0.0.1:'+server.address().port;
 const edge=spawn('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',[
  '--headless','--no-sandbox','--disable-gpu','--no-first-run','--remote-debugging-port=0',
  '--window-size=1440,1100','--user-data-dir='+profile,'about:blank'
 ],{windowsHide:true,stdio:'ignore'});
 let socket;
 try{
  const activePort=path.join(profile,'DevToolsActivePort');
  for(let i=0;i<120&&!fs.existsSync(activePort);i++)await delay(100);
  assert.ok(fs.existsSync(activePort),'Edge debugging endpoint should start');
  const port=fs.readFileSync(activePort,'utf8').split('\n')[0];
  const targets=await (await fetch('http://127.0.0.1:'+port+'/json/list')).json();
  const target=targets.find(item=>item.type==='page');
  socket=new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject});
  let sequence=0;const pending=new Map(),errors=[];
  socket.onmessage=event=>{
   const message=JSON.parse(event.data);
   if(message.method==='Runtime.exceptionThrown')errors.push(message.params.exceptionDetails.text);
   if(message.id){const request=pending.get(message.id);pending.delete(message.id);if(message.error)request.reject(Error(message.error.message));else request.resolve(message.result)}
  };
  const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++sequence;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}))});
  const evaluate=async expression=>{
   const result=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});
   if(result.exceptionDetails)throw Error(result.exceptionDetails.exception?.description||result.exceptionDetails.text);
   return result.result.value;
  };
  const until=async expression=>{for(let i=0;i<100;i++){if(await evaluate(expression))return;await delay(50)}throw Error('Timed out: '+expression)};
  await send('Runtime.enable');
  await send('Page.navigate',{url:base+'/#vision'});
  await until('typeof ready!=="undefined" && ready');
  assert.equal(await evaluate('document.querySelectorAll("[data-vision-start]").length'),3);
  assert.ok(await evaluate('document.body.innerText.includes("暂无视力记录")'));
  assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth'));
  await evaluate('document.querySelector("[data-vision-start=acuity]").click();document.querySelector("#visionSetup").requestSubmit()');
  assert.equal(await evaluate('document.querySelector(".vision-optotype-stage")===null'),true);
  await evaluate('document.querySelector("#visionSetup input[type=checkbox]").checked=true;document.querySelector("#visionSetup").requestSubmit()');
  for(let i=0;i<3;i++)await evaluate('document.querySelector("#visionUnsure").click()');
  await evaluate('document.querySelector("#visionNextEye").click()');
  for(let i=0;i<3;i++)await evaluate('document.querySelector("#visionUnsure").click()');
  assert.ok(await evaluate('document.querySelector("#modalBody").innerText.includes("低于 0.1")'));
  await evaluate('document.querySelector("#visionSaveResult").click()');
  assert.ok(await evaluate('document.querySelector("#modalBody").innerText.includes("请先登录账号")'));
  await evaluate('document.querySelector("#modalClose").click()');
  await evaluate('fetch("/api/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({account:"vision-check",password:"VisionTest123"})}).then(()=>loadAccount())');
  await until('ready&&!!user');
  await evaluate('document.querySelector("[data-vision-start=astigmatism]").click();document.querySelector("#astigmatism-left").value="均匀";document.querySelector("#astigmatism-right").value="不确定";document.querySelector("#astigmatismForm").requestSubmit();document.querySelector("#visionSaveResult").click()');
  await until('!saving&&data.vision.length===1');
  await send('Page.reload');await until('typeof ready!=="undefined"&&ready&&data.vision.length===1');
  assert.ok(await evaluate('document.querySelector("[data-delete=vision]")!==null'));
  await evaluate('window.confirm=()=>true;document.querySelector("[data-delete=vision]").click()');
  await until('!saving&&data.vision.length===0');
  await evaluate('document.querySelector("[data-vision-start=color]").click();document.querySelector("#visionColorBegin").click()');
  for(let i=0;i<6;i++)await evaluate('document.querySelector("[data-color=\\\""+visionSession.target+"\\\"]").click()');
  assert.equal(await evaluate('visionSession.result.correct'),6);
  await evaluate('document.querySelector("#visionSaveResult").click()');
  await until('!saving&&data.vision.length===1');
  await evaluate('document.querySelector("[data-vision-start=acuity]").click()');
  assert.ok(await evaluate('document.querySelector(".modal-card").scrollWidth<=document.querySelector(".modal-card").clientWidth'));
  const screenshot=await send('Page.captureScreenshot',{format:'png'});
  fs.writeFileSync(path.join(__dirname,'../vision-setup-desktop.png'),Buffer.from(screenshot.data,'base64'));
  assert.deepEqual(errors,[]);
  console.log('PASS: desktop navigation, calibration gate, both eyes, guest login prompt, account save/reload/delete and six color rounds. No browser exceptions.');
  await send('Browser.close').catch(()=>{});
 }finally{
  if(socket)socket.close();
  edge.kill();
  await new Promise(resolve=>{server.close(resolve);server.closeAllConnections()});
  await delay(500);
  fs.rmSync(directory,{recursive:true,force:true,maxRetries:5,retryDelay:100});
 }
}
main().catch(error=>{console.error(error);process.exitCode=1});
