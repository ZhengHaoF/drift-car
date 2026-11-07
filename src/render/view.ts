import * as THREE from 'three'
import { T } from '../config'
import { DIRS } from '../game/car'
import type { Coin, Segment } from '../game/road'
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
    for (const c of s.coins) {
      let slot = this.freeCoinSlots.pop()
      if (slot === undefined) {
        if (this.coinTop >= COIN_CAP) continue // 池满：金币不可见但逻辑仍可拾取（罕见）
        slot = this.coinTop++
      }
      this.coinSlots.set(c, slot)
    }
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
    for (const c of s.coins) {
      const slot = this.coinSlots.get(c)
      if (slot !== undefined) {
        this.coinSlots.delete(c)
        this.freeCoinSlots.push(slot)
        this.hideDummy()
        this.coinInst.setMatrixAt(slot, this.dummy.matrix)
        this.coinInst.instanceMatrix.needsUpdate = true
      }
    }
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
    for (const w of this.carModel.frontWheels) w.rotation.y = steer
    this.hintCone.position.set(car.x, 2.05 + Math.sin(time * 4) * 0.12, car.z)
  }

  updateCamera(car: { x: number; z: number; yaw: number }, state: string, dt: number) {
    if (state === 'falling' || state === 'results') return // ADR-0010：相机停住看车坠落
    const f0 = -Math.sin(car.yaw)
    const f2 = -Math.cos(car.yaw)
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
