'use strict'

/**
 * 运行看门狗
 *
 * Windows 关闭控制台窗口时不会给 Node 发送可靠信号，父进程（管理界面）
 * 可能直接消失而留下孤儿进程和一堆 Chromium。这个包装层负责：
 *   1. 代理目标脚本，把 stdout/stderr 原样转给父进程
 *   2. 轮询父进程是否还活着，一旦消失就结束整个进程树
 *
 * 用法：node run-wrapper.js <父进程PID> <目标脚本路径>
 */

const { spawn } = require('node:child_process')
const path = require('node:path')

const parentPid = Number(process.argv[2])
const targetScript = process.argv[3]

if (!parentPid || !targetScript) {
    console.error('[看门狗] 参数错误：需要 <父进程PID> <目标脚本>')
    process.exit(1)
}

const child = spawn(process.execPath, [targetScript], {
    // 必须继承父进程的工作目录（app/），否则会话库、配置等相对路径会解析错
    cwd: process.cwd(),
    env: process.env,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe']
})

// 原样转发输出，保持父进程的日志解析逻辑不变
child.stdout.on('data', chunk => process.stdout.write(chunk))
child.stderr.on('data', chunk => process.stderr.write(chunk))

function killTree(pid) {
    try {
        spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true })
    } catch {
        /* 进程可能已退出 */
    }
}

let finished = false

// 父进程消失检测
const watchdog = setInterval(() => {
    try {
        process.kill(parentPid, 0) // 只探测，不发送信号
    } catch {
        clearInterval(watchdog)
        if (!finished) {
            console.error('[看门狗] 管理界面已退出，正在结束奖励任务及其浏览器进程')
            killTree(child.pid)
            setTimeout(() => process.exit(0), 1500)
        }
    }
}, 2000)
watchdog.unref?.()

// 自己收到终止信号时，连带结束子进程
const bail = () => {
    killTree(child.pid)
    setTimeout(() => process.exit(0), 1200)
}
process.on('SIGINT', bail)
process.on('SIGBREAK', bail)
process.on('SIGHUP', bail)
process.on('SIGTERM', bail)
process.on('exit', () => {
    if (!finished) killTree(child.pid)
})

child.on('exit', code => {
    finished = true
    clearInterval(watchdog)
    process.exit(code ?? 0)
})
