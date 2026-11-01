/**
 * 日志中文化词表
 * 只做"界面层翻译"，不修改 app/ 源码，升级时无需重新适配。
 */

const LEVEL_MAP = {
    info: '信息',
    warn: '警告',
    error: '错误',
    debug: '调试'
}

const PLATFORM_MAP = {
    MAIN: '主程序',
    MOBILE: '移动端',
    DESKTOP: '桌面端'
}

const TITLE_MAP = {
    'ACTIVITY-ERROR': '活动异常',
    'ACTIVITY-RESULT': '活动结果',
    'APP-PROMOTIONS': '应用推广',
    BOOTSTRAP: '初始化',
    BROWSER: '浏览器',
    'BROWSER-TASKS': '浏览器任务',
    'CLAIM-BONUS-POINTS': '领取奖励积分',
    'CLAIM-REWARD': '领取奖励',
    'CLOSE-BROWSER': '关闭浏览器',
    'CLUSTER-PRIMARY': '主进程',
    'CLUSTER-WORKER-DISCONNECT': '工作进程断开',
    'CLUSTER-WORKER-START': '工作进程启动',
    'DAILY-CHECK-IN': '每日签到',
    'DAILY-SET': '每日任务',
    'DETECT-STATE': '识别状态',
    'DISMISS-ALL-MESSAGES': '关闭弹窗',
    'ENABLE-STREAK-PROTECTION': '连击保护',
    FLOW: '流程',
    'GET-APP-TOKEN': '获取App令牌',
    'GET-DASHBOARD-DATA': '获取面板数据',
    'GET-REWARD-SESSION': '获取奖励会话',
    'HANDLE-STATE': '处理状态',
    LOGIN: '登录',
    'LOGIN-APP': 'App登录',
    'LOGIN-BING': 'Bing会话验证',
    'LOGIN-CODE': '登录验证码',
    'LOGIN-PASSWORDLESS': '免密登录',
    'LOGIN-RECOVERY': '备用邮箱验证',
    'LOGIN-TOTP': '两步验证',
    'MORE-PROMOTIONS': '更多推广',
    POINTS: '积分概览',
    PROCESS: '进程',
    PUNCHCARD: '打卡任务',
    'PUNCHCARD-BROWSER': '打卡任务(浏览器)',
    'READ-TO-EARN': '阅读赚积分',
    'RELOAD-BAD-PAGE': '重载异常页面',
    'REWARDS-MODE': '运行模式',
    'RUN-PLAN': '运行计划',
    'SEARCH-API-REPORT': '搜索接口上报',
    'SEARCH-BING': 'Bing搜索',
    'SEARCH-BING-RELATED': 'Bing相关搜索',
    'SEARCH-BING-SUGGESTIONS': 'Bing搜索建议',
    'SEARCH-DELAY': '搜索间隔',
    'SEARCH-DETAIL': '搜索详情',
    'SEARCH-HACKERNEWS': '搜索源·HackerNews',
    'SEARCH-MANAGER': '搜索管理',
    'SEARCH-ON-BING-SEARCH': 'Explore搜索',
    'SEARCH-REDDIT': '搜索源·Reddit',
    'SEARCH-RSS': '搜索源·RSS',
    SESSION: '会话',
    'SESSION-GENERATION': '生成会话',
    'TASK-DELAY': '任务间隔',
    'UNCAUGHT-EXCEPTION': '未捕获异常',
    'UNHANDLED-REJECTION': '未处理的Promise异常',
    'URL-REWARD-API': '链接奖励接口',
    'VISUAL-SEARCH': '视觉搜索',
    'VISUAL-SEARCH-BROWSER': '视觉搜索(浏览器)',
    'RUN-END': '运行结束',
    'RUN-START': '运行开始',
    'ACCOUNT-START': '账户开始',
    'ACCOUNT-END': '账户结束',
    BUILD: '构建',
    'MANUAL-LOGIN': '手动登录'
}

/** 常见消息片段替换，k=v 数值保持原样；顺序很重要——长句在前，单词在后 */
const MESSAGE_RULES = [
    // —— 整句 ——
    [
        /Browser mode enabled - starting desktop-first[^\n]*/gi,
        '浏览器模式已启用：优先桌面端，先在浮窗完成每日任务与更多推广，失败再走 /earn 页面，使用渲染控件操作'
    ],
    [/API mode enabled[^\n]*/gi, 'API 模式已启用：通过 HTTP 直接提交任务'],
    [
        /Starting Microsoft Rewards Script\s*\|\s*v?([\d.]+)\s*\|\s*Accounts:\s*(\d+)\s*\|\s*Clusters:\s*(\d+)/gi,
        '开始运行 Microsoft Rewards 脚本 | 版本 $1 | 账户数 $2 | 集群数 $3'
    ],
    [
        /Starting account:\s*([^\s|]+)\s*\|\s*geoLocale:\s*([^\s|]+)\s*\|\s*locale:\s*([^\s|]+)/gi,
        '开始处理账户：$1 | 地区 $2 | 语言 $3'
    ],
    [/Finished account:\s*([^\s|]+)/gi, '结束账户：$1'],
    [/Account flow failed for\s*([^:]+):/gi, '账户流程失败：$1：'],
    [/Completed all accounts/gi, '所有账户处理完成'],
    [/Run interrupted/gi, '运行被中断'],
    [/Account error:/gi, '账号错误：'],
    [/Fatal error:/gi, '致命错误：'],
    [/Microsoft login error:/gi, '微软登录错误：'],
    [/Starting login process/gi, '开始登录流程'],
    [/Successfully logged in/gi, '登录成功'],
    [/Login successful/gi, '登录成功'],
    [/Login failed/gi, '登录失败'],
    [/Already logged in/gi, '已登录'],
    [/No saved browser session found;?\s*login may be required/gi, '未找到已保存的浏览器会话，可能需要重新登录'],
    [
        /Discarding saved cookies because the paired fingerprint is unavailable or incompatible/gi,
        '已丢弃保存的 Cookie：配对的浏览器指纹不可用或不兼容'
    ],
    [/Restoring saved browser session/gi, '恢复已保存的浏览器会话'],
    [/Starting a fresh sign-in without saved cookies/gi, '开始全新登录（不使用已保存的 Cookie）'],
    [/Desktop browser started/gi, '桌面浏览器已启动'],
    [/Mobile browser started/gi, '移动端浏览器已启动'],
    [/Launching bundled patched Chromium/gi, '启动内置 Chromium'],
    [/Unknown state at\s*/gi, '未知状态：'],
    [/Saving session/gi, '保存会话'],
    [/Context ready/gi, '上下文就绪'],
    [/Nothing to claim/gi, '没有可领取的积分'],
    [/Reading article/gi, '阅读文章'],
    [/Search completed/gi, '搜索完成'],
    [/Searching/gi, '搜索中'],
    [/Retrying/gi, '重试中'],
    [/\bwaiting\b/gi, '等待中'],
    [/\bStarting\b/gi, '开始'],
    [/\bCompleted\b/gi, '完成'],
    [/\bFinished\b/gi, '结束'],
    [/\bSkipping\b/gi, '跳过'],
    [/\bSkipped\b/gi, '已跳过'],
    [/\bFailed\b/gi, '失败'],
    [/\bClaiming\b/gi, '领取中'],
    [/\bClaimed\b/gi, '已领取'],
    // —— 键名 ——
    [/\bpointsGained/gi, '获得积分'],
    [/\bpreviousBalance/gi, '之前余额'],
    [/\bcurrentBalance/gi, '当前余额'],
    [/\bruntimeMinutes/gi, '运行分钟'],
    [/\bdurationSeconds/gi, '耗时秒数'],
    [/\baccountsProcessed/gi, '已处理账户数'],
    [/\bactivities/gi, '活动数'],
    [/\bcompleted/gi, '已完成'],
    [/\breason=/gi, '原因='],
    [/\bsearch=/gi, '第'],
    [/\bquery=/gi, '搜索词'],
    [/\blanguage=/gi, '语言'],
    [/\bsource=/gi, '来源'],
    [/\bremaining=/gi, '剩余'],
    [/\bexitCode=/gi, '退出码'],
    [/\bemail=/gi, '邮箱'],
    [/\bplatform=/gi, '平台'],
    [/\bstreak=/gi, '连击'],
    [/\bstatus=/gi, '状态'],
    [/\bstatus\b/gi, '状态'],
    [/\bshouldUseFingerprint=/gi, '应使用指纹='],
    [/\bsavedFingerprintPresent=/gi, '已保存指纹='],
    [/\bprofileMatch=/gi, '配置匹配='],
    [/\blocaleMatch=/gi, '语言匹配='],
    [/\bnot applicable\b/gi, '不适用'],
    [/\bunavailable\b/gi, '不可用'],
    [/\bunknown\b/gi, '未知']
]

function translateLevel(level) {
    return LEVEL_MAP[String(level).toLowerCase()] || level
}

function translatePlatform(platform) {
    return PLATFORM_MAP[platform] || platform
}

function translateTitle(title) {
    return TITLE_MAP[title] || title
}

function translateMessage(message) {
    let out = String(message || '')
    for (const [re, zh] of MESSAGE_RULES) out = out.replace(re, zh)
    return out
}

window.I18N = {
    level: translateLevel,
    platform: translatePlatform,
    title: translateTitle,
    message: translateMessage,
    enabled: true
}
