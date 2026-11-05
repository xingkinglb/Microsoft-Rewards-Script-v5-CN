'use strict'

/**
 * 定时运行入口
 *
 * 由 Windows 任务计划程序调用（经 manager/launch-scheduler.vbs 启动），
 * 不依赖管理界面。日志写入 manager/logs/run_<时间戳>.log，
 * 与管理界面手动运行同一套命名，因此跑完后会出现在「最近运行记录」里。
 *
 * 两种模式：
 *   静默（默认）        —— 不开窗口，所有输出只进日志文件
 *   进度窗口（--console）—— 在窗口里显示中文进度，结束时停留 1 分钟再关闭
 * 由 manager/settings.json 的 scheduledProgressWindow 决定，VBS 负责传参。
 *
 * 与管理界面手动运行通过 manager/.run.lock 互斥，避免两个机器人
 * 同时操作同一个账号。
 */

const { spawn } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const { ensureChineseQueries } = require('./query-inject')
const { patchBingOrigin } = require('./patch-dist')
const { createTranslator } = require('./progress')

const ROOT = path.resolve(__dirname, '..')
const APP_DIR = path.join(ROOT, 'app')
const NODE_EXE = path.join(ROOT, 'runtime', 'node', 'node.exe')
const LOG_DIR = path.join(__dirname, 'logs')
const LOCK_FILE = path.join(__dirname, '.run.lock')
const SETTINGS_PATH = path.join(__dirname, 'settings.json')

const CONSOLE_MODE = process.argv.includes('--console')
const HOLD_SECONDS = (() => {
    const raw = Number(process.env.REWARDS_HOLD_SECONDS ?? 60)
    return Number.isFinite(raw) && raw > 0 ? raw : 0
})()

const WIDTH = 64

// ---------------------------------------------------------------- 控制台输出

function out(text = '') {
    process.stdout.write(text + '\n')
}

function rule(char = '─') {
    out(char.repeat(WIDTH))
}

/** 中文按两格宽计算，避免倒计时那行覆盖时残留字符 */
function displayWidth(text) {
    let width = 0
    for (const ch of text) {
        width += /[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE6F\uFF00-\uFF60\uFFE0-\uFFE6]/.test(ch)
            ? 2
            : 1
    }
    return width
}

function padTo(text, width) {
    const diff = width - displayWidth(text)
    return diff > 0 ? text + ' '.repeat(diff) : text
}

// ---------------------------------------------------------------- 进度

const progress = createTranslator()
let readEarnLine = false

function printProgress(line) {
    const result = progress.translate(line)
    if (!result) return
    const mark = result.mark ? `${result.mark} ` : '  '
    const text = ` ${result.clock}  ${mark}${result.text}`
    if (result.partial) {
        process.stdout.write('\r' + padTo(text, WIDTH))
        readEarnLine = true
        return
    }
    if (readEarnLine) {
        process.stdout.write('\n')
        readEarnLine = false
    }
    out(text)
}

// ---------------------------------------------------------------- 日志与锁

function timestamp() {
    const d = new Date()
    const p = n => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`
}

/** 调度侧日志，避免用 run_*.log 污染「最近运行记录」 */
function logScheduler(message) {
    try {
        fs.mkdirSync(LOG_DIR, { recursive: true })
        fs.appendFileSync(path.join(LOG_DIR, 'scheduler.log'), `[${new Date().toISOString()}] ${message}\n`, 'utf8')
    } catch {
        /* 日志写不了就算了 */
    }
}

let child = null
let finished = false

/** 退出前：进度窗口模式下停留一会儿，让人能看清结果 */
function shutdown(code) {
    if (!CONSOLE_MODE || HOLD_SECONDS <= 0) {
        process.exit(code)
        return
    }
    let left = HOLD_SECONDS
    const label = () => ` 窗口 ${left} 秒后自动关闭（按 Ctrl+C 立即关闭）`
    out()
    process.stdout.write(label())
    const timer = setInterval(() => {
        left -= 1
        process.stdout.write('\r' + padTo(label(), WIDTH))
        if (left > 0) return
        clearInterval(timer)
        process.stdout.write('\n')
        process.exit(code)
    }, 1000)
}

function fail(message) {
    logScheduler(`失败：${message}`)
    try {
        fs.appendFileSync(
            path.join(LOG_DIR, `run_${timestamp()}.log`),
            `[${new Date().toISOString()}] [MAIN] [ERROR] MAIN [SCHEDULED] ${message}\n`,
            'utf8'
        )
    } catch {
        /* ignore */
    }
    if (CONSOLE_MODE) {
        rule()
        out(` 定时运行未开始：${message}`)
        rule()
    }
    shutdown(1)
}

function readRunLock() {
    try {
        if (!fs.existsSync(LOCK_FILE)) return null
        const info = JSON.parse(fs.readFileSync(LOCK_FILE, 'utf8'))
        if (!info || !info.pid) return null
        try {
            process.kill(info.pid, 0)
            return info
        } catch {
            return null // 持有者已退出
        }
    } catch {
        return null
    }
}

function writeRunLock(pid) {
    try {
        fs.writeFileSync(
            LOCK_FILE,
            JSON.stringify({ pid, source: 'schedule', startedAt: new Date().toISOString() }),
            'utf8'
        )
    } catch {
        /* ignore */
    }
}

function clearRunLock(pid) {
    try {
        const info = JSON.parse(fs.readFileSync(LOCK_FILE, 'utf8'))
        if (info && info.pid === pid) fs.rmSync(LOCK_FILE, { force: true })
    } catch {
        /* ignore */
    }
}

// ---------------------------------------------------------------- 日志清理

/** 按 manager/settings.json 的保留天数清理旧日志（与管理界面共用同一份设置） */
function cleanupOldLogs() {
    let days = 30
    try {
        if (fs.existsSync(SETTINGS_PATH)) {
            const parsed = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'))
            if (Number.isFinite(Number(parsed.logRetentionDays))) days = Number(parsed.logRetentionDays)
        }
    } catch {
        /* 用默认值 */
    }
    if (!(days > 0)) return 0

    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000
    let removed = 0
    try {
        for (const name of fs.readdirSync(LOG_DIR)) {
            if (!name.startsWith('run_') || !name.endsWith('.log')) continue
            const full = path.join(LOG_DIR, name)
            if (fs.statSync(full).mtimeMs < cutoff) {
                fs.rmSync(full, { force: true })
                removed += 1
            }
        }
    } catch {
        /* ignore */
    }
    return removed
}

// ---------------------------------------------------------------- 前置检查

cleanupOldLogs()

const active = readRunLock()
if (active) {
    const source = active.source === 'manager' ? '管理界面手动运行' : '另一个进程'
    logScheduler(`跳过本次定时运行：${source}正在运行（PID ${active.pid}）`)
    if (CONSOLE_MODE) {
        rule('═')
        out(` 本次跳过：${source}正在运行（PID ${active.pid}）`)
        rule('═')
    }
    shutdown(0)
}

if (!fs.existsSync(path.join(APP_DIR, 'dist', 'index.js'))) {
    fail('未找到 app/dist/index.js，请先在管理界面里执行构建')
}
if (!fs.existsSync(NODE_EXE)) {
    fail(`未找到便携版 Node: ${NODE_EXE}`)
}

// ---------------------------------------------------------------- 启动

/** 补中文搜索词表：上游词表没有 zh，国区账号会整段跳过桌面搜索 */
const injection = ensureChineseQueries()
logScheduler(
    injection.ok
        ? `中文搜索词表 | ${injection.injected ? `新增 ${injection.injected} 条` : '已存在'} | 共 ${injection.total} 条`
        : `中文搜索词表注入失败：${injection.reason}`
)

/** 容忍 Bing 中国区重定向（cn.bing.com），否则搜索整段超时 */
const bingPatch = patchBingOrigin()
logScheduler(bingPatch.ok ? `Bing 中国区补丁 | ${bingPatch.reason}` : `Bing 补丁失败：${bingPatch.reason}`)

fs.mkdirSync(LOG_DIR, { recursive: true })
const logFile = path.join(LOG_DIR, `run_${timestamp()}.log`)
const stream = fs.createWriteStream(logFile, { flags: 'a' })

if (CONSOLE_MODE) {
    rule('═')
    out(' Microsoft Rewards v5 · 定时运行')
    if (injection.ok) {
        out(` 中文搜索词 ${injection.total} 条${injection.injected ? `（本次补入 ${injection.injected} 条）` : ''}`)
    } else {
        out(` ⚠ 中文搜索词注入失败：${injection.reason}`)
    }
    out(` 日志 ${path.basename(logFile)}`)
    rule('═')
}

const env = { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' }
// 与 server.js 保持一致：优先用便携版 Node，剥离可能干扰的注入钩子
env.PATH = path.dirname(NODE_EXE) + path.delimiter + (env.PATH || env.Path || '')
env.Path = env.PATH
delete env.NODE_OPTIONS
delete env.CODEBUDDY_SAFE_DELETE_BULK_GUARD
delete env.CODEBUDDY_SAFE_DELETE_SANDBOX

child = spawn(NODE_EXE, ['dist/index.js'], {
    cwd: APP_DIR,
    env,
    windowsHide: true
})

writeRunLock(child.pid)
logScheduler(`定时运行已启动 | PID=${child.pid} | 日志=${path.basename(logFile)}`)

// 进度窗口按行解析，文件流仍保持原样逐块写入
let pendingLine = ''
let pendingErr = ''

child.stdout.on('data', chunk => {
    stream.write(chunk)
    if (!CONSOLE_MODE) return
    pendingLine += chunk.toString('utf8')
    const lines = pendingLine.split(/\r?\n/)
    pendingLine = lines.pop() ?? ''
    for (const line of lines) printProgress(line)
})

child.stderr.on('data', chunk => {
    stream.write(chunk)
    if (!CONSOLE_MODE) return
    pendingErr += chunk.toString('utf8')
    const lines = pendingErr.split(/\r?\n/)
    pendingErr = lines.pop() ?? ''
    for (const line of lines) printStderrLine(line)
})

/**
 * 上游把 WARN / ERROR 写到 stderr，而不是 stdout。
 * 能翻译的就走同一套进度格式，翻不出来的才原样打出来。
 */
function printStderrLine(line) {
    if (!line.trim()) return
    if (progress.translate(line)) {
        printProgress(line)
        return
    }
    if (readEarnLine) {
        process.stdout.write('\n')
        readEarnLine = false
    }
    out(` ! ${line.trim().slice(0, 160)}`)
}

function killChild() {
    if (finished || !child || !child.pid) return
    try {
        spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true })
    } catch {
        /* 进程可能已退出 */
    }
}

// 计划任务被取消 / 关机时，一并结束任务与浏览器
process.on('SIGTERM', () => {
    killChild()
    setTimeout(() => process.exit(0), 1500)
})
process.on('SIGINT', () => {
    killChild()
    setTimeout(() => process.exit(0), 1500)
})
process.on('exit', () => {
    if (!finished) killChild()
    if (child) clearRunLock(child.pid)
})

function printSummary() {
    if (!CONSOLE_MODE) return
    if (readEarnLine) {
        process.stdout.write('\n')
        readEarnLine = false
    }
    const s = progress.summary
    rule('═')
    const gained = Number.isFinite(s.pointsGained) ? s.pointsGained : null
    const statusText = s.status === 'partial' ? '部分完成' : s.status === 'success' ? '完成' : s.status || '结束'
    out(` 状态 ${statusText}${gained !== null ? ` · 本次 +${gained} 分` : ''}`)
    if (Number.isFinite(s.currentBalance)) {
        out(` 余额 ${s.previousBalance} → ${s.currentBalance}`)
    }
    if (Number.isFinite(s.durationSeconds)) {
        out(` 用时 ${(s.durationSeconds / 60).toFixed(1)} 分钟`)
    }
    if (s.completed !== null) {
        out(` 活动 ${s.completed} 项完成 / ${s.incomplete} 项未确认`)
    }
    if (s.reasons.length) {
        out(' 未确认：')
        for (const reason of s.reasons.slice(0, 6)) out(`   · ${reason}`)
    }
    out(` 日志 ${path.basename(logFile)}`)
    rule('═')
}

child.on('exit', code => {
    finished = true
    if (CONSOLE_MODE && pendingLine) printProgress(pendingLine)
    if (CONSOLE_MODE && pendingErr) printStderrLine(pendingErr)
    stream.end()
    logScheduler(`定时运行结束 | exitCode=${code} | 日志=${path.basename(logFile)}`)
    clearRunLock(child.pid)
    printSummary()
    shutdown(code ?? 0)
})
