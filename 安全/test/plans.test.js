const test=require('node:test');
const assert=require('node:assert/strict');
const plans=require('../public/plan-engine');
const {validateData}=require('../health-store');
const exercise={goal:'增肌',level:'初学',equipment:'徒手',days:3,minutes:30,startDate:'2026-10-29'};
const diet={goal:'保持健康',sex:'女',age:30,height:165,weight:60,activity:'轻度活动',preference:'均衡饮食',exclusions:[],notes:''};
test('训练计划遵守每周天数、器械、时长并跨月安排恢复日',()=>{
 for(let days=1;days<=5;days++){
  const p=plans.exercise({...exercise,days},'2026-10-20');
  assert.equal(p.items.length,7);assert.equal(p.items.filter(x=>x.minutes===30).length,days);
  assert.equal(p.items.at(-1).label,'2026-11-04');assert.doesNotMatch(p.items.map(x=>x.content).join(''),/哑铃/);
  assert.deepEqual(plans.validatePlan(p,'exercise'),p);
 }
 const dumbbell=plans.exercise({...exercise,equipment:'哑铃'},'2026-10-20');assert.match(dumbbell.items[0].content,/哑铃/);
});
test('营养公式、目标调整及食材排除实际影响食谱，合计由分量估算',()=>{
 const normal=plans.diet(diet,'2026-10-20');
 assert.equal(normal.targets.bmr,1320);assert.equal(normal.targets.tdee,1815);assert.equal(normal.targets.calories,1815);
 assert.equal(plans.diet({...diet,goal:'减脂'},'2026-10-20').targets.calories,1515);
 assert.equal(plans.diet({...diet,goal:'增肌'},'2026-10-20').targets.calories,2065);
 const restricted=plans.diet({...diet,preference:'蛋奶素',exclusions:plans.exclusions},'2026-10-20');
 assert.doesNotMatch(restricted.items.map(x=>x.content).join(''),/鸡蛋|牛奶|豆腐|鸡胸|鱼|虾|小麦|坚果/);
 assert.match(restricted.items.map(x=>x.content).join(''),/扁豆/);
 assert.ok(Math.abs(restricted.items.reduce((n,x)=>n+x.calories,0)-restricted.targets.calories)<100);
 assert.deepEqual(plans.validatePlan(restricted,'diet'),restricted);
});
test('后端拒绝畸形计划、无效参数和恶意超长内容；重新计算营养目标',()=>{
 const base={exercise:[],diet:[],sleep:[]};assert.equal(validateData(base).exercisePlan,null);
 const p=plans.exercise(exercise,'2026-10-20');
 for(const mutate of [x=>x.items.pop(),x=>x.items[0].minutes=-1,x=>x.items[0].content='x'.repeat(1201),x=>x.settings.days=8,x=>x.kind='diet']){
  const invalid=structuredClone(p);mutate(invalid);assert.throws(()=>validateData({...base,exercisePlan:invalid}));
 }
 const d=plans.diet(diet,'2026-10-20');d.targets.calories=1;
 assert.equal(validateData({...base,dietPlan:d}).dietPlan.targets.calories,1815);
 assert.throws(()=>plans.diet({...diet,age:12},'2026-10-20'));
 assert.throws(()=>plans.diet({...diet,exclusions:['不存在']},'2026-10-20'));
});
