// Desktop browser smoke check for the exercise and diet plans. Uses isolated temporary data.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const {spawn}=require('node:child_process');
const {createServer}=require('../server');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));

async function main(){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'plans-browser-'));
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

  const fill=async(selector,values)=>evaluate('(()=>{const form=document.querySelector('+JSON.stringify(selector)+');const values='+JSON.stringify(values)+';for(const [name,value] of Object.entries(values))form.elements[name].value=value;form.requestSubmit()})()');
  const screenshot=async name=>{await evaluate('document.getAnimations().filter(a=>a.effect?.getTiming().iterations!==Infinity).forEach(a=>a.finish());new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');const result=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});fs.writeFileSync(path.join(__dirname,'../'+name),Buffer.from(result.data,'base64'))};
  await send('Page.navigate',{url:base+'/#exercise'});
  await until('typeof ready!=="undefined"&&ready');
  assert.ok(await evaluate('document.body.innerText.includes("暂无锻炼计划")'));
  assert.ok(await evaluate('document.body.innerText.indexOf("锻炼记录")<document.body.innerText.indexOf("制定锻炼计划")'));
  await evaluate('document.querySelector("[data-plan-new=exercise]").click()');
  assert.ok(await evaluate('Array.from(document.querySelectorAll("#planSetup input,#planSetup select")).every(x=>!x.value)'));
  await fill('#planSetup',{goal:'增肌',level:'初学',equipment:'徒手',days:'3',minutes:'30',startDate:'2026-10-21'});
  await evaluate('document.querySelector("#planEditor").requestSubmit()');
  assert.ok(await evaluate('document.querySelector("#modalBody").innerText.includes("请先登录账号")'));
  assert.equal(await evaluate('data.exercisePlan'),null);
  await evaluate('document.querySelector("#modalClose").click();fetch("/api/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({account:"profile-check",password:"ProfileTest123"})}).then(()=>loadAccount())');
  await until('ready&&!!user');
  await evaluate('document.querySelector("[data-plan-new=exercise]").click()');
  await fill('#planSetup',{goal:'增肌',level:'有基础',equipment:'哑铃',days:'4',minutes:'40',startDate:'2026-10-21'});
  await fill('#planEditor',{content0:'哑铃深蹲 2 组，每组 10 次；结束后舒缓拉伸。'});
  await until('!saving&&!!data.exercisePlan');
  assert.equal(await evaluate('coverage()'),0);
  await send('Page.reload');
  await until('typeof ready!=="undefined"&&ready&&!!data.exercisePlan');
  assert.ok(await evaluate('document.body.innerText.includes("哑铃深蹲 2 组")'));
  assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth'));
  await screenshot('exercise-plan-desktop.png');
  await evaluate('document.querySelector("[data-plan-edit=exercise]").click()');
  await fill('#planEditor',{content0:'修改后的哑铃训练与舒缓拉伸。'});
  await until('!saving&&data.exercisePlan.items[0].content.startsWith("修改后")');
  await evaluate('location.hash="diet"');
  await until('!!document.querySelector("[data-plan-new=diet]")');
  assert.ok(await evaluate('document.body.innerText.indexOf("饮食记录")<document.body.innerText.indexOf("制定饮食计划")'));
  await evaluate('document.querySelector("[data-plan-new=diet]").click()');
  await evaluate('document.querySelectorAll("[name=exclusions]").forEach(x=>x.checked=true)');
  await fill('#planSetup',{goal:'减脂',sex:'女',age:'30',height:'165',weight:'60',activity:'轻度活动',preference:'蛋奶素',notes:'少辣'});
  assert.equal(await evaluate('planDraft.targets.calories'),1515);
  assert.ok(await evaluate('!planDraft.items.some(x=>/鸡蛋|牛奶|豆腐|鸡胸/.test(x.content))'));
  await fill('#planEditor',{content0:'燕麦与苹果、熟扁豆（自定义分量）',calories0:'400',protein0:'15'});
  await until('!saving&&!!data.dietPlan');
  await send('Page.reload');await until('typeof ready!=="undefined"&&ready&&!!data.dietPlan');
  assert.equal(await evaluate('data.dietPlan.items[0].calories'),400);
  assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth'));
  await screenshot('diet-plan-desktop.png');
  // A failed write must keep the saved plan and the edited form available.
  await evaluate('document.querySelector("[data-plan-edit=diet]").click();window.originalFetch=window.fetch;window.fetch=(url,options)=>url==="/api/health-data"&&options?.method==="PUT"?Promise.resolve({ok:false,status:500,json:async()=>({message:"模拟保存失败"})}):window.originalFetch(url,options)');
  await fill('#planEditor',{content0:'不应覆盖原来的计划'});
  await until('!saving');
  assert.equal(await evaluate('data.dietPlan.items[0].content'),'燕麦与苹果、熟扁豆（自定义分量）');
  assert.ok(await evaluate('!document.querySelector("#modal").hidden&&!document.querySelector(".plan-save").disabled'));
  await evaluate('window.fetch=window.originalFetch;document.querySelector("#modalClose").click();window.confirm=()=>false;document.querySelector("[data-plan-remove=diet]").click()');
  assert.ok(await evaluate('!!data.dietPlan'));
  await evaluate('window.confirm=()=>true;document.querySelector("[data-plan-remove=diet]").click()');
  await until('!saving&&data.dietPlan===null');
  assert.ok(await evaluate('!!data.exercisePlan&&data.exercise.length===0&&data.diet.length===0'));
  await send('Page.reload');await until('typeof ready!=="undefined"&&ready');
  assert.equal(await evaluate('data.dietPlan'),null);
  await evaluate('logout()');await until('ready&&!user');
  assert.equal(await evaluate('data.exercisePlan'),null);
  assert.ok(await evaluate('document.body.innerText.includes("暂无饮食计划")'));
  assert.deepEqual(errors,[]);
  console.log('PASS: empty guest forms/login gate, weekly plan, dietary exclusions, editing, save/reload, failure recovery, deletion, logout and desktop layout. No browser exceptions.');
  await send('Browser.close').catch(()=>{});
 }finally{
  if(socket)socket.close();edge.kill();
  await new Promise(resolve=>{server.close(resolve);server.closeAllConnections()});
  await delay(500);fs.rmSync(directory,{recursive:true,force:true,maxRetries:5,retryDelay:100});
 }
}
main().catch(error=>{console.error(error);process.exitCode=1});
