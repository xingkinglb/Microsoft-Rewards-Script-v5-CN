'use strict'

/**
 * 打包脚本 —— 生成可发布的便携版目录
 *
 * 用法：
 *   node scripts/package.js          # 只生成目录 dist-package/Microsoft-Rewards-Script-v5
 *   node scripts/package.js --zip    # 额外压缩为 dist-package/Microsoft-Rewards-Script-v5.zip
 *
 * 打包内容：app（含 node_modules 与 dist）+ runtime/node + manager + 启动脚本 + 文档
 * 不包含：账号 .env、登录会话、config.json、日志、Chromium（719MB，首次运行由界面下载）
 *
 * 打完会自动校验，发现敏感文件直接失败退出。
 */

const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const ROOT = path.resolve(__dirname, '..')
const OUT_ROOT = path.join(ROOT, 'dist-package')
const NAME = 'Microsoft-Rewards-Script-v5'
const TARGET = path.join(OUT_ROOT, NAME)

/** 精确排除（相对项目根目录） */
const DENY = new Set([
    'app/.env',
    'app/sessions',
    'app/config.json',
    'app/diagnostics',
    'app/.github',
    'manager/logs',
    'manager/.run.lock',
    'manager/.run.pid',
    '.git',
    'dist-package',
    'scripts'
])

/** 前缀排除 */
const DENY_PREFIX = ['app/.env.', 'app/dist.bak']

/** 打包后必须不存在的路径 */
const MUST_NOT_EXIST = ['app/.env', 'app/sessions', 'app/config.json', 'manager/logs']

function toPosix(p) {
    return p.split(path.sep).join('/')
}

function denied(rel) {
    const p = toPosix(rel)
    if (DENY.has(p)) return true
    return DENY_PREFIX.some(prefix => p.startsWith(prefix))
}

function copyDir(srcDir, destDir) {
    for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
        const src = path.join(srcDir, entry.name)
        const rel = path.relative(ROOT, src)
        if (denied(rel)) continue

        const dest = path.join(destDir, entry.name)
        if (entry.isDirectory()) {
            fs.mkdirSync(dest, { recursive: true })
            copyDir(src, dest)
        } else if (entry.isFile()) {
            fs.mkdirSync(path.dirname(dest), { recursive: true })
            fs.copyFileSync(src, dest)
        }
    }
}

function dirSize(dir) {
    let total = 0
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name)
        total += entry.isDirectory() ? dirSize(full) : fs.statSync(full).size
    }
    return total
}

function mb(bytes) {
    return (bytes / 1024 / 1024).toFixed(1) + ' MB'
}

// ---------------------------------------------------------------- 开始

console.log('清理旧产物…')
fs.rmSync(OUT_ROOT, { recursive: true, force: true })
fs.mkdirSync(TARGET, { recursive: true })

const TOP_FILES = ['启动管理界面.bat', '停止管理界面.bat', '使用说明.md', 'README.md']
for (const name of TOP_FILES) {
    const src = path.join(ROOT, name)
    if (!fs.existsSync(src)) {
        console.error(`缺少文件：${name}`)
        process.exit(1)
    }
    fs.copyFileSync(src, path.join(TARGET, name))
}

for (const dir of ['app', 'manager', 'runtime']) {
    const src = path.join(ROOT, dir)
    if (!fs.existsSync(src)) {
        console.error(`缺少目录：${dir}`)
        process.exit(1)
    }
    console.log(`复制 ${dir}/ …`)
    copyDir(src, path.join(TARGET, dir))
}

// ---------------------------------------------------------------- 校验

console.log('\n安全检查…')
const leaked = MUST_NOT_EXIST.filter(rel => fs.existsSync(path.join(TARGET, rel)))
if (leaked.length) {
    console.error('打包结果包含敏感文件，已中止：')
    for (const item of leaked) console.error('  - ' + item)
    process.exit(1)
}

for (const required of ['app/dist/index.js', 'app/node_modules', 'runtime/node/node.exe', 'manager/server.js']) {
    if (!fs.existsSync(path.join(TARGET, required))) {
        console.error(`缺少必要文件：${required}`)
        process.exit(1)
    }
}
console.log('  无 .env / 会话 / config.json / 日志')

// ---------------------------------------------------------------- 报告

const size = dirSize(TARGET)
console.log(`\n输出目录：${TARGET}`)
console.log(`目录体积：${mb(size)}`)

if (process.argv.includes('--zip')) {
    const zipPath = path.join(OUT_ROOT, `${NAME}.zip`)
    console.log('\n压缩中…')

    const sourceDir = path.join(OUT_ROOT, NAME)
    const tarArgs = ['-a', '-c', '-f', zipPath, '-C', OUT_ROOT, NAME]

    const run = (exe, args) => {
        const r = spawnSync(exe, args, { encoding: 'utf8' })
        if (r.error) return { ok: false, reason: r.error.code || r.error.message }
        if (r.status !== 0) return { ok: false, reason: (r.stderr || '').trim() || `退出码 ${r.status}` }
        return { ok: true }
    }

    // 依次尝试：系统 bsdtar → PATH 里的 tar → PowerShell Compress-Archive
    const systemTar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe')
    const attempts = []

    if (fs.existsSync(systemTar)) {
        const r = run(systemTar, tarArgs)
        if (r.ok) attempts.push('系统 tar')
        else console.log(`  系统 tar 失败：${r.reason}`)
    } else {
        console.log(`  未找到 ${systemTar}`)
    }

    if (!attempts.length) {
        const r = run('tar', tarArgs)
        if (r.ok) attempts.push('PATH tar')
        else console.log(`  PATH tar 失败：${r.reason}`)
    }

    if (!attempts.length) {
        console.log('  改用 PowerShell Compress-Archive…')
        const script =
            `Compress-Archive -Path '${sourceDir}' -DestinationPath '${zipPath}' -CompressionLevel Optimal -Force`
        const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
            encoding: 'utf8'
        })
        if (r.error || r.status !== 0) {
            console.error(`压缩失败：${r.error?.message || (r.stderr || '').trim() || `退出码 ${r.status}`}`)
            process.exit(1)
        }
        attempts.push('Compress-Archive')
    }

    if (!fs.existsSync(zipPath)) {
        console.error('压缩失败：未生成 zip 文件')
        process.exit(1)
    }
    console.log(`压缩完成（${attempts[0]}）：${zipPath}（${mb(fs.statSync(zipPath).size)}）`)
}
