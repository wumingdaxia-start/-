const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {spawn}=require('node:child_process'),{createServer}=require('../server');
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function main(){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'consult-browser-')),profile=path.join(dir,'edge');
 const salt=crypto.randomBytes(16).toString('hex'),user={id:'member',account:'member',name:'测试用户',role:'普通用户',salt,passwordHash:crypto.scryptSync('MemberTest123',salt,64).toString('hex')};
 const usersFile=path.join(dir,'users.json');fs.writeFileSync(usersFile,JSON.stringify([user]));
 const server=createServer({usersFile,dataDir:path.join(dir,'health'),consultDir:path.join(dir,'consult'),aiEnv:{HEALTH_AI_API_KEY:'test-key',HEALTH_AI_MODEL:'test-model'},aiFetch:async()=>({ok:true,json:async()=>({choices:[{message:{content:'请记录症状和持续时间，必要时线下就医。'}}]})})});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;
 const edge=spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',['--headless','--no-sandbox','--disable-gpu','--no-first-run','--remote-debugging-port=0','--window-size=1440,1100','--user-data-dir='+profile,'about:blank'],{windowsHide:true,stdio:'ignore'});
 let socket;
 try{
  const portFile=path.join(profile,'DevToolsActivePort');for(let i=0;i<120&&!fs.existsSync(portFile);i++)await wait(100);assert.ok(fs.existsSync(portFile),'Edge did not launch');
  const port=fs.readFileSync(portFile,'utf8').split('\n')[0],targets=await(await fetch('http://127.0.0.1:'+port+'/json/list')).json();socket=new WebSocket(targets.find(x=>x.type==='page').webSocketDebuggerUrl);await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject});
  let next=0;const pending=new Map(),errors=[];socket.onmessage=e=>{const m=JSON.parse(e.data);if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.text);if(m.id){const q=pending.get(m.id);pending.delete(m.id);m.error?q.reject(Error(m.error.message)):q.resolve(m.result)}};
  const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++next;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}))});
  const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value};
  const until=async expression=>{for(let i=0;i<140;i++){if(await evaluate(expression))return;await wait(50)}throw Error('Timed out: '+expression)};
  await send('Runtime.enable');await send('Page.navigate',{url:base+'/#consult'});await until('typeof ready!=="undefined"&&ready');
  assert.ok(await evaluate('document.body.innerText.includes("AI 健康问诊")'));
  await evaluate('document.querySelector("#consultInput").value="游客提问";document.querySelector("#consultForm").requestSubmit()');
  assert.ok(await evaluate('document.querySelector("#modalBody").innerText.includes("请先登录账号")'));
  await evaluate('document.querySelector("#modalClose").click();fetch("/api/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({account:"member",password:"MemberTest123"})}).then(()=>loadAccount())');await until('ready&&!!user');
  await evaluate('document.querySelector("#consultInput").value="睡不太好";document.querySelector("#consultForm").requestSubmit()');await until('consultMessages.length===2&&!consultLoading');
  assert.ok(await evaluate('document.body.innerText.includes("请记录症状和持续时间")'));
  await send('Page.reload');await until('typeof ready!=="undefined"&&ready&&consultMessages.length===2');
  assert.ok(await evaluate('document.body.innerText.includes("睡不太好")'));assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth'));
  await evaluate('window.confirm=()=>true;document.querySelector("#consultClear").click()');await until('consultMessages.length===0&&!consultLoading');
  await evaluate('fetch("/api/logout",{method:"POST"}).then(()=>loadAccount())');await until('ready&&!user');assert.equal(await evaluate('consultMessages.length'),0);
  assert.deepEqual(errors,[]);console.log('PASS: guest gate, AI chat, persistence, clear, logout and desktop layout.');await send('Browser.close').catch(()=>{});
 }finally{if(socket)socket.close();edge.kill();await new Promise(resolve=>{server.close(resolve);server.closeAllConnections()});await wait(500);fs.rmSync(dir,{recursive:true,force:true,maxRetries:5,retryDelay:100})}
}
main().catch(e=>{console.error(e);process.exitCode=1});
