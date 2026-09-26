/** Every page, as an admin and as a viewer: real clicks against the real
 *  image. Mutates state (creates a viewer, edits cards...) so it expects a
 *  fresh stack — run.sh provides one. */
import { ADMIN, VIEWER, sleep, start } from '../lib.mjs'

const t = await start()
const { page, check, shot, settle, path, text, click, api, step, goto, login, signOut } = t

// ---------- admin ----------
await login(ADMIN.u, ADMIN.p)
await step('home', async () => {
  await goto('/')
  await page.waitForFunction(() => /Down|Warning|OK/.test(document.querySelector('main')?.textContent ?? '') && document.querySelectorAll('[role=img][aria-label^="Display preview"]').length > 0, { timeout: 25000 })
  const t = await text()
  check('home: shows system health with MQTT + database facts', /System health/.test(t) && /Connected/.test(t) && /Available/.test(t), t.slice(0, 200))
  check('home: no adapter list (it lives on the Adapters page)', !/The services the dashboard reads from/.test(t))
  const previews = await page.$$eval('[role=img][aria-label^="Display preview"]', (els) => els.map((e) => e.getAttribute('aria-label')))
  check('home: "On the display" previews each card (3 seeded)', previews.length >= 2, JSON.stringify(previews))
  const boxes = await page.$$eval('[role=img][aria-label^="Display preview"]', (els) => els.map((e) => { const r = e.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.right), Math.round(r.top)] }))
  const overlaps = boxes.some((a, i) => boxes.some((b, j) => i < j && a[2] === b[2] && a[1] > b[0]))
  check('home: card previews sit side by side without overlapping', boxes.length >= 2 && !overlaps, JSON.stringify(boxes))
  check('home: pixel strip shown', !!(await page.$('[role=img][aria-label="Indicator pixels"]')))
  await shot('h1-home')
})

await step('cards', async () => {
  await goto('/cards')
  const rows = await page.$$eval('ol[aria-label="Cards, in display order"] > li', (o) => o.map((x) => x.textContent))
  check('cards: list shows all 3 cards in order, hidden one marked', rows.length === 3 && rows.some((t) => /hidden from display/.test(t)), JSON.stringify(rows))
  const order = async () => (await api('/api/cards')).body.cards.map((c) => c.name)
  const before = await order()
  await page.focus(`button[aria-label^="Move ${before[0]},"]`)
  await page.keyboard.press('Space'); await sleep(150); await page.keyboard.press('ArrowDown'); await sleep(150); await page.keyboard.press('Space'); await sleep(900)
  check('cards: dragging (by keyboard) saves the new order', JSON.stringify(await order()) === JSON.stringify([before[1], before[0], ...before.slice(2)]), JSON.stringify(await order()))
  await page.focus(`button[aria-label^="Move ${before[0]},"]`)   // and drag it back
  await page.keyboard.press('Space'); await sleep(150); await page.keyboard.press('ArrowUp'); await sleep(150); await page.keyboard.press('Space'); await sleep(900)
  check('cards: dragging it back restores the order', JSON.stringify(await order()) === JSON.stringify(before), JSON.stringify(await order()))
  await page.locator('ol[aria-label="Cards, in display order"] button ::-p-text(Card 2)').click(); await settle()
  check('cards: selecting a card is reflected in the URL (linkable)', /card=Card(%20|\+)2/.test(path()), path())

  await page.locator('#title-input').fill('My Card Two'); await sleep(200)
  check('cards: an edit shows as unsaved', /Unsaved: title/.test(await text()))
  await page.locator('ol[aria-label="Cards, in display order"] button ::-p-text(Card 1)').click(); await sleep(300)
  check('cards: switching cards with unsaved edits asks first', /Discard your unsaved changes\?/.test(await text('[role=alertdialog]')))
  await click('Cancel'); await sleep(300)
  check('cards: cancelling keeps you on the card, edit intact', /card=Card(%20|\+)2/.test(path()) && (await page.$eval('#title-input', (e) => e.value)) === 'My Card Two', path())
  await click('Save card and apply'); await sleep(700)
  check('cards: title saved through the API', (await api('/api/cards')).body.cards.find((c) => c.name === 'Card 2').title_override === 'My Card Two')

  await page.locator('#line-input-0').fill("{{ 'hello' }}")
  await page.locator('#line-input-2').fill("{{ 'x' * 30 }}"); await sleep(900) // previews by itself as you type
  const t = await text()
  check('cards: each line shows its own result and count', /→ hello/.test(t) && /5 \/ 24/.test(t) && /blank row/.test(t), t.slice(-400))
  check('cards: a too-wide line says it scrolls', /30 \/ 74 · scrolls/.test(t), t.slice(-400))
  check('cards: display preview reflects the lines, blank middle row included', /hello\. \. x{30}/.test(await page.$eval('[role=img][aria-label^="Display preview"]', (e) => e.getAttribute('aria-label'))))
  await shot('c0-cards-lines')
  await click('Insert an icon in line 2'); await page.waitForSelector('[aria-label="Filter icons"]')
  await page.locator('[aria-label="Filter icons"]').fill('wif'); await sleep(200)
  await shot('c0-cards-icon-picker')
  await page.locator('[role=dialog] button ::-p-text(wifi)').click(); await sleep(900)
  check('cards: picking an icon inserts icon() into the line', (await page.$eval('#line-input-1', (e) => e.value)) === "{{ icon('wifi') }}")
  check('cards: the icon is drawn in the result and the display preview', /\(wifi\)/.test(await page.$eval('[role=img][aria-label^="Display preview"]', (e) => e.getAttribute('aria-label'))) && !!(await page.$('main [role=img][aria-label=wifi]')))
  await page.locator('#line-input-1').fill("{{ icon('wifi') }} 71 up {{ icon('lock') }} 3"); await sleep(900)
  await page.$eval('[role=img][aria-label^="Display preview"]', (e) => e.scrollIntoView({ block: 'start' }))
  await shot('c0-cards-icons')
  await page.click('#line-input-1', { count: 3 }); await page.keyboard.press('Backspace'); await sleep(900)
  await click('Insert a variable in line 4'); await page.waitForSelector('[role=dialog] [aria-label="Filter variables"]')
  await page.locator('[role=dialog] button ::-p-text(adguard_main)').click(); await sleep(200)
  await shot('c0-cards-variables')
  await click('Insert adapters.adguard_main.status'); await sleep(300)
  check('cards: a variable is inserted into the line it was opened for', (await page.$eval('#line-input-3', (e) => e.value)) === '{{ adapters.adguard_main.status }}')
  check('cards: the variables panel stays open for more', !!(await page.$('[role=dialog] [aria-label="Filter variables"]')))
  await page.keyboard.press('Escape'); await sleep(300)
  await page.click('#line-input-3', { count: 3 }); await page.keyboard.press('Backspace'); await sleep(900)
  await click('Save card and apply'); await sleep(700)
  check('cards: text saved in place, blank middle line kept', JSON.stringify((await api('/api/cards')).body.cards.find((c) => c.name === 'Card 2').lines_template) === '["{{ \'hello\' }}","","{{ \'x\' * 30 }}"]')

  await page.evaluate(() => window.scrollTo(0, 700)); await sleep(200)
  const top = await page.$eval('[role=img][aria-label^="Display preview"]', (e) => Math.round(e.getBoundingClientRect().top))
  check('cards: display preview stays in view while scrolling', top >= 56 && top < 120, String(top))
  await shot('c0-cards-scrolled')
  await page.evaluate(() => window.scrollTo(0, 0))

  await page.locator('#line-input-0').fill('{{ broken '); await sleep(900)
  check('cards: a template error is shown clearly, not thrown away', /ERROR:/.test(await text()))

  await page.locator('#line-input-0').fill("{{ 'hello' }}")   // back to a line that renders
  await page.locator('#status-template-input').fill("{{ 'warn' }}"); await sleep(900)
  check('cards: status previews as you type', /Warning/.test(await text()))
  await click('Save card and apply'); await sleep(700)
  check('cards: status saved', (await api('/api/cards')).body.cards.find((c) => c.name === 'Card 2').status_template === "{{ 'warn' }}")
  // Selected in place rather than clicked: the save's toast can sit over the field.
  await page.$eval('#status-template-input', (e) => { e.focus(); e.select() }); await page.keyboard.press('Backspace'); await sleep(300)
  await click('Save card and apply'); await sleep(700)
  check('cards: status cleared', (await api('/api/cards')).body.cards.find((c) => c.name === 'Card 2').status_template === null)

  await page.locator('#render-toggle').click(); await sleep(700)
  check('cards: "show on display" toggle persists', (await api('/api/cards')).body.cards.find((c) => c.name === 'Card 2').render === false)
  await page.locator('#render-toggle').click(); await sleep(700)
  await click('Clear all lines'); await sleep(300); await click('Save card and apply'); await sleep(700)
  check('cards: clear reverts to just the title', (await api('/api/cards')).body.cards.find((c) => c.name === 'Card 2').lines_template === null)
  await shot('c1-cards')
})

await step('pixels', async () => {
  await goto('/pixels')
  check('pixels: 5 pixel tiles', (await page.$$('[role=group][aria-label=Pixels] button')).length === 5)
  await page.locator('[role=group][aria-label=Pixels] button ::-p-text(Pixel 1)').click(); await settle()
  check('pixels: selection in URL', /pixel=1/.test(path()), path())
  await page.locator('::-p-aria(Use green (#1D9E75))').click()
  check('pixels: clicking a swatch fills the template', (await page.$eval('#pixel-template-input', (e) => e.value)) === '#1D9E75')
  await click('Preview'); await sleep(700)
  check('pixels: preview resolves the colour', /#1D9E75/.test(await text()))
  await click('Save & apply'); await sleep(700)
  check('pixels: saved (resolved colour live)', (await api('/api/pixels')).body.pixels.find((p) => p.index === 1).resolved_color === '#1D9E75')
  await page.locator('#pixel-template-input').fill('not a colour'); await click('Preview'); await sleep(700)
  check('pixels: a non-colour result is flagged as "pixel would be off"', /would be off/.test(await text()))
  await click('Clear (turn off)'); await sleep(700)
  check('pixels: cleared', (await api('/api/pixels')).body.pixels.find((p) => p.index === 1).resolved_color === null)
  await shot('p1-pixels')
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
  check('users: activity log shows changes (who/what)', /Created a user/.test(t) && /Saved a pixel’s colour|Saved a card’s title|Showed or hid a card/.test(t) && /Signed in/.test(t) && !/api\.remove_adapter_endpoint\s/.test(t.replace(/\s+/g,' ')+' '), t.slice(0, 300))
  await shot('u1-users')
})

await step('mqtt + redirects', async () => {
  await goto('/mqtt')
  const t = await text()
  check('mqtt: reference shows topics, live example, limits', /homelab\/status/.test(t) && /homelab\/alert\/camera/.test(t) && /Client display limits/.test(t) && /23 characters/.test(t))
  await goto('/tools/lines-template'); check('old editor bookmark → /cards', path().startsWith('/cards'), path())
  await goto('/docs/mqtt'); check('old MQTT docs bookmark → /mqtt', path() === '/mqtt', path())
  await shot('m1-mqtt')
})
await signOut()

// ---------- viewer ----------
await step('viewer', async () => {
  await login(VIEWER.u, VIEWER.p)
  const nav = await page.$$eval('aside nav a', (a) => a.map((x) => x.textContent.trim()))
  check('viewer: nav hides Adapters and Users', !nav.includes('Adapters') && !nav.includes('Users') && nav.includes('Cards'), nav.join(','))
  await goto('/adapters'); check('viewer: /adapters redirects home', path() === '/', path())
  await goto('/users'); check('viewer: /users redirects home', path() === '/', path())
  await goto('/cards')
  check('viewer: cards page is read-only', /read-only access/.test(await text()) && !(await page.$('::-p-aria(Save card and apply)')) && await page.$eval('#title-input', (e) => e.disabled))
  await sleep(600)   // lines preview on their own when the card opens
  check('viewer: sees the live preview', !!(await page.$('[role=img][aria-label^="Display preview"]')))
  await click('Browse variables'); await page.waitForSelector('[role=dialog] [aria-label="Filter variables"]')
  check('viewer: can browse variables, to copy rather than insert', /copies one/.test(await text('[role=dialog]')))
  await page.keyboard.press('Escape'); await sleep(200)
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
  for (const p of ['/', '/cards', '/pixels', '/adapters', '/users', '/mqtt', '/profile']) {
    await goto(p)
    const fits = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)
    check(`mobile: ${p} has no horizontal scroll`, fits, `scrollWidth=${await page.evaluate(() => document.documentElement.scrollWidth)}`)
  }
  await goto('/adapters'); await click('Add adapter'); await page.waitForSelector('[role=dialog]'); await sleep(500)
  check('mobile: add-adapter dialog fits the screen', await page.$eval('[role=dialog]', (d) => { const b = d.getBoundingClientRect(); return b.left >= 0 && b.right <= window.innerWidth + 1 && b.top >= 0 }))
  await shot('x1-mobile-dialog'); await page.keyboard.press('Escape')
  await goto('/cards'); await shot('x2-mobile-cards')
})

await t.finish()
