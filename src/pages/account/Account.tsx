import { Download, FileText, LogOut, Package, Printer, Truck } from 'lucide-react'
import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { api, errorMessage } from '../../lib/api'
import { useCart } from '../../lib/cart'
import { href, navigate, type AccountView } from '../../lib/router'
import { useSession } from '../../lib/session'
import { useStore } from '../../lib/store'
import { ProductArt } from '../../components/ProductArt'
import { TutorialHelpLink } from '../../components/TutorialCard'
import { Dialog } from '../../components/Dialog'
import { Checkbox, Confirm, dateOnly, dateTime, Empty, FormError, Loading, money, Notice, Pill, TextArea, TextInput, useApiData } from '../../components/ui'
import { rememberReturn } from '../Auth'
import './Account.css'

const tabs: Array<{ view: AccountView; label: string; route: string }> = [
  { view: 'overview', label: 'Overview', route: 'account' },
  { view: 'orders', label: 'My orders', route: 'account-orders' },
  { view: 'downloads', label: 'My downloads', route: 'account-downloads' },
  { view: 'settings', label: 'Account', route: 'account-settings' },
  { view: 'support', label: 'Support', route: 'account-support' },
]

export function AccountArea({ view, param }: { view: AccountView; param?: string }) {
  const { user, loading, signOut } = useSession()
  useEffect(() => {
    if (!loading && !user) {
      rememberReturn(window.location.hash.slice(1) || 'account')
      navigate('sign-in')
    }
  }, [loading, user])
  if (loading || !user) return <div className="container"><Loading /></div>

  const active = view === 'order' ? 'orders' : view
  return (
    <div className="container account">
      <header className="account__head">
        <div>
          <p className="eyebrow">My account</p>
          <h1 className="account__title">Hi, {user.name.split(' ')[0]}</h1>
        </div>
        <button
          type="button"
          className="button button--outline button--small"
          onClick={async () => {
            await signOut()
            navigate('home')
          }}
        >
          <LogOut aria-hidden="true" size={18} />
          Sign out
        </button>
      </header>
      <nav className="account__tabs" aria-label="Account sections">
        {tabs.map((t) => (
          <a key={t.view} href={href(t.route)} className="chip" aria-current={active === t.view ? 'page' : undefined}>
            {t.label}
          </a>
        ))}
        {user.role === 'admin' && (
          <a href={href('admin')} className="chip">
            Store admin
          </a>
        )}
      </nav>
      <div className="account__body">
        {view === 'overview' && <Overview />}
        {view === 'orders' && <Orders />}
        {view === 'order' && param && <OrderDetail number={param} />}
        {view === 'downloads' && <Downloads />}
        {view === 'settings' && <Settings />}
        {view === 'support' && <Support />}
      </div>
    </div>
  )
}

interface OrderSummary {
  id: string
  order_number: string
  status: string
  fulfillment_status: string
  total_cents: number
  refunded_cents: number
  created_at: string
  paid_at: string | null
  is_demo: boolean
  items: Array<{ title: string; variant: string; quantity: number; type: string }>
}

function Overview() {
  const orders = useApiData<{ orders: OrderSummary[] }>('/api/account/orders')
  const downloads = useApiData<{ downloads: DownloadCard[] }>('/api/account/downloads')
  const ready = downloads.data?.downloads.filter((d) => ['available', 'update_available', 'replacement_available'].includes(d.status)).length ?? 0
  return (
    <div className="account__grid">
      <a className="account-tile" href={href('account-downloads')}>
        <Download aria-hidden="true" />
        <span className="account-tile__title">My downloads</span>
        <span className="account-tile__text">{downloads.loading ? 'Loading...' : ready ? `${ready} ${ready === 1 ? 'download' : 'downloads'} ready` : 'Nothing waiting right now'}</span>
      </a>
      <a className="account-tile" href={href('account-orders')}>
        <Package aria-hidden="true" />
        <span className="account-tile__title">My orders</span>
        <span className="account-tile__text">{orders.loading ? 'Loading...' : `${orders.data?.orders.length ?? 0} orders`}</span>
      </a>
      <a className="account-tile" href={href('tutorials')}>
        <FileText aria-hidden="true" />
        <span className="account-tile__title">Tutorials</span>
        <span className="account-tile__text">Free videos on setting up your inserts</span>
      </a>
      <div className="account__help">
        <TutorialHelpLink category="np-inserts" />
      </div>
    </div>
  )
}

function Orders() {
  const { data, error, loading } = useApiData<{ orders: OrderSummary[] }>('/api/account/orders')
  if (loading) return <Loading label="Loading your orders..." />
  if (error) return <FormError message={error} />
  if (!data?.orders.length) return <Empty title="No orders yet"><a className="button button--small" href={href('shop')}>Browse the shop</a></Empty>
  return (
    <ul className="order-list">
      {data.orders.map((o) => (
        <li key={o.id}>
          <a className="order-card" href={href(`account-order-${o.order_number}`)}>
            <span className="order-card__head">
              <strong>Order {o.order_number}</strong>
              {o.is_demo && <span className="demo-tag">Demo</span>}
              <span className="muted">{dateOnly(o.paid_at ?? o.created_at)}</span>
            </span>
            <span className="order-card__items">{o.items.map((i) => `${i.title}${i.variant ? ` (${i.variant})` : ''}${i.quantity > 1 ? ` × ${i.quantity}` : ''}`).join(', ')}</span>
            <span className="order-card__foot">
              <span>{money(o.total_cents)}</span>
              <Pill value={o.status} />
              {o.fulfillment_status !== 'not_required' && <Pill value={o.fulfillment_status} />}
            </span>
          </a>
        </li>
      ))}
    </ul>
  )
}

interface OrderDetailData {
  order: Record<string, any>
  items: Array<{ id: string; product_type: string; title: string; variant: string; unit_price_cents: number; quantity: number; refunded_quantity: number }>
  shipments: Array<{ carrier: string; tracking_number: string; tracking_url: string; status: string; shipped_at: string; delivered_at: string | null }>
  updates: Array<{ message: string; created_at: string }>
}

const addressLines = (a?: Record<string, string> | null) => (a ? [a.line1, a.line2, [a.city, a.state, a.postal_code].filter(Boolean).join(' '), a.country].filter(Boolean) : [])

function OrderDetail({ number }: { number: string }) {
  const { data, error, loading } = useApiData<OrderDetailData>(`/api/account/orders/${encodeURIComponent(number)}`)
  if (loading) return <Loading label="Loading order..." />
  if (error) return <FormError message={error} />
  if (!data) return null
  const o = data.order
  const receipt = `/api/account/orders/${encodeURIComponent(number)}/receipt`
  const ship = o.shipping_address as { name?: string; address?: Record<string, string> } | null
  const billing = (o.billing_details ?? {}) as { name?: string; email?: string; address?: Record<string, string> }
  const hasDigital = data.items.some((i) => i.product_type === 'digital')
  return (
    <div className="order-detail">
      <a className="arrow-link" href={href('account-orders')}>
        ← All orders
      </a>
      <div className="panel">
        <div className="panel__head">
          <h2 className="panel__title">
            Order {o.order_number} {o.is_demo && <span className="demo-tag">Demo</span>}
          </h2>
          <div className="button-row">
            <a className="button button--outline button--small" href={receipt} target="_blank" rel="noopener">
              <Printer aria-hidden="true" size={18} /> View receipt
            </a>
            <a className="button button--outline button--small" href={`${receipt}?download=1`}>
              <Download aria-hidden="true" size={18} /> Download receipt
            </a>
          </div>
        </div>
        <dl className="kv">
          <dt>Purchased</dt>
          <dd>{dateTime(o.paid_at ?? o.created_at)}</dd>
          <dt>Payment</dt>
          <dd><Pill value={o.status} /></dd>
          {o.fulfillment_status !== 'not_required' && (
            <>
              <dt>Shipping</dt>
              <dd><Pill value={o.fulfillment_status} /></dd>
            </>
          )}
        </dl>
        <div className="data-table-wrap">
          <table className="data-table">
            <thead>
              <tr><th>Item</th><th className="num">Qty</th><th className="num">Price</th><th className="num">Total</th></tr>
            </thead>
            <tbody>
              {data.items.map((i) => (
                <tr key={i.id}>
                  <td>
                    {i.title}
                    {i.variant && <span className="muted"> ({i.variant})</span>}
                    <br />
                    <span className="muted">{i.product_type === 'digital' ? 'Digital download • Binder not included' : 'Ships to you'}</span>
                    {i.refunded_quantity > 0 && <> <Pill value="refunded" /></>}
                  </td>
                  <td className="num">{i.quantity}</td>
                  <td className="num">{money(i.unit_price_cents)}</td>
                  <td className="num">{money(i.unit_price_cents * i.quantity)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <dl className="kv totals">
          <dt>Subtotal</dt><dd>{money(o.subtotal_cents)}</dd>
          {o.discount_cents > 0 && (<><dt>Discounts</dt><dd>{money(o.discount_cents)}</dd></>)}
          <dt>Shipping</dt><dd>{money(o.shipping_cents)}</dd>
          <dt>Tax</dt><dd>{money(o.tax_cents)}</dd>
          <dt>Total</dt><dd><strong>{money(o.total_cents)}</strong></dd>
          {o.refunded_cents > 0 && (<><dt>Refunded</dt><dd>{money(o.refunded_cents)}</dd></>)}
        </dl>
        {hasDigital && (
          <Notice>
            Your digital items are in <a href={href('account-downloads')}>My downloads</a>.
          </Notice>
        )}
      </div>
      <div className="account__grid">
        {ship && (
          <div className="panel">
            <h3 className="panel__title">Shipping address used</h3>
            <p>{ship.name}<br />{addressLines(ship.address).map((l) => (<span key={l}>{l}<br /></span>))}</p>
          </div>
        )}
        <div className="panel">
          <h3 className="panel__title">Billing</h3>
          <p>{billing.name}<br />{billing.email}<br />{addressLines(billing.address).map((l) => (<span key={l}>{l}<br /></span>))}</p>
          <p className="muted">Card details are held by our payment provider and are never stored by the store.</p>
        </div>
      </div>
      {data.shipments.length > 0 && (
        <div className="panel">
          <h3 className="panel__title"><Truck aria-hidden="true" size={20} /> Tracking</h3>
          {data.shipments.map((s, i) => (
            <dl className="kv" key={i}>
              <dt>Status</dt><dd><Pill value={s.status} /></dd>
              <dt>Carrier</dt><dd>{s.carrier || 'Not provided'}</dd>
              <dt>Tracking number</dt><dd>{s.tracking_number || 'Not provided'}</dd>
              {s.tracking_url && (<><dt>Track</dt><dd><a href={s.tracking_url} target="_blank" rel="noopener noreferrer">Open carrier tracking</a></dd></>)}
              <dt>Shipped</dt><dd>{dateOnly(s.shipped_at)}</dd>
            </dl>
          ))}
        </div>
      )}
      {data.updates.length > 0 && (
        <div className="panel">
          <h3 className="panel__title">Updates</h3>
          <ul className="timeline">
            {data.updates.map((u, i) => (
              <li key={i}><span className="muted">{dateTime(u.created_at)}</span> {u.message}</li>
            ))}
          </ul>
        </div>
      )}
      <a className="arrow-link" href={href('account-support')} onClick={() => sessionStorage.setItem('nlc-support-order', String(o.order_number))}>
        Need help with this order? Contact support
      </a>
    </div>
  )
}

interface DownloadCard {
  orderItemId: string
  entitlementId: string | null
  productSlug: string
  title: string
  orderNumber: string
  purchasedAt: string
  versionNumber: number | null
  versionReleasedAt: string | null
  versionNotes: string
  status: 'available' | 'update_available' | 'replacement_available' | 'used' | 'awaiting_file' | 'unavailable'
  statusText: string
  redeemedAt: string | null
  canReport: boolean
}

function Downloads() {
  const { data, error, loading, reload } = useApiData<{ downloads: DownloadCard[] }>('/api/account/downloads')
  const { getProduct } = useStore()
  const [confirm, setConfirm] = useState<DownloadCard | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ tone: 'success' | 'warn'; text: string } | null>(null)
  const [report, setReport] = useState<DownloadCard | null>(null)

  const start = async (d: DownloadCard) => {
    setBusy(true)
    setMessage(null)
    try {
      const res = await api<{ url: string }>(`/api/downloads/${d.entitlementId}/prepare`, { method: 'POST' })
      setConfirm(null)
      // The browser saves the file from this one time link.
      window.location.assign(res.url)
      setMessage({ tone: 'success', text: `Your download of ${d.title} has started. Save the file somewhere you can find it again. If it did not save, use "Report a download problem".` })
      window.setTimeout(() => void reload(), 2500)
    } catch (err) {
      setConfirm(null)
      setMessage({ tone: 'warn', text: errorMessage(err) })
      void reload()
    } finally {
      setBusy(false)
    }
  }

  if (loading && !data) return <Loading label="Loading your downloads..." />
  if (error) return <FormError message={error} />
  const list = data?.downloads ?? []
  return (
    <div className="downloads">
      <Notice>
        Each digital purchase includes <strong>one download</strong> of the latest version. When a new version is released, you get one new download of it.
      </Notice>
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      {!list.length ? (
        <Empty title="No digital purchases yet">
          <a className="button button--small" href={href('shop')}>Browse digital resources</a>
        </Empty>
      ) : (
        <ul className="download-list">
          {list.map((d) => {
            const product = getProduct(d.productSlug)
            const ready = ['available', 'update_available', 'replacement_available'].includes(d.status)
            return (
              <li key={d.orderItemId} className={`download-card ${ready ? 'is-ready' : ''}`}>
                <span className="download-card__media">{product ? <ProductArt image={product.gallery[0]} /> : null}</span>
                <div className="download-card__info">
                  <h3 className="download-card__title">{d.title}</h3>
                  <p className="muted">
                    Order <a href={href(`account-order-${d.orderNumber}`)}>{d.orderNumber}</a> • Purchased {dateOnly(d.purchasedAt)}
                  </p>
                  {d.versionNumber && (
                    <p className="muted">
                      Version {d.versionNumber}
                      {d.versionReleasedAt ? `, updated ${dateOnly(d.versionReleasedAt)}` : ''}
                      {d.versionNotes ? `: ${d.versionNotes}` : ''}
                    </p>
                  )}
                  <p className={`download-card__status download-card__status--${d.status}`}>{d.statusText}</p>
                  {d.status === 'used' && d.redeemedAt && <p className="muted">Downloaded {dateTime(d.redeemedAt)}</p>}
                </div>
                <div className="download-card__actions">
                  {ready && d.entitlementId && (
                    <button type="button" className="button button--small" onClick={() => setConfirm(d)}>
                      <Download aria-hidden="true" size={18} /> Download
                    </button>
                  )}
                  {d.canReport && d.entitlementId && (
                    <button type="button" className="button button--outline button--small" onClick={() => setReport(d)}>
                      Report a download problem
                    </button>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}
      <Confirm open={Boolean(confirm)} title={confirm ? `Download ${confirm.title}` : 'Download'} confirmLabel="Download now" busy={busy} onClose={() => setConfirm(null)} onConfirm={() => confirm && start(confirm)}>
        <p>
          <strong>You have one download available. Save the file somewhere you can find it again.</strong>
        </p>
        <p className="muted">Starting the download uses it. Viewing this page does not.</p>
      </Confirm>
      <ReportDialog item={report} onClose={() => setReport(null)} onDone={() => setMessage({ tone: 'success', text: 'Thanks for letting us know. The store will review your report and get back to you.' })} />
      <TutorialHelpLink category="np-inserts" />
    </div>
  )
}

function ReportDialog({ item, onClose, onDone }: { item: DownloadCard | null; onClose: () => void; onDone: () => void }) {
  const [text, setText] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    setText('')
    setError('')
  }, [item])
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    try {
      await api(`/api/downloads/${item!.entitlementId}/report`, { body: { message: text } })
      onClose()
      onDone()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open={Boolean(item)} onClose={onClose} title="Report a download problem">
      <form className="form-stack" onSubmit={submit}>
        <p className="muted">Tell us what happened with {item?.title}. A person at the store reviews every report. Downloads are never reset automatically.</p>
        <TextArea label="What went wrong?" value={text} onChange={setText} maxLength={2000} required />
        <FormError message={error} />
        <button type="submit" className="button button--small" disabled={busy || text.trim().length < 5}>
          {busy ? 'Sending...' : 'Send report'}
        </button>
      </form>
    </Dialog>
  )
}

interface Me {
  user: { id: string; name: string; email: string }
  preferences: { order_updates: boolean; product_updates: boolean; marketing: boolean }
  addresses: Array<{ id: string; name: string; line1: string; line2: string; city: string; region: string; postal_code: string; country: string; phone: string; is_default: boolean }>
}

function Settings() {
  const { data, loading, reload } = useApiData<Me>('/api/account/me')
  const { refresh } = useSession()
  const [name, setName] = useState('')
  const [prefs, setPrefs] = useState({ order_updates: true, product_updates: true, marketing: false })
  const [saved, setSaved] = useState('')
  const [error, setError] = useState('')
  useEffect(() => {
    if (data) {
      setName(data.user.name)
      setPrefs(data.preferences)
    }
  }, [data])
  if (loading || !data) return <Loading />
  const save = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    try {
      await api('/api/account/profile', { method: 'PATCH', body: { name, ...prefs } })
      setSaved('Saved.')
      await refresh()
    } catch (err) {
      setError(errorMessage(err))
    }
  }
  return (
    <div className="account__grid account__grid--wide">
      <form className="panel form-stack" onSubmit={save}>
        <h2 className="panel__title">Profile and email preferences</h2>
        <TextInput label="Name" value={name} onChange={setName} maxLength={100} />
        <TextInput label="Account email" value={data.user.email} onChange={() => {}} disabled hint="To change your account email, contact support." />
        <Checkbox label="Order and shipping updates" checked={prefs.order_updates} onChange={(v) => setPrefs({ ...prefs, order_updates: v })} hint="Receipts and download emails are always sent." />
        <Checkbox label="Product update emails" checked={prefs.product_updates} onChange={(v) => setPrefs({ ...prefs, product_updates: v })} hint="When a new version of something you bought is released." />
        <Checkbox label="News and new products" checked={prefs.marketing} onChange={(v) => setPrefs({ ...prefs, marketing: v })} hint="Off unless you turn it on." />
        <FormError message={error} />
        <div className="button-row">
          <button type="submit" className="button button--small">Save</button>
          {saved && <span role="status">{saved}</span>}
        </div>
      </form>
      <PasswordPanel />
      <Addresses addresses={data.addresses} reload={reload} />
    </div>
  )
}

function PasswordPanel() {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [msg, setMsg] = useState('')
  const [error, setError] = useState('')
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setMsg('')
    if (next.length < 10) return setError('Please choose a password with at least 10 characters.')
    try {
      await api('/api/auth/change-password', { body: { currentPassword: current, newPassword: next, revokeOtherSessions: true } })
      setMsg('Password changed. Other devices have been signed out.')
      setCurrent('')
      setNext('')
    } catch (err) {
      setError(errorMessage(err))
    }
  }
  return (
    <form className="panel form-stack" onSubmit={submit}>
      <h2 className="panel__title">Password</h2>
      <TextInput label="Current password" type="password" value={current} onChange={setCurrent} autoComplete="current-password" />
      <TextInput label="New password" type="password" value={next} onChange={setNext} autoComplete="new-password" hint="At least 10 characters." />
      <FormError message={error} />
      {msg && <Notice tone="success">{msg}</Notice>}
      <button type="submit" className="button button--small" disabled={!current || !next}>Change password</button>
    </form>
  )
}

const blankAddress = { name: '', line1: '', line2: '', city: '', region: '', postal_code: '', country: 'US', phone: '', is_default: false }

function Addresses({ addresses, reload }: { addresses: Me['addresses']; reload: () => void }) {
  const [editing, setEditing] = useState<(typeof blankAddress & { id?: string }) | null>(null)
  const [error, setError] = useState('')
  const save = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    try {
      if (editing!.id) await api(`/api/account/addresses/${editing!.id}`, { method: 'PUT', body: editing })
      else await api('/api/account/addresses', { body: editing })
      setEditing(null)
      reload()
    } catch (err) {
      setError(errorMessage(err))
    }
  }
  const field = (k: keyof typeof blankAddress, label: string, opts: { hint?: string; max?: number } = {}): ReactNode => (
    <TextInput label={label} value={String(editing![k])} onChange={(v) => setEditing({ ...editing!, [k]: v })} maxLength={opts.max ?? 200} hint={opts.hint} />
  )
  return (
    <div className="panel">
      <div className="panel__head">
        <h2 className="panel__title">Saved addresses</h2>
        <button type="button" className="button button--outline button--small" onClick={() => setEditing({ ...blankAddress })}>Add address</button>
      </div>
      <p className="muted">Changing a saved address never changes the address on past orders.</p>
      {!addresses.length && <p className="muted">No saved addresses yet.</p>}
      <ul className="address-list">
        {addresses.map((a) => (
          <li key={a.id}>
            <p>
              <strong>{a.name}</strong> {a.is_default && <Pill value="active" label="Default" />}
              <br />
              {a.line1}
              {a.line2 && <>, {a.line2}</>}
              <br />
              {a.city} {a.region} {a.postal_code} {a.country}
            </p>
            <div className="button-row">
              <button type="button" className="chip" onClick={() => setEditing({ ...a })}>Edit</button>
              <button
                type="button"
                className="chip"
                onClick={async () => {
                  await api(`/api/account/addresses/${a.id}`, { method: 'DELETE' })
                  reload()
                }}
              >
                Remove
              </button>
            </div>
          </li>
        ))}
      </ul>
      <Dialog open={Boolean(editing)} onClose={() => setEditing(null)} title={editing?.id ? 'Edit address' : 'Add address'}>
        {editing && (
          <form className="form-stack" onSubmit={save}>
            {field('name', 'Full name')}
            {field('line1', 'Address line 1')}
            {field('line2', 'Address line 2 (optional)')}
            <div className="form-grid">
              {field('city', 'City')}
              {field('region', 'State or region')}
              {field('postal_code', 'ZIP or postal code', { max: 20 })}
              {field('country', 'Country code', { hint: 'Two letters, for example US', max: 2 })}
            </div>
            {field('phone', 'Phone (optional)', { max: 40 })}
            <Checkbox label="Make this my default address" checked={editing.is_default} onChange={(v) => setEditing({ ...editing, is_default: v })} />
            <FormError message={error} />
            <button type="submit" className="button button--small">Save address</button>
          </form>
        )}
      </Dialog>
    </div>
  )
}

function Support() {
  const { data } = useApiData<{ orders: OrderSummary[] }>('/api/account/orders')
  const [order, setOrder] = useState(() => {
    try {
      return sessionStorage.getItem('nlc-support-order') ?? ''
    } catch {
      return ''
    }
  })
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    try {
      await api('/api/account/support', { body: { order_number: order || null, subject, message } })
      setSent(true)
      try {
        sessionStorage.removeItem('nlc-support-order')
      } catch {
        /* ignore */
      }
    } catch (err) {
      setError(errorMessage(err))
    }
  }
  if (sent) return <Notice tone="success">Thanks! Your message was sent to the store. You will hear back by email.</Notice>
  return (
    <form className="panel form-stack support-form" onSubmit={submit}>
      <h2 className="panel__title">Contact support</h2>
      <label className="field">
        <span className="field__label">About an order (optional)</span>
        <select className="input" value={order} onChange={(e) => setOrder(e.target.value)}>
          <option value="">Not about a specific order</option>
          {data?.orders.map((o) => (
            <option key={o.id} value={o.order_number}>
              {o.order_number} • {dateOnly(o.paid_at ?? o.created_at)}
            </option>
          ))}
        </select>
      </label>
      <TextInput label="Subject" value={subject} onChange={setSubject} maxLength={140} required />
      <TextArea label="Message" value={message} onChange={setMessage} maxLength={4000} rows={6} required />
      <FormError message={error} />
      <button type="submit" className="button button--small" disabled={subject.trim().length < 2 || message.trim().length < 5}>Send message</button>
      <p className="muted">For a problem with a file, use "Report a download problem" in My downloads.</p>
    </form>
  )
}

export function CheckoutResult({ result }: { result: 'success' | 'canceled' }) {
  const { clear } = useCart()
  useEffect(() => {
    if (result === 'success') clear()
  }, [result, clear])
  return (
    <section className="container auth">
      <div className="auth__card">
        {result === 'success' ? (
          <>
            <h1 className="auth__title">Thank you!</h1>
            <p>Your payment is being confirmed. Your order and any downloads appear in your account as soon as the payment provider confirms it, usually within a minute.</p>
            <div className="button-row">
              <a className="button button--small" href={href('account-orders')}>View my orders</a>
              <a className="button button--outline button--small" href={href('account-downloads')}>My downloads</a>
            </div>
          </>
        ) : (
          <>
            <h1 className="auth__title">Checkout canceled</h1>
            <p>No payment was taken. Your bag is still saved.</p>
            <a className="button button--small" href={href('shop')}>Keep shopping</a>
          </>
        )}
      </div>
    </section>
  )
}
