const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function harness(initialStorage) {
  const elements = new Map();
  const element = selector => {
    if (!elements.has(selector)) elements.set(selector, {textContent:'',innerHTML:'',dataset:{},elements:{food:{}},style:{},value:'',hidden:true,classList:{add(){},remove(){},toggle(){}},setAttribute(){},querySelectorAll(){return []}});
    return elements.get(selector);
  };
  const guest = {exercise:[{name:'游客跑步',minutes:20,calories:100}],diet:[],sleep:[]};
  let storage = initialStorage === undefined ? JSON.stringify(guest) : initialStorage, identity = null, records = {exercise:[],diet:[],sleep:[],vision:[],profile:null,exercisePlan:null,dietPlan:null,challenges:{sleep:[],sugar:[],water:[]}}, failSave = false, confirmDelete = true;
  const context = vm.createContext({
    document:{querySelector:element,querySelectorAll:()=>[]},
    localStorage:{getItem:()=>storage,setItem:(k,v)=>{storage=v}},
    location:{hash:'#home'},addEventListener(){},scrollTo(){},setTimeout(){},confirm:()=>confirmDelete,
    Intl,Date,console,
    fetch:async (url, options={}) => {
      if (url==='/api/logout') {identity=null;return {ok:true}}
      if (url==='/api/me') return {status:identity?200:401,ok:!!identity,json:async()=>({user:identity})};
      if (url==='/api/challenges/leaderboard') return {status:200,ok:true,json:async()=>({leaders:[],myRank:null})};
      if (url==='/api/health-data') {
        if (options.method==='PUT') {
          if (failSave) return {ok:false,status:500,json:async()=>({message:'模拟保存失败'})};
          records={profile:null,...JSON.parse(options.body).data};
        }
        return {ok:true,status:200,json:async()=>({data:structuredClone(records),revision:1})};
      }
      throw Error('Unknown API');
    }
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../public/vision.js'),'utf8'),context);
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../public/profile.js'),'utf8'),context);
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../public/plan-engine.js'),'utf8'),context);
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../public/plans.js'),'utf8'),context);
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../public/challenge-core.js'),'utf8'),context);
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../public/challenges.js'),'utf8'),context);
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../public/consult.js'),'utf8'),context);
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../public/insight.js'),'utf8'),context);
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../public/knowledge.js'),'utf8'),context);
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../public/app.js'),'utf8'),context);
  const setProfileForm = (values={}) => {
    const names=['displayName','gender','birthDate','bloodType','heightCm','weightKg','activityLevel','healthGoal','allergies','medicalNotes','emergencyContact','emergencyPhone'];
    const controls=Object.fromEntries(names.map(name=>[name,{value:values[name]??'',oninput:null,onchange:null}]));
    const form=element('#profileForm');form.elements=controls;form.querySelectorAll=()=>Object.values(controls);
    element('#saveProfile').disabled=false;element('#saveProfile').textContent='保存个人档案';
    return form;
  };
  return {run:code=>vm.runInContext(code,context),element,setProfileForm,guest,get storage(){return JSON.parse(storage)},login(){identity={id:'alice',account:'alice',name:'小安'}},fail(){failSave=true},setRecords(value){records={profile:null,...structuredClone(value)}},setConfirm(value){confirmDelete=value},get records(){return records}};
}

test('AI 洞察页游客不展示个人结果，登录后须先勾选授权',async()=>{
  const h=harness(null);
  await h.run('loadAccount()');
  h.run("location.hash='#analysis';render()");
  assert.match(h.element('#page').innerHTML,/游客没有个人记录/);
  assert.doesNotMatch(h.element('#page').innerHTML,/我同意将上述汇总指标/);
  h.login();await h.run('loadAccount()');
  assert.match(h.element('#page').innerHTML,/我同意将上述汇总指标/);
  assert.match(h.element('#page').innerHTML,/id="insightGenerate"[^>]*disabled/);
  h.element('#insightConsent').checked=true;
  h.element('#insightConsent').onchange();
  assert.equal(h.element('#insightGenerate').disabled,false);
  await h.run('logout()');
  assert.doesNotMatch(h.element('#page').innerHTML,/我同意将上述汇总指标/);
});

test('健康知识检索页可游客查资料，AI 回答需要授权',async()=>{
  const h=harness(null);
  await h.run('loadAccount()');
  h.run("location.hash='#knowledge';render()");
  assert.match(h.element('#page').innerHTML,/健康知识检索/);
  assert.match(h.element('#page').innerHTML,/资料检索无需登录/);
  h.login();await h.run('loadAccount()');
  assert.match(h.element('#page').innerHTML,/id="knowledgeAsk"[^>]*disabled/);
  h.element('#knowledgeConsent').checked=true;
  h.element('#knowledgeConsent').onchange();
  assert.equal(h.element('#knowledgeAsk').disabled,false);
});

test('游客始终为空，空白表单及视力结果保存前均弹出登录提示', async () => {
  const h=harness(null);await h.run('loadAccount()');
  assert.equal(h.run('data.exercise.length + data.diet.length + data.sleep.length + data.vision.length'),0);
  assert.equal(h.run('data.profile'),null);
  assert.match(h.run('exercise()'),/暂无锻炼记录/);
  assert.match(h.run('diet()'),/暂无饮食记录/);
  assert.match(h.run('sleep()'),/暂无睡眠记录/);
  assert.match(h.run('analysis()'),/记录尚不完整/);
  assert.doesNotMatch(h.element('#page').innerHTML,/undefined|NaN/);
  const cached=harness();await cached.run('loadAccount()');
  assert.equal(cached.run('data.exercise.length + data.diet.length + data.sleep.length'),0);
  for(const type of ['exercise','diet','sleep']){
    h.run("openForm('"+type+"')");
    assert.doesNotMatch(h.element('#modalBody').innerHTML,/value="(?:30|160|450|25|7\.5)"/);
    assert.equal(h.element('#recordForm').noValidate,true);
    await h.element('#recordForm').onsubmit({preventDefault(){}});
    assert.match(h.element('#modalBody').innerHTML,/请先登录账号/);
    assert.match(h.element('#modalBody').innerHTML,/前往登录/);
    assert.equal(h.element('#modal').hidden,false);
  }
  h.run("visionSession={kind:'color',identity:null,epoch:generation,version:revision,result:{kind:'color',correct:5,total:6,date:todayKey()}}");
  await h.run('saveVisionResult()');
  assert.match(h.element('#modalBody').innerHTML,/请先登录账号/);
  assert.equal(h.run('data.vision.length'),0);
  assert.equal(h.storage,null);
  assert.deepEqual(cached.storage,cached.guest);
});

test('游客、空账号、保存、退出及重新登录显示不同数据', async () => {
  const h=harness();await h.run('loadAccount()');
  assert.match(h.element('#page').innerHTML,/游客模式/);
  assert.equal(h.run('data.exercise.length'),0);
  h.login();await h.run('loadAccount()');
  assert.equal(h.run('data.exercise.length'),0);
  for(const route of ['home','profile','exercise','diet','sleep','vision','analysis']){
    const html=h.run(route+'()');
    assert.doesNotMatch(html,/undefined|NaN|状态良好|低风险/);
  }
  assert.match(h.run('sleep()'),/暂无睡眠记录/);
  assert.match(h.run('analysis()'),/记录尚不完整/);
  await h.run("(async()=>{const candidate={exercise:[{name:'账号快走',minutes:30,calories:120}],diet:[],sleep:[],vision:[]};const saved=await persist(candidate,user.id,revision);data=saved.data;revision=saved.revision;render()})()");
  assert.equal(h.records.exercise[0].name,'账号快走');
  assert.deepEqual(h.storage,h.guest);
  await h.element('#logoutAccount').onclick();
  assert.equal(h.run('data.exercise.length'),0);
  h.login();await h.run('loadAccount()');
  assert.equal(h.run('data.exercise[0].name'),'账号快走');
  h.run("data.diet=[{meal:'早餐',food:'<img src=x onerror=alert(1)>',calories:1,protein:1}]");
  assert.doesNotMatch(h.run('dietList()'),/<img/);
  assert.match(h.run('dietList()'),/&lt;img/);
});

test('游客保存被拒绝，登录账号保存失败不改动记录', async () => {
  const h=harness();await h.run('loadAccount()');
  h.login();
  await assert.rejects(h.run('persist({exercise:[],diet:[],sleep:[],vision:[]},null,0)'),/请先登录账号/);
  assert.deepEqual(h.storage,h.guest);
  await h.run('loadAccount()');h.fail();
  await assert.rejects(h.run('persist({exercise:[],diet:[],sleep:[],vision:[]},user.id,revision)'),/模拟保存失败/);
  assert.equal(h.run('data.exercise.length'),0);
  assert.deepEqual(h.storage,h.guest);
});

test('登录账号可确认删除四类记录，取消或保存失败不删除', async () => {
  const h=harness(null),records={
    exercise:[{name:'快走',minutes:30,calories:120,date:'2026-10-19'}],
    diet:[{meal:'早餐',food:'燕麦',calories:350,protein:20,date:'2026-10-19'}],
    sleep:[{hours:7.5,date:'2026-10-19'}],
    vision:[{kind:'color',correct:5,total:6,date:'2026-10-19'}]
  };
  h.setRecords(records);h.login();await h.run('loadAccount()');
  assert.match(h.run('exerciseList()'),/data-delete="exercise"/);
  assert.match(h.run('dietList()'),/data-delete="diet"/);
  assert.match(h.run('sleepList()'),/data-delete="sleep"/);
  assert.match(h.run('visionHistory()'),/data-delete="vision"/);
  h.setConfirm(false);await h.run("deleteRecord('exercise',0)");
  assert.equal(h.run('data.exercise.length'),1);
  h.setConfirm(true);await h.run("deleteRecord('exercise',0)");
  assert.equal(h.run('data.exercise.length'),0);
  await h.run("deleteRecord('diet',0)");await h.run("deleteRecord('sleep',0)");await h.run("deleteRecord('vision',0)");
  assert.equal(h.run('data.diet.length + data.sleep.length + data.vision.length'),0);
  assert.deepEqual(h.records,{exercise:[],diet:[],sleep:[],vision:[],profile:null,exercisePlan:null,dietPlan:null,challenges:{sleep:[],sugar:[],water:[]}});

  h.setRecords(records);await h.run('loadAccount()');h.fail();
  await h.run("deleteRecord('exercise',0)");
  assert.equal(h.run('data.exercise.length'),1);
  assert.equal(h.records.exercise.length,1);
});

test('三类记录齐全后通知按钮变为完成状态', async () => {
  const now=new Date(),today=[now.getFullYear(),String(now.getMonth()+1).padStart(2,'0'),String(now.getDate()).padStart(2,'0')].join('-');
  const h=harness(null);h.setRecords({
    exercise:[{name:'快走',minutes:30,calories:120,date:today}],
    diet:[{meal:'早餐',food:'燕麦',calories:350,protein:20,date:today}],
    sleep:[{hours:7.5,date:today}]
    ,vision:[]
  });
  h.login();await h.run('loadAccount()');
  assert.equal(h.element('#noticeBtn').title,'健康记录已填写完整');
  assert.equal(h.element('#noticeDot').hidden,true);
  h.run("data.diet=[];render()");
  assert.equal(h.element('#noticeBtn').title,'健康记录待补充');
  assert.equal(h.element('#noticeDot').hidden,false);
});

test('个人档案按账号保存、可清空，游客保存时提示登录', async () => {
  const guest=harness(null);await guest.run("location.hash='#profile';loadAccount()");
  const guestForm=guest.setProfileForm({displayName:'游客资料',heightCm:'170'});guest.run('bindProfile()');
  guestForm.elements.displayName.oninput();
  assert.equal(guest.run('profileDraftActive()'),true);
  await guestForm.onsubmit({preventDefault(){}});
  assert.match(guest.element('#modalBody').innerHTML,/请先登录账号/);
  assert.equal(guest.run('data.profile'),null);

  const h=harness(null);h.login();await h.run("location.hash='#profile';loadAccount()");
  assert.equal(h.element('#topUserName').textContent,'小安');
  const form=h.setProfileForm({displayName:'小安 <健康>',gender:'女',birthDate:'2000-01-02',bloodType:'A型',heightCm:'165.5',weightKg:'55.2',activityLevel:'中等活动',healthGoal:'保持状态',allergies:'花生',medicalNotes:'定期复查',emergencyContact:'家人',emergencyPhone:'138-0000-0000'});
  h.run('bindProfile()');await form.onsubmit({preventDefault(){}});
  assert.equal(h.records.profile.displayName,'小安 <健康>');
  assert.equal(h.records.profile.heightCm,165.5);
  assert.equal(h.element('#topUserName').textContent,'小安 <健康>');
  assert.equal(h.element('#topGreeting').textContent,'你好，小安 <健康>，愿你今天身心安康');
  assert.equal(h.element('#topUserAvatar').textContent,'小');
  assert.equal(h.element('#userName').textContent,'小安 <健康>');
  assert.match(h.element('#page').innerHTML,/小安 &lt;健康&gt;的健康档案/);
  assert.match(h.run('profile()'),/&lt;健康&gt;/);
  assert.match(h.run('profile()'),/身体质量指数参考/);

  h.setConfirm(false);await h.element('#clearProfile').onclick();
  assert.ok(h.records.profile);
  h.setConfirm(true);await h.element('#clearProfile').onclick();
  assert.equal(h.records.profile,null);
  assert.equal(h.run('data.profile'),null);
  assert.equal(h.element('#topUserName').textContent,'小安');
  assert.equal(h.element('#topGreeting').textContent,'你好，小安，愿你今天身心安康');
});

test('个人档案保存失败不会覆盖已加载内容', async () => {
  const h=harness(null);h.setRecords({exercise:[],diet:[],sleep:[],vision:[],profile:{displayName:'原档案'}});h.login();
  await h.run("location.hash='#profile';loadAccount()");
  const form=h.setProfileForm({displayName:'错误覆盖',heightCm:'180'});h.run('bindProfile()');h.fail();
  await form.onsubmit({preventDefault(){}});
  assert.equal(h.run('data.profile.displayName'),'原档案');
  assert.equal(h.records.profile.displayName,'原档案');
});

test('挑战页游客为空、打卡写入当前账号并可撤销',async()=>{
 const h=harness(null);await h.run("location.hash='#challenges';loadAccount()");assert.match(h.run('challenges()'),/尚未开始/);
 await h.run("changeChallenge('sugar','start')");assert.match(h.element('#modalBody').innerHTML,/请先登录账号/);
 h.login();await h.run('loadAccount()');await h.run("changeChallenge('sugar','start')");assert.equal(h.run('data.challenges.sugar.length'),1);
 await h.run("changeChallenge('sugar','check')");assert.equal(h.run('data.challenges.sugar[0].days.length'),1);
 assert.equal(h.run('coverage()'),0);assert.equal(h.run('ChallengeCore.badges(data.challenges).includes("初次打卡")'),true);
 await h.run("changeChallenge('sugar','undo')");assert.equal(h.run('data.challenges.sugar[0].days.length'),0);
});

test('E 字尺寸按校准、距离和小数视力变化，左右眼流程生成参考结果', async () => {
  const h=harness(null);h.login();await h.run('loadAccount()');
  const base=h.run('visionOptotypePixels(1,200,190)');
  assert.ok(base>10&&base<12);
  assert.equal(h.run('visionOptotypePixels(1,400,190)'),base*2);
  assert.equal(h.run('visionOptotypePixels(0.5,200,190)'),base*2);
  h.run("visionSession={kind:'acuity',identity:String(user.id),epoch:generation,version:revision,distanceCm:200,calibrationPx:190,correction:'裸眼',eye:'left',level:0,trial:0,correct:0,lastPassed:0};showOptotype()");
  for(let i=0;i<3;i++)h.run('answerOptotype(visionSession.direction)');
  for(let i=0;i<3;i++)h.run('answerOptotype(null)');
  h.element('#visionNextEye').onclick();
  for(let level=0;level<9;level++)for(let i=0;i<3;i++)h.run('answerOptotype(visionSession.direction)');
  assert.equal(h.run('visionSession.result.left'),0.1);
  assert.equal(h.run('visionSession.result.right'),1.2);
  assert.match(h.element('#modalBody').innerHTML,/不能换算为近视度数/);
  await h.run('saveVisionResult()');
  assert.equal(h.records.vision.length,1);
  assert.equal(h.records.vision[0].kind,'acuity');
  assert.match(h.run('home()'),/查看 1 条记录/);
  assert.match(h.run('analysis()'),/视力观察摘要/);
});

test('散光观察与颜色练习形成非诊断性记录，失败保存不污染账号数据', async () => {
  const h=harness(null);h.login();await h.run('loadAccount()');
  h.run("visionSession={kind:'astigmatism',identity:String(user.id),epoch:generation,version:revision,result:{kind:'astigmatism',left:'均匀',right:'不确定',date:todayKey()}};showVisionResult()");
  assert.match(h.element('#modalBody').innerHTML,/主观感受/);
  h.fail();await h.run('saveVisionResult()');
  assert.equal(h.run('data.vision.length'),0);
  assert.equal(h.records.vision.length,0);
  assert.equal(h.run('saving'),false);
  h.run("visionSession={kind:'color',identity:String(user.id),epoch:generation,version:revision,round:0,correct:0};showColorQuestion()");
  for(let i=0;i<6;i++)h.run('answerColor(visionSession.target)');
  assert.equal(h.run('visionSession.result.correct'),6);
  assert.match(h.element('#modalBody').innerHTML,/不能据此排除色觉异常/);
});
