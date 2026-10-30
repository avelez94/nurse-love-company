import { Star } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api, errorMessage } from '../../lib/api'
import { Dialog } from '../../components/Dialog'
import { FormError, Loading, Notice, TextArea, TextInput } from '../../components/ui'

/*
  Leave or edit a review of something you bought. The server checks the
  purchase every time. New and edited reviews wait for the owner to approve
  them before they appear on the product page.
*/

export interface Reviewable {
  product_id: string
  slug: string
  title: string
  review_id: string | null
  review_status: 'pending' | 'published' | 'rejected' | null
  rating: number | null
}

export const reviewLabel = (r: Reviewable) => (r.review_id ? 'Edit your review' : 'Leave a review')
export const reviewStatusText: Record<string, string> = {
  pending: 'Waiting for approval',
  published: 'Published',
  rejected: 'Not published',
}

export function ReviewDialog({ item, onClose, onSaved }: { item: Reviewable | null; onClose: () => void; onSaved: () => void }) {
  const [loading, setLoading] = useState(false)
  const [rating, setRating] = useState(0)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [name, setName] = useState('')
  const [reason, setReason] = useState('')
  const [eligible, setEligible] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)

  useEffect(() => {
    if (!item) return
    setDone(false)
    setError('')
    setLoading(true)
    api<{ eligible: boolean; review: { rating: number; title: string; body: string; display_name: string; status: string; moderation_reason: string } | null }>(`/api/account/reviews/${item.product_id}`)
      .then((d) => {
        setEligible(d.eligible)
        setRating(d.review?.rating ?? 0)
        setTitle(d.review?.title ?? '')
        setBody(d.review?.body ?? '')
        setName(d.review?.display_name ?? '')
        setReason(d.review?.status === 'rejected' ? d.review.moderation_reason : '')
      })
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setLoading(false))
  }, [item])

  const save = async () => {
    if (!item) return
    if (!rating) return setError('Please choose a star rating.')
    setBusy(true)
    setError('')
    try {
      await api(`/api/account/reviews/${item.product_id}`, { method: 'PUT', body: { rating, title, body, display_name: name } })
      setDone(true)
      onSaved()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={Boolean(item)} onClose={onClose} title={item ? `${item.review_id ? 'Edit your review' : 'Leave a review'}: ${item.title}` : 'Review'}>
      {loading ? (
        <Loading label="Loading..." />
      ) : done ? (
        <div className="form-stack">
          <Notice tone="success">Thank you! Your review was sent. It will appear on the product page once it is approved.</Notice>
          <button type="button" className="button button--small" onClick={onClose}>
            Close
          </button>
        </div>
      ) : !eligible ? (
        <Notice>Reviews can be written for purchases that were not refunded. If you think this is a mistake, contact support from your account.</Notice>
      ) : (
        <form
          className="form-stack"
          onSubmit={(e) => {
            e.preventDefault()
            void save()
          }}
        >
          <Notice>
            Please do not include patient details or any other private or confidential information. Your review shows only the display name you choose below, never your email or order details.
          </Notice>
          {reason && <Notice tone="warn">Your last version was not published ({reason.replace(/_/g, ' ')}). You can edit it and send it again.</Notice>}
          <fieldset className="star-input">
            <legend>Your rating</legend>
            <div className="star-input__row">
              {[1, 2, 3, 4, 5].map((n) => (
                <label key={n} className={`star-input__star ${n <= rating ? 'is-on' : ''}`}>
                  <input type="radio" name="review-rating" value={n} checked={rating === n} onChange={() => setRating(n)} className="visually-hidden" />
                  <Star aria-hidden="true" size={30} />
                  <span className="visually-hidden">
                    {n} {n === 1 ? 'star' : 'stars'}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          <TextInput label="Review title" value={title} onChange={setTitle} required maxLength={100} />
          <TextArea label="Your review" value={body} onChange={setBody} required rows={6} maxLength={2000} hint="Text only, at least 10 characters." />
          <TextInput label="Public display name" value={name} onChange={setName} required maxLength={40} hint="Shown with your review. For example, your first name and last initial." autoComplete="off" />
          <FormError message={error} />
          <button type="submit" className="button button--small" disabled={busy}>
            {busy ? 'Sending...' : 'Send review'}
          </button>
          <p className="muted">Reviews are checked by Nurse Love Company before they appear. Editing a review sends it for approval again.</p>
        </form>
      )}
    </Dialog>
  )
}
