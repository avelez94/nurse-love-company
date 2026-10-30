/*
  Email list consent.

  * Joining the list is separate from order emails: receipts, download
    emails and account security emails are always sent and never depend on
    it. Unsubscribing never touches orders or downloads.
  * Every signup and unsubscribe is recorded once with the address, the
    account, the source, the exact wording shown and the time. Records
    cannot be changed afterwards.
  * Someone who unsubscribed is never signed up again without a new,
    explicit action (a checkbox they tick themselves).
  * The list itself lives with a mailing list provider. Resend sending
    email does not make a list: the copy is sent only when a list (a Resend
    segment, RESEND_SEGMENT_ID) is configured. Until then every change waits here, marked
    "not connected", and nothing is lost.
*/
import { waitUntil } from '@vercel/functions'
import type { SessionUser } from '../auth.js'
import { one, q, type Queryable } from '../db/pool.js'
import { config } from '../env.js'
import { audit } from '../lib/audit.js'
import { badRequest } from '../lib/errors.js'
import { CONSENT_WORDING, type ConsentVersion, type MarketingStatus } from '../../shared/consent.js'

export async function marketingStatus(user: { id: string; email: string }, client?: Queryable): Promise<MarketingStatus> {
  const c = await one<{ status: 'subscribed' | 'unsubscribed'; subscribed_at: string | null; unsubscribed_at: string | null }>(
    'select status, subscribed_at, unsubscribed_at from marketing_contacts where email = lower($1)',
    [user.email],
    client,
  )
  if (!c) return { status: 'never', since: null }
  return { status: c.status, since: c.status === 'subscribed' ? c.subscribed_at : c.unsubscribed_at }
}

/**
 * Records a signup or unsubscribe. Repeating the current state records
 * nothing. Returns whether anything changed.
 */
export async function recordConsent(
  client: Queryable | undefined,
  e: { email: string; userId: string | null; action: 'subscribe' | 'unsubscribe'; source: string; version: ConsentVersion | ''; orderId?: string | null; ip?: string | null },
) {
  const email = e.email.trim().toLowerCase()
  const cur = await one<{ status: string }>('select status from marketing_contacts where email = $1 for update', [email], client)
  const next = e.action === 'subscribe' ? 'subscribed' : 'unsubscribed'
  if ((cur?.status ?? 'unsubscribed') === next && (cur || e.action === 'unsubscribe')) return false
  const wording = e.version ? CONSENT_WORDING[e.version] : ''
  await q(
    `insert into marketing_consent_events (email, user_id, action, source, wording_version, wording, order_id, ip) values ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [email, e.userId, e.action, e.source, e.version, wording, e.orderId ?? null, e.ip ?? null],
    client,
  )
  await q(
    `insert into marketing_contacts (email, user_id, status, wording_version, source, subscribed_at, unsubscribed_at, sync_status)
     values ($1,$2,$3,$4,$5, case when $3 = 'subscribed' then now() end, case when $3 = 'unsubscribed' then now() end, 'pending')
     on conflict (email) do update set user_id = coalesce(excluded.user_id, marketing_contacts.user_id), status = excluded.status,
       wording_version = case when excluded.status = 'subscribed' then excluded.wording_version else marketing_contacts.wording_version end,
       source = excluded.source,
       subscribed_at = case when excluded.status = 'subscribed' then now() else marketing_contacts.subscribed_at end,
       unsubscribed_at = case when excluded.status = 'unsubscribed' then now() else marketing_contacts.unsubscribed_at end,
       sync_status = 'pending', sync_error = '', sync_attempts = 0, change_seq = marketing_contacts.change_seq + 1, updated_at = now()`,
    [email, e.userId, next, e.version, e.source],
    client,
  )
  // The account checkbox shows the same state.
  if (e.userId) {
    await q(
      `insert into customer_profiles (user_id, marketing) values ($1,$2) on conflict (user_id) do update set marketing = excluded.marketing, updated_at = now()`,
      [e.userId, next === 'subscribed'],
      client,
    )
  }
  return true
}

/** The account settings checkbox. */
export async function setAccountMarketing(user: SessionUser, subscribe: boolean, ip?: string) {
  const changed = await recordConsent(undefined, { email: user.email, userId: user.id, action: subscribe ? 'subscribe' : 'unsubscribe', source: 'account_settings', version: subscribe ? 'account-v1' : '', ip })
  if (changed) kickMarketingSync()
  return changed
}

/** After a bounce or complaint, the list copy is sent again (as unsubscribed). The consent record itself is unchanged. */
export async function contactSuppressed(email: string) {
  await q(`update marketing_contacts set sync_status = 'pending', change_seq = change_seq + 1, updated_at = now() where email = lower($1)`, [email])
}

/* ---------- Mailing list provider ---------- */

export interface ListProvider {
  name: string
  /** The contact as the list has it, or null if it is not on the list. */
  get(email: string): Promise<{ unsubscribed: boolean } | null>
  /** Adds or updates one contact. Must be safe to repeat (no duplicates). */
  upsert(contact: { email: string; subscribed: boolean }): Promise<void>
}

let testProvider: ListProvider | null | undefined
/** Tests inject a provider; null forces "not connected". */
export function setListProvider(p: ListProvider | null | undefined) {
  testProvider = p
}

/*
  Resend contacts (global contacts, added to one segment). Used only when
  RESEND_SEGMENT_ID is set, so connecting Resend for order emails alone
  never starts sending contacts. Endpoints follow the resend SDK in this
  project (6.35): GET and PATCH /contacts/{email}, POST /contacts with
  segments. Audiences are deprecated there in favour of segments.
*/
function resendContacts(): ListProvider | null {
  if (!config.resend.apiKey || !config.resend.segmentId) return null
  const base = 'https://api.resend.com/contacts'
  const headers = { authorization: `Bearer ${config.resend.apiKey}`, 'content-type': 'application/json' }
  const fail = async (res: Response) => new Error(`Resend answered ${res.status} ${(await res.text()).slice(0, 200)}`)
  return {
    name: 'Resend contacts',
    async get(email) {
      const res = await fetch(`${base}/${encodeURIComponent(email)}`, { headers })
      if (res.status === 404) return null
      if (!res.ok) throw await fail(res)
      const body = (await res.json()) as { unsubscribed?: boolean }
      return { unsubscribed: Boolean(body.unsubscribed) }
    },
    async upsert({ email, subscribed }) {
      // Update first (no duplicate contacts); create only when the contact does not exist yet.
      const upd = await fetch(`${base}/${encodeURIComponent(email)}`, { method: 'PATCH', headers, body: JSON.stringify({ unsubscribed: !subscribed }) })
      if (upd.ok) return
      if (upd.status !== 404) throw await fail(upd)
      const res = await fetch(base, { method: 'POST', headers, body: JSON.stringify({ email, unsubscribed: !subscribed, segments: [{ id: config.resend.segmentId }] }) })
      if (!res.ok) throw await fail(res)
    },
  }
}

export const listProvider = (): ListProvider | null => (testProvider !== undefined ? testProvider : resendContacts())

/**
 * Sends waiting changes to the list. Unsubscribes and suppressed addresses
 * are never sent as subscribed. Before sending someone as subscribed, the
 * list is checked: if they unsubscribed there after their last signup was
 * already sent (for example a missed webhook), that unsubscribe is recorded
 * here instead, and they stay unsubscribed until they sign up again.
 */
export async function syncMarketingContacts(max = 200) {
  const provider = listProvider()
  if (!provider) {
    await q(`update marketing_contacts set sync_status = 'not_configured', sync_error = 'No mailing list is connected yet. The consent is stored and will be sent when one is.' where sync_status in ('pending','failed')`)
    return { synced: 0, connected: false }
  }
  // Anything waiting for a connection goes now.
  await q(`update marketing_contacts set sync_status = 'pending' where sync_status = 'not_configured'`)
  let synced = 0
  for (let i = 0; i < max; i++) {
    // One copy in flight per contact (a claim older than two minutes was abandoned).
    const c = await one<{ email: string; user_id: string | null; status: string; suppressed: boolean; change_seq: string; fresh_signup: boolean }>(
      `update marketing_contacts set sync_attempts = sync_attempts + 1, sync_claimed_at = now()
        where email = (select email from marketing_contacts
                        where (sync_status = 'pending' or (sync_status = 'failed' and sync_attempts < 5))
                          and (sync_claimed_at is null or sync_claimed_at < now() - interval '2 minutes')
                        order by updated_at for update skip locked limit 1)
        returning email, user_id, status, change_seq, exists (select 1 from email_suppressions s where s.email = marketing_contacts.email) as suppressed,
                  (synced_at is null or subscribed_at > synced_at) as fresh_signup`,
    )
    if (!c) break
    try {
      const sendAsSubscribed = c.status === 'subscribed' && !c.suppressed
      if (sendAsSubscribed && !c.fresh_signup) {
        const there = await provider.get(c.email)
        if (there?.unsubscribed) {
          // They unsubscribed on the list after this signup was sent: honour it here, never undo it.
          await recordConsent(undefined, { email: c.email, userId: c.user_id, action: 'unsubscribe', source: 'resend_unsubscribe', version: '' })
          await q(`update marketing_contacts set sync_status = 'synced', sync_error = '', synced_at = now(), sync_claimed_at = null where email = $1`, [c.email])
          continue
        }
      }
      await provider.upsert({ email: c.email, subscribed: sendAsSubscribed })
      // Marked done only if nothing changed while it was being sent; otherwise it stays pending and goes again.
      const done = await q(
        `update marketing_contacts set sync_status = $3, sync_error = $4, synced_at = now(), sync_claimed_at = null where email = $1 and change_seq = $2 returning email`,
        [c.email, c.change_seq, c.status === 'subscribed' && c.suppressed ? 'skipped' : 'synced', c.status === 'subscribed' && c.suppressed ? 'The address bounced or complained, so it was sent to the list as unsubscribed.' : ''],
      )
      if (!done.length) await q(`update marketing_contacts set sync_claimed_at = null where email = $1`, [c.email])
      synced++
    } catch (err) {
      await q(`update marketing_contacts set sync_status = case when change_seq = $3 then 'failed' else sync_status end, sync_error = $2, sync_claimed_at = null where email = $1`, [c.email, (err as Error).message.slice(0, 300), c.change_seq])
    }
  }
  return { synced, connected: true }
}

/* ---------- Changes made in Resend (webhooks) ---------- */

export interface ResendContactEvent {
  type: string
  created_at?: string
  data: { email?: string; unsubscribed?: boolean; updated_at?: string; created_at?: string; origin?: string }
}

/**
 * contact.created / contact.updated / contact.deleted / suppression.added
 * from Resend (already signature checked and stored once by the caller).
 * An unsubscribe there is recorded here as an unsubscribe. Nothing from the
 * list ever subscribes anyone: only a signup in the store does. An event
 * older than the person's latest signup in the store is ignored.
 */
export async function ingestContactEvent(evt: ResendContactEvent): Promise<string> {
  const email = String(evt.data.email ?? '').trim().toLowerCase()
  if (!email) return 'ignored: no email'
  if (evt.type === 'suppression.added') {
    await q(`insert into email_suppressions (email, reason) values ($1, $2) on conflict (email) do nothing`, [email, evt.data.origin === 'complaint' ? 'Marked as spam' : evt.data.origin === 'bounce' ? 'Bounced' : 'Suppressed in Resend'])
    await contactSuppressed(email)
    return 'suppressed'
  }
  const local = await one<{ status: string; subscribed_at: string | null; user_id: string | null }>('select status, subscribed_at, user_id from marketing_contacts where email = $1', [email])
  if (evt.type === 'contact.deleted') {
    if (!local) return 'ignored: not on our list'
    // Removed from the list by hand: not added back automatically. A new signup in the store sends it again.
    await q(`update marketing_contacts set sync_status = 'skipped', sync_error = 'Deleted in Resend. Not added back unless they sign up again.', sync_claimed_at = null where email = $1`, [email])
    return 'deleted on the list'
  }
  if ((evt.type === 'contact.updated' || evt.type === 'contact.created') && evt.data.unsubscribed === true) {
    if (!local || local.status !== 'subscribed') return 'ignored: already unsubscribed here'
    const when = new Date(evt.data.updated_at ?? evt.created_at ?? Date.now())
    if (local.subscribed_at && when < new Date(local.subscribed_at)) return 'ignored: older than their latest signup'
    await recordConsent(undefined, { email, userId: local.user_id, action: 'unsubscribe', source: 'resend_unsubscribe', version: '' })
    return 'unsubscribed'
  }
  return 'ignored'
}

let running: Promise<unknown> | null = null
export function kickMarketingSync() {
  if (running) return
  running = (async () => {
    await new Promise((r) => setImmediate(r))
    try {
      await syncMarketingContacts()
    } catch (err) {
      console.error('[marketing] sync error', err)
    } finally {
      running = null
    }
  })()
  waitUntil(running)
}

/* ---------- Admin ---------- */

export async function emailListOverview(search?: string) {
  const counts = await one<Record<string, number>>(
    `select count(*) filter (where status = 'subscribed')::int as subscribed, count(*) filter (where status = 'unsubscribed')::int as unsubscribed,
            count(*) filter (where sync_status in ('pending','not_configured'))::int as waiting, count(*) filter (where sync_status = 'failed')::int as failed,
            count(*) filter (where sync_status = 'synced')::int as synced from marketing_contacts`,
  )
  const params: unknown[] = []
  let where = 'true'
  if (search) {
    params.push(`%${search.toLowerCase()}%`)
    where = `c.email like $1`
  }
  const contacts = await q(
    `select c.*, u.name as customer_name from marketing_contacts c left join "user" u on u.id = c.user_id where ${where} order by c.updated_at desc limit 200`,
    params,
  )
  const provider = listProvider()
  return {
    counts,
    contacts,
    provider: provider ? { connected: true, name: provider.name } : { connected: false, name: null },
    wording: CONSENT_WORDING,
  }
}

export async function contactHistory(email: string) {
  return q(`select id, action, source, wording_version, wording, order_id, created_at from marketing_consent_events where email = lower($1) order by created_at desc, id desc`, [email])
}

/** Owner retry once a list is connected. */
export async function syncNow(actor: SessionUser, ip?: string) {
  if (!listProvider()) throw badRequest('No mailing list is connected yet. Consent records are kept until one is.')
  const r = await syncMarketingContacts()
  await audit({ actor, action: 'marketing.list_synced', entityType: 'email_list', entityId: 'list', summary: `Sent ${r.synced} contact changes to the mailing list`, ip })
  return r
}
