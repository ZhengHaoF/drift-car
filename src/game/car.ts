import { T } from '../config'

export interface Vec2 {
  x: number
  z: number
}

/**
 * 两个允许的车头朝向（yaw，弧度）。
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

/** 车辆模拟（纯逻辑，无渲染依赖） */
export class CarSim {
  x = 0
  z = 0
  yaw = HEAD_A
  targetYaw = HEAD_A
  /** 实际运动方向角：滞后于车头形成侧滑（ADR-0013 假漂移） */
  velAngle = HEAD_A
  /** 当前侧滑角（车头 - 速度方向），供渲染做侧倾 */
  slide = 0
  speed = T.baseSpeed
  dist = 0
  drifting = false
  toggles = 0

  reset(startX: number, startZ: number) {
    this.x = startX
    this.z = startZ
    this.yaw = HEAD_A
    this.targetYaw = HEAD_A
    this.velAngle = HEAD_A
    this.slide = 0
    this.speed = T.baseSpeed
    this.dist = 0
    this.toggles = 0
    this.drifting = false
  }

  /** 玩家单击：目标朝向翻转。漂移弧线中再点 = 从当前实际朝向反向甩（ADR-0006） */
  toggle() {
    this.targetYaw = -this.targetYaw
    this.toggles++
  }

  /** 车头方向（用于相机前引、特效锚点） */
  forward(): Vec2 {
    return { x: -Math.sin(this.yaw), z: -Math.cos(this.yaw) }
  }

  update(dt: number) {
    // 速度随距离提升（ADR-0002）
    this.speed = Math.min(T.maxSpeed, T.baseSpeed + this.dist * T.speedRamp)
    // 漂移弧线：固定角速度甩向目标，到位即吸附（ADR-0001）
    const diff = this.targetYaw - this.yaw
    const step = T.turnRate * dt
    if (Math.abs(diff) <= step) {
      this.yaw = this.targetYaw
    } else {
      this.yaw += Math.sign(diff) * step
    }
    // 侧滑：速度方向以固定速率追赶车头方向——弯中车尾甩出、出弯滑行回正（ADR-0013）
    let velDiff = Math.atan2(Math.sin(this.yaw - this.velAngle), Math.cos(this.yaw - this.velAngle))
    this.velAngle += velDiff * Math.min(1, T.driftVelLag * dt)
    velDiff = Math.atan2(Math.sin(this.yaw - this.velAngle), Math.cos(this.yaw - this.velAngle))
    this.slide = velDiff
    this.drifting = Math.abs(this.targetYaw - this.yaw) > 0.02 || Math.abs(velDiff) > 0.06
    // 位置沿实际运动方向推进
    const fx = -Math.sin(this.velAngle)
    const fz = -Math.cos(this.velAngle)
    this.x += fx * this.speed * dt
    this.z += fz * this.speed * dt
    this.dist += this.speed * dt
  }
}
