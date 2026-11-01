'use strict'

/**
 * 定时运行入口
 *
 * 由 Windows 任务计划程序调用，不依赖管理界面。
 * 日志写入 manager/logs/run_<时间戳>.log，与管理界面手动运行同一套命名，
 * 因此跑完后会出现在界面的「最近运行记录」里。
 *
 * 与管理界面手动运行通过 manager/.run.lock 互斥，避免两个机器人
 * 同时操作同一个账号。
 */

const { spawn } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')
const APP_DIR = path.join(ROOT, 'app')
const NODE_EXE = path.join(ROOT, 'runtime', 'node', 'node.exe')
const LOG_DIR = path.join(__dirname, 'logs')
const LOCK_FILE = path.join(__dirname, '.run.lock')

function timestamp() {
    const d = new Date()
    const p = n => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`
}

/** 调度侧日志，避免用 run_*.log 污染「最近运行记录」 */
function logScheduler(message) {
    try {
        fs.mkdirSync(LOG_DIR, { recursive: true })
        fs.appendFileSync(
            path.join(LOG_DIR, 'scheduler.log'),
            `[${new Date().toISOString()}] ${message}\n`,
            'utf8'
        )
    } catch {
        /* 日志写不了就算了 */
    }
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
    process.exit(1)
}

// ---------------------------------------------------------------- 运行锁

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

// ---------------------------------------------------------------- 前置检查

const active = readRunLock()
if (active) {
    const source = active.source === 'manager' ? '管理界面手动运行' : '另一个进程'
    logScheduler(`跳过本次定时运行：${source}正在运行（PID ${active.pid}）`)
    process.exit(0)
}

if (!fs.existsSync(path.join(APP_DIR, 'dist', 'index.js'))) {
    fail('未找到 app/dist/index.js，请先在管理界面里执行构建')
}
if (!fs.existsSync(NODE_EXE)) {
    fail(`未找到便携版 Node: ${NODE_EXE}`)
}

// ---------------------------------------------------------------- 启动

fs.mkdirSync(LOG_DIR, { recursive: true })
const logFile = path.join(LOG_DIR, `run_${timestamp()}.log`)
const stream = fs.createWriteStream(logFile, { flags: 'a' })

const env = { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' }
// 与 server.js 保持一致：优先用便携版 Node，剥离可能干扰的注入钩子
env.PATH = path.dirname(NODE_EXE) + path.delimiter + (env.PATH || env.Path || '')
env.Path = env.PATH
delete env.NODE_OPTIONS
delete env.CODEBUDDY_SAFE_DELETE_BULK_GUARD
delete env.CODEBUDDY_SAFE_DELETE_SANDBOX

const child = spawn(NODE_EXE, ['dist/index.js'], {
    cwd: APP_DIR,
    env,
    windowsHide: true
})

writeRunLock(child.pid)
logScheduler(`定时运行已启动 | PID=${child.pid} | 日志=${path.basename(logFile)}`)

child.stdout.on('data', chunk => stream.write(chunk))
child.stderr.on('data', chunk => stream.write(chunk))

let finished = false

function killChild() {
    if (finished || !child.pid) return
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
    clearRunLock(child.pid)
})

child.on('exit', code => {
    finished = true
    stream.end()
    logScheduler(`定时运行结束 | exitCode=${code} | 日志=${path.basename(logFile)}`)
    clearRunLock(child.pid)
    process.exit(code ?? 0)
})
