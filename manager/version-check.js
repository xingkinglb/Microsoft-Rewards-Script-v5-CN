'use strict'

/**
 * 本整合包版本检查
 *
 * 只查自己的 GitHub Releases，不涉及上游内核（那个是另一件事）。
 * 启动时静默查一次，结果落盘缓存，界面只读缓存，不为查更新拖慢首屏。
 *
 * 缓存文件 manager/update-state.json，6 小时内不重复请求。
 */

const fs = require('node:fs')
const path = require('node:path')

const VERSION_PATH = path.join(__dirname, 'version.json')
const CACHE_PATH = path.join(__dirname, 'update-state.json')
const REPO = 'xingkinglb/Microsoft-Rewards-Script-v5-CN'
const CACHE_TTL_MS = 6 * 60 * 60 * 1000

function tokenize(version) {
    return String(version || '')
        .replace(/^v/i, '')
        .split(/[.\-+_]/)
        .filter(Boolean)
}

/**
 * 逐段比较版本号，数字段按数值比。
 * 这样 5.0.0-cn.10 才会大于 5.0.0-cn.9 —— 直接字符串比较会翻车。
 * @returns {number} 1 = a 更新，-1 = b 更新，0 = 相同
 */
function compareVersions(a, b) {
    const left = tokenize(a)
    const right = tokenize(b)
    const len = Math.max(left.length, right.length)
    for (let i = 0; i < len; i++) {
        const x = left[i]
        const y = right[i]
        // 一方先用尽：另一边剩下数字段说明层级更深（1.0.0 < 1.0.0.1），
        // 剩下字母段说明是预发布标记（5.0.0 > 5.0.0-beta）
        if (x === undefined) return /^\d+$/.test(y) ? -1 : 1
        if (y === undefined) return /^\d+$/.test(x) ? 1 : -1
        const xNum = /^\d+$/.test(x)
        const yNum = /^\d+$/.test(y)
        if (xNum && yNum) {
            const diff = Number(x) - Number(y)
            if (diff !== 0) return diff > 0 ? 1 : -1
            continue
        }
        if (x === y) continue
        // 数字段比字母段新：5.0.0 > 5.0.0-beta
        if (xNum !== yNum) return xNum ? 1 : -1
        return x > y ? 1 : -1
    }
    return 0
}

/** 当前安装的整合包版本；本地开发副本可能带 -dev 后缀 */
function readPackVersion() {
    try {
        // 去掉可能的 BOM：CI 上不同 PowerShell 版本写出来的编码不一样
        const text = fs.readFileSync(VERSION_PATH, 'utf8').replace(/^\uFEFF/, '')
        const parsed = JSON.parse(text)
        return String(parsed.version || 'dev')
    } catch {
        return 'dev'
    }
}

function readCache() {
    try {
        const parsed = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'))
        if (!parsed || !parsed.checkedAt) return null
        return parsed
    } catch {
        return null
    }
}

function writeCache(payload) {
    try {
        fs.writeFileSync(CACHE_PATH, JSON.stringify(payload, null, 4), 'utf8')
    } catch {
        /* 写不了就下次再查 */
    }
}

function decorate(cache) {
    const current = readPackVersion()
    if (!cache) {
        return { ok: false, current, latest: null, updateAvailable: false, checkedAt: null, message: '尚未检查' }
    }
    // 本地开发版（带 -dev）比任何已发布版本都新，不提示更新
    const isDev = /-dev$/i.test(current)
    const updateAvailable = Boolean(cache.tag) && !isDev && compareVersions(cache.tag, current) > 0
    return {
        ok: true,
        current,
        latest: cache.tag || null,
        updateAvailable,
        url: cache.url || null,
        publishedAt: cache.publishedAt || null,
        notes: cache.notes || '',
        checkedAt: cache.checkedAt,
        dev: isDev
    }
}

/** 读缓存，不产生网络请求 */
function getVersionInfo() {
    return decorate(readCache())
}

/**
 * 查 GitHub 上的最新发布版。
 * @param {{force?: boolean}} options force=true 时忽略 6 小时节流
 */
async function checkPackVersion(options = {}) {
    const cached = readCache()
    if (!options.force && cached?.checkedAt) {
        const age = Date.now() - new Date(cached.checkedAt).getTime()
        if (Number.isFinite(age) && age >= 0 && age < CACHE_TTL_MS) return decorate(cached)
    }

    try {
        const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
            headers: { 'User-Agent': 'rewards-manager', Accept: 'application/vnd.github+json' },
            signal: AbortSignal.timeout(8000)
        })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = await res.json()
        const tag = String(data.tag_name || '')
        if (!tag) throw new Error('未取到版本号')

        const cache = {
            checkedAt: new Date().toISOString(),
            tag,
            url: data.html_url || `https://github.com/${REPO}/releases/latest`,
            publishedAt: data.published_at || null,
            notes: String(data.body || '').slice(0, 1500)
        }
        writeCache(cache)
        return decorate(cache)
    } catch (error) {
        // 查不到就沿用旧缓存，别让界面跳成"未知"
        return { ...decorate(cached), ok: false, message: String(error.message || error) }
    }
}

module.exports = { compareVersions, readPackVersion, getVersionInfo, checkPackVersion }
