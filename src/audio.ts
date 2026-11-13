import { T } from './config'

/** 基础音效（ADR-0005）：胎噪合成、金币、坠毁；首次手势解锁 */
export class Sfx {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private noiseBuf: AudioBuffer | null = null
  private driftSrc: AudioBufferSourceNode | null = null
  private driftGain: GainNode | null = null
  private driftFilter: BiquadFilterNode | null = null

  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume()
      return
    }
    const ctx = new AudioContext()
    this.ctx = ctx
    this.master = ctx.createGain()
    this.master.gain.value = 0.8
    this.master.connect(ctx.destination)
    const len = ctx.sampleRate | 0
    const buf = ctx.createBuffer(1, len, ctx.sampleRate)
    const data = buf.getChannelData(0)
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1
    this.noiseBuf = buf
  }

  /** 漂移胎噪：强度 0~1 连续控制（音量与音色随侧滑角变化，ADR-0014）；0 = 关 */
  setDriftIntensity(intensity: number) {
    const ctx = this.ctx
    if (!ctx || !this.master) return
    const t = ctx.currentTime
    if (intensity <= 0.01) {
      if (this.driftSrc && this.driftGain) {
        this.driftGain.gain.setTargetAtTime(0.0001, t, 0.06)
        this.driftSrc.stop(t + 0.4)
        this.driftSrc = null
        this.driftGain = null
        this.driftFilter = null
      }
      return
    }
    if (!this.driftSrc) {
      const src = ctx.createBufferSource()
      src.buffer = this.noiseBuf
      src.loop = true
      const bp = ctx.createBiquadFilter()
      bp.type = 'bandpass'
      bp.frequency.value = 850
      bp.Q.value = 0.7
      const g = ctx.createGain()
      g.gain.setValueAtTime(0.0001, t)
      g.gain.exponentialRampToValueAtTime(T.driftGain * 0.35, t + 0.09)
      src.connect(bp)
      bp.connect(g)
      g.connect(this.master)
      src.start()
      this.driftSrc = src
      this.driftGain = g
      this.driftFilter = bp
    }
    if (this.driftGain && this.driftFilter) {
      this.driftGain.gain.setTargetAtTime(T.driftGain * (0.35 + 0.65 * intensity), t, 0.05)
      this.driftFilter.frequency.setTargetAtTime(650 + 700 * intensity, t, 0.08)
    }
  }

  coin() {
    if (!this.ctx) return
    const t = this.ctx.currentTime
    this.blip(987.77, t, 0.07, 0.18)
    this.blip(1318.51, t + 0.07, 0.09, 0.18)
  }

  click() {
    if (!this.ctx) return
    this.blip(660, this.ctx.currentTime, 0.06, 0.12)
  }

  crash() {
    const ctx = this.ctx
    if (!ctx || !this.master || !this.noiseBuf) return
    const t = ctx.currentTime
    const src = ctx.createBufferSource()
    src.buffer = this.noiseBuf
    const lp = ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = 480
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.55, t)
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.5)
    src.connect(lp)
    lp.connect(g)
    g.connect(this.master)
    src.start(t)
    src.stop(t + 0.55)
    const o = ctx.createOscillator()
    o.type = 'sawtooth'
    o.frequency.setValueAtTime(230, t)
    o.frequency.exponentialRampToValueAtTime(48, t + 0.5)
    const og = ctx.createGain()
    og.gain.setValueAtTime(0.22, t)
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.5)
    o.connect(og)
    og.connect(this.master)
    o.start(t)
    o.stop(t + 0.55)
  }

  private blip(freq: number, at: number, dur: number, vol: number) {
    const ctx = this.ctx!
    const o = ctx.createOscillator()
    o.type = 'triangle'
    o.frequency.value = freq
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, at)
    g.gain.exponentialRampToValueAtTime(vol, at + 0.015)
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur)
    o.connect(g)
    g.connect(this.master!)
    o.start(at)
    o.stop(at + dur + 0.02)
  }
}
