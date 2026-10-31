import { Hono } from 'hono'
import { adminOnly, clientIp, jsonBody, requireAdmin, requireUser, type AppEnv } from '../http.js'
import { badRequest } from '../lib/errors.js'
import { rateLimit } from '../lib/rate-limit.js'
import { oneOf, uuid } from '../lib/validate.js'
import { priceCart, type CartLine } from '../services/orders.js'
import {
  cancelPrintfulOrder,
  confirmPrintfulOrder,
  importVariants,
  ingestPrintfulWebhook,
  linkProduct,
  printfulOrderDetail,
  printfulOverview,
  productLinks,
  quoteShipping,
  refreshLinks,
  registerWebhook,
  retryPrintfulOrder,
  safeChecks,
  syncProduct,
  syncProducts,
  syncPrintfulOrder,
  unlinkProduct,
  verifyPrintfulWebhook,
  webhookStatus,
} from '../services/printful.js'

/* Printful: shipping quotes at checkout, its webhooks, and the admin screens. */
export const printfulRoutes = new Hono<AppEnv>()

/** Real Printful shipping options for the physical items in the bag and the customer's address. */
printfulRoutes.post('/checkout/shipping-quote', async (c) => {
  const user = requireUser(c)
  await rateLimit(`shipping-quote:${user.id}`, 20, 60)
  const b = await jsonBody<{ items: CartLine[]; address: unknown }>(c)
  const physical = (await priceCart(user, b.items ?? [])).filter((l) => l.product_type === 'physical')
  return c.json(await quoteShipping(user.id, physical, b.address))
})

/**
 * Printful webhook. Accepted only with the secret in the registered address,
 * or a valid signature when a signing secret is set. Either way it only
 * triggers a fresh read of the order from Printful's API.
 */
const webhook = async (c: import('hono').Context<AppEnv>) => {
  const raw = await c.req.text()
  if (!verifyPrintfulWebhook(raw, c.req.param('token'), c.req.header('x-pf-webhook-signature'))) {
    await rateLimit(`printful-webhook-bad:${clientIp(c)}`, 30, 600)
    return c.json({ error: 'Not authorized.' }, 401)
  }
  return c.json({ received: true, result: await ingestPrintfulWebhook(raw) })
}
printfulRoutes.post('/webhooks/printful', webhook)
printfulRoutes.post('/webhooks/printful/:token', webhook)

printfulRoutes.use('/admin/*', adminOnly)

printfulRoutes.get('/admin/printful', async (c) => c.json(await printfulOverview()))
printfulRoutes.post('/admin/printful/checks', async (c) => {
  const b = await jsonBody<{ address?: unknown }>(c)
  return c.json({ checks: await safeChecks(b.address) })
})
printfulRoutes.post('/admin/printful/refresh', async (c) => c.json({ checked: await refreshLinks(undefined, 500) }))
printfulRoutes.get('/admin/printful/products', async (c) => c.json({ products: await syncProducts() }))
printfulRoutes.get('/admin/printful/products/:id', async (c) => {
  const id = Number(c.req.param('id'))
  if (!Number.isSafeInteger(id) || id <= 0) throw badRequest('Invalid Printful product.')
  return c.json(await syncProduct(id))
})
printfulRoutes.get('/admin/printful/webhook', async (c) => c.json(await webhookStatus()))
printfulRoutes.post('/admin/printful/webhook', async (c) => c.json(await registerWebhook(requireAdmin(c), clientIp(c))))

printfulRoutes.get('/admin/products/:id/printful', async (c) => c.json(await productLinks(uuid(c.req.param('id')))))
printfulRoutes.put('/admin/products/:id/printful', async (c) => c.json(await linkProduct(requireAdmin(c), uuid(c.req.param('id')), await jsonBody(c), clientIp(c))))
printfulRoutes.post('/admin/products/:id/printful/import', async (c) => c.json(await importVariants(requireAdmin(c), uuid(c.req.param('id')), (await jsonBody<{ sync_product_id?: unknown }>(c)).sync_product_id, clientIp(c))))
printfulRoutes.delete('/admin/products/:id/printful', async (c) => c.json(await unlinkProduct(requireAdmin(c), uuid(c.req.param('id')), clientIp(c))))

printfulRoutes.get('/admin/orders/:id/printful', async (c) => c.json({ printful: await printfulOrderDetail(uuid(c.req.param('id'))) }))
printfulRoutes.post('/admin/orders/:id/printful/:action', async (c) => {
  const actor = requireAdmin(c)
  const id = uuid(c.req.param('id'))
  const action = oneOf(c.req.param('action'), 'Action', ['sync', 'retry', 'confirm', 'cancel'] as const)
  if (action === 'sync') {
    await syncPrintfulOrder(id)
    return c.json({ printful: await printfulOrderDetail(id) })
  }
  if (action === 'retry') return c.json({ printful: await retryPrintfulOrder(actor, id, clientIp(c)) })
  if (action === 'confirm') return c.json({ printful: await confirmPrintfulOrder(actor, id, clientIp(c)) })
  return c.json({ printful: await cancelPrintfulOrder(actor, id, (await jsonBody<{ reason?: unknown }>(c)).reason, clientIp(c)) })
})
