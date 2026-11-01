# Microsoft Rewards v5 · 中文便携版

基于 [TheNetsky/Microsoft-Rewards-Script](https://github.com/TheNetsky/Microsoft-Rewards-Script) **v5.0.0** 的 Windows 便携整合包，附带中文管理界面。

> **核心设计：不改动上游源码。** 中文界面与日志翻译全部在 `manager/` 层实现，`app/` 保持与上游完全一致。上游发布新版本时，只需替换 `app/` 目录并重新构建，管理界面无需任何改动。

## 目录结构

```
Microsoft-Rewards-Script-v5/
├── app/                     上游 v5.0.0 源码（未改动）
│   ├── .env                 账号配置
│   ├── config.json          运行配置
│   ├── sessions/            登录会话（sessions.db）
│   └── dist/                构建产物
├── runtime/
│   └── node/                Node.js 24 便携版（不影响系统环境）
├── manager/                 中文管理界面
│   ├── server.js            本地服务（零第三方依赖）
│   ├── public/              界面（HTML/CSS/JS）
│   └── logs/                运行日志
└── 启动管理界面.bat          双击启动
```

## 快速开始

双击 **`启动管理界面.bat`**，浏览器会自动打开 `http://127.0.0.1:8899`。

界面功能：

| 页面 | 说明 |
| --- | --- |
| 概览 | 当前余额、本次获得、运行耗时、账号状态、最近运行记录 |
| 运行日志 | 实时日志流，中文翻译可开关，支持关键字过滤、自动滚动 |
| 账号配置 | 图形化编辑 `.env`，支持多账号、TOTP、地区语言、代理、指纹 |
| 任务设置 | 图形化编辑 `config.json`，按分组展示，含 v5 新增项 |
| 工具箱 | 手动登录、清空会话、同步配置默认值、检查上游更新、打开目录 |

## 定时任务

用 **Windows 任务计划程序** 实现，管理界面关掉也能跑，重启电脑不会丢。

### 在界面里设置（推荐）

「工具箱 → 定时任务」：

1. 填每天运行时间（24 小时制，如 `07:00`）
2. 点「启用 / 更新时间」
3. 状态区会显示下次运行时间和上次结果

同一张卡片还能「立即运行一次」和「删除定时任务」。

### 命令行设置

```bash
# 查看状态
powershell -NoProfile -ExecutionPolicy Bypass -File manager\schedule.ps1 -Action status

# 每天 07:00 运行
powershell -NoProfile -ExecutionPolicy Bypass -File manager\schedule.ps1 -Action install -Time 07:00

# 立即触发一次
powershell -NoProfile -ExecutionPolicy Bypass -File manager\schedule.ps1 -Action run

# 删除
powershell -NoProfile -ExecutionPolicy Bypass -File manager\schedule.ps1 -Action remove
```

### 任务是怎么配的

| 项目 | 值 |
| --- | --- |
| 任务名 | `MicrosoftRewardsScript-v5` |
| 执行 | `runtime\node\node.exe manager\scheduled-run.js` |
| 工作目录 | 项目根目录 |
| 触发 | 每天指定时间 |
| 运行身份 | 当前用户，**仅在登录时运行**，权限 Limited |
| 错过处理 | `StartWhenAvailable` —— 关机/睡眠错过时间，开机后自动补跑 |
| 失败重试 | 每 10 分钟重试，最多 2 次 |
| 超时 | 3 小时 |

**不需要管理员权限，也不需要保存密码**——因为用的是「仅在用户登录时运行」模式。

定时运行的日志写到 `manager/logs/run_<时间戳>.log`，和管理界面手动运行同一套命名，跑完会出现在「概览 → 最近运行记录」里。

> 注意：定时任务直接跑内核，不经过管理界面，所以**运行期间没有实时日志页面**。想看实时日志就手动在界面点「开始运行」。

## 安全设计

管理界面只监听 `127.0.0.1`，并额外做了三层防护：

| 防护 | 作用 |
| --- | --- |
| **Host 头白名单** | 只接受 `127.0.0.1:8899` / `localhost:8899`。阻止 DNS rebinding——否则任意恶意网页把域名解析到本机就能读走你的数据 |
| **Origin / Sec-Fetch-Site 校验** | 拒绝一切跨站请求，防止网页通过 CSRF 触发停止任务、清空会话等操作 |
| **POST 强制 `application/json`** | 跨站的 `no-cors` 请求只能发 `text/plain` 等简单类型，被这一步挡死 |

另外：

- **密码不下发前端**。`/api/state` 只返回 `has_password` 标记，密码框始终为空，留空即保留原密码——浏览器内存里不会出现明文。
- **保存账号前自动备份** `.env` 为 `.env.bak`。
- **构建失败自动回滚**。构建前把 `dist` 备份为 `dist.bak`，失败则还原，不会留下残缺产物导致任务起不来。

## 进程关系与关闭方式

这是标准的本地端口服务：**命令行窗口是本体，浏览器只是显示器。**

| 你关掉的 | 结果 |
| --- | --- |
| **浏览器标签页**（`127.0.0.1:8899`） | 服务照常运行，任务不受影响。重新打开地址即可，状态都在 |
| **命令行窗口** | 服务停止，**正在运行的奖励任务与 Chromium 一并结束** |
| **机器人自己弹出的浏览器** | 只打断当前这一步，任务报错终止，管理界面还在 |

三种停止方式，任选其一：

1. 关闭那个命令行窗口（或按 `Ctrl+C`）
2. 双击 **`停止管理界面.bat`**（窗口丢了的时候用这个）
3. 界面「工具箱 → 停止管理界面服务」

重复双击 `启动管理界面.bat` 时，如果服务已在运行，会提示已在运行并直接打开页面，不会启动第二个实例。

### 孤儿进程防护

任务通过 `manager/run-wrapper.js` 看门狗启动，每 2 秒探测管理界面进程是否存活，一旦发现父进程消失就结束整个进程树。运行中的 PID 同时写入 `manager/.run.pid`，下次启动时自动清理上次遗留的进程——即使强制关机或从任务管理器强杀，也不会留下孤立的浏览器。

## 首次使用

1. 在「账号配置」填写微软账号邮箱与密码（免密账号可留空）
2. 在「工具箱 → 打开浏览器手动登录」完成一次登录，生成会话
3. 回到「概览」点右上角 **开始运行**

> 登录会话保存在 `app/sessions/sessions.db`，包含 Cookie，**不要外传**。

## 运行模式

在「任务设置 → 常规 → 运行模式」切换：

- **浏览器模式**（默认）：真实渲染页面点卡片，兼容性最好
- **API 模式**：保存会话后关闭浏览器，任务走纯 HTTP，速度更快，依赖会话有效

## 日志中文化

`manager/public/i18n.js` 负责把日志的级别、平台、标题和常见消息片段翻成中文，数值字段（`k=v`）保持原样。

未覆盖的英文会原样显示，不影响功能。日志文件本身仍是英文原文（在 `manager/logs/` 和 `app/dist` 控制台输出），方便对照上游文档排查。

## 升级上游版本

```bash
# 1. 备份配置
copy app\.env app\.env.bak
copy app\config.json app\config.json.bak
copy app\sessions\sessions.db app\sessions\sessions.db.bak

# 2. 下载新版源码，替换 app/ 目录（保留 .env、config.json、sessions/）

# 3. 界面里点「重新构建」，或命令行：
runtime\node\node.exe runtime\node\node_modules\npm\bin\npm-cli.js ci
runtime\node\node.exe runtime\node\node_modules\npm\bin\npm-cli.js run build
```

配置有新增字段时，点「工具箱 → 同步配置默认值」自动补齐。

## 国内网络说明

上游的 Chromium 从 `cdn.playwright.dev` 下载，国内经常卡住。本项目已改用镜像：

```bash
set PLAYWRIGHT_DOWNLOAD_HOST=https://cdn.npmmirror.com/binaries/playwright
runtime\node\node.exe runtime\node\node_modules\npm\bin\npm-cli.js run install:browser
```

## 常见问题

**点「开始运行」后浏览器闪一下就没反应**
查看「运行日志」页，通常是登录需要验证。用「工具箱 → 打开浏览器手动登录」重新登录一次。

**日志提示「已丢弃保存的 Cookie：指纹不兼容」**
上游升级浏览器版本后，旧指纹会失效，程序会自动重新登录，属正常现象。

**改了配置不生效**
配置在下次运行开始时读取，需要重新点「开始运行」。

## 免责声明

本项目仅用于学习自动化技术。使用自动化脚本可能违反 Microsoft 服务条款，存在账号被限制的风险，请自行评估。账号信息仅保存在本机，请勿上传到公开仓库。

## 许可

上游为 GPL-3.0-or-later，本整合包遵循同一协议。
