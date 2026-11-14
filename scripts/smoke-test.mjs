/**
 * 冒烟测试：驱动本机 Edge/Chrome 无头浏览器跑通完整游戏流程。
 * 用法：node scripts/smoke-test.mjs   （需先启动 npm run dev）
 */
import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'

const SHOTS = 'test-shots'
mkdirSync(SHOTS, { recursive: true })

async function launch() {
  for (const channel of ['msedge', 'chrome']) {
    try {
      return await chromium.launch({ channel, headless: true })
    } catch (e) {
      console.log(`channel ${channel} 不可用: ${String(e.message).split('\n')[0]}`)
    }
  }
  throw new Error('找不到可用的本机 Chromium 内核（Edge/Chrome）')
}

const browser = await launch()
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })

const errors = []
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
page.on('console', (m) => {
  if (m.type() === 'error' && !m.text().includes('favicon')) errors.push('console: ' + m.text())
})

// 游戏状态探针（window.__game 由 main.ts 暴露）
const probe = () =>
  page.evaluate(() => {
    const g = window.__game
    if (!g) return null
    const c = g.car
    return {
      state: g.state,
      mode: g.mode,
      dist: Math.round(c.dist),
      drifting: c.drifting,
      toggles: c.toggles,
      coins: g.coinsRun,
      best: g.best,
      yaw: +c.yaw.toFixed(2),
      slide: +c.slide.toFixed(3),
    }
  })

let failed = 0
const expect = (cond, msg) => {
  if (!cond) {
    failed++
    console.log('✗ 断言失败:', msg)
  } else {
    console.log('✓', msg)
  }
}

const waitState = async (target, timeoutMs = 4000) => {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    const s = await probe()
    if (s && s.state === target) return s
    await page.waitForTimeout(40)
  }
  throw new Error(`等待状态 ${target} 超时`)
}

const until = async (fn, timeoutMs = 6000, what = '条件') => {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    if (await fn()) return true
    await page.waitForTimeout(30)
  }
  throw new Error(`等待 ${what} 超时`)
}

// 等到车沿当前路段距下一个转折点剩余 <= margin（playing 状态下）
const remainEval = () =>
  page.evaluate(() => {
    const g = window.__game
    if (!g || g.state !== 'playing') return null
    const c = g.car
    for (const s of g.road.segments) {
      const d = s.dir === 0 ? { x: Math.SQRT1_2, z: -Math.SQRT1_2 } : { x: -Math.SQRT1_2, z: -Math.SQRT1_2 }
      const dx = c.x - s.sx
      const dz = c.z - s.sz
      const along = dx * d.x + dz * d.z
      const across = Math.abs(dx * d.z - dz * d.x)
      if (along >= -2.5 && along <= s.len && across <= 2.5) return { remain: s.len - along }
    }
    return null
  })

const driveToBend = async (margin, timeoutMs = 15000) => {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    const r = await remainEval()
    if (r && r.remain <= margin) return r
    const s = await probe()
    if (s && s.state !== 'playing') return null
    await page.waitForTimeout(30)
  }
  throw new Error('driveToBend 超时')
}

const tap = () => page.mouse.click(195, 400)
const shot = (n) => page.screenshot({ path: `${SHOTS}/${n}.png` })

// 1. 开始页
await page.goto('http://127.0.0.1:5173/')
await page.waitForTimeout(1600)
expect((await probe())?.state === 'start', '初始为 start 状态')
await shot('01-start')

// 2. 点击"经典挑战"卡片 → playing + 新手提示（绿三角）
await page.locator('#modeClassic').click()
await waitState('playing')
await page.waitForTimeout(400)
expect((await probe()).dist >= 0, '已进入 playing')
await shot('02-playing')

// 3. 第一个转折：贴近时点击 → 漂移弧线
await driveToBend(3.5)
await tap()
await page.waitForTimeout(120)
expect((await probe()).drifting === true, '漂移中（drifting=true）')
await shot('03-mid-drift')
await until(async () => {
  const s = await probe()
  return s.state === 'playing' && s.toggles === 1 && !s.drifting
}, 4000, '第一个转折完成')
await shot('04-after-bend1')

// 4. 直道中段：弧线中途再点 = 打断反向（ADR-0006），偶数次点击回到原朝向，应存活
await tap()
await page.waitForTimeout(110)
expect((await probe()).drifting === true, '弧线中途再点：仍在漂移（打断反向生效）')
await tap()
await until(async () => !(await probe()).drifting, 3000, '反向弧线对齐')
const s5 = await probe()
expect(s5.state === 'playing' && s5.toggles === 3, '蛇形打断后仍存活（切换计数=3）')
await shot('05-interrupt')

// 5. 下一个转折故意不切 → 出界坠落（ADR-0010）
await driveToBend(0.7)
if (await driveToBend(0.05, 3000)) await page.waitForTimeout(400)
await waitState('falling', 6000)
await page.waitForTimeout(280)
await shot('06-falling')
const preFallDist = (await probe()).dist
await waitState('results', 5000)
expect(preFallDist > 0, `坠前有距离（${preFallDist}m）`)
await shot('07-results')

// 6. 最高分与首局标记已保存（分模式键，ADR-0014）
const saved = await page.evaluate(() => ({
  best: localStorage.getItem('drift.best.classic'),
  played: localStorage.getItem('drift.played.classic'),
  coins: localStorage.getItem('drift.coins'),
}))
expect(saved.best && Number(saved.best) > 0, `最高分已保存: ${saved.best}m`)
expect(saved.played === '1', '首局标记已写入')

// 7. 点击任意处重开 → 零摩擦新的一局
await tap()
await waitState('playing')
const s9 = await probe()
expect(s9.dist < 5 && s9.toggles === 0, '重开后距离与切换次数归零')
await page.waitForTimeout(500)
await shot('08-restart')

// —— 8. 自由拖拽模式（ADR-0014）——
await page.reload()
await page.waitForTimeout(1400)
expect((await probe())?.state === 'start', '重载后回到模式选择页')
await page.locator('#modeDrag').click()
await waitState('playing')
expect((await probe()).mode === 'drag', '进入拖拽模式')
await page.waitForTimeout(300)
await shot('09-drag-playing')

// 缓拖保持抓地：小幅拖动 → 目标朝向小 → 不误触漂移
await page.mouse.move(195, 600)
await page.mouse.down()
await page.mouse.move(212, 585, { steps: 8 })
await page.waitForTimeout(500)
expect((await probe()).drifting === false, '缓拖保持抓地（不误触漂移）')
await shot('10-drag-gentle')

// 急甩 → 抓地突破 → 自动漂移
await page.mouse.move(360, 560, { steps: 4 })
const t0 = Date.now()
let driftSeen = false
while (Date.now() - t0 < 1500) {
  if ((await probe()).drifting) {
    driftSeen = true
    break
  }
  await page.waitForTimeout(30)
}
expect(driftSeen, '急甩自动触发漂移')
await page.waitForTimeout(120)
await shot('11-drag-drift')

// 松手保持朝向
await page.mouse.up()
await page.waitForTimeout(600)
const yawHeld = (await probe()).yaw
await page.waitForTimeout(300)
const pHold2 = await probe()
expect(Math.abs(pHold2.yaw - yawHeld) < 0.1, `松手保持朝向直行（${yawHeld} → ${pHold2.yaw}）`)

// 满舵冲出赛道 → 坠落
await page.mouse.move(195, 620)
await page.mouse.down()
await page.mouse.move(360, 640, { steps: 4 })
await waitState('falling', 12000)
await page.waitForTimeout(300)
await shot('12-drag-falling')
await waitState('results', 5000)
await shot('13-drag-results')

const savedDrag = await page.evaluate(() => ({
  best: localStorage.getItem('drift.best.drag'),
  played: localStorage.getItem('drift.played.drag'),
}))
expect(savedDrag.best && Number(savedDrag.best) > 0, `拖拽模式最高分已保存: ${savedDrag.best}m`)
expect(savedDrag.played === '1', '拖拽首局标记已写入')

// 同模式重开
await tap()
await waitState('playing')
const pRe = await probe()
expect(pRe.mode === 'drag' && pRe.dist < 5, '拖拽模式同模式重开成功')

// 再死一次到结算 → 换模式返回选择页
await page.mouse.move(195, 620)
await page.mouse.down()
await page.mouse.move(360, 640, { steps: 4 })
await waitState('falling', 12000)
await waitState('results', 5000)
await page.locator('#switchMode').click()
await page.waitForTimeout(300)
expect((await probe())?.state === 'start', '换模式返回选择页')

// —— 9. 反转拖拽选项（ADR-0014 补记）——
await page.locator('#invertToggle').click()
await page.waitForTimeout(100)
const invLabel = await page.locator('#invertToggle').textContent()
expect(invLabel && invLabel.includes('开'), `反转拖拽已开启（${invLabel.trim()}）`)
await page.locator('#modeDrag').click()
await waitState('playing')
// 反转后：拖右 → 车头左转（yaw 正）
await page.mouse.move(195, 600)
await page.mouse.down()
await page.mouse.move(360, 560, { steps: 4 })
const t2 = Date.now()
let inverted = false
while (Date.now() - t2 < 1500) {
  if ((await probe()).yaw > 0.4) {
    inverted = true
    break
  }
  await page.waitForTimeout(30)
}
expect(inverted, '反转生效：拖右车头左转（yaw > 0.4）')
await page.mouse.up()
await shot('14-invert')
// 开关持久化
const savedInv = await page.evaluate(() => localStorage.getItem('drift.invert'))
expect(savedInv === '1', '反转设置已持久化')

console.log('---')
console.log('最终状态:', JSON.stringify(await probe()))
console.log('页面错误:', errors.length ? errors : '无')

await browser.close()
if (failed > 0) {
  console.log(`⚠ ${failed} 个断言失败`)
  process.exit(2)
}
if (errors.length > 0) {
  console.log('⚠ 存在页面错误')
  process.exit(2)
}
console.log('✅ 冒烟测试全部通过')
