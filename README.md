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

## 进程关系与关闭方式

理解这三层的关系，才知道关什么会关掉什么：

| 你关掉的 | 结果 |
| --- | --- |
| **浏览器标签页**（`127.0.0.1:8899`） | 管理界面服务**仍在运行**，任务不受影响。重新打开地址即可，数据都在 |
| **黑色命令行窗口** | 管理界面停止，**正在运行的奖励任务会一并结束**，机器人启动的 Chromium 也会被清理 |
| **机器人自己弹出的浏览器** | 只会打断当前这一步，任务会报错终止 |

实现方式：任务通过 `manager/run-wrapper.js` 看门狗启动，它每 2 秒检查管理界面进程是否存活，一旦发现父进程消失就结束整个进程树。同时运行中的 PID 写入 `manager/.run.pid`，下次启动管理界面时会自动清理上次遗留的进程——即使你是强制关机或直接结束任务管理器里的进程，也不会留下孤立的浏览器。

> 建议：让命令行窗口保持打开，任务跑完再关。中途要停任务，用界面上的「停止」按钮，而不是关窗口。

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
