import { useState } from 'react'
import { api, errorMessage } from '../../lib/api'
import { useUI } from '../../lib/ui'
import { Checkbox, Confirm, dateOnly, Empty, FormError, Loading, money, MoneyInput, Notice, Pill, Select, TextInput, useApiData } from '../../components/ui'
import { PageTitle } from './AdminApp'

interface Coupon {
  id: string
  code: string
  status: 'active' | 'scheduled' | 'expired' | 'used_up' | 'off'
  percentOff: number | null
  amountOffCents: number | null
  startsAt: string | null
  endsAt: string | null
  maxUses: number | null
  timesUsed: number
  firstOrderOnly: boolean
  minimumCents: number | null
  note: string
  createdAt: string
}

const statusPill: Record<Coupon['status'], { value: string; label: string }> = {
  active: { value: 'active', label: 'Active' },
  scheduled: { value: 'pending', label: 'Starts later' },
  expired: { value: 'archived', label: 'Expired' },
  used_up: { value: 'redeemed', label: 'Used up' },
  off: { value: 'inactive', label: 'Turned off' },
}

const blank = { code: '', kind: 'percent' as 'percent' | 'amount', percent: '', amountCents: null as number | null, start: '', end: '', maxUses: '', minimumCents: null as number | null, firstOrderOnly: false, note: '' }

const today = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function amountText(c: { percentOff: number | null; amountOffCents: number | null }) {
  return c.percentOff ? `${c.percentOff}% off` : c.amountOffCents ? `${money(c.amountOffCents)} off` : 'Discount'
}

function rulesText(c: Coupon) {
  const parts: string[] = []
  if (c.minimumCents) parts.push(`Orders of ${money(c.minimumCents)} or more`)
  if (c.firstOrderOnly) parts.push('First order only')
  if (c.startsAt) parts.push(`Starts ${dateOnly(c.startsAt)}`)
  parts.push(c.endsAt ? `Ends ${dateOnly(c.endsAt)}` : 'No end date')
  return parts.join(' • ')
}

function DateInput({ label, value, onChange, min, hint }: { label: string; value: string; onChange: (v: string) => void; min?: string; hint?: string }) {
  return (
    <label className="field">
      <span className="field__label">{label}</span>
      <input className="input" type="date" value={value} min={min} onChange={(e) => onChange(e.target.value)} />
      {hint && <span className="field__hint">{hint}</span>}
    </label>
  )
}

export function Coupons() {
  const list = useApiData<{ coupons: Coupon[] }>('/api/admin/coupons')
  const [form, setForm] = useState(blank)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [turnOff, setTurnOff] = useState<Coupon | null>(null)
  const [show, setShow] = useState<'current' | 'all'>('current')
  const { showToast } = useUI()
  const set = <K extends keyof typeof blank>(k: K, v: (typeof blank)[K]) => setForm((f) => ({ ...f, [k]: v }))

  const percent = Number(form.percent)
  const preview = {
    percentOff: form.kind === 'percent' && Number.isInteger(percent) && percent > 0 ? percent : null,
    amountOffCents: form.kind === 'amount' ? form.amountCents : null,
  }
  const ready = form.code.trim().length >= 2 && (preview.percentOff || preview.amountOffCents)

  const create = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const startsLater = form.start && form.start > today()
      const res = await api<{ coupon: Coupon }>('/api/admin/coupons', {
        body: {
          code: form.code.trim(),
          kind: form.kind,
          percent_off: form.kind === 'percent' ? (form.percent.trim() === '' ? null : Number(form.percent)) : null,
          amount_off_cents: form.kind === 'amount' ? form.amountCents : null,
          starts_at: startsLater ? new Date(`${form.start}T00:00:00`).toISOString() : null,
          ends_at: form.end ? new Date(`${form.end}T23:59:59`).toISOString() : null,
          max_uses: form.maxUses.trim() === '' ? null : Number(form.maxUses),
          minimum_cents: form.minimumCents,
          first_order_only: form.firstOrderOnly,
          note: form.note,
        },
      })
      showToast(`Code ${res.coupon.code} is saved in Stripe.`)
      setForm(blank)
      list.reload()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const toggle = async (c: Coupon, on: boolean) => {
    setBusy(true)
    setError('')
    try {
      await api(`/api/admin/coupons/${c.id}/${on ? 'on' : 'off'}`, { method: 'POST' })
      showToast(on ? `${c.code} is on.` : `${c.code} is turned off. It no longer works at checkout.`)
      setTurnOff(null)
      list.reload()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const coupons = (list.data?.coupons ?? []).filter((c) => show === 'all' || c.status === 'active' || c.status === 'scheduled')

  return (
    <>
      <PageTitle title="Coupons" />
      <section className="panel">
        <h2 className="panel__title">Create a coupon code</h2>
        <Notice>Customers type the code on the payment page at checkout. Each code is saved in Stripe, so the discount and every rule below are checked by Stripe when someone pays.</Notice>
        <form className="form-stack" onSubmit={create}>
          <div className="form-grid">
            <TextInput label="Code" value={form.code} onChange={(v) => set('code', v.toUpperCase().replace(/\s+/g, ''))} maxLength={40} required hint="For example SPRING20. Letters, numbers, _ or -, no spaces." />
            <Select label="Discount" value={form.kind} onChange={(v) => set('kind', v)} options={[{ value: 'percent', label: 'Percent off' }, { value: 'amount', label: 'Dollar amount off' }]} />
            {form.kind === 'percent' ? (
              <TextInput label="Percent off" type="number" value={form.percent} onChange={(v) => set('percent', v)} hint="A whole number from 1 to 100." />
            ) : (
              <MoneyInput label="Amount off" cents={form.amountCents} onChange={(v) => set('amountCents', v)} hint="Taken off the order once." />
            )}
          </div>
          <div className="form-grid">
            <DateInput label="Start date (optional)" value={form.start} min={today()} onChange={(v) => set('start', v)} hint="Leave empty to start now." />
            <DateInput label="End date (optional)" value={form.end} min={form.start || today()} onChange={(v) => set('end', v)} hint="The code works through the end of this day." />
            <TextInput label="Maximum uses (optional)" type="number" value={form.maxUses} onChange={(v) => set('maxUses', v)} hint="Total times the code can be used by everyone." />
            <MoneyInput label="Minimum order (optional)" cents={form.minimumCents} onChange={(v) => set('minimumCents', v)} hint="Before shipping and tax." />
          </div>
          <Checkbox label="First order only" checked={form.firstOrderOnly} onChange={(v) => set('firstOrderOnly', v)} hint="Only customers who have never paid before can use it." />
          <TextInput label="Private note (optional)" value={form.note} onChange={(v) => set('note', v)} maxLength={200} hint="Only you see this, for example where you shared the code." />
          {ready && (
            <p className="muted">
              Customers enter <strong>{form.code.trim()}</strong> for <strong>{amountText(preview)}</strong>
              {form.minimumCents ? ` on orders of ${money(form.minimumCents)} or more` : ''}
              {form.firstOrderOnly ? ' on their first order' : ''}.
            </p>
          )}
          <FormError message={error} />
          <div className="button-row">
            <button type="submit" className="button" disabled={busy || !ready}>
              {busy ? 'Saving...' : 'Create code'}
            </button>
          </div>
        </form>
      </section>

      <section className="panel">
        <h2 className="panel__title">Your codes</h2>
        <Select label="Show" value={show} onChange={setShow} options={[{ value: 'current', label: 'Active and starting later' }, { value: 'all', label: 'All codes, including expired and turned off' }]} />
        {list.error ? (
          <Notice tone="warn">{list.error}</Notice>
        ) : list.loading && !list.data ? (
          <Loading />
        ) : !coupons.length ? (
          <Empty title="No codes here yet" />
        ) : (
          <div className="data-table-wrap">
            <table className="data-table">
              <thead><tr><th>Code</th><th>Discount</th><th>Rules</th><th>Used</th><th>Status</th><th></th></tr></thead>
              <tbody>
                {coupons.map((c) => (
                  <tr key={c.id}>
                    <td><strong>{c.code}</strong>{c.note && <div className="muted">{c.note}</div>}</td>
                    <td>{amountText(c)}</td>
                    <td>{rulesText(c)}</td>
                    <td>{c.maxUses ? `${c.timesUsed} of ${c.maxUses}` : c.timesUsed}</td>
                    <td><Pill value={statusPill[c.status].value} label={statusPill[c.status].label} /></td>
                    <td>
                      <div className="button-row">
                        {(c.status === 'active' || c.status === 'scheduled') && (
                          <button type="button" className="button button--outline button--small" disabled={busy} onClick={() => setTurnOff(c)}>Turn off</button>
                        )}
                        {c.status === 'off' && (
                          <button type="button" className="button button--outline button--small" disabled={busy} onClick={() => void toggle(c, true)}>Turn on</button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <Confirm open={Boolean(turnOff)} title={`Turn off ${turnOff?.code ?? ''}?`} confirmLabel="Turn off" danger busy={busy} onClose={() => setTurnOff(null)} onConfirm={() => turnOff && void toggle(turnOff, false)}>
        <p>The code stops working at checkout right away. Orders already paid keep their discount. Any banner showing this code stops showing it. You can turn it back on later.</p>
      </Confirm>
    </>
  )
}
