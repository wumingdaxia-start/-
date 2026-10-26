'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {createStore}=require('../health-store');
const {createConsultStore}=require('../consult-store');
const {loadMysqlConfig,createMysqlPersistence}=require('../mysql-store');

async function main(){
 const root=path.join(__dirname,'..'),usersFile=path.join(root,'..','账号','data','users.json');
 const healthDir=path.join(root,'data','health'),consultDir=path.join(root,'data','consult');
 const users=JSON.parse(fs.readFileSync(usersFile,'utf8'));
 if(!Array.isArray(users)||users.some(user=>!user?.id||!user?.account))throw Error('账号 JSON 格式无效');
 const exists=(dir,id)=>fs.existsSync(path.join(dir,crypto.createHash('sha256').update(String(id)).digest('hex')+'.json'));
 const health=createStore(healthDir),consult=createConsultStore(consultDir);
 const counts={users:users.length,health:users.filter(user=>exists(healthDir,user.id)).length,consult:users.filter(user=>exists(consultDir,user.id)).length};
 if(!process.argv.includes('--apply')){console.log('预览：账号 '+counts.users+' 个、健康档案 '+counts.health+' 份、问诊对话 '+counts.consult+' 份。');console.log('源 JSON 不会删除。设置 MySQL 连接环境变量后运行 node scripts/migrate-mysql.cjs --apply 才会导入；已存在的数据库记录不会覆盖。');return}
 const config=loadMysqlConfig();if(!config)throw Error('请先设置 MYSQL_HOST、MYSQL_USER、MYSQL_PASSWORD 和 MYSQL_DATABASE');
 const db=createMysqlPersistence(config);
 const imported={users:0,health:0,consult:0};
 try{
  await db.ready;
  for(const user of users)if(await db.users.insertIfAbsent(user))imported.users++;
  const databaseUsers=await db.users.read();
  for(const user of users){
   if(!databaseUsers.some(row=>String(row.id)===String(user.id)&&row.account===user.account))throw Error('数据库账号与 JSON 冲突：'+user.account);
   if(exists(healthDir,user.id)&&await db.health.importIfAbsent(user.id,health.read(user.id)))imported.health++;
   if(exists(consultDir,user.id)&&await db.consult.importIfAbsent(user.id,consult.read(user.id)))imported.consult++;
  }
  console.log('导入完成：账号 '+imported.users+' 个、健康档案 '+imported.health+' 份、问诊对话 '+imported.consult+' 份。原 JSON 已保留。');
 }finally{await db.close()}
}
main().catch(error=>{console.error('迁移失败：'+error.message);process.exitCode=1});
