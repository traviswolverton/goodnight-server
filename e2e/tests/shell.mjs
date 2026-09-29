/** Sign-in, navigation, theme, mobile layout and security headers. */
import { ADMIN, BASE, sleep, start } from '../lib.mjs'

const t = await start()
const { page, check, shot, settle, path, goto } = t
const url = () => new URL(page.url())

await t.step('sign-in', async () => {
  await goto('/buttons')
  check('anonymous /buttons -> /login remembering the target', url().pathname === '/login' && url().searchParams.get('next') === '/buttons', page.url())
  check('login screen renders', !!(await page.$('#username')) && (await page.title()).startsWith('Sign in'))
  await shot('s1-login')

  await page.type('#username', ADMIN.u)
  await page.type('#password', 'definitely-wrong-pw')
  await page.click('button[type=submit]')
  await settle()
  const alertText = await page.$eval('[role=alert]', (e) => e.textContent).catch(() => '')
  check('wrong password shows an error and stays on /login', url().pathname === '/login' && /invalid username or password/i.test(alertText), alertText)

  await page.click('#password', { clickCount: 3 })
  await page.type('#password', ADMIN.p)
  await page.click('button[type=submit]')
  await settle()
  check('login returns to the page you asked for', path() === '/buttons', path())
  check('page title follows the page', (await page.title()) === 'Buttons · Bedside Dashboard', await page.title())
})

await t.step('navigation', async () => {
  const nav = await page.$$eval('aside nav a', (a) => a.map((x) => x.textContent.trim()))
  check('admin sees all eight sections', nav.join(',') === 'Home,Device,Actions,Buttons,Settings,Appearance,Users,MQTT reference', nav.join(','))
  check('current section is marked for assistive tech', (await page.$eval('aside nav a[aria-current=page]', (a) => a.textContent.trim()).catch(() => '')) === 'Buttons')
  await goto('/actions')
  check('deep link + refresh keeps the session and route', path() === '/actions' && (await page.$eval('h1', (h) => h.textContent)) === 'Actions')
  await goto('/nope/nothing')
  check('unknown route shows a 404 inside the app shell', /Page not found/.test(await t.text('main')))
  await goto('/')
  const footer = await t.text('aside')
  check('sidebar footer shows version and uptime', /Version\s*\S+/.test(footer) && /Up /.test(footer), footer.slice(-60))
})

await t.step('theme', async () => {
  await page.click('button[aria-label="Change theme"]')
  await page.waitForSelector('[role=menuitemradio]')
  await (await page.$$('[role=menuitemradio]'))[1].click()
  await sleep(300)
  check('dark theme applies', await page.$eval('html', (h) => h.classList.contains('dark')))
  await page.reload()
  await settle()
  check('theme persists across a reload', await page.$eval('html', (h) => h.classList.contains('dark')))
  await shot('s2-dark')
})

await t.step('mobile', async () => {
  await page.setViewport({ width: 390, height: 800, isMobile: true, hasTouch: true })
  await page.reload()
  await settle()
  check('sidebar collapses to a menu button', !(await page.$eval('aside', (a) => a.offsetParent !== null)) && !!(await page.$('button[aria-label="Open menu"]')))
  await page.click('button[aria-label="Open menu"]')
  await page.waitForSelector('[role=dialog] nav')
  await sleep(700)
  check('drawer is fully on screen with every link', (await page.$$eval('[role=dialog] nav a', (a) => a.length)) === 8 && (await page.$eval('[role=dialog]', (d) => { const b = d.getBoundingClientRect(); return b.left >= 0 && b.width > 200 })))
  await page.keyboard.press('Escape')
  await page.setViewport({ width: 1280, height: 900 })
})

await t.step('sign-out', async () => {
  await goto('/')
  await page.click('button[aria-label="Account menu"]')
  await page.waitForSelector('[role=menuitem]')
  const menu = await page.$$eval('[role=menuitem]', (m) => m.map((x) => x.textContent.trim()))
  check('user menu offers account + sign out', menu.some((x) => /Your account/.test(x)) && menu.some((x) => /Sign out/.test(x)), menu.join(' | '))
  await page.locator('::-p-aria(Sign out)').click() // the menu is already open
  await settle()
  check('sign out returns to /login', path() === '/login', path())
  check('the session really ended server-side', (await t.api('/api/auth/me')).status === 401)
})

await t.step('security', async () => {
  await goto('/login?next=//evil.example')
  check('?next=//evil.example is never followed', !url().host.includes('evil') && path() !== '//evil.example', page.url())
  const response = await page.goto(BASE + '/login')
  const h = response.headers()
  check('strict CSP: scripts only from this origin', /script-src 'self'(;|$)/.test(h['content-security-policy'] ?? '') && !/script-src[^;]*unsafe-inline/.test(h['content-security-policy']), h['content-security-policy'])
  check('clickjacking + sniffing protection headers', h['x-frame-options'] === 'DENY' && h['x-content-type-options'] === 'nosniff' && /frame-ancestors 'none'/.test(h['content-security-policy']))
  check('the shell is never cached (so deploys show up)', h['cache-control'] === 'no-store')
  check('API responses are never cached', (await page.evaluate(() => fetch('/api/auth/me').then((r) => r.headers.get('cache-control')))) === 'no-store')
  check('/healthz is the one open route and reveals nothing', JSON.stringify(await page.evaluate(() => fetch('/healthz').then((r) => r.json()))) === '{"ok":true}')
  check('API docs are not exposed', (await page.evaluate(() => fetch('/openapi.json', { headers: { Accept: 'application/json' } }).then((r) => r.headers.get('content-type')))).startsWith('text/html'))
})

await t.finish()
