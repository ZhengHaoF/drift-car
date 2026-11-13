/**
 * 自动驾驶试玩：机器人沿路带中心方向转向，长时间验证生成器稳定性。
 * 用法：node scripts/auto-drive.mjs [时长秒]   （需先启动 npm run dev）
 */
import { chromium } from 'playwright-core'

const DURATION = Number(process.argv[2] || 45)

async function launch() {
  for (const channel of ['msedge', 'chrome']) {
    try {
      return await chromium.launch({ channel, headless: true })
    } catch {
      /* 尝试下一个 */
    }
  }
  throw new Error('找不到可用的本机 Chromium 内核')
}

const browser = await launch()
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })

const errors = []
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
page.on('console', (m) => {
  if (m.type() === 'error' && !m.text().includes('favicon')) errors.push('console: ' + m.text())
})

await page.goto('http://127.0.0.1:5173/')
await page.waitForTimeout(1500)
await page.locator('#modeDrag').click()
await page.waitForTimeout(400)

// 页面内零延迟自动驾驶（rAF 级转向，排除 evaluate 往返延迟干扰）
await page.evaluate(() => {
  const g = window.__game
  if (window.__ap) clearInterval(window.__ap)
  window.__ap = setInterval(() => {
    if (!g) return
    if (g.state === 'results') {
      g.start('drag')
      return
    }
    if (g.state !== 'playing') return
    const c = g.car
    let idx = 0
    let bd = Infinity
    for (let i = 0; i < g.dragRoad.quads.length; i++) {
      const q = g.dragRoad.quads[i]
      const mx = (q.ax + q.bx + q.cx + q.dx) / 4
      const mz = (q.az + q.bz + q.cz + q.dz) / 4
      const d = (mx - c.x) * (mx - c.x) + (mz - c.z) * (mz - c.z)
      if (d < bd) {
        bd = d
        idx = i
      }
    }
    const ahead = g.dragRoad.quads[Math.min(g.dragRoad.quads.length - 1, idx + 4)]
    const tx = (ahead.ax + ahead.bx + ahead.cx + ahead.dx) / 4
    const tz = (ahead.az + ahead.bz + ahead.cz + ahead.dz) / 4
    const lim = (75 * Math.PI) / 180
    g.car.targetYaw = Math.max(-lim, Math.min(lim, Math.atan2(-(tx - c.x), -(tz - c.z))))
  }, 16)
})

// 状态统计
let runs = 1
let falls = 0
let maxDist = 0
const t0 = Date.now()
let themeSeen = new Set()
const fallLog = []

while (Date.now() - t0 < DURATION * 1000) {
  // 只采样统计（自动驾驶在页面内 rAF 级执行）
  const s = await page.evaluate(() => {
    const g = window.__game
    if (!g) return null
    const c = g.car
    let idx = 0
    let bd = Infinity
    for (let i = 0; i < g.dragRoad.quads.length; i++) {
      const q = g.dragRoad.quads[i]
      const mx = (q.ax + q.bx + q.cx + q.dx) / 4
      const mz = (q.az + q.bz + q.cz + q.dz) / 4
      const d = (mx - c.x) * (mx - c.x) + (mz - c.z) * (mz - c.z)
      if (d < bd) {
        bd = d
        idx = i
      }
    }
    const q = g.dragRoad.quads[idx]
    const mx = (q.ax + q.bx + q.cx + q.dx) / 4
    const mz = (q.az + q.bz + q.cz + q.dz) / 4
    const lateral = Math.sqrt((mx - c.x) * (mx - c.x) + (mz - c.z) * (mz - c.z))
    return {
      state: g.state,
      dist: Math.round(c.dist),
      drift: c.drifting,
      yaw: +c.yaw.toFixed(2),
      slide: +c.slide.toFixed(2),
      speed: +c.speed.toFixed(1),
      lateral: +lateral.toFixed(1),
      nan: Number.isNaN(c.x) || Number.isNaN(c.z),
      theme: Math.floor(c.dist / 450) % 2,
    }
  })
  if (!s) break
  if ((s.state === 'falling' || s.state === 'results') && fallLog.length < 12) {
    fallLog.push(`dist=${s.dist} yaw=${s.yaw} slide=${s.slide} v=${s.speed} lateral=${s.lateral}`)
  }
  if (s.state === 'results') {
    falls++
    runs++
  } else if (s.state === 'falling') {
    falls++
  }
  if (s.state === 'playing' && s.dist > maxDist) maxDist = s.dist
  themeSeen.add(s.theme)
  if (s.nan) {
    errors.push('NaN 检出: 车辆坐标发散')
    break
  }
  await page.waitForTimeout(90)
}
if (fallLog.length) console.log('坠落现场（前 12 次）:\n  ' + fallLog.join('\n  '))

const final = await page.evaluate(() => {
  const g = window.__game
  return {
    bestClassic: localStorage.getItem('drift.best.classic'),
    bestDrag: localStorage.getItem('drift.best.drag'),
    coins: localStorage.getItem('drift.coins'),
  }
})

console.log(`试玩 ${DURATION}s：局数 ${runs + falls}（坠落 ${falls}），单局最远 ${maxDist}m，主题覆盖 ${[...themeSeen].sort().join(',')}`)
console.log('存档:', JSON.stringify(final))
console.log('页面错误:', errors.length ? errors : '无')

await page.screenshot({ path: 'test-shots/14-auto-drive.png' })
await browser.close()

if (errors.length > 0 || maxDist < 100) {
  console.log('⚠ 自动试玩未达标')
  process.exit(2)
}
console.log('✅ 自动试玩通过')
