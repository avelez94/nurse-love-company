import { Plus, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api, errorMessage } from '../../lib/api'
import { useUI } from '../../lib/ui'
import { Checkbox, dateOnly, FormError, Loading, MoneyInput, Notice, Pill, Select, TextArea, TextInput, useApiData } from '../../components/ui'
import { href } from '../../lib/router'
import { PageTitle } from './AdminApp'

interface Settings {
  store: { name: string; contact_email: string; support_email: string; phone: string; mailing_address: string }
  homepage: { featured_product_ids: string[] }
  freebies: { items: Array<{ id: string; title: string; summary: string; published: boolean }> }
  shipping: { configured: boolean; flat_rate_cents: number | null; free_over_cents: number | null; countries: string[]; note: string }
  payments: { automatic_tax: boolean }
  policies: { status: 'awaiting_approval' | 'approved'; refund_policy: string; shipping_policy: string; terms: string; privacy: string; refund_download_policy: 'revoke_unredeemed' | 'keep'; digital_repurchase: 'block' }
}

interface Data {
  settings: Settings
  integrations: {
    environment: 'development' | 'staging' | 'production'
    payments: { state: string; webhook: boolean }
    email: { configured: boolean; webhook: boolean }
    storage: { driver: string; configured: boolean }
    video: { provider: string; configured: boolean; webhook: boolean; signedPreview: boolean }
  }
  admins: Array<{ id: string; name: string; email: string; created_at: string }>
  appUrl: string
  demo: { allowed: boolean; products: number; orders: number }
}

function DemoPanel({ demo, onDone }: { demo: Data['demo']; onDone: () => void }) {
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const { showToast } = useUI()
  if (!demo.allowed) return null
  return (
    <section className="panel form-stack">
      <h2 className="panel__title">Demo content (staging only)</h2>
      <Notice tone="warn">Adds labeled sample products, orders and a placeholder tutorial so the dashboards can be reviewed. Everything is marked Demo, demo orders took no payment, and emails about demo content are never sent. Pressing this again only adds what is missing.</Notice>
      <p className="muted">Currently: {demo.products} demo products and {demo.orders} demo orders.</p>
      <TextInput label="Also add demo orders to this account (optional)" value={email} onChange={setEmail} placeholder="reviewer@example.com" hint="The person signs up normally with their own password first. They then see demo orders and downloads in their own customer dashboard." />
      <FormError message={error} />
      <button
        type="button"
        className="button button--small"
        disabled={busy}
        onClick={async () => {
          setBusy(true)
          setError('')
          try {
            const r = await api<{ productsCreated: number; ordersCreated: number; reviewerOrdersCreated: number; tutorialsCreated: number }>('/api/admin/demo', { body: { reviewer_email: email || null } })
            showToast(`Demo content loaded: ${r.productsCreated} products, ${r.ordersCreated + r.reviewerOrdersCreated} orders and ${r.tutorialsCreated} tutorials added.`)
            onDone()
          } catch (err) {
            setError(errorMessage(err))
          } finally {
            setBusy(false)
          }
        }}
      >
        {busy ? 'Loading demo content...' : 'Load demo content'}
      </button>
    </section>
  )
}

function useSection<K extends keyof Settings>(data: Data | null, key: K) {
  const [value, setValue] = useState<Settings[K] | null>(null)
  useEffect(() => {
    if (data) setValue(structuredClone(data.settings[key]))
  }, [data, key])
  return [value, setValue] as const
}

function SaveRow({ section, value, onSaved }: { section: string; value: unknown; onSaved: () => void }) {
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const { showToast } = useUI()
  return (
    <div className="button-row">
      <button
        type="button"
        className="button button--small"
        disabled={busy}
        onClick={async () => {
          setBusy(true)
          setError('')
          try {
            await api(`/api/admin/settings/${section}`, { method: 'PUT', body: value })
            showToast('Settings saved.')
            onSaved()
          } catch (err) {
            setError(errorMessage(err))
          } finally {
            setBusy(false)
          }
        }}
      >
        Save
      </button>
      <FormError message={error} />
    </div>
  )
}

const status = (ok: boolean, okText = 'Connected', badText = 'Awaiting configuration') => <Pill value={ok ? 'active' : 'pending'} label={ok ? okText : badText} />

export function SettingsPage() {
  const { data, error, loading, reload } = useApiData<Data>('/api/admin/settings')
  const products = useApiData<{ products: Array<{ id: string; title: string; status: string; archived_at: string | null }> }>('/api/admin/products?status=published')
  const [store, setStore] = useSection(data, 'store')
  const [homepage, setHomepage] = useSection(data, 'homepage')
  const [freebies, setFreebies] = useSection(data, 'freebies')
  const [shipping, setShipping] = useSection(data, 'shipping')
  const [payments, setPayments] = useSection(data, 'payments')
  const [policies, setPolicies] = useSection(data, 'policies')
  const [adminEmail, setAdminEmail] = useState('')
  const [adminError, setAdminError] = useState('')
  const { showToast } = useUI()

  if (loading && !data) return <Loading />
  if (error) return <FormError message={error} />
  if (!data || !store || !homepage || !freebies || !shipping || !payments || !policies) return null
  const i = data.integrations

  return (
    <>
      <PageTitle title="Settings" />
      {data.integrations.environment === 'staging' && <Notice tone="warn">This is the staging preview. Live payments are always off here, whatever keys are set.</Notice>}
      <Notice>Secret keys (Stripe, Resend, storage, Mux) are set as server environment variables and never shown here. This page shows whether each service is connected.</Notice>

      <DemoPanel demo={data.demo} onDone={reload} />

      <section className="panel">
        <h2 className="panel__title">Connected services</h2>
        <dl className="kv">
          <dt>Payments (Stripe)</dt>
          <dd>
            {i.payments.state === 'test' && <Pill value="active" label="Test mode" />}
            {i.payments.state === 'live' && <Pill value="active" label="Live" />}
            {i.payments.state === 'live-blocked' && <Pill value="failed" label="Live keys blocked until launch approval" />}
            {i.payments.state === 'not-configured' && status(false)}
            {' '}Webhook: {status(i.payments.webhook, 'Verified', 'Not set')}
            <div className="muted">Webhook address: {data.appUrl}/api/webhooks/stripe</div>
          </dd>
          <dt>Email (Resend)</dt>
          <dd>
            {status(i.email.configured)} Webhook: {status(i.email.webhook, 'Verified', 'Not set')}
            <div className="muted">Webhook address: {data.appUrl}/api/webhooks/resend</div>
          </dd>
          <dt>File storage</dt>
          <dd>{i.storage.driver === 's3' ? status(i.storage.configured, 'Cloud storage') : <Pill value="pending" label="This server's disk (development)" />}</dd>
          <dt>Tutorial video</dt>
          <dd>
            {i.video.provider === 'mux' ? status(i.video.configured, 'Mux streaming') : <Pill value="pending" label="This server (development)" />}
            {i.video.provider === 'mux' && <> Webhook: {status(i.video.webhook, 'Verified', 'Not set')} Draft previews: {status(i.video.signedPreview, 'Enabled', 'Signing key not set')}</>}
            {i.video.provider === 'mux' && <div className="muted">Webhook address: {data.appUrl}/api/webhooks/mux</div>}
          </dd>
        </dl>
      </section>

      <div className="admin-cols">
        <div>
          <section className="panel form-stack">
            <h2 className="panel__title">Store and contact</h2>
            <TextInput label="Store name" value={store.name} onChange={(v) => setStore({ ...store, name: v })} />
            <TextInput label="Contact email" value={store.contact_email} onChange={(v) => setStore({ ...store, contact_email: v })} hint="Leave empty until confirmed. Shown on the Help page." />
            <TextInput label="Support email" value={store.support_email} onChange={(v) => setStore({ ...store, support_email: v })} />
            <TextInput label="Phone" value={store.phone} onChange={(v) => setStore({ ...store, phone: v })} />
            <TextArea label="Mailing address" value={store.mailing_address} onChange={(v) => setStore({ ...store, mailing_address: v })} rows={2} />
            <SaveRow section="store" value={store} onSaved={reload} />
          </section>

          <section className="panel form-stack">
            <h2 className="panel__title">Policies</h2>
            <Notice tone="warn">Refund, shipping and download policies must come from the business owner. Nothing here is written for you.</Notice>
            <Select label="Policy status" value={policies.status} onChange={(v) => setPolicies({ ...policies, status: v })} options={[{ value: 'awaiting_approval', label: 'Awaiting owner approval' }, { value: 'approved', label: 'Approved by the owner' }]} />
            <TextArea label="Refund policy" value={policies.refund_policy} onChange={(v) => setPolicies({ ...policies, refund_policy: v })} rows={4} />
            <TextArea label="Shipping policy" value={policies.shipping_policy} onChange={(v) => setPolicies({ ...policies, shipping_policy: v })} rows={4} />
            <p className="muted">
              Terms & Conditions and the Privacy Policy are edited, previewed and published under <a href={href('admin-policies')}>Content, Policies</a>.
            </p>
            <Select
              label="Unused downloads when a digital item is fully refunded"
              value={policies.refund_download_policy}
              onChange={(v) => setPolicies({ ...policies, refund_download_policy: v })}
              options={[{ value: 'revoke_unredeemed', label: 'Remove the unused download (current default)' }, { value: 'keep', label: 'Keep the unused download' }]}
              hint="Already downloaded files cannot be taken back. Please confirm which option matches the approved policy."
            />
            <p className="muted">Buying a digital product you already own is blocked, and digital items are always quantity one, until the owner decides otherwise.</p>
            <SaveRow section="policies" value={policies} onSaved={reload} />
          </section>

          <section className="panel form-stack">
            <h2 className="panel__title">Admin access</h2>
            <ul className="timeline">
              {data.admins.map((a) => (
                <li key={a.id} className="status-line">
                  <strong>{a.name}</strong> {a.email} <span className="muted">since {dateOnly(a.created_at)}</span>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={`Remove admin access for ${a.email}`}
                    onClick={async () => {
                      setAdminError('')
                      try {
                        await api('/api/admin/admins', { body: { email: a.email, admin: false } })
                        showToast('Admin access removed.')
                        reload()
                      } catch (err) {
                        setAdminError(errorMessage(err))
                      }
                    }}
                  >
                    <Trash2 size={16} aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
            <TextInput label="Give admin access to an existing account" value={adminEmail} onChange={setAdminEmail} placeholder="person@example.com" hint="The person must create a normal account first. Admins can see customer data." />
            <FormError message={adminError} />
            <button
              type="button"
              className="button button--outline button--small"
              disabled={!adminEmail}
              onClick={async () => {
                setAdminError('')
                try {
                  await api('/api/admin/admins', { body: { email: adminEmail, admin: true } })
                  showToast('Admin access granted.')
                  setAdminEmail('')
                  reload()
                } catch (err) {
                  setAdminError(errorMessage(err))
                }
              }}
            >
              Grant admin access
            </button>
          </section>
        </div>

        <div>
          <section className="panel form-stack">
            <h2 className="panel__title">Shipping</h2>
            <Checkbox label="Shipping rates are set up" checked={shipping.configured} onChange={(v) => setShipping({ ...shipping, configured: v })} hint="Items that ship cannot be bought until this is on." />
            <MoneyInput label="Flat shipping rate" cents={shipping.flat_rate_cents} onChange={(c) => setShipping({ ...shipping, flat_rate_cents: c })} />
            <MoneyInput label="Free shipping over (optional)" cents={shipping.free_over_cents} onChange={(c) => setShipping({ ...shipping, free_over_cents: c })} />
            <TextInput label="Countries you ship to" value={shipping.countries.join(', ')} onChange={(v) => setShipping({ ...shipping, countries: v.split(',').map((x) => x.trim().toUpperCase()).filter(Boolean) })} hint="Two letter codes, for example US, CA" />
            <SaveRow section="shipping" value={shipping} onSaved={reload} />
          </section>

          <section className="panel form-stack">
            <h2 className="panel__title">Payments</h2>
            <Checkbox label="Calculate sales tax with Stripe Tax" checked={payments.automatic_tax} onChange={(v) => setPayments({ ...payments, automatic_tax: v })} hint="Requires Stripe Tax to be set up in the Stripe dashboard first." />
            <SaveRow section="payments" value={payments} onSaved={reload} />
          </section>

          <section className="panel form-stack">
            <h2 className="panel__title">Homepage featured products</h2>
            <div className="check-list">
              {products.data?.products.map((p) => (
                <Checkbox key={p.id} label={p.title} checked={homepage.featured_product_ids.includes(p.id)} onChange={(v) => setHomepage({ featured_product_ids: v ? [...homepage.featured_product_ids, p.id] : homepage.featured_product_ids.filter((x) => x !== p.id) })} />
              ))}
            </div>
            <SaveRow section="homepage" value={homepage} onSaved={reload} />
          </section>

          <section className="panel form-stack">
            <div className="panel__head">
              <h2 className="panel__title">Freebie Corner</h2>
              <button type="button" className="button button--outline button--small" onClick={() => setFreebies({ items: [...freebies.items, { id: '', title: '', summary: '', published: false }] })}>
                <Plus size={16} aria-hidden="true" /> Add freebie
              </button>
            </div>
            <p className="muted">Freebies are free for everyone and are separate from paid downloads.</p>
            {freebies.items.map((f, idx) => (
              <div key={idx} className="form-stack" style={{ borderBottom: '1px dashed var(--border)', paddingBottom: 12 }}>
                <TextInput label="Title" value={f.title} onChange={(v) => setFreebies({ items: freebies.items.map((x, j) => (j === idx ? { ...x, title: v } : x)) })} />
                <TextInput label="Summary" value={f.summary} onChange={(v) => setFreebies({ items: freebies.items.map((x, j) => (j === idx ? { ...x, summary: v } : x)) })} />
                <div className="button-row">
                  <Checkbox label="Show on the site" checked={f.published} onChange={(v) => setFreebies({ items: freebies.items.map((x, j) => (j === idx ? { ...x, published: v } : x)) })} />
                  <button type="button" className="icon-button" aria-label="Remove freebie" onClick={() => setFreebies({ items: freebies.items.filter((_, j) => j !== idx) })}>
                    <Trash2 size={16} aria-hidden="true" />
                  </button>
                </div>
              </div>
            ))}
            <SaveRow section="freebies" value={freebies} onSaved={reload} />
          </section>
        </div>
      </div>
    </>
  )
}
