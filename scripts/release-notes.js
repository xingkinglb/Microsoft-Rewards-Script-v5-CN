'use strict'

/**
 * 生成 Release 说明
 *
 * 固定引导（下载 / 首次使用 / 说明 / 升级）+ 本次 tag 相对上一个 tag 的提交列表。
 * CI 里由 release.yml 调用；本地也能跑，用来发版前预览：
 *
 *   TAG=v5.0.0-cn.3 node scripts/release-notes.js
 *
 * 用 execFileSync 而不是 execSync：Windows 的 cmd 会吞掉 `tag^` 里的 ^，
 * 也会把 `%s` 当成变量，绕开 shell 才稳。
 */

const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')
const TAG = process.env.TAG || process.argv[2] || ''
const OUT = process.env.OUT || path.join(ROOT, 'release-notes.md')
const REPO = 'xingkinglb/Microsoft-Rewards-Script-v5-CN'

function git(args) {
    return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
}

function previousTag(tag) {
    try {
        return git(['describe', '--tags', '--abbrev=0', `${tag}^`])
    } catch {
        return ''
    }
}

const GROUP_ORDER = [
    ['feat', '新功能'],
    ['fix', '修复'],
    ['style', '界面与样式'],
    ['perf', '性能'],
    ['refactor', '重构'],
    ['docs', '文档'],
    ['chore', '其他']
]

function collectChanges(tag) {
    const prev = previousTag(tag)
    let raw = ''
    try {
        raw = git(['log', '--no-merges', '--pretty=format:%s', prev ? `${prev}..${tag}` : tag])
    } catch {
        raw = ''
    }

    const groups = new Map(GROUP_ORDER.map(([key]) => [key, []]))
    for (const line of raw.split('\n').map(item => item.trim()).filter(Boolean)) {
        const matched = /^(\w+)(?:\([^)]*\))?[:：]\s*(.+)$/.exec(line)
        const kind = matched && groups.has(matched[1]) ? matched[1] : 'chore'
        groups.get(kind).push(matched ? matched[2] : line)
    }
    return { prev, groups }
}

function buildNotes(tag) {
    const { prev, groups } = collectChanges(tag)
    const lines = []

    lines.push('## 更新内容', '')
    if (prev) {
        lines.push(`相对 \`${prev}\` 的改动：`, '')
    } else {
        lines.push('首个版本。', '')
    }

    let any = false
    for (const [key, label] of GROUP_ORDER) {
        const items = groups.get(key) || []
        if (!items.length) continue
        any = true
        lines.push(`**${label}**`, '')
        for (const item of items) lines.push(`- ${item}`)
        lines.push('')
    }
    if (!any) lines.push('（本次没有代码改动）', '')

    lines.push(
        '## 下载',
        '',
        '**`Microsoft-Rewards-Script-v5.zip`** — 解压即用，内置 Node.js 24 运行时。',
        '',
        '不想进 Release 页面找的话，这条固定链接永远指向最新版：',
        '',
        `https://github.com/${REPO}/releases/latest/download/Microsoft-Rewards-Script-v5.zip`,
        '',
        '## 首次使用（5 步）',
        '',
        '1. 解压到任意目录（路径避免特殊字符和中文）',
        '2. 双击 **`启动管理界面.bat`**',
        '3. 「工具箱 → 浏览器内核」点 **「安装 / 修复」**，下载 Chromium（约 720 MB，走国内镜像）',
        '4. 「账号配置」填邮箱密码并保存',
        '5. 「工具箱 → 打开浏览器手动登录」手动登录一次，然后回「概览」点「开始运行」',
        '',
        '详细说明见包内 **`使用说明.md`**。',
        '',
        '## 说明',
        '',
        '| 项目 | 说明 |',
        '| --- | --- |',
        '| 体积 | 约 67 MB（不含浏览器） |',
        '| 浏览器 | 未打包（720 MB 太大），首次运行前在界面里下载一次即可，装在系统缓存中 |',
        '| 账号信息 | **不含**。`.env` 与登录会话需自行配置，不会随包分发 |',
        '| Node 运行时 | 已内置，不影响系统已安装的 Node |',
        '| 系统要求 | Windows 10 1803 及以上 |',
        '',
        '## 升级',
        '',
        '下载新包解压后，把旧包的 `app\\.env` 和 `app\\sessions\\` 复制过去即可保留账号与登录状态。',
        ''
    )

    if (prev) {
        lines.push(
            `**完整对比**：https://github.com/${REPO}/compare/${prev}...${tag}`,
            ''
        )
    }

    return lines.join('\n')
}

if (!TAG) {
    console.error('用法：TAG=v5.0.0-cn.3 node scripts/release-notes.js')
    process.exit(1)
}

const body = buildNotes(TAG)
fs.writeFileSync(OUT, body, 'utf8')
console.log(`已生成 ${OUT}（${body.split('\n').length} 行）`)
