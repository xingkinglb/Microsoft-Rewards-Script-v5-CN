'use strict'

/**
 * 历史运行回填
 *
 * 管理界面重启后内存里的日志和汇总是空的，概览一片「—」、日志页空白。
 * 这里在启动时读最近的 run_*.log，把三样东西恢复出来：
 *
 *   1. lines    —— 最新那份日志的最后 N 行，填回日志页
 *   2. summary  —— 最近一条 RUN-END，用来填概览四格
 *   3. balances —— 每个账号最近一次的余额（跨多份日志归并，新账优先）
 *
 * 只读，不改任何日志文件。
 */

const fs = require('node:fs')
const path = require('node:path')
const { translateActivity } = require('./progress')

const ANSI = /\x1b\[[0-9;]*[A-Za-z]/g
const LOG_RE = /^\[([^\]]+)\]\s+\[([^\]]+)\]\s+\[([A-Z]+)\]\s+(\S+)\s+\[([^\]]+)\]\s*([\s\S]*)$/

function stripAnsi(text) {
    return text.replace(ANSI, '')
}

function parseLine(raw) {
    const text = stripAnsi(raw).replace(/\r$/, '')
    const m = text.match(LOG_RE)
    if (!m) return { kind: 'raw', text, ts: new Date().toISOString() }
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

function pickValue(message, key) {
    const m = message.match(new RegExp(key + '=([^\\s|]+)'))
    return m ? m[1] : null
}

function toNumber(value) {
    const n = Number(value)
    return Number.isFinite(n) ? n : null
}

/** 按修改时间倒序列出运行日志 */
function listRunLogs(logDir) {
    try {
        return fs
            .readdirSync(logDir)
            .filter(name => name.startsWith('run_') && name.endsWith('.log'))
            .map(name => {
                const full = path.join(logDir, name)
                return { name, path: full, mtime: fs.statSync(full).mtimeMs }
            })
            .sort((a, b) => b.mtime - a.mtime)
    } catch {
        return []
    }
}

function readEntries(filePath) {
    try {
        return fs
            .readFileSync(filePath, 'utf8')
            .split(/\r?\n/)
            .map(line => line.trim())
            .filter(Boolean)
            .map(parseLine)
    } catch {
        return []
    }
}

/** 最近一条 RUN-END → 概览用的汇总 */
function pickSummary(entries) {
    for (let i = entries.length - 1; i >= 0; i--) {
        const entry = entries[i]
        if (entry.kind !== 'log' || entry.title !== 'RUN-END') continue
        return {
            pointsGained: pickValue(entry.message, 'pointsGained'),
            previousBalance: pickValue(entry.message, 'previousBalance'),
            currentBalance: pickValue(entry.message, 'currentBalance'),
            runtimeMinutes: pickValue(entry.message, 'runtimeMinutes'),
            status: pickValue(entry.message, 'status'),
            at: entry.ts
        }
    }
    return null
}

/** 一份日志里所有 ACCOUNT-END → 各账号余额 */
function pickAccountEnds(entries) {
    const out = []
    for (const entry of entries) {
        if (entry.kind !== 'log' || entry.title !== 'ACCOUNT-END') continue
        const balance = toNumber(pickValue(entry.message, 'currentBalance'))
        if (balance === null) continue
        out.push({
            email: String(entry.user || '').trim().toLowerCase(),
            balance,
            previous: toNumber(pickValue(entry.message, 'previousBalance')),
            gained: toNumber(pickValue(entry.message, 'pointsGained')),
            status: pickValue(entry.message, 'status') || '',
            at: entry.ts
        })
    }
    return out
}

const PLATFORM_LABEL = { DESKTOP: '桌面', MOBILE: '移动' }

/** 日志第四段的原因说明，常见的翻成中文，翻不出来的原样保留 */
const REASON_TEXT = [
    ['quota unavailable', '该地区不返回移动搜索配额'],
    ['could not read current activation data', '读不到活动激活数据'],
    ['rendered control was not found', '没找到活动入口'],
    ['no search multiplier is offered', '该账号没有搜索加成活动'],
    ['claimable bonus unknown', '读不到可领取的奖励'],
    ['query source unavailable', '搜索词来源不可用']
]

function translateReason(text) {
    const lower = String(text || '').toLowerCase()
    for (const [from, to] of REASON_TEXT) {
        if (lower.includes(from)) return to
    }
    return String(text || '').trim()
}

/**
 * 一条 ACTIVITY-RESULT 日志 → 任务条目。
 * state: done 完成 / pending 未确认 / na 本地区不提供
 *
 * 去重键只用任务名，不带平台：上游会在桌面会话和移动会话各报一次
 * 「移动搜索配额」，那是同一个任务，不该显示成两条。
 */
function buildTask(entry) {
    const parts = String(entry.message || '').split('|').map(part => part.trim())
    const label = translateActivity(parts[0] || '')
    if (!label) return null

    const message = entry.message || ''
    let state = ''
    if (/\|\s*completed\s*\|/.test(message)) state = 'done'
    else if (/already enabled/.test(message)) state = 'done'
    else if (/completion not confirmed/.test(message)) state = 'pending'
    else if (/unavailable/.test(message)) state = 'na'
    if (!state) return null

    const pointsRaw = /points earned:\s*(\d+)/.exec(message)?.[1]
    // 第 4 段才是原因，前两段是任务名和状态
    const reason = parts.length > 3 ? translateReason(parts.slice(3).join('；')) : ''

    return {
        key: label,
        label,
        platform: PLATFORM_LABEL[entry.platform] || '',
        state,
        points: pointsRaw === undefined ? null : Number(pointsRaw),
        reason: state === 'done' ? '' : reason,
        at: entry.ts
    }
}

function countTasks(tasks) {
    const stats = { done: 0, pending: 0, na: 0 }
    for (const task of tasks) {
        if (stats[task.state] !== undefined) stats[task.state] += 1
    }
    return stats
}

/**
 * @param {string} logDir
 * @param {{maxLogs?: number, tailLines?: number}} options
 * @returns {null | {file: string, at: string, summary: object|null, balances: Record<string, object>, lines: object[]}}
 */
function loadHistory(logDir, options = {}) {
    const maxLogs = options.maxLogs ?? 8
    const taskLogs = options.taskLogs ?? 3
    const tailLines = options.tailLines ?? 1000

    const logs = listRunLogs(logDir)
    if (!logs.length) return null

    const accounts = new Map()
    let summary = null
    let firstEntries = null

    // 从新到旧扫：账号余额只认第一次出现的（即最近一次跑过它），任务同理
    const scanCount = Math.min(logs.length, maxLogs)
    for (let i = 0; i < scanCount; i++) {
        const entries = readEntries(logs[i].path)
        if (i === 0) firstEntries = entries
        if (!summary) summary = pickSummary(entries)

        for (const end of pickAccountEnds(entries)) {
            if (!end.email) continue
            if (accounts.has(end.email)) continue
            accounts.set(end.email, { ...end, tasks: [], taskKeys: new Set() })
        }

        // 任务清单只回溯最近几份，避免把上周的题目也翻出来
        if (i >= taskLogs) continue

        // 同一份日志内：后出现的覆盖前面的（重试先失败后成功，要留成功那次）
        const perAccount = new Map()
        for (const entry of entries) {
            if (entry.kind !== 'log' || entry.title !== 'ACTIVITY-RESULT') continue
            const email = String(entry.user || '').trim().toLowerCase()
            const task = buildTask(entry)
            if (!task || !email) continue
            if (!perAccount.has(email)) perAccount.set(email, new Map())
            const taskMap = perAccount.get(email)
            const prev = taskMap.get(task.key)
            if (prev) {
                // 同名任务在桌面/移动都报过，平台合起来显示
                const platforms = new Set(String(prev.platform || '').split(' · ').filter(Boolean))
                if (task.platform) platforms.add(task.platform)
                task.platform = [...platforms].join(' · ')
            }
            taskMap.set(task.key, task)
        }

        // 跨日志：新的日志先到，已经记过的任务不再被旧日志覆盖
        for (const [email, taskMap] of perAccount) {
            const account = accounts.get(email)
            if (!account) continue
            for (const [key, task] of taskMap) {
                if (account.taskKeys.has(key)) continue
                account.taskKeys.add(key)
                account.tasks.push(task)
            }
        }
    }

    const accountMap = {}
    for (const [email, account] of accounts) {
        accountMap[email] = {
            email: account.email,
            balance: account.balance,
            previous: account.previous,
            gained: account.gained,
            status: account.status,
            at: account.at,
            tasks: account.tasks,
            stats: countTasks(account.tasks)
        }
    }

    const lines = (firstEntries || []).slice(-tailLines).map(entry => ({ ...entry, channel: 'history' }))

    return {
        file: logs[0].name,
        at: summary?.at || new Date(logs[0].mtime).toISOString(),
        summary,
        accounts: accountMap,
        lines
    }
}

module.exports = { loadHistory, listRunLogs, parseLine }
