import { Send } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { api, errorMessage, newKey } from '../../lib/api'
import { href } from '../../lib/router'
import { useUI } from '../../lib/ui'
import { Confirm, dateTime, Empty, FormError, Loading, Notice, Pill, Select, TextArea, TextInput, useApiData } from '../../components/ui'
import { PageTitle } from './AdminApp'

const types = [
  { value: '', label: 'All types' },
  { value: 'order_confirmation', label: 'Order confirmation' },
  { value: 'digital_available', label: 'Digital purchase available' },
  { value: 'shipping_confirmation', label: 'Shipping confirmation' },
  { value: 'product_update', label: 'Product update' },
  { value: 'password_reset', label: 'Password reset' },
]
const statuses = ['', 'queued', 'sending', 'sent', 'delivered', 'delivery_delayed', 'bounced', 'complained', 'failed', 'suppressed', 'not_configured']
const typeName = (t: string) => types.find((x) => x.value === t)?.label ?? t

interface Row {
  id: string
  type: string
  to_email: string
  subject: string
  status: string
  requested_at: string
  delivered_at: string | null
  resend_id: string | null
  resent_from_id: string | null
  order_number: string | null
  related_order_id: string | null
  is_demo: boolean
}

export function Emails() {
  const [search, setSearch] = useState('')
  const [type, setType] = useState('')
  const [status, setStatus] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const p = new URLSearchParams()
  if (search) p.set('search', search)
  if (type) p.set('type', type)
  if (status) p.set('status', status)
  if (from) p.set('from', new Date(`${from}T00:00:00`).toISOString())
  if (to) p.set('to', new Date(new Date(`${to}T00:00:00`).getTime() + 86400000).toISOString())
  const { data, error, loading } = useApiData<{ emails: Row[] }>(`/api/admin/emails?${p}`)
  const settings = useApiData<{ integrations: { email: { configured: boolean; webhook: boolean } } }>('/api/admin/settings')
  return (
    <>
      <PageTitle title="Email center">
        <a className="button button--outline button--small" href={href('admin-email-templates')}>Edit templates</a>
      </PageTitle>
      {settings.data && !settings.data.integrations.email.configured && (
        <Notice tone="warn">Resend is not configured yet, so emails are recorded here with the status "not configured" and nothing is sent.</Notice>
      )}
      {settings.data?.integrations.email.configured && !settings.data.integrations.email.webhook && (
        <Notice tone="warn">Resend webhooks are not configured, so delivered, bounced and complained statuses will not update.</Notice>
      )}
      <div className="filters">
        <label className="field field--grow">
          <span className="field__label">Search</span>
          <input className="input" type="search" placeholder="Recipient, subject, order number or Resend ID" value={search} onChange={(e) => setSearch(e.target.value)} />
        </label>
        <Select label="Type" value={type} onChange={setType} options={types} />
        <Select label="Status" value={status} onChange={setStatus} options={statuses.map((s) => ({ value: s, label: s ? s.replace('_', ' ') : 'Any status' }))} />
        <label className="field">
          <span className="field__label">From</span>
          <input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="field">
          <span className="field__label">To</span>
          <input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
      </div>
      {error && <FormError message={error} />}
      {loading && !data ? (
        <Loading />
      ) : !data?.emails.length ? (
        <Empty title="No emails match" />
      ) : (
        <div className="data-table-wrap">
          <table className="data-table">
            <thead><tr><th>Email</th><th>Recipient</th><th>Type</th><th>Status</th><th>Requested</th></tr></thead>
            <tbody>
              {data.emails.map((e) => (
                <tr key={e.id}>
                  <td>
                    <a href={href(`admin-email-${e.id}`)}>{e.subject}</a>
                    {e.resent_from_id && <span className="demo-tag">Resend</span>}
                    {e.is_demo && <span className="demo-tag">Demo</span>}
                    {e.order_number && <div className="muted">Order {e.order_number}</div>}
                  </td>
                  <td>{e.to_email}</td>
                  <td>{typeName(e.type)}</td>
                  <td><Pill value={e.status} /></td>
                  <td>{dateTime(e.requested_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}

interface EmailDetailData {
  email: Record<string, any>
  events: Array<{ id: string; type: string; occurred_at: string | null; received_at: string; payload: unknown }>
  resends: Array<{ id: string; status: string; requested_at: string; resent_by: string }>
  suppressed: { reason: string; created_at: string } | null
}

export function EmailDetail({ id }: { id: string }) {
  const { data, error, loading, reload } = useApiData<EmailDetailData>(`/api/admin/emails/${id}`)
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState('')
  const key = useMemo(() => (confirm ? newKey() : ''), [confirm])
  const { showToast } = useUI()
  if (loading && !data) return <Loading />
  if (error) return <FormError message={error} />
  if (!data) return null
  const e = data.email
  const resend = async () => {
    setBusy(true)
    setActionError('')
    try {
      const r = await api<{ id: string; duplicate: boolean }>(`/api/admin/emails/${id}/resend`, { body: { idempotency_key: key } })
      setConfirm(false)
      showToast(r.duplicate ? 'That resend was already queued. No duplicate was sent.' : 'Resend queued as a new email.')
      reload()
    } catch (err) {
      setActionError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <PageTitle title={e.subject} back={{ label: 'Email center', route: 'admin-emails' }}>
        {e.type !== 'password_reset' && (
          <button type="button" className="button button--small" onClick={() => setConfirm(true)} disabled={Boolean(data.suppressed)}>
            <Send size={16} aria-hidden="true" /> Resend
          </button>
        )}
      </PageTitle>
      <FormError message={actionError} />
      {data.suppressed && (
        <Notice tone="warn">
          <span>This address is on the suppression list ({data.suppressed.reason}, {dateTime(data.suppressed.created_at)}). It cannot be emailed until removed.</span>
          <button
            type="button"
            className="chip"
            onClick={async () => {
              await api(`/api/admin/email-suppressions/${encodeURIComponent(e.to_email)}`, { method: 'DELETE' })
              showToast('Removed from the suppression list.')
              reload()
            }}
          >
            Remove from suppression list
          </button>
        </Notice>
      )}
      <div className="admin-cols">
        <div>
          <section className="panel">
            <h2 className="panel__title">Email as sent</h2>
            <p className="muted">This is the stored snapshot of the original email. Template edits do not change it.</p>
            <iframe className="email-frame" title="Rendered email" sandbox="" srcDoc={e.html} />
            <details>
              <summary>Plain text version</summary>
              <pre className="pre">{e.text_body || 'No plain text version.'}</pre>
            </details>
          </section>
        </div>
        <div>
          <section className="panel">
            <h2 className="panel__title">Details</h2>
            <dl className="kv">
              <dt>Status</dt><dd><Pill value={e.status} /></dd>
              <dt>Recipient</dt><dd>{e.to_email}</dd>
              <dt>Type</dt><dd>{typeName(e.type)}</dd>
              {e.related_user_id && (<><dt>Customer</dt><dd><a href={href(`admin-customer-${e.related_user_id}`)}>{e.customer_name ?? 'View customer'}</a></dd></>)}
              {e.related_order_id && (<><dt>Order</dt><dd><a href={href(`admin-order-${e.related_order_id}`)}>{e.order_number}</a></dd></>)}
              <dt>Requested</dt><dd>{dateTime(e.requested_at)}</dd>
              <dt>Sent</dt><dd>{dateTime(e.sent_at) || 'Not sent'}</dd>
              <dt>Delivered</dt><dd>{dateTime(e.delivered_at) || 'Not reported'}</dd>
              {e.bounced_at && (<><dt>Bounced</dt><dd>{dateTime(e.bounced_at)}</dd></>)}
              {e.complained_at && (<><dt>Complaint</dt><dd>{dateTime(e.complained_at)}</dd></>)}
              {e.failed_at && (<><dt>Failed</dt><dd>{dateTime(e.failed_at)}</dd></>)}
              <dt>Resend ID</dt><dd>{e.resend_id ?? 'None'}</dd>
              {e.resent_from_id && (<><dt>Resend of</dt><dd><a href={href(`admin-email-${e.resent_from_id}`)}>original email</a> by {e.resent_by}</dd></>)}
              {e.failure_reason && (<><dt>Details</dt><dd>{e.failure_reason}</dd></>)}
            </dl>
          </section>
          <section className="panel">
            <h2 className="panel__title">Delivery events</h2>
            {data.events.length ? (
              <ul className="timeline">
                {data.events.map((ev) => (
                  <li key={ev.id}><span className="muted">{dateTime(ev.occurred_at ?? ev.received_at)}</span> {ev.type}</li>
                ))}
              </ul>
            ) : (
              <p className="muted">No events received from Resend for this email.</p>
            )}
          </section>
          {data.resends.length > 0 && (
            <section className="panel">
              <h2 className="panel__title">Resends</h2>
              <ul className="timeline">
                {data.resends.map((r) => (
                  <li key={r.id}><a href={href(`admin-email-${r.id}`)}>{dateTime(r.requested_at)}</a> by {r.resent_by} <Pill value={r.status} /></li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>
      <Confirm open={confirm} title="Resend this email?" confirmLabel="Resend email" busy={busy} onClose={() => setConfirm(false)} onConfirm={resend}>
        <p>A new copy of the original email goes to <strong>{e.to_email}</strong>. It is logged as a new email linked to this one, with your name.</p>
        <p className="muted">Resending never changes download access. Links inside take the customer to their signed in account.</p>
      </Confirm>
    </>
  )
}

interface Template {
  type: string
  title: string
  placeholders: string[]
  subject: string
  heading: string
  body: string
  button_label: string
  customized: boolean
  updated_at: string | null
}

export function Templates() {
  const { data, error, loading, reload } = useApiData<{ templates: Template[] }>('/api/admin/email-templates')
  const [selected, setSelected] = useState('order_confirmation')
  const [draft, setDraft] = useState<Template | null>(null)
  const [preview, setPreview] = useState<{ subject: string; html: string } | null>(null)
  const [saveError, setSaveError] = useState('')
  const { showToast } = useUI()
  useEffect(() => {
    const t = data?.templates.find((x) => x.type === selected)
    if (t) setDraft({ ...t })
  }, [data, selected])
  useEffect(() => {
    if (!draft) return
    const h = window.setTimeout(async () => {
      try {
        setPreview(await api(`/api/admin/email-templates/${draft.type}/preview`, { body: draft }))
      } catch {
        /* preview only */
      }
    }, 300)
    return () => window.clearTimeout(h)
  }, [draft])
  if (loading && !data) return <Loading />
  if (error) return <FormError message={error} />
  return (
    <>
      <PageTitle title="Email templates" back={{ label: 'Email center', route: 'admin-emails' }} />
      <Notice>Edit the words of each email. The branded layout, the order details and the safe account links are added automatically. HTML is not allowed. Use the placeholders listed to insert details.</Notice>
      <div className="chip-row">
        {data?.templates.map((t) => (
          <button key={t.type} type="button" className="chip" aria-pressed={selected === t.type} onClick={() => setSelected(t.type)}>
            {t.title}
          </button>
        ))}
      </div>
      {draft && (
        <div className="admin-cols">
          <div className="panel form-stack">
            <p className="muted">Placeholders: {draft.placeholders.map((p) => `{{${p}}}`).join(', ')}</p>
            <TextInput label="Subject" value={draft.subject} onChange={(v) => setDraft({ ...draft, subject: v })} maxLength={160} />
            <TextInput label="Heading" value={draft.heading} onChange={(v) => setDraft({ ...draft, heading: v })} maxLength={160} />
            <TextArea label="Message" value={draft.body} onChange={(v) => setDraft({ ...draft, body: v })} rows={8} maxLength={4000} hint="Leave a blank line between paragraphs." />
            <TextInput label="Button label" value={draft.button_label} onChange={(v) => setDraft({ ...draft, button_label: v })} maxLength={60} />
            <FormError message={saveError} />
            <button
              type="button"
              className="button button--small"
              onClick={async () => {
                setSaveError('')
                try {
                  await api(`/api/admin/email-templates/${draft.type}`, { method: 'PUT', body: draft })
                  showToast('Template saved. New emails use it; sent emails keep their original contents.')
                  reload()
                } catch (err) {
                  setSaveError(errorMessage(err))
                }
              }}
            >
              Save template
            </button>
          </div>
          <div className="panel">
            <h2 className="panel__title">Preview</h2>
            {preview && (
              <>
                <p><strong>Subject:</strong> {preview.subject}</p>
                <iframe className="email-frame" title="Template preview" sandbox="" srcDoc={preview.html} />
              </>
            )}
          </div>
        </div>
      )}
    </>
  )
}
