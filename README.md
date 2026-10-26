# 安康守护：健康安全 Web 网站

这里是可公开分享的**源码副本**，不是正在运行的 `D:\测试\安全`。用户站、管理员后台和 API 在 `安全/`；`账号/public/` 只提供共用的登录界面，必须保持两个目录同级。不要单独运行 `账号` 文件夹。

## 功能和技术

- Node.js 原生 HTTP 服务；浏览器端 HTML、CSS、JavaScript；MySQL 8（可选，本地演示也支持 JSON 数据）。
- 普通用户：个人档案、运动/饮食/睡眠/视力记录、计划、挑战、健康分析、知识检索与 AI 问诊。记录按账号隔离，游客记录为空。
- 管理员：独立登录界面与汇总看板；不通过普通用户接口修改个人记录。
- 天气由后端请求 Open-Meteo；AI 服务需要另行配置兼容接口。AI 功能不是医疗诊断。

## 本地运行

需要 Node.js 18+。在仓库根目录打开 PowerShell：

```powershell
cd .\安全
npm ci
node .\scripts\init-demo-user.cjs
npm start
```

然后打开 `http://localhost:3000/`。按 `Ctrl+C` 停止。初始化脚本只在 `账号/data/users.json` 不存在时生成普通用户与管理员两个独立的本地演示账号；各自随机密码会显示在**本机终端**，不要把它们提交到 GitHub。该初始化脚本只用于无 MySQL 的本地演示。

如需 MySQL，先创建空数据库，在启动前设置 `MYSQL_HOST`、`MYSQL_USER`、`MYSQL_PASSWORD`、`MYSQL_DATABASE` 等环境变量；服务会建立表，但**不会自动创建数据库账号**。真实账号数据不要上传到仓库。项目原有的 `安全/scripts/start-local.ps1` 写死了开发电脑的 MySQL 路径，不适用于其他电脑；其他电脑请按上述命令启动。

AI 问诊/洞察需要在服务器环境变量中配置 `HEALTH_AI_API_KEY`、`HEALTH_AI_MODEL` 和 `HEALTH_AI_BASE_URL`。`.env.example` 只是字段示例，程序不会自动加载它。未配置时，相关 AI 服务不可用，不会假装回答。

## 安全与公开范围

不要上传 `data/`、数据库文件或备份、`node_modules/`、`.env`、API 密钥、日志和含个人信息的截图。公开前轮换所有曾在聊天、截图或代码中出现过的密钥。此项目默认只监听 `127.0.0.1`，不适合直接公网部署；公网使用还需要 HTTPS、安全 Cookie、稳定的 `SESSION_SECRET`、数据库备份、账号管理和安全审查。

参考项目与功能边界见 [`安全/README.md`](安全/README.md)。

## 验证

```powershell
cd .\安全
node --test test/*.test.js
```
