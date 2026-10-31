import { Truck } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { api, errorMessage } from '../lib/api'
import { formatPrice } from '../lib/format'
import { readJSON, writeJSON } from '../lib/storage'

/*
  The bag's shipping step for items that ship. Our print partner (Printful)
  quotes real options for these exact items and this address; the customer
  picks one and checkout charges exactly that. Digital items never add
  shipping. The address is remembered in this browser for convenience only.
*/

export interface ShippingChoice {
  quote_id: string
  option_id: string
  rate_cents: number
  name: string
}
interface Option {
  id: string
  name: string
  rate_cents: number
  min_days: number | null
  max_days: number | null
}
interface Address {
  name: string
  address1: string
  address2: string
  city: string
  state_code: string
  zip: string
  country_code: string
  phone: string
}

const US_STATES = 'AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY'.split(' ')
const KEY = 'nlc-ship-address'

export function ShippingStep({ items, countries, onChange }: { items: unknown[]; countries: string[]; onChange: (c: ShippingChoice | null) => void }) {
  const [a, setA] = useState<Address>(() => ({ name: '', address1: '', address2: '', city: '', state_code: '', zip: '', phone: '', ...readJSON<Partial<Address>>(KEY, {}), country_code: readJSON<Partial<Address>>(KEY, {}).country_code || countries[0] || 'US' }))
  const [options, setOptions] = useState<Option[] | null>(null)
  const [quoteId, setQuoteId] = useState('')
  const [chosen, setChosen] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const itemsKey = JSON.stringify(items)
  const names = useMemo(() => {
    try {
      return new Intl.DisplayNames(['en'], { type: 'region' })
    } catch {
      return null
    }
  }, [])

  // A changed bag or address needs a new quote.
  useEffect(() => {
    setOptions(null)
    setChosen('')
    onChange(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemsKey])
  const set = (k: keyof Address, v: string) => {
    setA((x) => ({ ...x, [k]: v }))
    if (options) {
      setOptions(null)
      setChosen('')
      onChange(null)
    }
  }

  const quote = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const r = await api<{ quoteId: string; options: Option[] }>('/api/checkout/shipping-quote', { body: { items, address: a } })
      writeJSON(KEY, { ...a, phone: '' })
      setQuoteId(r.quoteId)
      setOptions(r.options)
      const first = r.options[0]
      setChosen(first.id)
      onChange({ quote_id: r.quoteId, option_id: first.id, rate_cents: first.rate_cents, name: first.name })
    } catch (err) {
      setError(errorMessage(err))
      setOptions(null)
      onChange(null)
    } finally {
      setBusy(false)
    }
  }
  const pick = (o: Option) => {
    setChosen(o.id)
    onChange({ quote_id: quoteId, option_id: o.id, rate_cents: o.rate_cents, name: o.name })
  }
  const days = (o: Option) => (o.min_days && o.max_days ? (o.min_days === o.max_days ? `about ${o.min_days} business days` : `${o.min_days} to ${o.max_days} business days`) : '')

  return (
    <section className="ship-step" aria-labelledby="ship-step-title">
      <h2 id="ship-step-title" className="ship-step__title">
        <Truck aria-hidden="true" size={18} /> Shipping
      </h2>
      <p className="bag__note">Made to order by our print partner and shipped to you. Enter your address to see shipping options and prices.</p>
      <form className="ship-step__form" onSubmit={quote}>
        <label className="field">
          <span className="field__label">Full name</span>
          <input className="input" autoComplete="shipping name" value={a.name} onChange={(e) => set('name', e.target.value)} required maxLength={100} />
        </label>
        <label className="field">
          <span className="field__label">Street address</span>
          <input className="input" autoComplete="shipping address-line1" value={a.address1} onChange={(e) => set('address1', e.target.value)} required maxLength={200} />
        </label>
        <label className="field">
          <span className="field__label">Apartment, suite (optional)</span>
          <input className="input" autoComplete="shipping address-line2" value={a.address2} onChange={(e) => set('address2', e.target.value)} maxLength={200} />
        </label>
        <div className="ship-step__row">
          <label className="field">
            <span className="field__label">City</span>
            <input className="input" autoComplete="shipping address-level2" value={a.city} onChange={(e) => set('city', e.target.value)} required maxLength={100} />
          </label>
          <label className="field">
            <span className="field__label">{a.country_code === 'US' ? 'State' : 'State or province'}</span>
            {a.country_code === 'US' ? (
              <select className="input" autoComplete="shipping address-level1" value={a.state_code} onChange={(e) => set('state_code', e.target.value)} required>
                <option value="">Choose</option>
                {US_STATES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            ) : (
              <input className="input" autoComplete="shipping address-level1" value={a.state_code} onChange={(e) => set('state_code', e.target.value)} maxLength={10} />
            )}
          </label>
        </div>
        <div className="ship-step__row">
          <label className="field">
            <span className="field__label">{a.country_code === 'US' ? 'ZIP code' : 'Postal code'}</span>
            <input className="input" autoComplete="shipping postal-code" inputMode={a.country_code === 'US' ? 'numeric' : undefined} value={a.zip} onChange={(e) => set('zip', e.target.value)} required maxLength={20} />
          </label>
          <label className="field">
            <span className="field__label">Country</span>
            <select className="input" autoComplete="shipping country" value={a.country_code} onChange={(e) => set('country_code', e.target.value)}>
              {countries.map((c) => (
                <option key={c} value={c}>
                  {names?.of(c) ?? c}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="field">
          <span className="field__label">Phone (optional, for delivery questions)</span>
          <input className="input" type="tel" autoComplete="shipping tel" value={a.phone} onChange={(e) => set('phone', e.target.value)} maxLength={30} />
        </label>
        {!options && (
          <button type="submit" className="button button--outline button--small" disabled={busy}>
            {busy ? 'Getting shipping options...' : 'See shipping options'}
          </button>
        )}
      </form>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {options && (
        <fieldset className="ship-step__options">
          <legend className="field__label">Choose shipping</legend>
          {options.map((o) => (
            <label key={o.id} className={`ship-option ${chosen === o.id ? 'is-chosen' : ''}`}>
              <input type="radio" name="ship-option" checked={chosen === o.id} onChange={() => pick(o)} />
              <span className="ship-option__name">
                {o.name}
                {days(o) && <span className="ship-option__days">{days(o)}</span>}
              </span>
              <span className="ship-option__price">{o.rate_cents === 0 ? 'Free' : formatPrice(o.rate_cents)}</span>
            </label>
          ))}
          <p className="bag__note">Shipping prices are held for 30 minutes. Delivery times start once your order is made.</p>
        </fieldset>
      )}
    </section>
  )
}
