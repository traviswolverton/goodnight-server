/** Shared helpers for the browser tests: launch Chromium, record checks, and
 *  small wrappers so each test reads as a script of what a person does. */
import puppeteer from 'puppeteer-core'

export const BASE = process.env.BASE_URL ?? 'http://dashapp:8000'
export const ADMIN = { u: process.env.ADMIN_USER ?? 'smokeadmin', p: process.env.ADMIN_PW }
export const VIEWER = { u: 'viewer1', p: 'viewer-pass-12345', p2: 'viewer-new-pass-67890' }
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

export async function start({ viewport = { width: 1280, height: 900 }, bypassCSP = false } = {}) {
  const results = []
  const problems = []
  const browser = await puppeteer.launch({
    executablePath: '/usr/bin/chromium-browser',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  })
  const page = await browser.newPage()
  await page.setViewport(viewport)
  if (bypassCSP) await page.setBypassCSP(true)
  page.setDefaultTimeout(8000)
  page.on('console', (m) => {
    if (['error', 'warning'].includes(m.type())) problems.push(`${m.type()}: ${m.text()}`)
  })
  page.on('pageerror', (e) => problems.push('pageerror: ' + e.message))

  let lastCheck = '(none yet)'
  const t = {
    page,
    browser,
    results,
    check(name, ok, extra = '') {
      results.push({ name, ok: !!ok })
      lastCheck = name
      console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && extra ? '  — ' + extra : ''}`)
    },
    shot: (name) => page.screenshot({ path: `/work/shots/${name}.png` }),
    settle: () => page.waitForNetworkIdle({ idleTime: 400, timeout: 8000 }).catch(() => {}),
    path: () => new URL(page.url()).pathname + new URL(page.url()).search,
    text: (selector = 'main') => page.$eval(selector, (e) => e.textContent).catch(() => ''),
    click: (aria) => page.locator(`::-p-aria(${aria})`).click(),
    api: (path, init) =>
      page.evaluate(
        async (p, i) => {
          const r = await fetch(p, i)
          return { status: r.status, body: await r.json().catch(() => null) }
        },
        path,
        init,
      ),
    /** Run a test section; an exception fails that section but not the whole run. */
    async step(name, fn) {
      try {
        await fn()
      } catch (e) {
        t.check(`${name} (threw)`, false, `${String(e.message).split('\n')[0]} — after check: "${lastCheck}"`)
      }
    },
    async goto(path) {
      await page.goto(BASE + path)
      await t.settle()
    },
    async login(user, password) {
      await t.goto('/login')
      await page.type('#username', user)
      await page.type('#password', password)
      await page.click('button[type=submit]')
      await t.settle()
    },
    async signOut() {
      await page.click('button[aria-label="Account menu"]')
      await page.locator('::-p-aria(Sign out)').click()
      await t.settle()
    },
    /** Print the summary, close the browser, and exit non-zero if anything failed. */
    async finish({ ignoreConsole = /Failed to load resource/i } = {}) {
      const real = problems.filter((p) => !ignoreConsole.test(p))
      t.check('no console errors / CSP violations', real.length === 0, real.join(' || ').slice(0, 400))
      const passed = results.filter((r) => r.ok).length
      console.log(`\n${passed}/${results.length} checks passed`)
      await browser.close()
      process.exit(results.every((r) => r.ok) ? 0 : 1)
    },
  }
  return t
}
