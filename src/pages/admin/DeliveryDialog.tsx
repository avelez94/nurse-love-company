import { useEffect, useState } from 'react'
import { Dialog } from '../../components/Dialog'
import { FormError, Notice, TextInput } from '../../components/ui'
import { api, errorMessage } from '../../lib/api'
import { useUI } from '../../lib/ui'

/** datetime-local value for a moment in a given timezone (or the browser's). */
export function toZoneInput(d: Date, timeZone?: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: timeZone || undefined, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(d)
      .map((p) => [p.type, p.value]),
  )
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`
}

/** The moment a datetime-local value means in a given timezone (or the browser's). */
export function fromZoneInput(v: string, timeZone?: string) {
  if (!v) return null
  if (!timeZone) return new Date(v)
  const asUtc = new Date(`${v}:00Z`)
  // The zone's offset at that moment, applied twice to settle daylight saving edges.
  let guess = asUtc
  for (let i = 0; i < 2; i++) {
    const shown = new Date(`${toZoneInput(guess, timeZone)}:00Z`)
    guess = new Date(guess.getTime() + (asUtc.getTime() - shown.getTime()))
  }
  return guess
}

/**
 * Records the confirmed delivery date of a shipment, for example from the
 * carrier's tracking page, when tracking cannot supply it. Needs a reason;
 * saved to the audit log. Physical review requests count from this date.
 */
export function DeliveryDialog({ shipment, timeZone, onClose, onDone }: { shipment: { id: string; label: string; delivered_at?: string | null } | null; timeZone?: string; onClose: () => void; onDone: () => void }) {
  const [when, setWhen] = useState('')
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const { showToast } = useUI()
  useEffect(() => {
    setWhen(shipment?.delivered_at ? toZoneInput(new Date(shipment.delivered_at), timeZone) : '')
    setReason('')
    setError('')
  }, [shipment, timeZone])
  const zone = timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone

  const submit = async () => {
    setBusy(true)
    setError('')
    try {
      const at = fromZoneInput(when, timeZone)
      if (!at) throw new Error('Please enter the confirmed delivery date and time.')
      await api(`/api/admin/shipments/${shipment!.id}/delivery`, { body: { delivered_at: at.toISOString(), reason } })
      showToast('Delivery recorded. Review requests for these items now count from this date.')
      onDone()
      onClose()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={Boolean(shipment)} onClose={onClose} title={shipment?.delivered_at ? 'Correct the confirmed delivery' : 'Record confirmed delivery'}>
      {shipment && (
        <form
          className="form-stack"
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
        >
          <p>{shipment.label}</p>
          <Notice>
            Only record a delivery that is confirmed, for example on the carrier's or Printful's tracking page. "Shipped" or an estimated date is not a delivery. Review requests for these items
            go out the set number of days after this date.
          </Notice>
          <label className="field">
            <span className="field__label">Delivered on</span>
            <input className="input" type="datetime-local" value={when} max={toZoneInput(new Date(), timeZone)} onChange={(e) => setWhen(e.target.value)} required />
            <span className="field__hint">Time zone: {zone}</span>
          </label>
          <TextInput label="Reason" value={reason} onChange={setReason} maxLength={300} required hint='For example "USPS tracking shows delivered".' />
          <FormError message={error} />
          <button type="submit" className="button button--small" disabled={busy || !when || reason.trim().length < 5}>
            {busy ? 'Saving...' : 'Save delivery'}
          </button>
          <p className="muted">Saved to the audit log with your name.</p>
        </form>
      )}
    </Dialog>
  )
}
