import { useState } from 'react'
import { Dialog } from '../../components/Dialog'
import { Checkbox, FormError, Loading, Notice, Pill, TextInput, useApiData } from '../../components/ui'
import { api, errorMessage } from '../../lib/api'
import { href } from '../../lib/router'
import { useUI } from '../../lib/ui'
import { PageTitle } from './AdminApp'

/*
  Printful: the connection, the two switches that matter (selling items
  that ship, and confirming orders for production automatically), read only
  checks against the real account, the webhook, and which products are
  ready. Printful makes and ships every physical order; nothing here is
  packed or shipped by hand.
*/

interface Overview {
  configured: boolean
  storeIdSet: boolean
  webhookToken: boolean
  webhookSecret: boolean
  settings: { physical_sales: boolean; auto_confirm: boolean }
  sales: { open: boolean; reason: string }
  products: Array<{ id: string; title: string; status: string; active: boolean; variants: number; links: number; available: number }>
  jobs: Record<string, number>
}
interface Check {
  check: string
  ok: boolean
  detail: string
}

const STATE_LABEL: Record<string, string> = {
  held: 'Preorders waiting',
  queued: 'Waiting to send',
  uncertain: 'Checking with Printful',
  confirming: 'Confirming',
  draft: 'Draft, waiting for you',
  submitted: 'In production',
  needs_attention: 'Needs attention',
  canceled: 'Canceled',
  fulfilled: 'Shipped',
}

export function PrintfulPage() {
  const data = useApiData<Overview>('/api/admin/printful')
  const webhook = useApiData<{ url: string; types: string[]; ours: boolean }>(data.data?.configured ? '/api/admin/printful/webhook' : null)
  const { showToast } = useUI()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [checks, setChecks] = useState<Check[] | null>(null)
  const [sample, setSample] = useState({ name: 'Sample', address1: '', city: '', state_code: '', zip: '', country_code: 'US' })
  const [confirmAuto, setConfirmAuto] = useState(false)
  const [confirmHook, setConfirmHook] = useState(false)
  const d = data.data

  const saveSettings = async (next: Overview['settings']) => {
    setBusy(true)
    setError('')
    try {
      await api('/api/admin/settings/printful', { method: 'PUT', body: next })
      showToast('Saved.')
      await data.reload()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }
  const runChecks = async () => {
    setBusy(true)
    setError('')
    try {
      const r = await api<{ checks: Check[] }>('/api/admin/printful/checks', { body: { address: sample.address1 ? sample : undefined } })
      setChecks(r.checks)
      await data.reload()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }
  const registerHook = async () => {
    setConfirmHook(false)
    setBusy(true)
    setError('')
    try {
      await api('/api/admin/printful/webhook', { body: {} })
      showToast('Printful will now send order updates to this site.')
      await webhook.reload()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  if (data.error) return <FormError message={data.error} />
  if (!d) return <Loading />
  const attention = (d.jobs.needs_attention ?? 0) + (d.jobs.draft ?? 0)

  return (
    <>
      <PageTitle title="Printful">
        <Pill value={d.sales.open ? 'active' : 'inactive'} label={d.sales.open ? 'Items that ship: open' : 'Items that ship: closed'} />
      </PageTitle>
      <Notice>
        Printful makes and ships every physical product. When a customer pays, the order goes to Printful automatically with the exact variant, design, address and the shipping option the customer
        paid for. Tracking comes back from Printful. You never pack, stock or ship anything.
      </Notice>
      {attention > 0 && (
        <Notice tone="warn">
          {attention} order{attention === 1 ? '' : 's'} need{attention === 1 ? 's' : ''} you. Open <a href={href('admin-orders')}>Orders</a> and look for the Printful panel on each.
        </Notice>
      )}

      <section className="panel form-stack">
        <h2 className="panel__title">Connection</h2>
        <ul className="plain-list">
          <li>API token (PRINTFUL_API_TOKEN): {d.configured ? <Pill value="active" label="Set" /> : <Pill value="failed" label="Not set" />}</li>
          <li>Store (PRINTFUL_STORE_ID): {d.storeIdSet ? <Pill value="active" label="Set" /> : <span className="muted">Not set (only needed if the token can see more than one store)</span>}</li>
          <li>Webhook secret (PRINTFUL_WEBHOOK_TOKEN): {d.webhookToken ? <Pill value="active" label="Set" /> : <Pill value="pending" label="Not set" />}</li>
          {d.webhookSecret && <li>Signed webhooks (PRINTFUL_WEBHOOK_SECRET): <Pill value="active" label="Set" /></li>}
        </ul>
        {!d.configured && (
          <p className="muted">
            Add these in Vercel (Settings, Environment Variables, Production), then redeploy. Never paste the token into chat or email. The token comes from the Printful developer portal, limited to
            your Nurse Love Company store.
          </p>
        )}
      </section>

      <section className="panel form-stack">
        <h2 className="panel__title">Selling and production</h2>
        <Checkbox
          label="Open sales of items that ship"
          checked={d.settings.physical_sales}
          onChange={(v) => !busy && saveSettings({ ...d.settings, physical_sales: v })}
          hint={d.configured ? 'Customers can order linked, available physical items. Turn on only after the checks below pass.' : 'Connect Printful first.'}
        />
        <Checkbox
          label="Confirm paid orders for production automatically"
          checked={d.settings.auto_confirm}
          onChange={(v) => (v ? setConfirmAuto(true) : !busy && saveSettings({ ...d.settings, auto_confirm: false }))}
          hint="When off, each paid order waits in Printful as a draft until you confirm it from the order. Printful charges your billing method when an order is confirmed."
        />
        <FormError message={error} />
      </section>

      <section className="panel form-stack">
        <h2 className="panel__title">How Printful bills you</h2>
        <ul className="plain-list">
          <li>The customer pays you through Stripe: product price, the quoted shipping and any sales tax.</li>
          <li>Separately, Printful charges your Printful billing method (card, PayPal or Printful Wallet) for production and shipping when an order is confirmed.</li>
          <li>Set up billing in Printful (Settings, Billing) before turning on automatic confirmation. If a charge fails, Printful does not make the order; it shows here as needing attention.</li>
          <li>Refunding a customer and canceling at Printful are separate steps. Printful can only cancel before production starts.</li>
        </ul>
      </section>

      <section className="panel form-stack">
        <h2 className="panel__title">Check the real Printful setup</h2>
        <p className="muted">Read only: connects, reads your products and linked variants, and with an address, asks for a shipping quote and a cost estimate. Nothing is created or charged.</p>
        <div className="form-grid">
          <TextInput label="Sample street address (optional)" value={sample.address1} onChange={(v) => setSample({ ...sample, address1: v })} />
          <TextInput label="City" value={sample.city} onChange={(v) => setSample({ ...sample, city: v })} />
          <TextInput label="State (2 letters)" value={sample.state_code} onChange={(v) => setSample({ ...sample, state_code: v.toUpperCase() })} />
          <TextInput label="ZIP" value={sample.zip} onChange={(v) => setSample({ ...sample, zip: v })} />
        </div>
        <button type="button" className="button button--small" disabled={busy || !d.configured} onClick={runChecks}>
          {busy ? 'Checking...' : 'Run checks'}
        </button>
        {checks && (
          <ul className="plain-list">
            {checks.map((c) => (
              <li key={c.check}>
                <Pill value={c.ok ? 'active' : 'failed'} label={c.ok ? 'OK' : 'Problem'} /> <strong>{c.check}</strong>: {c.detail}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="panel form-stack">
        <h2 className="panel__title">Order updates (webhook)</h2>
        {!d.configured ? (
          <p className="muted">Connect Printful first.</p>
        ) : webhook.loading ? (
          <Loading />
        ) : webhook.error ? (
          <FormError message={webhook.error} />
        ) : (
          <>
            <p>
              {webhook.data?.ours ? (
                <>
                  <Pill value="active" label="Sending to this site" /> for {webhook.data.types.join(', ')}.
                </>
              ) : webhook.data?.url ? (
                <>Printful currently sends updates to {webhook.data.url}, not this site.</>
              ) : (
                'No webhook is set in Printful yet.'
              )}
            </p>
            <p className="muted">
              Webhooks only prompt this site to read the order from Printful again; the hourly check does the same in case one is missed. Printful must be able to reach this site, so use the public
              domain once it is connected.
            </p>
            <button type="button" className="button button--outline button--small" disabled={busy || !d.webhookToken} onClick={() => (webhook.data?.url && !webhook.data.ours ? setConfirmHook(true) : registerHook())}>
              Point Printful webhooks here
            </button>
          </>
        )}
      </section>

      <section className="panel">
        <h2 className="panel__title">Physical products</h2>
        {!d.products.length ? (
          <p className="muted">No physical products yet.</p>
        ) : (
          <div className="data-table-wrap">
            <table className="data-table">
              <thead><tr><th>Product</th><th>Options</th><th>Linked</th><th>Can be made now</th></tr></thead>
              <tbody>
                {d.products.map((p) => {
                  const items = Math.max(1, p.variants)
                  return (
                    <tr key={p.id}>
                      <td><a href={href(`admin-product-${p.id}`)}>{p.title}</a></td>
                      <td>{p.variants || 'None'}</td>
                      <td>{p.links} of {items}</td>
                      <td>{p.available === items ? <Pill value="active" label="All" /> : <Pill value="failed" label={`${p.available} of ${items}`} />}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        {Object.keys(d.jobs).length > 0 && (
          <p className="muted">
            Orders with Printful: {Object.entries(d.jobs).map(([k, n]) => `${STATE_LABEL[k] ?? k} ${n}`).join(', ')}.
          </p>
        )}
      </section>

      <Dialog open={confirmAuto} onClose={() => setConfirmAuto(false)} title="Confirm orders automatically?">
        <p>Each paid order will be confirmed for production right away, and Printful will charge your Printful billing method for it. Make sure billing is set up in Printful first.</p>
        <div className="button-row">
          <button
            type="button"
            className="button button--small"
            onClick={() => {
              setConfirmAuto(false)
              void saveSettings({ ...d.settings, auto_confirm: true })
            }}
          >
            Yes, confirm automatically
          </button>
          <button type="button" className="button button--outline button--small" onClick={() => setConfirmAuto(false)}>
            Not now
          </button>
        </div>
      </Dialog>
      <Dialog open={confirmHook} onClose={() => setConfirmHook(false)} title="Replace the Printful webhook?">
        <p>Printful currently sends order updates to {webhook.data?.url}. A Printful store has one webhook address, so this replaces it. If another app relies on it, stop and check first.</p>
        <div className="button-row">
          <button type="button" className="button button--small" onClick={registerHook}>
            Replace it with this site
          </button>
          <button type="button" className="button button--outline button--small" onClick={() => setConfirmHook(false)}>
            Cancel
          </button>
        </div>
      </Dialog>
    </>
  )
}
