import * as THREE from 'three'
import { T } from '../config'
import { DIRS } from '../game/car'
import type { Coin, Segment } from '../game/road'
import type { RibbonQuad } from '../game/splineRoad'
import { buildCar, type CarModel } from './carModel'
import { TireMarks, Smoke } from './effects'

const COIN_CAP = 320

/** 渲染层：场景/相机/路面网格生命周期/特效/坠落表现 */
export class SceneView {
  readonly renderer: THREE.WebGLRenderer
  themeIdx = 0

  private scene = new THREE.Scene()
  private camera: THREE.PerspectiveCamera
  private fog: THREE.Fog
  private ground: THREE.Mesh
  private roadGeo = new THREE.BoxGeometry(1, 1, 1)
  private roadMats: THREE.MeshLambertMaterial[]
  private coinGeo: THREE.CylinderGeometry
  private coinMat: THREE.MeshLambertMaterial
  private coinInst: THREE.InstancedMesh
  private coinSlots = new Map<Coin, number>()
  private freeCoinSlots: number[] = []
  private coinTop = 0
  private segMeshes = new Map<number, THREE.Mesh>()
  private bendMeshes = new Map<number, THREE.Mesh>()
  private lastSeg: Segment | null = null
  /** 拖拽模式路带：单个动态 BufferGeometry 环形缓冲（顶面+两侧壁，顶点色携带主题） */
  private ribbonPos!: Float32Array
  private ribbonNor!: Float32Array
  private ribbonCol!: Float32Array
  private ribbonGeom!: THREE.BufferGeometry
  private ribbonMat!: THREE.MeshLambertMaterial
  private themeRGB: Array<[number, number, number]> = []
  private ribbonCursor = 0
  private ribbonUsed = 0
  private dummy = new THREE.Object3D()
  private carModel: CarModel
  /** 特效发射由主循环直接调用（漂移胎印/烟雾） */
  readonly marks: TireMarks
  readonly smoke: Smoke
  private hintCone: THREE.Mesh
  private lookTarget = new THREE.Vector3()
  private tmpV = new THREE.Vector3()

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, T.pixelRatioCap))
    this.renderer.setSize(window.innerWidth, window.innerHeight)
    this.camera = new THREE.PerspectiveCamera(T.fov, window.innerWidth / window.innerHeight, 0.1, 220)
    this.fog = new THREE.Fog(0xffffff, 30, 100)
    this.scene.fog = this.fog
    this.scene.background = new THREE.Color(0xffffff)
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.65))
    const sun = new THREE.DirectionalLight(0xffffff, 0.85)
    sun.position.set(6, 12, 3)
    this.scene.add(sun)

    // 地面：无光照纯色，与雾同色 → 远处无缝融合
    this.ground = new THREE.Mesh(
      new THREE.PlaneGeometry(320, 520),
      new THREE.MeshBasicMaterial({ color: 0xffffff }),
    )
    this.ground.rotation.x = -Math.PI / 2
    this.scene.add(this.ground)

    // 路面材质：每主题一份共享；新路段用当前主题，旧路段保留旧色（广告式过渡）
    this.roadMats = T.themes.map((th) => new THREE.MeshLambertMaterial({ color: th.road }))

    // 金币：InstancedMesh，1 次绘制调用
    this.coinGeo = new THREE.CylinderGeometry(0.34, 0.34, 0.09, 14)
    this.coinGeo.rotateX(Math.PI / 2)
    this.coinMat = new THREE.MeshLambertMaterial({ color: 0xf5b21a, emissive: 0x7a4d00 })
    this.coinInst = new THREE.InstancedMesh(this.coinGeo, this.coinMat, COIN_CAP)
    this.coinInst.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.coinInst.frustumCulled = false
    this.hideDummy()
    for (let i = 0; i < COIN_CAP; i++) this.coinInst.setMatrixAt(i, this.dummy.matrix)
    this.coinInst.instanceMatrix.needsUpdate = true
    this.scene.add(this.coinInst)

    // 路带：主题路面色预转线性空间（顶点色与经典材质同色源）
    this.themeRGB = T.themes.map((th) => {
      const c = new THREE.Color(th.road)
      return [c.r, c.g, c.b]
    })
    this.ribbonMat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide })
    {
      const n = T.ribbonCap * 12
      this.ribbonPos = new Float32Array(n * 3)
      this.ribbonNor = new Float32Array(n * 3)
      this.ribbonCol = new Float32Array(n * 3)
      const g = new THREE.BufferGeometry()
      g.setAttribute('position', new THREE.BufferAttribute(this.ribbonPos, 3))
      g.setAttribute('normal', new THREE.BufferAttribute(this.ribbonNor, 3))
      g.setAttribute('color', new THREE.BufferAttribute(this.ribbonCol, 3))
      const idx = new Uint32Array(T.ribbonCap * 18)
      for (let q = 0; q < T.ribbonCap; q++) {
        const v = q * 12
        const o = q * 18
        idx[o] = v
        idx[o + 1] = v + 1
        idx[o + 2] = v + 2
        idx[o + 3] = v
        idx[o + 4] = v + 2
        idx[o + 5] = v + 3
        idx[o + 6] = v + 4
        idx[o + 7] = v + 5
        idx[o + 8] = v + 6
        idx[o + 9] = v + 4
        idx[o + 10] = v + 6
        idx[o + 11] = v + 7
        idx[o + 12] = v + 8
        idx[o + 13] = v + 9
        idx[o + 14] = v + 10
        idx[o + 15] = v + 8
        idx[o + 16] = v + 10
        idx[o + 17] = v + 11
      }
      g.setIndex(new THREE.BufferAttribute(idx, 1))
      g.setDrawRange(0, 0)
      this.ribbonGeom = g
      const mesh = new THREE.Mesh(g, this.ribbonMat)
      mesh.frustumCulled = false
      this.scene.add(mesh)
    }

    this.carModel = buildCar()
    this.scene.add(this.carModel.group)

    this.marks = new TireMarks(this.scene)
    this.smoke = new Smoke(this.scene)

    // 新手提示：广告同款绿三角，悬在车上方
    this.hintCone = new THREE.Mesh(
      new THREE.ConeGeometry(0.42, 0.85, 3),
      new THREE.MeshBasicMaterial({ color: 0x4cd964 }),
    )
    this.hintCone.rotation.x = Math.PI
    this.hintCone.visible = false
    this.scene.add(this.hintCone)

    this.setTheme(0)
  }

  // —— 路段生命周期（RoadGen.onAdd / onRemove 接到这里）——

  addSegment(s: Segment) {
    const d = DIRS[s.dir]
    const mesh = new THREE.Mesh(this.roadGeo, this.roadMats[this.themeIdx])
    mesh.scale.set(T.roadHalfWidth * 2, 0.24, s.len)
    mesh.rotation.y = Math.atan2(d.x, d.z)
    mesh.position.set((s.sx + s.ex) / 2, 0.12, (s.sz + s.ez) / 2)
    this.scene.add(mesh)
    this.segMeshes.set(s.i, mesh)
    // 90° 转折的斜接补片：填平两段矩形拼接处的内外楔形缺口
    if (this.lastSeg) {
      const prev = this.lastSeg
      const d1 = DIRS[prev.dir]
      const d2 = d
      const vx = (d1.z + d2.z) * T.roadHalfWidth
      const vz = (-d1.x - d2.x) * T.roadHalfWidth
      const bx = s.sx
      const bz = s.sz
      const y = 0.245
      const verts = new Float32Array([
        bx,
        y,
        bz,
        bx + vx,
        y,
        bz + vz,
        bx - vx,
        y,
        bz - vz,
      ])
      // 保证法线朝上（避免背面剔除/背光）
      const e1x = verts[3] - verts[0]
      const e1z = verts[5] - verts[2]
      const e2x = verts[6] - verts[0]
      const e2z = verts[8] - verts[2]
      if (e1x * e2z - e1z * e2x > 0) {
        // 叉积方向为上 → 交换后两顶点改为朝下，翻转
        const t0 = verts[3]
        const t1 = verts[4]
        const t2 = verts[5]
        verts[3] = verts[6]
        verts[4] = verts[7]
        verts[5] = verts[8]
        verts[6] = t0
        verts[7] = t1
        verts[8] = t2
      }
      const geo = new THREE.BufferGeometry()
      geo.setAttribute('position', new THREE.BufferAttribute(verts, 3))
      geo.computeVertexNormals()
      const tri = new THREE.Mesh(geo, this.roadMats[this.themeIdx])
      this.scene.add(tri)
      this.bendMeshes.set(s.i, tri)
    }
    this.lastSeg = s
    for (const c of s.coins) this.addCoin(c)
  }

  removeSegment(s: Segment) {
    const mesh = this.segMeshes.get(s.i)
    if (mesh) {
      this.scene.remove(mesh)
      this.segMeshes.delete(s.i)
    }
    const tri = this.bendMeshes.get(s.i)
    if (tri) {
      this.scene.remove(tri)
      tri.geometry.dispose()
      this.bendMeshes.delete(s.i)
    }
    if (this.lastSeg === s) this.lastSeg = null
    for (const c of s.coins) this.removeCoin(c)
  }

  /** 金币槽位管理（经典/拖拽两模式共用，ADR-0014） */
  addCoin(c: Coin) {
    let slot = this.freeCoinSlots.pop()
    if (slot === undefined) {
      if (this.coinTop >= COIN_CAP) return // 池满：金币不可见但逻辑仍可拾取（罕见）
      slot = this.coinTop++
    }
    this.coinSlots.set(c, slot)
  }

  removeCoin(c: Coin) {
    const slot = this.coinSlots.get(c)
    if (slot === undefined) return
    this.coinSlots.delete(c)
    this.freeCoinSlots.push(slot)
    this.hideDummy()
    this.coinInst.setMatrixAt(slot, this.dummy.matrix)
    this.coinInst.instanceMatrix.needsUpdate = true
  }

  /** 拖拽模式路带：写入一枚路带四边形（顶面 + 左右壁，主题色取自当前 themeIdx） */
  addRibbonQuad(q: RibbonQuad) {
    const s = this.ribbonCursor
    const [r, g, b] = this.themeRGB[this.themeIdx]
    const wR = r * 0.72
    const wG = g * 0.72
    const wB = b * 0.72
    const top = 0.24
    // 行进方向与左法线
    const fx = (q.cx + q.dx - q.ax - q.bx) / 2
    const fz = (q.cz + q.dz - q.az - q.bz) / 2
    const fl = Math.hypot(fx, fz) || 1
    const lnx = fz / fl
    const lnz = -fx / fl
    const P = this.ribbonPos
    const N = this.ribbonNor
    const C = this.ribbonCol
    const o = s * 36
    const set = (k: number, x: number, y: number, z: number, nx: number, ny: number, nz: number, cr: number, cg: number, cb: number) => {
      P[o + k * 3] = x
      P[o + k * 3 + 1] = y
      P[o + k * 3 + 2] = z
      N[o + k * 3] = nx
      N[o + k * 3 + 1] = ny
      N[o + k * 3 + 2] = nz
      C[o + k * 3] = cr
      C[o + k * 3 + 1] = cg
      C[o + k * 3 + 2] = cb
    }
    // 顶面 0..3
    set(0, q.ax, top, q.az, 0, 1, 0, r, g, b)
    set(1, q.bx, top, q.bz, 0, 1, 0, r, g, b)
    set(2, q.cx, top, q.cz, 0, 1, 0, r, g, b)
    set(3, q.dx, top, q.dz, 0, 1, 0, r, g, b)
    // 左壁 4..7
    set(4, q.ax, top, q.az, lnx, 0, lnz, wR, wG, wB)
    set(5, q.dx, top, q.dz, lnx, 0, lnz, wR, wG, wB)
    set(6, q.dx, 0, q.dz, lnx, 0, lnz, wR, wG, wB)
    set(7, q.ax, 0, q.az, lnx, 0, lnz, wR, wG, wB)
    // 右壁 8..11
    set(8, q.bx, top, q.bz, -lnx, 0, -lnz, wR, wG, wB)
    set(9, q.cx, top, q.cz, -lnx, 0, -lnz, wR, wG, wB)
    set(10, q.cx, 0, q.cz, -lnx, 0, -lnz, wR, wG, wB)
    set(11, q.bx, 0, q.bz, -lnx, 0, -lnz, wR, wG, wB)
    this.ribbonCursor = (s + 1) % T.ribbonCap
    this.ribbonUsed = Math.min(this.ribbonUsed + 1, T.ribbonCap)
    this.ribbonGeom.setDrawRange(0, this.ribbonUsed * 18)
    ;(this.ribbonGeom.attributes.position as THREE.BufferAttribute).needsUpdate = true
    ;(this.ribbonGeom.attributes.normal as THREE.BufferAttribute).needsUpdate = true
    ;(this.ribbonGeom.attributes.color as THREE.BufferAttribute).needsUpdate = true
  }

  syncCoins(time: number) {
    if (this.coinSlots.size === 0) return
    for (const [c, slot] of this.coinSlots) {
      const d = this.dummy
      if (c.taken) {
        d.position.set(0, -50, 0)
        d.rotation.set(0, 0, 0)
        d.scale.setScalar(0.0001)
      } else {
        d.position.set(c.x, 0.52 + Math.sin(time * 2.5 + c.x * 1.7) * 0.06, c.z)
        d.rotation.set(0, time * 4, 0)
        d.scale.setScalar(1)
      }
      d.updateMatrix()
      this.coinInst.setMatrixAt(slot, d.matrix)
    }
    this.coinInst.instanceMatrix.needsUpdate = true
  }

  // —— 车与相机 ——

  syncCar(car: { x: number; z: number; yaw: number; targetYaw: number; speed: number; slide: number }, state: string, fallT: number, fallFrom: { x: number; z: number; yaw: number }, dt: number, time: number) {
    const g = this.carModel.group
    if (state === 'falling' || state === 'results') {
      // ADR-0010：下坠 + 旋转 + 缩小；地板同步坠走，车坠入背景色深渊（results 保持终态）
      const k = Math.min(1, fallT / T.fallTime)
      g.position.set(fallFrom.x, 0.24 - 10 * k * k, fallFrom.z)
      g.rotation.set(0, fallFrom.yaw + 2.4 * k, 0.9 * k)
      g.scale.setScalar(Math.max(0.04, 1 - 0.75 * k))
      this.ground.position.y = -14 * k
      this.carModel.blob.visible = false
      return
    }
    this.carModel.blob.visible = true
    g.position.set(car.x, 0.24, car.z)
    const steer = THREE.MathUtils.clamp((car.targetYaw - car.yaw) * 1.1, -0.45, 0.45)
    // 侧滑角越大侧倾越明显（车尾甩出的视觉反馈）
    g.rotation.set(0, car.yaw, -THREE.MathUtils.clamp(car.slide * 1.6, -0.4, 0.4))
    g.scale.setScalar(1)
    const spin = -(car.speed * dt) / this.carModel.wheelRadius
    for (const w of this.carModel.wheels) w.rotation.x += spin
    // 前轮 counter-steer：漂移时朝速度方向反向修正（ADR-0014）
    for (const w of this.carModel.frontWheels) {
      w.rotation.y = THREE.MathUtils.clamp(steer * 0.6 - car.slide * 1.3, -0.55, 0.55)
    }
    this.hintCone.position.set(car.x, 2.05 + Math.sin(time * 4) * 0.12, car.z)
  }

  updateCamera(car: { x: number; z: number; yaw: number; velAngle: number }, state: string, dt: number, mode: string) {
    if (state === 'falling' || state === 'results') return // ADR-0010：相机停住看车坠落
    // 拖拽模式视线沿实际运动方向前引（看得出侧滑），经典沿车头
    const leadAng = mode === 'drag' ? car.velAngle : car.yaw
    const f0 = -Math.sin(leadAng)
    const f2 = -Math.cos(leadAng)
    const k = 1 - Math.exp(-5 * dt)
    this.lookTarget.lerp(this.tmpV.set(car.x + f0 * T.camLead, 0.3, car.z + f2 * T.camLead), k)
    this.camera.position.set(car.x, T.camHeight, car.z + T.camBack)
    this.camera.lookAt(this.lookTarget)
    this.ground.position.set(car.x, 0, car.z)
  }

  snapCamera(car: { x: number; z: number; yaw: number }) {
    const f0 = -Math.sin(car.yaw)
    const f2 = -Math.cos(car.yaw)
    this.lookTarget.set(car.x + f0 * T.camLead, 0.3, car.z + f2 * T.camLead)
    this.camera.position.set(car.x, T.camHeight, car.z + T.camBack)
    this.camera.lookAt(this.lookTarget)
    this.ground.position.set(car.x, 0, car.z)
  }

  // —— 其他 ——

  setTheme(idx: number) {
    this.themeIdx = idx
    const th = T.themes[idx]
    ;(this.ground.material as THREE.MeshBasicMaterial).color.setHex(th.bg)
    this.fog.color.setHex(th.bg)
    ;(this.scene.background as THREE.Color).setHex(th.bg)
  }

  setHintCone(b: boolean) {
    this.hintCone.visible = b
  }

  reset() {
    this.marks.reset()
    this.smoke.reset()
    const g = this.carModel.group
    g.scale.setScalar(1)
    g.rotation.set(0, 0, 0)
    g.position.y = 0.24
    this.lastSeg = null
    this.ground.position.y = 0
    // 经典路渲染残留防御性清理
    for (const [, m] of this.segMeshes) this.scene.remove(m)
    this.segMeshes.clear()
    for (const [, t] of this.bendMeshes) {
      this.scene.remove(t)
      t.geometry.dispose()
    }
    this.bendMeshes.clear()
    // 路带缓冲与金币槽位全部回收
    this.ribbonCursor = 0
    this.ribbonUsed = 0
    this.ribbonGeom.setDrawRange(0, 0)
    for (const [, slot] of this.coinSlots) {
      this.freeCoinSlots.push(slot)
      this.hideDummy()
      this.coinInst.setMatrixAt(slot, this.dummy.matrix)
    }
    this.coinSlots.clear()
    this.coinInst.instanceMatrix.needsUpdate = true
    this.setTheme(0)
  }

  resize() {
    this.camera.aspect = window.innerWidth / window.innerHeight
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(window.innerWidth, window.innerHeight)
  }

  render() {
    this.renderer.render(this.scene, this.camera)
  }

  private hideDummy() {
    this.dummy.position.set(0, -50, 0)
    this.dummy.rotation.set(0, 0, 0)
    this.dummy.scale.setScalar(0.0001)
    this.dummy.updateMatrix()
  }
}
