import { BadgeCheck, Flag } from 'lucide-react'
import { useState } from 'react'
import { Stars } from '../../components/Reviews'
import { Dialog } from '../../components/Dialog'
import { dateTime, Empty, FormError, Loading, Notice, Pill, Select, TextArea, TextInput, useApiData } from '../../components/ui'
import { api, errorMessage } from '../../lib/api'
import { href } from '../../lib/router'
import { useUI } from '../../lib/ui'
import { PageTitle } from './AdminApp'

/*
  Customers > Reviews. New and edited reviews wait here as pending. The
  owner publishes, rejects (with a reason), replies, and clears reports.
  Honest criticism should be published: rejecting is for spam, abuse,
  private information or reviews that are not about the product.
*/

interface AdminReview {
  id: string
  product_id: string
  product_title: string
  product_slug: string
  rating: number
  title: string
  body: string
  display_name: string
  status: 'pending' | 'published' | 'rejected'
  moderation_reason: string
  moderated_by: string | null
  moderated_at: string | null
  owner_reply: string
  owner_reply_at: string | null
  report_count: number
  report_reasons: string[]
  created_at: string
  updated_at: string
  verified: boolean
}

const reasonLabel: Record<string, string> = {
  spam: 'Spam or advertising',
  abuse: 'Abusive or hateful',
  private_information: 'Shares private or patient information',
  not_about_product: 'Not about this product',
  other: 'Other',
}
const statusLabel = { pending: 'Waiting for approval', published: 'Published', rejected: 'Rejected' }

export function ReviewsAdmin() {
  const [status, setStatus] = useState<'' | 'pending' | 'published' | 'rejected' | 'reported'>('pending')
  const [product, setProduct] = useState('')
  const [rating, setRating] = useState('')
  const query = new URLSearchParams({ ...(status && { status }), ...(product && { product }), ...(rating && { rating }) }).toString()
  const { data, error, loading, reload } = useApiData<{ reviews: AdminReview[]; counts: Record<string, number> }>(`/api/admin/reviews${query ? `?${query}` : ''}`)
  const products = useApiData<{ products: Array<{ id: string; title: string }> }>('/api/admin/products?status=all')
  const [open, setOpen] = useState<AdminReview | null>(null)
  const counts = data?.counts ?? {}

  return (
    <>
      <PageTitle title="Reviews" />
      <Notice>
        Only customers who bought a product (and were not fully refunded) can review it, once per product. New and edited reviews wait here until you publish them. Please publish honest
        criticism too; reject only spam, abuse, private or patient information, or reviews that are not about the product. Star averages use published reviews only.
      </Notice>
      <div className="filters">
        <Select
          label="Show"
          value={status}
          onChange={setStatus}
          options={[
            { value: 'pending', label: `Waiting for approval (${counts.pending ?? 0})` },
            { value: 'reported', label: `Reported (${counts.reported ?? 0})` },
            { value: 'published', label: `Published (${counts.published ?? 0})` },
            { value: 'rejected', label: `Rejected (${counts.rejected ?? 0})` },
            { value: '', label: 'All reviews' },
          ]}
        />
        <Select label="Product" value={product} onChange={setProduct} options={[{ value: '', label: 'All products' }, ...(products.data?.products ?? []).map((p) => ({ value: p.id, label: p.title }))]} />
        <Select label="Rating" value={rating} onChange={setRating} options={[{ value: '', label: 'Any rating' }, ...[5, 4, 3, 2, 1].map((n) => ({ value: String(n), label: `${n} ${n === 1 ? 'star' : 'stars'}` }))]} />
      </div>
      {error && <FormError message={error} />}
      {loading && !data ? (
        <Loading />
      ) : !data?.reviews.length ? (
        <Empty title="No reviews here" />
      ) : (
        <ul className="rv-list">
          {data.reviews.map((r) => (
            <li key={r.id} className="rv-item">
              <div className="rv-item__head">
                <Stars rating={r.rating} size={16} />
                <strong>{r.title}</strong>
                <Pill value={r.status} label={statusLabel[r.status]} />
                {r.report_count > 0 && (
                  <span className="pill pill--bad">
                    <Flag size={12} aria-hidden="true" /> Reported {r.report_count}×
                  </span>
                )}
              </div>
              <p className="muted">
                {r.product_title} · by “{r.display_name}” · {dateTime(r.updated_at)}
                {r.verified ? ' · Verified purchase' : ' · Purchase refunded, not verified'}
              </p>
              <p className="rv-item__body">{r.body.length > 220 ? `${r.body.slice(0, 220)}...` : r.body}</p>
              <button type="button" className="button button--outline button--small" onClick={() => setOpen(r)}>
                Review and respond
              </button>
            </li>
          ))}
        </ul>
      )}
      <ReviewModeration review={open} onClose={() => setOpen(null)} onChanged={async () => { await reload(); setOpen(null) }} />
    </>
  )
}

function ReviewModeration({ review, onClose, onChanged }: { review: AdminReview | null; onClose: () => void; onChanged: () => void }) {
  const { showToast } = useUI()
  const [reason, setReason] = useState('')
  const [note, setNote] = useState('')
  const [reply, setReply] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const history = useApiData<{ entries: Array<{ id: number; actor_email: string; summary: string; created_at: string }> }>(review ? `/api/admin/audit?entity=review&entity_id=${review.id}` : null)
  const [lastId, setLastId] = useState<string | null>(null)
  if (review && review.id !== lastId) {
    setLastId(review.id)
    setReason('')
    setNote('')
    setReply(review.owner_reply)
    setError('')
  }

  const act = async (action: string, extra: Record<string, unknown> = {}, message = 'Saved.') => {
    if (!review) return
    setBusy(true)
    setError('')
    try {
      await api(`/api/admin/reviews/${review.id}`, { body: { action, ...extra } })
      showToast(message)
      onChanged()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={Boolean(review)} onClose={onClose} title="Review" variant="wide">
      {review && (
        <div className="form-stack">
          <div className="rv-item__head">
            <Stars rating={review.rating} />
            <Pill value={review.status} label={statusLabel[review.status]} />
            {review.verified && (
              <span className="pill pill--good">
                <BadgeCheck size={12} aria-hidden="true" /> Verified purchase
              </span>
            )}
          </div>
          <h3 className="rv-title">{review.title}</h3>
          <p className="rv-item__body">{review.body}</p>
          <p className="muted">
            Product: <a href={href(`product-${review.product_slug}`)} target="_blank" rel="noopener">{review.product_title}</a> · Public name “{review.display_name}” · Written {dateTime(review.created_at)}
            {review.updated_at !== review.created_at && `, last edited ${dateTime(review.updated_at)}`}
          </p>
          {review.moderation_reason && <Notice>Moderation note: {review.moderation_reason.replace(/_/g, ' ')}</Notice>}
          {review.report_count > 0 && (
            <Notice tone="warn">
              Reported {review.report_count} {review.report_count === 1 ? 'time' : 'times'}: {review.report_reasons.map((x) => reasonLabel[x] ?? x).join(', ')}. The review stays visible until you decide.
            </Notice>
          )}

          <div className="button-row">
            {review.status !== 'published' && (
              <button type="button" className="button button--small" disabled={busy} onClick={() => act('publish', {}, 'Published.')}>
                Publish
              </button>
            )}
            {review.report_count > 0 && (
              <button type="button" className="button button--outline button--small" disabled={busy} onClick={() => act('clear_reports', {}, 'Reports cleared.')}>
                Keep it and clear reports
              </button>
            )}
          </div>

          <fieldset className="rv-box">
            <legend>{review.status === 'published' ? 'Unpublish or reject' : 'Reject'}</legend>
            <Select label="Reason" value={reason} onChange={setReason} options={[{ value: '', label: 'Choose a reason' }, ...Object.entries(reasonLabel).map(([value, label]) => ({ value, label }))]} />
            <TextInput label="Note (optional, required for Other)" value={note} onChange={setNote} maxLength={300} hint="The customer sees this reason in their account." />
            <div className="button-row">
              {review.status === 'published' && (
                <button type="button" className="button button--outline button--small" disabled={busy || !reason} onClick={() => act('unpublish', { reason, note }, 'Unpublished. It is waiting for approval again.')}>
                  Unpublish
                </button>
              )}
              {review.status !== 'rejected' && (
                <button type="button" className="button button--outline button--small" disabled={busy || !reason} onClick={() => act('reject', { reason, note }, 'Rejected.')}>
                  Reject
                </button>
              )}
            </div>
          </fieldset>

          <fieldset className="rv-box">
            <legend>Your public reply (optional)</legend>
            <TextArea label="Reply" value={reply} onChange={setReply} rows={3} maxLength={1000} hint="Shown under the review as a reply from Nurse Love Company." />
            <div className="button-row">
              <button type="button" className="button button--outline button--small" disabled={busy || reply.trim().length < 2} onClick={() => act('reply', { reply }, 'Reply saved.')}>
                Save reply
              </button>
              {review.owner_reply && (
                <button type="button" className="button button--outline button--small" disabled={busy} onClick={() => act('remove_reply', {}, 'Reply removed.')}>
                  Remove reply
                </button>
              )}
            </div>
          </fieldset>
          <FormError message={error} />

          <div>
            <h3 className="rv-title">History</h3>
            {history.loading ? (
              <Loading />
            ) : !history.data?.entries.length ? (
              <p className="muted">No moderation yet.</p>
            ) : (
              <ul className="rv-history">
                {history.data.entries.map((h) => (
                  <li key={h.id}>
                    {dateTime(h.created_at)}: {h.summary} <span className="muted">({h.actor_email})</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </Dialog>
  )
}
