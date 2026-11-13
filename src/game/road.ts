import { T } from '../config'
import { DIRS, HEAD_A, type Vec2 } from './car'

/** 路面生成器公共接口（经典之字路 / 拖拽曲率路带，ADR-0014） */
export interface IRoadGen {
  reset(): void
  update(carX: number, carZ: number): void
  pointOnRoad(x: number, z: number): boolean
  /** 本局出生点（含初始朝向） */
  getSpawn(): { x: number; z: number; ang: number }
}

export interface Coin {
  x: number
  z: number
  taken: boolean
}

export interface Segment {
  /** 序号（渲染层以此为键管理网格） */
  i: number
  /** 起点与终点（终点 = 转折点） */
  sx: number
  sz: number
  ex: number
  ez: number
  /** 方向索引：0 = 45° 右上，1 = 135° 左上；相邻路段必然交替 */
  dir: 0 | 1
  len: number
  coins: Coin[]
}

/**
 * 之字路程序生成（ADR-0007）。
 * 只维护"当前末端 + 下一方向 + 下一段长"；V 形折弯，段长随机且随距离收窄。
 * 网格的创建/销毁通过 onAdd/onRemove 回调交给渲染层。
 */
export class RoadGen implements IRoadGen {
  segments: Segment[] = []
  onAdd: ((s: Segment) => void) | null = null
  onRemove: ((s: Segment) => void) | null = null

  private nextI = 0
  private endX = 0
  private endZ = 0
  private nextDir: 0 | 1 = 0
  private nextLen = T.segLenStart[1] // 开局第一段用最长，给缓冲
  private builtLen = 0
  private segsMade = 0

  reset() {
    for (const s of this.segments) this.onRemove?.(s)
    this.segments = []
    this.nextI = 0
    this.endX = 0
    this.endZ = 0
    this.nextDir = 0
    this.nextLen = T.segLenStart[1]
    this.builtLen = 0
    this.segsMade = 0
  }

  /** 每帧调用：按车位置向前预生成、向后清理 */
  update(carX: number, carZ: number) {
    void carX // 进度坐标只用 z（车永远向 -Z 前进）
    while (this.endZ > carZ - T.genAhead) this.makeSeg()
    while (this.segments.length > 0 && this.segments[0].ez > carZ + T.genBehind) {
      const s = this.segments.shift()!
      this.onRemove?.(s)
    }
  }

  /** 车中心点是否在路面并集内（ADR-0010 出界判定） */
  pointOnRoad(x: number, z: number): boolean {
    const cap = T.roadHalfWidth // 每段两端各延长半宽，转折处填实
    for (const s of this.segments) {
      const dx = x - s.sx
      const dz = z - s.sz
      const d = DIRS[s.dir]
      const along = dx * d.x + dz * d.z
      const across = dx * d.z - dz * d.x
      if (along >= -cap && along <= s.len + cap && Math.abs(across) <= T.roadHalfWidth) return true
    }
    return false
  }

  getSpawn() {
    return { x: DIRS[0].x * 2, z: DIRS[0].z * 2, ang: HEAD_A }
  }

  private makeSeg() {
    const d = DIRS[this.nextDir]
    const sx = this.endX
    const sz = this.endZ
    const len = this.nextLen
    const ex = sx + d.x * len
    const ez = sz + d.z * len
    const seg: Segment = { i: this.nextI++, sx, sz, ex, ez, dir: this.nextDir, len, coins: [] }
    this.placeCoins(seg, d)
    this.segments.push(seg)
    this.onAdd?.(seg)
    this.endX = ex
    this.endZ = ez
    this.nextDir = this.nextDir === 0 ? 1 : 0
    this.segsMade++
    this.builtLen += len
    this.nextLen = this.rollLen()
  }

  private rollLen(): number {
    const t = Math.min(1, this.builtLen / T.segShrinkDist)
    const a = T.segLenStart[0] + (T.segLenFinal[0] - T.segLenStart[0]) * t
    const b = T.segLenStart[1] + (T.segLenFinal[1] - T.segLenStart[1]) * t
    const len = a + Math.random() * (b - a)
    if (this.segsMade < T.openSegs) return Math.max(len, T.segLenStart[0])
    return Math.max(T.segMinLen, len)
  }

  /** 金币布置（ADR-0008）：中心线成串 + 转折处沿贝塞尔弧线 */
  private placeCoins(seg: Segment, d: Vec2) {
    const from = T.coinMargin
    const to = seg.len - T.coinMargin
    for (let s = from; s <= to; s += T.coinSpacing) {
      seg.coins.push({ x: seg.sx + d.x * s, z: seg.sz + d.z * s, taken: false })
    }
    // 转折弧线：P0 = 本段末端前 e 处，P1 = 转折点，P2 = 下段方向 e 处
    const e = T.coinMargin
    const nd = DIRS[seg.dir === 0 ? 1 : 0]
    const px0 = seg.ex - d.x * e
    const pz0 = seg.ez - d.z * e
    const px2 = seg.ex + nd.x * e
    const pz2 = seg.ez + nd.z * e
    for (let k = 1; k <= T.bendCoins; k++) {
      const t = k / (T.bendCoins + 1)
      const mt = 1 - t
      seg.coins.push({
        x: mt * mt * px0 + 2 * mt * t * seg.ex + t * t * px2,
        z: mt * mt * pz0 + 2 * mt * t * seg.ez + t * t * pz2,
        taken: false,
      })
    }
  }
}
