import type { SessionUser } from '../auth.js'
import { one, q } from '../db/pool.js'
import { audit } from '../lib/audit.js'
import { badRequest, notFound } from '../lib/errors.js'
import { listDownloads } from './entitlements.js'

export async function listCustomers(search: string, limit = 50, offset = 0) {
  const params: unknown[] = [Math.min(limit, 200), offset]
  let where = `u.role = 'customer'`
  if (search) {
    params.push(`%${search.toLowerCase()}%`)
    where += ` and (lower(u.name) like $3 or lower(u.email) like $3 or exists (select 1 from orders o where o.user_id = u.id and lower(o.order_number) like $3))`
  }
  return q(
    `select u.id, u.name, u.email, u."createdAt" as created_at,
            (select count(*) from orders o where o.user_id = u.id and o.status in ('paid','partially_refunded','refunded','disputed'))::int as orders,
            (select coalesce(sum(o.total_cents - o.refunded_cents),0) from orders o where o.user_id = u.id and o.status in ('paid','partially_refunded','refunded','disputed'))::int as spent_cents,
            (select max(o.paid_at) from orders o where o.user_id = u.id) as last_order_at,
            exists (select 1 from orders o where o.user_id = u.id and o.is_demo) as is_demo
       from "user" u where ${where} order by u."createdAt" desc limit $1 offset $2`,
    params,
  )
}

export async function customerDetail(id: string) {
  const u = await one<Record<string, unknown>>(`select u.id, u.name, u.email, u.role, u."createdAt" as created_at, u."emailVerified" as email_verified, cp.order_updates, cp.product_updates, cp.marketing, cp.admin_notes from "user" u left join customer_profiles cp on cp.user_id = u.id where u.id = $1`, [id])
  if (!u) throw notFound('Customer')
  const [orders, downloads, entitlements, events, emails, support, reports, addresses] = await Promise.all([
    q(`select id, order_number, status, fulfillment_status, total_cents, refunded_cents, created_at, paid_at, is_demo from orders where user_id = $1 order by created_at desc`, [id]),
    listDownloads(id),
    q(
      `select e.id, e.status, e.source, e.reason, e.granted_by, e.granted_at, e.redeemed_at, e.order_item_id, v.version_number, oi.title_snapshot as title, o.order_number
         from entitlements e join product_versions v on v.id = e.version_id join order_items oi on oi.id = e.order_item_id join orders o on o.id = oi.order_id
        where e.user_id = $1 order by e.granted_at desc`,
      [id],
    ),
    q(`select d.event, d.detail, d.created_at, d.ip, d.entitlement_id from download_events d where d.user_id = $1 order by d.created_at desc limit 100`, [id]),
    q(`select id, type, subject, status, requested_at from emails where related_user_id = $1 order by requested_at desc limit 50`, [id]),
    q(`select s.id, s.subject, s.message, s.status, s.created_at, o.order_number from support_requests s left join orders o on o.id = s.order_id where s.user_id = $1 order by s.created_at desc`, [id]),
    q(`select r.id, r.message, r.status, r.resolution_note, r.created_at, r.entitlement_id, e.order_item_id from download_problem_reports r join entitlements e on e.id = r.entitlement_id where r.user_id = $1 order by r.created_at desc`, [id]),
    q(`select * from addresses where user_id = $1 order by is_default desc, created_at`, [id]),
  ])
  const spent = orders.filter((o) => ['paid', 'partially_refunded', 'refunded', 'disputed'].includes(String(o.status))).reduce((n, o) => n + Number(o.total_cents) - Number(o.refunded_cents), 0)
  return { customer: u, totalSpentCents: spent, orders, downloads, entitlements, downloadEvents: events, emails, support, reports, addresses }
}

export async function saveCustomerNotes(actor: SessionUser, id: string, notes: string, ip?: string) {
  if (notes.length > 5000) throw badRequest('Notes must be 5000 characters or fewer.')
  await q(`insert into customer_profiles (user_id, admin_notes) values ($1,$2) on conflict (user_id) do update set admin_notes = excluded.admin_notes, updated_at = now()`, [id, notes])
  await audit({ actor, action: 'customer.notes_updated', entityType: 'customer', entityId: id, summary: 'Updated internal customer notes', ip })
}

export async function listAdmins() {
  return q(`select id, name, email, "createdAt" as created_at from "user" where role = 'admin' order by "createdAt"`)
}

export async function setAdmin(actor: SessionUser, emailAddress: string, makeAdmin: boolean, ip?: string) {
  const u = await one<{ id: string; role: string }>('select id, role from "user" where lower(email) = lower($1)', [emailAddress])
  if (!u) throw notFound('An account with that email')
  if (!makeAdmin) {
    if (u.id === actor.id) throw badRequest('You cannot remove your own admin access.')
    const count = await one<{ n: number }>(`select count(*)::int as n from "user" where role = 'admin'`)
    if ((count?.n ?? 0) <= 1) throw badRequest('The store must keep at least one admin.')
  }
  await q('update "user" set role = $2 where id = $1', [u.id, makeAdmin ? 'admin' : 'customer'])
  // Sign the person out everywhere so the new role applies immediately.
  await q('delete from "session" where "userId" = $1', [u.id])
  await audit({ actor, action: makeAdmin ? 'admin.granted' : 'admin.revoked', entityType: 'user', entityId: u.id, summary: `${makeAdmin ? 'Granted' : 'Removed'} admin access for ${emailAddress}`, ip })
}
