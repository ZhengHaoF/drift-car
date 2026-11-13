/** 诊断主题切换：车前方路带四边形的顶点色 vs view.themeIdx */
import { chromium } from 'playwright-core'

const browser = await chromium.launch({ channel: 'msedge', headless: true })
const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
await page.goto('http://127.0.0.1:5173/')
await page.waitForTimeout(1500)
await page.locator('#modeDrag').click()
await page.waitForTimeout(400)

// 页面内自动驾驶
await page.evaluate(() => {
  const g = window.__game
  window.__ap = setInterval(() => {
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

// 等车跑过主题切换点（450m）
let swapped = false
for (let t = 0; t < 90000 && !swapped; t += 200) {
  swapped = await page.evaluate(() => window.__game.car.dist > 460)
  await page.waitForTimeout(200)
}
console.log('跨过切换点:', swapped)

const info = await page.evaluate(() => {
  const g = window.__game
  const v = window.__view
  const c = g.car
  const quads = g.dragRoad.quads
  let idx = 0
  let bd = Infinity
  for (let i = 0; i < quads.length; i++) {
    const q = quads[i]
    const mx = (q.ax + q.bx + q.cx + q.dx) / 4
    const mz = (q.az + q.bz + q.cz + q.dz) / 4
    const d = (mx - c.x) * (mx - c.x) + (mz - c.z) * (mz - c.z)
    if (d < bd) {
      bd = d
      idx = i
    }
  }
  // 车前方四边形的顶点色：slot = 创建序号 % cap = (cursor - n + 数组下标) % cap
  const firstCreation = v.ribbonCursor - quads.length
  const sample = (i) => {
    const s = ((firstCreation + i) % 2048) * 36
    const col = v.ribbonCol
    const r = ((col[s] + col[s + 3] + col[s + 6] + col[s + 9]) / 4).toFixed(3)
    const gg = ((col[s + 1] + col[s + 4] + col[s + 7] + col[s + 10]) / 4).toFixed(3)
    const b = ((col[s + 2] + col[s + 5] + col[s + 8] + col[s + 11]) / 4).toFixed(3)
    return [i, +quads[i].path.toFixed(0), +r, +gg, +b]
  }
  return {
    dist: Math.round(c.dist),
    viewThemeIdx: v.themeIdx,
    n: quads.length,
    cursor: v.ribbonCursor,
    used: v.ribbonUsed,
    near: [idx, idx + 15, idx + 30, idx + 50].map((i) => (i < quads.length ? sample(i) : null)),
  }
})
console.log(JSON.stringify(info, null, 1))
await browser.close()
