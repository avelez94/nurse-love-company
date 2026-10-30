import type { SessionUser } from '../auth.js'
import { one, q, type Queryable } from '../db/pool.js'
import { audit } from '../lib/audit.js'

/*
  Store settings. Values the business has not confirmed stay empty and the
  storefront shows an honest "to be added" state. Secrets are never stored
  here; they live in server environment variables.
*/
export interface Settings {
  /** timezone: IANA name used to show dates in the admin (empty: each admin's own browser timezone). */
  store: { name: string; contact_email: string; support_email: string; phone: string; mailing_address: string; timezone: string }
  homepage: { featured_product_ids: string[] }
  freebies: { items: Array<{ id: string; title: string; summary: string; published: boolean }> }
  shipping: { configured: boolean; flat_rate_cents: number | null; free_over_cents: number | null; countries: string[]; note: string }
  payments: { automatic_tax: boolean }
  policies: {
    status: 'awaiting_approval' | 'approved'
    refund_policy: string
    shipping_policy: string
    terms: string
    privacy: string
    /** What happens to unused downloads when a digital line is fully refunded. */
    refund_download_policy: 'revoke_unredeemed' | 'keep'
    /** Repurchasing a digital product the customer already owns. */
    digital_repurchase: 'block'
  }
}

export const defaultSettings: Settings = {
  store: { name: 'Nurse Love Company', contact_email: '', support_email: '', phone: '', mailing_address: '', timezone: '' },
  homepage: { featured_product_ids: [] },
  freebies: { items: [] },
  shipping: { configured: false, flat_rate_cents: null, free_over_cents: null, countries: ['US'], note: '' },
  payments: { automatic_tax: false },
  policies: { status: 'awaiting_approval', refund_policy: '', shipping_policy: '', terms: '', privacy: '', refund_download_policy: 'revoke_unredeemed', digital_repurchase: 'block' },
}

export async function getSettings(client?: Queryable): Promise<Settings> {
  const rows = await q<{ key: keyof Settings; value: unknown }>('select key, value from app_settings', [], client)
  const out = structuredClone(defaultSettings) as Settings
  for (const r of rows) if (r.key in out) Object.assign(out[r.key] as object, r.value as object)
  return out
}

export async function setSetting<K extends keyof Settings>(key: K, value: Settings[K], actor: SessionUser, ip?: string) {
  const before = await one<{ value: unknown }>('select value from app_settings where key = $1', [key])
  await q(`insert into app_settings (key, value, updated_by) values ($1,$2,$3) on conflict (key) do update set value = excluded.value, updated_at = now(), updated_by = excluded.updated_by`, [key, JSON.stringify(value), actor.email])
  await audit({ actor, action: 'settings.updated', entityType: 'settings', entityId: key, summary: `Updated ${key} settings`, data: { before: before?.value ?? null, after: value }, ip })
}
