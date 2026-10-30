import { Hono } from 'hono'
import type { AppEnv } from '../http.js'
import { verifyStripeEvent } from '../lib/stripe.js'
import { ingestResendEvent, verifyResendWebhook } from '../services/emails.js'
import { handleStripeEvent } from '../services/orders.js'
import { handleMuxEvent, verifyMuxSignature } from '../services/tutorials.js'

/*
  Incoming webhooks. Each one verifies its signature against the raw body
  before anything else happens, and each event is stored by its unique id so
  repeated deliveries are processed once.
*/
export const webhookRoutes = new Hono<AppEnv>()

webhookRoutes.post('/webhooks/stripe', async (c) => {
  const raw = await c.req.text()
  const event = verifyStripeEvent(raw, c.req.header('stripe-signature'))
  const result = await handleStripeEvent(event)
  return c.json({ received: true, result })
})

webhookRoutes.post('/webhooks/resend', async (c) => {
  const raw = await c.req.text()
  const headers = { 'svix-id': c.req.header('svix-id'), 'svix-timestamp': c.req.header('svix-timestamp'), 'svix-signature': c.req.header('svix-signature') }
  const evt = verifyResendWebhook(raw, headers)
  const result = await ingestResendEvent(headers['svix-id']!, evt)
  return c.json({ received: true, result })
})

webhookRoutes.post('/webhooks/mux', async (c) => {
  const raw = await c.req.text()
  verifyMuxSignature(raw, c.req.header('mux-signature'))
  const result = await handleMuxEvent(JSON.parse(raw))
  return c.json({ received: true, result })
})
