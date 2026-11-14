const $ = (id: string) => document.getElementById(id)!

/** DOM UI：模式选择 / HUD / 结算 / 暂停 / 新手提示（文案中文，ADR-0011/0014） */
export class Ui {
  private startEl = $('start')
  private resultsEl = $('results')
  private hudEl = $('hud')
  private pauseEl = $('pause')
  private hintEl = $('hint')
  private hintTextEl = $('hintText')
  private distEl = $('dist')
  private coinNEl = $('coinN')
  private bestClassicEl = $('bestClassic')
  private bestDragEl = $('bestDrag')
  private startCoinsEl = $('startCoins')
  private invertToggleEl = $('invertToggle')
  private resDistEl = $('resDist')
  private resBestEl = $('resBest')
  private resCoinsEl = $('resCoins')
  private resRecordEl = $('resRecord')
  private lastDist = -1
  private lastCoins = -1
  private lastHint: boolean | null = null

  showStart(bestClassic: number, bestDrag: number, coinsTotal: number) {
    this.startEl.classList.remove('hidden')
    this.resultsEl.classList.add('hidden')
    this.hudEl.classList.add('hidden')
    this.hintEl.classList.add('hidden')
    this.bestClassicEl.textContent = `纪录 ${bestClassic}m`
    this.bestDragEl.textContent = `纪录 ${bestDrag}m`
    this.startCoinsEl.textContent = `累计金币 ${coinsTotal}`
    this.lastDist = -1
    this.lastCoins = -1
  }

  /** 反转拖拽开关的文案与状态色 */
  setInvertLabel(on: boolean) {
    this.invertToggleEl.textContent = on ? '反转拖拽：开（左拖右转）' : '反转拖拽：关'
    this.invertToggleEl.classList.toggle('on', on)
  }

  showHud() {
    this.startEl.classList.add('hidden')
    this.resultsEl.classList.add('hidden')
    this.hudEl.classList.remove('hidden')
    this.lastCoins = -1
    this.setCoinsRun(0)
  }

  setHintText(t: string) {
    this.hintTextEl.textContent = t
  }

  setDist(m: number) {
    if (m === this.lastDist) return
    this.lastDist = m
    this.distEl.textContent = `${m}m`
  }

  setCoinsRun(n: number) {
    if (n === this.lastCoins) return
    this.lastCoins = n
    this.coinNEl.textContent = String(n)
  }

  showResults(dist: number, best: number, coinsRun: number, coinsTotal: number, newRecord: boolean) {
    this.hudEl.classList.add('hidden')
    this.hintEl.classList.add('hidden')
    this.resultsEl.classList.remove('hidden')
    this.resDistEl.textContent = String(dist)
    this.resBestEl.textContent = `最高纪录 ${best}m`
    this.resCoinsEl.textContent = `金币 +${coinsRun}（累计 ${coinsTotal}）`
    this.resRecordEl.classList.toggle('hidden', !newRecord)
  }

  showPause(b: boolean) {
    this.pauseEl.classList.toggle('hidden', !b)
  }

  setHint(b: boolean) {
    if (b === this.lastHint) return
    this.lastHint = b
    this.hintEl.classList.toggle('hidden', !b)
  }
}
