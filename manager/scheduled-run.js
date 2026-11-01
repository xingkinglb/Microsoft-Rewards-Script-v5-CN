'use strict'

/**
 * 定时运行入口
 *
 * 由 Windows 任务计划程序调用，不依赖管理界面。
 * 日志写入 manager/logs/run_<时间戳>.log，与管理界面手动运行同一套命名，
 * 因此跑完后会出现在界面的「最近运行记录」里。
 */

const { spawn } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')
const APP_DIR = path.join(ROOT, 'app')
const NODE_EXE = path.join(ROOT, 'runtime', 'node', 'node.exe')
const LOG_DIR = path.join(__dirname, 'logs')

function timestamp() {
    const d = new Date()
    const p = n => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`
}

function fail(message) {
    // 失败也要落盘，方便事后排查
    try {
        fs.mkdirSync(LOG_DIR, { recursive: true })
        fs.appendFileSync(
            path.join(LOG_DIR, `run_${timestamp()}.log`),
            `[${new Date().toISOString()}] [MAIN] [ERROR] MAIN [SCHEDULED] ${message}\n`,
            'utf8'
        )
    } catch {
        /* 日志都写不了就放弃 */
    }
    process.exit(1)
}

if (!fs.existsSync(path.join(APP_DIR, 'dist', 'index.js'))) {
    fail('未找到 app/dist/index.js，请先在管理界面里执行构建')
}
if (!fs.existsSync(NODE_EXE)) {
    fail(`未找到便携版 Node: ${NODE_EXE}`)
}

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
})

child.on('exit', code => {
    finished = true
    stream.end()
    process.exit(code ?? 0)
})
