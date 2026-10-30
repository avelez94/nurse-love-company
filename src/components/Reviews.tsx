import { BadgeCheck, Flag, Star } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api, errorMessage } from '../lib/api'
import { Dialog } from './Dialog'
import './Reviews.css'

/*
  Verified purchase reviews on the product page. Only reviews the owner
  published are shown, and the average uses those reviews only. The public
  sees the reviewer's chosen display name, never an email, billing name or
  order details.
*/

interface PublicReview {
  id: string
  rating: number
  title: string
  body: string
  displayName: string
  date: string
  verified: boolean
  ownerReply: string | null
  ownerReplyDate: string | null
}

export function Stars({ rating, size = 18, label }: { rating: number; size?: number; label?: string }) {
  return (
    <span className="stars" role="img" aria-label={label ?? `${rating} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star key={n} aria-hidden="true" size={size} className={n <= Math.round(rating) ? 'is-on' : ''} />
      ))}
    </span>
  )
}

const REPORT_REASONS: Array<[string, string]> = [
  ['private_information', 'It shares private or patient information'],
  ['abuse', 'It is abusive or hateful'],
  ['spam', 'It is spam or advertising'],
  ['not_about_product', 'It is not about this product'],
  ['other', 'Something else'],
]

const paragraphs = (t: string) => t.split(/\n{2,}/).filter((x) => x.trim())

export function ProductReviews({ slug, preview }: { slug: string; preview?: boolean }) {
  const [data, setData] = useState<{ count: number; average: number | null; reviews: PublicReview[] } | null>(null)
  const [reporting, setReporting] = useState<PublicReview | null>(null)
  const [reason, setReason] = useState('')
  const [reportState, setReportState] = useState<'idle' | 'sending' | 'sent' | string>('idle')
  const [reported, setReported] = useState<Set<string>>(new Set())

  useEffect(() => {
    let alive = true
    fetch(`/api/products/${encodeURIComponent(slug)}/reviews`, { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => alive && setData(d ?? { count: 0, average: null, reviews: [] }))
      .catch(() => alive && setData(null))
    return () => {
      alive = false
    }
  }, [slug])

  const sendReport = async () => {
    if (!reporting || !reason) return
    setReportState('sending')
    try {
      await api(`/api/reviews/${reporting.id}/report`, { body: { reason } })
      setReported((s) => new Set(s).add(reporting.id))
      setReportState('sent')
    } catch (err) {
      setReportState(errorMessage(err))
    }
  }

  return (
    <section className="container reviews" aria-labelledby="reviews-title">
      <div className="reviews__head">
        <h2 id="reviews-title" className="reviews__title">
          Reviews
        </h2>
        {data && data.count > 0 && data.average !== null && (
          <p className="reviews__summary">
            <Stars rating={data.average} label={`Average rating ${data.average} out of 5`} />
            <span>
              {data.average.toFixed(1)} out of 5, from {data.count} {data.count === 1 ? 'review' : 'reviews'}
            </span>
          </p>
        )}
      </div>
      {data === null ? (
        <p className="muted">Reviews are not available right now.</p>
      ) : data.reviews.length === 0 ? (
        <div className="reviews__empty">
          <p>No reviews yet. If you bought this, we would love to hear what you think.</p>
          <p className="muted">You can leave a review from your account, next to your purchase.</p>
        </div>
      ) : (
        <ul className="reviews__list">
          {data.reviews.map((r) => (
            <li key={r.id} className="review">
              <div className="review__top">
                <Stars rating={r.rating} />
                <h3 className="review__title">{r.title}</h3>
              </div>
              <p className="review__meta">
                <span>{r.displayName}</span>
                <span aria-hidden="true">·</span>
                <time dateTime={r.date}>{new Date(r.date).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}</time>
                {r.verified && (
                  <span className="review__verified">
                    <BadgeCheck aria-hidden="true" size={16} /> Verified purchase
                  </span>
                )}
              </p>
              {paragraphs(r.body).map((t, i) => (
                <p key={i} className="review__body">
                  {t}
                </p>
              ))}
              {r.ownerReply && (
                <div className="review__reply">
                  <p className="review__reply-label">Reply from Nurse Love Company</p>
                  {paragraphs(r.ownerReply).map((t, i) => (
                    <p key={i}>{t}</p>
                  ))}
                </div>
              )}
              {!preview && (
                <button
                  type="button"
                  className="review__report"
                  disabled={reported.has(r.id)}
                  onClick={() => {
                    setReporting(r)
                    setReason('')
                    setReportState('idle')
                  }}
                >
                  <Flag aria-hidden="true" size={14} /> {reported.has(r.id) ? 'Reported' : 'Report'}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <Dialog open={Boolean(reporting)} onClose={() => setReporting(null)} title="Report this review">
        {reportState === 'sent' ? (
          <div className="form-stack">
            <p>Thank you. The owner will take a look. The review stays visible while it is checked.</p>
            <button type="button" className="button button--small" onClick={() => setReporting(null)}>
              Close
            </button>
          </div>
        ) : (
          <form
            className="form-stack"
            onSubmit={(e) => {
              e.preventDefault()
              void sendReport()
            }}
          >
            <fieldset className="review-report">
              <legend>Why are you reporting it?</legend>
              {REPORT_REASONS.map(([value, label]) => (
                <label key={value} className="review-report__option">
                  <input type="radio" name="report-reason" value={value} checked={reason === value} onChange={() => setReason(value)} />
                  {label}
                </label>
              ))}
            </fieldset>
            {reportState !== 'idle' && reportState !== 'sending' && (
              <p className="form-error" role="alert">
                {reportState}
              </p>
            )}
            <button type="submit" className="button button--small" disabled={!reason || reportState === 'sending'}>
              {reportState === 'sending' ? 'Sending...' : 'Send report'}
            </button>
          </form>
        )}
      </Dialog>
    </section>
  )
}
