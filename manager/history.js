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

/**
 * @param {string} logDir
 * @param {{maxLogs?: number, tailLines?: number}} options
 * @returns {null | {file: string, at: string, summary: object|null, balances: Record<string, object>, lines: object[]}}
 */
function loadHistory(logDir, options = {}) {
    const maxLogs = options.maxLogs ?? 8
    const tailLines = options.tailLines ?? 1000

    const logs = listRunLogs(logDir)
    if (!logs.length) return null

    const balances = {}
    let summary = null

    // 从新到旧扫，账号余额每个只取第一次见到的（即最新那次）
    const scanCount = Math.min(logs.length, maxLogs)
    for (let i = 0; i < scanCount; i++) {
        const entries = readEntries(logs[i].path)
        if (!summary) summary = pickSummary(entries)
        for (const account of pickAccountEnds(entries)) {
            if (!account.email) continue
            if (!balances[account.email]) balances[account.email] = account
        }
    }

    const latestEntries = readEntries(logs[0].path)
    const lines = latestEntries.slice(-tailLines).map(entry => ({ ...entry, channel: 'history' }))

    return {
        file: logs[0].name,
        at: summary?.at || new Date(logs[0].mtime).toISOString(),
        summary,
        balances,
        lines
    }
}

module.exports = { loadHistory, listRunLogs, parseLine }
