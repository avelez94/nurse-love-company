import { Webhook } from 'svix'
import type { SessionUser } from '../auth.js'
import { one, q } from '../db/pool.js'
import { kickDispatcher } from '../email/outbox.js'
import { contactSuppressed } from './consent.js'
import { AUTOMATION_TYPES, defaultTemplates, templateInfo, validateTemplate, type EmailType, type TemplateText } from '../email/templates.js'
import { config } from '../env.js'
import { audit } from '../lib/audit.js'
import { badRequest, HttpError, notFound } from '../lib/errors.js'

export async function listEmails(f: { search?: string; type?: string; status?: string; from?: string; to?: string; limit?: number; offset?: number }) {
  const where: string[] = ['true']
  const params: unknown[] = []
  const add = (sql: string, v: unknown) => {
    params.push(v)
    where.push(sql.replace('$?', `$${params.length}`))
  }
  if (f.search) {
    params.push(`%${f.search.toLowerCase()}%`)
    const n = params.length
    where.push(`(lower(e.to_email) like $${n} or lower(e.subject) like $${n} or lower(coalesce(e.resend_id,'')) like $${n} or lower(coalesce(o.order_number,'')) like $${n})`)
  }
  if (f.type) add('e.type = $?', f.type)
  if (f.status) add('e.status = $?', f.status)
  if (f.from) add('e.requested_at >= $?', f.from)
  if (f.to) add('e.requested_at < $?', f.to)
  params.push(Math.min(f.limit ?? 50, 200), f.offset ?? 0)
  return q(
    `select e.id, e.type, e.to_email, e.subject, e.status, e.requested_at, e.sent_at, e.delivered_at, e.bounced_at, e.failed_at, e.resend_id, e.resent_from_id, e.is_demo,
            o.order_number, e.related_order_id, e.related_user_id
       from emails e left join orders o on o.id = e.related_order_id
      where ${where.join(' and ')} order by e.requested_at desc limit $${params.length - 1} offset $${params.length}`,
    params,
  )
}

export async function emailDetail(id: string) {
  const e = await one<Record<string, unknown>>(
    `select e.*, o.order_number, u.name as customer_name from emails e left join orders o on o.id = e.related_order_id left join "user" u on u.id = e.related_user_id where e.id = $1`,
    [id],
  )
  if (!e) throw notFound('Email')
  const events = await q('select id, type, occurred_at, received_at, payload from email_events where email_id = $1 order by coalesce(occurred_at, received_at)', [id])
  const resends = await q('select id, status, requested_at, resent_by from emails where resent_from_id = $1 order by requested_at', [id])
  const suppressed = await one('select reason, created_at from email_suppressions where email = lower($1)', [e.to_email])
  return { email: e, events, resends, suppressed }
}

/**
 * Resends the original snapshot as a NEW email linked to the original.
 * The idempotency key comes from the admin's confirmation dialog, so repeated
 * clicks create one email. Resending never changes download entitlements.
 */
export async function resendEmail(actor: SessionUser, id: string, idempotencyKey: string, ip?: string) {
  if (!idempotencyKey || idempotencyKey.length < 8) throw badRequest('Missing confirmation key. Please reopen the resend dialog.')
  const orig = await one<Record<string, string | null>>('select * from emails where id = $1', [id])
  if (!orig) throw notFound('Email')
  if (orig.type === 'password_reset') throw badRequest('Password reset links expire and cannot be resent. Ask the customer to request a new link from the sign in page.')
  const suppressed = await one('select 1 from email_suppressions where email = lower($1)', [orig.to_email])
  if (suppressed) throw new HttpError(409, 'This address is on the suppression list after a bounce or complaint, so it cannot be emailed. Remove it from the list only if the customer confirms the address works.', 'suppressed')
  const row = await one<{ id: string }>(
    `insert into emails (type, to_email, subject, html, text_body, related_user_id, related_order_id, related_release_id, idempotency_key, resent_from_id, resent_by, is_demo)
     select type, to_email, subject, html, text_body, related_user_id, related_order_id, related_release_id, $2, id, $3, is_demo from emails where id = $1
     on conflict (idempotency_key) do nothing returning id`,
    [id, `resend:${idempotencyKey}`, actor.email],
  )
  if (!row) {
    const existing = await one<{ id: string }>('select id from emails where idempotency_key = $1', [`resend:${idempotencyKey}`])
    return { id: existing!.id, duplicate: true }
  }
  await audit({ actor, action: 'email.resent', entityType: 'email', entityId: id, summary: `Resent "${orig.subject}" to ${orig.to_email}. Download access was not changed.`, data: { newEmailId: row.id }, ip })
  kickDispatcher()
  return { id: row.id, duplicate: false }
}

export async function removeSuppression(actor: SessionUser, emailAddress: string, ip?: string) {
  await q('delete from email_suppressions where email = lower($1)', [emailAddress])
  await audit({ actor, action: 'email.suppression_removed', entityType: 'email_address', entityId: emailAddress.toLowerCase(), summary: `Removed ${emailAddress} from the suppression list`, ip })
}

export async function listTemplates() {
  const rows = await q<TemplateText & { type: EmailType; updated_at: string; updated_by: string }>('select * from email_templates')
  // Automation emails are edited with their timing under Marketing, Email Automations.
  return (Object.keys(templateInfo) as EmailType[]).filter((type) => !AUTOMATION_TYPES.includes(type)).map((type) => {
    const row = rows.find((r) => r.type === type)
    return { type, title: templateInfo[type].title, placeholders: templateInfo[type].placeholders, ...(row ?? defaultTemplates[type]), customized: Boolean(row), updated_at: row?.updated_at ?? null }
  })
}

export async function saveTemplate(actor: SessionUser, type: string, t: TemplateText, ip?: string) {
  if (!(type in templateInfo)) throw notFound('Template')
  const clean = { subject: String(t.subject ?? ''), heading: String(t.heading ?? ''), body: String(t.body ?? ''), button_label: String(t.button_label ?? '') }
  const errors = validateTemplate(type as EmailType, clean)
  if (errors.length) throw badRequest(errors.join(' '))
  await q(
    `insert into email_templates (type, subject, heading, body, button_label, updated_by) values ($1,$2,$3,$4,$5,$6)
     on conflict (type) do update set subject = excluded.subject, heading = excluded.heading, body = excluded.body, button_label = excluded.button_label, updated_at = now(), updated_by = excluded.updated_by`,
    [type, clean.subject, clean.heading, clean.body, clean.button_label, actor.email],
  )
  await audit({ actor, action: 'email.template_saved', entityType: 'email_template', entityId: type, summary: `Edited the ${templateInfo[type as EmailType].title} email template`, ip })
}

/* Resend webhooks (signed with Svix) */

const statusFor: Record<string, { status: string; column?: string }> = {
  'email.sent': { status: 'sent', column: 'sent_at' },
  'email.delivered': { status: 'delivered', column: 'delivered_at' },
  'email.delivery_delayed': { status: 'delivery_delayed' },
  'email.bounced': { status: 'bounced', column: 'bounced_at' },
  'email.complained': { status: 'complained', column: 'complained_at' },
  'email.failed': { status: 'failed', column: 'failed_at' },
}

const rank: Record<string, number> = { queued: 0, sending: 1, sent: 2, delivery_delayed: 3, delivered: 4, failed: 5, bounced: 6, complained: 7 }

export function verifyResendWebhook(raw: string, headers: Record<string, string | undefined>) {
  if (!config.resend.webhookSecret) throw new HttpError(503, 'Resend webhook secret is not configured.', 'webhook_not_configured')
  try {
    // verify() throws when the signature or timestamp is wrong.
    new Webhook(config.resend.webhookSecret).verify(raw, {
      'svix-id': headers['svix-id'] ?? '',
      'svix-timestamp': headers['svix-timestamp'] ?? '',
      'svix-signature': headers['svix-signature'] ?? '',
    })
    return JSON.parse(raw) as { type: string; created_at?: string; data: { email_id?: string; to?: string[]; bounce?: { message?: string }; failed?: { reason?: string } } }
  } catch {
    throw new HttpError(400, 'Invalid webhook signature.', 'bad_signature')
  }
}

export async function ingestResendEvent(svixId: string, evt: { type: string; created_at?: string; data: { email_id?: string; to?: string[]; bounce?: { message?: string }; failed?: { reason?: string } } }) {
  const resendId = evt.data.email_id ?? null
  const email = resendId ? await one<{ id: string; status: string; to_email: string }>('select id, status, to_email from emails where resend_id = $1', [resendId]) : null
  const inserted = await one(
    `insert into email_events (svix_id, email_id, resend_id, type, payload, occurred_at) values ($1,$2,$3,$4,$5,$6) on conflict (svix_id) do nothing returning id`,
    [svixId, email?.id ?? null, resendId, evt.type, JSON.stringify(evt), evt.created_at ?? null],
  )
  if (!inserted) return 'duplicate'
  const map = statusFor[evt.type]
  if (email && map) {
    // Events can arrive out of order; never move a status backwards.
    const newer = (rank[map.status] ?? 0) >= (rank[email.status] ?? 0)
    const reason = evt.data.bounce?.message ?? evt.data.failed?.reason ?? null
    await q(
      `update emails set ${map.column ? `${map.column} = coalesce(${map.column}, $3::timestamptz),` : ''} status = case when $4 then $2 else status end,
              failure_reason = coalesce($5, failure_reason), last_event_at = now() where id = $1`,
      [email.id, map.status, evt.created_at ?? new Date().toISOString(), newer, reason],
    )
    if (evt.type === 'email.bounced' || evt.type === 'email.complained') {
      await q(`insert into email_suppressions (email, reason) values (lower($1), $2) on conflict (email) do nothing`, [email.to_email, evt.type === 'email.bounced' ? 'Bounced' : 'Marked as spam'])
      await contactSuppressed(email.to_email)
    }
  }
  return 'processed'
}
