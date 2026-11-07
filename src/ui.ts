const $ = (id: string) => document.getElementById(id)!

/** DOM UI：开始页 / HUD / 结算 / 暂停 / 新手提示（文案中文，ADR-0011） */
export class Ui {
  private startEl = $('start')
  private resultsEl = $('results')
  private hudEl = $('hud')
  private pauseEl = $('pause')
  private hintEl = $('hint')
  private distEl = $('dist')
  private coinNEl = $('coinN')
  private startBestEl = $('startBest')
  private resDistEl = $('resDist')
  private resBestEl = $('resBest')
  private resCoinsEl = $('resCoins')
  private resRecordEl = $('resRecord')
  private lastDist = -1
  private lastCoins = -1
  private lastHint: boolean | null = null

  showStart(best: number, coinsTotal: number) {
    this.startEl.classList.remove('hidden')
    this.resultsEl.classList.add('hidden')
    this.hudEl.classList.add('hidden')
    this.hintEl.classList.add('hidden')
    this.startBestEl.textContent = `最高纪录 ${best}m · 累计金币 ${coinsTotal}`
    this.lastDist = -1
    this.lastCoins = -1
  }

  showHud() {
    this.startEl.classList.add('hidden')
    this.resultsEl.classList.add('hidden')
    this.hudEl.classList.remove('hidden')
    this.lastCoins = -1
    this.setCoinsRun(0)
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
