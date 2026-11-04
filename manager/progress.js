'use strict'

/**
 * 定时运行进度解析
 *
 * 把上游的原始日志行翻译成一行中文进度，供进度窗口显示。
 * 单独成模块的原因：可以拿历史 run_*.log 直接回放校验，不必真跑一次任务。
 */

const ACTIVITY_NAMES = [
    ['Daily set:', '每日任务'],
    ['More promotions:', '更多促销'],
    ['Punchcard child', '打卡任务'],
    ['Daily Check-In', '每日签到'],
    ['Read to Earn', '阅读赚分'],
    ['Search perk', '搜索加成'],
    ['Visual Search', '视觉搜索'],
    ['Mobile search quota', '移动搜索'],
    ['Streak protection', '连续保护'],
    ['Bonus point claim', '奖励领取'],
    ['Search', '搜索']
]

const LINE_RE = /^\[([^\]]+)\] \[([^\]]*)\] \[([A-Z]+)\] (?:([A-Z]+) )?\[([A-Z0-9_-]+)\] ?(.*)$/

const PLATFORM_NAMES = { DESKTOP: '桌面', MOBILE: '移动' }

function translateActivity(raw) {
    let text = raw.trim()
    for (const [from, to] of ACTIVITY_NAMES) {
        if (text.toLowerCase().startsWith(from.toLowerCase())) {
            text = to + text.slice(from.length)
            break
        }
    }
    return text.replace(/\s*\|\s*/g, ' ')
}

function formatClock(iso) {
    const date = new Date(iso)
    if (Number.isNaN(date.getTime())) return '--:--'
    return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

function createTranslator() {
    const summary = {
        account: null,
        locale: '',
        pointsGained: null,
        previousBalance: null,
        currentBalance: null,
        durationSeconds: null,
        status: '',
        completed: null,
        incomplete: null,
        reasons: []
    }

    let warnedQuerySource = false
    // 搜索阶段：Searching 与 pointsGained 是两行，用序号和 query 串起来显示
    let lastSearchIndex = 0
    let lastSearchQuery = ''

    /**
     * @param {string} line 原始日志行
     * @returns {{clock: string, text: string, mark?: string, partial?: boolean}|null}
     */
    function translate(line) {
        if (typeof line !== 'string' || !line) return null
        const matched = LINE_RE.exec(line)
        if (!matched) return null
        const [, ts, , , platform, tag, message] = matched
        const clock = formatClock(ts)
        const where = PLATFORM_NAMES[platform] ? `${PLATFORM_NAMES[platform]} ` : ''
        const base = { clock }

        switch (tag) {
            case 'ACCOUNT-START': {
                const account = /Starting account:\s*(\S+)/.exec(message)?.[1] ?? ''
                const locale = /geoLocale:\s*(\w+)/.exec(message)?.[1] ?? ''
                summary.account = account
                summary.locale = locale
                return { ...base, text: `账号 ${account} · 地区 ${locale}` }
            }
            case 'LOGIN':
                if (/Successfully logged in/.test(message)) return { ...base, text: `${where}已登录`, mark: '✓' }
                return null
            case 'ACTIVITY-RESULT': {
                const [rawName] = message.split('|')
                const name = translateActivity(rawName ?? '')
                if (/\|\s*completed\s*\|/.test(message)) {
                    const points = /points earned:\s*(\d+)/.exec(message)?.[1]
                    const gain = points && points !== '0' ? ` +${points}` : ''
                    return { ...base, text: `${where}${name}${gain}`, mark: '✓' }
                }
                if (/completion not confirmed/.test(message)) {
                    return { ...base, text: `${where}${name} 未确认`, mark: '·' }
                }
                if (/unavailable/.test(message)) return { ...base, text: `${where}${name} 本地区不提供`, mark: '·' }
                if (/already enabled/.test(message)) return { ...base, text: `${where}${name} 已启用`, mark: '✓' }
                return null
            }
            case 'QUERY-MANAGER':
                if (/no usable topics/.test(message) && !warnedQuerySource) {
                    warnedQuerySource = true
                    return { ...base, text: '没有可用搜索词，桌面搜索将被跳过', mark: '⚠' }
                }
                return null
            case 'SEARCH-BING': {
                if (/Starting Bing searches/.test(message)) {
                    const balance = /currentBalance=(\d+)/.exec(message)?.[1]
                    return { ...base, text: `开始 Bing 搜索${balance ? `（当前 ${balance} 分）` : ''}` }
                }
                if (/Search points remaining/.test(message)) {
                    const desktop = /desktop=(\d+)/.exec(message)?.[1] ?? '?'
                    const mobile = /mobile=(\d+)/.exec(message)?.[1] ?? '?'
                    return { ...base, text: `剩余搜索分数 · 桌面 ${desktop} · 移动 ${mobile}` }
                }
                const started = /Searching \| search=(\d+) \| query="([^"]*)"/.exec(message)
                if (started) {
                    lastSearchIndex = Number(started[1])
                    lastSearchQuery = started[2]
                    return { ...base, text: `搜索 ${lastSearchIndex} 「${lastSearchQuery}」`, partial: true }
                }
                const gained = /searchPts=(\d+)\/(\d+)/.exec(message)
                if (gained) {
                    const batch = /batch pointsGained/.test(message) ? '（批量回报）' : ''
                    const text = `搜索 ${lastSearchIndex} 「${lastSearchQuery}」 累计 ${gained[1]}/${gained[2]}${batch}`
                    return { ...base, text, partial: true }
                }
                if (/Completed Bing searches/.test(message)) {
                    const searches = /searches=(\d+)/.exec(message)?.[1]
                    return { ...base, text: `桌面搜索阶段结束${searches ? ` · 共 ${searches} 次` : ''}`, mark: '✓' }
                }
                if (/No main search topics/.test(message) && !warnedQuerySource) {
                    warnedQuerySource = true
                    return { ...base, text: '没有可用搜索词，桌面搜索将被跳过', mark: '⚠' }
                }
                return null
            }
            case 'SEARCH-DELAY': {
                const wait = /waitMs=(\d+)/.exec(message)?.[1]
                if (!wait) return null
                return { ...base, text: `等待 ${Math.round(Number(wait) / 1000)} 秒后继续搜索` }
            }
            case 'READ-TO-EARN':
                if (/points earned/.test(message)) {
                    const index = /read=(\d+)/.exec(message)?.[1] ?? '?'
                    const gain = /pointsGained=(\d+)/.exec(message)?.[1] ?? ''
                    return { ...base, text: `${where}阅读赚分 第 ${index} 篇${gain ? ` +${gain}` : ''}`, mark: '✓', partial: true }
                }
                return null
            case 'PUNCHCARD':
                if (/Quest .* processed/.test(message)) {
                    const reported = /reported=(\d+)/.exec(message)?.[1] ?? '?'
                    const remaining = /remaining=(\d+)/.exec(message)?.[1] ?? '?'
                    return { ...base, text: `${where}打卡任务已处理 ${reported} 项，剩 ${remaining} 项` }
                }
                return null
            case 'STREAKS':
                if (/completed today/.test(message)) {
                    const streak = /streak=([\d/]+)/.exec(message)?.[1]
                    const name = /Bing App/.test(message)
                        ? 'App 连击'
                        : /Bing Search/.test(message)
                          ? '搜索连击'
                          : '每日任务连击'
                    return { ...base, text: `${where}${name}${streak ? ` ${streak}` : ''}`, mark: '✓' }
                }
                return null
            case 'ACCOUNT-END': {
                summary.pointsGained = Number(/pointsGained=(-?\d+)/.exec(message)?.[1] ?? NaN)
                summary.previousBalance = Number(/previousBalance=(\d+)/.exec(message)?.[1] ?? NaN)
                summary.currentBalance = Number(/currentBalance=(\d+)/.exec(message)?.[1] ?? NaN)
                summary.durationSeconds = Number(/durationSeconds=([\d.]+)/.exec(message)?.[1] ?? NaN)
                summary.status = /status=(\w+)/.exec(message)?.[1] ?? ''
                const activities = /activities:\s*(\d+) completed,\s*(\d+) incomplete/.exec(message)
                if (activities) {
                    summary.completed = Number(activities[1])
                    summary.incomplete = Number(activities[2])
                }
                const reason = /reason="([^"]*)"/.exec(message)?.[1]
                if (reason) summary.reasons = reason.split(';').map(item => item.trim()).filter(Boolean)
                return null
            }
            default:
                return null
        }
    }

    return { translate, summary }
}

module.exports = { createTranslator, translateActivity }
