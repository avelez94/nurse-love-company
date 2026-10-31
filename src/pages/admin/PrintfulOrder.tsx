import { useState } from 'react'
import { Dialog } from '../../components/Dialog'
import { dateTime, FormError, Notice, Pill, TextArea } from '../../components/ui'
import { api, errorMessage } from '../../lib/api'
import { useUI } from '../../lib/ui'

/*
  Order > Printful. The Printful side of a physical order: its real status in
  Printful, costs, and any problem, with safe controls. "Check with Printful"
  only reads. "Check and continue" reconciles by the order's external id
  before sending anything, so it can never create a second Printful order.
  Canceling at Printful never refunds the customer, and refunding never
  cancels at Printful.
*/

export interface PrintfulJob {
  state: string
  printful_order_id: string | null
  printful_status: string
  auto_confirm: boolean
  test_mode: boolean
  attempts: number
  last_error: string
  attention_reason: string
  costs: Record<string, unknown> | null
  submitted_at: string | null
  confirmed_at: string | null
  last_synced_at: string | null
}

const STATE: Record<string, { label: string; tone: string }> = {
  queued: { label: 'Waiting to send to Printful', tone: 'pending' },
  submitting: { label: 'Sending to Printful', tone: 'pending' },
  uncertain: { label: 'Checking with Printful (no clear answer yet)', tone: 'pending' },
  confirming: { label: 'Confirming for production', tone: 'pending' },
  draft: { label: 'Draft in Printful: waiting for your confirmation', tone: 'pending' },
  submitted: { label: 'Confirmed with Printful', tone: 'active' },
  needs_attention: { label: 'Needs attention', tone: 'failed' },
  canceled: { label: 'Canceled at Printful', tone: 'inactive' },
  fulfilled: { label: 'Shipped by Printful', tone: 'active' },
}

export function PrintfulOrderPanel({ orderId, job, onChange }: { orderId: string; job: PrintfulJob; onChange: () => void }) {
  const { showToast } = useUI()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [canceling, setCanceling] = useState(false)
  const [reason, setReason] = useState('')

  const run = async (action: 'sync' | 'retry' | 'confirm' | 'cancel', done: string, body: unknown = {}) => {
    setBusy(true)
    setError('')
    try {
      await api(`/api/admin/orders/${orderId}/printful/${action}`, { body })
      showToast(done)
      onChange()
      return true
    } catch (err) {
      setError(errorMessage(err))
      return false
    } finally {
      setBusy(false)
    }
  }
  const s = STATE[job.state] ?? { label: job.state, tone: 'pending' }
  const canConfirm = Boolean(job.printful_order_id) && ['draft', 'failed'].includes(job.printful_status)
  const canCancel = !job.printful_order_id ? !['canceled', 'fulfilled', 'submitted'].includes(job.state) : ['draft', 'pending', 'failed'].includes(job.printful_status)
  const canRetry = ['queued', 'uncertain', 'needs_attention', 'confirming'].includes(job.state) && !(job.printful_order_id && ['draft', 'failed'].includes(job.printful_status))
  const total = job.costs && typeof job.costs.total !== 'undefined' ? `${String(job.costs.total)} ${String(job.costs.currency ?? '')}` : null

  return (
    <section className="panel form-stack">
      <h2 className="panel__title">Printful</h2>
      <div className="status-line">
        <Pill value={s.tone} label={s.label} />
        {job.printful_order_id && (
          <span className="muted">
            Printful order #{job.printful_order_id}
            {job.printful_status ? `, status "${job.printful_status}"` : ''}
          </span>
        )}
      </div>
      {job.attention_reason && <Notice tone={job.state === 'canceled' ? undefined : 'warn'}>{job.attention_reason}</Notice>}
      {job.last_error && job.state !== 'submitted' && <p className="muted">Last answer from Printful: {job.last_error}</p>}
      <dl className="kv">
        {total && (
          <>
            <dt>Printful charges you</dt>
            <dd>{total} (production and shipping, charged to your Printful billing method on confirmation)</dd>
          </>
        )}
        <dt>Production</dt>
        <dd>{job.confirmed_at ? `Confirmed ${dateTime(job.confirmed_at)}` : job.auto_confirm ? 'Confirmed automatically once Printful accepts it' : 'Waits for your confirmation'}</dd>
        <dt>Last checked</dt>
        <dd>{job.last_synced_at ? dateTime(job.last_synced_at) : 'Not yet'}</dd>
      </dl>
      <p className="muted">Shipments and tracking appear below automatically when Printful ships. Printful packs and ships this order; nothing is shipped by hand.</p>
      <div className="button-row">
        <button type="button" className="button button--outline button--small" disabled={busy || !job.printful_order_id} onClick={() => run('sync', 'Read the latest from Printful.')}>
          Check with Printful
        </button>
        {canRetry && (
          <button type="button" className="button button--outline button--small" disabled={busy} onClick={() => run('retry', 'Checked with Printful.')}>
            Check and continue sending
          </button>
        )}
        {canConfirm && (
          <button type="button" className="button button--small" disabled={busy} onClick={() => setConfirming(true)}>
            Confirm for production
          </button>
        )}
        {canCancel && (
          <button type="button" className="button button--outline button--small" disabled={busy} onClick={() => setCanceling(true)}>
            Cancel at Printful
          </button>
        )}
      </div>
      <FormError message={error} />

      <Dialog open={confirming} onClose={() => setConfirming(false)} title="Confirm for production?">
        {job.test_mode && (
          <Notice tone="warn">
            This order was paid with a Stripe test card (or is a demo order): no real money came from the customer. Confirming creates a real Printful order that Printful makes, ships and
            charges you for.
          </Notice>
        )}
        <p>Printful will start making this order and charge your Printful billing method{total ? ` (about ${total})` : ''}. Make sure billing in Printful is working.</p>
        <div className="button-row">
          <button type="button" className="button button--small" disabled={busy} onClick={async () => (await run('confirm', 'Sent to Printful for production.')) && setConfirming(false)}>
            Confirm for production
          </button>
          <button type="button" className="button button--outline button--small" onClick={() => setConfirming(false)}>
            Not now
          </button>
        </div>
      </Dialog>
      <Dialog open={canceling} onClose={() => setCanceling(false)} title="Cancel at Printful?">
        <p>Printful can cancel only before production starts. This does not refund the customer; refund them separately with Refund if needed.</p>
        <TextArea label="Reason" value={reason} onChange={setReason} rows={2} maxLength={300} />
        <div className="button-row">
          <button
            type="button"
            className="button button--small"
            disabled={busy || reason.trim().length < 3}
            onClick={async () => {
              if (await run('cancel', 'Canceled at Printful. The customer has not been refunded.', { reason })) {
                setCanceling(false)
                setReason('')
              }
            }}
          >
            Cancel at Printful
          </button>
          <button type="button" className="button button--outline button--small" onClick={() => setCanceling(false)}>
            Keep the order
          </button>
        </div>
      </Dialog>
    </section>
  )
}
