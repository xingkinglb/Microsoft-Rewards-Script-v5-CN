'use strict'

/* ------------------------------------------------------------------ 基础 */

const $ = sel => document.querySelector(sel)
const $$ = sel => [...document.querySelectorAll(sel)]

const state = {
    config: {},
    accounts: [],
    running: false,
    building: false,
    summary: null,
    autoScroll: true,
    translate: true,
    filter: '',
    lineCount: 0
}

function toast(message, kind = '') {
    const el = document.createElement('div')
    el.className = 'toast ' + kind
    el.textContent = message
    $('#toasts').appendChild(el)
    setTimeout(() => el.remove(), 3200)
}

async function api(path, options) {
    const res = await fetch(path, options)
    const data = await res.json().catch(() => ({}))
    if (!res.ok || data.error) throw new Error(data.error || `请求失败 (${res.status})`)
    return data
}

const post = (path, body) =>
    api(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body || {})
    })

/* ------------------------------------------------------------------ 导航 */

const TITLES = {
    overview: '概览',
    logs: '运行日志',
    accounts: '账号配置',
    settings: '任务设置',
    tools: '工具箱'
}

$$('.nav-item').forEach(item => {
    item.addEventListener('click', () => {
        $$('.nav-item').forEach(n => n.classList.remove('active'))
        item.classList.add('active')
        const pane = item.dataset.pane
        $$('.pane').forEach(p => p.classList.remove('active'))
        $(`#pane-${pane}`).classList.add('active')
        $('#pane-title').textContent = TITLES[pane] || pane
    })
})

/* ------------------------------------------------------------------ 状态 */

function setStatus() {
    const pill = $('#status-pill')
    const text = $('#status-text')
    pill.classList.remove('running', 'building')
    if (state.building) {
        pill.classList.add('building')
        text.textContent = '构建中'
    } else if (state.running) {
        pill.classList.add('running')
        text.textContent = '运行中'
    } else {
        text.textContent = '空闲'
    }
    $('#btn-start').disabled = state.running || state.building
    $('#btn-stop').disabled = !state.running
    $('#btn-build').disabled = state.running || state.building
}

function renderOverview() {
    const s = state.summary
    $('#s-balance').innerHTML = (s?.currentBalance ?? '—') + '<small>分</small>'
    $('#s-gained').innerHTML = (s?.pointsGained ?? '—') + '<small>分</small>'
    $('#s-runtime').innerHTML = (s?.runtimeMinutes ?? '—') + '<small>分钟</small>'
    const mode = state.config.rewardsMode === 'api' ? 'API' : '浏览器'
    $('#s-mode').textContent = `${state.accounts.length} 个 · ${mode}`
    $('#overview-time').textContent = s?.at ? '上次完成：' + new Date(s.at).toLocaleString('zh-CN') : '尚未运行'

    const box = $('#overview-accounts')
    if (!state.accounts.length) {
        box.className = 'empty'
        box.textContent = '暂无账号，请到「账号配置」添加'
    } else {
        box.className = ''
        box.innerHTML = state.accounts
            .map(
                a => `<div class="switch-row" style="border-bottom:1px solid var(--border-soft)">
                <div class="info">
                    <strong>${esc(a.email || '未填写邮箱')}</strong>
                    <span>地区 ${esc(a.geo_locale || 'auto')} · 语言 ${esc(a.lang_code || 'en')}${
                    a.proxy_url ? ' · 代理已启用' : ''
                }</span>
                </div>
                <span class="tag ${a.has_password ? 'ok' : 'warn'}">${a.has_password ? '密码已配置' : '免密/TOTP'}</span>
            </div>`
            )
            .join('')
    }
    renderRecent()
}

function renderRecent() {
    const box = $('#recent-runs')
    const runs = state.recentRuns || []
    if (!runs.length) {
        box.className = 'empty'
        box.textContent = '暂无记录，运行一次后会显示在这里'
        return
    }
    box.className = ''
    box.innerHTML = runs
        .map(r => {
            const cls = r.status === 'completed' ? 'ok' : r.status === 'partial' ? 'warn' : 'err'
            const label = r.status === 'completed' ? '完成' : r.status === 'partial' ? '部分完成' : '中断'
            return `<div class="switch-row">
                <div class="info"><strong>${esc(r.file)}</strong>
                <span>${new Date(r.at).toLocaleString('zh-CN')}</span></div>
                <div style="display:flex;gap:8px;align-items:center">
                    <span class="tag">${r.points ?? '—'} 分</span>
                    <span class="tag ${cls}">${label}</span>
                </div>
            </div>`
        })
        .join('')
}

/* ------------------------------------------------------------------ 日志 */

function esc(text) {
    return String(text ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
}

function timeOf(ts) {
    const d = new Date(ts)
    if (isNaN(d)) return ts || ''
    const p = n => String(n).padStart(2, '0')
    return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

function renderLine(line) {
    const box = $('#log-box')
    const div = document.createElement('div')
    div.className = 'log-line'

    if (line.kind === 'raw') {
        div.classList.add('raw')
        div.innerHTML = `<span class="ms">${esc(line.text)}</span>`
    } else {
        if (line.level === 'error') div.classList.add('err')
        const lv = state.translate ? I18N.level(line.level) : line.level
        const pf = state.translate ? I18N.platform(line.platform) : line.platform
        const ti = state.translate ? I18N.title(line.title) : line.title
        const ms = state.translate ? I18N.message(line.message) : line.message
        div.innerHTML =
            `<span class="t">${esc(timeOf(line.ts))}</span>` +
            `<span class="u">${esc(line.user)}</span>` +
            `<span class="lv ${line.level}">${esc(lv)}</span>` +
            `<span class="pf">${esc(pf)}</span>` +
            `<span class="ti">[${esc(ti)}]</span>` +
            `<span class="ms">${esc(ms)}</span>`
    }

    const filter = state.filter.toLowerCase()
    if (filter && !div.textContent.toLowerCase().includes(filter)) div.style.display = 'none'

    box.appendChild(div)
    state.lineCount++
}

function updateLogCount() {
    $('#log-count').textContent = state.lineCount + ' 行'
}

function appendAndScroll(line) {
    renderLine(line)
    if (state.autoScroll) {
        const box = $('#log-box')
        box.scrollTop = box.scrollHeight
    }
    updateLogCount()
}

function clearLogs() {
    $('#log-box').innerHTML = ''
    state.lineCount = 0
    updateLogCount()
}

async function loadLogs() {
    const data = await api('/api/logs?limit=1500')
    clearLogs()
    data.lines.forEach(renderLine)
    updateLogCount()
    if (state.autoScroll) {
        const box = $('#log-box')
        box.scrollTop = box.scrollHeight
    }
    if (data.summary) {
        state.summary = data.summary
        renderOverview()
    }
}

function connectStream() {
    const es = new EventSource('/api/logs/stream')
    es.onmessage = event => {
        const payload = JSON.parse(event.data)
        if (payload.type === 'line') {
            appendAndScroll(payload.line)
            if (payload.summary) {
                state.summary = payload.summary
                renderOverview()
            }
        } else if (payload.type === 'state') {
            state.running = Boolean(payload.running)
            setStatus()
        } else if (payload.type === 'build') {
            state.building = Boolean(payload.running)
            setStatus()
            if (!payload.running) {
                toast(payload.exitCode === 0 ? '构建完成' : '构建失败，请查看日志', payload.exitCode === 0 ? 'ok' : 'err')
            }
        }
    }
    es.onerror = () => {
        // 自动重连由浏览器负责
    }
}

/* ------------------------------------------------------------------ 账号 */

function accountCard(acc, index) {
    const slot = acc.slot || index + 1
    return `<div class="account" data-index="${index}">
        <div class="account-head">
            <div class="slot">${slot}</div>
            <div class="title">账号 ${slot}</div>
            <div class="spacer" style="flex:1"></div>
            <button class="btn sm danger" data-remove="${index}">删除</button>
        </div>
        <div class="form-grid">
            <div class="field"><label>邮箱 *</label>
                <input type="text" data-k="email" value="${esc(acc.email || '')}" placeholder="xxx@outlook.com"></div>
            <div class="field"><label>密码</label>
                <input type="password" data-k="password" value="" placeholder="${
                    acc.has_password ? '已设置，留空则不修改' : '免密账号可留空'
                }"></div>
            <div class="field"><label>两步验证密钥（TOTP）</label>
                <input type="text" data-k="totp_secret" value="${esc(acc.totp_secret || '')}" placeholder="可选，验证器密钥">
                <span class="hint">不是 6 位动态码，是绑定验证器时的密钥</span></div>
            <div class="field"><label>备用邮箱</label>
                <input type="text" data-k="recovery_email" value="${esc(acc.recovery_email || '')}" placeholder="可选"></div>
            <div class="field"><label>地区代码</label>
                <input type="text" data-k="geo_locale" value="${esc(acc.geo_locale || '')}" placeholder="cn / us / auto"></div>
            <div class="field"><label>语言代码</label>
                <input type="text" data-k="lang_code" value="${esc(acc.lang_code || '')}" placeholder="zh / en"></div>
            <div class="field"><label>代理地址</label>
                <input type="text" data-k="proxy_url" value="${esc(acc.proxy_url || '')}" placeholder="可选 http://host:port"></div>
            <div class="field"><label>代理账号 / 密码</label>
                <input type="text" data-k="proxy_username" value="${esc(acc.proxy_username || '')}" placeholder="可选"></div>
        </div>
        <div class="switch-row" style="margin-top:10px">
            <div class="info"><strong>保存浏览器指纹</strong><span>保持同一设备身份，降低风控概率</span></div>
            <div class="switch ${acc.save_fingerprint_desktop === 'true' ? 'on' : ''}" data-k="save_fingerprint_desktop"></div>
        </div>
    </div>`
}

function renderAccounts() {
    const box = $('#accounts-list')
    if (!state.accounts.length) {
        box.innerHTML = '<div class="empty">还没有账号，点下方「添加账号」</div>'
        return
    }
    box.innerHTML = state.accounts.map(accountCard).join('')

    box.querySelectorAll('[data-remove]').forEach(btn => {
        btn.addEventListener('click', () => {
            const i = Number(btn.dataset.remove)
            state.accounts.splice(i, 1)
            renderAccounts()
        })
    })
    box.querySelectorAll('.switch').forEach(sw => {
        sw.addEventListener('click', () => sw.classList.toggle('on'))
    })
}

function collectAccounts() {
    const result = []
    $$('#accounts-list .account').forEach(card => {
        const acc = { slot: Number(card.dataset.index) + 1 }
        card.querySelectorAll('[data-k]').forEach(input => {
            const key = input.dataset.k
            if (input.classList.contains('switch')) {
                if (input.classList.contains('on')) acc[key] = 'true'
            } else if (input.value.trim()) {
                acc[key] = input.value.trim()
            }
        })
        result.push(acc)
    })
    return result
}

/* ------------------------------------------------------------------ 设置 */

const CONFIG_SCHEMA = [
    {
        title: '常规',
        desc: '运行模式与整体节奏',
        fields: [
            {
                path: 'rewardsMode',
                label: '运行模式',
                type: 'select',
                options: [
                    ['browser', '浏览器模式（推荐）'],
                    ['api', 'API 模式（更快）']
                ],
                hint: '浏览器模式渲染页面点卡片最稳；API 模式走纯 HTTP，需要已保存登录会话'
            },
            { path: 'headless', label: '无头模式', type: 'bool', hint: '不显示浏览器窗口，出问题时建议关闭以便观察' },
            { path: 'clusters', label: '并发账号数', type: 'number', hint: '同时处理的账号数量，单账号填 1' },
            { path: 'accountDelay.min', label: '账号间隔·最小', type: 'text', hint: '如 1min / 30sec' },
            { path: 'accountDelay.max', label: '账号间隔·最大', type: 'text' },
            { path: 'taskDelay.min', label: '任务间隔·最小', type: 'text', hint: 'v5 新增，任务之间停顿' },
            { path: 'taskDelay.max', label: '任务间隔·最大', type: 'text' },
            { path: 'globalTimeout', label: '全局超时', type: 'text', hint: '如 30sec' },
            {
                path: 'continueOnBotWarning',
                label: '遇风控提示仍继续',
                type: 'bool',
                hint: '微软明确提示异常行为时是否继续跑，默认关闭更安全'
            },
            { path: 'ensureStreakProtection', label: '自动开启连击保护', type: 'bool' },
            { path: 'autoClaimPunchcardRewards', label: '自动领取打卡奖励', type: 'bool' },
            { path: 'skipNonPointTasks', label: '跳过无积分任务', type: 'bool' },
            { path: 'errorDiagnostics', label: '保存错误诊断', type: 'bool' },
            { path: 'debugLogs', label: '调试日志', type: 'bool', hint: '输出更详细，日志会变长' }
        ]
    },
    {
        title: '任务开关',
        desc: '选择要执行哪些任务',
        fields: [
            { path: 'workers.doDailySet', label: '每日任务集', type: 'bool' },
            { path: 'workers.doMorePromotions', label: '更多推广', type: 'bool' },
            { path: 'workers.doPunchCards', label: '打卡任务', type: 'bool' },
            { path: 'workers.doClaimBonusPoints', label: '领取奖励积分', type: 'bool' },
            { path: 'workers.doAppPromotions', label: '应用推广', type: 'bool' },
            { path: 'workers.doDailyCheckIn', label: '每日签到', type: 'bool' },
            { path: 'workers.doReadToEarn', label: '阅读赚积分', type: 'bool' },
            { path: 'workers.doDesktopSearch', label: '桌面端搜索', type: 'bool' },
            { path: 'workers.doMobileSearch', label: '移动端搜索', type: 'bool' },
            { path: 'workers.doBonusSearches', label: '额外搜索奖励', type: 'bool' },
            { path: 'workers.doActivateSearchPerk', label: '搜索加成激活', type: 'bool' },
            { path: 'workers.doVisualSearch', label: '视觉搜索', type: 'bool' },
            { path: 'activities.urlReward', label: '链接奖励活动', type: 'bool' },
            { path: 'activities.searchOnBing', label: 'Explore on Bing', type: 'bool' }
        ]
    },
    {
        title: '搜索',
        desc: '搜索词来源与节奏',
        fields: [
            { path: 'searchSettings.parallelSearching', label: '桌面/移动并行搜索', type: 'bool' },
            { path: 'searchSettings.clusterSearch', label: '关联搜索词扩展', type: 'bool' },
            {
                path: 'searchSettings.useAccountLocale',
                label: '按账号地区选搜索词',
                type: 'bool',
                hint: '关闭则固定英文/美区搜索词'
            },
            { path: 'searchSettings.maxSearchOnBingAttempts', label: 'Explore 最大尝试次数', type: 'number' },
            { path: 'searchSettings.maxBonusSearches', label: '额外搜索上限', type: 'number', hint: '0 表示关闭，最大 1000' },
            { path: 'searchSettings.runOnZeroPoints', label: '无积分时仍搜索', type: 'bool' },
            { path: 'searchSettings.searchDelay.min', label: '搜索间隔·最小', type: 'text' },
            { path: 'searchSettings.searchDelay.max', label: '搜索间隔·最大', type: 'text' },
            { path: 'searchSettings.readDelay.min', label: '阅读间隔·最小', type: 'text' },
            { path: 'searchSettings.readDelay.max', label: '阅读间隔·最大', type: 'text' },
            { path: 'searchSettings.searchResultVisitTime', label: '结果页停留时长', type: 'text' },
            { path: 'searchSettings.scrollRandomResults', label: '随机滚动结果页', type: 'bool' },
            { path: 'searchSettings.clickRandomResults', label: '随机点击结果', type: 'bool' },
            { path: 'searchOnBingLocalQueries', label: '使用内置中文搜索词库', type: 'bool' }
        ]
    },
    {
        title: '实验功能',
        desc: '默认全部关闭，按需开启',
        fields: [
            {
                path: 'experimental.blockMedia',
                label: '屏蔽图片/视频加载',
                type: 'bool',
                hint: '页面加载更快、更省流量，可能影响个别任务判定'
            },
            { path: 'experimental.edgeBrowsing', label: '后台 Edge 浏览任务', type: 'bool' },
            { path: 'experimental.browserSearchApiReport', label: '浏览器搜索后补一次 API 上报', type: 'bool' }
        ]
    },
    {
        title: '代理',
        desc: '',
        fields: [
            { path: 'proxy.queryEngine', label: '代理用于搜索词请求', type: 'bool' },
            { path: 'proxy.ignoreCertificateErrors', label: '忽略证书错误', type: 'bool', hint: '仅在使用拦截式代理时需要' }
        ]
    },
    {
        title: '通知',
        desc: '任务完成后推送结果',
        fields: [
            { path: 'webhook.telegram.enabled', label: 'Telegram 通知', type: 'bool' },
            { path: 'webhook.telegram.botToken', label: 'Telegram Bot Token', type: 'text' },
            { path: 'webhook.telegram.chatId', label: 'Telegram Chat ID', type: 'text' },
            { path: 'webhook.ntfy.enabled', label: 'ntfy 通知', type: 'bool' },
            { path: 'webhook.ntfy.url', label: 'ntfy 地址', type: 'text' },
            { path: 'webhook.ntfy.topic', label: 'ntfy 主题', type: 'text' },
            { path: 'webhook.discord.enabled', label: 'Discord 通知', type: 'bool' },
            { path: 'webhook.discord.url', label: 'Discord Webhook 地址', type: 'text' }
        ]
    }
]

function getPath(obj, path) {
    return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj)
}

function setPath(obj, path, value) {
    const keys = path.split('.')
    let cur = obj
    keys.slice(0, -1).forEach(k => {
        if (typeof cur[k] !== 'object' || cur[k] === null) cur[k] = {}
        cur = cur[k]
    })
    cur[keys[keys.length - 1]] = value
}

function renderSettings() {
    const body = $('#settings-body')
    body.innerHTML = CONFIG_SCHEMA.map(group => {
        const bools = group.fields.filter(f => f.type === 'bool')
        const others = group.fields.filter(f => f.type !== 'bool')
        const boolHtml = bools
            .map(f => {
                const on = getPath(state.config, f.path) === true
                return `<div class="switch-row">
                    <div class="info"><strong>${f.label}</strong>${f.hint ? `<span>${f.hint}</span>` : ''}</div>
                    <div class="switch ${on ? 'on' : ''}" data-path="${f.path}"></div>
                </div>`
            })
            .join('')
        const otherHtml = others
            .map(f => {
                const v = getPath(state.config, f.path)
                let input
                if (f.type === 'select') {
                    input = `<select data-path="${f.path}">${f.options
                        .map(([val, label]) => `<option value="${val}" ${v === val ? 'selected' : ''}>${label}</option>`)
                        .join('')}</select>`
                } else if (f.type === 'number') {
                    input = `<input type="number" data-path="${f.path}" value="${v ?? ''}">`
                } else {
                    input = `<input type="text" data-path="${f.path}" value="${esc(v ?? '')}">`
                }
                return `<div class="field"><label>${f.label}</label>${input}${
                    f.hint ? `<span class="hint">${f.hint}</span>` : ''
                }</div>`
            })
            .join('')

        return `<div class="card">
            <div class="card-head"><h2>${group.title}</h2>${group.desc ? `<span class="desc">${group.desc}</span>` : ''}</div>
            ${others.length ? `<div class="form-grid">${otherHtml}</div>` : ''}
            ${bools.length ? `<div style="margin-top:${others.length ? '16px' : '0'}">${boolHtml}</div>` : ''}
        </div>`
    }).join('')

    body.querySelectorAll('.switch[data-path]').forEach(sw => {
        sw.addEventListener('click', () => sw.classList.toggle('on'))
    })
}

function collectConfig() {
    const config = JSON.parse(JSON.stringify(state.config))
    $$('#settings-body [data-path]').forEach(el => {
        const path = el.dataset.path
        if (el.classList.contains('switch')) {
            setPath(config, path, el.classList.contains('on'))
        } else if (el.type === 'number') {
            setPath(config, path, Number(el.value) || 0)
        } else {
            setPath(config, path, el.value)
        }
    })
    return config
}

/* ------------------------------------------------------------------ 数据加载 */

async function loadState() {
    const data = await api('/api/state')
    state.config = data.config
    state.accounts = data.accounts
    state.running = data.running
    state.building = data.building
    state.summary = data.summary
    $('#app-version').textContent = data.version
    $('#node-version').textContent = data.nodeVersion
    setStatus()
    renderOverview()
    renderAccounts()
    renderSettings()
    if (data.accounts[0]?.email) $('#ml-email').value = data.accounts[0].email
    await loadRecentRuns()
}

async function loadRecentRuns() {
    try {
        const data = await api('/api/recent-runs')
        state.recentRuns = data.runs || []
        renderRecent()
    } catch {
        state.recentRuns = []
    }
}

/* ------------------------------------------------------------------ 事件 */

$('#btn-start').addEventListener('click', async () => {
    try {
        await post('/api/run/start', {})
        state.running = true
        setStatus()
        toast('已开始运行，切换到「运行日志」查看进度', 'ok')
    } catch (error) {
        toast(error.message, 'err')
    }
})

$('#btn-stop').addEventListener('click', async () => {
    try {
        await post('/api/run/stop', {})
        toast('已发送停止指令')
    } catch (error) {
        toast(error.message, 'err')
    }
})

$('#btn-build').addEventListener('click', async () => {
    try {
        await post('/api/build', {})
        toast('开始构建，请留意日志')
    } catch (error) {
        toast(error.message, 'err')
    }
})

$('#btn-clear-log').addEventListener('click', clearLogs)

$('#btn-autoscroll').addEventListener('click', e => {
    state.autoScroll = !state.autoScroll
    e.target.textContent = '自动滚动：' + (state.autoScroll ? '开' : '关')
})

$('#btn-i18n').addEventListener('click', e => {
    state.translate = !state.translate
    e.target.textContent = '中文翻译：' + (state.translate ? '开' : '关')
    loadLogs()
})

$('#log-filter').addEventListener('input', e => {
    state.filter = e.target.value.trim()
    $$('#log-box .log-line').forEach(line => {
        line.style.display = !state.filter || line.textContent.toLowerCase().includes(state.filter.toLowerCase()) ? '' : 'none'
    })
})

$('#btn-add-account').addEventListener('click', () => {
    state.accounts.push({ slot: state.accounts.length + 1, save_fingerprint_desktop: 'true', geo_locale: 'cn', lang_code: 'zh' })
    renderAccounts()
})

$('#btn-save-accounts').addEventListener('click', async () => {
    try {
        const accounts = collectAccounts()
        const data = await post('/api/accounts', { accounts })
        // 重新拉取：服务端不回传密码，只给 has_password 标记
        const fresh = await api('/api/state')
        state.accounts = fresh.accounts
        renderOverview()
        renderAccounts()
        toast(data.message || '已保存', 'ok')
    } catch (error) {
        toast(error.message, 'err')
    }
})

$('#btn-save-config').addEventListener('click', async () => {
    try {
        state.config = collectConfig()
        const data = await post('/api/config', state.config)
        renderOverview()
        toast(data.message || '已保存', 'ok')
    } catch (error) {
        toast(error.message, 'err')
    }
})

$('#btn-reload-config').addEventListener('click', async () => {
    await loadState()
    toast('已重新载入')
})

$('#btn-manual-login').addEventListener('click', async () => {
    try {
        await post('/api/manual-login', {
            email: $('#ml-email').value.trim(),
            platform: $('#ml-platform').value
        })
        toast('浏览器即将打开，请手动完成登录', 'ok')
    } catch (error) {
        toast(error.message, 'err')
    }
})

$('#btn-clear-sessions').addEventListener('click', async () => {
    if (!confirm('确定清空所有已保存的登录会话？下次运行需要重新登录。')) return
    try {
        const data = await post('/api/clear-sessions', {})
        toast(data.message || '已清理', 'ok')
    } catch (error) {
        toast(error.message, 'err')
    }
})

$('#btn-config-sync').addEventListener('click', async () => {
    try {
        const data = await post('/api/config-sync', {})
        toast(data.message || '已同步', data.ok ? 'ok' : 'err')
        await loadState()
    } catch (error) {
        toast(error.message, 'err')
    }
})

;['app', 'logs'].forEach(which => {
    $('#btn-open-' + which).addEventListener('click', () => post('/api/open-folder', { which }).catch(e => toast(e.message, 'err')))
})

$('#btn-shutdown').addEventListener('click', async () => {
    const msg = state.running
        ? '奖励任务正在运行，停止管理界面会同时结束任务。确定继续？'
        : '确定停止管理界面服务？停止后需要重新双击「启动管理界面.bat」才能再次打开。'
    if (!confirm(msg)) return
    try {
        await post('/api/shutdown', {})
        document.body.innerHTML =
            '<div style="display:grid;place-items:center;height:100vh;text-align:center;font-family:sans-serif">' +
            '<div><h2 style="margin-bottom:12px;font-weight:600">管理界面已停止</h2>' +
            '<p style="color:#8b93a3;font-size:13px">可以关闭此页面了。<br>需要再次使用时，双击项目目录下的「启动管理界面.bat」。</p></div></div>'
    } catch (error) {
        toast(error.message, 'err')
    }
})

$('#btn-check-update').addEventListener('click', async () => {    const box = $('#update-result')
    box.innerHTML = '<span class="tag">检查中…</span>'
    try {
        const data = await api('/api/update')
        if (!data.ok) {
            box.innerHTML = `<span class="tag err">检查失败：${esc(data.message)}</span>`
            return
        }
        if (data.updateAvailable) {
            box.innerHTML = `<div class="tag warn">发现新版本 ${esc(data.latest)}（当前 ${esc(data.current)}）</div>
                <div style="margin-top:8px;font-size:12px;color:var(--muted)">
                <a href="${esc(data.url)}" target="_blank" style="color:var(--accent)">查看发布页</a>
                · 升级方式：替换 app/ 目录后点「重新构建」，管理界面无需改动</div>`
        } else {
            box.innerHTML = `<span class="tag ok">已是最新版本 ${esc(data.current)}</span>`
        }
    } catch (error) {
        box.innerHTML = `<span class="tag err">检查失败：${esc(error.message)}</span>`
    }
})

/* ------------------------------------------------------------------ 启动 */

loadState().then(() => {
    connectStream()
    loadLogs()
})
setInterval(() => {
    api('/api/state')
        .then(d => {
            const changed = d.running !== state.running || d.building !== state.building
            state.running = d.running
            state.building = d.building
            if (changed) setStatus()
        })
        .catch(() => {})
}, 5000)
