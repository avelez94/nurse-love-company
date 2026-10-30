import { createHmac, timingSafeEqual } from 'node:crypto'
import { Hono } from 'hono'
import { config } from '../env.js'
import { adminOnly, clientIp, jsonBody, requireAdmin, type AppEnv } from '../http.js'
import { HttpError, badRequest } from '../lib/errors.js'
import { rateLimit } from '../lib/rate-limit.js'
import { oneOf, uuid } from '../lib/validate.js'
import {
  AUTOMATION_KINDS,
  automationOverview,
  cancelJob,
  listJobs,
  preferenceStatus,
  previewAutomation,
  reschedulePending,
  resolveHeld,
  setPreferenceFromLink,
  setStoreTimezone,
  testSend,
  updateAutomation,
  type AutomationKind,
} from '../services/automations.js'
import { ingestDeliveryEvent } from '../services/delivery.js'

export const automationRoutes = new Hono<AppEnv>()
const ip = (c: Parameters<typeof clientIp>[0]) => clientIp(c)
const kindOf = (v: unknown) => oneOf(v, 'Automation', AUTOMATION_KINDS) as AutomationKind

/* ---------- Email preference links (from download reminders and review requests) ---------- */

/** Reading the page changes nothing; the customer presses a button to change the setting. */
automationRoutes.get('/email-preferences', async (c) => c.json(await preferenceStatus(c.req.query('t') ?? ''), 200, { 'cache-control': 'no-store' }))
automationRoutes.post('/email-preferences', async (c) => {
  await rateLimit(`email-pref:${clientIp(c)}`, 30, 3600)
  const b = await jsonBody(c)
  return c.json(await setPreferenceFromLink(String(b.t ?? ''), b.subscribed === true))
})

/*
  Delivery tracking events from a future Printful or carrier connection,
  translated to this shape and signed with DELIVERY_WEBHOOK_SECRET:
    x-nlc-signature: hex HMAC-SHA256 of the raw body
    { "source": "printful" | "carrier", "event_id", "shipment_id" or "tracking_number",
      "status": "delivered" | "in_transit" | "exception" | ..., "occurred_at", "detail" }
*/
automationRoutes.post('/webhooks/delivery', async (c) => {
  if (!config.deliveryWebhookSecret) throw new HttpError(503, 'Delivery tracking is not connected yet.', 'not_configured')
  const raw = await c.req.text()
  const given = Buffer.from(c.req.header('x-nlc-signature') ?? '')
  const want = Buffer.from(createHmac('sha256', config.deliveryWebhookSecret).update(raw).digest('hex'))
  if (given.length !== want.length || !timingSafeEqual(given, want)) throw new HttpError(400, 'Invalid signature.', 'bad_signature')
  let b: Record<string, unknown>
  try {
    b = JSON.parse(raw)
  } catch {
    throw badRequest('Invalid JSON.')
  }
  const result = await ingestDeliveryEvent({
    source: oneOf(b.source, 'Source', ['printful', 'carrier'] as const),
    eventId: String(b.event_id ?? '').slice(0, 200),
    shipmentId: b.shipment_id ? uuid(b.shipment_id) : null,
    trackingNumber: b.tracking_number ? String(b.tracking_number).slice(0, 100) : null,
    status: String(b.status ?? ''),
    occurredAt: String(b.occurred_at ?? ''),
    detail: b.detail ? String(b.detail) : '',
    payload: b,
  })
  return c.json({ received: true, result })
})

/* ---------- Admin: Marketing, Email Automations ---------- */

automationRoutes.use('/admin/automations/*', adminOnly)
automationRoutes.use('/admin/automations', adminOnly)

automationRoutes.get('/admin/automations', async (c) => c.json(await automationOverview()))
automationRoutes.put('/admin/automations/timezone', async (c) => c.json(await setStoreTimezone(requireAdmin(c), (await jsonBody(c)).timezone, ip(c))))
automationRoutes.get('/admin/automations/jobs', async (c) =>
  c.json({
    jobs: await listJobs({
      kind: c.req.query('kind') ? kindOf(c.req.query('kind')) : undefined,
      status: c.req.query('status') ? oneOf(c.req.query('status'), 'Status', ['scheduled', 'held', 'sent', 'skipped', 'failed', 'canceled'] as const) : undefined,
      orderId: c.req.query('order') ? uuid(c.req.query('order')) : undefined,
      offset: Number(c.req.query('offset')) || 0,
    }),
  }),
)
automationRoutes.post('/admin/automations/jobs/:id/cancel', async (c) => {
  await cancelJob(requireAdmin(c), uuid(c.req.param('id')), ip(c))
  return c.json({ ok: true })
})
automationRoutes.put('/admin/automations/:kind', async (c) => c.json(await updateAutomation(requireAdmin(c), kindOf(c.req.param('kind')), await jsonBody(c), ip(c))))
automationRoutes.post('/admin/automations/:kind/held', async (c) => c.json(await resolveHeld(requireAdmin(c), kindOf(c.req.param('kind')), oneOf((await jsonBody(c)).action, 'Action', ['resume', 'cancel'] as const), ip(c))))
automationRoutes.post('/admin/automations/:kind/reschedule', async (c) => c.json(await reschedulePending(requireAdmin(c), kindOf(c.req.param('kind')), ip(c))))
automationRoutes.post('/admin/automations/:kind/preview', async (c) => {
  const b = await jsonBody(c)
  return c.json(await previewAutomation(kindOf(c.req.param('kind')), b.template ? (b.template as Record<string, string>) : undefined))
})
automationRoutes.post('/admin/automations/:kind/test', async (c) => {
  const actor = requireAdmin(c)
  await rateLimit(`automation-test:${actor.id}`, 20, 3600)
  return c.json(await testSend(actor, kindOf(c.req.param('kind')), (await jsonBody(c)).to, ip(c)))
})
