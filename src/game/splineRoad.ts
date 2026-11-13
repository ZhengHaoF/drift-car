import { T } from '../config'
import type { Coin, IRoadGen } from './road'

export interface RibbonQuad {
  /** 四角，沿行进方向：左后(a)、右后(b)、右前(c)、左前(d) */
  ax: number
  az: number
  bx: number
  bz: number
  cx: number
  cz: number
  dx: number
  dz: number
  /** 该段中心线的路径里程（米，单调递增）——生成/修剪/主题均按里程记账 */
  path: number
  coins: Coin[]
}

interface PieceSpec {
  /** 0 = 直段；否则带符号目标转角（rad，正 = 向左） */
  turn: number
  len: number
  easeLen: number
  holdLen: number
  kappa: number
}

interface SimPoint {
  x: number
  z: number
  ang: number
}

/** 两凸四边形是否相交（分离轴定理） */
function quadsOverlap(a: RibbonQuad, b: RibbonQuad): boolean {
  const A: Array<[number, number]> = [
    [a.ax, a.az],
    [a.bx, a.bz],
    [a.cx, a.cz],
    [a.dx, a.dz],
  ]
  const B: Array<[number, number]> = [
    [b.ax, b.az],
    [b.bx, b.bz],
    [b.cx, b.cz],
    [b.dx, b.dz],
  ]
  for (const poly of [A, B]) {
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4
      const ex = poly[j][0] - poly[i][0]
      const ez = poly[j][1] - poly[i][1]
      const px = ez
      const pz = -ex
      let aMin = Infinity
      let aMax = -Infinity
      let bMin = Infinity
      let bMax = -Infinity
      for (const [vx, vz] of A) {
        const p = vx * px + vz * pz
        if (p < aMin) aMin = p
        if (p > aMax) aMax = p
      }
      for (const [vx, vz] of B) {
        const p = vx * px + vz * pz
        if (p < bMin) bMin = p
        if (p > bMax) bMax = p
      }
      if (aMax < bMin || bMax < aMin) return false
    }
  }
  return true
}

/** 点是否在凸四边形内或其 ε 邻域（贴边宽容 + 绕行方向不敏感，ADR-0010 宽容原则） */
function quadContains(q: RibbonQuad, x: number, z: number, eps = 0.15): boolean {
  const cx = [q.ax, q.bx, q.cx, q.dx]
  const cz = [q.az, q.bz, q.cz, q.dz]
  let pos = false
  let neg = false
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4
    const ex = cx[j] - cx[i]
    const ez = cz[j] - cz[i]
    const len = Math.hypot(ex, ez) || 1
    const d = (ex * (z - cz[i]) - ez * (x - cx[i])) / len
    if (d > eps) pos = true
    else if (d < -eps) neg = true
  }
  return !(pos && neg)
}

/**
 * 曲率积分路带生成器（ADR-0014）：
 * 片段 = 直段 / 梯形曲率弯道（缓入-保持-缓出），整段模拟通过 ±75° 朝向预算与
 * 前瞻自交检测后一次性提交；中心线每 2m 采样，斜接偏移生成无缝路带四边形。
 */
export class SplineRoadGen implements IRoadGen {
  quads: RibbonQuad[] = []
  onQuad: ((q: RibbonQuad) => void) | null = null
  onCoinAdd: ((c: Coin) => void) | null = null
  onCoinRemove: ((c: Coin) => void) | null = null

  private hx = 0
  private hz = 0
  private hang = 0
  private builtLen = 0
  private nextCoinAt = T.coinMargin
  /** 头部点的路带角点（上一片段遗留）：跨片段无缝的关键 */
  private headOff: { lx: number; lz: number; rx: number; rz: number } | null = null

  reset() {
    this.quads = []
    this.hx = 0
    this.hz = 0
    this.hang = 0
    this.builtLen = 0
    this.nextCoinAt = T.coinMargin
    this.headOff = null
  }

  getSpawn() {
    return { x: 0, z: -3, ang: 0 }
  }

  update(carX: number, carZ: number) {
    // 车的路径里程：投影到最近路带段（里程记账，与 z 解耦——大侧向角下 z 步长失真）
    const carPath = this.carPathAt(carX, carZ)
    while (this.builtLen < carPath + T.genAhead) this.planNextPiece()
    while (this.quads.length > 0 && this.quads[0].path < carPath - T.genBehind) {
      const q = this.quads.shift()!
      for (const c of q.coins) this.onCoinRemove?.(c)
    }
  }

  /** 车中心点是否在路带内：全量扫描活动路段（~150-400 段，代价可忽略）。
   *  不用二分窗口：大侧向角时角点 z 散布远大于每段 z 步长，窗口法会漏掉包含车的段 */
  pointOnRoad(x: number, z: number): boolean {
    for (let i = 0; i < this.quads.length; i++) {
      const q = this.quads[i]
      if (quadContains(q, x, z)) return true
    }
    return false
  }

  /** 车的路径里程 = 最近路带段的里程 */
  private carPathAt(carX: number, carZ: number): number {
    let best = this.builtLen
    let bd = Infinity
    for (let i = 0; i < this.quads.length; i++) {
      const q = this.quads[i]
      const mx = (q.ax + q.bx + q.cx + q.dx) / 4
      const mz = (q.az + q.bz + q.cz + q.dz) / 4
      const d = (mx - carX) * (mx - carX) + (mz - carZ) * (mz - carZ)
      if (d < bd) {
        bd = d
        best = q.path
      }
    }
    return best
  }

  // —— 片段规划 ——

  private planNextPiece() {
    for (let attempt = 0; attempt < 6; attempt++) {
      const spec = this.rollPiece()
      const sim = this.simulate(spec)
      if (!sim.ok) continue
      // buildQuads 必须纯函数：被拒尝试不得污染 headOff（曾致交界楔形缝）
      const built = this.buildQuads(sim.pts, this.headOff)
      // 前瞻自交检测：与既有路带比对（跳过头部相邻的 8 段）
      const firstIdx = this.quads.length
      let bad = false
      outer: for (let i = 0; i < built.quads.length; i++) {
        const stopAt = Math.max(0, firstIdx - 8)
        for (let j = 0; j < stopAt; j++) {
          if (quadsOverlap(built.quads[i], this.quads[j])) {
            bad = true
            break outer
          }
        }
      }
      if (bad) continue
      this.commitPiece(built.quads, sim.pts)
      this.headOff = built.tail
      return
    }
    // 兜底：短直道（z 单调，几乎不可能相交）
    const sim = this.simulate({ turn: 0, len: 6, easeLen: 0, holdLen: 0, kappa: 0 })
    const built = this.buildQuads(sim.pts, this.headOff)
    this.commitPiece(built.quads, sim.pts)
    this.headOff = built.tail
  }

  private rollPiece(): PieceSpec {
    const t = Math.min(1, this.builtLen / T.segShrinkDist)
    if (this.builtLen === 0) return { turn: 0, len: 26, easeLen: 0, holdLen: 0, kappa: 0 }
    if (Math.random() < 0.45 - 0.25 * t) {
      const a = 16 - 9 * t
      const b = 30 - 16 * t
      return { turn: 0, len: a + Math.random() * (b - a), easeLen: 0, holdLen: 0, kappa: 0 }
    }
    const lim = (T.steerClampDeg * Math.PI) / 180
    let dir: 1 | -1 = Math.random() < 0.5 ? 1 : -1
    if (this.hang > lim * 0.5) dir = -1
    else if (this.hang < -lim * 0.5) dir = 1
    else if (Math.abs(this.hang) > lim * 0.25 && Math.random() < 0.75) dir = this.hang > 0 ? -1 : 1
    const dMin = ((35 + 20 * t) * Math.PI) / 180
    const dMax = ((90 + 60 * t) * Math.PI) / 180
    let turn = dir * (dMin + Math.random() * (dMax - dMin))
    const budget = lim - Math.abs(this.hang)
    if (Math.abs(turn) > budget) {
      turn = dir * budget
      if (Math.abs(turn) < (25 * Math.PI) / 180) {
        // 预算不够弯：直道等回摆
        return { turn: 0, len: 8 + Math.random() * 6, easeLen: 0, holdLen: 0, kappa: 0 }
      }
    }
    const kMin = 0.03 + 0.015 * t
    const kMax = 0.06 + 0.05 * t
    const kappa = dir * (kMin + Math.random() * (kMax - kMin))
    const easeLen = 8 + Math.random() * 5
    let holdLen = Math.abs(turn) / Math.abs(kappa) - easeLen
    if (holdLen < 2) holdLen = 2
    // 保证实际转角（梯形面积）不超过 ±75° 预算，否则超出模拟会被拒、浪费重试
    let k = Math.abs(kappa)
    const realized = k * (easeLen + holdLen)
    if (realized > budget) k = Math.max(0.02, budget / (easeLen + holdLen))
    return { turn, len: 0, easeLen, holdLen, kappa: dir * k }
  }

  private simulate(spec: PieceSpec): { pts: SimPoint[]; ok: boolean } {
    const pts: SimPoint[] = [{ x: this.hx, z: this.hz, ang: this.hang }]
    let x = this.hx
    let z = this.hz
    let ang = this.hang
    const lim = (T.steerClampDeg * Math.PI) / 180
    if (spec.turn === 0) {
      const n = Math.ceil(spec.len / T.ribbonStep)
      for (let i = 0; i < n; i++) {
        const ds = Math.min(T.ribbonStep, spec.len - i * T.ribbonStep)
        x += -Math.sin(ang) * ds
        z += -Math.cos(ang) * ds
        pts.push({ x, z, ang })
      }
      return { pts, ok: true }
    }
    const total = spec.easeLen * 2 + spec.holdLen
    const n = Math.ceil(total / T.ribbonStep)
    let d = 0
    for (let i = 0; i < n; i++) {
      const ds = Math.min(T.ribbonStep, total - d)
      let k: number
      if (d < spec.easeLen) k = spec.kappa * (d / spec.easeLen)
      else if (d < spec.easeLen + spec.holdLen) k = spec.kappa
      else k = spec.kappa * (1 - (d - spec.easeLen - spec.holdLen) / spec.easeLen)
      ang += k * ds
      if (Math.abs(ang) > lim + 0.02) return { pts, ok: false }
      x += -Math.sin(ang) * ds
      z += -Math.cos(ang) * ds
      d += ds
      pts.push({ x, z, ang })
    }
    return { pts, ok: true }
  }

  /** 纯函数：由中心线点列构建路带四边形；入参 headOffIn 为首点角点（上一片段遗留），返回尾部角点 */
  private buildQuads(pts: SimPoint[], headOffIn: { lx: number; lz: number; rx: number; rz: number } | null): { quads: RibbonQuad[]; tail: { lx: number; lz: number; rx: number; rz: number } } {
    const hw = T.roadHalfWidth
    const segN: Array<{ x: number; z: number }> = []
    for (let i = 0; i < pts.length - 1; i++) {
      const fx = pts[i + 1].x - pts[i].x
      const fz = pts[i + 1].z - pts[i].z
      const l = Math.hypot(fx, fz) || 1
      segN.push({ x: fz / l, z: -fx / l }) // 左法线 = (fz, -fx)
    }
    const offAt = (i: number) => {
      // 点 i 的角点偏移：相邻段法线平均 + 斜接长度限幅（≤2.5×半宽）
      const n1 = segN[Math.max(0, i - 1)]
      const n2 = segN[Math.min(segN.length - 1, i)]
      let nx = n1.x + n2.x
      let nz = n1.z + n2.z
      const l = Math.hypot(nx, nz) || 1
      nx /= l
      nz /= l
      const cos = Math.max(0.4, nx * n2.x + nz * n2.z)
      return { x: (nx * hw) / cos, z: (nz * hw) / cos }
    }
    const quads: RibbonQuad[] = []
    // 首点角点沿用上一片段遗留值（每个中心线点的角点只算一次 → 片段交界无缝）
    let rearL: { x: number; z: number }
    let rearR: { x: number; z: number }
    if (headOffIn) {
      rearL = { x: headOffIn.lx, z: headOffIn.lz }
      rearR = { x: headOffIn.rx, z: headOffIn.rz }
    } else {
      const o = offAt(0)
      rearL = { x: pts[0].x + o.x, z: pts[0].z + o.z }
      rearR = { x: pts[0].x - o.x, z: pts[0].z - o.z }
    }
    for (let i = 0; i < pts.length - 1; i++) {
      const o2 = offAt(i + 1)
      const p2 = pts[i + 1]
      const fl = { x: p2.x + o2.x, z: p2.z + o2.z } // 左前
      const fr = { x: p2.x - o2.x, z: p2.z - o2.z } // 右前
      quads.push({
        ax: rearL.x,
        az: rearL.z,
        bx: rearR.x,
        bz: rearR.z,
        cx: fr.x,
        cz: fr.z,
        dx: fl.x,
        dz: fl.z,
        path: 0,
        coins: [],
      })
      rearL = fl
      rearR = fr
    }
    // 末点角点留给下一片段复用
    return { quads, tail: { lx: rearL.x, lz: rearL.z, rx: rearR.x, rz: rearR.z } }
  }

  private commitPiece(quads: RibbonQuad[], pts: SimPoint[]) {
    for (let i = 0; i < pts.length - 1; i++) {
      const p1 = pts[i]
      const p2 = pts[i + 1]
      const segLen = Math.hypot(p2.x - p1.x, p2.z - p1.z)
      const q = quads[i]
      q.path = this.builtLen // 段起点里程
      this.quads.push(q)
      this.onQuad?.(q)
      this.builtLen += segLen
      // 金币：路径长度每跨过一个刻度落一枚
      while (this.nextCoinAt <= this.builtLen) {
        const over = this.builtLen - this.nextCoinAt
        const tt = segLen > 0 ? Math.max(0, Math.min(1, 1 - over / segLen)) : 0
        const coin: Coin = {
          x: p1.x + (p2.x - p1.x) * tt,
          z: p1.z + (p2.z - p1.z) * tt,
          taken: false,
        }
        q.coins.push(coin)
        this.onCoinAdd?.(coin)
        this.nextCoinAt += T.coinSpacing
      }
    }
    const last = pts[pts.length - 1]
    this.hx = last.x
    this.hz = last.z
    this.hang = last.ang
  }
}
