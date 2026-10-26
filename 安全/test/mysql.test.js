const test=require('node:test');
const assert=require('node:assert/strict');
const {mysqlConfig,createMysqlPersistence}=require('../mysql-store');

test('MySQL 配置要求完整，不允许无意回退到 JSON',()=>{
 assert.equal(mysqlConfig({}),null);
 assert.throws(()=>mysqlConfig({MYSQL_HOST:'db.example'}),/MYSQL_USER/);
 assert.throws(()=>mysqlConfig({MYSQL_HOST:'db.example',MYSQL_USER:'app',MYSQL_PASSWORD:'pw',MYSQL_DATABASE:'health',MYSQL_PORT:'99999'}),/MYSQL_PORT/);
 const config=mysqlConfig({MYSQL_HOST:'db.example',MYSQL_USER:'app',MYSQL_PASSWORD:'pw',MYSQL_DATABASE:'health',MYSQL_SSL:'1'});
 assert.equal(config.host,'db.example');assert.equal(config.database,'health');assert.deepEqual(config.ssl,{});
});

test('MySQL 适配器保存账号、健康记录和问诊对话，版本冲突不覆盖',async()=>{
 const users=new Map(),health=new Map(),consult=new Map(),schema=[];
 const pool={
  async query(sql){schema.push(sql);return[[],[]]},
  async execute(sql,params=[]){
   if(sql.startsWith('SELECT id,account'))return[[...users.values()],[]];
   if(sql.startsWith('INSERT IGNORE INTO users')){if(users.has(params[0]))return[{affectedRows:0},[]];users.set(params[0],{id:params[0],account:params[1],name:params[2],role:params[3],phone:params[4],salt:params[5],passwordHash:params[6],createdAt:params[7]});return[{affectedRows:1},[]]}
   if(sql.startsWith('SELECT revision,data_json')){const row=health.get(params[0]);return[row?[row]:[],[]]}
   if(sql.startsWith('INSERT IGNORE INTO health_records')){if(health.has(params[0]))return[{affectedRows:0},[]];health.set(params[0],{revision:params[1],data_json:params[2]});return[{affectedRows:1},[]]}
   if(sql.startsWith('SELECT messages_json')){const row=consult.get(params[0]);return[row?[row]:[],[]]}
   if(sql.startsWith('INSERT INTO consult_threads')){consult.set(params[0],{messages_json:params[1]});return[{affectedRows:1},[]]}
   if(sql.startsWith('INSERT IGNORE INTO consult_threads')){if(consult.has(params[0]))return[{affectedRows:0},[]];consult.set(params[0],{messages_json:params[1]});return[{affectedRows:1},[]]}
   if(sql.startsWith('DELETE FROM consult_threads')){consult.delete(params[0]);return[{affectedRows:1},[]]}
   throw Error('Unexpected SQL: '+sql);
  },
  async getConnection(){return{
   async beginTransaction(){},async commit(){},async rollback(){},release(){},
   async execute(sql,params){
    if(sql.startsWith('SELECT revision FROM health_records')){const row=health.get(params[0]);return[row?[{revision:row.revision}]:[],[]]}
    if(sql.startsWith('INSERT INTO health_records')){health.set(params[0],{revision:params[1],data_json:params[2]});return[{affectedRows:1},[]]}
    if(sql.startsWith('UPDATE health_records')){health.set(params[2],{revision:params[0],data_json:params[1]});return[{affectedRows:1},[]]}
    throw Error('Unexpected transaction SQL: '+sql);
   }
  }},
  async end(){}
 };
 const db=createMysqlPersistence({}, {pool});await db.ready;assert.equal(schema.length,3);
 const user={id:'a',account:'alice',name:'爱丽丝',role:'普通用户',salt:'salt',passwordHash:'hash'};
 assert.equal(await db.users.insertIfAbsent(user),true);assert.equal(await db.users.insertIfAbsent(user),false);
 assert.equal((await db.users.read())[0].account,'alice');
 const initial=await db.health.read('a');assert.equal(initial.revision,0);assert.deepEqual(initial.data.exercise,[]);
 const changed={...initial.data,exercise:[{name:'快走',minutes:20,calories:100,date:'2026-10-25'}]};
 assert.equal((await db.health.write('a',changed,0)).revision,1);
 assert.equal(await db.health.write('a',initial.data,0),null);
 assert.equal((await db.health.read('a')).data.exercise[0].name,'快走');
 assert.equal(await db.health.importIfAbsent('a',initial),false);
 await db.consult.write('a',[{role:'user',content:'你好'}]);assert.equal((await db.consult.read('a'))[0].content,'你好');
 assert.equal(await db.consult.importIfAbsent('a',[]),false);
 await db.consult.clear('a');assert.deepEqual(await db.consult.read('a'),[]);
 await db.close();
});
