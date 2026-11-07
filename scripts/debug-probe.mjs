import { chromium } from 'playwright-core'

const browser = await chromium.launch({ channel: 'msedge', headless: true })
const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
const errors = []
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message + '\n' + (e.stack || '')))
page.on('console', (m) => errors.push(`console[${m.type()}]: ` + m.text()))
page.on('requestfailed', (r) => errors.push('requestfailed: ' + r.url() + ' ' + (r.failure()?.errorText || '')))

await page.goto('http://127.0.0.1:5173/')
await page.waitForTimeout(2000)
const info = await page.evaluate(() => ({
  hasGame: !!window.__game,
  state: window.__game?.state,
  canvas: !!document.querySelector('#game'),
  title: document.title,
}))
console.log('info:', JSON.stringify(info))
console.log('errors:', errors.length ? errors.join('\n---\n') : '无')
await browser.close()
