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
  await page.waitForFunction(() => /Adapters are polled every/.test(document.querySelector('main')?.textContent ?? ''), { timeout: 25000 })
  const t = await text()
  check('home: shows system health with MQTT + database facts', /System health/.test(t) && /Connected/.test(t) && /Available/.test(t), t.slice(0, 200))
  check('home: no adapter list (it lives on the Adapters page)', !/The services the dashboard reads from/.test(t))
  check('home: no display previews (cards are gone)', !(await page.$('[role=img][aria-label^="Display preview"]')))
  await shot('h1-home')
})

await step('actions', async () => {
  await goto('/actions')
  // The seed has no Home Assistant adapter, so nothing can run an action yet.
  check('actions: says what to add first', /Nothing can run actions yet/.test(await text()))
  check('actions: empty list', /No actions yet/.test(await text()))
  check('actions: no Add button without an adapter', !(await page.$('button ::-p-text(Add action)')))
  check('actions: API lists no action-capable adapters', (await api('/api/actions')).body.adapters.length === 0)
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

await step('adapters', async () => {
  await goto('/adapters')
  check('adapters: existing adapter listed with type + state', /adguard_main/.test(await text()) && /adguard/.test(await text()) && /(Running|Needs restart|Disabled)/.test(await text()))
  check('adapters: running adapter shows its health as text (not colour only)', /(Down|Warning|OK|Not polled yet)/.test(await text()))
  await click('Add adapter'); await page.waitForSelector('[role=dialog]')
  await page.locator('#adapter-type').click(); await page.locator('[role=option] ::-p-text(uptime_kuma)').click()
  await page.waitForFunction(() => document.querySelectorAll('[role=dialog] input[type=text]').length >= 2)   // the type's fields have rendered
  const dialogInputs = await page.$$eval('[role=dialog] input', (i) => i.length)
  check('adapters: fields for the chosen type appear', dialogInputs >= 3, String(dialogInputs))
  await page.locator('#adapter-name').fill('kuma_two')
  const inputs = await page.$$('[role=dialog] input[type=text]')   // the type's fields (name has no type attr)
  const fill = ['http://kuma.invalid:3001', 'homepage']
  for (let i = 0; i < inputs.length; i++) await inputs[i].type(fill[i] ?? 'x')
  await click('Test connection'); await page.waitForFunction(() => /Could not connect/.test(document.querySelector('[role=dialog]')?.textContent ?? ''), { timeout: 30000 })
  check('adapters: test connection reports a failure without saving anything', (await api('/api/adapters')).body.adapters.every((a) => a.name !== 'kuma_two'))
  await shot('a1-dialog')
  await page.locator('[role=dialog] button[type=submit]').click(); await sleep(900)
  const list = (await api('/api/adapters')).body
  check('adapters: added, needs a restart', list.adapters.some((a) => a.name === 'kuma_two' && a.state === 'pending') && list.restart_pending === true)
  check('adapters: restart banner shown', /Restart needed/.test(await text()))
  await page.locator('::-p-aria(Edit adguard_main)').click(); await page.waitForSelector('[role=dialog]')
  check('adapters: editing shows a stored secret as a hint, never the value', (await page.$eval('[role=dialog] input[type=password]', (e) => e.placeholder + '|' + e.value)) === 'unchanged — type to replace|')
  await click('Cancel')
  await page.locator('::-p-aria(Remove kuma_two)').click(); await page.waitForSelector('[role=alertdialog]')
  check('adapters: removal asks for confirmation', /Remove “kuma_two”\?/.test(await text('[role=alertdialog]')))
  await page.locator('[role=alertdialog] ::-p-text(Remove adapter)').click(); await sleep(900)
  check('adapters: removed', (await api('/api/adapters')).body.adapters.every((a) => a.name !== 'kuma_two'))
  await shot('a2-adapters')
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
  check('users: activity log shows changes (who/what)', /Created a user/.test(t) && /Changed the device settings/.test(t) && /Signed in/.test(t) && !/api\.remove_adapter_endpoint\s/.test(t.replace(/\s+/g,' ')+' '), t.slice(0, 300))
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
  check('viewer: nav hides Adapters and Users', !nav.includes('Adapters') && !nav.includes('Users') && nav.includes('Buttons'), nav.join(','))
  await goto('/adapters'); check('viewer: /adapters redirects home', path() === '/', path())
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
  for (const p of ['/', '/device', '/buttons', '/actions', '/adapters', '/users', '/mqtt', '/profile']) {
    await goto(p)
    const fits = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)
    check(`mobile: ${p} has no horizontal scroll`, fits, `scrollWidth=${await page.evaluate(() => document.documentElement.scrollWidth)}`)
  }
  await goto('/adapters'); await click('Add adapter'); await page.waitForSelector('[role=dialog]'); await sleep(500)
  check('mobile: add-adapter dialog fits the screen', await page.$eval('[role=dialog]', (d) => { const b = d.getBoundingClientRect(); return b.left >= 0 && b.right <= window.innerWidth + 1 && b.top >= 0 }))
  await shot('x1-mobile-dialog'); await page.keyboard.press('Escape')
  await goto('/buttons'); await shot('x3-mobile-buttons')
})

await t.finish()
