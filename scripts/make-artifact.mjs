// Packs the "artifact" build into one self-contained page for the hosted
// Claude preview: CSS and JS inlined, fonts from Google Fonts.
// Usage: npm run build:artifact [-- output.html]
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dist = join(root, 'dist-artifact')
const html = readFileSync(join(dist, 'index.html'), 'utf8')
const out = process.argv[2] ?? join(dist, 'nurse-love-company-preview.html')

const cssHref = html.match(/<link rel="stylesheet"[^>]*href="\.\/(assets\/[^"]+\.css)"/)?.[1]
const jsSrc = html.match(/<script type="module"[^>]*src="\.\/(assets\/[^"]+\.js)"/)?.[1]
const fonts = html.match(/<link rel="stylesheet" href="(https:\/\/fonts\.googleapis\.com[^"]+)"/)?.[1]
if (!cssHref || !jsSrc || !fonts) throw new Error('Could not find built assets in dist-artifact/index.html')

const css = readFileSync(join(dist, cssHref), 'utf8')
const js = readFileSync(join(dist, jsSrc), 'utf8').replace(/<\/script/gi, '<\\/script')

const page = `<title>Nurse Love Company</title>
<meta name="claude:viewport-fit-sides" content="cover">
<meta name="description" content="Nurse Love Company design preview. Made by a nurse, for nurses.">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${fonts.replace(/&amp;/g, '&').replace(/&/g, '&amp;')}">
<style>${css}</style>
<div id="root"></div>
<script type="module">${js}</script>
`
writeFileSync(out, page)
console.log(`Wrote ${out} (${(page.length / 1024).toFixed(0)} KB)`)
