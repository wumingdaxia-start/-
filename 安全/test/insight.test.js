const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const {createServer}=require('../server');
const {summarize,evidence,generate}=require('../health-insight');

test('七天摘要只包含汇总指标，忽略过期、未来及无日期记录',()=>{
 const records={
  exercise:[{date:'2026-10-25',name:'慢跑',minutes:30,calories:100},{date:'2026-10-18',name:'快走',minutes:60,calories:200},{name:'旧记录',minutes:20,calories:50}],
  diet:[{date:'2026-10-24',food:'私人饮食文字',meal:'晚餐',calories:500,protein:20}],
  sleep:[{date:'2026-10-23',hours:7.5,quality:4},8,{date:'2026-10-26',hours:6}]
 };
 const {snapshot,hasRecords}=summarize(records,'2026-10-25');
 assert.equal(hasRecords,true);
 assert.deepEqual(snapshot.period,{startDate:'2026-10-19',endDate:'2026-10-25',days:7});
 assert.deepEqual(snapshot.exercise,{days:1,sessions:1,minutes:30});
 assert.deepEqual(snapshot.diet,{days:1,meals:1,recordedCalories:500,recordedProteinGrams:20});
 assert.deepEqual(snapshot.sleep,{days:1,entries:1,averageHours:7.5,ratedEntries:1,averageQuality:4});
 assert.doesNotMatch(JSON.stringify(snapshot),/慢跑|私人饮食文字|旧记录/);
 assert.match(evidence(snapshot)[1],/已记录餐次/);
});

test('个人 AI 洞察要求主动授权，按账号隔离且不发送身份和原始文字',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ankang-insight-'));
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const users=['alice','bob','admin'].map(account=>{const salt=crypto.randomBytes(16).toString('hex');return{id:account,account,name:'姓名'+account,role:account==='admin'?'健康安全管理员':'普通用户',salt,passwordHash:crypto.scryptSync('Test123456',salt,64).toString('hex')}});
 const usersFile=path.join(dir,'users.json');fs.writeFileSync(usersFile,JSON.stringify(users));
 const prompts=[];
 const server=createServer({usersFile,dataDir:path.join(dir,'health'),aiEnv:{HEALTH_AI_API_KEY:'test-key',HEALTH_AI_MODEL:'test-model',HEALTH_AI_BASE_URL:'http://127.0.0.1:9999/v1'},aiFetch:async(url,options)=>{prompts.push(JSON.parse(options.body));return{ok:true,json:async()=>({choices:[{message:{content:JSON.stringify({summary:'已记录一次运动和一餐，其他日期数据不足。',actions:['明天继续记录活动时间。','按实际情况补充睡眠记录。'],caution:'仅依据自填记录，不代表医学诊断。'})}}]})}}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>{server.close();server.closeAllConnections()});
 const base='http://127.0.0.1:'+server.address().port;
 const request=async(route,{method='GET',cookie,user,body}={})=>{const response=await fetch(base+route,{method,headers:{...(cookie?{Cookie:cookie}:{}),...(user?{'X-Health-User':user}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});return{status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]}};
 const login=async(account,mode='user')=>(await request('/api/login',{method:'POST',body:{account,password:'Test123456',mode}})).cookie;
 const alice=await login('alice'),bob=await login('bob'),admin=await login('admin','admin');
 const insight=(cookie,user,consent=true)=>request('/api/health-insight',{method:'POST',cookie,user,body:{consent}});
 assert.equal((await insight(null,null)).status,401);
 assert.equal((await insight(admin,'admin')).status,403);
 assert.equal((await insight(alice,'bob')).status,409);
 assert.equal((await insight(alice,'alice',false)).status,400);
 assert.equal((await insight(alice,'alice')).status,422);
 assert.equal(prompts.length,0);
 const date=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const data={exercise:[{name:'私人运动文字',minutes:30,calories:150,date}],diet:[{meal:'午餐',food:'私人食物文字',calories:450,protein:18,date}],sleep:[],vision:[],profile:{displayName:'私人姓名',medicalNotes:'私人备忘',emergencyContact:'私人联系人'},exercisePlan:null,dietPlan:null,challenges:{sleep:[],sugar:[],water:[]}};
 const saved=await request('/api/health-data',{method:'PUT',cookie:alice,user:'alice',body:{data,revision:0}});
 assert.equal(saved.status,200);
 const result=await insight(alice,'alice');
 assert.equal(result.status,200);
 assert.equal(result.data.report.actions.length,2);
 assert.equal(result.data.evidence.length,3);
 assert.equal(prompts.length,1);
 const sent=JSON.stringify(prompts[0]);
 const promptContent=prompts[0].messages[1].content;
 const snapshot=JSON.parse(promptContent.slice(promptContent.indexOf('{'),promptContent.indexOf('\n可参考的官方健康资料片段：')));
 assert.equal(snapshot.exercise.minutes,30);
 assert.equal(result.data.references.length,2);
 assert.match(promptContent,/世界卫生组织/);
 assert.doesNotMatch(sent,/私人姓名|私人备忘|私人联系人|私人运动文字|私人食物文字|alice/);
 assert.equal((await insight(bob,'bob')).status,422);
 assert.equal(prompts.length,1);
});

test('未配置模型或模型返回无效内容时不会伪造洞察',async()=>{
 const snapshot=summarize({exercise:[{date:'2026-10-25',minutes:30}],diet:[],sleep:[]},'2026-10-25').snapshot;
 assert.equal((await generate(snapshot,{env:{}})).status,503);
 const invalid=await generate(snapshot,{env:{HEALTH_AI_API_KEY:'test',HEALTH_AI_MODEL:'test',HEALTH_AI_BASE_URL:'http://127.0.0.1:9999/v1'},request:async()=>({ok:true,json:async()=>({choices:[{message:{content:'不是 JSON'}}]})})});
 assert.equal(invalid.status,502);
});
