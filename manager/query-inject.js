'use strict'

/**
 * 中文搜索词表注入
 *
 * 上游的 app/dist/data/search-queries.json 只有 en / nl / de / fr / es / tr，
 * 国区账号（locale=zh）去查 zh 键拿到空数组，于是「桌面搜索」整段被跳过，
 * 每天固定丢 30 分。
 *
 * 这里在每次运行前把 manager/data/search-queries.zh.json 合并进编译产物。
 *
 * 为什么放在 manager 层、而不是直接改 app/src/data：
 * 项目约定 app/ 与上游保持字节级一致，且 dist 是构建产物，重新构建会被覆盖。
 * 所以注入必须每次运行前做一次，且必须幂等。
 */

const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')
const ZH_PATH = path.join(__dirname, 'data', 'search-queries.zh.json')
const TARGET_PATH = path.join(ROOT, 'app', 'dist', 'data', 'search-queries.json')

function readZhList() {
    try {
        const parsed = JSON.parse(fs.readFileSync(ZH_PATH, 'utf8'))
        const list = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.zh) ? parsed.zh : []
        return list.filter(item => typeof item === 'string' && item.trim().length > 0)
    } catch {
        return []
    }
}

/**
 * 确保编译产物里有 zh 词表。
 * @returns {{ok: boolean, injected?: number, total?: number, reason?: string}}
 */
function ensureChineseQueries() {
    const zh = readZhList()
    if (!zh.length) return { ok: false, reason: '中文词表为空或无法读取' }
    if (!fs.existsSync(TARGET_PATH)) return { ok: false, reason: '未找到 app/dist/data/search-queries.json（尚未构建）' }

    let data
    try {
        data = JSON.parse(fs.readFileSync(TARGET_PATH, 'utf8'))
    } catch {
        return { ok: false, reason: '搜索词表解析失败' }
    }

    // 老版本格式是纯数组（只有英文），统一成按语言分组的对象
    if (Array.isArray(data)) data = { en: data }

    const existing = Array.isArray(data.zh) ? data.zh.filter(item => typeof item === 'string') : []
    const merged = [...new Set([...existing, ...zh])]

    if (existing.length >= merged.length) {
        return { ok: true, injected: 0, total: existing.length, reason: '已包含中文词表' }
    }

    data.zh = merged
    try {
        fs.writeFileSync(TARGET_PATH, JSON.stringify(data), 'utf8')
    } catch (error) {
        return { ok: false, reason: `写入失败：${error.message}` }
    }
    return { ok: true, injected: merged.length - existing.length, total: merged.length }
}

module.exports = { ensureChineseQueries }
