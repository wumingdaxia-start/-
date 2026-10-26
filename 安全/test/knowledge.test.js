const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const {createServer}=require('../server');
const {retrieve,answer}=require('../health-knowledge');

test('本地健康资料检索按主题返回官方来源，不相关问题不伪造结果',()=>{
 const sleep=retrieve('成年人每天睡眠需要多久？');
 assert.equal(sleep[0].id,'cdc-sleep-hours');
 assert.equal(retrieve('成年人每天需要睡多久？')[0].id,'cdc-sleep-hours');
 assert.match(sleep[0].url,/^https:\/\/www\.cdc\.gov\/sleep\//);
 const sugar=retrieve('戒糖是不是不能吃水果？');
 assert.equal(sugar[0].id,'who-diet-sugar');
 assert.match(sugar[0].excerpt,/游离糖/);
 assert.deepEqual(retrieve('股票预测模型'),[]);
 assert.deepEqual(retrieve('x'),[]);
});

test('资料不足或急症时不调用模型',async()=>{
 let calls=0;
 const request=async()=>{calls++;throw Error('不应调用模型')};
 const missing=await answer('股票预测模型',[],{request});
 assert.equal(missing.covered,false);
 const urgent=await answer('突然胸痛，呼吸困难',retrieve('突然胸痛，呼吸困难'),{request});
 assert.equal(urgent.urgent,true);
 assert.match(urgent.answer,/急救/);
 assert.equal(calls,0);
});

test('知识问答需要登录和授权，只把问题及检索片段交给模型',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ankang-knowledge-'));
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const users=['alice','admin'].map(account=>{const salt=crypto.randomBytes(16).toString('hex');return{id:account,account,name:account,role:account==='admin'?'健康安全管理员':'普通用户',salt,passwordHash:crypto.scryptSync('Test123456',salt,64).toString('hex')}});
 const usersFile=path.join(dir,'users.json');fs.writeFileSync(usersFile,JSON.stringify(users));
 const prompts=[];
 const server=createServer({usersFile,dataDir:path.join(dir,'health'),aiEnv:{HEALTH_AI_API_KEY:'test-key',HEALTH_AI_MODEL:'test-model',HEALTH_AI_BASE_URL:'http://127.0.0.1:9999/v1'},aiFetch:async(url,options)=>{prompts.push(JSON.parse(options.body));return{ok:true,json:async()=>({choices:[{message:{content:'成年人睡眠时长可参考每晚至少 7 小时，仍需结合个人情况。'}}]})}}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>{server.close();server.closeAllConnections()});
 const base='http://127.0.0.1:'+server.address().port;
 const request=async(route,{method='GET',cookie,user,body}={})=>{const response=await fetch(base+route,{method,headers:{...(cookie?{Cookie:cookie}:{}),...(user?{'X-Health-User':user}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});return{status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]}};
 const login=async(account,mode='user')=>(await request('/api/login',{method:'POST',body:{account,password:'Test123456',mode}})).cookie;
 const alice=await login('alice'),admin=await login('admin','admin');
 const search=await request('/api/health-knowledge/search?query='+encodeURIComponent('成年人需要多少睡眠'));
 assert.equal(search.status,200);assert.equal(search.data.sources[0].id,'cdc-sleep-hours');
 assert.equal((await request('/api/health-knowledge/search?query=x')).status,400);
 const ask=(cookie,user,question='成年人需要多少睡眠',consent=true)=>request('/api/health-knowledge/answer',{method:'POST',cookie,user,body:{question,consent}});
 assert.equal((await ask(null,null)).status,401);
 assert.equal((await ask(admin,'admin')).status,403);
 assert.equal((await ask(alice,'admin')).status,409);
 assert.equal((await ask(alice,'alice','成年人需要多少睡眠',false)).status,400);
 assert.equal(prompts.length,0);
 const empty=await ask(alice,'alice','股票预测模型');
 assert.equal(empty.status,200);assert.equal(empty.data.covered,false);assert.equal(prompts.length,0);
 const result=await ask(alice,'alice');
 assert.equal(result.status,200);assert.equal(result.data.sources[0].id,'cdc-sleep-hours');
 assert.match(result.data.answer,/睡眠/);
 assert.equal(prompts.length,1);
 const sent=JSON.stringify(prompts[0]);
 assert.match(sent,/美国疾病控制与预防中心/);
 assert.match(sent,/成年人需要多少睡眠/);
 assert.doesNotMatch(sent,/test-key|passwordHash|medicalNotes/);
});
