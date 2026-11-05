'use strict'

/**
 * 运行时补丁：容忍 Bing 中国区重定向
 *
 * 微软现在会把大陆 IP 的 www.bing.com 302 到 cn.bing.com（中国版必应），
 * 而上游搜索提交后的 waitForURL 严格要求 origin === www.bing.com，
 * 于是每次搜索都超时 45 秒 × 5 次，整段放弃（上游 issue #633，
 * 作者明确表示不支持中国区）。诊断脚本实测：
 * 跳转后 URL 是 cn.bing.com/search?q=…，pathname 和 q 参数全都对，只有 origin 不同。
 *
 * 把 origin 检查放宽为「任意 bing.com 子域」，pathname / q 校验保持不变。
 * Bing 登录 cookie 设在 .bing.com 父域，cn.bing.com 可以共享登录态。
 *
 * 只改编译产物（dist，已 gitignore），不动 src —— 与上游保持一致的原则不变，
 * 重新构建后由运行前流程重新打补丁（幂等）。
 */

const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')
const TARGET = path.join(ROOT, 'app', 'dist', 'rewards', 'browser', 'search', 'HumanTyping.js')

const MARK = '/* PATCHED-CN-BING */'
const ORIGIN_CHECK = 'url.origin === urls_1.URLs.bing.origin'
const LOOSE_CHECK = "(url.hostname === 'www.bing.com' || url.hostname === 'cn.bing.com')"

function patchBingOrigin() {
    try {
        if (!fs.existsSync(TARGET)) return { ok: false, reason: '未找到编译产物 HumanTyping.js' }
        const text = fs.readFileSync(TARGET, 'utf8')
        if (text.includes(MARK)) return { ok: true, patched: false, reason: '已打过补丁' }
        if (!text.includes(ORIGIN_CHECK)) return { ok: false, reason: '代码结构与预期不符（上游更新了？）' }
        fs.writeFileSync(TARGET, text.replace(ORIGIN_CHECK, `${MARK} ${LOOSE_CHECK}`), 'utf8')
        return { ok: true, patched: true }
    } catch (error) {
        return { ok: false, reason: String(error.message || error) }
    }
}

module.exports = { patchBingOrigin }
