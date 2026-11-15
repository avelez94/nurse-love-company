/*
  Search engines and link previews.

  The storefront is one page app, but every page has a real address (see
  shared/routes.ts). When a page is requested, the server sends the same app
  with that page's own title, description, canonical address, link preview
  (Open Graph) tags and, for products, Google product details (JSON-LD).
  Search engines and social apps read these without running any JavaScript.

  Also serves /robots.txt and /sitemap.xml. Accounts, checkout and admin are
  marked noindex and kept out of the sitemap. Anything but production asks
  search engines to stay away.
*/
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PRIVATE_PATH_PREFIXES, STATIC_PUBLIC_ROUTES, pathFor, routeNameFor } from '../shared/routes.js'
import { q } from './db/pool.js'
import { config, deployEnv } from './env.js'
import { PUBLIC_WHERE, publicProduct } from './services/catalog.js'

const SITE = 'Nurse Love Company'
const SITE_DESCRIPTION = 'Nurse Love Company. Study resources, printable inserts and everyday favorites for your nursing life. Made by a nurse, for nurses.'

interface Meta {
  title: string
  description: string
  image: string
  imageAlt: string
  type: 'website' | 'product' | 'article'
  noindex: boolean
  status: 200 | 404
  jsonLd: object[]
}

const STATIC_META: Record<string, { title: string; description: string }> = {
  home: { title: `${SITE} | Printable nurse and NP binder inserts`, description: SITE_DESCRIPTION },
  shop: { title: `Shop digital resources | ${SITE}`, description: 'Printable binder inserts and study resources for nurses, nurse practitioners and NP students, plus everyday favorites. Made by a nurse, for nurses.' },
  'nurse-binder-inserts': { title: `Nurse Binder Inserts | ${SITE}`, description: 'Nurse Binder Inserts: printable resources for your nursing journey. Digital download, binder not included.' },
  'np-binder-inserts': { title: `Nurse Practitioner Binder Inserts | ${SITE}`, description: 'Nurse Practitioner Binder Inserts: printable resources for your NP journey, for NP students and nurse practitioners. Digital download, binder not included.' },
  'extra-cute': { title: `A little extra cute | ${SITE}`, description: 'Apparel, accessories and pretty pens for your nursing life, shipped to you.' },
  apparel: { title: `Nurse-Love Apparel | ${SITE}`, description: 'Soft, comfy favorites for off-duty days. Shipped to you.' },
  accessories: { title: `Cute Accessories | ${SITE}`, description: 'Sweet little details for every day. Shipped to you.' },
  pens: { title: `Pretty Pens | ${SITE}`, description: 'Write your nursing story in style. Shipped to you.' },
  'freebie-corner': { title: `The Freebie Corner | ${SITE}`, description: 'A little nurse love, on us. Helpful, beautiful printables to support your nursing journey.' },
  tutorials: { title: `Tutorials | ${SITE}`, description: 'Short how to videos for your Nurse Love Company resources: downloading, saving and using your files.' },
  'our-story': { title: `Our Story | ${SITE}`, description: 'The story behind Nurse Love Company. Made by a nurse, for nurses.' },
  help: { title: `Help & contact | ${SITE}`, description: 'Answers about downloads, orders and shipping, and how to reach Nurse Love Company.' },
  terms: { title: `Terms and Conditions | ${SITE}`, description: 'The terms and conditions for using nurselovecompany.com and buying from Nurse Love Company.' },
  privacy: { title: `Privacy Policy | ${SITE}`, description: 'How Nurse Love Company collects, uses and protects your information.' },
}

const PRIVATE_TITLES: Array<[string, string]> = [
  ['sign-in', 'Sign in'],
  ['sign-up', 'Create account'],
  ['forgot-password', 'Reset password'],
  ['reset-password', 'Choose a new password'],
  ['checkout-', 'Checkout'],
  ['account', 'My account'],
  ['admin', 'Store admin'],
  ['email-preferences', 'Email preferences'],
]

export const absolute = (path: string) => `${config.appUrl.replace(/\/+$/, '')}${path}`
const defaultImage = () => absolute('/og-image.jpg')

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
/** JSON for a script block: closing tags and line separators can never end it early. */
const safeJson = (v: unknown) => JSON.stringify(v).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')
const clip = (s: string, n = 160) => {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length <= n ? t : `${t.slice(0, n - 1).replace(/\s+\S*$/, '')}…`
}

const organization = () => ({
  '@context': 'https://schema.org',
  '@type': 'Organization',
  name: SITE,
  url: absolute('/'),
  logo: absolute('/og-image.jpg'),
})

async function productMeta(slug: string): Promise<Meta | null> {
  const p = await publicProduct(slug)
  if (!p) return null
  const gallery = p.images.find((i) => i.kind === 'gallery') ?? p.images[0]
  const image = gallery ? absolute(gallery.url) : defaultImage()
  const description = clip(p.shortDescription || `${p.title} from ${SITE}. Made by a nurse, for nurses.`)
  const prices = [p.salePriceCents ?? p.priceCents, ...p.variants.map((v) => v.priceCents)].filter((x): x is number => typeof x === 'number')
  const price = p.isFreebie ? 0 : prices.length ? Math.min(...prices) : null
  const url = absolute(pathFor(`product-${p.slug}`))
  const ld: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: p.title,
    description,
    image: p.images.filter((i) => i.kind === 'gallery').map((i) => absolute(i.url)).slice(0, 5),
    url,
    brand: { '@type': 'Brand', name: SITE },
    category: p.collection || undefined,
  }
  if (!(ld.image as string[]).length) ld.image = [image]
  if (price !== null) {
    ld.offers = {
      '@type': 'Offer',
      url,
      priceCurrency: 'USD',
      price: (price / 100).toFixed(2),
      availability: p.inStock ? (p.preorder ? 'https://schema.org/PreOrder' : 'https://schema.org/InStock') : 'https://schema.org/OutOfStock',
      itemCondition: 'https://schema.org/NewCondition',
      seller: { '@type': 'Organization', name: SITE },
    }
  }
  return { title: `${p.title} | ${SITE}`, description, image, imageAlt: gallery?.alt || p.title, type: 'product', noindex: false, status: 200, jsonLd: [ld] }
}

async function tutorialMeta(slug: string): Promise<Meta | null> {
  const [t] = await q<{ title: string; summary: string }>(`select title, summary from tutorials where slug = $1 and status = 'published'`, [slug])
  if (!t) return null
  return { title: `${t.title} | Tutorials | ${SITE}`, description: clip(t.summary || `${t.title}: a short how to video from ${SITE}.`), image: defaultImage(), imageAlt: SITE, type: 'article', noindex: false, status: 200, jsonLd: [] }
}

/** Title, description, preview and structured data for one page address. */
export async function metaFor(pathname: string): Promise<Meta> {
  const name = routeNameFor(pathname)
  const base = { image: defaultImage(), imageAlt: `${SITE}: printable binder inserts and study resources`, type: 'website' as const, status: 200 as const, jsonLd: [] as object[] }
  const fixed = STATIC_META[name]
  if (fixed) {
    const jsonLd = name === 'home' ? [organization(), { '@context': 'https://schema.org', '@type': 'WebSite', name: SITE, url: absolute('/') }] : []
    return { ...base, ...fixed, noindex: false, jsonLd }
  }
  if (name.startsWith('product-')) {
    const m = await productMeta(name.slice('product-'.length))
    if (m) return m
  } else if (name.startsWith('tutorial-')) {
    const m = await tutorialMeta(name.slice('tutorial-'.length))
    if (m) return m
  } else {
    const priv = PRIVATE_TITLES.find(([prefix]) => name === prefix || name.startsWith(prefix.endsWith('-') ? prefix : `${prefix}-`))
    if (priv) return { ...base, title: `${priv[1]} | ${SITE}`, description: SITE_DESCRIPTION, noindex: true }
  }
  return { ...base, title: `Page not found | ${SITE}`, description: SITE_DESCRIPTION, noindex: true, status: 404 }
}

/** The tags that go between <!--seo--> and <!--/seo--> in index.html. */
export function headTags(pathname: string, m: Meta) {
  const canonical = absolute(pathname === '/' ? '/' : pathname.replace(/\/+$/, ''))
  const tags = [
    `<title>${escapeHtml(m.title)}</title>`,
    `<meta name="description" content="${escapeHtml(m.description)}" />`,
    m.noindex || deployEnv !== 'production' ? '<meta name="robots" content="noindex" />' : `<link rel="canonical" href="${escapeHtml(canonical)}" />`,
    `<meta property="og:site_name" content="${SITE}" />`,
    `<meta property="og:type" content="${m.type === 'product' ? 'product' : m.type}" />`,
    `<meta property="og:title" content="${escapeHtml(m.title)}" />`,
    `<meta property="og:description" content="${escapeHtml(m.description)}" />`,
    `<meta property="og:url" content="${escapeHtml(canonical)}" />`,
    `<meta property="og:image" content="${escapeHtml(m.image)}" />`,
    `<meta property="og:image:alt" content="${escapeHtml(m.imageAlt)}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    ...m.jsonLd.map((ld) => `<script type="application/ld+json">${safeJson(ld)}</script>`),
  ]
  return tags.map((t) => `    ${t}`).join('\n')
}

let template: string | null = null
/** Tests can supply the built page. */
export function setPageTemplateForTests(html: string | null) {
  template = html
}
function pageTemplate() {
  if (template) return template
  for (const file of [join(process.cwd(), 'dist', 'index.html'), join(process.cwd(), '..', 'dist', 'index.html')]) {
    if (existsSync(file)) return (template = readFileSync(file, 'utf8'))
  }
  throw new Error('dist/index.html was not found. Build the storefront first (npm run build).')
}

/** The storefront page for an address, with that page's head tags. */
export async function renderPage(pathname: string) {
  const m = await metaFor(pathname)
  const html = pageTemplate().replace(/<!--seo-->[\s\S]*?<!--\/seo-->/, `<!--seo-->\n${headTags(pathname, m)}\n    <!--/seo-->`)
  return { html, status: m.status, noindex: m.noindex }
}

export function robotsTxt() {
  if (deployEnv !== 'production') return 'User-agent: *\nDisallow: /\n'
  return ['User-agent: *', ...PRIVATE_PATH_PREFIXES.map((p) => `Disallow: ${p}`), '', `Sitemap: ${absolute('/sitemap.xml')}`, ''].join('\n')
}

export async function sitemapXml() {
  const products = await q<{ slug: string; updated_at: Date }>(`select p.slug, p.updated_at from products p where ${PUBLIC_WHERE} and not p.is_demo order by p.sort_order, p.created_at`)
  const tutorials = await q<{ slug: string; updated_at: Date }>(`select slug, updated_at from tutorials where status = 'published' order by display_order`)
  const entries = [
    ...STATIC_PUBLIC_ROUTES.map((r) => ({ loc: absolute(pathFor(r)), lastmod: null as Date | null })),
    ...products.map((p) => ({ loc: absolute(pathFor(`product-${p.slug}`)), lastmod: p.updated_at })),
    ...tutorials.map((t) => ({ loc: absolute(pathFor(`tutorial-${t.slug}`)), lastmod: t.updated_at })),
  ]
  const body = entries
    .map((e) => `  <url><loc>${escapeHtml(e.loc)}</loc>${e.lastmod ? `<lastmod>${new Date(e.lastmod).toISOString().slice(0, 10)}</lastmod>` : ''}</url>`)
    .join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`
}
