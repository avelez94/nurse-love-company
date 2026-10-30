import { Download, PackageCheck, RotateCcw } from 'lucide-react'
import { useMemo, useState, type FormEvent } from 'react'
import { api, errorMessage, newKey } from '../../lib/api'
import { href } from '../../lib/router'
import { useUI } from '../../lib/ui'
import { Dialog } from '../../components/Dialog'
import { Checkbox, Confirm, dateTime, Empty, FormError, Loading, money, MoneyInput, Notice, Pill, Select, TextArea, TextInput, useApiData } from '../../components/ui'
import { PageTitle } from './AdminApp'

interface OrderRow {
  id: string
  order_number: string
  customer_name: string
  email: string
  status: string
  fulfillment_status: string
  total_cents: number
  refunded_cents: number
  created_at: string
  is_demo: boolean
  types: string
  item_count: number
}

export function Orders() {
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [fulfillment, setFulfillment] = useState('')
  const [type, setType] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [demo, setDemo] = useState(true)
  const params = new URLSearchParams()
  if (search) params.set('search', search)
  if (status) params.set('status', status)
  if (fulfillment) params.set('fulfillment', fulfillment)
  if (type) params.set('type', type)
  if (from) params.set('from', new Date(`${from}T00:00:00`).toISOString())
  if (to) params.set('to', new Date(new Date(`${to}T00:00:00`).getTime() + 86400000).toISOString())
  if (!demo) params.set('demo', '0')
  const { data, error, loading } = useApiData<{ orders: OrderRow[] }>(`/api/admin/orders?${params}`)
  const csvParams = new URLSearchParams({ from: from ? new Date(`${from}T00:00:00`).toISOString() : new Date(Date.now() - 365 * 86400000).toISOString(), to: to ? new Date(new Date(`${to}T00:00:00`).getTime() + 86400000).toISOString() : new Date(Date.now() + 86400000).toISOString(), demo: demo ? '1' : '0' })

  return (
    <>
      <PageTitle title="Orders">
        <a className="button button--outline button--small" href={`/api/admin/reports/orders.csv?${csvParams}`}>
          <Download size={16} aria-hidden="true" /> Export CSV
        </a>
      </PageTitle>
      <div className="filters">
        <label className="field field--grow">
          <span className="field__label">Search</span>
          <input className="input" type="search" placeholder="Order number, name or email" value={search} onChange={(e) => setSearch(e.target.value)} />
        </label>
        <Select label="Payment" value={status} onChange={setStatus} options={[{ value: '', label: 'Any (except unpaid)' }, ...['paid', 'partially_refunded', 'refunded', 'disputed', 'pending', 'failed', 'canceled'].map((s) => ({ value: s, label: s.replace('_', ' ') }))]} />
        <Select label="Fulfillment" value={fulfillment} onChange={setFulfillment} options={[{ value: '', label: 'Any' }, ...['unfulfilled', 'partially_fulfilled', 'fulfilled', 'not_required'].map((s) => ({ value: s, label: s.replace('_', ' ') }))]} />
        <Select label="Contains" value={type} onChange={setType} options={[{ value: '', label: 'Any items' }, { value: 'digital', label: 'Digital items' }, { value: 'physical', label: 'Physical items' }]} />
        <label className="field">
          <span className="field__label">From</span>
          <input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="field">
          <span className="field__label">To</span>
          <input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
      </div>
      <Checkbox label="Include demo orders" checked={demo} onChange={setDemo} />
      {error && <FormError message={error} />}
      {loading && !data ? (
        <Loading />
      ) : !data?.orders.length ? (
        <Empty title="No orders match these filters" />
      ) : (
        <div className="data-table-wrap">
          <table className="data-table">
            <thead>
              <tr><th>Order</th><th>Customer</th><th>Items</th><th>Payment</th><th>Fulfillment</th><th className="num">Total</th></tr>
            </thead>
            <tbody>
              {data.orders.map((o) => (
                <tr key={o.id}>
                  <td>
                    <a href={href(`admin-order-${o.id}`)}>{o.order_number}</a>
                    {o.is_demo && <span className="demo-tag">Demo</span>}
                    <br />
                    <span className="muted">{dateTime(o.created_at)}</span>
                  </td>
                  <td>{o.customer_name}<br /><span className="muted">{o.email}</span></td>
                  <td>{o.item_count} • {o.types?.split(',').map((t) => (t === 'digital' ? 'Digital' : 'Physical')).join(' + ')}</td>
                  <td><Pill value={o.status} /></td>
                  <td><Pill value={o.fulfillment_status} /></td>
                  <td className="num">{money(o.total_cents)}{o.refunded_cents > 0 && <><br /><span className="muted">{money(o.refunded_cents)} refunded</span></>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}

interface Item {
  id: string
  product_id: string
  product_type: string
  title_snapshot: string
  variant_snapshot: string
  sku_snapshot: string
  unit_price_cents: number
  quantity: number
  refunded_quantity: number
}

interface OrderDetailData {
  order: Record<string, any>
  items: Item[]
  refunds: Array<{ id: string; amount_cents: number; reason: string; status: string; stripe_refund_id: string | null; created_by: string; created_at: string; failure_reason: string }>
  shipments: Array<{ id: string; carrier: string; tracking_number: string; tracking_url: string; status: string; shipped_at: string; created_by: string }>
  notes: Array<{ id: string; body: string; author_email: string; created_at: string }>
  updates: Array<{ id: string; message: string; customer_visible: boolean; created_by: string; created_at: string }>
  entitlements: Array<{ id: string; order_item_id: string; status: string; source: string; reason: string; granted_by: string | null; granted_at: string; redeemed_at: string | null; version_number: number }>
  downloadEvents: Array<{ event: string; detail: string; created_at: string; ip: string | null; entitlement_id: string }>
  emails: Array<{ id: string; type: string; subject: string; status: string; requested_at: string }>
  paymentEvents: Array<{ id: string; type: string; status: string; received_at: string }>
}

const addressText = (a?: { name?: string; address?: Record<string, string> | null } | null) =>
  a ? [a.name, a.address?.line1, a.address?.line2, [a.address?.city, a.address?.state, a.address?.postal_code].filter(Boolean).join(' '), a.address?.country].filter(Boolean).join(', ') : 'Not provided'

export function OrderDetail({ id }: { id: string }) {
  const { data, error, loading, reload } = useApiData<OrderDetailData>(`/api/admin/orders/${id}`)
  const { showToast } = useUI()
  const [note, setNote] = useState('')
  const [update, setUpdate] = useState('')
  const [shipOpen, setShipOpen] = useState(false)
  const [refundOpen, setRefundOpen] = useState(false)
  const [replacement, setReplacement] = useState<Item | null>(null)
  const [actionError, setActionError] = useState('')

  if (loading && !data) return <Loading />
  if (error) return <FormError message={error} />
  if (!data) return null
  const o = data.order
  const paid = ['paid', 'partially_refunded'].includes(o.status)
  const physical = data.items.some((i) => i.product_type === 'physical')

  const post = async (path: string, body: unknown, done: string) => {
    setActionError('')
    try {
      await api(path, { body })
      showToast(done)
      await reload()
      return true
    } catch (err) {
      setActionError(errorMessage(err))
      return false
    }
  }

  return (
    <>
      <PageTitle title={`Order ${o.order_number}`} back={{ label: 'Orders', route: 'admin-orders' }}>
        {paid && !o.is_demo && (
          <button type="button" className="button button--outline button--small" onClick={() => setRefundOpen(true)}>
            <RotateCcw size={16} aria-hidden="true" /> Refund
          </button>
        )}
        {paid && physical && (
          <button type="button" className="button button--small" onClick={() => setShipOpen(true)}>
            <PackageCheck size={16} aria-hidden="true" /> Add shipment
          </button>
        )}
      </PageTitle>
      <div className="status-line">
        <Pill value={o.status} />
        <Pill value={o.fulfillment_status} />
        {o.is_demo && <span className="demo-tag">Demo order: sample data, no payment</span>}
        <span className="muted">Placed {dateTime(o.created_at)}{o.paid_at ? ` • paid ${dateTime(o.paid_at)}` : ''}</span>
      </div>
      <FormError message={actionError} />

      <div className="admin-cols">
        <div>
          <section className="panel">
            <h2 className="panel__title">Items</h2>
            <div className="data-table-wrap">
              <table className="data-table">
                <thead><tr><th>Item</th><th className="num">Qty</th><th className="num">Price</th><th>Downloads</th></tr></thead>
                <tbody>
                  {data.items.map((i) => {
                    const ents = data.entitlements.filter((e) => e.order_item_id === i.id)
                    const available = ents.find((e) => e.status === 'available')
                    return (
                      <tr key={i.id}>
                        <td>
                          <a href={href(`admin-product-${i.product_id}`)}>{i.title_snapshot}</a>
                          {i.variant_snapshot && <span className="muted"> ({i.variant_snapshot})</span>}
                          <br />
                          <span className="muted">{i.product_type === 'digital' ? 'Digital' : `Physical${i.sku_snapshot ? ` • SKU ${i.sku_snapshot}` : ''}`}</span>
                          {i.refunded_quantity > 0 && <><br /><Pill value="refunded" label={`${i.refunded_quantity} refunded`} /></>}
                        </td>
                        <td className="num">{i.quantity}</td>
                        <td className="num">{money(i.unit_price_cents)}</td>
                        <td>
                          {i.product_type !== 'digital' ? (
                            <span className="muted">Not applicable</span>
                          ) : (
                            <>
                              {ents.length === 0 && <span className="muted">{paid ? 'Waiting for the first file release' : 'None (order not paid)'}</span>}
                              {ents.map((e) => (
                                <div key={e.id}>
                                  <Pill value={e.status} /> v{e.version_number} • {e.source.replace('_', ' ')}
                                  {e.redeemed_at && <span className="muted"> • used {dateTime(e.redeemed_at)}</span>}
                                  {e.reason && <div className="muted">Reason: {e.reason}</div>}
                                </div>
                              ))}
                              {paid && !available && ents.length > 0 && (
                                <button type="button" className="chip" onClick={() => setReplacement(i)}>
                                  Grant replacement download
                                </button>
                              )}
                            </>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <dl className="kv totals">
              <dt>Subtotal</dt><dd>{money(o.subtotal_cents)}</dd>
              <dt>Discounts</dt><dd>{money(o.discount_cents)}</dd>
              <dt>Shipping</dt><dd>{money(o.shipping_cents)}</dd>
              <dt>Tax</dt><dd>{money(o.tax_cents)}</dd>
              <dt>Total charged</dt><dd><strong>{money(o.total_cents)}</strong></dd>
              <dt>Refunded</dt><dd>{money(o.refunded_cents)}</dd>
              <dt>Processing fee</dt><dd>{o.fee_cents === null ? 'Not reported yet' : money(o.fee_cents)}</dd>
            </dl>
          </section>

          <section className="panel">
            <h2 className="panel__title">Shipping and fulfillment</h2>
            {!physical ? (
              <p className="muted">Digital only. Nothing to ship.</p>
            ) : (
              <>
                <p><strong>Ship to:</strong> {addressText(o.shipping_address)}</p>
                {data.shipments.map((s) => (
                  <div key={s.id} className="status-line">
                    <Pill value={s.status} />
                    {s.carrier || 'Carrier not set'} • {s.tracking_number || 'no tracking number'}
                    {s.tracking_url && <a href={s.tracking_url} target="_blank" rel="noopener noreferrer">Track</a>}
                    <span className="muted">{dateTime(s.shipped_at)}</span>
                    <select
                      className="input"
                      style={{ width: 'auto' }}
                      aria-label="Update shipment status"
                      value={s.status}
                      onChange={async (e) => {
                        try {
                          await api(`/api/admin/shipments/${s.id}`, { method: 'PATCH', body: { status: e.target.value } })
                          showToast('Shipment updated. The customer sees the update in their order.')
                          reload()
                        } catch (err) {
                          setActionError(errorMessage(err))
                        }
                      }}
                    >
                      {['label_created', 'shipped', 'in_transit', 'delivered', 'exception'].map((st) => (
                        <option key={st} value={st}>{st.replace('_', ' ')}</option>
                      ))}
                    </select>
                  </div>
                ))}
                {paid && (
                  <Select
                    label="Fulfillment status"
                    value={o.fulfillment_status}
                    onChange={async (v) => {
                      try {
                        await api(`/api/admin/orders/${id}/fulfillment`, { method: 'PATCH', body: { status: v } })
                        reload()
                      } catch (err) {
                        setActionError(errorMessage(err))
                      }
                    }}
                    options={['unfulfilled', 'partially_fulfilled', 'fulfilled'].map((s) => ({ value: s, label: s.replace('_', ' ') }))}
                  />
                )}
              </>
            )}
            <form
              className="form-stack"
              onSubmit={async (e) => {
                e.preventDefault()
                if (await post(`/api/admin/orders/${id}/updates`, { message: update }, 'Update posted to the customer\'s order page.')) setUpdate('')
              }}
            >
              <TextInput label="Post an update the customer will see" value={update} onChange={setUpdate} maxLength={1000} />
              <button type="submit" className="button button--outline button--small" disabled={update.trim().length < 2}>Post update</button>
            </form>
          </section>

          <section className="panel">
            <h2 className="panel__title">Download activity</h2>
            {data.downloadEvents.length ? (
              <ul className="timeline">
                {data.downloadEvents.map((e, i) => (
                  <li key={i}>
                    <span className="muted">{dateTime(e.created_at)}</span> {e.event.replace(/_/g, ' ')}
                    {e.detail && <span className="muted"> • {e.detail}</span>}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">No download activity.</p>
            )}
          </section>
        </div>

        <div>
          <section className="panel">
            <h2 className="panel__title">Customer</h2>
            <p>
              {o.user_id ? <a href={href(`admin-customer-${o.user_id}`)}>{o.customer_name || o.account_name}</a> : o.customer_name}
              <br />
              {o.email}
            </p>
            <p><strong>Billing:</strong> {addressText({ name: o.billing_details?.name, address: o.billing_details?.address })}</p>
          </section>
          <section className="panel">
            <h2 className="panel__title">Payment</h2>
            <dl className="kv">
              <dt>Payment ref</dt><dd>{o.stripe_payment_intent_id ?? 'None'}</dd>
              <dt>Checkout ref</dt><dd>{o.stripe_checkout_session_id ?? 'None'}</dd>
            </dl>
            {data.refunds.length > 0 && (
              <>
                <h3>Refunds</h3>
                <ul className="timeline">
                  {data.refunds.map((r) => (
                    <li key={r.id}>
                      <Pill value={r.status} /> {money(r.amount_cents)} • {dateTime(r.created_at)} • {r.created_by}
                      {r.reason && <div className="muted">{r.reason}</div>}
                      {r.stripe_refund_id && <div className="muted">Stripe ref {r.stripe_refund_id}</div>}
                      {r.failure_reason && <div className="field__error">{r.failure_reason}</div>}
                    </li>
                  ))}
                </ul>
              </>
            )}
            {data.paymentEvents.length > 0 && (
              <details>
                <summary>Payment events ({data.paymentEvents.length})</summary>
                <ul className="timeline">
                  {data.paymentEvents.map((e) => (
                    <li key={e.id}><span className="muted">{dateTime(e.received_at)}</span> {e.type} <Pill value={e.status === 'processed' ? 'succeeded' : e.status} label={e.status} /></li>
                  ))}
                </ul>
              </details>
            )}
          </section>
          <section className="panel">
            <h2 className="panel__title">Emails</h2>
            {data.emails.length ? (
              <ul className="timeline">
                {data.emails.map((e) => (
                  <li key={e.id}><a href={href(`admin-email-${e.id}`)}>{e.subject}</a> <Pill value={e.status} /><div className="muted">{dateTime(e.requested_at)}</div></li>
                ))}
              </ul>
            ) : (
              <p className="muted">No emails for this order.</p>
            )}
          </section>
          <section className="panel">
            <h2 className="panel__title">Internal notes</h2>
            <p className="muted">Only admins see these.</p>
            <ul className="timeline">
              {data.notes.map((n) => (
                <li key={n.id}><span className="muted">{dateTime(n.created_at)} • {n.author_email}</span><br />{n.body}</li>
              ))}
            </ul>
            <form
              className="form-stack"
              onSubmit={async (e) => {
                e.preventDefault()
                if (await post(`/api/admin/orders/${id}/notes`, { body: note }, 'Note added.')) setNote('')
              }}
            >
              <TextArea label="Add a note" value={note} onChange={setNote} maxLength={4000} rows={3} />
              <button type="submit" className="button button--outline button--small" disabled={!note.trim()}>Add note</button>
            </form>
          </section>
          {data.updates.length > 0 && (
            <section className="panel">
              <h2 className="panel__title">Customer facing updates</h2>
              <ul className="timeline">
                {data.updates.map((u) => (
                  <li key={u.id}><span className="muted">{dateTime(u.created_at)}</span> {u.message}</li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>

      <ShipmentDialog open={shipOpen} onClose={() => setShipOpen(false)} orderId={id} onDone={reload} />
      <RefundDialog open={refundOpen} onClose={() => setRefundOpen(false)} order={o} items={data.items} onDone={reload} />
      <ReplacementDialog item={replacement} onClose={() => setReplacement(null)} onDone={reload} />
    </>
  )
}

function ShipmentDialog({ open, onClose, orderId, onDone }: { open: boolean; onClose: () => void; orderId: string; onDone: () => void }) {
  const [carrier, setCarrier] = useState('')
  const [tracking, setTracking] = useState('')
  const [url, setUrl] = useState('')
  const [notify, setNotify] = useState(true)
  const [partial, setPartial] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const { showToast } = useUI()
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await api(`/api/admin/orders/${orderId}/shipments`, { body: { carrier, tracking_number: tracking, tracking_url: url, notify, partial, status: 'shipped' } })
      showToast(notify ? 'Marked as shipped. A shipping email was queued.' : 'Marked as shipped.')
      onClose()
      onDone()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open={open} onClose={onClose} title="Add shipment">
      <form className="form-stack" onSubmit={submit}>
        <TextInput label="Carrier" value={carrier} onChange={setCarrier} placeholder="USPS, UPS, FedEx" maxLength={60} />
        <TextInput label="Tracking number" value={tracking} onChange={setTracking} maxLength={100} />
        <TextInput label="Tracking link (optional)" value={url} onChange={setUrl} placeholder="https://" maxLength={500} />
        <Checkbox label="This shipment is only part of the order" checked={partial} onChange={setPartial} />
        <Checkbox label="Email the customer a shipping confirmation" checked={notify} onChange={setNotify} />
        <FormError message={error} />
        <button type="submit" className="button button--small" disabled={busy}>{busy ? 'Saving...' : 'Mark as shipped'}</button>
      </form>
    </Dialog>
  )
}

function RefundDialog({ open, onClose, order, items, onDone }: { open: boolean; onClose: () => void; order: Record<string, any>; items: Item[]; onDone: () => void }) {
  const [qty, setQty] = useState<Record<string, number>>({})
  const [amount, setAmount] = useState<number | null>(null)
  const [reason, setReason] = useState('')
  const [restock, setRestock] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const key = useMemo(() => (open ? newKey() : ''), [open])
  const { showToast } = useUI()
  const remaining = order.total_cents - order.refunded_cents
  const suggested = items.reduce((n, i) => n + (qty[i.id] ?? 0) * i.unit_price_cents, 0)
  const submit = async () => {
    setBusy(true)
    setError('')
    try {
      await api(`/api/admin/orders/${order.id}/refunds`, {
        body: { items: Object.entries(qty).filter(([, q]) => q > 0).map(([order_item_id, quantity]) => ({ order_item_id, quantity })), amount_cents: amount ?? suggested, reason, restock, idempotency_key: key },
      })
      showToast('Refund sent to Stripe. The order updates when Stripe confirms it.')
      onClose()
      onDone()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Confirm open={open} title={`Refund order ${order.order_number}`} confirmLabel={`Refund ${money(amount ?? suggested)}`} busy={busy} disabled={!(amount ?? suggested)} onClose={onClose} onConfirm={submit}>
      <Notice tone="warn">Refunds are processed by Stripe. Follow your approved refund policy. Unused downloads for fully refunded digital lines are handled by the refund download setting in Settings.</Notice>
      {items.map((i) => {
        const max = i.quantity - i.refunded_quantity
        if (max <= 0) return null
        return (
          <label key={i.id} className="field">
            <span className="field__label">{i.title_snapshot}{i.variant_snapshot ? ` (${i.variant_snapshot})` : ''}: refund quantity (max {max})</span>
            <input className="input" type="number" min={0} max={max} value={qty[i.id] ?? 0} onChange={(e) => setQty({ ...qty, [i.id]: Math.max(0, Math.min(max, Number(e.target.value) || 0)) })} />
          </label>
        )
      })}
      <MoneyInput label={`Amount (up to ${money(remaining)})`} cents={amount ?? suggested} onChange={setAmount} hint="Starts with the selected items. Adjust to include shipping or tax if your policy allows." />
      <TextInput label="Reason" value={reason} onChange={setReason} maxLength={500} />
      <Checkbox label="Return refunded physical items to stock" checked={restock} onChange={setRestock} />
      <FormError message={error} />
    </Confirm>
  )
}

function ReplacementDialog({ item, onClose, onDone }: { item: Item | null; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const { showToast } = useUI()
  return (
    <Confirm
      open={Boolean(item)}
      title="Grant a replacement download"
      confirmLabel="Grant one replacement download"
      busy={busy}
      disabled={reason.trim().length < 5}
      onClose={() => {
        setReason('')
        onClose()
      }}
      onConfirm={async () => {
        setBusy(true)
        setError('')
        try {
          await api(`/api/admin/order-items/${item!.id}/replacement-download`, { body: { reason } })
          showToast('Replacement download granted and recorded in the audit log.')
          setReason('')
          onClose()
          onDone()
        } catch (err) {
          setError(errorMessage(err))
        } finally {
          setBusy(false)
        }
      }}
    >
      <p>
        This is an exception to the one download policy for <strong>{item?.title_snapshot}</strong>. Use it only for genuine delivery problems. The customer receives one download of the latest version.
      </p>
      <TextArea label="Reason (required, saved in the audit log)" value={reason} onChange={setReason} maxLength={500} rows={3} />
      <FormError message={error} />
    </Confirm>
  )
}
