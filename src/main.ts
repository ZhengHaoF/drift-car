import './style.css'
import { T } from './config'
import { Game } from './game/game'
import { SceneView } from './render/view'
import { Ui } from './ui'
import { Sfx } from './audio'

const canvas = document.querySelector<HTMLCanvasElement>('#game')!
const game = new Game()
const view = new SceneView(canvas)
const ui = new Ui()
const sfx = new Sfx()

// —— 逻辑 ↔ 渲染/音频 挂钩 ——
game.road.onAdd = (s) => view.addSegment(s)
game.road.onRemove = (s) => view.removeSegment(s)
game.onCoin = () => {
  sfx.coin()
  ui.setCoinsRun(game.coinsRun)
}
game.onFall = () => {
  sfx.setDrift(false)
  sfx.crash()
}
game.onResults = () => {
  ui.showResults(Math.floor(game.car.dist), game.best, game.coinsRun, game.coinsTotal, game.newRecord)
}

let paused = false

function beginRun() {
  game.start()
  view.reset()
  view.snapCamera(game.car)
  ui.showHud()
  ui.setDist(0)
}

function input() {
  sfx.unlock() // ADR-0005：首次手势解锁音频
  if (paused) {
    paused = false
    ui.showPause(false)
    return
  }
  if (game.state === 'start' || game.state === 'results') {
    sfx.click()
    beginRun()
  } else if (game.state === 'playing') {
    game.tap() // ADR-0006：漂移中可打断反向
  }
}

window.addEventListener('pointerdown', (e) => {
  e.preventDefault()
  input()
})
window.addEventListener('keydown', (e) => {
  if (e.code === 'Space' || e.code === 'Enter' || e.code === 'ArrowUp') {
    e.preventDefault()
    input()
  }
})

document.addEventListener('visibilitychange', () => {
  if (document.hidden && game.state === 'playing') {
    paused = true
    sfx.setDrift(false)
    ui.showPause(true)
  }
})

window.addEventListener('resize', () => view.resize())

// 调试/自动化测试钩子：暴露游戏状态（不影响游戏逻辑）
;(window as unknown as { __game?: Game }).__game = game

// —— 启动：摆好场景当开始页背景 ——
game.reset()
view.reset()
ui.showStart(game.best, game.coinsTotal)
view.snapCamera(game.car)

// —— 主循环 ——
let last = performance.now()
let tireAcc = 0
let smokeAcc = 0

view.renderer.setAnimationLoop((now) => {
  const dt = Math.min(0.05, (now - last) / 1000)
  last = now
  if (!paused) {
    game.update(dt)

    // 主题随距离切换（新路段用新主题，旧路段保留旧色）
    const ti = Math.floor(game.car.dist / T.themeSwapDist) % T.themes.length
    if (ti !== view.themeIdx) view.setTheme(ti)

    // 特效发射：漂移中的胎印与烟雾（车尾）
    if (game.state === 'playing' && game.car.drifting) {
      tireAcc += dt
      smokeAcc += dt
      const f = game.car.forward()
      const rx = -f.z
      const rz = f.x
      while (tireAcc >= T.tireStampEvery) {
        tireAcc -= T.tireStampEvery
        view.marks.stamp(game.car.x - rx * 0.5 - f.x * 0.62, game.car.z - rz * 0.5 - f.z * 0.62, game.car.yaw)
        view.marks.stamp(game.car.x + rx * 0.5 - f.x * 0.62, game.car.z + rz * 0.5 - f.z * 0.62, game.car.yaw)
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

    const time = now / 1000
    view.syncCar(game.car, game.state, game.fallT, game.fallFrom, dt, time)
    view.syncCoins(time)
    view.updateCamera(game.car, game.state, dt)
    sfx.setDrift(game.state === 'playing' && game.car.drifting)

    // HUD 与新手提示
    if (game.state === 'playing') {
      ui.setDist(Math.floor(game.car.dist))
      const showHint = game.firstRun && game.car.toggles === 0
      ui.setHint(showHint)
      view.setHintCone(showHint)
    } else {
      ui.setHint(false)
      view.setHintCone(false)
    }
  }
  view.render()
})
