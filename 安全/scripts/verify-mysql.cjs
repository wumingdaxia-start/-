'use strict';
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {loadMysqlConfig,createMysqlPersistence}=require('../mysql-store');

async function main(){
 const config=loadMysqlConfig();if(!config)throw Error('未配置 MySQL');
 const db=createMysqlPersistence(config);
 const id=crypto.randomUUID(),account='mysql_probe_'+crypto.randomBytes(5).toString('hex');
 const password=crypto.randomBytes(20).toString('hex'),salt=crypto.randomBytes(16).toString('hex');
 const base='http://127.0.0.1:3000';
 try{
  await db.ready;
  await db.users.insertIfAbsent({id,account,name:'数据库测试用户',role:'普通用户',salt,passwordHash:crypto.scryptSync(password,salt,64).toString('hex')});
  const login=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({account,password})});
  assert.equal(login.status,200,'MySQL 用户无法登录');
  const cookie=login.headers.get('set-cookie').split(';')[0];
  const headers={Cookie:cookie,'X-Health-User':id};
  const before=await(await fetch(base+'/api/health-data',{headers})).json();
  assert.equal(before.revision,0);
  const data={...before.data,exercise:[{name:'快走',minutes:15,calories:60,date:'2026-10-25'}]};
  const saved=await fetch(base+'/api/health-data',{method:'PUT',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({data,revision:0})});
  assert.equal(saved.status,200,'MySQL 健康记录保存失败');
  assert.equal((await db.health.read(id)).data.exercise.length,1);
  const urgent=await fetch(base+'/api/consult',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({message:'突然胸痛，呼吸困难'})});
  assert.equal(urgent.status,200,'MySQL 问诊记录保存失败');
  assert.equal((await db.consult.read(id)).length,2);
  const clear=await fetch(base+'/api/consult/clear',{method:'DELETE',headers});
  assert.equal(clear.status,200);
  assert.equal((await db.consult.read(id)).length,0);
  console.log('PASS: MySQL 账号登录、健康记录保存读取、问诊记录保存清空。');
 }finally{
  await db.pool.execute('DELETE FROM consult_threads WHERE user_id=?',[id]);
  await db.pool.execute('DELETE FROM health_records WHERE user_id=?',[id]);
  await db.pool.execute('DELETE FROM users WHERE id=?',[id]);
  await db.close();
 }
}
main().catch(error=>{console.error(error.message);process.exitCode=1});
