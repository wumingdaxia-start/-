'use strict';
// For local, no-MySQL demos only. Never commit the generated account file.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const destination = path.join(__dirname, '..', '..', '账号', 'data', 'users.json');
if (fs.existsSync(destination)) {
  console.log('本地账号文件已存在；未覆盖现有账号。');
  process.exit(0);
}
function makeUser(account, name, role) {
  const password = crypto.randomBytes(18).toString('base64url');
  const salt = crypto.randomBytes(16).toString('hex');
  return { password, user: {
    id: crypto.randomUUID(), account, name, role, phone: '', salt,
    passwordHash: crypto.scryptSync(password, salt, 64).toString('hex'),
    createdAt: new Date().toISOString()
  } };
}
const ordinary = makeUser('demo-user', '演示用户', '普通用户');
const administrator = makeUser('demo-admin', '演示管理员', '健康安全管理员');
fs.mkdirSync(path.dirname(destination), { recursive: true });
fs.writeFileSync(destination, JSON.stringify([ordinary.user, administrator.user], null, 2), { encoding: 'utf8', flag: 'wx', mode: 0o600 });
console.log('普通用户：demo-user；密码：' + ordinary.password);
console.log('管理员：demo-admin；密码：' + administrator.password);
console.log('请妥善保存以上密码；不要上传账号数据文件。');
