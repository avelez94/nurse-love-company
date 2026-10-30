import { Download } from 'lucide-react'
import { useMemo, useState } from 'react'
import { href } from '../../lib/router'
import { Checkbox, dateTime, FormError, Loading, money, Notice, Pill, useApiData } from '../../components/ui'
import { PageTitle } from './AdminApp'

type Preset = 'today' | '7d' | '30d' | 'mtd' | 'ytd' | 'custom'

export function rangeFor(preset: Preset, customFrom: string, customTo: string) {
  const now = new Date()
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const end = new Date(startOfDay(now).getTime() + 86400000)
  switch (preset) {
    case 'today':
      return { from: startOfDay(now), to: end }
    case '7d':
      return { from: new Date(end.getTime() - 7 * 86400000), to: end }
    case '30d':
      return { from: new Date(end.getTime() - 30 * 86400000), to: end }
    case 'mtd':
      return { from: new Date(now.getFullYear(), now.getMonth(), 1), to: end }
    case 'ytd':
      return { from: new Date(now.getFullYear(), 0, 1), to: end }
    case 'custom': {
      const f = customFrom ? new Date(`${customFrom}T00:00:00`) : new Date(end.getTime() - 30 * 86400000)
      const t = customTo ? new Date(new Date(`${customTo}T00:00:00`).getTime() + 86400000) : end
      return { from: f, to: t }
    }
  }
}

export function DateRangeControls({ preset, setPreset, from, setFrom, to, setTo }: { preset: Preset; setPreset: (p: Preset) => void; from: string; setFrom: (v: string) => void; to: string; setTo: (v: string) => void }) {
  const presets: Array<[Preset, string]> = [['today', 'Today'], ['7d', 'Last 7 days'], ['30d', 'Last 30 days'], ['mtd', 'Month to date'], ['ytd', 'Year to date'], ['custom', 'Custom']]
  return (
    <div className="filters" role="group" aria-label="Date range">
      <div className="chip-row">
        {presets.map(([p, label]) => (
          <button key={p} type="button" className="chip" aria-pressed={preset === p} onClick={() => setPreset(p)}>
            {label}
          </button>
        ))}
      </div>
      {preset === 'custom' && (
        <>
          <label className="field">
            <span className="field__label">From</span>
            <input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="field">
            <span className="field__label">To</span>
            <input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
        </>
      )}
    </div>
  )
}

interface Summary {
  grossSales: number
  discounts: number
  refunds: number
  netSales: number
  shipping: number
  taxes: number
  processingFees: number
  feesMissingFor: number
  orders: number
  averageOrderValue: number
  digitalSales: number
  physicalSales: number
  newCustomers: number
  returningCustomers: number
}

interface Report {
  current: Summary
  previous: Summary
  byProduct: Array<{ product_id: string; title: string; type: string; units: number; gross: number }>
  byCategory: Array<{ category: string; units: number; gross: number }>
  recentOrders: Array<{ id: string; order_number: string; customer_name: string; status: string; fulfillment_status: string; total_cents: number; created_at: string; is_demo: boolean }>
  lowStock: Array<{ product_id: string; title: string; stock: number; threshold: number }>
  daily: Array<{ day: string; gross: number }>
  counts: { open_reports: number; open_support: number; to_fulfill: number; email_problems: number; has_demo: boolean }
  integrations: { payments: { state: string; webhook: boolean }; email: { configured: boolean; webhook: boolean }; storage: { driver: string; configured: boolean }; video: { provider: string; configured: boolean } }
}

function Delta({ now, before, money: isMoney }: { now: number; before: number; money?: boolean }) {
  if (before === 0 && now === 0) return <span className="kpi__delta">No change from the previous period</span>
  if (before === 0) return <span className="kpi__delta kpi__delta--up">New this period (previous: {isMoney ? money(0) : 0})</span>
  const pct = Math.round(((now - before) / Math.abs(before)) * 100)
  return (
    <span className={`kpi__delta ${pct > 0 ? 'kpi__delta--up' : pct < 0 ? 'kpi__delta--down' : ''}`}>
      {pct > 0 ? '▲' : pct < 0 ? '▼' : ''} {Math.abs(pct)}% vs previous ({isMoney ? money(before) : before})
    </span>
  )
}

function Kpi({ label, value, prev, isMoney = true, primary }: { label: string; value: number; prev: number; isMoney?: boolean; primary?: boolean }) {
  return (
    <div className={`kpi ${primary ? 'kpi--primary' : ''}`}>
      <span className="kpi__label">{label}</span>
      <span className="kpi__value">{isMoney ? money(value) : value}</span>
      <Delta now={value} before={prev} money={isMoney} />
    </div>
  )
}

function DailyChart({ daily, from, to }: { daily: Report['daily']; from: Date; to: Date }) {
  const days = Math.min(Math.max(1, Math.round((to.getTime() - from.getTime()) / 86400000)), 120)
  const byDay = new Map(daily.map((d) => [new Date(d.day).toDateString(), d.gross]))
  const values = Array.from({ length: days }, (_, i) => {
    const d = new Date(from.getTime() + i * 86400000)
    return { d, v: byDay.get(d.toDateString()) ?? 0 }
  })
  const max = Math.max(1, ...values.map((x) => x.v))
  const w = 600
  const h = 140
  const bw = w / values.length
  return (
    <svg className="chart" viewBox={`0 0 ${w} ${h + 20}`} role="img" aria-label={`Daily gross sales. Highest day ${money(max)}.`} preserveAspectRatio="none">
      {values.map((x, i) => {
        const bh = (x.v / max) * h
        return <rect key={i} x={i * bw + bw * 0.15} y={h - bh} width={Math.max(1, bw * 0.7)} height={bh} rx={2}><title>{`${x.d.toLocaleDateString()}: ${money(x.v)}`}</title></rect>
      })}
      <line className="chart__base" x1={0} x2={w} y1={h} y2={h} />
      <text x={0} y={h + 16}>{values[0]?.d.toLocaleDateString()}</text>
      <text x={w} y={h + 16} textAnchor="end">{values[values.length - 1]?.d.toLocaleDateString()}</text>
    </svg>
  )
}

const categoryNames: Record<string, string> = { 'nurse-inserts': 'Nurse Binder Inserts', 'np-inserts': 'NP Binder Inserts', apparel: 'Apparel', accessories: 'Accessories', pens: 'Pens', other: 'Other' }

export function Overview() {
  const [preset, setPreset] = useState<Preset>('30d')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [includeDemo, setIncludeDemo] = useState(true)
  const range = useMemo(() => rangeFor(preset, from, to), [preset, from, to])
  const qs = `from=${encodeURIComponent(range.from.toISOString())}&to=${encodeURIComponent(range.to.toISOString())}&demo=${includeDemo ? 1 : 0}`
  const { data, error, loading } = useApiData<Report>(`/api/admin/overview?${qs}`)

  return (
    <>
      <PageTitle title="Overview">
        <a className="button button--outline button--small" href={`/api/admin/reports/orders.csv?${qs}`}>
          <Download size={16} aria-hidden="true" /> Orders CSV
        </a>
        <a className="button button--outline button--small" href={`/api/admin/reports/sales.csv?${qs}`}>
          <Download size={16} aria-hidden="true" /> Sales CSV
        </a>
      </PageTitle>
      <DateRangeControls preset={preset} setPreset={setPreset} from={from} setFrom={setFrom} to={to} setTo={setTo} />
      <Checkbox label="Include demo data" checked={includeDemo} onChange={setIncludeDemo} hint="Demo orders are sample data created for the preview. Turn this off to see real transactions only." />
      {error && <FormError message={error} />}
      {loading && !data && <Loading label="Calculating..." />}
      {data && (
        <>
          {data.counts.has_demo && includeDemo && <Notice tone="warn">These numbers include labeled demo orders. They are sample data, not real sales.</Notice>}
          <IntegrationNotice integrations={data.integrations} />
          <div className="button-row">
            {data.counts.to_fulfill > 0 && <a className="chip" href={href('admin-orders')}>{data.counts.to_fulfill} orders to ship</a>}
            {data.counts.open_reports > 0 && <a className="chip" href={href('admin-support')}>{data.counts.open_reports} download problem reports</a>}
            {data.counts.open_support > 0 && <a className="chip" href={href('admin-support')}>{data.counts.open_support} support messages</a>}
            {data.counts.email_problems > 0 && <a className="chip" href={href('admin-emails')}>{data.counts.email_problems} email delivery problems</a>}
          </div>
          <section className="kpis" aria-label="Revenue">
            <Kpi label="Net sales" value={data.current.netSales} prev={data.previous.netSales} primary />
            <Kpi label="Gross sales" value={data.current.grossSales} prev={data.previous.grossSales} />
            <Kpi label="Discounts" value={data.current.discounts} prev={data.previous.discounts} />
            <Kpi label="Refunds" value={data.current.refunds} prev={data.previous.refunds} />
            <Kpi label="Orders" value={data.current.orders} prev={data.previous.orders} isMoney={false} />
            <Kpi label="Average order value" value={data.current.averageOrderValue} prev={data.previous.averageOrderValue} />
            <Kpi label="Shipping collected" value={data.current.shipping} prev={data.previous.shipping} />
            <Kpi label="Taxes collected" value={data.current.taxes} prev={data.previous.taxes} />
            <div className="kpi">
              <span className="kpi__label">Processing fees</span>
              <span className="kpi__value">{money(data.current.processingFees)}</span>
              <span className="kpi__delta">{data.current.feesMissingFor ? `Not yet reported for ${data.current.feesMissingFor} orders` : 'As reported by Stripe'}</span>
            </div>
          </section>
          <p className="muted">Compared with {dateTime(new Date(range.from.getTime() - (range.to.getTime() - range.from.getTime())).toISOString())} to {dateTime(range.from.toISOString())}. These figures are sales, not profit: product costs, shipping labels and other expenses are not included.</p>

          <div className="admin-cols">
            <div>
              <section className="panel">
                <h2 className="panel__title">Gross sales by day</h2>
                <DailyChart daily={data.daily} from={range.from} to={range.to} />
              </section>
              <section className="panel">
                <h2 className="panel__title">Sales by product</h2>
                {data.byProduct.length ? (
                  <div className="data-table-wrap">
                    <table className="data-table">
                      <thead><tr><th>Product</th><th>Type</th><th className="num">Units</th><th className="num">Gross sales</th></tr></thead>
                      <tbody>
                        {data.byProduct.map((p) => (
                          <tr key={p.product_id}>
                            <td><a href={href(`admin-product-${p.product_id}`)}>{p.title}</a></td>
                            <td>{p.type}</td>
                            <td className="num">{p.units}</td>
                            <td className="num">{money(p.gross)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="muted">No sales in this period.</p>
                )}
              </section>
              <section className="panel">
                <div className="panel__head">
                  <h2 className="panel__title">Recent orders</h2>
                  <a className="arrow-link" href={href('admin-orders')}>All orders</a>
                </div>
                <div className="data-table-wrap">
                  <table className="data-table">
                    <thead><tr><th>Order</th><th>Customer</th><th>Payment</th><th>Fulfillment</th><th className="num">Total</th></tr></thead>
                    <tbody>
                      {data.recentOrders.map((o) => (
                        <tr key={o.id}>
                          <td><a href={href(`admin-order-${o.id}`)}>{o.order_number}</a>{o.is_demo && <span className="demo-tag">Demo</span>}<br /><span className="muted">{dateTime(o.created_at)}</span></td>
                          <td>{o.customer_name}</td>
                          <td><Pill value={o.status} /></td>
                          <td><Pill value={o.fulfillment_status} /></td>
                          <td className="num">{money(o.total_cents)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </div>
            <div>
              <section className="panel">
                <h2 className="panel__title">Digital and physical</h2>
                <div className="split-bar" aria-hidden="true">
                  <span style={{ flex: data.current.digitalSales || 0 }} />
                  <span style={{ flex: data.current.physicalSales || 0 }} />
                </div>
                <p className="legend">
                  <span><i style={{ background: 'var(--raspberry)' }} />Digital {money(data.current.digitalSales)}</span>
                  <span><i style={{ background: '#e98aa8' }} />Physical {money(data.current.physicalSales)}</span>
                </p>
              </section>
              <section className="panel">
                <h2 className="panel__title">Customers</h2>
                <dl className="kv">
                  <dt>New</dt><dd>{data.current.newCustomers}</dd>
                  <dt>Returning</dt><dd>{data.current.returningCustomers}</dd>
                </dl>
              </section>
              <section className="panel">
                <h2 className="panel__title">By category</h2>
                <dl className="kv">
                  {data.byCategory.map((c) => (
                    <span key={c.category} style={{ display: 'contents' }}>
                      <dt>{categoryNames[c.category] ?? c.category}</dt>
                      <dd>{money(c.gross)} • {c.units} units</dd>
                    </span>
                  ))}
                </dl>
              </section>
              <section className="panel">
                <h2 className="panel__title">Low stock</h2>
                {data.lowStock.length ? (
                  <ul className="timeline">
                    {data.lowStock.map((l, i) => (
                      <li key={i}>
                        <a href={href(`admin-product-${l.product_id}`)}>{l.title}</a>: <strong>{l.stock}</strong> left (alert at {l.threshold})
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="muted">Nothing is running low.</p>
                )}
              </section>
              <details className="panel definitions">
                <summary><strong>How these numbers are calculated</strong></summary>
                <dl>
                  <dt>Gross sales</dt><dd>Item price × quantity on paid orders in the range. Excludes shipping and tax.</dd>
                  <dt>Discounts</dt><dd>Promotion codes and other discounts on those orders.</dd>
                  <dt>Refunds</dt><dd>Refunds that succeeded during the range. May include refunded shipping or tax.</dd>
                  <dt>Net sales</dt><dd>Gross sales minus discounts and refunds.</dd>
                  <dt>Shipping</dt><dd>Shipping charged to customers. Shown separately; not product revenue.</dd>
                  <dt>Taxes</dt><dd>Sales tax collected. Owed to tax authorities; not revenue.</dd>
                  <dt>Processing fees</dt><dd>Stripe fees when Stripe has reported them.</dd>
                  <dt>Average order value</dt><dd>Gross sales minus discounts, divided by the number of orders. Excludes shipping and tax.</dd>
                  <dt>New customers</dt><dd>Customers whose first paid order is in the range.</dd>
                  <dt>Comparison</dt><dd>The same length of time immediately before the selected range.</dd>
                  <dt>Not profit</dt><dd>Product costs, materials, labels and other expenses are not included anywhere here.</dd>
                </dl>
              </details>
            </div>
          </div>
        </>
      )}
    </>
  )
}

export function IntegrationNotice({ integrations }: { integrations: Report['integrations'] }) {
  const missing: string[] = []
  if (integrations.payments.state === 'not-configured') missing.push('payments (Stripe)')
  if (integrations.payments.state === 'live-blocked') missing.push('live payment approval')
  if (!integrations.email.configured) missing.push('email sending (Resend)')
  if (integrations.storage.driver === 'local') missing.push('cloud file storage (using this server\'s disk for now)')
  if (integrations.video.provider === 'local') missing.push('video streaming (Mux; using this server for now)')
  if (!missing.length) return null
  return (
    <Notice tone="warn">
      <span>
        <strong>Awaiting configuration:</strong> {missing.join(', ')}. See <a href={href('admin-settings')}>Settings</a> for details.
      </span>
    </Notice>
  )
}
