/*
  Confirmed delivery for physical items. Physical review requests count from
  the real delivery time only: "shipped", "fulfilled" and estimated delivery
  dates never count. Delivery is confirmed either by a tracking event from a
  connected service (Printful or a carrier, once connected) or by the owner
  recording the date with a reason, which goes to the audit log.

  Tracking events are stored once (by source and event id), so duplicates do
  nothing, and a shipment never moves backwards: once delivered it stays
  delivered, and an older event never replaces a newer status.
*/
import type { PoolClient } from 'pg'
import type { SessionUser } from '../auth.js'
import { one, q, tx, type Queryable } from '../db/pool.js'
import { audit } from '../lib/audit.js'
import { badRequest, notFound } from '../lib/errors.js'
import { holdForDeliveryProblem, releaseDeliveryProblem, scheduleDelivered } from './automations.js'

export type ShipmentStatus = 'label_created' | 'shipped' | 'in_transit' | 'delivered' | 'exception'
const RANK: Record<ShipmentStatus, number> = { label_created: 0, shipped: 1, in_transit: 2, exception: 2, delivered: 3 }

interface ShipmentRow {
  id: string
  order_id: string
  status: ShipmentStatus
  delivered_at: string | null
  delivery_source: string
  status_at: string | null
}

/** The physical order items a shipment holds. Older shipments without item rows cover every physical item of their order. */
export async function shipmentItemIds(shipmentId: string, orderId: string, client?: Queryable) {
  const rows = await q<{ order_item_id: string }>('select order_item_id from shipment_items where shipment_id = $1', [shipmentId], client)
  if (rows.length) return rows.map((r) => r.order_item_id)
  const anyListed = await one('select 1 from shipment_items si join shipments s on s.id = si.shipment_id where s.order_id = $1', [orderId], client)
  if (anyListed) return []
  return (await q<{ id: string }>(`select id from order_items where order_id = $1 and product_type = 'physical'`, [orderId], client)).map((r) => r.id)
}

/** Records which items a new shipment holds. With no list, it takes every physical item not yet in another shipment. */
export async function assignShipmentItems(client: PoolClient, orderId: string, shipmentId: string, items: Array<{ order_item_id: string; quantity: number }>) {
  const physical = await q<{ id: string; quantity: number; shipped: number }>(
    `select oi.id, oi.quantity, coalesce((select sum(si.quantity) from shipment_items si where si.order_item_id = oi.id), 0)::int as shipped
       from order_items oi where oi.order_id = $1 and oi.product_type = 'physical'`,
    [orderId],
    client,
  )
  const list = items.length ? items : physical.filter((p) => p.quantity > p.shipped).map((p) => ({ order_item_id: p.id, quantity: p.quantity - p.shipped }))
  for (const it of list) {
    const p = physical.find((x) => x.id === it.order_item_id)
    if (!p) throw badRequest('One of the shipment items is not a physical item on this order.')
    if (!Number.isInteger(it.quantity) || it.quantity < 1 || it.quantity > p.quantity) throw badRequest('One of the shipment quantities is not valid.')
    await q('insert into shipment_items (shipment_id, order_item_id, quantity) values ($1,$2,$3) on conflict do nothing', [shipmentId, it.order_item_id, it.quantity], client)
  }
}

/** The owner records the confirmed delivery date (for example from the carrier's website). Needs a reason; audited. */
export async function recordDelivery(actor: SessionUser, shipmentId: string, deliveredAtInput: unknown, reasonInput: unknown, ip?: string) {
  const reason = String(reasonInput ?? '').trim()
  if (reason.length < 5) throw badRequest('Please give a reason, for example "Carrier tracking shows delivered".')
  if (reason.length > 300) throw badRequest('The reason is too long.')
  const deliveredAt = new Date(String(deliveredAtInput ?? ''))
  if (Number.isNaN(deliveredAt.getTime())) throw badRequest('Please enter the confirmed delivery date and time.')
  if (deliveredAt.getTime() > Date.now() + 5 * 60_000) throw badRequest('The delivery date cannot be in the future.')
  return tx(async (client) => {
    const sh = await one<ShipmentRow & { paid_at: string | null; order_number: string }>(
      `select s.*, o.paid_at, o.order_number from shipments s join orders o on o.id = s.order_id where s.id = $1 for update of s`,
      [shipmentId],
      client,
    )
    if (!sh) throw notFound('Shipment')
    if (sh.paid_at && deliveredAt < new Date(sh.paid_at)) throw badRequest('The delivery date cannot be before the order was paid.')
    const correcting = sh.status === 'delivered'
    await q(
      `update shipments set status = 'delivered', delivered_at = $2, delivery_source = 'admin', delivery_note = $3, problem = '', status_at = $2, updated_at = now() where id = $1`,
      [shipmentId, deliveredAt.toISOString(), reason],
      client,
    )
    if (!correcting) await q(`insert into order_updates (order_id, message, created_by) values ($1,'Delivered.',$2)`, [sh.order_id, actor.email], client)
    await audit(
      {
        actor,
        action: correcting ? 'shipment.delivery_corrected' : 'shipment.delivery_recorded',
        entityType: 'order',
        entityId: sh.order_id,
        summary: `${correcting ? 'Corrected' : 'Recorded'} confirmed delivery for ${sh.order_number}: ${deliveredAt.toISOString()}. Reason: ${reason}`,
        data: { shipmentId, before: { status: sh.status, delivered_at: sh.delivered_at, source: sh.delivery_source }, after: { delivered_at: deliveredAt.toISOString(), source: 'admin' } },
        ip,
      },
      client,
    )
    await scheduleDelivered(shipmentId, client)
    return { ok: true, corrected: correcting }
  })
}

/** Admin status changes other than delivery (which needs recordDelivery). */
export async function setShipmentStatus(actor: SessionUser, shipmentId: string, status: ShipmentStatus, problemInput: unknown, ip?: string) {
  if (status === 'delivered') throw badRequest('Use "Record confirmed delivery" so the delivery date and reason are saved.')
  const problem = String(problemInput ?? '').trim().slice(0, 300)
  if (status === 'exception' && problem.length < 3) throw badRequest('Please describe the delivery problem.')
  return tx(async (client) => {
    const sh = await one<ShipmentRow>('select * from shipments where id = $1 for update', [shipmentId], client)
    if (!sh) throw notFound('Shipment')
    if (sh.status === 'delivered') throw badRequest('This shipment is already delivered. To correct the date, use "Record confirmed delivery".')
    await q(`update shipments set status = $2, problem = $3, status_at = now(), updated_at = now() where id = $1`, [shipmentId, status, status === 'exception' ? problem : ''], client)
    await q(`insert into order_updates (order_id, message, created_by) values ($1,$2,$3)`, [sh.order_id, `Shipment status: ${status.replace('_', ' ')}.`, actor.email], client)
    if (status === 'exception') await holdForDeliveryProblem(shipmentId, problem, client)
    else if (sh.status === 'exception') await releaseDeliveryProblem(shipmentId, client)
    await audit({ actor, action: 'order.shipment_updated', entityType: 'order', entityId: sh.order_id, summary: `Shipment marked ${status.replace('_', ' ')}${problem && status === 'exception' ? `: ${problem}` : ''}`, ip }, client)
  })
}

export interface DeliveryEvent {
  source: 'printful' | 'carrier'
  eventId: string
  shipmentId?: string | null
  trackingNumber?: string | null
  status: string
  occurredAt: string
  detail?: string
  payload?: unknown
}

const STATUS_MAP: Record<string, ShipmentStatus> = {
  label_created: 'label_created',
  pre_transit: 'label_created',
  shipped: 'shipped',
  in_transit: 'in_transit',
  out_for_delivery: 'in_transit',
  delivered: 'delivered',
  exception: 'exception',
  failure: 'exception',
  returned: 'exception',
  return_to_sender: 'exception',
}

/**
 * Applies one tracking event. Returns what happened. Estimated delivery
 * dates are not statuses and are ignored. Safe to call with duplicates and
 * in any order.
 */
export async function ingestDeliveryEvent(e: DeliveryEvent): Promise<'duplicate' | 'unmatched' | 'ignored' | 'applied'> {
  const occurred = new Date(e.occurredAt)
  if (!e.eventId || Number.isNaN(occurred.getTime())) throw badRequest('A delivery event needs an event id and a valid time.')
  const status = STATUS_MAP[String(e.status).toLowerCase()]
  const sh = e.shipmentId
    ? await one<{ id: string }>('select id from shipments where id = $1', [e.shipmentId])
    : e.trackingNumber
      ? await one<{ id: string }>(`select id from shipments where tracking_number = $1 and tracking_number <> '' order by created_at desc limit 1`, [e.trackingNumber])
      : null
  const stored = await one<{ id: string }>(
    `insert into shipment_events (shipment_id, source, external_event_id, status, occurred_at, detail, payload) values ($1,$2,$3,$4,$5,$6,$7)
     on conflict (source, external_event_id) do nothing returning id`,
    [sh?.id ?? null, e.source, e.eventId, String(e.status).slice(0, 40), occurred.toISOString(), String(e.detail ?? '').slice(0, 300), JSON.stringify(e.payload ?? {})],
  )
  if (!stored) return 'duplicate'
  const done = async (outcome: string, result: 'unmatched' | 'ignored' | 'applied') => {
    await q('update shipment_events set outcome = $2 where id = $1', [stored.id, outcome])
    return result
  }
  if (!sh) return done('No matching shipment.', 'unmatched')
  if (!status) return done(`Status "${e.status}" is not a delivery status.`, 'ignored')

  return tx(async (client) => {
    const cur = await one<ShipmentRow>('select * from shipments where id = $1 for update', [sh.id], client)
    if (!cur) return done('Shipment missing.', 'unmatched')
    if (cur.status === 'delivered') return done('Already delivered; a delivered shipment never moves back.', 'ignored')
    if (status === 'delivered') {
      await q(`update shipments set status = 'delivered', delivered_at = $2, delivery_source = $3, problem = '', status_at = $2, updated_at = now() where id = $1`, [cur.id, occurred.toISOString(), e.source], client)
      await q(`insert into order_updates (order_id, message, created_by) values ($1,'Delivered.','system')`, [cur.order_id], client)
      await scheduleDelivered(cur.id, client)
      return done('Delivered.', 'applied')
    }
    if (cur.status_at && occurred < new Date(cur.status_at)) return done('Older than the current status.', 'ignored')
    if (status === 'exception') {
      const problem = String(e.detail ?? '').trim().slice(0, 300) || 'The carrier reported a delivery problem.'
      await q(`update shipments set status = 'exception', problem = $2, status_at = $3, updated_at = now() where id = $1`, [cur.id, problem, occurred.toISOString()], client)
      await holdForDeliveryProblem(cur.id, problem, client)
      return done('Delivery problem.', 'applied')
    }
    if (RANK[status] < RANK[cur.status] && cur.status !== 'exception') return done('Would move the shipment backwards.', 'ignored')
    await q(`update shipments set status = $2, problem = '', status_at = $3, updated_at = now() where id = $1`, [cur.id, status, occurred.toISOString()], client)
    if (cur.status === 'exception') await releaseDeliveryProblem(cur.id, client)
    return done(`Status ${status}.`, 'applied')
  })
}
