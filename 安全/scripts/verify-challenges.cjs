const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {spawn}=require('node:child_process'),{createServer}=require('../server');
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function main(){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'challenge-browser-')),edgeProfile=path.join(directory,'edge');
 const salt=crypto.randomBytes(16).toString('hex'),adminSalt=crypto.randomBytes(16).toString('hex');
 const users=[{id:'member',account:'member',name:'测试用户',role:'普通用户',salt,passwordHash:crypto.scryptSync('MemberTest123',salt,64).toString('hex')},{id:'admin',account:'admin',name:'管理员',role:'健康安全管理员',salt:adminSalt,passwordHash:crypto.scryptSync('AdminTest123',adminSalt,64).toString('hex')}];
 const usersFile=path.join(directory,'users.json');fs.writeFileSync(usersFile,JSON.stringify(users));const server=createServer({usersFile,dataDir:path.join(directory,'health'),weatherFetch:async()=>({ok:true,json:async()=>({current:{temperature_2m:18.6,weather_code:2},daily:{temperature_2m_max:[23,24],temperature_2m_min:[12,13],precipitation_probability_max:[60,20]}})})});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;
 const edge=spawn('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',['--headless','--no-sandbox','--disable-gpu','--no-first-run','--remote-debugging-port=0','--window-size=1440,1100','--user-data-dir='+edgeProfile,'about:blank'],{windowsHide:true,stdio:'ignore'});
 let socket;
 try{
  const portFile=path.join(edgeProfile,'DevToolsActivePort');for(let i=0;i<120&&!fs.existsSync(portFile);i++)await wait(100);assert.ok(fs.existsSync(portFile));
  const port=fs.readFileSync(portFile,'utf8').split('\n')[0],targets=await(await fetch('http://127.0.0.1:'+port+'/json/list')).json();socket=new WebSocket(targets.find(x=>x.type==='page').webSocketDebuggerUrl);await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject});
  let next=0;const pending=new Map(),errors=[];socket.onmessage=e=>{const m=JSON.parse(e.data);if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.text);if(m.id){const q=pending.get(m.id);pending.delete(m.id);m.error?q.reject(Error(m.error.message)):q.resolve(m.result)}};
  const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++next;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}))});
  const evalJs=async expression=>{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value};
  const until=async expression=>{for(let i=0;i<140;i++){if(await evalJs(expression))return;await wait(50)}throw Error('Timed out: '+expression)};
  await send('Runtime.enable');await send('Page.navigate',{url:base+'/#challenges'});await until('typeof ready!=="undefined"&&ready');
  await until('document.querySelector("#weatherTemp")?.textContent==="19°"');
  assert.ok(await evalJs('document.querySelector("#weatherTip").textContent.includes("外出带伞")'));
  assert.equal(await evalJs('document.querySelector("#quickSearch")'),null);
  assert.ok(await evalJs('document.body.innerText.includes("21天早睡挑战")'));
  await evalJs('document.querySelector("[data-challenge-start=sugar]").click()');assert.ok(await evalJs('document.querySelector("#modalBody").innerText.includes("请先登录账号")'));
  await evalJs('document.querySelector("#modalClose").click();fetch("/api/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({account:"member",password:"MemberTest123"})}).then(()=>loadAccount())');await until('ready&&!!user');
  await evalJs('document.querySelector("[data-challenge-start=sugar]").click()');await until('!saving&&data.challenges.sugar.length===1');
  await evalJs('document.querySelector("[data-challenge-check=sugar]").click()');await until('!saving&&data.challenges.sugar[0].days.length===1');await until('challengeRank.leaders.length===1');
  assert.ok(await evalJs('document.body.innerText.includes("初次打卡")'));
  await evalJs('document.querySelector("[data-challenge-start=water]").click()');await until('!saving&&data.challenges.water.length===1');
  await evalJs('document.querySelector("#challenge-ml").value="1800";document.querySelector("[data-challenge-check=water]").click()');await until('!saving&&data.challenges.water[0].days.length===1');
  await send('Page.reload');await until('typeof ready!=="undefined"&&ready&&data.challenges.water[0]?.days.length===1');
  assert.ok(await evalJs('document.documentElement.scrollWidth<=innerWidth'));
  const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});fs.writeFileSync(path.join(__dirname,'../challenge-desktop.png'),Buffer.from(shot.data,'base64'));
  await evalJs('window.confirm=()=>true;document.querySelector("[data-challenge-undo=water]").click()');await until('!saving&&data.challenges.water[0].days.length===0');
  await evalJs('fetch("/api/logout",{method:"POST"}).then(()=>loadAccount())');await until('ready&&!user');assert.equal(await evalJs('data.challenges.sugar.length'),0);
  await send('Page.navigate',{url:base+'/account/?mode=admin&returnTo=%2Fadmin%2F'});await until('document.querySelector("#loginHeading")?.innerText.includes("管理员")');
  await evalJs('document.querySelector("#account").value="admin";document.querySelector("#password").value="AdminTest123";document.querySelector("#loginForm").requestSubmit()');
  await until('location.pathname==="/admin/"&&document.querySelector("#adminContent")?.innerText.includes("注册普通用户")');
  await evalJs('document.querySelector("[data-tab=users]").click()');assert.ok(await evalJs('document.body.innerText.includes("测试用户")'));
  await evalJs('document.querySelector("[data-tab=challenges]").click()');assert.ok(await evalJs('document.body.innerText.includes("戒糖打卡")'));
  assert.deepEqual(errors,[]);console.log('PASS: guest login gate, user challenge persistence/rank/undo, admin login and dashboard, desktop layout.');await send('Browser.close').catch(()=>{});
 }finally{if(socket)socket.close();edge.kill();await new Promise(resolve=>{server.close(resolve);server.closeAllConnections()});await wait(500);fs.rmSync(directory,{recursive:true,force:true,maxRetries:5,retryDelay:100})}
}
main().catch(e=>{console.error(e);process.exitCode=1});
