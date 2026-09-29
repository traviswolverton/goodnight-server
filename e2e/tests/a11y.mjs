/** Automated accessibility audit (axe-core, WCAG 2.1 A/AA) of every page in
 *  both themes, plus the dialogs. Any violation fails the run. */
import { AxePuppeteer } from '@axe-core/puppeteer'
import { ADMIN, sleep, start } from '../lib.mjs'

const t = await start({ bypassCSP: true })   // axe injects its own script
const { page, check, goto } = t

async function audit(label) {
  await sleep(400)
  const { violations } = await new AxePuppeteer(page).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
  for (const v of violations) {
    console.log(`  · ${v.id} (${v.impact}): ${v.help} — ${v.nodes.length} element(s)`)
    for (const n of v.nodes.slice(0, 3)) console.log(`      ${n.target.join(' ')}  ${(n.failureSummary ?? '').split('\n')[1] ?? ''}`)
  }
  check(`a11y: ${label}`, violations.length === 0, violations.map((v) => v.id).join(', '))
}

const setTheme = (theme) => page.evaluate((th) => localStorage.setItem('dd-theme', th), theme)

await goto('/login')
await setTheme('light')
await page.reload()
await audit('login (light)')

await t.login(ADMIN.u, ADMIN.p)
for (const theme of ['light', 'dark']) {
  await setTheme(theme)
  for (const p of ['/', '/device', '/buttons', '/actions', '/connections', '/users', '/mqtt', '/profile']) {
    await goto(p)
    await page.waitForFunction(() => !document.querySelector('[aria-busy=true]'), { timeout: 8000 }).catch(() => {})
    await audit(`${p} (${theme})`)
  }

  await goto('/connections')
  await page.locator('main button ::-p-text(Change)').click()
  await page.waitForSelector('[role=dialog]')
  await audit(`Home Assistant dialog (${theme})`)
  await page.keyboard.press('Escape')

  await goto('/actions')
  await page.locator('::-p-text(Add action)').click()
  await page.waitForSelector('main form')
  await audit(`action editor (${theme})`)

  await goto('/users')
  await page.locator('::-p-aria(Add user)').click()
  await page.waitForSelector('[role=dialog]')
  await audit(`add-user dialog (${theme})`)
  await page.keyboard.press('Escape')
  await page.locator('[role=tab] ::-p-text(Activity)').click()
  await audit(`activity log (${theme})`)
}

await t.finish()
