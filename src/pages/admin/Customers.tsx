import { useEffect, useState } from 'react'
import { api, errorMessage } from '../../lib/api'
import { href } from '../../lib/router'
import { useUI } from '../../lib/ui'
import { dateOnly, dateTime, Empty, FormError, Loading, money, Pill, TextArea, useApiData } from '../../components/ui'
import { PageTitle } from './AdminApp'

interface Row {
  id: string
  name: string
  email: string
  created_at: string
  orders: number
  spent_cents: number
  last_order_at: string | null
  is_demo: boolean
}

export function Customers() {
  const [search, setSearch] = useState('')
  const { data, error, loading } = useApiData<{ customers: Row[] }>(`/api/admin/customers?search=${encodeURIComponent(search)}`)
  return (
    <>
      <PageTitle title="Customers" />
      <div className="filters">
        <label className="field field--grow">
          <span className="field__label">Search</span>
          <input className="input" type="search" placeholder="Name, email or order number" value={search} onChange={(e) => setSearch(e.target.value)} />
        </label>
      </div>
      {error && <FormError message={error} />}
      {loading && !data ? (
        <Loading />
      ) : !data?.customers.length ? (
        <Empty title="No customers found" />
      ) : (
        <div className="data-table-wrap">
          <table className="data-table">
            <thead><tr><th>Customer</th><th>Joined</th><th className="num">Orders</th><th className="num">Total spent</th><th>Last order</th></tr></thead>
            <tbody>
              {data.customers.map((c) => (
                <tr key={c.id}>
                  <td><a href={href(`admin-customer-${c.id}`)}>{c.name}</a>{c.is_demo && <span className="demo-tag">Demo</span>}<br /><span className="muted">{c.email}</span></td>
                  <td>{dateOnly(c.created_at)}</td>
                  <td className="num">{c.orders}</td>
                  <td className="num">{money(c.spent_cents)}</td>
                  <td>{c.last_order_at ? dateOnly(c.last_order_at) : 'None'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}

interface Detail {
  customer: { id: string; name: string; email: string; created_at: string; email_verified: boolean; order_updates: boolean | null; product_updates: boolean | null; marketing: boolean | null; admin_notes: string | null }
  totalSpentCents: number
  orders: Array<{ id: string; order_number: string; status: string; fulfillment_status: string; total_cents: number; created_at: string; is_demo: boolean }>
  downloads: Array<{ orderItemId: string; title: string; orderNumber: string; statusText: string; status: string }>
  entitlements: Array<{ id: string; status: string; source: string; reason: string; granted_by: string | null; granted_at: string; redeemed_at: string | null; version_number: number; title: string; order_number: string }>
  downloadEvents: Array<{ event: string; detail: string; created_at: string; ip: string | null }>
  emails: Array<{ id: string; type: string; subject: string; status: string; requested_at: string }>
  support: Array<{ id: string; subject: string; message: string; status: string; created_at: string; order_number: string | null }>
  reports: Array<{ id: string; message: string; status: string; resolution_note: string; created_at: string }>
  addresses: Array<{ id: string; name: string; line1: string; city: string; region: string; postal_code: string; country: string; is_default: boolean }>
}

export function CustomerDetail({ id }: { id: string }) {
  const { data, error, loading, reload } = useApiData<Detail>(`/api/admin/customers/${encodeURIComponent(id)}`)
  const [notes, setNotes] = useState('')
  const [saveError, setSaveError] = useState('')
  const { showToast } = useUI()
  useEffect(() => setNotes(data?.customer.admin_notes ?? ''), [data])
  if (loading && !data) return <Loading />
  if (error) return <FormError message={error} />
  if (!data) return null
  const c = data.customer
  return (
    <>
      <PageTitle title={c.name} back={{ label: 'Customers', route: 'admin-customers' }} />
      <div className="admin-cols">
        <div>
          <section className="panel">
            <h2 className="panel__title">Orders</h2>
            {data.orders.length ? (
              <div className="data-table-wrap">
                <table className="data-table">
                  <thead><tr><th>Order</th><th>Payment</th><th>Fulfillment</th><th className="num">Total</th></tr></thead>
                  <tbody>
                    {data.orders.map((o) => (
                      <tr key={o.id}>
                        <td><a href={href(`admin-order-${o.id}`)}>{o.order_number}</a>{o.is_demo && <span className="demo-tag">Demo</span>}<br /><span className="muted">{dateTime(o.created_at)}</span></td>
                        <td><Pill value={o.status} /></td>
                        <td><Pill value={o.fulfillment_status} /></td>
                        <td className="num">{money(o.total_cents)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="muted">No orders.</p>
            )}
          </section>
          <section className="panel">
            <h2 className="panel__title">Purchased digital products</h2>
            {data.downloads.length ? (
              <ul className="timeline">
                {data.downloads.map((d) => (
                  <li key={d.orderItemId}><strong>{d.title}</strong> (order {d.orderNumber}): {d.statusText}</li>
                ))}
              </ul>
            ) : (
              <p className="muted">None.</p>
            )}
            <details>
              <summary>Download entitlement history ({data.entitlements.length})</summary>
              <div className="data-table-wrap">
                <table className="data-table">
                  <thead><tr><th>Product</th><th>Version</th><th>Source</th><th>Status</th><th>Granted</th><th>Used</th></tr></thead>
                  <tbody>
                    {data.entitlements.map((e) => (
                      <tr key={e.id}>
                        <td>{e.title}<br /><span className="muted">{e.order_number}</span></td>
                        <td>v{e.version_number}</td>
                        <td>{e.source.replace('_', ' ')}{e.reason && <div className="muted">{e.reason}</div>}</td>
                        <td><Pill value={e.status} /></td>
                        <td>{dateTime(e.granted_at)}{e.granted_by && <div className="muted">{e.granted_by}</div>}</td>
                        <td>{dateTime(e.redeemed_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
            <details>
              <summary>Download activity ({data.downloadEvents.length})</summary>
              <ul className="timeline">
                {data.downloadEvents.map((e, i) => (
                  <li key={i}><span className="muted">{dateTime(e.created_at)}</span> {e.event.replace(/_/g, ' ')}{e.detail && <span className="muted"> • {e.detail}</span>}</li>
                ))}
              </ul>
            </details>
          </section>
          <section className="panel">
            <h2 className="panel__title">Email history</h2>
            {data.emails.length ? (
              <ul className="timeline">
                {data.emails.map((e) => (
                  <li key={e.id}><a href={href(`admin-email-${e.id}`)}>{e.subject}</a> <Pill value={e.status} /> <span className="muted">{dateTime(e.requested_at)}</span></li>
                ))}
              </ul>
            ) : (
              <p className="muted">No emails yet.</p>
            )}
          </section>
        </div>
        <div>
          <section className="panel">
            <h2 className="panel__title">Profile</h2>
            <dl className="kv">
              <dt>Email</dt><dd>{c.email}</dd>
              <dt>Joined</dt><dd>{dateOnly(c.created_at)}</dd>
              <dt>Total spent</dt><dd>{money(data.totalSpentCents)} <span className="muted">(after refunds)</span></dd>
              <dt>Order emails</dt><dd>{c.order_updates === false ? 'Off' : 'On'}</dd>
              <dt>Update emails</dt><dd>{c.product_updates === false ? 'Off' : 'On'}</dd>
              <dt>Marketing</dt><dd>{c.marketing ? 'Opted in' : 'Not opted in'}</dd>
            </dl>
            {data.addresses.length > 0 && (
              <>
                <h3>Saved addresses</h3>
                {data.addresses.map((a) => (
                  <p key={a.id} className="muted">{a.name}, {a.line1}, {a.city} {a.region} {a.postal_code} {a.country}{a.is_default ? ' (default)' : ''}</p>
                ))}
              </>
            )}
          </section>
          <section className="panel form-stack">
            <h2 className="panel__title">Internal notes</h2>
            <TextArea label="Only admins see these" value={notes} onChange={setNotes} maxLength={5000} rows={5} />
            <FormError message={saveError} />
            <button
              type="button"
              className="button button--small"
              onClick={async () => {
                try {
                  await api(`/api/admin/customers/${encodeURIComponent(id)}/notes`, { method: 'PUT', body: { notes } })
                  showToast('Notes saved.')
                  reload()
                } catch (err) {
                  setSaveError(errorMessage(err))
                }
              }}
            >
              Save notes
            </button>
          </section>
          {(data.support.length > 0 || data.reports.length > 0) && (
            <section className="panel">
              <h2 className="panel__title">Support</h2>
              <ul className="timeline">
                {data.support.map((s) => (
                  <li key={s.id}><Pill value={s.status} /> <strong>{s.subject}</strong>{s.order_number && ` (order ${s.order_number})`}<div className="muted">{s.message}</div></li>
                ))}
                {data.reports.map((r) => (
                  <li key={r.id}><Pill value={r.status} /> Download problem: {r.message}{r.resolution_note && <div className="muted">{r.resolution_note}</div>}</li>
                ))}
              </ul>
              <a className="arrow-link" href={href('admin-support')}>Open support</a>
            </section>
          )}
        </div>
      </div>
    </>
  )
}
