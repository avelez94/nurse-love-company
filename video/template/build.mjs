#!/usr/bin/env node
/*
  Nurse Love Company tutorial video template.

  Turns tutorials/<slug>/tutorial.json (the script: scenes, words, screenshots,
  focus areas and highlight targets) into a HyperFrames project in
  build/<slug>/, plus captions (WebVTT) and a text transcript in
  tutorials/<slug>/out/.

      node template/build.mjs download-and-save

  The generated project is ordinary HyperFrames source: preview it, check it,
  render it, or open it in the HyperFrames desktop app. If you edit the
  generated files by hand, do not rebuild over them; edit tutorial.json and
  rebuild instead when you want the template to own the change.

  Scene kinds
    title    big title card (intro and outro)
    screen   step text on the left, a real screenshot on the right that
             moves from the whole screen to the part that matters, then a
             soft highlight and (optionally) a cursor or fingertip on the target
    rule     an important rule, set large, before a demonstration
    devices  side by side cards for computer, iPhone or iPad, and Android

  Timing is calm by design: every line holds for at least 0.6 s plus 0.36 s a
  word after it appears, and each scene adds time for its demonstration.
*/
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const slug = process.argv[2]
if (!slug) {
  console.error('Usage: node template/build.mjs <tutorial-slug>')
  process.exit(1)
}
const srcDir = join(root, 'tutorials', slug)
const t = JSON.parse(readFileSync(join(srcDir, 'tutorial.json'), 'utf8'))
const screens = JSON.parse(readFileSync(join(srcDir, 'screens', 'screens.json'), 'utf8'))
const out = join(root, 'build', slug)
const W = 1920
const H = 1080
const FPS = 30

/* ---------- Brand (matches src/styles/tokens.css on the website) ---------- */
const brand = {
  ivory: '#fffaf6',
  blush: '#fff0f2',
  pink: '#fbdde5',
  pinkDeep: '#f6c9d6',
  raspberry: '#d80853',
  burgundy: '#680c35',
  burgundySoft: '#7d3a55',
  border: '#efd8df',
  muted: '#8a5a6c',
  shadow: '104 12 53',
}

/* ---------- Layout ---------- */
const PANEL = { x: 110, y: 120, w: 520 }
const CARD = { x: 690, y: 110, w: 1134, h: 860 }

/* ---------- Helpers ---------- */
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const words = (s) => String(s).trim().split(/\s+/).filter(Boolean).length
const round = (n) => Math.round(n * 1000) / 1000
const hold = (line) => 0.6 + 0.36 * words(line)
/** A line may carry <strong> for emphasis; captions and timing use the plain text. */
const plain = (l) => String(l.text ?? l).replace(/<[^>]+>/g, '').replace(/&amp;/g, '&')
const rich = (l) => {
  const raw = String(l.text ?? l)
  // Only <strong> is allowed through; everything else is escaped.
  return esc(raw).replace(/&lt;(\/?)strong&gt;/g, '<$1strong>')
}

/** Fit a focus rectangle of an image into the card, clamped so no empty edge shows. */
function frame(img, rect) {
  const [rx, ry, rw, rh] = rect
  const s = Math.min(CARD.w / rw, CARD.h / rh)
  let tx = CARD.w / 2 - s * (rx + rw / 2)
  let ty = CARD.h / 2 - s * (ry + rh / 2)
  const sw = s * img.w
  const sh = s * img.h
  tx = sw >= CARD.w ? Math.min(0, Math.max(CARD.w - sw, tx)) : (CARD.w - sw) / 2
  ty = sh >= CARD.h ? Math.min(0, Math.max(CARD.h - sh, ty)) : (CARD.h - sh) / 2
  return { s: round(s), x: round(tx), y: round(ty) }
}
const wide = (img) => frame(img, [0, 0, img.w, img.h])

/** Where an image rectangle lands in the card for a given framing. */
const place = (f, [x, y, w, h]) => ({ x: round(f.s * x + f.x), y: round(f.s * y + f.y), w: round(f.s * w), h: round(f.s * h) })

function fontFaces() {
  return `
    @font-face { font-family: 'DM Serif Display'; src: url('assets/fonts/dm-serif-display-latin-400-normal.woff2') format('woff2'); font-weight: 400; font-style: normal; }
    @font-face { font-family: 'Nunito Sans'; src: url('assets/fonts/nunito-sans-latin-400-normal.woff2') format('woff2'); font-weight: 400; font-style: normal; }
    @font-face { font-family: 'Nunito Sans'; src: url('assets/fonts/nunito-sans-latin-600-normal.woff2') format('woff2'); font-weight: 600; font-style: normal; }
    @font-face { font-family: 'Nunito Sans'; src: url('assets/fonts/nunito-sans-latin-700-normal.woff2') format('woff2'); font-weight: 700; font-style: normal; }
    @font-face { font-family: 'Nunito Sans'; src: url('assets/fonts/nunito-sans-latin-800-normal.woff2') format('woff2'); font-weight: 800; font-style: normal; }`
}

/** Shared scene styles. Every id is prefixed with the scene id so pages never collide. */
function baseStyles(id) {
  return `${fontFaces()}
    #root { position: absolute; inset: 0; background: ${brand.ivory}; font-family: 'Nunito Sans', sans-serif; color: ${brand.burgundy}; overflow: hidden; }
    #${id}-ground { position: absolute; inset: 0; background: linear-gradient(90deg, ${brand.ivory} 0%, ${brand.ivory} 30%, ${brand.blush} 30%, ${brand.blush} 100%); }
    #${id}-stage { position: absolute; inset: 0; }
    .${id}-progress { position: absolute; left: ${PANEL.x}px; top: 64px; display: flex; gap: 10px; }
    .${id}-progress span { width: 44px; height: 8px; border-radius: 4px; background: ${brand.pinkDeep}; }
    .${id}-progress span.on { background: ${brand.raspberry}; }
    .${id}-panel { position: absolute; left: ${PANEL.x}px; top: ${PANEL.y + 40}px; width: ${PANEL.w}px; }
    .${id}-stepno { font-family: 'DM Serif Display', serif; color: ${brand.raspberry}; font-size: 132px; line-height: 0.9; }
    .${id}-stepof { font-weight: 700; font-size: 30px; color: ${brand.muted}; margin: 6px 0 22px; letter-spacing: 0.02em; }
    .${id}-title { font-family: 'DM Serif Display', serif; font-weight: 400; font-size: 66px; line-height: 1.04; margin: 0 0 26px; color: ${brand.burgundy}; }
    .${id}-device { display: inline-block; font-weight: 800; font-size: 28px; color: ${brand.raspberry}; background: #fff; border: 3px solid ${brand.pinkDeep}; border-radius: 999px; padding: 8px 22px; margin-bottom: 24px; }
    .${id}-line { font-size: 38px; line-height: 1.3; margin: 0 0 22px; color: ${brand.burgundy}; }
    .${id}-line strong { color: ${brand.raspberry}; font-weight: 800; }
    .${id}-note { font-size: 30px; line-height: 1.35; color: ${brand.burgundySoft}; }
    #${id}-card { position: absolute; left: ${CARD.x}px; top: ${CARD.y}px; width: ${CARD.w}px; height: ${CARD.h}px; border-radius: 28px; background: #fff; overflow: hidden; box-shadow: 0 0 0 2px ${brand.border}, 0 24px 60px rgb(${brand.shadow} / 0.16); }
    #${id}-cam { position: absolute; left: 0; top: 0; transform-origin: 0 0; }
    #${id}-cam img { display: block; }
    #${id}-hl { position: absolute; border-radius: 18px; border: 5px solid ${brand.raspberry}; box-shadow: 0 0 0 9px rgb(216 8 83 / 0.16); }
    #${id}-cursor { position: absolute; left: 0; top: 0; width: 56px; height: 56px; }
    #${id}-touch { position: absolute; left: 0; top: 0; width: 78px; height: 78px; margin: -39px 0 0 -39px; border-radius: 50%; background: rgb(216 8 83 / 0.28); border: 4px solid #fff; box-shadow: 0 0 0 3px rgb(216 8 83 / 0.55); }`
}

function progress(id, n, total) {
  if (!n) return ''
  return `<div class="${id}-progress" aria-hidden="true">${Array.from({ length: total }, (_, i) => `<span class="${i < n ? 'on' : ''}"></span>`).join('')}</div>`
}

/* ---------- Scene builders: each returns { html, duration, cues } ---------- */

function sceneTitle(sc, id) {
  const lines = [sc.title, sc.subtitle].filter(Boolean)
  const reveal = 0.5
  const duration = sc.duration ?? round(reveal + 0.5 + lines.reduce((a, l) => a + hold(l), 0) + 1.2)
  const html = `
  <style>${baseStyles(id)}
    #${id}-ground { background: ${brand.blush}; }
    .${id}-wrap { position: absolute; left: 180px; right: 180px; top: 300px; }
    .${id}-eyebrow { font-weight: 800; font-size: 30px; letter-spacing: 0.14em; text-transform: uppercase; color: ${brand.raspberry}; margin-bottom: 26px; }
    .${id}-big { font-family: 'DM Serif Display', serif; font-weight: 400; font-size: 104px; line-height: 1.02; color: ${brand.burgundy}; margin: 0 0 34px; max-width: 1400px; }
    .${id}-sub { font-size: 42px; line-height: 1.3; color: ${brand.burgundySoft}; max-width: 1300px; }
    .${id}-heart { position: absolute; right: 200px; top: 230px; width: 120px; height: 120px; }
  </style>
  <div id="${id}-ground"></div>
  <div id="${id}-stage" data-hold>
    <svg class="${id}-heart" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 8.3a4.3 4.3 0 0 1 7.5 2.5C19.5 16.4 12 21 12 21z" fill="none" stroke="${brand.raspberry}" stroke-width="1.6" stroke-linejoin="round"/></svg>
    <div class="${id}-wrap">
      ${sc.eyebrow ? `<div id="${id}-l0" class="${id}-eyebrow">${esc(sc.eyebrow)}</div>` : ''}
      <h1 id="${id}-l1" class="${id}-big">${esc(sc.title)}</h1>
      ${sc.subtitle ? `<p id="${id}-l2" class="${id}-sub">${esc(sc.subtitle)}</p>` : ''}
    </div>
  </div>`
  const ids = [sc.eyebrow && `${id}-l0`, `${id}-l1`, sc.subtitle && `${id}-l2`].filter(Boolean)
  const tweens = ids.map((el, i) => `tl.fromTo('#${el}', { opacity: 0, filter: 'blur(8px)' }, { opacity: 1, filter: 'blur(0px)', duration: 0.5, ease: 'power3.out' }, ${round(reveal + i * 0.45)});`)
  const cues = [{ start: reveal, end: duration - 0.2, text: [sc.title, sc.subtitle].filter(Boolean).map((l) => (/[.!?]$/.test(l) ? l : `${l}.`)).join(' ') }]
  return { html, duration, cues, tweens }
}

function textLines(id, sc, startAt) {
  // Lines appear one after another, each fully readable before the next.
  let at = startAt
  const parts = []
  const tweens = []
  const cues = []
  ;(sc.lines ?? []).forEach((line, i) => {
    const el = `${id}-t${i}`
    parts.push(`<p id="${el}" class="${id}-line">${rich(line)}</p>`)
    tweens.push(`tl.fromTo('#${el}', { opacity: 0, filter: 'blur(6px)' }, { opacity: 1, filter: 'blur(0px)', duration: 0.45, ease: 'power3.out' }, ${round(at)});`)
    const text = plain(line)
    cues.push({ start: at, text })
    at += hold(text) + 0.35
  })
  return { parts, tweens, cues, end: at }
}

function sceneScreen(sc, id, total) {
  const img = screens[sc.image]
  if (!img) throw new Error(`Scene ${id}: unknown image ${sc.image}`)
  const device = sc.image.startsWith('phone') ? 'phone' : 'desktop'
  const boxes = screens[`${device}-boxes`]
  const target = sc.target ? (Array.isArray(sc.target) ? sc.target : boxes[sc.target]) : null
  if (sc.target && !target) throw new Error(`Scene ${id}: unknown target ${sc.target}`)
  const f0 = wide(img)
  const f1 = frame(img, sc.focus)
  const titleAt = 0.35
  const linesStart = 1.0
  const text = textLines(id, sc, linesStart)
  const camAt = 0.9
  const camDur = 1.5
  const actAt = camAt + camDur + 0.3
  const cursorKind = sc.cursor === false ? null : device === 'phone' ? 'touch' : 'cursor'
  const travel = 1.2
  const arrive = actAt + 0.2 + travel
  const demoEnd = cursorKind ? arrive + 0.6 : actAt + 0.6
  const duration = sc.duration ?? round(Math.max(text.end, demoEnd) + (sc.extraHold ?? 1.6))
  const hl = target ? place(f1, target) : null
  const pad = device === 'phone' ? 10 : 12
  const hlBox = hl ? { x: hl.x - pad, y: hl.y - pad, w: hl.w + pad * 2, h: hl.h + pad * 2 } : null
  const tx = hl ? hl.x + hl.w / 2 : 0
  const ty = hl ? hl.y + hl.h / 2 : 0
  const from = { x: CARD.w - 140, y: CARD.h - 110 }
  const html = `
  <style>${baseStyles(id)}
    ${hlBox ? `#${id}-hl { left: ${hlBox.x}px; top: ${hlBox.y}px; width: ${hlBox.w}px; height: ${hlBox.h}px; }` : ''}
  </style>
  <div id="${id}-ground"></div>
  <div id="${id}-stage" data-hold>
    ${progress(id, sc.step, total)}
    <div class="${id}-panel">
      ${sc.step ? `<div id="${id}-no" class="${id}-stepno">${sc.step}</div><div class="${id}-stepof">Step ${sc.step} of ${total}</div>` : ''}
      <h2 id="${id}-title" class="${id}-title">${esc(sc.title)}</h2>
      ${sc.device ? `<div id="${id}-device" class="${id}-device">${esc(sc.device)}</div>` : ''}
      ${text.parts.join('\n      ')}
    </div>
    <div id="${id}-card" role="img" aria-label="${esc(sc.alt ?? sc.title)}">
      <div id="${id}-cam"><img src="assets/screens/${sc.image}.webp" width="${img.w}" height="${img.h}" alt="" /></div>
      ${hlBox ? `<div id="${id}-hl"></div>` : ''}
      ${cursorKind === 'cursor' ? `<svg id="${id}-cursor" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 3l14 8.2-6.1 1.3 3.4 6.6-2.6 1.3-3.4-6.6L5 18z" fill="#fff" stroke="${brand.burgundy}" stroke-width="1.5" stroke-linejoin="round"/></svg>` : ''}
      ${cursorKind === 'touch' ? `<div id="${id}-touch"></div>` : ''}
    </div>
  </div>`
  const tweens = [
    `tl.fromTo('#${id}-title', { opacity: 0, filter: 'blur(8px)' }, { opacity: 1, filter: 'blur(0px)', duration: 0.5, ease: 'power3.out' }, ${titleAt});`,
    sc.step ? `tl.fromTo('#${id}-no', { opacity: 0 }, { opacity: 1, duration: 0.5, ease: 'power2.out' }, 0.2);` : '',
    sc.device ? `tl.fromTo('#${id}-device', { opacity: 0 }, { opacity: 1, duration: 0.4, ease: 'power2.out' }, ${round(titleAt + 0.3)});` : '',
    ...text.tweens,
    // One camera move: the whole screen, then the part that matters.
    `tl.fromTo('#${id}-cam', { x: ${f0.x}, y: ${f0.y}, scale: ${f0.s} }, { x: ${f1.x}, y: ${f1.y}, scale: ${f1.s}, duration: ${camDur}, ease: 'power2.inOut' }, ${camAt});`,
    hlBox ? `tl.fromTo('#${id}-hl', { opacity: 0, scale: 1.04 }, { opacity: 1, scale: 1, duration: 0.45, ease: 'power3.out' }, ${round(cursorKind ? arrive - 0.05 : actAt)});` : '',
  ]
  if (cursorKind === 'cursor') {
    tweens.push(
      // One tween per property: fade in, travel, then a small press and release.
      `tl.fromTo('#${id}-cursor', { opacity: 0 }, { opacity: 1, duration: 0.25, ease: 'power1.out' }, ${round(actAt)});`,
      `tl.fromTo('#${id}-cursor', { x: ${from.x}, y: ${from.y} }, { x: ${round(tx - 10)}, y: ${round(ty - 8)}, duration: ${travel}, ease: 'power2.inOut' }, ${round(actAt + 0.2)});`,
      `tl.fromTo('#${id}-cursor', { scale: 1 }, { scale: 0.86, duration: 0.12, ease: 'power2.in' }, ${round(arrive)});`,
      `tl.fromTo('#${id}-cursor', { scale: 0.86 }, { scale: 1, duration: 0.2, ease: 'power2.out', immediateRender: false }, ${round(arrive + 0.12)});`,
    )
  }
  if (cursorKind === 'touch') {
    tweens.push(
      `tl.fromTo('#${id}-touch', { opacity: 0 }, { opacity: 1, duration: 0.25, ease: 'power1.out' }, ${round(actAt)});`,
      `tl.fromTo('#${id}-touch', { x: ${from.x}, y: ${from.y} }, { x: ${round(tx)}, y: ${round(ty)}, duration: ${travel}, ease: 'power2.inOut' }, ${round(actAt + 0.2)});`,
      `tl.fromTo('#${id}-touch', { scale: 1 }, { scale: 0.8, duration: 0.14, ease: 'power2.in' }, ${round(arrive)});`,
      `tl.fromTo('#${id}-touch', { scale: 0.8 }, { scale: 1, duration: 0.22, ease: 'power2.out', immediateRender: false }, ${round(arrive + 0.14)});`,
    )
  }
  const cues = [{ header: true, start: titleAt, text: `${sc.step ? `Step ${sc.step}: ` : ''}${sc.title}${sc.device && /^On /.test(sc.device) ? `, ${sc.device.toLowerCase()}` : ''}.` }, ...text.cues]
  return { html, duration, cues, tweens: tweens.filter(Boolean) }
}

function sceneRule(sc, id, total) {
  const text = textLines(id, sc, 1.1)
  const duration = sc.duration ?? round(text.end + (sc.extraHold ?? 1.8))
  const html = `
  <style>${baseStyles(id)}
    #${id}-ground { background: ${brand.blush}; }
    .${id}-panel { width: 1500px; top: ${PANEL.y + 40}px; }
    .${id}-rulecard { position: absolute; left: ${PANEL.x}px; right: ${PANEL.x}px; top: 420px; background: #fff; border-radius: 28px; padding: 48px 60px 26px; box-shadow: 0 0 0 2px ${brand.border}, 0 24px 60px rgb(${brand.shadow} / 0.12); }
    .${id}-line { font-size: 44px; margin-bottom: 28px; }
  </style>
  <div id="${id}-ground"></div>
  <div id="${id}-stage" data-hold>
    ${progress(id, sc.step, total)}
    <div class="${id}-panel">
      ${sc.step ? `<div class="${id}-stepof" style="margin:0 0 14px">Step ${sc.step} of ${total}</div>` : ''}
      <h2 id="${id}-title" class="${id}-title" style="font-size:84px">${esc(sc.title)}</h2>
    </div>
    <div id="${id}-rulecard" class="${id}-rulecard">
      ${text.parts.join('\n      ')}
    </div>
  </div>`
  const tweens = [
    `tl.fromTo('#${id}-title', { opacity: 0, filter: 'blur(8px)' }, { opacity: 1, filter: 'blur(0px)', duration: 0.5, ease: 'power3.out' }, 0.35);`,
    `tl.fromTo('#${id}-rulecard', { opacity: 0 }, { opacity: 1, duration: 0.4, ease: 'power2.out' }, 0.9);`,
    ...text.tweens,
  ]
  return { html, duration, cues: [{ header: true, start: 0.35, text: `${sc.step ? `Step ${sc.step}: ` : ''}${sc.title}.` }, ...text.cues], tweens }
}

const deviceIcons = {
  computer: `<svg viewBox="0 0 48 48" aria-hidden="true"><rect x="7" y="9" width="34" height="23" rx="3" fill="none" stroke="currentColor" stroke-width="3"/><path d="M3 38h42" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg>`,
  phone: `<svg viewBox="0 0 48 48" aria-hidden="true"><rect x="14" y="4" width="20" height="40" rx="4" fill="none" stroke="currentColor" stroke-width="3"/><path d="M21 38h6" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg>`,
}

function sceneDevices(sc, id, total) {
  const startAt = 1.1
  let at = startAt
  const cards = []
  const tweens = [`tl.fromTo('#${id}-title', { opacity: 0, filter: 'blur(8px)' }, { opacity: 1, filter: 'blur(0px)', duration: 0.5, ease: 'power3.out' }, 0.35);`]
  const cues = [{ header: true, start: 0.35, text: `${sc.step ? `Step ${sc.step}: ` : ''}${sc.title}.` }]
  if (sc.intro) {
    tweens.push(`tl.fromTo('#${id}-intro', { opacity: 0 }, { opacity: 1, duration: 0.45, ease: 'power2.out' }, 0.8);`)
    cues.push({ start: 0.8, text: sc.intro })
    at += hold(sc.intro)
  }
  sc.devices.forEach((d, i) => {
    const el = `${id}-d${i}`
    cards.push(`<div id="${el}" class="${id}-dev"><div class="${id}-devhead">${deviceIcons[d.icon] ?? ''}<span>${esc(d.label)}</span></div>${d.lines.map((l) => `<p class="${id}-devline">${rich(l)}</p>`).join('')}</div>`)
    tweens.push(`tl.fromTo('#${el}', { opacity: 0, filter: 'blur(6px)' }, { opacity: 1, filter: 'blur(0px)', duration: 0.5, ease: 'power3.out' }, ${round(at)});`)
    const text = `${d.label}: ${d.lines.map(plain).join(' ')}`
    cues.push({ start: at, text })
    at += hold(d.lines.map(plain).join(' ')) + 0.4
  })
  if (sc.footer) {
    tweens.push(`tl.fromTo('#${id}-foot', { opacity: 0 }, { opacity: 1, duration: 0.45, ease: 'power2.out' }, ${round(at)});`)
    cues.push({ start: at, text: plain(sc.footer) })
    at += hold(plain(sc.footer))
  }
  const duration = sc.duration ?? round(at + (sc.extraHold ?? 1.8))
  const html = `
  <style>${baseStyles(id)}
    #${id}-ground { background: ${brand.blush}; }
    .${id}-head { position: absolute; left: ${PANEL.x}px; right: ${PANEL.x}px; top: ${PANEL.y + 40}px; }
    .${id}-intro { font-size: 36px; line-height: 1.3; color: ${brand.burgundySoft}; margin: 0; max-width: 1500px; }
    .${id}-row { position: absolute; left: ${PANEL.x}px; right: ${PANEL.x}px; top: 430px; display: grid; grid-template-columns: repeat(${sc.devices.length}, 1fr); gap: 34px; }
    .${id}-dev { background: #fff; border-radius: 26px; padding: 34px 36px 16px; box-shadow: 0 0 0 2px ${brand.border}, 0 18px 44px rgb(${brand.shadow} / 0.1); }
    .${id}-devhead { display: flex; align-items: center; gap: 16px; font-weight: 800; font-size: 32px; color: ${brand.raspberry}; margin-bottom: 18px; }
    .${id}-devhead svg { width: 54px; height: 54px; color: ${brand.raspberry}; flex: none; }
    .${id}-devline { font-size: 31px; line-height: 1.34; margin: 0 0 18px; color: ${brand.burgundy}; }
    .${id}-devline strong { font-weight: 800; }
    .${id}-foot { position: absolute; left: ${PANEL.x}px; right: ${PANEL.x}px; top: 930px; font-size: 32px; line-height: 1.3; color: ${brand.burgundySoft}; margin: 0; }
    .${id}-foot strong { color: ${brand.raspberry}; }
  </style>
  <div id="${id}-ground"></div>
  <div id="${id}-stage" data-hold>
    ${progress(id, sc.step, total)}
    <div class="${id}-head">
      ${sc.step ? `<div class="${id}-stepof" style="margin:0 0 10px">Step ${sc.step} of ${total}</div>` : ''}
      <h2 id="${id}-title" class="${id}-title" style="margin-bottom:16px">${esc(sc.title)}</h2>
      ${sc.intro ? `<p id="${id}-intro" class="${id}-intro">${esc(sc.intro)}</p>` : ''}
    </div>
    <div class="${id}-row">${cards.join('')}</div>
    ${sc.footer ? `<p id="${id}-foot" class="${id}-foot">${rich(sc.footer)}</p>` : ''}
  </div>`
  return { html, duration, cues, tweens }
}

/* ---------- Assemble ---------- */

const builders = { title: sceneTitle, screen: sceneScreen, rule: sceneRule, devices: sceneDevices }
const total = t.steps
let clock = 0
const hosts = []
const allCues = []
const transcript = []
rmSync(out, { recursive: true, force: true })
mkdirSync(join(out, 'compositions'), { recursive: true })
cpSync(join(here, 'assets'), join(out, 'assets'), { recursive: true })
mkdirSync(join(out, 'assets', 'screens'), { recursive: true })

t.scenes.forEach((sc, i) => {
  const id = sc.id ?? `s${String(i).padStart(2, '0')}`
  const b = builders[sc.kind]
  if (!b) throw new Error(`Unknown scene kind ${sc.kind}`)
  const r = b(sc, id, total)
  if (sc.image) cpSync(join(srcDir, 'screens', `${sc.image}.webp`), join(out, 'assets', 'screens', `${sc.image}.webp`))
  const d = r.duration
  // Blur swap on one stage: the ground never cuts.
  const first = i === 0
  const enterExit = [
    first ? '' : `tl.fromTo('#${id}-stage', { opacity: 0, filter: 'blur(6px)' }, { opacity: 1, filter: 'blur(0px)', duration: 0.4, ease: 'power2.out' }, 0);`,
    `tl.fromTo('#${id}-stage', { opacity: 1, filter: 'blur(0px)' }, { opacity: 0, filter: 'blur(6px)', duration: 0.3, ease: 'power2.in', immediateRender: false }, ${round(d - 0.32)});`,
  ]
  writeFileSync(
    join(out, 'compositions', `${id}.html`),
    `<template>
  <div id="root" data-composition-id="${id}" data-width="${W}" data-height="${H}">
  ${r.html}
  </div>
  <script>
    const tl = gsap.timeline({ paused: true });
    ${[...enterExit, ...(first && sc.kind === 'title' ? [] : r.tweens)].filter(Boolean).join('\n    ')}
    window.__timelines["${id}"] = tl;
  </script>
</template>
`,
  )
  hosts.push(
    `      <div id="${id}" data-composition-id="${id}" data-composition-src="compositions/${id}.html" data-start="${round(clock)}" data-duration="${d}" data-track-index="1" data-track-kind="graphics" data-width="${W}" data-height="${H}"></div>`,
  )
  // Captions: each cue runs until the next one starts, or until the scene ends.
  const merged = []
  for (const c of r.cues) {
    const prev = merged[merged.length - 1]
    if (prev?.header) merged[merged.length - 1] = { start: prev.start, end: c.end, text: `${prev.text} ${c.text}` }
    else merged.push(c)
  }
  const sceneCues = merged.map((c, k, arr) => ({ start: clock + c.start, end: clock + (c.end ?? (arr[k + 1]?.start ?? d - 0.35)), text: c.text }))
  allCues.push(...sceneCues)
  transcript.push({ at: clock, kind: sc.kind, step: sc.step, title: sc.title, device: sc.device, lines: r.cues.filter((c) => !c.header).map((c) => c.text) })
  clock += d
})
const length = round(clock)

writeFileSync(
  join(out, 'index.html'),
  `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=${W}, height=${H}" />
    <title>${esc(t.title)}</title>
    <script src="assets/vendor/gsap.min.js"></script>
    <style>
      ${fontFaces()}
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body { margin: 0; width: ${W}px; height: ${H}px; overflow: hidden; background: ${brand.ivory}; }
      #main { position: absolute; inset: 0; background: ${brand.ivory}; }
    </style>
  </head>
  <body>
    <!-- Generated by video/template/build.mjs from tutorials/${slug}/tutorial.json -->
    <div id="main" data-composition-id="main" data-start="0" data-duration="${length}" data-fps="${FPS}" data-width="${W}" data-height="${H}">
${hosts.join('\n')}
    </div>
    <script>
      window.__timelines["main"] = gsap.timeline({ paused: true });
    </script>
  </body>
</html>
`,
)
writeFileSync(join(out, 'hyperframes.json'), JSON.stringify({ name: slug }, null, 2) + '\n')

/* ---------- Captions and transcript ---------- */
const ts = (s) => {
  const ms = Math.max(0, Math.round(s * 1000))
  const h = Math.floor(ms / 3600000)
  const m = Math.floor((ms % 3600000) / 60000)
  const sec = Math.floor((ms % 60000) / 1000)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}.${String(ms % 1000).padStart(3, '0')}`
}
const outDir = join(srcDir, 'out')
mkdirSync(outDir, { recursive: true })
const vtt = ['WEBVTT', '', `NOTE ${t.title}. Captions match the words shown on screen; the video has no voiceover.`, '']
allCues.forEach((c, i) => vtt.push(String(i + 1), `${ts(c.start)} --> ${ts(c.end)}`, c.text, ''))
writeFileSync(join(outDir, `${slug}.vtt`), vtt.join('\n'))
const md = [`# ${t.title}`, '', `Nurse Love Company tutorial. Length ${Math.floor(length / 60)}:${String(Math.round(length % 60)).padStart(2, '0')}. No voiceover: everything below is shown on screen.`, '']
for (const s of transcript) {
  md.push(`## ${ts(s.at).slice(3, 8)} ${s.step ? `Step ${s.step}: ` : ''}${s.title}${s.device ? ` (${s.device})` : ''}`, '')
  for (const l of s.lines) md.push(l, '')
}
writeFileSync(join(outDir, `${slug}-transcript.md`), md.join('\n'))
/* ---------- Thumbnail: a still HyperFrames composition in build/<slug>-thumbnail ---------- */
if (t.thumbnail) {
  const th = t.thumbnail
  const tdir = join(root, 'build', `${slug}-thumbnail`)
  rmSync(tdir, { recursive: true, force: true })
  mkdirSync(join(tdir, 'assets', 'screens'), { recursive: true })
  cpSync(join(here, 'assets', 'fonts'), join(tdir, 'assets', 'fonts'), { recursive: true })
  cpSync(join(srcDir, 'screens', `${th.image}.webp`), join(tdir, 'assets', 'screens', `${th.image}.webp`))
  const img = screens[th.image]
  const device = th.image.startsWith('phone') ? 'phone' : 'desktop'
  const box = Array.isArray(th.target) ? th.target : screens[`${device}-boxes`][th.target]
  const C = { x: 1060, y: 190, w: 760, h: 700 }
  const s = Math.min(C.w / th.focus[2], C.h / th.focus[3])
  const fx = round(C.w / 2 - s * (th.focus[0] + th.focus[2] / 2))
  const fy = round(C.h / 2 - s * (th.focus[1] + th.focus[3] / 2))
  const hb = { x: round(s * box[0] + fx - 12), y: round(s * box[1] + fy - 12), w: round(s * box[2] + 24), h: round(s * box[3] + 24) }
  writeFileSync(
    join(tdir, 'index.html'),
    `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=${W}, height=${H}" />
    <style>
      ${fontFaces()}
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body { width: ${W}px; height: ${H}px; overflow: hidden; background: ${brand.blush}; }
      #thumb { position: absolute; inset: 0; background: ${brand.blush}; font-family: 'Nunito Sans', sans-serif; color: ${brand.burgundy}; }
      #thumb-copy { position: absolute; left: 110px; top: 190px; width: 880px; }
      #thumb-eyebrow { display: inline-block; font-weight: 800; font-size: 36px; letter-spacing: 0.12em; text-transform: uppercase; color: #fff; background: ${brand.raspberry}; border-radius: 999px; padding: 10px 28px; margin-bottom: 34px; }
      #thumb-title { font-family: 'DM Serif Display', serif; font-weight: 400; font-size: 118px; line-height: 1; margin-bottom: 34px; }
      #thumb-sub { font-size: 46px; font-weight: 700; color: ${brand.burgundySoft}; }
      #thumb-card { position: absolute; left: ${C.x}px; top: ${C.y}px; width: ${C.w}px; height: ${C.h}px; border-radius: 34px; background: #fff; overflow: hidden; box-shadow: 0 0 0 3px ${brand.border}, 0 30px 70px rgb(${brand.shadow} / 0.18); }
      #thumb-img { position: absolute; left: ${fx}px; top: ${fy}px; width: ${round(img.w * s)}px; height: ${round(img.h * s)}px; }
      #thumb-hl { position: absolute; left: ${hb.x}px; top: ${hb.y}px; width: ${hb.w}px; height: ${hb.h}px; border-radius: 20px; border: 6px solid ${brand.raspberry}; box-shadow: 0 0 0 10px rgb(216 8 83 / 0.16); }
    </style>
  </head>
  <body>
    <div id="thumb" data-composition-id="thumb" data-start="0" data-duration="1" data-width="${W}" data-height="${H}" data-no-timeline>
      <div id="thumb-copy">
        <div id="thumb-eyebrow">${esc(th.eyebrow)}</div>
        <h1 id="thumb-title">${esc(th.title)}</h1>
        <p id="thumb-sub">${esc(th.subtitle)}</p>
      </div>
      <div id="thumb-card"><img id="thumb-img" src="assets/screens/${th.image}.webp" alt="" /><div id="thumb-hl"></div></div>
    </div>
  </body>
</html>
`,
  )
  writeFileSync(join(tdir, 'hyperframes.json'), JSON.stringify({ name: `${slug}-thumbnail` }, null, 2) + '\n')
}
console.log(`Built build/${slug}: ${t.scenes.length} scenes, ${length}s. Captions and transcript in tutorials/${slug}/out/.`)
if (!existsSync(join(out, 'assets', 'vendor', 'gsap.min.js'))) throw new Error('gsap missing')
