import { useEffect, useState } from 'react'
import { api, errorMessage } from '../lib/api'
import { href } from '../lib/router'
import { PageHeader } from './PageHeader'

/*
  Opened from the link at the bottom of a download reminder or review
  request. Opening the page changes nothing; the customer presses a button.
  It only affects that one kind of email: receipts and account security
  emails are always sent.
*/
interface Status {
  preference: string
  label: string
  email: string
  subscribed: boolean
}

export function EmailPreferences({ token }: { token: string }) {
  const [status, setStatus] = useState<Status | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!token) {
      setError('This link is not complete. You can change email preferences in your account.')
      return
    }
    api<Status>(`/api/email-preferences?t=${encodeURIComponent(token)}`).then(setStatus, (err) => setError(errorMessage(err)))
  }, [token])

  const change = async (subscribed: boolean) => {
    setBusy(true)
    setError('')
    try {
      setStatus(await api<Status>('/api/email-preferences', { body: { t: token, subscribed } }))
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <PageHeader title="Email preferences" crumbs={[{ label: 'Home', route: 'home' }, { label: 'Email preferences' }]} />
      <section className="container story">
        <div className="story__card email-prefs" aria-live="polite">
          {error && <p className="form-error" role="alert">{error}</p>}
          {!status && !error && <p>Loading...</p>}
          {status && (
            <>
              <p>
                {status.subscribed ? 'You receive' : 'You no longer receive'} <strong>{status.label}</strong> at {status.email}.
              </p>
              {status.subscribed ? (
                <button type="button" className="button button--small" disabled={busy} onClick={() => change(false)}>
                  Stop {status.label}
                </button>
              ) : (
                <button type="button" className="button button--outline button--small" disabled={busy} onClick={() => change(true)}>
                  Turn {status.label} back on
                </button>
              )}
              <p className="muted">Receipts, download emails for new purchases and account security emails are always sent. You can manage all email preferences in your account.</p>
              <a className="arrow-link" href={href('account-settings')}>Account settings</a>
            </>
          )}
        </div>
      </section>
    </>
  )
}
