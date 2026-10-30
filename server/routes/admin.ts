import { Hono } from 'hono'
import { one, q } from '../db/pool.js'
import { templateInfo, renderEmail, type EmailType } from '../email/templates.js'
import { config, demoAllowed, integrationStatus } from '../env.js'
import { demoSummary, seedDemoContent } from '../seed.js'
import { adminOnly, clientIp, jsonBody, requireAdmin, type AppEnv } from '../http.js'
import { audit } from '../lib/audit.js'
import { badRequest, notFound } from '../lib/errors.js'
import { imageSize } from '../lib/files.js'
import { serveRange } from '../lib/stream.js'
import { receiveUpload } from '../lib/upload.js'
import { bool, email as emailField, int, isoDate, oneOf, str, uuid } from '../lib/validate.js'
import { previewProduct } from '../services/catalog.js'
import { customerDetail, listAdmins, listCustomers, saveCustomerNotes, setAdmin } from '../services/customers.js'
import { emailDetail, listEmails, listTemplates, removeSuppression, resendEmail, saveTemplate } from '../services/emails.js'
import { countAffectedPurchasers, grantReplacement, publishRelease } from '../services/entitlements.js'
import { addShipment, requestRefund } from '../services/orders.js'
import { adminProductDetail, adminProductList, createProduct, deleteImage, duplicateProduct, saveVariants, setProductState, updateImages, updateProduct } from '../services/products.js'
import { ordersCsv, revenueReport, salesCsv } from '../services/reports.js'
import { defaultSettings, getSettings, setSetting, type Settings } from '../services/settings.js'
import {
  adminTutorial,
  adminTutorialList,
  captionText,
  createMuxUpload,
  createTutorial,
  processLocalVideo,
  recordUploadFailure,
  recordUploadStart,
  setCaption,
  setEmbed,
  setTutorialStatus,
  tutorialMedia,
  updateTutorial,
  validateVideoMeta,
} from '../services/tutorials.js'

export const adminRoutes = new Hono<AppEnv>()
// Every admin endpoint requires an authenticated admin, checked on the server.
adminRoutes.use('/admin/*', adminOnly)

const ip = (c: Parameters<typeof clientIp>[0]) => clientIp(c)

function range(c: { req: { query: (k: string) => string | undefined } }) {
  const to = c.req.query('to') ? isoDate(c.req.query('to'), 'End date') : new Date()
  const from = c.req.query('from') ? isoDate(c.req.query('from'), 'Start date') : new Date(to.getTime() - 30 * 86400000)
  if (from >= to) throw badRequest('The start date must be before the end date.')
  if (to.getTime() - from.getTime() > 3 * 366 * 86400000) throw badRequest('Reports can cover up to three years.')
  return { from, to, includeDemo: c.req.query('demo') !== '0' }
}

/* ---------- Overview and reports ---------- */

adminRoutes.get('/admin/overview', async (c) => {
  const report = await revenueReport(range(c))
  const counts = await one(
    `select (select count(*) from download_problem_reports where status = 'open')::int as open_reports,
            (select count(*) from support_requests where status = 'open')::int as open_support,
            (select count(*) from orders where status in ('paid','partially_refunded') and fulfillment_status in ('unfulfilled','partially_fulfilled'))::int as to_fulfill,
            (select count(*) from emails where status in ('failed','bounced','complained'))::int as email_problems,
            exists (select 1 from orders where is_demo) as has_demo`,
  )
  return c.json({ ...report, counts, integrations: integrationStatus() })
})

adminRoutes.get('/admin/reports/orders.csv', async (c) => {
  const csv = await ordersCsv(range(c))
  return c.body(csv, 200, { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="nurse-love-orders.csv"' })
})
adminRoutes.get('/admin/reports/sales.csv', async (c) => {
  const csv = await salesCsv(range(c))
  return c.body(csv, 200, { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="nurse-love-sales.csv"' })
})

/* ---------- Products ---------- */

adminRoutes.get('/admin/products', async (c) => c.json({ products: await adminProductList({ search: c.req.query('search'), status: c.req.query('status') }) }))
adminRoutes.post('/admin/products', async (c) => c.json(await createProduct(requireAdmin(c), await jsonBody(c), ip(c)), 201))
adminRoutes.get('/admin/products/:id', async (c) => c.json(await adminProductDetail(uuid(c.req.param('id')))))
adminRoutes.put('/admin/products/:id', async (c) => {
  await updateProduct(requireAdmin(c), uuid(c.req.param('id')), await jsonBody(c), ip(c))
  return c.json({ ok: true })
})
adminRoutes.get('/admin/products/:id/preview', async (c) => {
  const p = await previewProduct(uuid(c.req.param('id')))
  if (!p) throw notFound('Product')
  return c.json({ product: p })
})
adminRoutes.post('/admin/products/:id/:action{publish|unpublish|activate|deactivate|archive|unarchive}', async (c) => {
  await setProductState(requireAdmin(c), uuid(c.req.param('id')), c.req.param('action') as 'publish', ip(c))
  return c.json({ ok: true })
})
adminRoutes.post('/admin/products/:id/duplicate', async (c) => c.json(await duplicateProduct(requireAdmin(c), uuid(c.req.param('id')), ip(c)), 201))
adminRoutes.put('/admin/products/:id/variants', async (c) => {
  const b = await jsonBody<{ variants: unknown }>(c)
  await saveVariants(requireAdmin(c), uuid(c.req.param('id')), b.variants, ip(c))
  return c.json({ ok: true })
})
adminRoutes.put('/admin/products/:id/images', async (c) => {
  const b = await jsonBody<{ images: unknown }>(c)
  await updateImages(requireAdmin(c), uuid(c.req.param('id')), b.images, ip(c))
  return c.json({ ok: true })
})
adminRoutes.delete('/admin/products/:id/images/:imageId', async (c) => {
  await deleteImage(requireAdmin(c), uuid(c.req.param('id')), uuid(c.req.param('imageId')), ip(c))
  return c.json({ ok: true })
})
adminRoutes.post('/admin/products/:id/images', async (c) => {
  const actor = requireAdmin(c)
  const id = uuid(c.req.param('id'))
  if (!(await one('select 1 from products where id = $1', [id]))) throw notFound('Product')
  const kind = oneOf(c.req.query('kind'), 'Image type', ['gallery', 'sample'] as const, 'gallery')
  const f = await receiveUpload(c, 'image', `product-images/${id}`, config.limits.imageBytes)
  const size = imageSize(f.head)
  const alt = str(decodeURIComponent(c.req.header('x-alt-text') ?? ''), 'Alt text', { optional: true, max: 250 })
  const row = await one(
    `insert into product_images (product_id, kind, storage_key, content_type, width, height, alt, sort_order)
     values ($1,$2,$3,$4,$5,$6,$7,(select coalesce(max(sort_order),-1)+1 from product_images where product_id = $1 and kind = $2)) returning id, kind, alt, width, height, sort_order, variant_id`,
    [id, kind, f.key, f.contentType, size?.width ?? null, size?.height ?? null, alt],
  )
  await audit({ actor, action: 'product.image_uploaded', entityType: 'product', entityId: id, summary: `Uploaded ${kind === 'sample' ? 'a sample page image' : 'a product photo'} (${f.fileName})`, ip: ip(c) })
  return c.json(row, 201)
})

/** Private product file upload. Stays unreleased (no customer access) until "Publish digital product update". */
adminRoutes.post('/admin/products/:id/files', async (c) => {
  const actor = requireAdmin(c)
  const id = uuid(c.req.param('id'))
  const p = await one<{ type: string; title: string }>('select type, title from products where id = $1', [id])
  if (!p) throw notFound('Product')
  if (p.type !== 'digital') throw badRequest('Only digital products have downloadable files.')
  const f = await receiveUpload(c, 'product-file', `product-files/${id}`, config.limits.productFileBytes)
  const row = await one(
    `insert into product_file_uploads (product_id, storage_key, file_name, content_type, file_size, sha256, uploaded_by) values ($1,$2,$3,$4,$5,$6,$7) returning id, file_name, content_type, file_size, created_at`,
    [id, f.key, f.fileName, f.contentType, f.size, f.sha256, actor.email],
  )
  await audit({ actor, action: 'product.file_uploaded', entityType: 'product', entityId: id, summary: `Uploaded private file ${f.fileName} for ${p.title} (not released yet)`, ip: ip(c) })
  return c.json(row, 201)
})

adminRoutes.get('/admin/products/:id/release-impact', async (c) => c.json(await countAffectedPurchasers(uuid(c.req.param('id')))))

adminRoutes.post('/admin/products/:id/releases', async (c) => {
  const actor = requireAdmin(c)
  const b = await jsonBody(c)
  if (b.confirm !== true) throw badRequest('Please confirm the release.')
  const result = await publishRelease({
    productId: uuid(c.req.param('id')),
    uploadId: uuid(b.upload_id, 'uploaded file'),
    notes: str(b.notes, 'Update notes', { optional: true, max: 2000 }),
    notify: bool(b.notify),
    idempotencyKey: str(b.idempotency_key, 'Confirmation key', { min: 8, max: 100 }),
    actor,
    ip: ip(c),
  })
  return c.json(result, result.duplicate ? 200 : 201)
})

/* ---------- Orders ---------- */

adminRoutes.get('/admin/orders', async (c) => {
  const where: string[] = ['true']
  const params: unknown[] = []
  const add = (sql: string, v: unknown) => {
    params.push(v)
    where.push(sql.replaceAll('$?', `$${params.length}`))
  }
  const search = c.req.query('search')?.trim()
  if (search) add(`(lower(o.order_number) like $? or lower(o.email) like $? or lower(o.customer_name) like $?)`, `%${search.toLowerCase()}%`)
  if (c.req.query('status')) add('o.status = $?', c.req.query('status'))
  else where.push(`o.status <> 'pending'`)
  if (c.req.query('fulfillment')) add('o.fulfillment_status = $?', c.req.query('fulfillment'))
  if (c.req.query('type') === 'digital' || c.req.query('type') === 'physical') add(`exists (select 1 from order_items oi where oi.order_id = o.id and oi.product_type = $?)`, c.req.query('type'))
  if (c.req.query('customer')) add('o.user_id = $?', c.req.query('customer'))
  if (c.req.query('from')) add('o.created_at >= $?', isoDate(c.req.query('from'), 'Start date').toISOString())
  if (c.req.query('to')) add('o.created_at < $?', isoDate(c.req.query('to'), 'End date').toISOString())
  if (c.req.query('demo') === '0') where.push('not o.is_demo')
  const limit = int(c.req.query('limit') ?? 50, 'limit', { min: 1, max: 200 })!
  const offset = int(c.req.query('offset') ?? 0, 'offset', { min: 0, max: 1_000_000 })!
  params.push(limit, offset)
  const orders = await q(
    `select o.id, o.order_number, o.customer_name, o.email, o.status, o.fulfillment_status, o.total_cents, o.refunded_cents, o.created_at, o.paid_at, o.is_demo, o.user_id,
            (select string_agg(distinct oi.product_type, ',') from order_items oi where oi.order_id = o.id) as types,
            (select count(*) from order_items oi where oi.order_id = o.id)::int as item_count
       from orders o where ${where.join(' and ')} order by o.created_at desc limit $${params.length - 1} offset $${params.length}`,
    params,
  )
  return c.json({ orders })
})

adminRoutes.get('/admin/orders/:id', async (c) => {
  const id = uuid(c.req.param('id'))
  const order = await one<Record<string, unknown>>('select o.*, u.name as account_name from orders o left join "user" u on u.id = o.user_id where o.id = $1', [id])
  if (!order) throw notFound('Order')
  const [items, refunds, shipments, notes, updates, entitlements, events, emails, payments] = await Promise.all([
    q('select * from order_items where order_id = $1 order by product_type, title_snapshot', [id]),
    q('select * from refunds where order_id = $1 order by created_at', [id]),
    q('select * from shipments where order_id = $1 order by created_at', [id]),
    q('select * from order_notes where order_id = $1 order by created_at', [id]),
    q('select * from order_updates where order_id = $1 order by created_at', [id]),
    q(
      `select e.id, e.order_item_id, e.status, e.source, e.reason, e.granted_by, e.granted_at, e.redeemed_at, v.version_number
         from entitlements e join order_items oi on oi.id = e.order_item_id join product_versions v on v.id = e.version_id where oi.order_id = $1 order by e.granted_at`,
      [id],
    ),
    q(
      `select d.event, d.detail, d.created_at, d.ip, d.entitlement_id from download_events d join entitlements e on e.id = d.entitlement_id join order_items oi on oi.id = e.order_item_id
        where oi.order_id = $1 order by d.created_at desc limit 100`,
      [id],
    ),
    q('select id, type, subject, status, requested_at from emails where related_order_id = $1 order by requested_at', [id]),
    q(`select id, type, status, received_at from payment_events where payload->'data'->'object'->'metadata'->>'order_id' = $1 order by received_at`, [id]),
  ])
  return c.json({ order, items, refunds, shipments, notes, updates, entitlements, downloadEvents: events, emails, paymentEvents: payments })
})

adminRoutes.post('/admin/orders/:id/notes', async (c) => {
  const actor = requireAdmin(c)
  const id = uuid(c.req.param('id'))
  const body = str((await jsonBody(c)).body, 'Note', { min: 1, max: 4000 })
  const row = await one(`insert into order_notes (order_id, body, author_id, author_email) values ($1,$2,$3,$4) returning *`, [id, body, actor.id, actor.email])
  return c.json(row, 201)
})

adminRoutes.post('/admin/orders/:id/updates', async (c) => {
  const actor = requireAdmin(c)
  const id = uuid(c.req.param('id'))
  const message = str((await jsonBody(c)).message, 'Update', { min: 2, max: 1000 })
  const row = await one(`insert into order_updates (order_id, message, created_by) values ($1,$2,$3) returning *`, [id, message, actor.email])
  await audit({ actor, action: 'order.customer_update', entityType: 'order', entityId: id, summary: `Posted a customer update: ${message}`, ip: ip(c) })
  return c.json(row, 201)
})

adminRoutes.post('/admin/orders/:id/shipments', async (c) => {
  const b = await jsonBody(c)
  const tracking_url = str(b.tracking_url, 'Tracking link', { optional: true, max: 500 })
  if (tracking_url && !/^https:\/\//.test(tracking_url)) throw badRequest('Tracking links must start with https://')
  const row = await addShipment(
    requireAdmin(c),
    uuid(c.req.param('id')),
    {
      carrier: str(b.carrier, 'Carrier', { optional: true, max: 60 }),
      tracking_number: str(b.tracking_number, 'Tracking number', { optional: true, max: 100 }),
      tracking_url,
      status: oneOf(b.status, 'Shipment status', ['label_created', 'shipped', 'in_transit', 'delivered', 'exception'] as const, 'shipped'),
      notify: bool(b.notify),
      partial: bool(b.partial),
    },
    ip(c),
  )
  return c.json(row, 201)
})

adminRoutes.patch('/admin/shipments/:id', async (c) => {
  const actor = requireAdmin(c)
  const b = await jsonBody(c)
  const status = oneOf(b.status, 'Shipment status', ['label_created', 'shipped', 'in_transit', 'delivered', 'exception'] as const)
  const row = await one<{ order_id: string }>(`update shipments set status = $2, delivered_at = case when $2 = 'delivered' then now() else delivered_at end where id = $1 returning order_id`, [uuid(c.req.param('id')), status])
  if (!row) throw notFound('Shipment')
  await q(`insert into order_updates (order_id, message, created_by) values ($1,$2,$3)`, [row.order_id, `Shipment status: ${status.replace('_', ' ')}.`, actor.email])
  await audit({ actor, action: 'order.shipment_updated', entityType: 'order', entityId: row.order_id, summary: `Shipment marked ${status.replace('_', ' ')}`, ip: ip(c) })
  return c.json({ ok: true })
})

adminRoutes.patch('/admin/orders/:id/fulfillment', async (c) => {
  const actor = requireAdmin(c)
  const status = oneOf((await jsonBody(c)).status, 'Fulfillment status', ['unfulfilled', 'partially_fulfilled', 'fulfilled'] as const)
  const r = await one<{ order_number: string }>(`update orders set fulfillment_status = $2, updated_at = now() where id = $1 and fulfillment_status <> 'not_required' returning order_number`, [uuid(c.req.param('id')), status])
  if (!r) throw badRequest('This order has nothing to fulfill.')
  await audit({ actor, action: 'order.fulfillment_changed', entityType: 'order', entityId: c.req.param('id'), summary: `Set ${r.order_number} to ${status.replace('_', ' ')}`, ip: ip(c) })
  return c.json({ ok: true })
})

adminRoutes.post('/admin/orders/:id/refunds', async (c) => {
  const b = await jsonBody<{ items?: Array<{ order_item_id: string; quantity: number }>; amount_cents: number; reason?: string; restock?: boolean; idempotency_key: string }>(c)
  const items = (b.items ?? []).map((i) => ({ order_item_id: uuid(i.order_item_id, 'line'), quantity: int(i.quantity, 'Quantity', { min: 1, max: 1000 })! }))
  const result = await requestRefund(
    requireAdmin(c),
    uuid(c.req.param('id')),
    { items, amount_cents: int(b.amount_cents, 'Refund amount', { min: 1 })!, reason: str(b.reason, 'Reason', { optional: true, max: 500 }), restock: bool(b.restock), idempotencyKey: str(b.idempotency_key, 'Confirmation key', { min: 8, max: 100 }) },
    ip(c),
  )
  return c.json(result, 201)
})

adminRoutes.post('/admin/orders/:id/cancel', async (c) => {
  const actor = requireAdmin(c)
  const r = await one<{ order_number: string }>(`update orders set status = 'canceled', canceled_at = now(), updated_at = now() where id = $1 and status = 'pending' returning order_number`, [uuid(c.req.param('id'))])
  if (!r) throw badRequest('Only unpaid (pending) orders can be canceled here. Paid orders are refunded instead.')
  await audit({ actor, action: 'order.canceled', entityType: 'order', entityId: c.req.param('id'), summary: `Canceled unpaid order ${r.order_number}`, ip: ip(c) })
  return c.json({ ok: true })
})

/** Audited exception for genuine delivery problems. */
adminRoutes.post('/admin/order-items/:id/replacement-download', async (c) => {
  const b = await jsonBody(c)
  const ent = await grantReplacement(requireAdmin(c), uuid(c.req.param('id')), str(b.reason, 'Reason', { min: 5, max: 500 }), b.report_id ? uuid(b.report_id, 'report') : null, ip(c))
  return c.json(ent, 201)
})

adminRoutes.get('/admin/download-reports', async (c) => {
  const status = c.req.query('status') ?? 'open'
  const rows = await q(
    `select r.id, r.message, r.status, r.resolution_note, r.created_at, r.resolved_by, u.name, u.email, u.id as user_id, oi.id as order_item_id, oi.title_snapshot as title, o.order_number, o.id as order_id,
            e.status as entitlement_status
       from download_problem_reports r join "user" u on u.id = r.user_id join entitlements e on e.id = r.entitlement_id
       join order_items oi on oi.id = e.order_item_id join orders o on o.id = oi.order_id
      where ($1 = 'all' or r.status = $1) order by r.created_at desc limit 200`,
    [status],
  )
  return c.json({ reports: rows })
})

adminRoutes.post('/admin/download-reports/:id/decline', async (c) => {
  const actor = requireAdmin(c)
  const note = str((await jsonBody(c)).note, 'Note', { min: 3, max: 500 })
  const r = await one(`update download_problem_reports set status = 'declined', resolution_note = $2, resolved_by = $3, resolved_at = now() where id = $1 and status = 'open' returning id`, [uuid(c.req.param('id')), note, actor.email])
  if (!r) throw notFound('Open report')
  await audit({ actor, action: 'download.report_declined', entityType: 'download_report', entityId: c.req.param('id'), summary: `Closed a download problem report without a replacement: ${note}`, ip: ip(c) })
  return c.json({ ok: true })
})

adminRoutes.get('/admin/support', async (c) => {
  const rows = await q(
    `select s.id, s.subject, s.message, s.status, s.created_at, u.name, u.email, u.id as user_id, o.order_number, o.id as order_id
       from support_requests s join "user" u on u.id = s.user_id left join orders o on o.id = s.order_id
      where ($1 = 'all' or s.status = $1) order by s.created_at desc limit 200`,
    [c.req.query('status') ?? 'open'],
  )
  return c.json({ requests: rows })
})
adminRoutes.post('/admin/support/:id/close', async (c) => {
  requireAdmin(c)
  await q(`update support_requests set status = 'closed' where id = $1`, [uuid(c.req.param('id'))])
  return c.json({ ok: true })
})

/* ---------- Customers ---------- */

adminRoutes.get('/admin/customers', async (c) => c.json({ customers: await listCustomers(c.req.query('search') ?? '') }))
adminRoutes.get('/admin/customers/:id', async (c) => c.json(await customerDetail(c.req.param('id'))))
adminRoutes.put('/admin/customers/:id/notes', async (c) => {
  await saveCustomerNotes(requireAdmin(c), c.req.param('id'), String((await jsonBody(c)).notes ?? ''), ip(c))
  return c.json({ ok: true })
})

/* ---------- Email center ---------- */

adminRoutes.get('/admin/emails', async (c) =>
  c.json({ emails: await listEmails({ search: c.req.query('search'), type: c.req.query('type'), status: c.req.query('status'), from: c.req.query('from'), to: c.req.query('to'), offset: Number(c.req.query('offset') ?? 0) }) }),
)
adminRoutes.get('/admin/emails/:id', async (c) => c.json(await emailDetail(uuid(c.req.param('id')))))
adminRoutes.post('/admin/emails/:id/resend', async (c) => {
  const b = await jsonBody(c)
  return c.json(await resendEmail(requireAdmin(c), uuid(c.req.param('id')), str(b.idempotency_key, 'Confirmation key', { min: 8, max: 100 }), ip(c)))
})
adminRoutes.delete('/admin/email-suppressions/:email', async (c) => {
  await removeSuppression(requireAdmin(c), emailField(decodeURIComponent(c.req.param('email'))), ip(c))
  return c.json({ ok: true })
})
adminRoutes.get('/admin/email-templates', async (c) => c.json({ templates: await listTemplates() }))
adminRoutes.put('/admin/email-templates/:type', async (c) => {
  const b = await jsonBody(c)
  await saveTemplate(requireAdmin(c), c.req.param('type'), b as never, ip(c))
  return c.json({ ok: true })
})
adminRoutes.post('/admin/email-templates/:type/preview', async (c) => {
  const type = c.req.param('type') as EmailType
  if (!(type in templateInfo)) throw notFound('Template')
  const b = await jsonBody(c)
  const sample: Record<string, string> = { name: 'Sample Customer', order_number: 'NLC-10000', order_total: '$0.00', product_list: 'Sample Product', carrier: 'Sample Carrier', tracking_number: '0000', product_title: 'Sample Product', version: '2', update_notes: 'Sample update notes.' }
  const out = renderEmail({ template: { subject: String(b.subject ?? ''), heading: String(b.heading ?? ''), body: String(b.body ?? ''), button_label: String(b.button_label ?? '') }, vars: sample, buttonUrl: `${config.appUrl}/#account` })
  return c.json(out)
})

/* ---------- Tutorials ---------- */

adminRoutes.get('/admin/tutorials', async (c) => c.json({ tutorials: await adminTutorialList(), provider: config.video.provider }))
adminRoutes.post('/admin/tutorials', async (c) => c.json(await createTutorial(requireAdmin(c), await jsonBody(c), ip(c)), 201))
adminRoutes.get('/admin/tutorials/:id', async (c) => c.json(await adminTutorial(uuid(c.req.param('id')))))
adminRoutes.put('/admin/tutorials/:id', async (c) => {
  await updateTutorial(requireAdmin(c), uuid(c.req.param('id')), await jsonBody(c), ip(c))
  return c.json({ ok: true })
})
adminRoutes.post('/admin/tutorials/:id/:action{publish|unpublish|archive|restore}', async (c) => {
  await setTutorialStatus(requireAdmin(c), uuid(c.req.param('id')), c.req.param('action') as 'publish', ip(c))
  return c.json({ ok: true })
})
adminRoutes.put('/admin/tutorials/:id/embed', async (c) => {
  const b = await jsonBody(c)
  return c.json({ embed_url: await setEmbed(requireAdmin(c), uuid(c.req.param('id')), b.url ? String(b.url) : null, ip(c)) })
})
adminRoutes.put('/admin/tutorials/:id/captions', async (c) => {
  await setCaption(requireAdmin(c), uuid(c.req.param('id')), await jsonBody(c), ip(c))
  return c.json({ ok: true })
})
adminRoutes.delete('/admin/tutorials/:id/captions/:lang', async (c) => {
  const actor = requireAdmin(c)
  await q('delete from tutorial_captions where tutorial_id = $1 and srclang = $2', [uuid(c.req.param('id')), c.req.param('lang')])
  await audit({ actor, action: 'tutorial.captions_removed', entityType: 'tutorial', entityId: c.req.param('id'), summary: `Removed ${c.req.param('lang')} captions`, ip: ip(c) })
  return c.json({ ok: true })
})
adminRoutes.post('/admin/tutorials/:id/thumbnail', async (c) => {
  const actor = requireAdmin(c)
  const id = uuid(c.req.param('id'))
  if (!(await one('select 1 from tutorials where id = $1', [id]))) throw notFound('Tutorial')
  const f = await receiveUpload(c, 'image', `tutorial-thumbnails/${id}`, config.limits.imageBytes)
  await q('update tutorials set thumbnail_key = $2, thumbnail_type = $3, updated_at = now() where id = $1', [id, f.key, f.contentType])
  await audit({ actor, action: 'tutorial.thumbnail_uploaded', entityType: 'tutorial', entityId: id, summary: `Uploaded a thumbnail (${f.fileName})`, ip: ip(c) })
  return c.json({ ok: true })
})
adminRoutes.delete('/admin/tutorials/:id/thumbnail', async (c) => {
  requireAdmin(c)
  await q('update tutorials set thumbnail_key = null, thumbnail_type = null where id = $1', [uuid(c.req.param('id'))])
  return c.json({ ok: true })
})

/** Direct upload to this server (local provider). Processing continues after the response. */
adminRoutes.put('/admin/tutorials/:id/video', async (c) => {
  const actor = requireAdmin(c)
  const id = uuid(c.req.param('id'))
  if (config.video.provider === 'mux') throw badRequest('This store uploads videos to Mux. Use the Mux upload instead.')
  const meta = { name: decodeURIComponent(c.req.header('x-file-name') ?? 'video'), type: c.req.header('content-type') ?? '', size: Number(c.req.header('content-length') ?? 0) }
  validateVideoMeta(meta)
  const uploadId = await recordUploadStart(id, 'local', meta)
  let f
  try {
    f = await receiveUpload(c, 'video', `tutorial-videos/${id}/${uploadId}`, config.limits.videoBytes)
  } catch (err) {
    await recordUploadFailure(id, uploadId, (err as Error).message)
    throw err
  }
  await q(`update video_uploads set status = 'uploaded', bytes = $2, updated_at = now() where id = $1`, [uploadId, f.size])
  await audit({ actor, action: 'tutorial.video_uploaded', entityType: 'tutorial', entityId: id, summary: `Uploaded video ${f.fileName}`, ip: ip(c) })
  void processLocalVideo(id, uploadId, f.key, f.contentType)
  return c.json({ uploadId, status: 'processing' }, 202)
})

adminRoutes.post('/admin/tutorials/:id/video/mux-upload', async (c) => {
  const b = await jsonBody(c)
  return c.json(await createMuxUpload(requireAdmin(c), uuid(c.req.param('id')), { name: str(b.name, 'File name', { max: 200 }), size: Number(b.size), type: String(b.type ?? '') }), 201)
})

/** The browser reports a failed direct upload (for example a dropped connection). */
adminRoutes.post('/admin/tutorials/:id/video/uploads/:uploadId/failed', async (c) => {
  requireAdmin(c)
  const msg = str((await jsonBody(c)).message, 'Message', { optional: true, max: 300 }) || 'The upload did not finish.'
  await recordUploadFailure(uuid(c.req.param('id')), uuid(c.req.param('uploadId')), msg)
  return c.json({ ok: true })
})

for (const kind of ['video', 'poster', 'thumbnail'] as const) {
  adminRoutes.get(`/admin/tutorials/:id/preview/${kind}`, async (c) => {
    const m = await tutorialMedia({ id: uuid(c.req.param('id')) }, kind, 'admin')
    return serveRange(c, m.key, m.type, 'private, no-store')
  })
}
adminRoutes.get('/admin/tutorials/:id/preview/captions/:lang', async (c) => c.body(await captionText({ id: uuid(c.req.param('id')) }, c.req.param('lang'), 'admin'), 200, { 'content-type': 'text/vtt; charset=utf-8', 'cache-control': 'private, no-store' }))

/* ---------- Settings, access and audit ---------- */

adminRoutes.get('/admin/settings', async (c) =>
  c.json({ settings: await getSettings(), integrations: integrationStatus(), admins: await listAdmins(), appUrl: config.appUrl, demo: { allowed: demoAllowed(), ...(await demoSummary()) } }),
)

/** Staging only (DEMO_CONTENT=true): adds any missing labeled demo content. Safe to press twice. */
adminRoutes.post('/admin/demo', async (c) => {
  const b = await jsonBody(c)
  const reviewerEmail = b.reviewer_email ? emailField(b.reviewer_email, 'Reviewer email') : null
  return c.json(await seedDemoContent({ reviewerEmail, actor: requireAdmin(c) }))
})

adminRoutes.put('/admin/settings/:section', async (c) => {
  const actor = requireAdmin(c)
  const section = c.req.param('section') as keyof Settings
  if (!(section in defaultSettings)) throw notFound('Settings section')
  const b = (await jsonBody(c)) as Record<string, unknown>
  const current = (await getSettings())[section] as Record<string, unknown>
  const next: Record<string, unknown> = { ...current }
  // Only known keys, with types matching the defaults, are accepted.
  for (const [k, def] of Object.entries(defaultSettings[section] as Record<string, unknown>)) {
    if (!(k in b)) continue
    const v = b[k]
    if (typeof def === 'string') next[k] = str(v, k, { optional: true, max: k.includes('policy') || k === 'terms' || k === 'privacy' ? 20000 : 500 })
    else if (typeof def === 'boolean') next[k] = bool(v)
    else if (Array.isArray(def)) {
      if (!Array.isArray(v) || v.length > 200) throw badRequest(`${k} must be a list.`)
      next[k] = v
    } else if (def === null || typeof def === 'number') next[k] = int(v, k, { optional: true })
  }
  if (section === 'policies') {
    next.refund_download_policy = oneOf(next.refund_download_policy, 'Refund download policy', ['revoke_unredeemed', 'keep'] as const)
    next.status = oneOf(next.status, 'Policy status', ['awaiting_approval', 'approved'] as const)
    next.digital_repurchase = 'block'
  }
  if (section === 'homepage') next.featured_product_ids = (next.featured_product_ids as unknown[]).slice(0, 12).map((x) => uuid(x, 'product'))
  if (section === 'shipping') next.countries = (next.countries as unknown[]).slice(0, 50).map((x) => str(x, 'Country', { min: 2, max: 2 }).toUpperCase())
  if (section === 'freebies') {
    next.items = (next.items as Array<Record<string, unknown>>).slice(0, 30).map((f) => ({ id: f.id ? str(f.id, 'id', { max: 60 }) : crypto.randomUUID(), title: str(f.title, 'Freebie title', { min: 1, max: 120 }), summary: str(f.summary, 'Freebie summary', { optional: true, max: 300 }), published: bool(f.published) }))
  }
  await setSetting(section, next as never, actor, ip(c))
  return c.json({ ok: true })
})

adminRoutes.post('/admin/admins', async (c) => {
  const b = await jsonBody(c)
  await setAdmin(requireAdmin(c), emailField(b.email), b.admin !== false, ip(c))
  return c.json({ ok: true })
})

adminRoutes.get('/admin/audit', async (c) => {
  const params: unknown[] = []
  const where: string[] = ['true']
  if (c.req.query('search')) {
    params.push(`%${c.req.query('search')!.toLowerCase()}%`)
    where.push(`(lower(summary) like $${params.length} or lower(action) like $${params.length} or lower(coalesce(actor_email,'')) like $${params.length})`)
  }
  if (c.req.query('entity')) {
    params.push(c.req.query('entity'))
    where.push(`entity_type = $${params.length}`)
  }
  if (c.req.query('entity_id')) {
    params.push(c.req.query('entity_id'))
    where.push(`entity_id = $${params.length}`)
  }
  const rows = await q(`select id, actor_email, action, entity_type, entity_id, summary, data, ip, created_at from audit_log where ${where.join(' and ')} order by id desc limit 300`, params)
  return c.json({ entries: rows })
})
