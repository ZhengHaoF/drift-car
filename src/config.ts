/**
 * 集中调参配置 —— 所有手感相关参数都在这里。
 * 设计依据见 docs/adr/（ADR-0001 ~ 0011）。
 */
export const T = {
  // —— 车辆（ADR-0001 单击切换 + 圆弧漂移；ADR-0002 随距离加速；ADR-0013 侧滑手感）——
  baseSpeed: 9, // 起步速度 m/s
  speedRamp: 0.008, // 每米路程增加的速度 m/s
  maxSpeed: 22, // 速度上限
  turnRate: 4.6, // 漂移角速度 rad/s（90° 约 0.34s 甩到位）
  driftVelLag: 10, // 侧滑收敛速率 rad/s：速度方向追赶车头的速率，越小甩尾越夸张
  carScale: 0.72, // 车体整体缩放（车宽约占路宽 15%，对齐广告观感）

  // —— 路面（ADR-0007 V 形折弯之字路）——
  roadHalfWidth: 2.4, // 路面半宽 m（几何下限：段长需 > 2×半宽，平行路段才不重叠）
  segLenStart: [8, 16] as [number, number], // 段长随机范围（起步）
  segLenFinal: [5.6, 9] as [number, number], // 段长随机范围（后期，收窄）
  segShrinkDist: 700, // 段长从起步范围过渡到后期范围的距离 m
  segMinLen: 5.3, // 段长下限
  openSegs: 4, // 开局前 N 段固定用起步范围（缓冲）
  genAhead: 170, // 向前预生成距离 m
  genBehind: 80, // 保留车后方距离 m

  // —— 金币（ADR-0008 沿中心线成串，转折处沿弧线）——
  coinSpacing: 2.6, // 中心线金币间距 m
  coinMargin: 3.2, // 段两端离转折的留空 m（转折弧线金币的贝塞尔展幅）
  bendCoins: 3, // 每个转折弧线上的金币数
  coinPickup: 1.25, // 拾取半径 m

  // —— 主题（ADR-0004 色块风：橙底灰路 / 黄底绿路）——
  themeSwapDist: 450, // 每跑多少米换一次主题；新路段用新主题，旧路段保留旧色（广告同款过渡）
  themes: [
    { bg: 0xe8641c, road: 0xcac2b6 }, // 橙底灰路
    { bg: 0xf2b71c, road: 0x44644b }, // 黄底绿路
  ] as ReadonlyArray<{ bg: number; road: number }>,

  // —— 坠落（ADR-0010）——
  fallTime: 0.85, // 坠落动画时长 s

  // —— 相机（ADR-0009 透视 ~60° 俯角，固定不旋转）——
  camHeight: 11.5,
  camBack: 7,
  camLead: 3.2, // 视线沿车头方向前引 m
  fov: 58,
  pixelRatioCap: 2,

  // —— 特效 ——
  tireStampEvery: 0.045, // 胎印盖章间隔 s
  tireFadeTime: 8, // 胎印淡出时长 s
  maxTireQuads: 700, // 胎印四边形环形缓冲上限
  smokeEvery: 0.05, // 烟雾生成间隔 s
  smokeLife: 0.9, // 烟雾存活 s
  maxSmoke: 36, // 烟雾粒子池上限

  // —— 音频（ADR-0005）——
  driftGain: 0.22, // 胎噪音量

  // —— 自由拖拽模式（ADR-0014）——
  steerClampDeg: 75, // 目标朝向相对屏幕正上的上限（deg）
  maxYawRate: 3.2, // 车头追赶角速度上限 rad/s
  yawChaseK: 4.5, // 车头追赶比例系数：目标差 × K = 期望角速度
  gripALow: 18, // 侧向需求低于此值全抓地 m/s²
  gripAHigh: 26, // 高于此值完全失去抓地
  gripCatchRate: 16, // 抓地时速度方向追赶速率 rad/s
  driftCatchRate: 6, // 漂移时速度方向追赶速率 rad/s（甩尾幅度）
  slideEnter: 0.14, // 漂移特效进入的侧滑角 rad
  slideExit: 0.08, // 漂移特效退出的侧滑角 rad（滞回）
  driftScrub: 0.35, // 漂移掉速：满侧滑时速度损失比例
  ribbonStep: 2, // 路带中心线采样步长 m
  joystickR: 90, // 虚拟摇杆满幅像素
  ribbonCap: 2048, // 路带四边形环形缓冲上限（≈4km）
}
