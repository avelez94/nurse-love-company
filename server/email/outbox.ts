/*
  Email outbox. Every application email is first written to the emails table
  with a unique idempotency key and a full snapshot of its rendered content,
  then a dispatcher claims queued rows one at a time (FOR UPDATE SKIP LOCKED)
  and sends them through Resend. A repeated request with the same key never
  creates a second email, and a row is never sent twice.
*/
import { Resend } from 'resend'
import { one, q, type Queryable } from '../db/pool.js'
import { config } from '../env.js'
import { defaultTemplates, renderEmail, templateInfo, type EmailType, type TemplateText } from './templates.js'

export interface QueueEmailInput {
  type: EmailType
  to: string
  userId?: string | null
  orderId?: string | null
  releaseId?: string | null
  vars: Record<string, string>
  rows?: Array<[string, string]>
  idempotencyKey: string
  isDemo?: boolean
  resentFromId?: string | null
  resentBy?: string | null
  footerNote?: string
}

export async function loadTemplate(type: EmailType, client?: Queryable): Promise<TemplateText> {
  const row = await one<TemplateText>('select subject, heading, body, button_label from email_templates where type = $1', [type], client)
  return row ?? defaultTemplates[type]
}

/** Links in emails always point at the signed in account area, never at files. */
export function accountUrl(kind: string, vars: Record<string, string>): string {
  if (kind === 'reset') return vars.url
  if (kind === 'downloads') return `${config.appUrl}/#account-downloads`
  if (kind === 'order' && vars.order_number) return `${config.appUrl}/#account-order-${encodeURIComponent(vars.order_number)}`
  return `${config.appUrl}/#account`
}

/** Writes the email to the outbox. Returns the email id (existing id if the key was already used). */
export async function queueEmail(input: QueueEmailInput, client?: Queryable): Promise<string> {
  const template = await loadTemplate(input.type, client)
  const vars = { ...input.vars, name: input.vars.name || 'there' }
  const rendered = renderEmail({
    template,
    vars,
    rows: input.rows,
    buttonUrl: accountUrl(templateInfo[input.type].buttonPath, vars),
    footerNote: input.footerNote,
  })
  const inserted = await one<{ id: string }>(
    `insert into emails (type, to_email, subject, html, text_body, related_user_id, related_order_id, related_release_id, idempotency_key, is_demo, resent_from_id, resent_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     on conflict (idempotency_key) do nothing returning id`,
    [input.type, input.to.trim().toLowerCase(), rendered.subject, rendered.html, rendered.text, input.userId ?? null, input.orderId ?? null, input.releaseId ?? null, input.idempotencyKey, input.isDemo ?? false, input.resentFromId ?? null, input.resentBy ?? null],
    client,
  )
  if (inserted) {
    if (!client) kickDispatcher()
    return inserted.id
  }
  const existing = await one<{ id: string }>('select id from emails where idempotency_key = $1', [input.idempotencyKey], client)
  return existing!.id
}

type Sender = (msg: { from: string; to: string; subject: string; html: string; text: string; idempotencyKey: string }) => Promise<{ id: string } | { error: string }>

let sender: Sender | null = null

/** Tests can inject a sender. Otherwise Resend is used when configured. */
export function setSender(s: Sender | null) {
  sender = s
}

function resendSender(): Sender | null {
  if (!config.resend.apiKey || !config.resend.from) return null
  const resend = new Resend(config.resend.apiKey)
  return async (m) => {
    const { data, error } = await resend.emails.send({ from: m.from, to: m.to, subject: m.subject, html: m.html, text: m.text }, { idempotencyKey: m.idempotencyKey })
    if (error || !data) return { error: error?.message ?? 'Unknown Resend error' }
    return { id: data.id }
  }
}

let running = false
let again = false

export function kickDispatcher() {
  if (running) {
    again = true
    return
  }
  running = true
  setImmediate(async () => {
    try {
      do {
        again = false
        while (await dispatchOne()) {
          /* keep going */
        }
      } while (again)
    } catch (err) {
      console.error('[email] dispatcher error', err)
    } finally {
      running = false
    }
  })
}

/** Claims and sends one queued email. Returns false when the queue is empty. */
export async function dispatchOne(): Promise<boolean> {
  const row = await one<{ id: string; to_email: string; subject: string; html: string; text_body: string; idempotency_key: string; is_demo: boolean }>(
    `update emails set status = 'sending', attempts = attempts + 1
     where id = (select id from emails where status = 'queued' order by requested_at for update skip locked limit 1)
     returning id, to_email, subject, html, text_body, idempotency_key, is_demo`,
  )
  if (!row) return false

  // Emails about demo content are recorded for review but never sent.
  if (row.is_demo) {
    await q(`update emails set status = 'suppressed', failure_reason = 'Demo content: recorded for review, never sent.' where id = $1`, [row.id])
    return true
  }

  const suppressed = await one('select 1 from email_suppressions where email = lower($1)', [row.to_email])
  if (suppressed) {
    await q(`update emails set status = 'suppressed', failure_reason = 'Recipient is on the suppression list (earlier bounce or complaint).' where id = $1`, [row.id])
    return true
  }

  const send = sender ?? resendSender()
  if (!send) {
    await q(`update emails set status = 'not_configured', failure_reason = 'Email sending is awaiting Resend configuration. Nothing was sent.' where id = $1`, [row.id])
    return true
  }

  try {
    const result = await send({ from: config.resend.from || 'Nurse Love Company <test@example.com>', to: row.to_email, subject: row.subject, html: row.html, text: row.text_body, idempotencyKey: row.idempotency_key })
    if ('id' in result) {
      await q(`update emails set status = 'sent', resend_id = $2, sent_at = now(), last_event_at = now() where id = $1`, [row.id, result.id])
    } else {
      await q(`update emails set status = 'failed', failure_reason = $2, failed_at = now() where id = $1`, [row.id, result.error])
    }
  } catch (err) {
    await q(`update emails set status = 'failed', failure_reason = $2, failed_at = now() where id = $1`, [row.id, (err as Error).message])
  }
  return true
}

/** Sends everything queued, waiting for completion. Used by tests and scripts. */
export async function drainOutbox() {
  while (await dispatchOne()) {
    /* keep going */
  }
}
