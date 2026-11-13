import { T } from '../config'
import { CarSim, type ModeId } from './car'
import { RoadGen, type IRoadGen } from './road'
import { SplineRoadGen } from './splineRoad'

export type GameState = 'start' | 'playing' | 'falling' | 'results'

/** 游戏状态机：纯逻辑，渲染/音频通过回调挂钩；双模式共享（ADR-0014） */
export class Game {
  state: GameState = 'start'
  mode: ModeId = 'classic'
  car = new CarSim()
  readonly classicRoad = new RoadGen()
  readonly dragRoad = new SplineRoadGen()
  road: IRoadGen = this.classicRoad
  coinsRun = 0
  fallT = 0
  fallFrom = { x: 0, z: 0, yaw: 0 }
  newRecord = false
  /** 当前模式最高分 */
  best = 0
  /** 累计金币（跨模式共用，ADR-0003/0014） */
  coinsTotal = Number(localStorage.getItem('drift.coins') || 0)
  /** 当前模式首局（新手提示） */
  firstRun = true

  onCoin: (() => void) | null = null
  onFall: (() => void) | null = null
  onResults: (() => void) | null = null

  private bestKey() {
    return `drift.best.${this.mode}`
  }

  /** 模式选择页背景（经典路摆设） */
  menu() {
    this.mode = 'classic'
    this.road = this.classicRoad
    this.road.reset()
    const sp = this.road.getSpawn()
    this.car.reset(sp.x, sp.z, sp.ang)
    this.coinsRun = 0
    this.fallT = 0
    this.newRecord = false
    this.road.update(this.car.x, this.car.z)
    this.state = 'start'
  }

  start(mode: ModeId) {
    this.mode = mode
    this.road = mode === 'classic' ? this.classicRoad : this.dragRoad
    this.best = Number(localStorage.getItem(this.bestKey()) || 0)
    this.road.reset()
    const sp = this.road.getSpawn()
    this.car.reset(sp.x, sp.z, sp.ang)
    this.coinsRun = 0
    this.fallT = 0
    this.newRecord = false
    this.firstRun = localStorage.getItem(`drift.played.${mode}`) === null
    this.road.update(this.car.x, this.car.z)
    this.state = 'playing'
  }

  /** 播放中的单击 = 经典模式切换方向（开始/结算/拖拽的输入由外层路由） */
  tap() {
    if (this.state === 'playing' && this.mode === 'classic') this.car.toggle()
  }

  update(dt: number) {
    if (this.state === 'playing') {
      this.car.update(dt, this.mode)
      this.road.update(this.car.x, this.car.z)
      // 出界判定：车中心点（ADR-0010）
      if (!this.road.pointOnRoad(this.car.x, this.car.z)) {
        this.beginFall()
        return
      }
      // 金币拾取
      const r2 = T.coinPickup * T.coinPickup
      if (this.mode === 'classic') {
        for (const seg of this.classicRoad.segments) {
          for (const c of seg.coins) {
            if (c.taken) continue
            const dx = c.x - this.car.x
            const dz = c.z - this.car.z
            if (dx * dx + dz * dz < r2) {
              c.taken = true
              this.coinsRun++
              this.onCoin?.()
            }
          }
        }
      } else {
        for (const q of this.dragRoad.quads) {
          for (const c of q.coins) {
            if (c.taken) continue
            const dx = c.x - this.car.x
            const dz = c.z - this.car.z
            if (dx * dx + dz * dz < r2) {
              c.taken = true
              this.coinsRun++
              this.onCoin?.()
            }
          }
        }
      }
    } else if (this.state === 'falling') {
      this.fallT += dt
      if (this.fallT >= T.fallTime) this.finishFall()
    }
  }

  private beginFall() {
    this.state = 'falling'
    this.fallT = 0
    this.fallFrom = { x: this.car.x, z: this.car.z, yaw: this.car.yaw }
    this.onFall?.()
  }

  private finishFall() {
    this.state = 'results'
    this.newRecord = this.car.dist > this.best
    if (this.newRecord) {
      this.best = Math.floor(this.car.dist)
      localStorage.setItem(this.bestKey(), String(this.best))
    }
    this.coinsTotal += this.coinsRun
    localStorage.setItem('drift.coins', String(this.coinsTotal))
    localStorage.setItem(`drift.played.${this.mode}`, '1')
    this.onResults?.()
  }
}
