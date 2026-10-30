import { Eye, Send } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Confirm, Empty, FormError, Loading, Notice, Pill, Select, TextArea, TextInput, useApiData } from '../../components/ui'
import { api, errorMessage } from '../../lib/api'
import { href } from '../../lib/router'
import { useUI } from '../../lib/ui'
import { PageTitle } from './AdminApp'
import { DeliveryDialog } from './DeliveryDialog'

/*
  Marketing > Email Automations: download reminders and review requests.
  Each starts switched off. Edits to timing apply to future purchases; the
  owner reschedules existing pending emails only on purpose.
*/

type Kind = 'download_reminder' | 'digital_review' | 'physical_review'
interface TemplateText {
  subject: string
  heading: string
  body: string
  button_label: string
  customized?: boolean
}
interface Automation {
  kind: Kind
  label: string
  enabled: boolean
  delay_days: number
  startsFrom: string
  updated_at: string
  updated_by: string | null
  template: TemplateText
  templateType: string
  counts: Record<string, number>
  heldSwitchedOff: number
}
interface Overview {
  automations: Automation[]
  timezone: string
  email: { configured: boolean }
  scheduler: { configured: boolean }
  deliveryTracking: { configured: boolean }
}
interface JobRow {
  id: string
  kind: Kind
  display_status: string
  display_reason: string
  hold_reason: string
  start_at: string | null
  due_at: string | null
  sent_at: string | null
  created_at: string
  order_id: string
  order_number: string
  user_id: string | null
  customer_email: string | null
  customer_name: string | null
  product_id: string
  product_title: string
  shipment_id: string | null
  carrier: string | null
  tracking_number: string | null
  shipment_status: string | null
  delivered_at: string | null
  delivery_source: string | null
  email_id: string | null
}

const intro: Record<Kind, string> = {
  download_reminder:
    'One friendly reminder for digital items that have not been downloaded yet. Items already downloaded, revoked, refunded or disputed are skipped at send time. It links to My downloads and never uses, grants or resets a download.',
  digital_review: 'One honest review request per customer and product, whether or not they downloaded it. Products they already reviewed are skipped.',
  physical_review:
    'One honest review request per customer and product, counted from the confirmed delivery of the shipment holding the item. Shipped, fulfilled or estimated dates never count. Without a confirmed delivery the request waits here for you.',
}
const statusTone: Record<string, string> = { scheduled: 'pending', held: 'unpublished', sent: 'sent', skipped: 'inactive', failed: 'failed', canceled: 'canceled' }
const statusLabel: Record<string, string> = { scheduled: 'Scheduled', held: 'Held', sent: 'Sent', skipped: 'Skipped', failed: 'Failed', canceled: 'Canceled' }
const zones = ['', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Phoenix', 'America/Los_Angeles', 'America/Anchorage', 'Pacific/Honolulu']

export const formatIn = (d: string | null | undefined, timeZone?: string) => (d ? new Date(d).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short', timeZone: timeZone || undefined }) : '')

export function Automations() {
  const overview = useApiData<Overview>('/api/admin/automations')
  const [kind, setKind] = useState<'' | Kind>('')
  const [status, setStatus] = useState('')
  const query = new URLSearchParams({ ...(kind && { kind }), ...(status && { status }) }).toString()
  const jobs = useApiData<{ jobs: JobRow[] }>(`/api/admin/automations/jobs${query ? `?${query}` : ''}`)
  const { showToast } = useUI()
  const [delivery, setDelivery] = useState<{ id: string; label: string; delivered_at?: string | null } | null>(null)
  const [error, setError] = useState('')
  const d = overview.data
  const tz = d?.timezone || undefined
  const reload = async () => {
    await Promise.all([overview.reload(), jobs.reload()])
  }

  if (overview.error) return <FormError message={overview.error} />
  if (!d) return <Loading />

  const cancel = async (id: string) => {
    setError('')
    try {
      await api(`/api/admin/automations/jobs/${id}/cancel`, { body: {} })
      showToast('Canceled. This email will not be sent.')
      await reload()
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  return (
    <>
      <PageTitle title="Email Automations" />
      <Notice>
        Each automation starts switched off. Only purchases made while an automation is on are scheduled, so earlier customers are never emailed. Everything is checked again right before
        sending. Emails become due at their scheduled time and go out on the next hourly run.
      </Notice>
      {!d.email.configured && <Notice tone="warn">Resend is not connected yet. Due emails are recorded in the Email center with "awaiting configuration" and nothing is sent.</Notice>}
      {!d.scheduler.configured && <Notice tone="warn">The hourly job (CRON_SECRET) is not configured on this server, so due emails are not processed automatically yet.</Notice>}
      {!d.deliveryTracking.configured && (
        <Notice>Printful or carrier delivery tracking is not connected. For physical review requests, record each confirmed delivery date on the order page (or below) with a reason.</Notice>
      )}

      <section className="panel form-stack">
        <h2 className="panel__title">Store timezone</h2>
        <Select
          label="Show admin dates in"
          value={d.timezone}
          onChange={async (v) => {
            try {
              await api('/api/admin/automations/timezone', { method: 'PUT', body: { timezone: v } })
              showToast('Timezone saved.')
              await reload()
            } catch (err) {
              setError(errorMessage(err))
            }
          }}
          options={zones.map((z) => ({ value: z, label: z ? z.replace('_', ' ') : `Each admin's own (${Intl.DateTimeFormat().resolvedOptions().timeZone})` }))}
          hint="Dates are stored as exact moments; this only changes how they are shown."
        />
      </section>

      {d.automations.map((a) => (
        <AutomationPanel key={a.kind} a={a} timeZone={tz} onChanged={reload} />
      ))}

      <section className="panel">
        <div className="panel__head">
          <h2 className="panel__title">Scheduled and past emails</h2>
        </div>
        <div className="filters">
          <Select
            label="Automation"
            value={kind}
            onChange={setKind}
            options={[{ value: '' as const, label: 'All' }, ...d.automations.map((a) => ({ value: a.kind, label: a.label }))]}
          />
          <Select label="Status" value={status} onChange={setStatus} options={[{ value: '', label: 'All' }, ...Object.entries(statusLabel).map(([value, label]) => ({ value, label }))]} />
        </div>
        <FormError message={error || jobs.error} />
        {jobs.loading && !jobs.data ? (
          <Loading />
        ) : !jobs.data?.jobs.length ? (
          <Empty title="Nothing here yet" />
        ) : (
          <div className="data-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Email</th>
                  <th>Customer and order</th>
                  <th>Product</th>
                  <th>Counts from</th>
                  <th>Scheduled</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {jobs.data.jobs.map((j) => (
                  <tr key={j.id}>
                    <td>{d.automations.find((a) => a.kind === j.kind)?.label.replace(/s$/, '')}</td>
                    <td>
                      {j.user_id ? <a href={href(`admin-customer-${j.user_id}`)}>{j.customer_name || j.customer_email}</a> : 'Account removed'}
                      <div>
                        <a href={href(`admin-order-${j.order_id}`)}>{j.order_number}</a>
                      </div>
                    </td>
                    <td>
                      <a href={href(`admin-product-${j.product_id}`)}>{j.product_title}</a>
                      {j.kind === 'physical_review' && (
                        <div className="muted">
                          {j.shipment_id ? `${j.carrier || 'Shipment'} ${j.tracking_number || ''}`.trim() : 'No delivered shipment yet'}
                          {j.delivered_at ? `, delivered ${formatIn(j.delivered_at, tz)}${j.delivery_source ? ` (${j.delivery_source})` : ''}` : ''}
                        </div>
                      )}
                    </td>
                    <td className="muted">{j.start_at ? `${j.kind === 'physical_review' ? 'Delivery' : 'Payment'} ${formatIn(j.start_at, tz)}` : 'Waiting for delivery'}</td>
                    <td>
                      {j.due_at ? formatIn(j.due_at, tz) : 'Not yet'}
                      {j.sent_at && <div className="muted">Handed to email {formatIn(j.sent_at, tz)}</div>}
                    </td>
                    <td>
                      <Pill value={statusTone[j.display_status] ?? 'none'} label={statusLabel[j.display_status] ?? j.display_status} />
                      {j.display_reason && <div className="muted">{j.display_reason}</div>}
                      {j.email_id && (
                        <div>
                          <a href={href(`admin-email-${j.email_id}`)}>Email log</a>
                        </div>
                      )}
                    </td>
                    <td>
                      <div className="button-row">
                        {(j.display_status === 'scheduled' || j.display_status === 'held') && (
                          <button type="button" className="button button--outline button--small" onClick={() => cancel(j.id)}>
                            Cancel
                          </button>
                        )}
                        {j.kind === 'physical_review' && j.display_status === 'held' && j.hold_reason !== 'automation_off' && (
                          <a className="button button--outline button--small" href={href(`admin-order-${j.order_id}`)}>
                            Record delivery
                          </a>
                        )}
                        {j.kind === 'physical_review' && j.shipment_id && j.display_status === 'scheduled' && (
                          <button type="button" className="button button--outline button--small" onClick={() => setDelivery({ id: j.shipment_id!, label: `${j.order_number}: ${j.carrier ?? ''} ${j.tracking_number ?? ''}`, delivered_at: j.delivered_at })}>
                            Correct delivery
                          </button>
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
      <DeliveryDialog shipment={delivery} timeZone={tz} onClose={() => setDelivery(null)} onDone={reload} />
    </>
  )
}

function AutomationPanel({ a, timeZone, onChanged }: { a: Automation; timeZone?: string; onChanged: () => Promise<void> }) {
  const { showToast } = useUI()
  const [delay, setDelay] = useState(String(a.delay_days))
  const [t, setT] = useState<TemplateText>(a.template)
  const [preview, setPreview] = useState<{ subject: string; html: string } | null>(null)
  const [testTo, setTestTo] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [confirm, setConfirm] = useState<null | 'off' | 'reschedule' | 'cancel_held'>(null)
  useEffect(() => {
    setDelay(String(a.delay_days))
    setT(a.template)
  }, [a])

  const call = async (fn: () => Promise<unknown>, message: string) => {
    setBusy(true)
    setError('')
    try {
      await fn()
      showToast(message)
      await onChanged()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
      setConfirm(null)
    }
  }
  const toggle = (enabled: boolean) => call(() => api(`/api/admin/automations/${a.kind}`, { method: 'PUT', body: { enabled } }), enabled ? 'Switched on for new purchases.' : 'Switched off. Pending emails are held.')
  const delayChanged = Number(delay) !== a.delay_days
  const start = a.kind === 'physical_review' ? 'after confirmed delivery' : 'after confirmed payment'

  return (
    <section className="panel form-stack auto-panel" aria-labelledby={`auto-${a.kind}`}>
      <div className="panel__head">
        <h2 className="panel__title" id={`auto-${a.kind}`}>
          {a.label}
        </h2>
        <div className="button-row">
          <Pill value={a.enabled ? 'active' : 'inactive'} label={a.enabled ? 'On' : 'Off'} />
          {a.enabled ? (
            <button type="button" className="button button--outline button--small" disabled={busy} onClick={() => setConfirm('off')}>
              Switch off
            </button>
          ) : (
            <button type="button" className="button button--small" disabled={busy} onClick={() => toggle(true)}>
              Switch on
            </button>
          )}
        </div>
      </div>
      <p className="muted">{intro[a.kind]}</p>
      <dl className="mk-stats">
        {['scheduled', 'held', 'sent', 'skipped', 'failed', 'canceled'].map((s) => (
          <div key={s}>
            <dt>{statusLabel[s]}</dt>
            <dd>{a.counts[s] ?? 0}</dd>
          </div>
        ))}
      </dl>
      {a.heldSwitchedOff > 0 && (
        <Notice tone="warn">
          {a.heldSwitchedOff} {a.heldSwitchedOff === 1 ? 'email was' : 'emails were'} held while this was switched off. Nothing is sent until you choose.
          <div className="button-row">
            <button type="button" className="button button--small" disabled={busy || !a.enabled} onClick={() => call(() => api(`/api/admin/automations/${a.kind}/held`, { body: { action: 'resume' } }), 'Resumed. Overdue emails go out on the next run.')}>
              Resume held emails
            </button>
            <button type="button" className="button button--outline button--small" disabled={busy} onClick={() => setConfirm('cancel_held')}>
              Cancel held emails
            </button>
          </div>
          {!a.enabled && <p className="muted">Switch the automation on to resume them.</p>}
        </Notice>
      )}

      <div className="auto-delay">
        <TextInput label={`Send this many days ${start}`} type="number" value={delay} onChange={setDelay} hint="1 to 90 days. Changes apply to future purchases." />
        <div className="button-row">
          <button type="button" className="button button--outline button--small" disabled={busy || !delayChanged} onClick={() => call(() => api(`/api/admin/automations/${a.kind}`, { method: 'PUT', body: { delay_days: Number(delay) } }), 'Delay saved for future purchases.')}>
            Save delay
          </button>
          <button type="button" className="button button--outline button--small" disabled={busy || delayChanged} onClick={() => setConfirm('reschedule')}>
            Reschedule pending emails to {a.delay_days} days
          </button>
        </div>
      </div>

      <details className="auto-template">
        <summary>Edit the email{a.template.customized ? ' (customized)' : ''}</summary>
        <div className="form-stack">
          <p className="muted">
            Plain text. You can use {'{{name}}'} (the customer's first name) and {'{{order_number}}'}. Product names, pictures{a.kind === 'download_reminder' ? '' : ' and a Leave a review button for each product'}, the{' '}
            {a.kind === 'download_reminder' ? 'one download note' : 'honest review note'} and the email preference link are added automatically.
          </p>
          <TextInput label="Subject" value={t.subject} onChange={(v) => setT({ ...t, subject: v })} maxLength={160} />
          <TextInput label="Heading" value={t.heading} onChange={(v) => setT({ ...t, heading: v })} maxLength={160} />
          <TextArea label="Message" value={t.body} onChange={(v) => setT({ ...t, body: v })} rows={6} maxLength={4000} hint="Leave a blank line between paragraphs." />
          <TextInput label={a.kind === 'download_reminder' ? 'Button label' : 'Button label (one per product)'} value={t.button_label} onChange={(v) => setT({ ...t, button_label: v })} maxLength={60} />
          <FormError message={error} />
          <div className="button-row">
            <button type="button" className="button button--small" disabled={busy} onClick={() => call(() => api(`/api/admin/email-templates/${a.templateType}`, { method: 'PUT', body: t }), 'Email saved.')}>
              Save email
            </button>
            <button
              type="button"
              className="button button--outline button--small"
              disabled={busy}
              onClick={async () => {
                setError('')
                try {
                  setPreview(await api(`/api/admin/automations/${a.kind}/preview`, { body: { template: t } }))
                } catch (err) {
                  setError(errorMessage(err))
                }
              }}
            >
              <Eye size={16} aria-hidden="true" /> Preview
            </button>
          </div>
          {preview && (
            <div className="auto-preview">
              <p>
                <strong>Subject:</strong> {preview.subject}
              </p>
              <iframe title={`Preview of the ${a.label.toLowerCase()} email`} sandbox="" srcDoc={preview.html} className="auto-preview__frame" />
              <p className="muted">Preview with sample details. Links in the preview are not active.</p>
            </div>
          )}
          <div className="auto-test">
            <TextInput label="Send a test to" type="email" value={testTo} onChange={setTestTo} placeholder="you@example.com" hint="Uses the saved email and sample details. Customers, schedules, reviews and downloads are not affected." />
            <button
              type="button"
              className="button button--outline button--small"
              disabled={busy || !testTo}
              onClick={() => call(() => api(`/api/admin/automations/${a.kind}/test`, { body: { to: testTo } }), 'Test email queued. See the Email center for its status.')}
            >
              <Send size={16} aria-hidden="true" /> Send test
            </button>
          </div>
        </div>
      </details>
      {a.updated_by && <p className="muted">Last changed by {a.updated_by}, {formatIn(a.updated_at, timeZone)}.</p>}

      <Confirm open={confirm === 'off'} title={`Switch off ${a.label.toLowerCase()}?`} confirmLabel="Switch off" onConfirm={() => toggle(false)} onClose={() => setConfirm(null)} busy={busy}>
        <p>Pending emails are held and not sent. When you switch back on, you choose whether to resume or cancel them; nothing is sent as a surprise backlog.</p>
      </Confirm>
      <Confirm
        open={confirm === 'reschedule'}
        title="Reschedule pending emails?"
        confirmLabel="Reschedule"
        onConfirm={() => call(() => api(`/api/admin/automations/${a.kind}/reschedule`, { body: {} }), 'Pending emails rescheduled.')}
        onClose={() => setConfirm(null)}
        busy={busy}
      >
        <p>
          Every scheduled or held email of this kind will be due {a.delay_days} days {start}. Any that become overdue go out on the next run.
        </p>
      </Confirm>
      <Confirm open={confirm === 'cancel_held'} title="Cancel the held emails?" confirmLabel="Cancel them" onConfirm={() => call(() => api(`/api/admin/automations/${a.kind}/held`, { body: { action: 'cancel' } }), 'Held emails canceled.')} onClose={() => setConfirm(null)} busy={busy}>
        <p>They will never be sent. This cannot be undone.</p>
      </Confirm>
    </section>
  )
}
