import './env.js'
import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, it } from 'node:test'
import { pathFor, routeNameFor } from '../../shared/routes.js'
import { setPageTemplateForTests } from '../seo.js'
import { api, digitalProduct, q, setup, teardown } from './helpers.js'

const TEMPLATE = `<!doctype html><html><head>
    <!--seo-->
    <title>Old</title>
    <!--/seo-->
  <script type="module" src="/assets/app.js"></script></head><body><div id="root"></div></body></html>`

const page = async (p: string) => api(`/api/seo/page?p=${encodeURIComponent(p)}`)
const tag = (html: string, re: RegExp) => html.match(re)?.[1] ?? null

before(() => setPageTemplateForTests(TEMPLATE))
beforeEach(setup)
after(async () => {
  setPageTemplateForTests(null)
  await teardown()
})

describe('Page addresses', () => {
  it('maps route names to real paths and back', () => {
    const cases: Array<[string, string]> = [
      ['home', '/'],
      ['shop', '/shop'],
      ['np-binder-inserts', '/np-binder-inserts'],
      ['product-uti-guide', '/products/uti-guide'],
      ['tutorial-download-and-save', '/tutorials/download-and-save'],
      ['account-downloads', '/account-downloads'],
      ['admin-product-123', '/admin-product-123'],
    ]
    for (const [name, path] of cases) {
      assert.equal(pathFor(name), path)
      assert.equal(routeNameFor(path), name)
    }
    assert.equal(pathFor('email-preferences?t=abc'), '/email-preferences?t=abc')
    assert.equal(routeNameFor('/shop/'), 'shop')
    assert.equal(routeNameFor('/tutorials'), 'tutorials')
  })
})

describe('Search engines and link previews', () => {
  it('gives a product page its own title, description, preview and Google product details', async () => {
    const id = await digitalProduct('uti-guide', 699)
    await q(`update products set title = 'UTI Clinical Guide', short_description = 'A printable UTI guide for NP students.' where id = $1`, [id])
    const img = await q<{ id: string }>(`insert into product_images (product_id, kind, storage_key, content_type, alt, approved) values ($1, 'gallery', 'media/x.webp', 'image/webp', 'Guide cover', true) returning id`, [id])
    const res = await page('/products/uti-guide')
    assert.equal(res.status, 200)
    const html = res.data as string
    assert.equal(tag(html, /<title>([^<]+)<\/title>/), 'UTI Clinical Guide | Nurse Love Company')
    assert.equal(tag(html, /name="description" content="([^"]+)"/), 'A printable UTI guide for NP students.')
    assert.equal(tag(html, /property="og:image" content="([^"]+)"/), `http://localhost:5173/api/media/${img[0].id}`)
    assert.ok(html.includes('<script type="module" src="/assets/app.js">'), 'the app still loads')
    assert.ok(!html.includes('<title>Old</title>'))
    const ld = JSON.parse(tag(html, /<script type="application\/ld\+json">(.+?)<\/script>/)!)
    assert.equal(ld['@type'], 'Product')
    assert.equal(ld.offers.price, '6.99')
    assert.equal(ld.offers.priceCurrency, 'USD')
    assert.equal(ld.offers.availability, 'https://schema.org/InStock')
  })

  it('keeps unknown, unpublished and private pages out of search', async () => {
    const id = await digitalProduct('secret-draft')
    await q(`update products set status = 'draft' where id = $1`, [id])
    for (const p of ['/products/secret-draft', '/products/nope', '/no-such-page']) {
      const res = await page(p)
      assert.equal(res.status, 404, p)
      assert.equal(res.headers.get('x-robots-tag'), 'noindex')
    }
    for (const p of ['/account-downloads', '/admin-products', '/sign-in', '/reset-password']) {
      const res = await page(p)
      assert.equal(res.status, 200, p)
      assert.equal(res.headers.get('x-robots-tag'), 'noindex', p)
      assert.ok((res.data as string).includes('content="noindex"'), p)
    }
  })

  it('escapes product text so it can never break the page', async () => {
    const id = await digitalProduct('tricky')
    await q(`update products set title = $2, short_description = $3 where id = $1`, [id, 'A "quoted" <b>title</b>', '</script><script>alert(1)</script>'])
    const html = (await page('/products/tricky')).data as string
    assert.ok(!html.includes('<script>alert(1)'))
    assert.ok(!html.includes('<b>title</b>'))
    assert.ok(html.includes('A &quot;quoted&quot; &lt;b&gt;title&lt;/b&gt;'))
  })

  it('lists public pages and products in the sitemap, and robots.txt points to it', async () => {
    await digitalProduct('listed-one')
    const hidden = await digitalProduct('hidden-one')
    await q(`update products set active = false where id = $1`, [hidden])
    const map = (await api('/api/seo/sitemap.xml')).data as string
    assert.ok(map.includes('<loc>http://localhost:5173/</loc>'))
    assert.ok(map.includes('<loc>http://localhost:5173/shop</loc>'))
    assert.ok(map.includes('<loc>http://localhost:5173/products/listed-one</loc>'))
    assert.ok(!map.includes('hidden-one'))
    assert.ok(!map.includes('account'))
    // Tests run as development, which asks search engines to stay away.
    assert.equal((await api('/api/seo/robots.txt')).data, 'User-agent: *\nDisallow: /\n')
  })
})
