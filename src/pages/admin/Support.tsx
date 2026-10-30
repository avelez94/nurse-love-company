import { useState } from 'react'
import { api, errorMessage } from '../../lib/api'
import { href } from '../../lib/router'
import { useUI } from '../../lib/ui'
import { Confirm, dateTime, Empty, FormError, Loading, Notice, Pill, Select, TextArea, useApiData } from '../../components/ui'
import { PageTitle } from './AdminApp'

interface Report {
  id: string
  message: string
  status: string
  resolution_note: string
  created_at: string
  resolved_by: string | null
  name: string
  email: string
  user_id: string
  order_item_id: string
  title: string
  order_number: string
  order_id: string
  entitlement_status: string
}

interface SupportRequest {
  id: string
  subject: string
  message: string
  status: string
  created_at: string
  name: string
  email: string
  user_id: string
  order_number: string | null
  order_id: string | null
}

export function SupportPage() {
  const [status, setStatus] = useState('open')
  const reports = useApiData<{ reports: Report[] }>(`/api/admin/download-reports?status=${status}`)
  const support = useApiData<{ requests: SupportRequest[] }>(`/api/admin/support?status=${status === 'open' ? 'open' : 'all'}`)
  const [grant, setGrant] = useState<Report | null>(null)
  const [decline, setDecline] = useState<Report | null>(null)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const { showToast } = useUI()

  const run = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true)
    setError('')
    try {
      await fn()
      showToast(done)
      setGrant(null)
      setDecline(null)
      setText('')
      reports.reload()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <PageTitle title="Support" />
      <Select label="Show" value={status} onChange={setStatus} options={[{ value: 'open', label: 'Open items' }, { value: 'all', label: 'Everything' }]} />
      <section className="panel">
        <h2 className="panel__title">Download problem reports</h2>
        <Notice>The normal policy is one download per purchase. Grant a replacement only for a genuine delivery problem. Every replacement needs a reason and is recorded in the audit log.</Notice>
        {reports.loading && !reports.data ? (
          <Loading />
        ) : !reports.data?.reports.length ? (
          <Empty title="No download reports" />
        ) : (
          <div className="data-table-wrap">
            <table className="data-table">
              <thead><tr><th>Customer</th><th>Product</th><th>Report</th><th>Status</th><th></th></tr></thead>
              <tbody>
                {reports.data.reports.map((r) => (
                  <tr key={r.id}>
                    <td><a href={href(`admin-customer-${r.user_id}`)}>{r.name}</a><br /><span className="muted">{r.email}</span></td>
                    <td>{r.title}<br /><a href={href(`admin-order-${r.order_id}`)}>{r.order_number}</a></td>
                    <td>{r.message}<div className="muted">{dateTime(r.created_at)}</div>{r.resolution_note && <div className="muted">{r.resolution_note}</div>}</td>
                    <td><Pill value={r.status} /></td>
                    <td>
                      {r.status === 'open' && (
                        <div className="button-row">
                          <button type="button" className="chip" onClick={() => setGrant(r)}>Grant replacement</button>
                          <button type="button" className="chip" onClick={() => setDecline(r)}>Close without replacement</button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <section className="panel">
        <h2 className="panel__title">Messages from customers</h2>
        {support.loading && !support.data ? (
          <Loading />
        ) : !support.data?.requests.length ? (
          <Empty title="No messages" />
        ) : (
          <ul className="timeline">
            {support.data.requests.map((s) => (
              <li key={s.id} className="panel">
                <div className="status-line">
                  <Pill value={s.status} />
                  <strong>{s.subject}</strong>
                  <span className="muted">{dateTime(s.created_at)}</span>
                </div>
                <p>{s.message}</p>
                <p className="muted">
                  From <a href={href(`admin-customer-${s.user_id}`)}>{s.name}</a> ({s.email}){s.order_id && <> about order <a href={href(`admin-order-${s.order_id}`)}>{s.order_number}</a></>}
                </p>
                {s.status === 'open' && (
                  <button
                    type="button"
                    className="chip"
                    onClick={async () => {
                      await api(`/api/admin/support/${s.id}/close`, { method: 'POST' })
                      support.reload()
                    }}
                  >
                    Mark as handled
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        <p className="muted">Reply to customers from your own email for now. Two way support email will need its own setup.</p>
      </section>
      <Confirm open={Boolean(grant)} title="Grant a replacement download" confirmLabel="Grant one replacement download" busy={busy} disabled={text.trim().length < 5} onClose={() => { setGrant(null); setText('') }} onConfirm={() => run(() => api(`/api/admin/order-items/${grant!.order_item_id}/replacement-download`, { body: { reason: text, report_id: grant!.id } }), 'Replacement granted and recorded.')}>
        <p>For <strong>{grant?.title}</strong> ({grant?.name}). The customer receives one download of the latest version.</p>
        <TextArea label="Reason (required)" value={text} onChange={setText} rows={3} maxLength={500} />
        <FormError message={error} />
      </Confirm>
      <Confirm open={Boolean(decline)} title="Close this report" confirmLabel="Close report" busy={busy} disabled={text.trim().length < 3} onClose={() => { setDecline(null); setText('') }} onConfirm={() => run(() => api(`/api/admin/download-reports/${decline!.id}/decline`, { body: { note: text } }), 'Report closed.')}>
        <TextArea label="Note (saved with the report)" value={text} onChange={setText} rows={3} maxLength={500} />
        <FormError message={error} />
      </Confirm>
    </>
  )
}
