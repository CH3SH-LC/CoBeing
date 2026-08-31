/**
 * 更新能力真实 E2E 验证（无需 GUI/真机）：
 *  1. 真实调用 GitHub Releases API（电脑端/手机端共用数据源）
 *  2. 电脑端资产挑选逻辑（跳过 prerelease → setup.exe）→ 与 Rust pick_desktop_release 一致
 *  3. 手机端资产挑选逻辑（跳过 prerelease → CoBeing-mobile-*.apk）→ 与 TS pickMobileRelease 一致
 *  4. 版本比较（当前 2.0.9 vs 最新）
 *  5. HEAD 请求安装包/APK 资产 URL 确认可下载
 */
const API = 'https://api.github.com/repos/CH3SH-LC/CoBeing/releases?per_page=10'
const CURRENT = '2.0.9'

function isNewerVersion(latest, current) {
  const parse = (s) =>
    s.trim().replace(/^v/i, '').split(/[.\-+]/).filter((x) => /^\d+$/.test(x)).slice(0, 3).map(Number)
  const l = parse(latest)
  const c = parse(current)
  for (let i = 0; i < 3; i++) {
    const lv = l[i] ?? 0
    const cv = c[i] ?? 0
    if (lv !== cv) return lv > cv
  }
  return false
}

const results = []
function record(name, pass, detail) {
  results.push({ name, pass, detail })
  console.log(`${pass ? '✅' : '❌'} ${name} — ${detail}`)
}

async function head(url) {
  const res = await fetch(url, { method: 'HEAD', redirect: 'follow' })
  return { status: res.status, len: res.headers.get('content-length') }
}

async function main() {
  const res = await fetch(API, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'CoBeing-Update-Verify' } })
  record('GitHub Releases API 可达', res.ok, `HTTP ${res.status}`)
  if (!res.ok) throw new Error(`API ${res.status}`)

  const releases = await res.json()
  record('releases 数组返回', Array.isArray(releases) && releases.length > 0, `${releases.length} 条`)

  // ---- 电脑端挑选 ----
  const desktopPick = (() => {
    for (const rel of releases) {
      if (rel.prerelease) continue
      const asset = rel.assets?.find((a) => a.name.endsWith('-setup.exe') || a.name.endsWith('_x64-setup.exe'))
      if (asset) return { rel, asset }
    }
    return null
  })()
  record(
    '电脑端挑选正式版 setup.exe',
    !!desktopPick && desktopPick.rel.tag_name === 'v2.0.9' && desktopPick.asset.name === 'CoBeing.v2_2.0.9_x64-setup.exe',
    desktopPick ? `${desktopPick.rel.tag_name} → ${desktopPick.asset.name}` : '未找到',
  )

  // ---- 手机端挑选 ----
  const mobilePick = (() => {
    for (const rel of releases) {
      if (rel.prerelease) continue
      const asset = rel.assets?.find((a) => a.name.endsWith('.apk') && a.name.includes('CoBeing-mobile'))
      if (asset) return { rel, asset }
    }
    return null
  })()
  record(
    '手机端挑选正式版 APK',
    !!mobilePick && mobilePick.rel.tag_name === 'v2.0.9' && mobilePick.asset.name === 'CoBeing-mobile-v2.0.9-debug.apk',
    mobilePick ? `${mobilePick.rel.tag_name} → ${mobilePick.asset.name}` : '未找到',
  )

  // ---- 版本比较 ----
  const latestTag = desktopPick?.rel.tag_name ?? 'v2.0.9'
  record('当前 2.0.9 已是最新（无更新提示）', !isNewerVersion(latestTag, CURRENT), `${latestTag} vs ${CURRENT}`)
  record('模拟旧版本 2.0.0 应提示更新', isNewerVersion(latestTag, '2.0.0'), `${latestTag} vs 2.0.0`)

  // ---- 资产可达性（HEAD）----
  if (desktopPick) {
    const h = await head(desktopPick.asset.browser_download_url)
    record('电脑端安装包可下载', h.status === 200 || h.status === 302, `HTTP ${h.status} · ${h.len ? (h.len / 1048576).toFixed(1) + 'MB' : '未知大小'}`)
  }
  if (mobilePick) {
    const h = await head(mobilePick.asset.browser_download_url)
    record('手机端 APK 可下载', h.status === 200 || h.status === 302, `HTTP ${h.status} · ${h.len ? (h.len / 1048576).toFixed(1) + 'MB' : '未知大小'}`)
  }

  const failed = results.filter((r) => !r.pass)
  console.log(`\n===== 结果: ${results.length - failed.length}/${results.length} 通过 =====`)
  process.exit(failed.length > 0 ? 1 : 0)
}

main().catch((err) => {
  console.error('脚本失败:', err.message)
  process.exit(1)
})
