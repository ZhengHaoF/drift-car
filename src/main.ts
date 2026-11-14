import './style.css'
import { T } from './config'
import { Game } from './game/game'
import type { ModeId } from './game/car'
import { SceneView } from './render/view'
import { Ui } from './ui'
import { Sfx } from './audio'

const canvas = document.querySelector<HTMLCanvasElement>('#game')!
const game = new Game()
const view = new SceneView(canvas)
const ui = new Ui()
const sfx = new Sfx()

// —— 逻辑 ↔ 渲染/音频 挂钩（两条路各自常驻，只有活动路会发事件）——
game.classicRoad.onAdd = (s) => view.addSegment(s)
game.classicRoad.onRemove = (s) => view.removeSegment(s)
game.dragRoad.onQuad = (q) => view.addRibbonQuad(q)
game.dragRoad.onCoinAdd = (c) => view.addCoin(c)
game.dragRoad.onCoinRemove = (c) => view.removeCoin(c)
game.onCoin = () => {
  sfx.coin()
  ui.setCoinsRun(game.coinsRun)
}
game.onFall = () => {
  sfx.setDriftIntensity(0)
  sfx.crash()
}
game.onResults = () => {
  ui.showResults(Math.floor(game.car.dist), game.best, game.coinsRun, game.coinsTotal, game.newRecord)
}

let paused = false
const keys = new Set<string>()
/** 反转拖拽方向：开 = 左拖右转（用户偏好设置，ADR-0014 补记） */
let invertDrag = localStorage.getItem('drift.invert') === '1'

function refreshMenu() {
  ui.showStart(
    Number(localStorage.getItem('drift.best.classic') || 0),
    Number(localStorage.getItem('drift.best.drag') || 0),
    game.coinsTotal,
  )
  ui.setInvertLabel(invertDrag)
}

function beginRun(mode: ModeId) {
  view.reset() // 先清渲染，再重建世界（生成事件会重新铺路）
  game.start(mode)
  view.snapCamera(game.car)
  ui.showHud()
  ui.setDist(0)
  ui.setHintText(mode === 'classic' ? '点击！' : '按住拖动！')
}

function toMenu() {
  view.reset()
  game.menu()
  view.snapCamera(game.car)
  refreshMenu()
}

// —— 输入路由（ADR-0014）——

function input() {
  sfx.unlock() // ADR-0005：首次手势解锁音频
  if (paused) {
    paused = false
    ui.showPause(false)
    return
  }
  if (game.state === 'results') {
    sfx.click()
    beginRun(game.mode) // 同模式零摩擦重开
    return
  }
  if (game.state === 'playing') {
    if (game.mode === 'classic') game.tap() // ADR-0006：漂移中可打断反向
    // 拖拽模式的按下在 startDrag 处理
  }
}

// 动态虚拟摇杆
let dragId: number | null = null
let dragOx = 0
let dragOy = 0

function applyDrag(cx: number, cy: number) {
  if (game.state !== 'playing' || game.mode !== 'drag') return
  let dx = cx - dragOx
  let dy = cy - dragOy
  const mag = Math.hypot(dx, dy)
  if (mag > T.joystickR) {
    // 浮动原点：原点向手指收拢，方向不变、幅度恒为满幅
    const k = (mag - T.joystickR) / mag
    dragOx += dx * k
    dragOy += dy * k
    dx = cx - dragOx
    dy = cy - dragOy
  }
  const mag01 = Math.min(1, Math.hypot(dx, dy) / T.joystickR)
  const lim = (T.steerClampDeg * Math.PI) / 180
  // 拖动方向 → 目标朝向：yaw 正 = 屏幕左上、负 = 屏幕右上（与车头约定一致）
  // 反转拖拽：水平分量取反（左拖右转），纵向不变
  const ang = Math.atan2(invertDrag ? dx : -dx, -dy)
  game.car.targetYaw = Math.max(-lim, Math.min(lim, ang)) * mag01
}

window.addEventListener('pointerdown', (e) => {
  e.preventDefault()
  sfx.unlock()
  if ((e.target as Element | null)?.closest?.('[data-ui]')) return // 模式卡/换模式按钮自行处理
  if (paused) {
    paused = false
    ui.showPause(false)
    return
  }
  if (game.state === 'playing' && game.mode === 'drag') {
    dragId = e.pointerId
    dragOx = e.clientX
    dragOy = e.clientY
    applyDrag(e.clientX, e.clientY)
    return
  }
  input()
})
window.addEventListener('pointermove', (e) => {
  if (dragId !== null && e.pointerId === dragId) applyDrag(e.clientX, e.clientY)
})
const endDrag = (e: PointerEvent) => {
  if (dragId !== null && e.pointerId === dragId) dragId = null // 松手保持当前朝向直行
}
window.addEventListener('pointerup', endDrag)
window.addEventListener('pointercancel', endDrag)

window.addEventListener('keydown', (e) => {
  if (e.code === 'Space' || e.code === 'Enter' || e.code === 'ArrowUp') {
    e.preventDefault()
    input()
  } else if (e.code === 'ArrowLeft' || e.code === 'KeyA' || e.code === 'ArrowRight' || e.code === 'KeyD') {
    e.preventDefault()
    keys.add(e.code)
  }
})
window.addEventListener('keyup', (e) => keys.delete(e.code))

document.addEventListener('visibilitychange', () => {
  if (document.hidden && game.state === 'playing') {
    paused = true
    dragId = null
    sfx.setDriftIntensity(0)
    ui.showPause(true)
  }
})

window.addEventListener('resize', () => view.resize())

// 调试/自动化测试钩子：暴露游戏状态（不影响游戏逻辑）
;(window as unknown as { __game?: Game; __view?: SceneView }).__game = game
;(window as unknown as { __view?: SceneView }).__view = view

// —— 模式入口 ——
document.getElementById('modeClassic')!.addEventListener('click', () => {
  sfx.unlock()
  sfx.click()
  beginRun('classic')
})
document.getElementById('modeDrag')!.addEventListener('click', () => {
  sfx.unlock()
  sfx.click()
  beginRun('drag')
})
document.getElementById('switchMode')!.addEventListener('click', () => {
  sfx.click()
  toMenu()
})
document.getElementById('invertToggle')!.addEventListener('click', () => {
  invertDrag = !invertDrag
  localStorage.setItem('drift.invert', invertDrag ? '1' : '0')
  ui.setInvertLabel(invertDrag)
  sfx.click()
})

// —— 启动：经典路摆作模式选择页背景 ——
game.menu()
view.reset()
refreshMenu()
view.snapCamera(game.car)

// —— 主循环 ——
let last = performance.now()
let tireAcc = 0
let smokeAcc = 0
let prevDrift = false

view.renderer.setAnimationLoop((now) => {
  const dt = Math.min(0.05, (now - last) / 1000)
  last = now
  if (!paused) {
    // 拖拽模式键盘备用转向（桌面调试）；反转开启时左右键语义同步翻转
    if (game.state === 'playing' && game.mode === 'drag') {
      const lim = (T.steerClampDeg * Math.PI) / 180
      const kdir = invertDrag ? -1 : 1
      if (keys.has('ArrowLeft') || keys.has('KeyA')) {
        game.car.targetYaw = Math.min(lim, Math.max(-lim, game.car.targetYaw + 2.6 * kdir * dt)) // 左 = 屏幕左上 = +yaw
      }
      if (keys.has('ArrowRight') || keys.has('KeyD')) {
        game.car.targetYaw = Math.min(lim, Math.max(-lim, game.car.targetYaw - 2.6 * kdir * dt))
      }
    }

    game.update(dt)

    // 主题随距离切换（新路段用新主题，旧路段保留旧色）
    const ti = Math.floor(game.car.dist / T.themeSwapDist) % T.themes.length
    if (ti !== view.themeIdx) view.setTheme(ti)

    // 特效发射：漂移中的胎印与烟雾（车尾），强度随侧滑角
    const driftIntensity =
      game.state === 'playing' && game.car.drifting
        ? game.mode === 'drag'
          ? Math.min(1, Math.abs(game.car.slide) / 0.45)
          : 1
        : 0
    if (driftIntensity > 0) {
      tireAcc += dt
      smokeAcc += dt
      const f = game.car.forward()
      const rx = -f.z
      const rz = f.x
      const alpha = game.mode === 'drag' ? 0.22 + 0.3 * driftIntensity : 0.4
      while (tireAcc >= T.tireStampEvery) {
        tireAcc -= T.tireStampEvery
        view.marks.stamp(game.car.x - rx * 0.5 - f.x * 0.62, game.car.z - rz * 0.5 - f.z * 0.62, game.car.yaw, alpha)
        view.marks.stamp(game.car.x + rx * 0.5 - f.x * 0.62, game.car.z + rz * 0.5 - f.z * 0.62, game.car.yaw, alpha)
      }
      while (smokeAcc >= T.smokeEvery) {
        smokeAcc -= T.smokeEvery
        view.smoke.spawn(
          game.car.x - f.x * 0.9 + (Math.random() - 0.5) * 0.7,
          0.45,
          game.car.z - f.z * 0.9 + (Math.random() - 0.5) * 0.7,
        )
      }
    } else {
      tireAcc = 0
      smokeAcc = 0
    }
    view.marks.update(dt)
    view.smoke.update(dt)

    // 进弯振动反馈（安卓，ADR-0014 juice）
    if (game.car.drifting && !prevDrift && game.mode === 'drag' && typeof navigator.vibrate === 'function') {
      navigator.vibrate(30)
    }
    prevDrift = game.car.drifting

    const time = now / 1000
    view.syncCar(game.car, game.state, game.fallT, game.fallFrom, dt, time)
    view.syncCoins(time)
    view.updateCamera(game.car, game.state, dt, game.mode)
    sfx.setDriftIntensity(driftIntensity)

    // HUD 与新手提示
    if (game.state === 'playing') {
      ui.setDist(Math.floor(game.car.dist))
      const showHint = game.firstRun && (game.mode === 'classic' ? game.car.toggles === 0 : Math.abs(game.car.slide) < 0.1 && game.car.dist < 20)
      ui.setHint(showHint)
      view.setHintCone(showHint)
    } else {
      ui.setHint(false)
      view.setHintCone(false)
    }
  }
  view.render()
})
