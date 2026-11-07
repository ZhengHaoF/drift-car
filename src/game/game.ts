import { T } from '../config'
import { CarSim, DIRS } from './car'
import { RoadGen } from './road'

export type GameState = 'start' | 'playing' | 'falling' | 'results'

/** 游戏状态机：纯逻辑，渲染/音频通过回调挂钩 */
export class Game {
  state: GameState = 'start'
  car = new CarSim()
  road = new RoadGen()
  coinsRun = 0
  fallT = 0
  fallFrom = { x: 0, z: 0, yaw: 0 }
  newRecord = false
  best = Number(localStorage.getItem('drift.best') || 0)
  coinsTotal = Number(localStorage.getItem('drift.coins') || 0)
  /** 新手提示：没玩过第一局时展示（ADR-0011） */
  firstRun = localStorage.getItem('drift.played') === null

  onCoin: (() => void) | null = null
  onFall: (() => void) | null = null
  onResults: (() => void) | null = null

  /** 重建世界（开始页背景与每局开始共用） */
  reset() {
    this.road.reset()
    const d = DIRS[0]
    this.car.reset(d.x * 2, d.z * 2) // 车停在首段路内 2m 处
    this.coinsRun = 0
    this.fallT = 0
    this.newRecord = false
    this.road.update(this.car.x, this.car.z)
  }

  start() {
    this.reset()
    this.state = 'playing'
  }

  /** 播放中的单击 = 切换方向（开始/结算的点击由外层路由） */
  tap() {
    if (this.state === 'playing') this.car.toggle()
  }

  update(dt: number) {
    if (this.state === 'playing') {
      this.car.update(dt)
      this.road.update(this.car.x, this.car.z)
      // 出界判定：车中心点（ADR-0010）
      if (!this.road.pointOnRoad(this.car.x, this.car.z)) {
        this.beginFall()
        return
      }
      // 金币拾取
      const r2 = T.coinPickup * T.coinPickup
      for (const seg of this.road.segments) {
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
      localStorage.setItem('drift.best', String(this.best))
    }
    this.coinsTotal += this.coinsRun
    localStorage.setItem('drift.coins', String(this.coinsTotal))
    localStorage.setItem('drift.played', '1')
    this.onResults?.()
  }
}
