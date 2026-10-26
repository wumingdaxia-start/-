// Desktop browser smoke check for the personal profile. Uses isolated temporary data.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const {spawn}=require('node:child_process');
const {createServer}=require('../server');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));

async function main(){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'profile-browser-'));
 const edgeProfile=path.join(directory,'edge');
 const usersFile=path.join(directory,'users.json'),salt=crypto.randomBytes(16).toString('hex');
 fs.writeFileSync(usersFile,JSON.stringify([{id:'profile-check',account:'profile-check',name:'档案测试账号',role:'用户',salt,passwordHash:crypto.scryptSync('ProfileTest123',salt,64).toString('hex')}]))
 const server=createServer({usersFile,dataDir:path.join(directory,'health')});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const base='http://127.0.0.1:'+server.address().port;
 const edge=spawn('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',[
  '--headless','--no-sandbox','--disable-gpu','--no-first-run','--remote-debugging-port=0',
  '--window-size=1440,1100','--user-data-dir='+edgeProfile,'about:blank'
 ],{windowsHide:true,stdio:'ignore'});
 let socket;
 try{
  const activePort=path.join(edgeProfile,'DevToolsActivePort');
  for(let i=0;i<120&&!fs.existsSync(activePort);i++)await delay(100);
  assert.ok(fs.existsSync(activePort),'Edge debugging endpoint should start');
  const port=fs.readFileSync(activePort,'utf8').split('\n')[0];
  const targets=await (await fetch('http://127.0.0.1:'+port+'/json/list')).json();
  socket=new WebSocket(targets.find(item=>item.type==='page').webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject});
  let sequence=0;const pending=new Map(),errors=[];
  socket.onmessage=event=>{
   const message=JSON.parse(event.data);
   if(message.method==='Runtime.exceptionThrown')errors.push(message.params.exceptionDetails.text);
   if(message.id){const request=pending.get(message.id);pending.delete(message.id);if(message.error)request.reject(Error(message.error.message));else request.resolve(message.result)}
  };
  const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++sequence;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}))});
  const evaluate=async expression=>{const result=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(result.exceptionDetails)throw Error(result.exceptionDetails.exception?.description||result.exceptionDetails.text);return result.result.value};
  const until=async expression=>{for(let i=0;i<120;i++){if(await evaluate(expression))return;await delay(50)}throw Error('Timed out: '+expression)};
  await send('Runtime.enable');
  await send('Page.navigate',{url:base+'/#profile'});
  await until('typeof ready!=="undefined"&&ready');
  assert.ok(await evaluate('document.querySelector("[data-route=profile]")!==null'));
  assert.ok(await evaluate('document.body.innerText.includes("填写个人信息")'));
  assert.equal(await evaluate('data.profile'),null);
  await evaluate('document.querySelector("[name=displayName]").value="游客";document.querySelector("#profileForm").requestSubmit()');
  assert.ok(await evaluate('document.querySelector("#modalBody").innerText.includes("请先登录账号")'));
  await evaluate('document.querySelector("#modalClose").click();fetch("/api/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({account:"profile-check",password:"ProfileTest123"})}).then(()=>loadAccount())');
  await until('ready&&!!user');
  await evaluate(`(()=>{const values={displayName:'林安',gender:'女',birthDate:'2000-01-02',bloodType:'A型',heightCm:'165.5',weightKg:'55.2',activityLevel:'中等活动',healthGoal:'保持状态',allergies:'花生',medicalNotes:'定期复查',emergencyContact:'家人',emergencyPhone:'138-0000-0000'};for(const [name,value] of Object.entries(values))document.querySelector('[name='+name+']').value=value;document.querySelector('#profileForm').requestSubmit()})()`);
  await until('!saving&&data.profile&&data.profile.displayName==="林安"');
  await send('Page.reload');
  await until('typeof ready!=="undefined"&&ready&&data.profile&&data.profile.displayName==="林安"');
  assert.equal(await evaluate('document.querySelector("[name=heightCm]").value'),'165.5');
  assert.ok(await evaluate('document.body.innerText.includes("身体质量指数参考")'));
  assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth'));
  const screenshot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});
  fs.writeFileSync(path.join(__dirname,'../profile-desktop.png'),Buffer.from(screenshot.data,'base64'));
  await evaluate('window.confirm=()=>true;document.querySelector("#clearProfile").click()');
  await until('!saving&&data.profile===null');
  assert.deepEqual(errors,[]);
  console.log('PASS: guest gate, account profile save, reload, desktop layout and clear flow. No browser exceptions.');
  await send('Browser.close').catch(()=>{});
 }finally{
  if(socket)socket.close();edge.kill();
  await new Promise(resolve=>{server.close(resolve);server.closeAllConnections()});
  await delay(500);fs.rmSync(directory,{recursive:true,force:true,maxRetries:5,retryDelay:100});
 }
}
main().catch(error=>{console.error(error);process.exitCode=1});
