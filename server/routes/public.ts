import { Hono } from 'hono'
import { integrationStatus } from '../env.js'
import type { AppEnv } from '../http.js'
import { notFound } from '../lib/errors.js'
import { serveRange } from '../lib/stream.js'
import { imageVisibility, publicCatalog, publicProduct } from '../services/catalog.js'
import { getSettings } from '../services/settings.js'
import { captionText, publicTutorial, publicTutorials, tutorialMedia } from '../services/tutorials.js'

export const publicRoutes = new Hono<AppEnv>()

publicRoutes.get('/catalog', async (c) => {
  const [products, settings] = await Promise.all([publicCatalog(), getSettings()])
  return c.json({
    products,
    featuredIds: settings.homepage.featured_product_ids,
    store: { name: settings.store.name, supportEmail: settings.store.support_email, contactEmail: settings.store.contact_email },
    freebies: settings.freebies.items.filter((f) => f.published),
    shippingConfigured: settings.shipping.configured,
  })
})

publicRoutes.get('/products/:slug', async (c) => {
  const p = await publicProduct(c.req.param('slug'))
  if (!p) throw notFound('Product')
  return c.json({ product: p })
})

/** Product images: public only while the product itself is public. Admins can always see them. */
publicRoutes.get('/media/:id', async (c) => {
  const img = await imageVisibility(c.req.param('id'))
  const user = c.get('user')
  if (!img || (!img.public && user?.role !== 'admin')) throw notFound('Image')
  return serveRange(c, img.storage_key, img.content_type, img.public ? 'public, max-age=3600' : 'private, no-store')
})

publicRoutes.get('/status', (c) => {
  const s = integrationStatus()
  return c.json({ payments: s.payments.state, email: s.email.configured, environment: s.environment })
})

/* Tutorials: unlimited public viewing of published tutorials only. No account needed. */
publicRoutes.get('/tutorials', async (c) => c.json({ tutorials: await publicTutorials() }))

publicRoutes.get('/tutorials/:slug', async (c) => {
  const t = await publicTutorial(c.req.param('slug'))
  if (!t) throw notFound('Tutorial')
  return c.json({ tutorial: t })
})

for (const kind of ['video', 'poster', 'thumbnail'] as const) {
  publicRoutes.get(`/tutorials/:slug/${kind}`, async (c) => {
    // Short cache so an unpublished tutorial stops playing quickly.
    const m = await tutorialMedia({ slug: c.req.param('slug') }, kind, 'public')
    return serveRange(c, m.key, m.type, 'public, max-age=60')
  })
}
publicRoutes.get('/tutorials/:slug/captions/:lang', async (c) => {
  const vtt = await captionText({ slug: c.req.param('slug') }, c.req.param('lang'), 'public')
  return c.body(vtt, 200, { 'content-type': 'text/vtt; charset=utf-8', 'cache-control': 'public, max-age=300' })
})
