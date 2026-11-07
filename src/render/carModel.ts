import * as THREE from 'three'
import { T } from '../config'

export interface CarModel {
  group: THREE.Group
  wheels: THREE.Mesh[]
  frontWheels: THREE.Mesh[]
  /** 假阴影贴片（坠落时隐藏） */
  blob: THREE.Mesh
  /** 缩放后的有效车轮半径（用于自转速度） */
  wheelRadius: number
}

/** 程序化低多边形拼装车（ADR-0009）：车头朝本地 -Z，零外部资源 */
export function buildCar(): CarModel {
  const group = new THREE.Group()
  // 内层组承担整体缩放，外层组留给位置/朝向/坠落动画
  const inner = new THREE.Group()
  inner.scale.setScalar(T.carScale)
  group.add(inner)
  const add = (m: THREE.Object3D) => inner.add(m)

  const bodyMat = new THREE.MeshLambertMaterial({ color: 0x3f7ad6 })
  const trimMat = new THREE.MeshLambertMaterial({ color: 0x274a80 })
  const darkMat = new THREE.MeshLambertMaterial({ color: 0x1e2126 })
  const glassMat = new THREE.MeshLambertMaterial({ color: 0xbfe3ff })

  const body = new THREE.Mesh(new THREE.BoxGeometry(1.02, 0.34, 2.0), bodyMat)
  body.position.y = 0.36
  add(body)

  const skirt = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.18, 1.7), trimMat)
  skirt.position.y = 0.22
  add(skirt)

  // 座舱靠后，前挡风朝 -Z（车头方向）
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(0.84, 0.32, 1.0), bodyMat)
  cabin.position.set(0, 0.66, 0.16)
  add(cabin)

  const windshield = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.2, 0.06), glassMat)
  windshield.position.set(0, 0.62, -0.36)
  add(windshield)

  const wheelGeo = new THREE.CylinderGeometry(0.23, 0.23, 0.3, 12)
  wheelGeo.rotateZ(Math.PI / 2)
  const wheels: THREE.Mesh[] = []
  const frontWheels: THREE.Mesh[] = []
  const layout: Array<[number, number, boolean]> = [
    [-0.5, -0.62, true],
    [0.5, -0.62, true],
    [-0.5, 0.62, false],
    [0.5, 0.62, false],
  ]
  for (const [wx, wz, front] of layout) {
    const w = new THREE.Mesh(wheelGeo, darkMat)
    // YXZ：先绕自身车轴自转（X），再整体转向（Y）——否则漂移时轮子歪着乱转
    w.rotation.order = 'YXZ'
    w.position.set(wx, 0.23, wz)
    add(w)
    wheels.push(w)
    if (front) frontWheels.push(w)
  }

  const lightGeo = new THREE.BoxGeometry(0.18, 0.1, 0.06)
  const headMat = new THREE.MeshBasicMaterial({ color: 0xfff6c9 })
  const tailMat = new THREE.MeshBasicMaterial({ color: 0xe6482e })
  for (const lx of [-0.32, 0.32]) {
    const h = new THREE.Mesh(lightGeo, headMat)
    h.position.set(lx, 0.36, -1.0)
    add(h)
    const t = new THREE.Mesh(lightGeo, tailMat)
    t.position.set(lx, 0.4, 1.0)
    add(t)
  }

  // 假阴影：接地感（v1 不开阴影贴图）
  const blob = new THREE.Mesh(
    new THREE.CircleGeometry(1, 20),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.22, depthWrite: false }),
  )
  blob.rotation.x = -Math.PI / 2
  blob.scale.set(0.75, 1.4, 1)
  blob.position.y = 0.015
  add(blob)

  return { group, wheels, frontWheels, blob, wheelRadius: 0.23 * T.carScale }
}
