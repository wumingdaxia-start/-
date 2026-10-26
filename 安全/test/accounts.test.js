const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const {createServer} = require('../server');
const {createStore,validateData} = require('../health-store');
const plans = require('../public/plan-engine');
const challenges=require('../public/challenge-core');

test('旧三类数据读取时补齐视力与个人档案，新增字段执行严格校验', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ankang-migrate-'));
  try {
    const id='legacy-user',file=path.join(dir,crypto.createHash('sha256').update(id).digest('hex')+'.json');
    fs.mkdirSync(dir,{recursive:true});
    fs.writeFileSync(file,JSON.stringify({revision:7,data:{exercise:[],diet:[],sleep:[]}}));
    assert.deepEqual(createStore(dir).read(id),{revision:7,data:{exercise:[],diet:[],sleep:[],vision:[],profile:null,exercisePlan:null,dietPlan:null,challenges:{sleep:[],sugar:[],water:[]}}});
    const base={exercise:[],diet:[],sleep:[],vision:[],profile:null,exercisePlan:null,dietPlan:null,challenges:{sleep:[],sugar:[],water:[]}};
    assert.throws(()=>validateData({...base,vision:[{kind:'acuity',left:2,right:1,correction:'裸眼',distanceCm:200,calibrationPx:190,date:'2026-10-20'}]}),/记录格式无效/);
    assert.throws(()=>validateData({...base,vision:[{kind:'astigmatism',left:'30度',right:'均匀',date:'2026-10-20'}]}),/记录格式无效/);
    assert.throws(()=>validateData({...base,vision:[{kind:'color',correct:7,total:6,date:'2026-10-20'}]}),/记录格式无效/);
    assert.throws(()=>validateData({...base,profile:{heightCm:20}}),/记录格式无效/);
    assert.throws(()=>validateData({...base,profile:{gender:'未知选项'}}),/记录格式无效/);
    assert.throws(()=>validateData({...base,profile:{birthDate:'2099-01-01'}}),/记录格式无效/);
    assert.throws(()=>validateData({...base,profile:{displayName:'正常',admin:true}}),/记录格式无效/);
    assert.throws(()=>validateData({...base,challenges:{sleep:[{startDate:'2026-10-20',days:[{date:'2026-10-20',bedtime:'23:10'}]}]}}),/早睡时间无效/);
    assert.throws(()=>validateData({...base,challenges:{sleep:[],sugar:[],water:[{startDate:'2026-10-20',days:[{date:'2026-10-20',ml:9000}]}]}}),/饮水量无效/);
  } finally { fs.rmSync(dir,{recursive:true,force:true}); }
});

test('账号隔离、认证、版本冲突、校验及重启后持久保存', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ankang-test-'));
  t.after(() => fs.rmSync(dir, {recursive:true, force:true}));
  const users = ['alice','bob'].map(account => {
    const salt = crypto.randomBytes(16).toString('hex');
    return {id:account, account, name:account, role:'用户', salt, passwordHash:crypto.scryptSync('Test123456', salt, 64).toString('hex')};
  });
  const usersFile = path.join(dir, 'users.json'), dataDir = path.join(dir, 'health');
  fs.writeFileSync(usersFile, JSON.stringify(users));
  let server, base;
  const start = async () => {
    server = createServer({usersFile, dataDir});
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    base = 'http://127.0.0.1:' + server.address().port;
  };
  const stop = () => new Promise(resolve => {server.close(resolve);server.closeAllConnections()});
  await start();
  t.after(() => server.listening ? stop() : undefined);
  const request = async (route, {method='GET', cookie, user, body}={}) => {
    const res = await fetch(base + route, {method, headers:{...(cookie?{Cookie:cookie}:{}), ...(user?{'X-Health-User':user}:{}), ...(body?{'Content-Type':'application/json'}:{})}, ...(body?{body:JSON.stringify(body)}:{})});
    return {status:res.status, body:await res.json(), cookie:res.headers.get('set-cookie')?.split(';')[0]};
  };
  const login = async account => {
    const result = await request('/api/login', {method:'POST', body:{account,password:'Test123456'}});
    assert.equal(result.status, 200); return result.cookie;
  };
  const empty = {exercise:[],diet:[],sleep:[],vision:[],profile:null,exercisePlan:null,dietPlan:null,challenges:{sleep:[],sugar:[],water:[]}};
  assert.equal((await request('/api/health-data')).status, 401);
  assert.equal((await request('/api/health-data', {method:'PUT',body:{data:empty,revision:0}})).status, 401);
  let alice = await login('alice'), bob = await login('bob');
  assert.equal((await request('/api/me', {cookie:alice})).body.user.id, 'alice');
  assert.deepEqual((await request('/api/health-data', {cookie:alice,user:'alice'})).body.data, empty);
  assert.equal((await request('/api/health-data', {cookie:alice,user:'bob'})).status, 409);
  const records = {
    exercisePlan:plans.exercise({goal:'增肌',level:'初学',equipment:'哑铃',days:3,minutes:35,startDate:'2026-10-21'},'2026-10-20'),
    challenges:{sleep:[],sugar:[],water:[]},
    dietPlan:plans.diet({goal:'减脂',sex:'女',age:26,height:165,weight:60,activity:'轻度活动',preference:'蛋奶素',exclusions:['蛋类','奶类'],notes:'少辣'},'2026-10-20'),
    exercise:[{name:'快走',minutes:30,calories:100,date:'2026-10-19'}],
    diet:[{meal:'早餐',food:'燕麦 <蔬菜>',calories:350,protein:20,date:'2026-10-19'}],
    sleep:[{hours:7.5,date:'2026-10-19'}],
    vision:[
      {kind:'acuity',left:0.8,right:1,correction:'佩戴眼镜',distanceCm:200,calibrationPx:190,date:'2026-10-20'},
      {kind:'astigmatism',left:'均匀',right:'不确定',date:'2026-10-20'},
      {kind:'color',correct:5,total:6,date:'2026-10-20'}
    ],
    profile:{displayName:'爱丽丝',gender:'女',birthDate:'2000-01-02',bloodType:'A型',heightCm:165.5,weightKg:55.2,activityLevel:'中等活动',healthGoal:'保持状态',allergies:'花生',medicalNotes:'定期复查',emergencyContact:'家人',emergencyPhone:'138-0000-0000'}
  };
  const saved = await request('/api/health-data', {method:'PUT',cookie:alice,user:'alice',body:{data:records,revision:0,userId:'bob'}});
  assert.equal(saved.status, 200); assert.equal(saved.body.revision, 1);
  assert.deepEqual((await request('/api/health-data', {cookie:bob,user:'bob'})).body.data, empty);
  assert.equal((await request('/api/health-data', {method:'PUT',cookie:alice,user:'alice',body:{data:empty,revision:0}})).status, 409);
  const invalid = structuredClone(records); invalid.sleep[0].hours = 25;
  assert.equal((await request('/api/health-data', {method:'PUT',cookie:alice,user:'alice',body:{data:invalid,revision:1}})).status, 400);
  const invalidVision = structuredClone(records); invalidVision.vision[0].distanceCm = 20;
  assert.equal((await request('/api/health-data', {method:'PUT',cookie:alice,user:'alice',body:{data:invalidVision,revision:1}})).status, 400);
  const invalidProfile = structuredClone(records); invalidProfile.profile.emergencyPhone = '<script>';
  assert.equal((await request('/api/health-data', {method:'PUT',cookie:alice,user:'alice',body:{data:invalidProfile,revision:1}})).status, 400);
  const invalidPlan = structuredClone(records); invalidPlan.dietPlan.items[0].calories = -1;
  assert.equal((await request('/api/health-data', {method:'PUT',cookie:alice,user:'alice',body:{data:invalidPlan,revision:1}})).status, 400);
  assert.deepEqual((await request('/api/health-data', {cookie:alice,user:'alice'})).body.data, records);
  await request('/api/logout', {method:'POST',cookie:alice});
  assert.equal((await request('/api/health-data', {cookie:alice,user:'alice'})).status, 401);
  alice = await login('alice');
  assert.deepEqual((await request('/api/health-data', {cookie:alice,user:'alice'})).body.data, records);
  await stop(); await start();
  assert.equal((await request('/api/me', {cookie:alice})).status, 401);
  alice = await login('alice'); bob = await login('bob');
  assert.deepEqual((await request('/api/health-data', {cookie:alice,user:'alice'})).body.data, records);
  assert.deepEqual((await request('/api/health-data', {cookie:bob,user:'bob'})).body.data, empty);
  const crossOrigin = await fetch(base + '/api/health-data', {method:'PUT',headers:{Origin:'https://other.example',Cookie:alice}});
  assert.equal(crossOrigin.status, 403);
});

test('挑战积分、徽章与连续天数按各自规则计算',()=>{
 const today='2026-10-21';
 const c={sleep:[{startDate:'2026-10-20',days:[{date:'2026-10-20',bedtime:'22:30'}]}],sugar:[{startDate:'2026-10-15',days:Array.from({length:7},(_,i)=>'2026-10-'+String(15+i))}],water:[{startDate:'2026-10-20',days:[{date:'2026-10-20',ml:1100},{date:'2026-10-21',ml:1700}]}]};
 assert.equal(challenges.score(c,today),9);
 assert.ok(challenges.badges(c).includes('清爽七日'));
 assert.equal(challenges.completedDates(c,'water').size,1);
 const gap=structuredClone(c);gap.sugar[0].days.splice(3,1);assert.ok(!challenges.badges(gap).includes('清爽七日'));
 assert.deepEqual(challenges.validateChallenges(c),c);
});

test('天气接口校验坐标、精简上游数据并缓存预报',async t=>{
 const payload={current:{temperature_2m:18.6,weather_code:2},daily:{temperature_2m_max:[23,24],temperature_2m_min:[12,13],precipitation_probability_max:[60,20]}};
 let calls=0;
 const server=createServer({weatherFetch:async()=>{calls++;return {ok:true,json:async()=>payload}}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>{server.close();server.closeAllConnections()});
 const base='http://127.0.0.1:'+server.address().port;
 assert.equal((await fetch(base+'/api/weather?latitude=200&longitude=116')).status,400);
 assert.equal((await fetch(base+'/api/weather?latitude=39')).status,400);
 const result=await (await fetch(base+'/api/weather?latitude=39.90&longitude=116.40')).json();
 assert.equal(result.current.temperature_2m,18.6);
 assert.equal(result.daily.precipitation_probability_max[0],60);
 assert.equal((await fetch(base+'/api/weather?latitude=39.90&longitude=116.40')).status,200);
 assert.equal(calls,1);
});

test('管理员汇总接口、用户隔离与挑战排行榜',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ankang-admin-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const users=['member','second','admin'].map(account=>{const salt=crypto.randomBytes(16).toString('hex');return{id:account,account,name:account,role:account==='admin'?'健康安全管理员':'普通用户',salt,passwordHash:crypto.scryptSync('Test123456',salt,64).toString('hex')}});
 const usersFile=path.join(dir,'users.json'),dataDir=path.join(dir,'health');fs.writeFileSync(usersFile,JSON.stringify(users));
 const server=createServer({usersFile,dataDir});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>{server.close();server.closeAllConnections()});const base='http://127.0.0.1:'+server.address().port;
 const request=async(route,cookie,body)=>{const res=await fetch(base+route,{method:body?'POST':'GET',headers:{...(cookie?{Cookie:cookie}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});let data;try{data=await res.json()}catch{}return {status:res.status,data,cookie:res.headers.get('set-cookie')?.split(';')[0]}};
 const member=(await request('/api/login',null,{account:'member',password:'Test123456'})).cookie;
 const admin=(await request('/api/login',null,{account:'admin',password:'Test123456',mode:'admin'})).cookie;
 assert.equal((await request('/api/login',null,{account:'admin',password:'Test123456'})).status,401);
 assert.equal((await request('/api/login',null,{account:'member',password:'Test123456',mode:'admin'})).status,401);
 assert.equal((await request('/api/admin/overview')).status,401);
 assert.equal((await request('/api/admin/overview',member)).status,403);
 assert.equal((await request('/api/challenges/leaderboard',admin)).status,403);
 assert.equal((await request('/api/health-data',admin)).status,403);
 const store=createStore(dataDir),today=challenges.todayKey(),record=store.read('member');record.data.sleep.push({date:today,hours:7.5});record.data.diet.push({date:today,meal:'早餐',food:'燕麦',calories:350,protein:15});record.data.challenges.water.push({startDate:today,days:[{date:today,ml:1800}]});store.write('member',record.data,record.revision);
 const overview=(await request('/api/admin/overview',admin)).data;assert.equal(overview.summary.registeredUsers,2);assert.equal(overview.summary.usersWithData,1);assert.equal(overview.summary.averageSleepHours,7.5);assert.equal(overview.summary.averageSleepQuality,null);assert.equal(overview.summary.qualityResponseCount,0);assert.equal(overview.summary.averageMealCalories,350);assert.equal(overview.summary.challengeParticipants,1);assert.ok(!JSON.stringify(overview).includes('passwordHash'));
 const scored=store.read('member');scored.data.sleep[0].quality=4;store.write('member',scored.data,scored.revision);
 const withQuality=(await request('/api/admin/overview',admin)).data;assert.equal(withQuality.summary.averageSleepQuality,4);assert.equal(withQuality.summary.qualityResponseCount,1);assert.equal(withQuality.users.find(x=>x.account==='second').averageSleepQuality,null);
 const ranks=(await request('/api/challenges/leaderboard',member)).data;assert.equal(ranks.leaders[0].name,'我');assert.equal(ranks.leaders[0].score,1);assert.equal(ranks.myRank,1);
 assert.equal((await fetch(base+'/admin/')).status,200);
});
