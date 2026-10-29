// Interaction smoke test. Run `npm run build && npx vite preview --port 4173` first,
// then `npm run smoke`. Uses the Playwright install available on the machine.
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { chromium } = require('playwright')

const BASE = process.env.BASE_URL ?? 'http://localhost:4173/'
const results = []
const check = (name, ok, detail = '') => results.push({ name, ok: Boolean(ok), detail })

const browser = await chromium.launch()
const errors = []

async function page(opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true, ...opts })
  const p = await ctx.newPage()
  p.on('pageerror', (e) => errors.push(String(e)))
  p.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  await p.goto(BASE, { waitUntil: 'networkidle' })
  return p
}

const p = await page()

// Homepage structure
check('hero headline', (await p.locator('h1').innerText()).replace(/\s+/g, ' ').trim() === 'Your nursing life, beautifully organized.')
const mask = await p.locator('.hero__art').evaluate((el) => getComputedStyle(el).maskImage || getComputedStyle(el).webkitMaskImage)
check('hero art is masked into the background', mask && mask.includes('gradient'), mask)
check('exactly two insert boxes', (await p.locator('.collection-card').count()) === 2)
check('extra cute heading above three cards', (await p.locator('#extra-title').innerText()).includes('A little extra cute') && (await p.locator('.extra-card').count()) === 3)
check('shop heading not on homepage', !(await p.content()).includes('Your next favorite download'))
check('ships labels on physical row', (await p.locator('.extra-card .label', { hasText: 'Ships to you' }).count()) === 3)
check('digital labels on insert row', (await p.locator('.collection-card .label', { hasText: 'Binder not included' }).count()) === 2)

// Finder
await p.getByRole('button', { name: 'Find your essentials' }).first().click()
check('finder opens', await p.getByRole('dialog', { name: 'Find your essentials' }).isVisible())
await p.getByRole('button', { name: /Resources for my NP journey/ }).click()
await p.getByRole('button', { name: 'Back' }).click()
check('finder back works', await p.getByRole('button', { name: /Resources for my nursing journey/ }).isVisible())
await p.keyboard.press('Escape')
check('finder closes on Escape', !(await p.locator('dialog[open]').count()))
check('focus returns to opener', await p.evaluate(() => document.activeElement?.textContent?.includes('Find your essentials')))
await p.getByRole('button', { name: 'Find your essentials' }).first().click()
await p.getByRole('button', { name: /Apparel & cute accessories/ }).click()
await p.getByRole('button', { name: /^Pens/ }).click()
await p.waitForTimeout(300)
check('finder routes to pens', (await p.evaluate(() => location.hash)) === '#pens' && (await p.locator('h1').innerText()) === 'Pretty Pens')

// Collection card
await p.goto(BASE + '#home')
await p.locator('.collection-card').first().click()
await p.waitForTimeout(300)
check('insert box opens collection', (await p.locator('h1').innerText()) === 'Nurse Binder Inserts')

// Shop filters
await p.goto(BASE + '#shop')
check('shop heading', (await p.locator('h1').innerText()) === 'Your next favorite download')
const total = await p.locator('.product-card').count()
await p.getByRole('button', { name: 'NP Binder Inserts', exact: true }).click()
const np = await p.locator('.product-card').count()
check('NP filter narrows results', np > 0 && np < total, `${np}/${total}`)
await p.fill('#shop-search', 'zzzz')
check('shop empty state', await p.getByText('Nothing matches yet').isVisible())
await p.locator('.empty-state').getByRole('button', { name: 'Clear selected filters' }).click()
check('clear filters restores', (await p.locator('.product-card').count()) === total)

// Peek inside
await p.locator('.product-card').first().getByRole('button', { name: 'Peek inside' }).click()
const counter = p.locator('.peek__counter')
const before = await counter.innerText()
await p.getByRole('button', { name: 'Next sample page' }).click()
check('peek next changes page', (await counter.innerText()) !== before, await counter.innerText())
await p.keyboard.press('Escape')

// Search
await p.getByRole('button', { name: 'Open search' }).click()
await p.keyboard.type('glaucoma')
check('search finds glaucoma', (await p.locator('.search-result').count()) >= 1)
await p.fill('#site-search', 'qwxyz')
check('search empty state', await p.getByText(/No matches for/).isVisible())
await p.getByRole('button', { name: 'Close' }).click()
check('search closes', !(await p.locator('dialog[open]').count()))

// Demo bag
await p.goto(BASE + '#product-nurse-love-tee')
await p.getByRole('button', { name: 'Add to demo bag' }).click()
check('toast confirms add', await p.getByText(/in your demo bag/).isVisible())
check('bag count updates', (await p.locator('.bag-button__count').innerText()) === '1')
await p.getByRole('button', { name: /Demo bag, 1 item/ }).click()
await p.getByRole('button', { name: 'Increase quantity' }).click()
check('quantity increases', (await p.locator('.qty__value').innerText()) === '2')
check('no fake checkout', await p.getByRole('button', { name: 'Checkout not connected' }).isDisabled())
await p.getByRole('button', { name: /Remove/ }).click()
check('remove empties bag', await p.getByText('Your demo bag is empty').isVisible())
await p.keyboard.press('Escape')

// Freebie download
await p.goto(BASE + '#freebie-corner')
await p.getByRole('button', { name: 'Preview & download' }).click()
const [dl] = await Promise.all([p.waitForEvent('download'), p.getByRole('button', { name: 'Download sample PDF' }).click()])
const path = await dl.path()
const fs = await import('node:fs')
const head = fs.readFileSync(path).subarray(0, 8).toString()
check('freebie downloads a PDF', head.startsWith('%PDF-1.4'), dl.suggestedFilename())
check('download confirmation shows', await p.getByText('Your sample is on its way').isVisible())
await p.keyboard.press('Escape')

// Mobile menu and overflow
const m = await page({ viewport: { width: 375, height: 800 }, reducedMotion: 'reduce' })
await m.getByRole('button', { name: 'Open menu' }).click()
check('mobile menu opens', await m.getByRole('dialog', { name: 'Menu' }).isVisible())
await m.getByRole('dialog', { name: 'Menu' }).getByRole('link', { name: 'Freebie Corner' }).click()
await m.waitForTimeout(200)
check('mobile menu navigates and closes', (await m.locator('h1').innerText()) === 'The Freebie Corner' && !(await m.locator('dialog[open]').count()))
for (const route of ['', '#shop', '#np-binder-inserts', '#extra-cute', '#product-glaucoma', '#product-heart-drop-earrings', '#our-story', '#help', '#nope']) {
  await m.goto(BASE + route)
  await m.waitForTimeout(150)
  const over = await m.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  check(`no horizontal overflow at 375px ${route || 'home'}`, over <= 0, String(over))
}
await m.goto(BASE + '#home')
const float = await m.locator('.hero__tablet-svg').evaluate((el) => getComputedStyle(el).animationDuration)
check('reduced motion shortens animation', float === '0.001s' || float === '1ms', float)

check('no console errors', errors.length === 0, errors.join(' | '))

await browser.close()
let failed = 0
for (const r of results) {
  if (!r.ok) failed++
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? `  (${r.detail})` : ''}`)
}
console.log(`\n${results.length - failed}/${results.length} checks passed`)
process.exit(failed ? 1 : 0)
