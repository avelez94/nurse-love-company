import { Hono } from 'hono'
import { adminOnly, clientIp, jsonBody, requireAdmin, type AppEnv } from '../http.js'
import { config } from '../env.js'
import { rateLimit } from '../lib/rate-limit.js'
import { serveMedia } from '../lib/stream.js'
import { receiveUpload } from '../lib/upload.js'
import { int, oneOf, str, uuid } from '../lib/validate.js'
import {
  createBanner,
  duplicateBanner,
  getBanner,
  getPopup,
  listBanners,
  marketingImage,
  POPUP_UPLOAD_TARGET,
  publicMarketing,
  recordEvent,
  removeMarketingImage,
  setBannerStatus,
  setPopupStatus,
  checkCode,
  updateBanner,
  updatePopup,
} from '../services/marketing.js'
import { attachUpload } from '../services/uploads.js'

export const marketingRoutes = new Hono<AppEnv>()

/* ---------- Public ---------- */

/** Live banners and the popup, if published. Short cache so schedules take effect within a minute. */
marketingRoutes.get('/marketing', async (c) => c.json(await publicMarketing(), 200, { 'cache-control': 'public, max-age=60' }))

marketingRoutes.get('/marketing/banners/:id/image', async (c) => {
  const m = await marketingImage('banner', uuid(c.req.param('id')), c.get('user')?.role === 'admin')
  return serveMedia(c, m.key, m.type, 'public, max-age=300')
})
marketingRoutes.get('/marketing/popup/image', async (c) => {
  const m = await marketingImage('popup', 'nurse_kin', c.get('user')?.role === 'admin')
  return serveMedia(c, m.key, m.type, 'public, max-age=300')
})

/** Aggregate view, click and dismiss counts. No visitor identifiers are stored. */
marketingRoutes.post('/marketing/events', async (c) => {
  await rateLimit(`marketing-events:${clientIp(c)}`, 120, 600)
  const b = await jsonBody(c)
  const kind = oneOf(b.kind, 'Kind', ['banner', 'popup'] as const)
  const id = kind === 'banner' ? uuid(b.id) : str(b.id, 'id', { max: 20 })
  const counted = await recordEvent(kind, id, int(b.version, 'Version', { min: 1, max: 100_000 })!, oneOf(b.event, 'Event', ['view', 'click', 'dismiss'] as const))
  return c.json({ counted })
})

/* ---------- Admin ---------- */

marketingRoutes.use('/admin/*', adminOnly)
const ip = (c: Parameters<typeof clientIp>[0]) => clientIp(c)

marketingRoutes.get('/admin/marketing/banners', async (c) => c.json({ banners: await listBanners(), timezoneNote: 'Times are saved exactly and shown in your own timezone.' }))
marketingRoutes.post('/admin/marketing/banners', async (c) => c.json(await createBanner(requireAdmin(c), await jsonBody(c), ip(c)), 201))
marketingRoutes.get('/admin/marketing/banners/:id', async (c) => c.json(await getBanner(uuid(c.req.param('id')))))
marketingRoutes.put('/admin/marketing/banners/:id', async (c) => c.json(await updateBanner(requireAdmin(c), uuid(c.req.param('id')), await jsonBody(c), ip(c))))
marketingRoutes.post('/admin/marketing/banners/:id/duplicate', async (c) => c.json(await duplicateBanner(requireAdmin(c), uuid(c.req.param('id')), ip(c)), 201))
marketingRoutes.get('/admin/marketing/banners/:id/preview-image', async (c) => {
  const m = await marketingImage('banner', uuid(c.req.param('id')), true)
  return serveMedia(c, m.key, m.type, 'private, no-store')
})
/** Server upload path (local development). On Vercel images go straight to storage through /api/admin/uploads. */
marketingRoutes.post('/admin/marketing/banners/:id/image', async (c) => {
  const actor = requireAdmin(c)
  const id = uuid(c.req.param('id'))
  await getBanner(id)
  const f = await receiveUpload(c, 'image', `marketing/banners/${id}`, config.limits.imageBytes)
  return c.json(await attachUpload(actor, 'banner_image', id, f, {}, ip(c)), 201)
})
marketingRoutes.delete('/admin/marketing/banners/:id/image', async (c) => {
  requireAdmin(c)
  await removeMarketingImage('banner', uuid(c.req.param('id')))
  return c.json({ ok: true })
})

// Registered after the image routes, so /image is never taken for an action.
marketingRoutes.post('/admin/marketing/banners/:id/:action', async (c) => {
  const action = oneOf(c.req.param('action'), 'Action', ['publish', 'unpublish', 'activate', 'deactivate', 'archive', 'restore', 'reset_dismissals'] as const)
  return c.json(await setBannerStatus(requireAdmin(c), uuid(c.req.param('id')), action, ip(c)))
})
/** Checks a coupon code against Stripe and shows the real offer, without saving anything. */
marketingRoutes.post('/admin/marketing/check-code', async (c) => {
  requireAdmin(c)
  const code = str((await jsonBody(c)).code, 'Coupon code', { min: 2, max: 40 }).trim().toUpperCase()
  const r = await checkCode(code)
  return c.json({ offer: r.offer, expiresAt: r.expiresAt })
})

marketingRoutes.get('/admin/marketing/popup', async (c) => c.json({ ...(await getPopup()), uploadTarget: POPUP_UPLOAD_TARGET }))
marketingRoutes.put('/admin/marketing/popup', async (c) => c.json(await updatePopup(requireAdmin(c), await jsonBody(c), ip(c))))
marketingRoutes.get('/admin/marketing/popup/preview-image', async (c) => {
  const m = await marketingImage('popup', 'nurse_kin', true)
  return serveMedia(c, m.key, m.type, 'private, no-store')
})
marketingRoutes.post('/admin/marketing/popup/image', async (c) => {
  const actor = requireAdmin(c)
  const f = await receiveUpload(c, 'image', 'marketing/popup', config.limits.imageBytes)
  return c.json(await attachUpload(actor, 'popup_image', POPUP_UPLOAD_TARGET, f, {}, ip(c)), 201)
})
marketingRoutes.delete('/admin/marketing/popup/image', async (c) => {
  requireAdmin(c)
  await removeMarketingImage('popup', 'nurse_kin')
  return c.json({ ok: true })
})
// After the image routes, so /image is never taken for an action.
marketingRoutes.post('/admin/marketing/popup/:action', async (c) => {
  const action = oneOf(c.req.param('action'), 'Action', ['publish', 'unpublish', 'enable', 'disable', 'reset_campaign'] as const)
  return c.json(await setPopupStatus(requireAdmin(c), action, ip(c)))
})
