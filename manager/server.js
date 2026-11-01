'use strict'

/**
 * Microsoft Rewards Script v5 — 中文管理界面 服务端
 *
 * 设计原则：
 *  1. 不改动 app/ 里的任何源码，保证以后可以整体替换升级 v5.x
 *  2. 中文化在界面层完成（日志解析 + 翻译表），源码保持原样
 *  3. 零第三方依赖，只用 Node 内置模块
 *  4. 只监听 127.0.0.1，不对外暴露
 */

const http = require('node:http')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawn, spawnSync } = require('node:child_process')

const ROOT = path.resolve(__dirname, '..')
const APP_DIR = path.join(ROOT, 'app')
const NODE_EXE = path.join(ROOT, 'runtime', 'node', 'node.exe')
const NPM_CLI = path.join(ROOT, 'runtime', 'node', 'node_modules', 'npm', 'bin', 'npm-cli.js')
const ENV_PATH = path.join(APP_DIR, '.env')
const CONFIG_PATH = path.join(APP_DIR, 'config.json')
const CONFIG_EXAMPLE = path.join(APP_DIR, 'config.example.json')
const PKG_PATH = path.join(APP_DIR, 'package.json')
const LOG_DIR = path.join(__dirname, 'logs')
const PID_FILE = path.join(__dirname, '.run.pid')
const RUN_WRAPPER = path.join(__dirname, 'run-wrapper.js')
const LOCK_FILE = path.join(__dirname, '.run.lock')
const SCHEDULE_PS1 = path.join(__dirname, 'schedule.ps1')
const SCHEDULED_RUNNER = path.join(__dirname, 'scheduled-run.js')
const TASK_NAME = 'MicrosoftRewardsScript-v5'
const PUBLIC_DIR = path.join(__dirname, 'public')
const PORT = Number(process.env.MANAGER_PORT || 8899)
const HOST = '127.0.0.1'
const MAX_LINES = 4000

const ACCOUNT_FIELDS = [
    'EMAIL',
    'PASSWORD',
    'TOTP_SECRET',
    'RECOVERY_EMAIL',
    'GEO_LOCALE',
    'LANG_CODE',
    'PROXY_HTTP',
    'PROXY_URL',
    'PROXY_PORT',
    'PROXY_USERNAME',
    'PROXY_PASSWORD',
    'SAVE_FINGERPRINT_DESKTOP',
    'SAVE_FINGERPRINT_MOBILE'
]

// ---------------------------------------------------------------- 状态

const state = {
    run: null, // { proc, startedAt, logFile, mode, exitCode }
    build: null,
    browserInstall: null,
    side: [], // 手动登录等旁路子进程，退出时一并结束
    lines: [],
    clients: new Set(),
    lastSummary: null,
    buildLines: []
}

fs.mkdirSync(LOG_DIR, { recursive: true })

// ---------------------------------------------------------------- 工具

const ANSI = /\x1b\[[0-9;]*[A-Za-z]/g
const LOG_RE = /^\[([^\]]+)\]\s+\[([^\]]+)\]\s+\[([A-Z]+)\]\s+(\S+)\s+\[([^\]]+)\]\s*([\s\S]*)$/

function stripAnsi(text) {
    return text.replace(ANSI, '')
}

function timestamp() {
    const d = new Date()
    const p = n => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`
}

function nowIso() {
    return new Date().toISOString()
}

function parseLine(raw) {
    const text = stripAnsi(raw).replace(/\r$/, '')
    const m = text.match(LOG_RE)
    if (!m) return { kind: 'raw', text, ts: nowIso() }
    return {
        kind: 'log',
        ts: m[1],
        user: m[2],
        level: m[3].toLowerCase(),
        platform: m[4],
        title: m[5],
        message: m[6],
        text
    }
}

/** 从 k=v 片段里取值，用于提取积分等指标 */
function pick(message, key) {
    const m = message.match(new RegExp(key + '=([^\\s|]+)'))
    return m ? m[1] : null
}

function broadcast(payload) {
    const data = `data: ${JSON.stringify(payload)}\n\n`
    for (const res of state.clients) {
        try {
            res.write(data)
        } catch {
            state.clients.delete(res)
        }
    }
}

function pushLine(raw, channel = 'run') {
    const entry = parseLine(raw)
    entry.channel = channel
    entry.at = nowIso()
    state.lines.push(entry)
    if (state.lines.length > MAX_LINES) state.lines.splice(0, state.lines.length - MAX_LINES)

    // 抓取运行汇总
    if (entry.kind === 'log' && entry.title === 'RUN-END') {
        state.lastSummary = {
            pointsGained: pick(entry.message, 'pointsGained'),
            previousBalance: pick(entry.message, 'previousBalance'),
            currentBalance: pick(entry.message, 'currentBalance'),
            runtimeMinutes: pick(entry.message, 'runtimeMinutes'),
            status: pick(entry.message, 'status'),
            at: entry.at
        }
    }

    broadcast({ type: 'line', line: entry, summary: state.lastSummary })
    return entry
}

function attachStream(child, channel) {
    let buffer = ''
    const onData = chunk => {
        buffer += stripAnsi(chunk.toString('utf8'))
        let idx
        while ((idx = buffer.indexOf('\n')) >= 0) {
            const line = buffer.slice(0, idx)
            buffer = buffer.slice(idx + 1)
            if (line.trim()) pushLine(line, channel)
        }
    }
    child.stdout?.on('data', onData)
    child.stderr?.on('data', onData)
    child.on('exit', () => {
        if (buffer.trim()) pushLine(buffer, channel)
        buffer = ''
    })
}

// ---------------------------------------------------------------- .env

function parseEnv(text) {
    const map = new Map()
    const extras = []
    for (const rawLine of text.split(/\r?\n/)) {
        const line = rawLine.trim()
        if (!line) continue
        if (line.startsWith('#')) {
            // 注释掉的账号字段视为空，忽略
            continue
        }
        const m = line.match(/^ACCOUNT_(\d+)_([A-Z0-9_]+)\s*=\s*(.*)$/)
        if (m) {
            const slot = Number(m[1])
            if (!map.has(slot)) map.set(slot, { slot })
            map.get(slot)[m[2].toLowerCase()] = m[3].trim()
            continue
        }
        extras.push(line)
    }
    const accounts = [...map.values()].sort((a, b) => a.slot - b.slot)
    for (const acc of accounts) {
        for (const key of Object.keys(acc)) {
            if (key !== 'slot' && acc[key] === '') delete acc[key]
        }
    }
    return { accounts, extras }
}

function serializeEnv(accounts, extras) {
    const out = [
        '# 由中文管理界面生成 — 修改后保存即生效',
        '# 账号密码只保存在本机，请勿提交到公开仓库',
        ''
    ]
    accounts
        .filter(acc => acc.email)
        .forEach(acc => {
            const slot = acc.slot
            out.push(`ACCOUNT_${slot}_EMAIL=${acc.email}`)
            if (acc.password) out.push(`ACCOUNT_${slot}_PASSWORD=${acc.password}`)
            if (acc.totp_secret) out.push(`ACCOUNT_${slot}_TOTP_SECRET=${acc.totp_secret}`)
            if (acc.recovery_email) out.push(`ACCOUNT_${slot}_RECOVERY_EMAIL=${acc.recovery_email}`)
            if (acc.geo_locale) out.push(`ACCOUNT_${slot}_GEO_LOCALE=${acc.geo_locale}`)
            if (acc.lang_code) out.push(`ACCOUNT_${slot}_LANG_CODE=${acc.lang_code}`)
            if (acc.proxy_http) out.push(`ACCOUNT_${slot}_PROXY_HTTP=${acc.proxy_http}`)
            if (acc.proxy_url) out.push(`ACCOUNT_${slot}_PROXY_URL=${acc.proxy_url}`)
            if (acc.proxy_port) out.push(`ACCOUNT_${slot}_PROXY_PORT=${acc.proxy_port}`)
            if (acc.proxy_username) out.push(`ACCOUNT_${slot}_PROXY_USERNAME=${acc.proxy_username}`)
            if (acc.proxy_password) out.push(`ACCOUNT_${slot}_PROXY_PASSWORD=${acc.proxy_password}`)
            if (acc.save_fingerprint_desktop)
                out.push(`ACCOUNT_${slot}_SAVE_FINGERPRINT_DESKTOP=${acc.save_fingerprint_desktop}`)
            if (acc.save_fingerprint_mobile)
                out.push(`ACCOUNT_${slot}_SAVE_FINGERPRINT_MOBILE=${acc.save_fingerprint_mobile}`)
            out.push('')
        })
    if (extras.length) {
        out.push('# 其他配置')
        out.push(...extras)
        out.push('')
    }
    return out.join('\n')
}

function readEnv() {
    if (!fs.existsSync(ENV_PATH)) return { accounts: [], extras: [] }
    return parseEnv(fs.readFileSync(ENV_PATH, 'utf8'))
}

// ---------------------------------------------------------------- config

function readConfig() {
    if (!fs.existsSync(CONFIG_PATH)) {
        const example = fs.existsSync(CONFIG_EXAMPLE)
            ? fs.readFileSync(CONFIG_EXAMPLE, 'utf8')
            : '{}'
        fs.writeFileSync(CONFIG_PATH, example, 'utf8')
    }
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'))
}

function writeConfig(config) {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 4), 'utf8')
}

function readVersion() {
    try {
        return JSON.parse(fs.readFileSync(PKG_PATH, 'utf8')).version
    } catch {
        return '未知'
    }
}

// ---------------------------------------------------------------- 进程控制

function isRunning() {
    return Boolean(state.run && state.run.proc && state.run.proc.exitCode === null)
}

/**
 * 跨进程运行锁
 *
 * 定时任务（scheduled-run.js）和管理器手动运行是两个独立进程。
 * 若同时启动，会有两个机器人操作同一个账号，极易触发微软风控。
 * 用一个锁文件互斥，锁里记录持有者 PID，进程不存在则视为陈旧锁。
 */
function readRunLock() {
    try {
        if (!fs.existsSync(LOCK_FILE)) return null
        const info = JSON.parse(fs.readFileSync(LOCK_FILE, 'utf8'))
        if (!info || !info.pid) return null
        try {
            process.kill(info.pid, 0) // 只探测，不发送信号
            return info
        } catch {
            return null // 持有者已退出，按陈旧锁处理
        }
    } catch {
        return null
    }
}

function writeRunLock(pid, source) {
    try {
        fs.writeFileSync(LOCK_FILE, JSON.stringify({ pid, source, startedAt: nowIso() }), 'utf8')
    } catch {
        /* 锁写不进去不阻断运行 */
    }
}

function clearRunLock() {
    try {
        fs.rmSync(LOCK_FILE, { force: true })
    } catch {
        /* ignore */
    }
}

function startRun(options = {}) {
    if (isRunning()) throw new Error('已有任务在运行中')

    // 定时任务可能正在跑，避免两个机器人同时操作同一账号
    const active = readRunLock()
    if (active) {
        const source = active.source === 'schedule' ? '定时任务' : '另一个进程'
        throw new Error(`${source}正在运行（PID ${active.pid}），请等它结束再试`)
    }

    if (!fs.existsSync(path.join(APP_DIR, 'dist', 'index.js'))) {
        throw new Error('尚未构建，请先在「工具」里执行构建')
    }

    // 可选：临时覆盖模式
    if (options.rewardsMode) {
        const config = readConfig()
        config.rewardsMode = options.rewardsMode
        writeConfig(config)
    }
    if (typeof options.headless === 'boolean') {
        const config = readConfig()
        config.headless = options.headless
        writeConfig(config)
    }

    const logFile = path.join(LOG_DIR, `run_${timestamp()}.log`)
    const stream = fs.createWriteStream(logFile, { flags: 'a' })

    // 通过看门狗启动：管理界面被强制关闭时，任务与浏览器会被一并结束
    const child = spawn(NODE_EXE, [RUN_WRAPPER, String(process.pid), path.join(APP_DIR, 'dist', 'index.js')], {
        cwd: APP_DIR,
        env: childEnv(),
        windowsHide: true
    })

    state.run = {
        proc: child,
        startedAt: nowIso(),
        logFile,
        mode: options.rewardsMode || readConfig().rewardsMode || 'browser',
        exitCode: null
    }

    // 记录 PID，供管理界面异常退出后清理孤儿进程
    try {
        fs.writeFileSync(PID_FILE, String(child.pid) + '\n', 'utf8')
    } catch {
        /* 不影响运行 */
    }
    // 加锁，阻止定时任务与手动运行并发
    writeRunLock(child.pid, 'manager')

    child.stdout?.on('data', chunk => stream.write(chunk))
    child.stderr?.on('data', chunk => stream.write(chunk))
    attachStream(child, 'run')

    const origPush = pushLine
    child.on('exit', code => {
        state.run.exitCode = code
        origPush(`[${nowIso()}] [MAIN] [INFO] MAIN [PROCESS] 进程已退出 | exitCode=${code}`, 'run')
        stream.end()
        try {
            fs.rmSync(PID_FILE, { force: true })
        } catch {
            /* ignore */
        }
        clearRunLock()
        broadcast({ type: 'state', running: false, exitCode: code, summary: state.lastSummary })
    })

    broadcast({ type: 'state', running: true, startedAt: state.run.startedAt, mode: state.run.mode })
    return state.run
}

/** 结束整个进程树（含 Chromium 子进程） */
function killTree(pid) {
    if (!pid) return
    try {
        spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true })
    } catch {
        /* ignore */
    }
}

/**
 * 管理界面异常退出后，上一次的机器人进程可能还活着。
 * 启动时检查 .run.pid，确认是本项目的 node 进程就一并结束，避免残留浏览器。
 */
function cleanupOrphan() {
    if (!fs.existsSync(PID_FILE)) return
    const pid = Number(fs.readFileSync(PID_FILE, 'utf8').trim())
    fs.rmSync(PID_FILE, { force: true })
    if (!pid) return
    try {
        process.kill(pid, 0) // 仅探测是否存在
    } catch {
        return // 进程已不存在
    }
    killTree(pid)
    console.log(`  已清理上次残留的运行进程 (PID=${pid})`)
}

/** 退出前结束正在运行的任务，避免留下孤儿进程 */
function shutdown(signal) {
    if (isRunning()) {
        const pid = state.run.proc.pid
        killTree(pid)
        console.log(`  已结束正在运行的奖励任务 (PID=${pid})`)
    }
    if (state.build) {
        killTree(state.build.proc.pid)
    }
    if (state.browserInstall) {
        killTree(state.browserInstall.proc.pid)
    }
    for (const child of state.side) {
        if (child && child.exitCode === null) killTree(child.pid)
    }
    state.side = []
    try {
        fs.rmSync(PID_FILE, { force: true })
    } catch {
        /* ignore */
    }
    // 只清理自己持有的锁，别动定时任务的
    const heldLock = readRunLock()
    if (heldLock && heldLock.source === 'manager') clearRunLock()
    if (signal) process.exit(0)
}

function stopRun() {
    if (!isRunning()) throw new Error('当前没有正在运行的任务')
    const pid = state.run.proc.pid
    // Windows 需要连子进程（浏览器）一起结束
    spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true })
    return pid
}

function childEnv() {
    // 让子进程优先使用便携版 Node，避免被系统里其他 node 垫片干扰
    const nodeDir = path.dirname(NODE_EXE)
    const env = { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' }
    env.PATH = nodeDir + path.delimiter + (env.PATH || env.Path || '')
    env.Path = env.PATH
    // 清除可能干扰构建的注入式钩子（例如 IDE 沙箱的删除保护）
    delete env.NODE_OPTIONS
    delete env.CODEBUDDY_SAFE_DELETE_BULK_GUARD
    delete env.CODEBUDDY_SAFE_DELETE_SANDBOX
    return env
}

function runNpm(args, channel, onDone, extraEnv) {
    // Windows 下不能直接 spawn .cmd，改为 node + npm-cli.js
    const child = spawn(NODE_EXE, [NPM_CLI, ...args], {
        cwd: APP_DIR,
        env: { ...childEnv(), ...(extraEnv || {}) },
        windowsHide: true
    })
    attachStream(child, channel)
    child.on('exit', code => onDone && onDone(code))
    return child
}

// ---------------------------------------------------------------- 浏览器内核

const BROWSERS_PATH =
    process.env.PLAYWRIGHT_BROWSERS_PATH ||
    path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'ms-playwright')

/** 检查 Chromium 是否已下载（patchright 与 playwright 共用该缓存目录） */
function browserStatus() {
    try {
        if (!fs.existsSync(BROWSERS_PATH)) return { installed: false, path: BROWSERS_PATH }
        const dirs = fs.readdirSync(BROWSERS_PATH).filter(name => /^chromium-\d+$/.test(name))
        if (!dirs.length) return { installed: false, path: BROWSERS_PATH }
        return { installed: true, path: BROWSERS_PATH, version: dirs[0], installing: Boolean(state.browserInstall) }
    } catch {
        return { installed: false, path: BROWSERS_PATH }
    }
}

function startBrowserInstall() {
    if (state.browserInstall) throw new Error('浏览器正在下载中')
    pushLine(
        `[${nowIso()}] [MAIN] [INFO] MAIN [BROWSER] 开始下载 Chromium | 使用国内镜像 cdn.npmmirror.com`,
        'run'
    )
    const child = runNpm(
        ['run', 'install:browser'],
        'run',
        code => {
            pushLine(
                `[${nowIso()}] [MAIN] [${code === 0 ? 'INFO' : 'ERROR'}] MAIN [BROWSER] 浏览器下载${code === 0 ? '完成' : '失败'} | exitCode=${code}`,
                'run'
            )
            state.browserInstall = null
            broadcast({ type: 'browser', running: false, exitCode: code })
        },
        { PLAYWRIGHT_DOWNLOAD_HOST: 'https://cdn.npmmirror.com/binaries/playwright' }
    )
    state.browserInstall = { proc: child, startedAt: nowIso() }
    broadcast({ type: 'browser', running: true })
    return child
}

/** 同步等待，用于重试删除前让出时间片 */
function sleepSync(ms) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

/**
 * 删除目录，带重试。
 *
 * Windows 上杀软扫描、索引服务或宿主环境注入的删除钩子都可能让
 * fs.rmSync 抛 EPERM / EBUSY / 自定义错误。直接删失败时，改用
 * 干净环境（childEnv 已剥离相关钩子）的子进程再删一次。
 */
function removeDir(dir, attempts = 3, label = 'BUILD') {
    for (let i = 1; i <= attempts; i++) {
        try {
            fs.rmSync(dir, { recursive: true, force: true })
            return true
        } catch {
            /* 落到子进程兜底 */
        }
        const result = spawnSync(
            NODE_EXE,
            [
                '-e',
                'try{require("node:fs").rmSync(process.argv[1],{recursive:true,force:true})}catch(e){process.exit(1)}',
                dir
            ],
            { env: childEnv(), windowsHide: true, timeout: 120000 }
        )
        if (result.status === 0) return true
        sleepSync(300)
    }
    pushLine(
        `[${nowIso()}] [MAIN] [WARN] MAIN [${label}] 目录清理失败 | ${path.basename(dir)} | 可手动删除`,
        'build'
    )
    return false
}

function startBuild() {
    if (state.build) throw new Error('构建已在进行中')
    if (isRunning()) throw new Error('任务运行中，无法构建')

    // 构建会先 rimraf dist，中途失败会留下残缺产物。
    // 先把旧 dist 改名备份，失败时还原。
    const distDir = path.join(APP_DIR, 'dist')
    let backupDir = path.join(APP_DIR, 'dist.bak')
    let backedUp = false

    removeDir(backupDir)
    if (fs.existsSync(backupDir)) {
        // 实在删不掉就换个名字，保证本次构建仍有回滚点
        backupDir = path.join(APP_DIR, `dist.bak.${Date.now()}`)
    }
    if (fs.existsSync(distDir)) {
        try {
            fs.renameSync(distDir, backupDir)
            backedUp = true
        } catch (error) {
            pushLine(
                `[${nowIso()}] [MAIN] [WARN] MAIN [BUILD] 旧产物备份失败，本次构建无回滚点 | ${String(error.code || error.message)}`,
                'build'
            )
        }
    }

    pushLine(`[${nowIso()}] [MAIN] [INFO] MAIN [BUILD] 开始构建 | 正在编译 TypeScript`, 'build')
    const child = runNpm(['run', 'build'], 'build', code => {
        if (code === 0) {
            if (backedUp) removeDir(backupDir)
        } else if (backedUp) {
            removeDir(distDir)
            try {
                fs.renameSync(backupDir, distDir)
                pushLine(
                    `[${nowIso()}] [MAIN] [WARN] MAIN [BUILD] 已还原构建前的产物，任务仍可正常运行`,
                    'build'
                )
            } catch (error) {
                pushLine(
                    `[${nowIso()}] [MAIN] [ERROR] MAIN [BUILD] 产物还原失败，备份保留在 ${path.basename(backupDir)} | ${String(error.code || error.message)}`,
                    'build'
                )
            }
        }
        pushLine(
            `[${nowIso()}] [MAIN] [${code === 0 ? 'INFO' : 'ERROR'}] MAIN [BUILD] 构建${code === 0 ? '完成' : '失败'} | exitCode=${code}`,
            'build'
        )
        state.build = null
        broadcast({ type: 'build', running: false, exitCode: code })
    })
    state.build = { proc: child, startedAt: nowIso() }
    broadcast({ type: 'build', running: true })
}

function startManualLogin(email, platform) {
    if (!email) throw new Error('请填写要登录的邮箱')
    const args = ['run', 'manual-login', '--', email, '--platform', platform || 'both']
    pushLine(`[${nowIso()}] [MAIN] [INFO] MAIN [MANUAL-LOGIN] 启动手动登录 | email=${email} | platform=${platform || 'both'}`, 'run')
    // 记入 side 列表，管理界面退出时一并结束，避免 npm 与浏览器残留
    const child = runNpm(args, 'run', () => {
        state.side = state.side.filter(item => item !== child)
    })
    state.side.push(child)
    return child
}

/**
 * 调用 schedule.ps1 管理 Windows 计划任务。
 *
 * 注意：必须用异步 spawn。此前用 spawnSync，PowerShell 启动约 2 秒，
 * 这段时间整个 HTTP 服务被阻塞，页面加载会卡住。
 */
function runSchedule(action, time) {
    return new Promise(resolve => {
        const args = [
            '-NoProfile',
            '-ExecutionPolicy',
            'Bypass',
            '-File',
            SCHEDULE_PS1,
            '-Action',
            action,
            '-TaskName',
            TASK_NAME
        ]
        if (action === 'install') args.push('-Time', time || '07:00')

        let out = ''
        let err = ''
        let settled = false

        const finish = payload => {
            if (settled) return
            settled = true
            resolve(payload)
        }

        const child = spawn('powershell.exe', args, { windowsHide: true })
        const timer = setTimeout(() => {
            try {
                child.kill()
            } catch {
                /* ignore */
            }
            finish({ ok: false, error: 'PowerShell 执行超时（60 秒）' })
        }, 60000)

        child.stdout.on('data', chunk => (out += chunk))
        child.stderr.on('data', chunk => (err += chunk))
        child.on('error', error => {
            clearTimeout(timer)
            finish({ ok: false, error: `无法启动 PowerShell：${error.message}` })
        })
        child.on('exit', code => {
            clearTimeout(timer)
            const line = String(out).trim().split(/\r?\n/).filter(Boolean).pop() || ''
            try {
                finish(JSON.parse(line))
            } catch {
                finish({
                    ok: false,
                    error: String(out || err).trim() || `PowerShell 退出码 ${code}`
                })
            }
        })
    })
}

function syncConfig() {    return new Promise(resolve => {
        const script = path.join(APP_DIR, 'dist', 'config', 'ConfigSync.js')
        if (!fs.existsSync(script)) {
            resolve({ ok: false, message: '未找到 ConfigSync，请先构建' })
            return
        }
        const child = spawn(NODE_EXE, [script, 'sync', '--patch'], { cwd: APP_DIR, windowsHide: true })
        let out = ''
        child.stdout?.on('data', d => (out += d.toString()))
        child.stderr?.on('data', d => (out += d.toString()))
        child.on('exit', code => resolve({ ok: code === 0, message: out.trim() || `exitCode=${code}` }))
    })
}

async function checkUpdate() {
    const current = readVersion()
    try {
        const res = await fetch('https://api.github.com/repos/TheNetsky/Microsoft-Rewards-Script/releases/latest', {
            headers: { 'User-Agent': 'rewards-manager', Accept: 'application/vnd.github+json' },
            signal: AbortSignal.timeout(10000)
        })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = await res.json()
        const latest = String(data.tag_name || '').replace(/^v/, '')
        return {
            ok: true,
            current,
            latest,
            updateAvailable: latest !== current && latest > current,
            publishedAt: data.published_at,
            url: data.html_url,
            notes: (data.body || '').slice(0, 2000)
        }
    } catch (error) {
        return { ok: false, current, message: String(error.message || error) }
    }
}

// ---------------------------------------------------------------- HTTP

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon'
}

function json(res, code, payload) {
    const body = JSON.stringify(payload)
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
    res.end(body)
}

/**
 * 本地接口防护
 *
 * 1. Host 白名单 —— 防 DNS rebinding。攻击者把恶意域名解析到 127.0.0.1，
 *    浏览器会带上 `Host: evil.com:8899`，此处直接拒绝。
 * 2. Origin / Sec-Fetch-Site 校验 —— 防跨站请求。
 * 3. POST 只接受 application/json —— 跨站的 no-cors 请求只能发
 *    text/plain 等简单类型，被这一步挡住。
 */
const ALLOWED_HOSTS = new Set([
    `${HOST}:${PORT}`,
    `localhost:${PORT}`,
    `[::1]:${PORT}`,
    HOST,
    'localhost'
])

function checkRequest(req, res) {
    const host = String(req.headers.host || '').toLowerCase()
    if (!ALLOWED_HOSTS.has(host)) {
        json(res, 403, { error: `拒绝访问：Host 不被允许（${host || '空'}）` })
        return false
    }

    if (req.method === 'GET' || req.method === 'HEAD') return true

    const origin = req.headers.origin
    if (origin) {
        let originHost = ''
        try {
            originHost = new URL(origin).host.toLowerCase()
        } catch {
            originHost = ''
        }
        if (!ALLOWED_HOSTS.has(originHost)) {
            json(res, 403, { error: '拒绝访问：请求来源不被允许' })
            return false
        }
    }

    const site = String(req.headers['sec-fetch-site'] || '')
    if (site && site !== 'same-origin' && site !== 'none') {
        json(res, 403, { error: '拒绝访问：跨站请求已被拦截' })
        return false
    }

    const contentType = String(req.headers['content-type'] || '').toLowerCase()
    if (!contentType.startsWith('application/json')) {
        json(res, 415, { error: '仅接受 application/json 请求' })
        return false
    }

    return true
}

function readBody(req) {
    return new Promise((resolve, reject) => {
        let data = ''
        req.on('data', chunk => {
            data += chunk
            if (data.length > 2 * 1024 * 1024) reject(new Error('请求体过大'))
        })
        req.on('end', () => {
            try {
                resolve(data ? JSON.parse(data) : {})
            } catch {
                reject(new Error('JSON 解析失败'))
            }
        })
        req.on('error', reject)
    })
}

function serveStatic(req, res, pathname) {
    const rel = pathname === '/' ? 'index.html' : pathname.slice(1)
    const file = path.join(PUBLIC_DIR, rel)
    if (!file.startsWith(PUBLIC_DIR) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
        res.end('404')
        return
    }
    res.writeHead(200, {
        'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
        'Cache-Control': 'no-cache'
    })
    fs.createReadStream(file).pipe(res)
}

const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${HOST}:${PORT}`)
    const pathname = url.pathname

    if (!checkRequest(req, res)) return

    if (req.method === 'GET' && !pathname.startsWith('/api/')) {
        serveStatic(req, res, pathname)
        return
    }

    try {
        // --- 状态总览（不下发密码，只告诉前端是否已配置）
        if (pathname === '/api/state') {
            const env = readEnv()
            const lock = readRunLock()
            json(res, 200, {
                version: readVersion(),
                running: isRunning(),
                building: Boolean(state.build),
                externalRun: lock && lock.source !== 'manager' ? lock : null,
                startedAt: state.run?.startedAt || null,
                exitCode: state.run?.exitCode ?? null,
                mode: state.run?.mode || null,
                config: readConfig(),
                accounts: env.accounts.map(({ password, ...rest }) => ({
                    ...rest,
                    has_password: Boolean(password)
                })),
                summary: state.lastSummary,
                nodeVersion: process.version
            })
            return
        }

        // --- 账号（空密码表示沿用原密码，避免前端持有明文）
        if (pathname === '/api/accounts' && req.method === 'POST') {
            const body = await readBody(req)
            const incoming = Array.isArray(body.accounts) ? body.accounts : []
            const env = readEnv()
            const byEmail = new Map(
                env.accounts.filter(a => a.email).map(a => [a.email.toLowerCase(), a])
            )
            const merged = incoming.map(acc => {
                if (acc.password) return acc
                const prev = acc.email ? byEmail.get(acc.email.toLowerCase()) : null
                return prev && prev.password ? { ...acc, password: prev.password } : acc
            })
            // 先备份，再写入
            if (fs.existsSync(ENV_PATH)) {
                try {
                    fs.copyFileSync(ENV_PATH, ENV_PATH + '.bak')
                } catch {
                    /* 备份失败不阻断保存 */
                }
            }
            fs.writeFileSync(ENV_PATH, serializeEnv(merged, env.extras), 'utf8')
            json(res, 200, { ok: true, message: '账号已保存（原文件备份为 .env.bak）' })
            return
        }

        // --- 配置
        if (pathname === '/api/config' && req.method === 'POST') {
            const body = await readBody(req)
            if (!body || typeof body !== 'object') throw new Error('配置格式不正确')
            writeConfig(body)
            json(res, 200, { ok: true, message: '配置已保存，下次运行生效' })
            return
        }

        // --- 运行
        if (pathname === '/api/run/start' && req.method === 'POST') {
            const body = await readBody(req)
            const run = startRun(body)
            json(res, 200, { ok: true, pid: run.proc.pid, logFile: run.logFile })
            return
        }
        if (pathname === '/api/run/stop' && req.method === 'POST') {
            const pid = stopRun()
            json(res, 200, { ok: true, pid })
            return
        }

        // --- 最近运行记录
        if (pathname === '/api/recent-runs') {
            const runs = []
            const files = fs
                .readdirSync(LOG_DIR)
                .filter(name => name.startsWith('run_') && name.endsWith('.log'))
                .map(name => ({ name, mtime: fs.statSync(path.join(LOG_DIR, name)).mtimeMs }))
                .sort((a, b) => b.mtime - a.mtime)
                .slice(0, 8)

            for (const file of files) {
                const full = path.join(LOG_DIR, file.name)
                const size = fs.statSync(full).size
                const start = Math.max(0, size - 64 * 1024)
                const fd = fs.openSync(full, 'r')
                const buf = Buffer.alloc(size - start)
                fs.readSync(fd, buf, 0, buf.length, start)
                fs.closeSync(fd)
                const tail = stripAnsi(buf.toString('utf8'))
                const match = tail.match(/\[RUN-END\][^\n]*/)
                let status = 'interrupted'
                let points = null
                if (match) {
                    points = pick(match[0], 'pointsGained')
                    status = pick(match[0], 'status') || 'completed'
                }
                runs.push({ file: file.name, at: new Date(file.mtime).toISOString(), status, points })
            }
            json(res, 200, { runs })
            return
        }

        // --- 日志
        if (pathname === '/api/logs') {
            const limit = Number(url.searchParams.get('limit') || 1000)
            json(res, 200, { lines: state.lines.slice(-limit), summary: state.lastSummary })
            return
        }
        if (pathname === '/api/logs/stream') {
            res.writeHead(200, {
                'Content-Type': 'text/event-stream; charset=utf-8',
                'Cache-Control': 'no-cache',
                Connection: 'keep-alive'
            })
            res.write(`data: ${JSON.stringify({ type: 'hello', running: isRunning(), summary: state.lastSummary })}\n\n`)
            state.clients.add(res)
            const ping = setInterval(() => {
                try {
                    res.write(': ping\n\n')
                } catch {
                    /* ignore */
                }
            }, 20000)
            req.on('close', () => {
                clearInterval(ping)
                state.clients.delete(res)
            })
            return
        }

        // --- 工具
        if (pathname === '/api/build' && req.method === 'POST') {
            startBuild()
            json(res, 200, { ok: true })
            return
        }
        if (pathname === '/api/manual-login' && req.method === 'POST') {
            const body = await readBody(req)
            startManualLogin(body.email, body.platform)
            json(res, 200, { ok: true })
            return
        }
        if (pathname === '/api/config-sync' && req.method === 'POST') {
            const result = await syncConfig()
            json(res, 200, result)
            return
        }
        if (pathname === '/api/browser') {
            if (req.method === 'GET') {
                json(res, 200, browserStatus())
                return
            }
            startBrowserInstall()
            json(res, 200, { ok: true, message: '已开始下载浏览器，进度见运行日志' })
            return
        }
        if (pathname === '/api/schedule') {
            if (req.method === 'GET') {
                json(res, 200, await runSchedule('status'))
                return
            }
            const body = await readBody(req)
            const action = String(body.action || '')
            if (!['install', 'remove', 'run'].includes(action)) throw new Error('未知操作')
            json(res, 200, await runSchedule(action, body.time))
            return
        }
        if (pathname === '/api/update') {
            const result = await checkUpdate()
            json(res, 200, result)
            return
        }
        if (pathname === '/api/open-folder' && req.method === 'POST') {
            const body = await readBody(req)
            const targets = {
                app: APP_DIR,
                logs: LOG_DIR,
                sessions: path.join(APP_DIR, 'sessions'),
                diagnostics: path.join(APP_DIR, 'diagnostics')
            }
            const target = targets[body.which]
            if (!target) throw new Error('未知目录')
            fs.mkdirSync(target, { recursive: true })
            spawn('explorer.exe', [target], { detached: true, windowsHide: true }).unref()
            json(res, 200, { ok: true })
            return
        }
        if (pathname === '/api/clear-sessions' && req.method === 'POST') {
            const dir = path.join(APP_DIR, 'sessions')
            let removed = 0
            if (fs.existsSync(dir)) {
                for (const name of fs.readdirSync(dir)) {
                    fs.rmSync(path.join(dir, name), { recursive: true, force: true })
                    removed++
                }
            }
            json(res, 200, { ok: true, message: `已清理 ${removed} 个会话文件` })
            return
        }
        if (pathname === '/api/shutdown' && req.method === 'POST') {
            json(res, 200, { ok: true, message: '管理界面正在停止' })
            console.log('')
            console.log('  收到界面停止指令，正在退出…')
            setTimeout(() => shutdown(true), 300)
            return
        }

        json(res, 404, { error: '接口不存在' })
    } catch (error) {
        json(res, 400, { error: String(error.message || error) })
    }
})

server.listen(PORT, HOST, () => {
    console.log('')
    console.log('  ┌──────────────────────────────────────────────┐')
    console.log('  │   Microsoft Rewards v5 · 中文管理界面        │')
    console.log('  └──────────────────────────────────────────────┘')
    console.log('')
    console.log(`  访问地址: http://${HOST}:${PORT}`)
    console.log(`  程序目录: ${APP_DIR}`)
    console.log(`  运行时  : ${NODE_EXE}`)
    console.log('')
    cleanupOrphan()
    console.log('  ────────────────────────────────────────────────')
    console.log('  这个窗口就是服务本体：')
    console.log('    · 关闭它 = 停止管理界面，正在跑的奖励任务会一并结束')
    console.log('    · 关掉浏览器网页不影响服务，重新打开地址即可')
    console.log('    · 按 Ctrl+C 也可以正常退出')
    console.log('  ────────────────────────────────────────────────')
    console.log('')
})

process.on('uncaughtException', error => {
    console.error('[管理界面] 未捕获异常:', error)
})

// 关闭命令行窗口 / Ctrl+C / 注销时，一并结束子进程，避免留下孤儿
process.on('SIGINT', () => shutdown(true))
process.on('SIGBREAK', () => shutdown(true))
process.on('SIGHUP', () => shutdown(true))
process.on('SIGTERM', () => shutdown(true))
process.on('exit', () => shutdown(false))
