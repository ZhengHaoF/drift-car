import { T } from '../config'

export type ModeId = 'classic' | 'drag'

export interface Vec2 {
  x: number
  z: number
}

/** 角度差归一到 (-π, π] */
export function wrapAngle(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a))
}

/**
 * 两个允许的车头朝向（yaw，弧度）——经典模式专用。
 * forward(yaw) = (-sin yaw, -cos yaw)：yaw=0 → 屏幕正上（-Z）。
 * HEAD_A = -π/4 → 屏幕右上 45°；HEAD_B = +π/4 → 屏幕左上 135°。
 * 两朝向恰好相差 90°，转折的左右交替由结构保证（ADR-0007）。
 */
export const HEAD_A = -Math.PI / 4
export const HEAD_B = Math.PI / 4
export const DIRS: readonly [Vec2, Vec2] = [
  { x: Math.SQRT1_2, z: -Math.SQRT1_2 }, // 45° 右上
  { x: -Math.SQRT1_2, z: -Math.SQRT1_2 }, // 135° 左上
]

const clamp01 = (v: number) => Math.max(0, Math.min(1, v))

/**
 * 车辆模拟（纯逻辑，无渲染依赖），双模式共享侧滑核心：
 * - classic：二值切换 + 固定角速度圆弧漂移（ADR-0001/0013，冻结不动）
 * - drag：连续转向 + 抓地力模型，转向过猛自动漂移（ADR-0014）
 */
export class CarSim {
  x = 0
  z = 0
  yaw = HEAD_A
  targetYaw = HEAD_A
  /** 实际运动方向角：滞后于车头形成侧滑 */
  velAngle = HEAD_A
  /** 当前侧滑角（车头 - 速度方向），供渲染与特效 */
  slide = 0
  speed = T.baseSpeed
  dist = 0
  drifting = false
  toggles = 0
  /** 经典模式：当前车头角速度（供拖拽模式抓地判定，经典分支不维护精确值） */
  yawRate = 0
  /** 漂移特效滞回状态（拖拽模式专用） */
  private driftFx = false
  /** 漂移掉速后的有效速度比例（拖拽模式） */
  private scrubFactor = 1

  reset(startX: number, startZ: number, yaw0: number) {
    this.x = startX
    this.z = startZ
    this.yaw = yaw0
    this.targetYaw = yaw0
    this.velAngle = yaw0
    this.slide = 0
    this.speed = T.baseSpeed
    this.dist = 0
    this.toggles = 0
    this.drifting = false
    this.yawRate = 0
    this.driftFx = false
    this.scrubFactor = 1
  }

  /** 经典模式：玩家单击，目标朝向翻转。漂移弧线中再点 = 从当前实际朝向反向甩（ADR-0006） */
  toggle() {
    this.targetYaw = -this.targetYaw
    this.toggles++
  }

  /** 车头方向（用于相机前引、特效锚点） */
  forward(): Vec2 {
    return { x: -Math.sin(this.yaw), z: -Math.cos(this.yaw) }
  }

  /** 实际运动方向（拖拽模式相机前引用） */
  velForward(): Vec2 {
    return { x: -Math.sin(this.velAngle), z: -Math.cos(this.velAngle) }
  }

  update(dt: number, mode: ModeId) {
    // 速度随距离提升（ADR-0002），两模式共用
    this.speed = Math.min(T.maxSpeed, T.baseSpeed + this.dist * T.speedRamp)
    this.scrubFactor = 1

    if (mode === 'classic') {
      // —— ADR-0001/0013（冻结）：固定角速度甩向目标，到位即吸附 ——
      const diff = this.targetYaw - this.yaw
      const step = T.turnRate * dt
      if (Math.abs(diff) <= step) {
        this.yaw = this.targetYaw
        this.yawRate = 0
      } else {
        this.yaw += Math.sign(diff) * step
        this.yawRate = Math.sign(diff) * T.turnRate
      }
      // 假侧滑：速度方向以固定速率追赶车头
      let velDiff = wrapAngle(this.yaw - this.velAngle)
      this.velAngle += velDiff * Math.min(1, T.driftVelLag * dt)
      velDiff = wrapAngle(this.yaw - this.velAngle)
      this.slide = velDiff
      this.drifting = Math.abs(this.targetYaw - this.yaw) > 0.02 || Math.abs(velDiff) > 0.06
    } else {
      // —— ADR-0014：连续转向 + 抓地力模型 ——
      const diff = wrapAngle(this.targetYaw - this.yaw)
      const desired = diff * T.yawChaseK
      const rate = Math.max(-T.maxYawRate, Math.min(T.maxYawRate, desired))
      const yawBefore = this.yaw
      this.yaw += rate * dt
      // 追赶过冲保护：小差值直接吸附
      if (Math.abs(wrapAngle(this.targetYaw - this.yaw)) < 0.012) this.yaw = this.targetYaw
      this.yawRate = wrapAngle(this.yaw - yawBefore) / dt
      // 抓地：侧向需求 = |角速度| × 车速，超限饱和失去抓地
      const aLat = Math.abs(this.yawRate) * this.speed
      const grip = clamp01(1 - (aLat - T.gripALow) / (T.gripAHigh - T.gripALow))
      const catchRate = T.driftCatchRate + (T.gripCatchRate - T.driftCatchRate) * grip
      let velDiff = wrapAngle(this.yaw - this.velAngle)
      this.velAngle += velDiff * Math.min(1, catchRate * dt)
      velDiff = wrapAngle(this.yaw - this.velAngle)
      this.slide = velDiff
      // 漂移特效滞回
      if (!this.driftFx && Math.abs(this.slide) > T.slideEnter) this.driftFx = true
      else if (this.driftFx && Math.abs(this.slide) < T.slideExit) this.driftFx = false
      this.drifting = this.driftFx
      // 漂移掉速
      const sat = Math.min(1, Math.abs(this.slide) / 0.5)
      this.scrubFactor = 1 - T.driftScrub * sat
    }

    // 位置沿实际运动方向推进
    const fx = -Math.sin(this.velAngle)
    const fz = -Math.cos(this.velAngle)
    const moveSpeed = this.speed * this.scrubFactor
    this.x += fx * moveSpeed * dt
    this.z += fz * moveSpeed * dt
    this.dist += moveSpeed * dt
  }
}
