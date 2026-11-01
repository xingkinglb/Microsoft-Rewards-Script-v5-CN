# Microsoft Rewards v5 · 中文便携版

基于 [TheNetsky/Microsoft-Rewards-Script](https://github.com/TheNetsky/Microsoft-Rewards-Script) **v5.0.0** 的 Windows 便携整合包，附带零依赖中文管理界面。

> **核心设计：不改动上游源码。**
> 中文界面与日志翻译全部在 `manager/` 层实现，`app/` 与上游保持字节级一致。上游发新版时只需替换 `app/` 目录再点一次「重新构建」，管理界面无需任何适配。

**新手请直接看 [使用说明.md](使用说明.md)**，本文是技术文档。

---

## 特性

- **图形化管理** — 账号、任务开关、搜索策略、通知全部可视化配置，不用手改 JSON
- **中文日志** — 级别、平台、标题、常见消息片段全部中文化，数值字段保持原样
- **实时日志流** — SSE 推送，支持关键字过滤、自动滚动、翻译开关
- **定时任务** — 交给 Windows 任务计划程序，管理界面关掉也能跑，错过自动补跑
- **密码不回显** — 前端只拿到「是否已配置」标记，浏览器内存里没有明文
- **构建可回滚** — 编译失败自动还原上一份产物，不会把程序搞坏
- **进程可收尾** — 关窗口时任务与 Chromium 一并结束，崩溃后下次启动自动清理残留

---

## 快速开始

```bash
# 1. 双击启动（会打开 http://127.0.0.1:8899）
启动管理界面.bat

# 2. 界面里填账号 → 保存
# 3. 工具箱 → 打开浏览器手动登录（登一次，存会话）
# 4. 右上角「开始运行」
```

首次运行约 20~30 分钟。详细步骤见 [使用说明.md](使用说明.md)。

---

## 目录结构

```
Microsoft-Rewards-Script-v5/
├── app/                        上游 v5.0.0 源码（未改动）
│   ├── .env                    账号配置（含密码，勿外传）
│   ├── config.json             运行配置
│   ├── sessions/sessions.db    登录会话（含 Cookie，勿外传）
│   └── dist/                   构建产物
│
├── runtime/node/               Node.js 24.22.2 便携版，不影响系统环境
│
├── manager/                    中文管理界面
│   ├── server.js               本地服务（node:http，零第三方依赖）
│   ├── run-wrapper.js          运行看门狗，父进程消失即结束任务树
│   ├── scheduled-run.js        定时任务的无界面入口
│   ├── schedule.ps1            计划任务注册/查询/删除
│   ├── public/                 前端（HTML / CSS / JS / i18n 词表）
│   └── logs/                   运行日志
│
├── 启动管理界面.bat             双击启动
├── 停止管理界面.bat             按端口停止（窗口丢了用这个）
├── 使用说明.md                  零基础使用指南
└── README.md                   本文件
```

---

## 界面说明

| 页面 | 内容 |
| --- | --- |
| **概览** | 当前余额、本次获得、运行耗时、账号状态、最近运行记录 |
| **运行日志** | SSE 实时流、中文翻译开关、关键字过滤、自动滚动、清空显示 |
| **账号配置** | 多账号、TOTP、备用邮箱、地区语言、代理、浏览器指纹 |
| **任务设置** | 常规 / 任务开关 / 搜索 / 实验功能 / 代理 / 通知，六组分类 |
| **工具箱** | 手动登录、清空会话、定时任务、配置同步、检查更新、停止服务 |

顶栏常驻「重新构建 / 开始运行 / 停止」，状态徽章实时显示空闲、运行中、构建中或定时任务运行中。

---

## 首次使用

1. 「账号配置」填邮箱与密码（免密账号可留空）
2. 「工具箱 → 打开浏览器手动登录」完成一次登录，生成会话
3. 回「概览」点右上角 **开始运行**

> 微软经常要求验证码、备用邮箱、设备确认，程序自动填容易卡住。手动登一次存下 Cookie，之后几个月都不必再登。

登录会话保存在 `app/sessions/sessions.db`，**不要外传**。

---

## 定时任务

用 **Windows 任务计划程序** 实现，管理界面关掉也能跑，重启电脑不会丢。

### 界面设置（推荐）

「工具箱 → 定时任务」→ 填时间（24 小时制）→ 「启用 / 更新时间」。

同卡片支持「立即运行一次」「删除定时任务」，状态区显示下次运行时间与上次结果。

### 命令行设置

```bash
powershell -NoProfile -ExecutionPolicy Bypass -File manager\schedule.ps1 -Action status
powershell -NoProfile -ExecutionPolicy Bypass -File manager\schedule.ps1 -Action install -Time 07:00
powershell -NoProfile -ExecutionPolicy Bypass -File manager\schedule.ps1 -Action run
powershell -NoProfile -ExecutionPolicy Bypass -File manager\schedule.ps1 -Action remove
```

### 任务参数

| 项目 | 值 |
| --- | --- |
| 任务名 | `MicrosoftRewardsScript-v5` |
| 执行 | `runtime\node\node.exe manager\scheduled-run.js` |
| 工作目录 | 项目根目录 |
| 触发 | 每天指定时间 |
| 运行身份 | 当前用户，**仅在登录时运行**，权限 Limited |
| 错过处理 | `StartWhenAvailable` —— 关机/睡眠错过，开机后自动补跑 |
| 失败重试 | 每 10 分钟，最多 2 次 |
| 超时 | 3 小时 |

**不需要管理员权限，也不需要保存密码** —— 用的是「仅在用户登录时运行」模式。

定时运行的日志写到 `manager/logs/run_<时间戳>.log`，与手动运行同一套命名，跑完会出现在「最近运行记录」里。调度侧的动作（启动/跳过/结束）记在 `manager/logs/scheduler.log`。

> 定时任务直接跑内核，不经过管理界面，所以**运行期间没有实时日志页面**。

---

## 运行模式

「任务设置 → 常规 → 运行模式」：

- **浏览器模式**（默认）— 真实渲染页面点卡片，兼容性最好
- **API 模式** — 保存会话后关闭浏览器，任务走纯 HTTP，速度更快，依赖会话有效

---

## 安全设计

服务只监听 `127.0.0.1`，并额外做三层防护：

| 防护 | 作用 |
| --- | --- |
| **Host 头白名单** | 只接受 `127.0.0.1:8899` / `localhost:8899`。阻止 DNS rebinding —— 否则任意恶意网页把域名解析到本机就能读走数据 |
| **Origin / Sec-Fetch-Site 校验** | 拒绝跨站请求，防止网页通过 CSRF 触发停止任务、清空会话 |
| **POST 强制 `application/json`** | 跨站的 `no-cors` 请求只能发 `text/plain` 等简单类型，被这一步挡死 |

数据侧：

- **密码不下发前端** — `/api/state` 只返回 `has_password`，密码框始终为空，留空即保留原密码
- **保存账号前备份** `.env` 为 `.env.bak`
- **构建失败回滚** — 构建前把 `dist` 备份为 `dist.bak`，失败则还原

---

## 进程关系与关闭方式

标准的本地端口服务：**命令行窗口是本体，浏览器只是显示器。**

| 你关掉的 | 结果 |
| --- | --- |
| **浏览器标签页** | 服务照常运行，任务不受影响，重新打开地址即可 |
| **命令行窗口** | 服务停止，正在运行的奖励任务与 Chromium 一并结束 |
| **机器人自己弹出的浏览器** | 只打断当前这一步，任务报错终止，管理界面还在 |

停止方式任选其一：

1. 关闭命令行窗口（或 `Ctrl+C`）
2. 双击 `停止管理界面.bat`（窗口丢了用这个）
3. 界面「工具箱 → 停止管理界面服务」

重复双击 `启动管理界面.bat` 时，若服务已在运行，会提示并直接打开页面，不会启动第二个实例。

### 并发保护

定时任务与管理器手动运行是两个独立进程，同时启动会有两个机器人操作同一账号，极易触发风控。因此用 `manager/.run.lock` 互斥：

- 锁里记录持有者 PID，进程不存在则视为陈旧锁自动忽略
- 有锁时手动运行被拒绝，界面徽章显示「定时任务运行中」
- 定时任务遇到已有运行会跳过本次，记入 `scheduler.log`，退出码 0

### 孤儿进程防护

任务通过 `manager/run-wrapper.js` 看门狗启动，每 2 秒探测管理界面进程是否存活，父进程消失即结束整个进程树。运行中的 PID 同时写入 `manager/.run.pid`，下次启动自动清理上次遗留进程——即使强制关机或从任务管理器强杀，也不会留下孤立浏览器。

---

## 日志与中文化

`manager/public/i18n.js` 用词表翻译日志的级别、平台、标题和常见消息片段，`k=v` 数值保持原样。

未覆盖的英文原样显示，不影响功能。日志文件本身是英文原文，方便对照上游文档排查。

---

## 升级上游版本

```bash
# 1. 备份配置
copy app\.env app\.env.bak
copy app\config.json app\config.json.bak
copy app\sessions\sessions.db app\sessions\sessions.db.bak

# 2. 下载新版源码，替换 app/ 目录（保留 .env、config.json、sessions/）

# 3. 界面点「重新构建」，或命令行：
runtime\node\node.exe runtime\node\node_modules\npm\bin\npm-cli.js ci
runtime\node\node.exe runtime\node\node_modules\npm\bin\npm-cli.js run build
```

配置有新增字段时，点「工具箱 → 同步配置默认值」自动补齐。

> 升级后浏览器版本变化会导致旧指纹失效，程序会自动重新登录一次，属正常现象。

---

## 国内网络说明

上游的 Chromium 从 `cdn.playwright.dev` 下载，国内经常卡住不动。改用 npmmirror 镜像（目录结构与官方一致）：

```bash
set PLAYWRIGHT_DOWNLOAD_HOST=https://cdn.npmmirror.com/binaries/playwright
runtime\node\node.exe runtime\node\node_modules\npm\bin\npm-cli.js run install:browser
```

---

## 常见问题

**双击 bat 窗口闪一下就没了**
服务已在运行，脚本会提示并直接打开页面。若确认没在运行，检查是否有残留的 `manager/.run.lock`。

**点「开始运行」提示「定时任务正在运行」**
定时任务正在跑，等它结束，或先删除定时任务。

**日志出现「备选电子邮件不匹配」**
登录需要验证，用「工具箱 → 打开浏览器手动登录」重新登一次。

**日志出现「已丢弃保存的 Cookie：指纹不兼容」**
内核升级后浏览器版本变了，程序会自动重新登录，属正常现象。

**提示「尚未构建」**
点右上角「重新构建」，约 30 秒。

**改了设置不生效**
配置在下次运行开始时读取，需要重新点「开始运行」。

---

## 已知限制

| 限制 | 说明 |
| --- | --- |
| 仅支持 Windows | 依赖批处理与任务计划程序；上游本身支持 Linux/Docker |
| 定时任务需用户已登录 | 锁屏可以，注销或未登录不会运行（换取免密码、免管理员） |
| 定时运行无实时日志 | 直接跑内核，不经管理界面；结果在「最近运行记录」 |
| 日志不自动清理 | 每天约 10KB，长期运行需手动清理 `manager/logs/` |
| 管理界面无登录鉴权 | 依赖 localhost + Host/Origin 校验；不要改成监听 `0.0.0.0` |
| 配置里的通知 token 会下发前端 | Telegram / Discord / ntfy 凭据需同源页面渲染表单，属设计取舍 |
| 单账号同时只能跑一个实例 | 由 `.run.lock` 保证 |
| 移动项目目录会导致定时任务失效 | 任务里写的是绝对路径，移动后需重新「启用 / 更新时间」 |

---

## 免责声明

本项目仅用于学习自动化技术。使用自动化脚本可能违反 Microsoft 服务条款，存在账号被限制的风险，请自行评估。账号信息仅保存在本机，请勿上传到公开仓库。

## 许可

上游为 GPL-3.0-or-later，本整合包遵循同一协议。
