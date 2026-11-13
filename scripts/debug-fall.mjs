/** 诊断拖拽模式坠落：dump 死亡点周围路带中心线几何 + 车位置 */
import { chromium } from 'playwright-core'

const browser = await chromium.launch({ channel: 'msedge', headless: true })
const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
page.on('pageerror', (e) => console.log('pageerror:', e.message))

await page.goto('http://127.0.0.1:5173/')
await page.waitForTimeout(1500)
await page.locator('#modeDrag').click()
await page.waitForTimeout(300)

// 页面内零延迟自动驾驶 + 轨迹环形缓冲
await page.evaluate(() => {
  const g = window.__game
  window.__trace = []
  window.__ap = setInterval(() => {
    if (!g) return
    if (g.state === 'results') {
      g.start('drag')
      window.__trace = []
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
    const tr = window.__trace
    tr.push([Math.round(c.dist), +c.targetYaw.toFixed(2), +c.yaw.toFixed(2), +c.slide.toFixed(2), +c.x.toFixed(1), +c.z.toFixed(1)])
    if (tr.length > 40) tr.shift()
  }, 16)
})

let dumped = false
for (let t = 0; t < 40000 && !dumped; t += 80) {
  const s = await page.evaluate(() => {
    const g = window.__game
    if (g.state !== 'falling' || !g.dragRoad.quads.length) return null
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
    const seq = []
    for (let i = Math.max(0, idx - 6); i <= Math.min(quads.length - 1, idx + 14); i++) {
      const q = quads[i]
      seq.push([i, +((q.ax + q.bx + q.cx + q.dx) / 4).toFixed(2), +((q.az + q.bz + q.cz + q.dz) / 4).toFixed(2)])
    }
    return {
      x: +c.x.toFixed(3),
      z: +c.z.toFixed(3),
      nearestIdx: idx,
      nearestDist: +Math.sqrt(bd).toFixed(2),
      pointOnRoad: g.road.pointOnRoad(c.x, c.z),
      /** 关键 sanity：中心点本身应判在路内 */
      centerOnRoad: g.road.pointOnRoad((quads[idx].ax + quads[idx].bx + quads[idx].cx + quads[idx].dx) / 4, (quads[idx].az + quads[idx].bz + quads[idx].cz + quads[idx].dz) / 4),
      centersOnRoad: [idx - 5, idx - 3, idx, idx + 3, idx + 5].map((i) => {
        const q = quads[Math.max(0, Math.min(quads.length - 1, i))]
        const mx = (q.ax + q.bx + q.cx + q.dx) / 4
        const mz = (q.az + q.bz + q.cz + q.dz) / 4
        return g.road.pointOnRoad(mx, mz)
      }),
      /** 最近四边形的逐边有符号距离 */
      nearCorners: {
        a: [quads[idx].ax, quads[idx].az],
        b: [quads[idx].bx, quads[idx].bz],
        c: [quads[idx].cx, quads[idx].cz],
        d: [quads[idx].dx, quads[idx].dz],
        edgeDist: (() => {
          const px = [quads[idx].ax, quads[idx].bx, quads[idx].cx, quads[idx].dx]
          const pz = [quads[idx].az, quads[idx].bz, quads[idx].cz, quads[idx].dz]
          const out = []
          for (let i = 0; i < 4; i++) {
            const j = (i + 1) % 4
            const ex = px[j] - px[i]
            const ez = pz[j] - pz[i]
            const len = Math.hypot(ex, ez) || 1
            out.push(+((ex * (c.z - pz[i]) - ez * (c.x - px[i])) / len).toFixed(3))
          }
          return out
        })(),
      },
      trace: window.__trace.map((r) => `d${r[0]} tgt${r[1]} yaw${r[2]} sl${r[3]} @(${r[4]},${r[5]})`).join(' | '),
      seq,
    }
  })
  if (s) {
    console.log(JSON.stringify(s))
    console.log('车:', s.x, s.z, '| 最近中心:', s.seq.map((r) => `[${r[0]}](${r[1]},${r[2]})`).join(' '))
    dumped = true
  }
  await page.waitForTimeout(80)
}
if (!dumped) console.log('40 秒内未复现坠落')
await browser.close()
