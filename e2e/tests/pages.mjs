/** Every page, as an admin and as a viewer: real clicks against the real
 *  image. Mutates state (creates a viewer, saves settings...) so it expects a
 *  fresh stack — run.sh provides one. */
import { ADMIN, VIEWER, sleep, start } from '../lib.mjs'

const t = await start()
const { page, check, shot, settle, path, text, click, api, step, goto, login, signOut } = t

// ---------- admin ----------
await login(ADMIN.u, ADMIN.p)
await step('home', async () => {
  await goto('/')
  await page.waitForFunction(() => /System health/.test(document.querySelector('main')?.textContent ?? ''), { timeout: 25000 })
  const t = await text()
  check('home: shows system health with MQTT + database facts', /Connected/.test(t) && /Available/.test(t), t.slice(0, 200))
  check('home: says Home Assistant can’t be reached', /Home Assistant\s*Can’t be reached/.test(t), t.slice(0, 200))
  check('home: no display previews (cards are gone)', !(await page.$('[role=img][aria-label^="Display preview"]')))
  await shot('h1-home')
})

await step('actions', async () => {
  await goto('/actions')
  // The seed's old adapters.yaml moved Home Assistant over, to a host that doesn't exist.
  const body = (await api('/api/actions')).body
  check('actions: Home Assistant moved over from adapters.yaml', body.home_assistant.set_up === true, JSON.stringify(body.home_assistant))
  check('actions: says once why states are blank', /Home Assistant can’t be reached/.test(await text()))
  check('actions: empty list', /No actions yet/.test(await text()))
  await click('Add action'); await page.waitForSelector('main form')
  check('actions: the editor has no adapter to choose', !/Adapter/.test(await text('main form')) && /What it does/.test(await text('main form')))
  await shot('p1-actions-editor')
  await click('Cancel')
  await shot('p1-actions')
})

await step('device', async () => {
  await goto('/device')
  // The stack has a broker but no device, so: connected, never heard from.
  check('device: waits for the device to report', /Not heard from yet/.test(await text()))
  check('device: no presses yet', /No presses yet/.test(await text()))
  await page.locator('input[aria-describedby$="bright_lux-help"]').fill('35'); await sleep(200)
  await click('Save'); await sleep(800)
  check('device: dimmer saved', (await api('/api/device')).body.config.dimmer.bright_lux === 35)
  await page.locator('input[aria-describedby$="dark_lux-help"]').fill('99'); await sleep(200)
  await click('Save'); await sleep(300)
  check('device: refuses dark above bright', /must not be above the full-brightness level/.test(await text()))
  await shot('p1-device')
})

await step('buttons', async () => {
  await goto('/buttons')
  const tiles = await page.$$eval('ul[aria-label=Buttons] button', (b) => b.map((x) => x.getAttribute('aria-label')))
  check('buttons: eight tiles, 1-4 on the top row', tiles.length === 8 && tiles[0].startsWith('Button 1:') && tiles[4].startsWith('Button 5:'), JSON.stringify(tiles))
  const tops = await page.$$eval('ul[aria-label=Buttons] li', (li) => li.map((x) => Math.round(x.getBoundingClientRect().top)))
  check('buttons: laid out as two rows of four', new Set(tops.slice(0, 4)).size === 1 && new Set(tops.slice(4)).size === 1 && tops[4] > tops[0], JSON.stringify(tops))
  check('buttons: points to Actions when there are none', /No actions to assign yet/.test(await text()))
  await shot('p1-buttons')
  await page.locator('button[aria-label^="Button 3:"]').click(); await page.waitForSelector('[role=dialog]'); await sleep(400)
  check('buttons: a tile opens its editor', /Button 3/.test(await page.$eval('[role=dialog]', (d) => d.textContent)))
  await shot('p1-buttons-edit')
  await page.keyboard.press('Escape'); await sleep(300)
})

await step('connections', async () => {
  await goto('/settings')
  const t = await text()
  check('connections: Home Assistant card shows the moved URL, and that it can’t be reached',
    /homeassistant\.invalid:8123/.test(t) && /Can’t be reached/.test(t), t.slice(0, 300))
  const summary = (await api('/api/connections')).body.home_assistant
  check('connections: the token is never sent to the browser', summary.token_set === true && !JSON.stringify(summary).includes('literal-test-token'))
  await page.locator('main button ::-p-text(Change)').click(); await page.waitForSelector('[role=dialog]')
  await page.locator('#ha-url').fill('http://other.invalid:8123')
  check('connections: a saved token shows as a hint, never the value', (await page.$eval('#ha-token', (e) => e.placeholder + '|' + e.value)) === 'Leave blank to keep the current one|')
  await click('Test'); await page.waitForFunction(() => /Couldn’t connect/.test(document.querySelector('[role=dialog]')?.textContent ?? ''), { timeout: 30000 })
  check('connections: a failed test saves nothing', (await api('/api/connections')).body.home_assistant.url === 'http://homeassistant.invalid:8123')
  await shot('c1-home-assistant')
  await page.keyboard.press('Escape'); await sleep(300)
})

await step('adapters (gone)', async () => {
  await goto('/adapters'); check('old Adapters bookmark → /settings', path() === '/settings', path())
  await goto('/connections'); check('old Connections bookmark → /settings', path() === '/settings', path())
})

await step('users', async () => {
  await goto('/users')
  check('users: lists accounts, marks you', /smokeadmin/.test(await text()) && /\(you\)/.test(await text()))
  check('users: cannot delete yourself', await page.$eval('button[aria-label="Delete smokeadmin"]', (b) => b.disabled))
  await click('Add user'); await page.waitForSelector('[role=dialog]')
  await page.locator('#new-username').fill(VIEWER.u); await page.locator('#new-user-password').fill(VIEWER.p)
  await page.locator('[role=dialog] button[type=submit]').click(); await sleep(900)
  check('users: created a viewer', /viewer1/.test(await text()))
  await page.locator('[role=tab] ::-p-text(Activity)').click(); await sleep(700)
  const t = await text()
  check('users: activity log shows changes (who/what)', /Created a user/.test(t) && /Changed the device settings/.test(t) && /Signed in/.test(t) && /Tested a Home Assistant connection/.test(t), t.slice(0, 300))
  await shot('u1-users')
})

await step('mqtt + redirects', async () => {
  await goto('/mqtt')
  const t = await text()
  check('mqtt: reference lists the device topics with examples', /bedside\/config/.test(t) && /bedside\/sound/.test(t) && /bedside\/button/.test(t) && !/bedside\/status/.test(t), t.slice(0, 300))
  await goto('/tools/lines-template'); check('old card editor bookmark → home', path() === '/', path())
  await goto('/docs/mqtt'); check('old MQTT docs bookmark → /mqtt', path() === '/mqtt', path())
  await shot('m1-mqtt')
})
await signOut()

// ---------- viewer ----------
await step('viewer', async () => {
  await login(VIEWER.u, VIEWER.p)
  const nav = await page.$$eval('aside nav a', (a) => a.map((x) => x.textContent.trim()))
  check('viewer: nav hides Settings and Users', !nav.includes('Settings') && !nav.includes('Users') && nav.includes('Buttons') && nav.includes('Appearance'), nav.join(','))
  await goto('/settings'); check('viewer: /settings redirects home', path() === '/', path())
  await goto('/users'); check('viewer: /users redirects home', path() === '/', path())
  await goto('/buttons')
  check('viewer: buttons page is read-only', /read-only access/.test(await text()) && await page.$eval('button[aria-label^="Button 1:"]', (b) => b.disabled))
  const denied = await api('/api/users')
  check('viewer: API refuses admin data (403)', denied.status === 403)
  await shot('v1-viewer')

  await goto('/profile')
  await page.locator('#current-password').fill('wrong-current-password'); await page.locator('#new-password').fill(VIEWER.p2); await page.locator('#confirm-password').fill(VIEWER.p2)
  await page.locator('main button[type=submit]').click(); await sleep(700)
  check('profile: wrong current password is rejected with a message', /current password is incorrect/.test(await text()))
  await page.locator('#current-password').fill(VIEWER.p); await page.locator('#confirm-password').fill('mismatch-mismatch-1'); await page.locator('main button[type=submit]').click(); await sleep(300)
  check('profile: mismatched confirmation caught before sending', /don’t match/.test(await text()))
  await page.locator('#confirm-password').fill(VIEWER.p2); await page.locator('main button[type=submit]').click(); await sleep(900)
  check('profile: password changed', (await page.$eval('#current-password', (e) => e.value)) === '')
  await signOut()
  await login(VIEWER.u, VIEWER.p2)
  check('profile: new password works for sign-in', path() === '/', path())
  await signOut()
})

// ---------- mobile ----------
await step('mobile', async () => {
  await page.setViewport({ width: 390, height: 800, isMobile: true, hasTouch: true })
  await login(ADMIN.u, ADMIN.p)
  for (const p of ['/', '/device', '/buttons', '/actions', '/settings', '/appearance', '/users', '/mqtt', '/about', '/profile']) {
    await goto(p)
    const fits = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)
    check(`mobile: ${p} has no horizontal scroll`, fits, `scrollWidth=${await page.evaluate(() => document.documentElement.scrollWidth)}`)
  }
  await goto('/settings'); await page.locator('main button ::-p-text(Change)').click(); await page.waitForSelector('[role=dialog]'); await sleep(500)
  check('mobile: Home Assistant dialog fits the screen', await page.$eval('[role=dialog]', (d) => { const b = d.getBoundingClientRect(); return b.left >= 0 && b.right <= window.innerWidth + 1 && b.top >= 0 }))
  await shot('x1-mobile-dialog'); await page.keyboard.press('Escape')
  await goto('/buttons'); await shot('x3-mobile-buttons')
})

await t.finish()
