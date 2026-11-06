// Captures the real customer download flow on a LOCAL server with the synthetic customer.
// Usage (from video/): node tools/capture-screens.cjs desktop|phone <outDir>   (server at http://localhost:8787)
const { chromium } = require('playwright')
const fs = require('fs')
const [device, out] = process.argv.slice(2)
const BASE = 'http://localhost:8787'
const phone = device === 'phone'
;(async () => {
  fs.mkdirSync(out, { recursive: true })
  const b = await chromium.launch()
  const ctx = await b.newContext({ viewport: phone ? { width: 390, height: 844 } : { width: 1024, height: 700 }, deviceScaleFactor: phone ? 3 : 1.875, isMobile: phone, hasTouch: phone, acceptDownloads: true })
  const p = await ctx.newPage()
  const boxes = {}
  const box = async (name, sel) => { const bb = await p.locator(sel).first().boundingBox(); boxes[name] = bb; return bb }
  const shot = async (name) => { await p.waitForTimeout(700); await p.screenshot({ path: `${out}/${name}.png` }) }
  await p.goto(`${BASE}/#home`); await p.waitForTimeout(1500)
  // Hide the floating launcher buttons so they never cover the steps.
  await p.addStyleTag({ content: '.launchers, .launcher, [class*="launcher"], .site-footer { display: none !important; }' })
  if (phone) {
    await box('menu', 'button[aria-label*="enu" i]'); await shot('01-home')
    await p.click('button[aria-label*="enu" i]'); await p.waitForTimeout(500)
    await box('signin-link', 'nav a:has-text("Sign in"), li a:has-text("Sign in")'); await shot('02-menu')
    await p.click('li a:has-text("Sign in")')
  } else {
    await box('account-icon', '.site-header__account'); await shot('01-home')
    await p.click('.site-header__account')
  }
  await p.waitForTimeout(1000)
  await p.addStyleTag({ content: '.launchers, .launcher, [class*="launcher"], .site-footer { display: none !important; }' })
  await p.fill('input[type=email]', 'sam.taylor@example.com')
  await p.fill('input[type=password]', 'Sample-Study-2026')
  await box('signin-button', 'form button[type=submit]'); await shot('03-signin')
  await p.click('form button[type=submit]'); await p.waitForTimeout(2000)
  await p.addStyleTag({ content: '.launchers, .launcher, [class*="launcher"], .site-footer { display: none !important; }' })
  await box('downloads-tab', '.account__tabs a:has-text("My downloads")'); await shot('04-account')
  await p.click('.account__tabs a:has-text("My downloads")'); await p.waitForTimeout(1500)
  await box('download-card', '.download-card'); await box('download-button', '.download-card button:has-text("Download")'); await box('one-download-notice', '.downloads .ui-notice')
  await shot('05-downloads')
  await p.click('.download-card button:has-text("Download")'); await p.waitForTimeout(600)
  await box('confirm-dialog', '.dialog__panel'); await box('confirm-button', '.dialog__panel button:has-text("Download now")'); await shot('06-confirm')
  const [dl] = await Promise.all([p.waitForEvent('download'), p.click('.dialog__panel button:has-text("Download now")')])
  const saved = `${out}/${dl.suggestedFilename()}`; await dl.saveAs(saved)
  await p.waitForTimeout(800)
  await box('started-notice', '.downloads .ui-notice >> nth=1'); await shot('07-started')
  await p.waitForTimeout(3000); await p.reload(); await p.waitForTimeout(1500)
  await p.addStyleTag({ content: '.launchers, .launcher, [class*="launcher"], .site-footer { display: none !important; }' })
  await box('used-status', '.download-card__status'); await box('report-button', '.download-card button:has-text("Report")'); await shot('08-used')
  await p.click('.download-card button:has-text("Report")'); await p.waitForTimeout(600); await box('report-dialog', '.dialog__panel'); await shot('09-report')
  await p.keyboard.press('Escape'); await p.waitForTimeout(400)
  await p.click('.account__tabs a:has-text("Support")'); await p.waitForTimeout(1200)
  await box('support-tab', '.account__tabs a:has-text("Support")'); await box('support-form', '.support-form'); await shot('10-support')
  fs.writeFileSync(`${out}/boxes.json`, JSON.stringify({ device, viewport: p.viewportSize(), scale: phone ? 3 : 1.875, file: dl.suggestedFilename(), bytes: fs.statSync(saved).size, boxes }, null, 2))
  console.log(device, 'saved', dl.suggestedFilename(), fs.statSync(saved).size)
  await b.close()
})().catch((e) => { console.error(e); process.exit(1) })
