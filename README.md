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
├── scripts/package.js          打包脚本（生成可发布的便携版）
├── .github/workflows/          打 tag 时自动构建发布
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

## 地区与语言

两个字段容易混淆，作用完全不同：

| 字段 | 作用 | 取值 |
| --- | --- | --- |
| `ACCOUNT_N_GEO_LOCALE` | 账号所属市场。用于 `X-Rewards-Country` 请求头、App 任务国家参数、搜索词地区选择 | 两位 ISO 3166-1 代码，如 `cn` `us` `gb`，或 `auto` |
| `ACCOUNT_N_LANG_CODE` | 搜索词与页面语言，和地区组合成 `zh-CN`、`en-US` | 如 `zh` `en` `ja` `pt-BR` |

代码实现见 `src/util/Locale.ts` 的 `resolveAccountLocale()`，国家码经 `normalizeCountry()` 校验——**只接受两位字母**，`uk`、`usa`、中文都会被视为无效并回落。

### `auto` 模式

填 `auto` 时程序按此顺序解析：

1. 读会话库里缓存的 region（`loadResolvedRegion`）
2. 拿到 dashboard 后用微软档案 `userProfile.attributes.country` 校正
3. 写回缓存（`saveResolvedRegion`）

对不确定地区的人最省事，推荐默认使用。

### 代理的必要性

**`GEO_LOCALE` 不是网络设置** —— 它只改变请求里声明的市场，不改变出口 IP。

| 场景 | 建议 |
| --- | --- |
| 国区账号 + 国内网络 | 直连，无需代理 |
| 非国区账号 + 国内网络 | **建议配对应地区代理** |
| 多地区账号混用 | 每账号配各自地区代理 |

原因：`BING` 常量固定为 `https://www.bing.com`，国内 IP 会被导向 `cn.bing.com`；而账号市场是美区时，活动列表与积分归因按美区计算，IP 与市场不一致常见表现是「跑完但没加分」。

代理配置在 `.env`：

```dotenv
ACCOUNT_1_PROXY_URL=http://host:port
ACCOUNT_1_PROXY_PORT=0
ACCOUNT_1_PROXY_USERNAME=
ACCOUNT_1_PROXY_PASSWORD=
ACCOUNT_1_PROXY_HTTP=false
```

支持 HTTP / HTTPS / 免认证 SOCKS，**SOCKS 不支持带账号密码**。

### 如何验证生效

运行日志的 `ACCOUNT-START` 行会打印实际使用的 locale：

```
Starting account: xxx@outlook.com | geoLocale: CN | locale: zh-CN | cachedRegion: CN
```

`geoLocale` 与填写值不符即说明代码无效被回落。

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

## 打包发布

发布一个开箱即用的压缩包（约 67 MB，解压 206 MB）：

```bash
node scripts/package.js          # 只生成目录 dist-package/Microsoft-Rewards-Script-v5
node scripts/package.js --zip    # 额外压缩为 zip
```

打包内容：`app/`（含 node_modules 与 dist）+ `runtime/node/` + `manager/` + 启动脚本 + 文档。

**不包含**：`.env`、`sessions/`、`config.json`、日志、`.git`、Chromium。

脚本内置安全闸门——打包后校验 `app/.env`、`app/sessions`、`app/config.json`、`manager/logs` 不存在，否则直接失败退出，避免把账号信息打进发布包。

### 自动发布

`.github/workflows/release.yml` 会在**推送 tag** 时自动构建并发布 Release：

```bash
git tag v5.0.0-cn.2
git push origin v5.0.0-cn.2
```

流程：`npm ci` → `npm run build` → 下载 Node 24.22.2 便携版到 `runtime/node` → 打包 → 上传 Release 资产。

也可以在 Actions 页面手动触发（`workflow_dispatch`），此时产物作为 artifact 保留 7 天，不发 Release。

> 为什么包内不含 Chromium：浏览器缓存 719 MB 且装在用户系统目录（`%LOCALAPPDATA%\ms-playwright`），打进包里会让每次更新都要重传 400 MB。改为首次运行时在界面「工具箱 → 浏览器内核」点一次下载，只需装一次。

## 配置项说明

「任务设置」页可视化编辑，底层写入 `app/config.json`。默认值取自上游 `config.example.json`，**一般情况不需要修改**。

判断自己是否在默认状态：`app/config.json` 与 `app/config.example.json` 逐项一致即是。改了想恢复，点「工具箱 → 同步配置默认值」或删掉 `config.json` 重启。

### 常规

| 配置键 | 界面名称 | 默认 | 说明 |
| --- | --- | --- | --- |
| `rewardsMode` | 运行模式 | `browser` | `browser` 渲染页面点卡片最稳；`api` 走纯 HTTP 更快，但依赖会话有效 |
| `headless` | 无头模式 | `false` | 不显示浏览器窗口。排查问题时必须关闭才能观察 |
| `clusters` | 并发账号数 | `1` | 同时处理的账号数，单账号填 1 |
| `continueOnBotWarning` | 遇风控提示仍继续 | `false` | 微软明确警告异常行为时是否继续。开启会显著提高封号风险 |
| `ensureStreakProtection` | 自动开启连击保护 | `true` | 自动激活连击保护，断连会掉分 |
| `autoClaimPunchcardRewards` | 自动领取打卡奖励 | `false` | 打卡完成后自动点领取 |
| `skipNonPointTasks` | 跳过无积分任务 | `true` | 0 分任务直接跳过，省时间 |
| `errorDiagnostics` | 保存错误诊断 | `false` | 出错时把页面 HTML/截图写入 `app/diagnostics/` |
| `debugLogs` | 调试日志 | `false` | 输出更详细，日志体积显著变大 |
| `accountDelay` / `taskDelay` | 账号/任务间隔 | — | 见 config.json，控制整体节奏 |

### 任务开关

`workers.*` 控制做什么，`activities.*` 控制两类特殊活动。

| 配置键 | 界面名称 | 默认 | 说明 |
| --- | --- | --- | --- |
| `workers.doDailySet` | 每日任务集 | `true` | 主页三张日常卡片，核心积分来源 |
| `workers.doMorePromotions` | 更多推广 | `true` | 弹出层里的额外活动 |
| `workers.doPunchCards` | 打卡任务 | `true` | 月度打卡，部分步骤需消费 |
| `workers.doClaimBonusPoints` | 领取奖励积分 | `true` | 领取账户中可领的奖励 |
| `workers.doAppPromotions` | 应用推广 | `true` | Bing App 相关任务 |
| `workers.doDailyCheckIn` | 每日签到 | `true` | App 每日签到 |
| `workers.doReadToEarn` | 阅读赚积分 | `true` | 阅读新闻赚分 |
| `workers.doDesktopSearch` | 桌面端搜索 | `true` | 主要积分来源 |
| `workers.doMobileSearch` | 移动端搜索 | `true` | 移动端搜索积分 |
| `workers.doBonusSearches` | 额外搜索奖励 | `false` | 超出配额继续搜，上限见 `maxBonusSearches`。**开启会显著提高风控风险** |
| `workers.doActivateSearchPerk` | 搜索加成激活 | `true` | CN 区无此活动，日志提示 unavailable 属正常 |
| `workers.doVisualSearch` | 视觉搜索 | `true` | ⚠️ CN 区无入口，建议关闭，见下方「地区限制」 |
| `activities.urlReward` | 链接奖励活动 | `true` | 点链接类活动 |
| `activities.searchOnBing` | Explore on Bing | `true` | Explore 板块任务 |

### 搜索

| 配置键 | 界面名称 | 默认 | 说明 |
| --- | --- | --- | --- |
| `searchSettings.parallelSearching` | 桌面/移动并行搜索 | `true` | 两个平台同时搜，不排队 |
| `searchSettings.clusterSearch` | 关联搜索词扩展 | `true` | 一个词衍生一组相关词 |
| `searchSettings.useAccountLocale` | 按账号地区选搜索词 | `true` | 关闭则固定英文/美区词，CN 账号反而更不自然 |
| `searchSettings.runOnZeroPoints` | 无积分时仍搜索 | `false` | 配额用完继续搜，纯浪费 |
| `searchSettings.scrollRandomResults` | 随机滚动结果页 | `false` | 收益不明，增加操作痕迹 |
| `searchSettings.clickRandomResults` | 随机点击结果 | `false` | 同上 |
| `searchOnBingLocalQueries` | 使用内置中文搜索词库 | `false` | 默认用 Bing 联想词，更接近真人 |
| `searchSettings.maxSearchOnBingAttempts` | Explore 最大尝试次数 | `3` | Explore 板块重试上限 |
| `searchSettings.maxBonusSearches` | 额外搜索上限 | `110` | 仅 `doBonusSearches` 开启时生效，0 表示关闭 |
| `searchSettings.searchDelay` | 搜索间隔 | `30sec ~ 1min` | **不建议低于 15 秒** |
| `searchSettings.readDelay` | 阅读间隔 | `30sec ~ 1min` | 阅读任务之间的停顿 |
| `searchSettings.searchResultVisitTime` | 结果页停留时长 | `10sec` | 每次搜索停留时间 |

### 实验功能

| 配置键 | 界面名称 | 默认 | 说明 |
| --- | --- | --- | --- |
| `experimental.blockMedia` | 屏蔽图片/视频加载 | `false` | 加快加载省流量，但可能让依赖渲染的任务判定失败 |
| `experimental.edgeBrowsing` | 后台 Edge 浏览任务 | `false` | Edge 专属任务，可多拿分但稳定性未知 |
| `experimental.browserSearchApiReport` | 浏览器搜索后补一次 API 上报 | `false` | 可能提高计分成功率，也可能被判定异常 |

### 地区限制（CN 账号的已知现象）

以下日志不是故障，是账号所在市场本身不提供对应能力：

| 日志片段 | 含义 | 建议 |
| --- | --- | --- |
| `No rendered visual-search activation control matched` | 视觉搜索入口不存在 | 关闭 `workers.doVisualSearch` |
| `No search multiplier is offered to this account` | 无搜索加成活动 | 无需处理 |
| `Mobile: unknown` / `Mobile search quota ... quota unavailable` | 仪表盘不返回移动搜索计数，`SearchProgress.getMissing()` 返回 `available: false` 后跳过 | 若网页端确实有移动搜索任务，则属上游对 CN 区兼容问题 |
| `claimable bonus unknown` | 读不到可领取奖励 | 无需处理 |
| `Punchcard ... lockedOrDisabled=N` | 打卡步骤需消费或特定操作 | 正常 |

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
