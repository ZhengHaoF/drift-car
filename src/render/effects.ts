import * as THREE from 'three'
import { T } from '../config'

function makeSoftTexture(): THREE.Texture {
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const g = c.getContext('2d')!
  const grad = g.createRadialGradient(32, 32, 4, 32, 32, 30)
  grad.addColorStop(0, 'rgba(255,255,255,1)')
  grad.addColorStop(0.55, 'rgba(255,255,255,0.55)')
  grad.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = grad
  g.fillRect(0, 0, 64, 64)
  return new THREE.CanvasTexture(c)
}

/**
 * 胎印：单个动态 BufferGeometry 的四边形环形缓冲（1 次绘制调用）。
 * 顶点色 RGBA 的 alpha 随时间淡出；新章覆盖最旧章。
 */
export class TireMarks {
  private geom: THREE.BufferGeometry
  private pos: Float32Array
  private col: Float32Array
  private ages: Float32Array
  /** 每章胎印的初始透明度（随漂移强度变化，ADR-0014） */
  private baseAlpha: Float32Array
  private cursor = 0
  private used = 0

  constructor(scene: THREE.Scene) {
    this.pos = new Float32Array(T.maxTireQuads * 4 * 3)
    this.col = new Float32Array(T.maxTireQuads * 4 * 4)
    this.ages = new Float32Array(T.maxTireQuads)
    this.baseAlpha = new Float32Array(T.maxTireQuads)
    this.baseAlpha.fill(0.4)
    const geom = new THREE.BufferGeometry()
    geom.setAttribute('position', new THREE.BufferAttribute(this.pos, 3))
    geom.setAttribute('color', new THREE.BufferAttribute(this.col, 4))
    const idx = new Uint32Array(T.maxTireQuads * 6)
    for (let q = 0; q < T.maxTireQuads; q++) {
      const v = q * 4
      const o = q * 6
      idx[o] = v
      idx[o + 1] = v + 1
      idx[o + 2] = v + 2
      idx[o + 3] = v
      idx[o + 4] = v + 2
      idx[o + 5] = v + 3
    }
    geom.setIndex(new THREE.BufferAttribute(idx, 1))
    geom.setDrawRange(0, 0)
    this.geom = geom
    const mat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false })
    const mesh = new THREE.Mesh(geom, mat)
    mesh.frustumCulled = false
    mesh.renderOrder = 1
    scene.add(mesh)
  }

  /** 在 (x, z) 盖一个与车头 yaw 对齐的胎印，alpha 随漂移强度可变 */
  stamp(x: number, z: number, yaw: number, alpha = 0.4) {
    const w = 0.13
    const l = 0.26
    const fx = -Math.sin(yaw)
    const fz = -Math.cos(yaw)
    const rx = -fz // 右向 = (-f.z, f.x)
    const rz = fx
    const q = this.cursor
    const o = q * 12
    const co = q * 16
    const set = (k: number, px: number, pz: number) => {
      this.pos[o + k * 3] = px
      this.pos[o + k * 3 + 1] = 0.26 // 路面顶 0.24 上方
      this.pos[o + k * 3 + 2] = pz
    }
    set(0, x - rx * w - fx * l, z - rz * w - fz * l)
    set(1, x + rx * w - fx * l, z + rz * w - fz * l)
    set(2, x + rx * w + fx * l, z + rz * w + fz * l)
    set(3, x - rx * w + fx * l, z - rz * w + fz * l)
    for (let k = 0; k < 4; k++) {
      this.col[co + k * 4] = 0.07
      this.col[co + k * 4 + 1] = 0.07
      this.col[co + k * 4 + 2] = 0.07
      this.col[co + k * 4 + 3] = alpha
    }
    this.baseAlpha[q] = alpha
    this.ages[q] = 0
    this.cursor = (q + 1) % T.maxTireQuads
    this.used = Math.min(this.used + 1, T.maxTireQuads)
    this.geom.setDrawRange(0, this.used * 6)
    ;(this.geom.attributes.position as THREE.BufferAttribute).needsUpdate = true
    ;(this.geom.attributes.color as THREE.BufferAttribute).needsUpdate = true
  }

  update(dt: number) {
    if (this.used === 0) return
    for (let q = 0; q < this.used; q++) {
      this.ages[q] += dt
      const a = Math.max(0, 1 - this.ages[q] / T.tireFadeTime) * this.baseAlpha[q]
      const co = q * 16
      this.col[co + 3] = a
      this.col[co + 7] = a
      this.col[co + 11] = a
      this.col[co + 15] = a
    }
    ;(this.geom.attributes.color as THREE.BufferAttribute).needsUpdate = true
  }

  reset() {
    this.cursor = 0
    this.used = 0
    this.geom.setDrawRange(0, 0)
  }
}

/** 漂移烟雾：Sprite 粒子池 */
export class Smoke {
  private sprites: THREE.Sprite[] = []
  private lives: number[] = []
  private vels: Array<{ x: number; y: number; z: number }> = []
  private cursor = 0

  constructor(scene: THREE.Scene) {
    const tex = makeSoftTexture()
    for (let i = 0; i < T.maxSmoke; i++) {
      const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: 0, depthWrite: false })
      const s = new THREE.Sprite(mat)
      s.visible = false
      s.renderOrder = 2
      scene.add(s)
      this.sprites.push(s)
      this.lives.push(0)
      this.vels.push({ x: 0, y: 0, z: 0 })
    }
  }

  spawn(x: number, y: number, z: number) {
    const i = this.cursor
    this.cursor = (this.cursor + 1) % this.sprites.length
    const s = this.sprites[i]
    s.position.set(x, y, z)
    s.scale.setScalar(0.5)
    s.visible = true
    ;(s.material as THREE.SpriteMaterial).opacity = 0.55
    this.lives[i] = 0
    this.vels[i] = { x: (Math.random() - 0.5) * 0.6, y: 0.9 + Math.random() * 0.5, z: (Math.random() - 0.5) * 0.6 }
  }

  update(dt: number) {
    for (let i = 0; i < this.sprites.length; i++) {
      const s = this.sprites[i]
      if (!s.visible) continue
      this.lives[i] += dt
      const k = this.lives[i] / T.smokeLife
      if (k >= 1) {
        s.visible = false
        continue
      }
      s.position.x += this.vels[i].x * dt
      s.position.y += this.vels[i].y * dt
      s.position.z += this.vels[i].z * dt
      s.scale.setScalar(0.5 + 1.3 * k)
      ;(s.material as THREE.SpriteMaterial).opacity = 0.55 * (1 - k)
    }
  }

  reset() {
    for (const s of this.sprites) s.visible = false
  }
}
