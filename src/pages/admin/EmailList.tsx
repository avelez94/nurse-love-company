import { useState } from 'react'
import { Dialog } from '../../components/Dialog'
import { dateTime, Empty, FormError, Loading, Notice, Pill, TextInput, useApiData } from '../../components/ui'
import { api, errorMessage } from '../../lib/api'
import { href } from '../../lib/router'
import { useUI } from '../../lib/ui'
import { PageTitle } from './AdminApp'

/*
  Marketing > Email list. Who joined, with what wording and when, and
  whether each change has reached the mailing list provider. Joining is
  separate from order emails, which are always sent.
*/

interface Contact {
  email: string
  user_id: string | null
  customer_name: string | null
  status: 'subscribed' | 'unsubscribed'
  wording_version: string
  source: string
  subscribed_at: string | null
  unsubscribed_at: string | null
  sync_status: string
  sync_error: string
  synced_at: string | null
}
interface Overview {
  counts: { subscribed: number; unsubscribed: number; waiting: number; failed: number; synced: number }
  contacts: Contact[]
  provider: { connected: boolean; name: string | null }
  wording: Record<string, string>
}

const sourceLabel: Record<string, string> = {
  freebie_checkout: 'Freebie checkout',
  checkout: 'Checkout',
  account_settings: 'Account settings',
}
const syncLabel: Record<string, string> = {
  synced: 'On the list',
  pending: 'Waiting to send',
  not_configured: 'Waiting: no list connected',
  failed: 'Failed',
  skipped: 'Sent as unsubscribed (bounced)',
}

export function EmailList() {
  const [search, setSearch] = useState('')
  const data = useApiData<Overview>(`/api/admin/email-list${search ? `?search=${encodeURIComponent(search)}` : ''}`)
  const [history, setHistory] = useState<string | null>(null)
  const events = useApiData<{ events: Array<{ id: number; action: string; source: string; wording_version: string; wording: string; order_id: string | null; created_at: string }> }>(
    history ? `/api/admin/email-list/history?email=${encodeURIComponent(history)}` : null,
  )
  const { showToast } = useUI()
  const [error, setError] = useState('')
  const d = data.data

  return (
    <>
      <PageTitle title="Email list" />
      {d && !d.provider.connected && (
        <Notice tone="warn">
          <strong>No mailing list is connected yet.</strong> Resend is set up to send order and account emails, which is not the same as a mailing list. Every signup and unsubscribe is stored here
          with its wording and time, and will be sent to the list once one is connected ({d.counts.waiting} waiting). Nothing is lost in the meantime.
        </Notice>
      )}
      {d?.provider.connected && <Notice>Connected to {d.provider.name}. Changes are sent within the hour, or now with "Send changes now".</Notice>}

      <details className="panel">
        <summary>
          <strong>Before relying on the freebie signup offer: for you to review</strong>
        </summary>
        <ul className="plain-list">
          <li>A checkbox records consent here, but it does not make the offer compliant everywhere by itself. Rules differ by country and state; please check with a qualified adviser.</li>
          <li>Some places (for example the EU and UK) may not treat consent as freely given when it is a condition for receiving something. Decide whether to offer freebies there on these terms.</li>
          <li>Marketing emails need your physical mailing address and a working unsubscribe link (US CAN-SPAM). Your mailing list provider usually adds these; check before sending.</li>
          <li>Mention the email list and how you use addresses in your privacy policy (Settings, Policies) before publishing freebies.</li>
          <li>Decide whether your provider should send a confirmation email first (double opt in) and what happens to people who unsubscribe there; unsubscribes made in the provider are not copied back here yet.</li>
          <li>The wording customers agree to is shown below. Changing it is a code change that creates a new version, so earlier records keep their exact words.</li>
        </ul>
      </details>

      {d && (
        <dl className="mk-stats">
          <div><dt>Subscribed</dt><dd>{d.counts.subscribed}</dd></div>
          <div><dt>Unsubscribed</dt><dd>{d.counts.unsubscribed}</dd></div>
          <div><dt>Waiting to send to the list</dt><dd>{d.counts.waiting}</dd></div>
          <div><dt>Failed to send</dt><dd>{d.counts.failed}</dd></div>
        </dl>
      )}

      <div className="filters">
        <TextInput label="Search by email" value={search} onChange={setSearch} />
        <button
          type="button"
          className="button button--outline button--small"
          disabled={!d?.provider.connected}
          onClick={async () => {
            setError('')
            try {
              const r = await api<{ synced: number }>('/api/admin/email-list/sync', { body: {} })
              showToast(`Sent ${r.synced} changes to the list.`)
              await data.reload()
            } catch (err) {
              setError(errorMessage(err))
            }
          }}
        >
          Send changes now
        </button>
      </div>
      <FormError message={error || data.error} />
      {data.loading && !d ? (
        <Loading />
      ) : !d?.contacts.length ? (
        <Empty title="No one has joined yet" />
      ) : (
        <div className="data-table-wrap">
          <table className="data-table">
            <thead><tr><th>Email</th><th>Status</th><th>How</th><th>Mailing list copy</th><th></th></tr></thead>
            <tbody>
              {d.contacts.map((c) => (
                <tr key={c.email}>
                  <td>
                    {c.email}
                    {c.user_id && <div><a href={href(`admin-customer-${c.user_id}`)}>{c.customer_name || 'Customer'}</a></div>}
                  </td>
                  <td>
                    <Pill value={c.status === 'subscribed' ? 'active' : 'inactive'} label={c.status === 'subscribed' ? 'Subscribed' : 'Unsubscribed'} />
                    <div className="muted">{dateTime(c.status === 'subscribed' ? c.subscribed_at : c.unsubscribed_at)}</div>
                  </td>
                  <td>{sourceLabel[c.source] ?? c.source}{c.wording_version && <div className="muted">Wording {c.wording_version}</div>}</td>
                  <td>
                    {syncLabel[c.sync_status] ?? c.sync_status}
                    {c.sync_error && c.sync_status === 'failed' && <div className="muted">{c.sync_error}</div>}
                  </td>
                  <td>
                    <button type="button" className="button button--outline button--small" onClick={() => setHistory(c.email)}>History</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {d && (
        <section className="panel">
          <h2 className="panel__title">Wording customers agree to</h2>
          <dl className="kv">
            {Object.entries(d.wording).map(([v, text]) => (
              <div key={v} style={{ display: 'contents' }}>
                <dt>{v}</dt>
                <dd>{text}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      <Dialog open={Boolean(history)} onClose={() => setHistory(null)} title={`History: ${history ?? ''}`} variant="wide">
        {events.loading ? (
          <Loading />
        ) : (
          <ul className="plain-list">
            {(events.data?.events ?? []).map((e) => (
              <li key={e.id}>
                <strong>{e.action === 'subscribe' ? 'Joined' : 'Unsubscribed'}</strong> {dateTime(e.created_at)} via {sourceLabel[e.source] ?? e.source}
                {e.order_id && (
                  <>
                    {' '}(<a href={href(`admin-order-${e.order_id}`)}>order</a>)
                  </>
                )}
                {e.wording && <div className="muted">Agreed to ({e.wording_version}): “{e.wording}”</div>}
              </li>
            ))}
          </ul>
        )}
      </Dialog>
    </>
  )
}
