import { ArrowRight, ChevronLeft, ExternalLink, HeartHandshake, RotateCcw, Sparkles, X } from 'lucide-react'
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { pickResult, type QuizResult } from '../../shared/quiz'
import { getCategory } from '../data/catalog'
import { formatPrice } from '../lib/format'
import { isExternal, readStore, sendMarketingEvent, sendQuizEvent, useMarketing, writeStore, type PublicPopup, type PublicQuiz } from '../lib/marketing'
import { href, useRoute, type Route } from '../lib/router'
import './Launchers.css'

/*
  Two small launchers in the bottom right corner: "Find my resources" (the
  owner's quiz) and the Nurse Kin invitation. Nothing opens by itself. Only
  one panel is open at a time. On phones a panel is a bottom sheet that
  keeps focus inside it. Escape closes and focus returns to the launcher.
*/

/* ---------- Quiz ---------- */

interface Progress {
  step: number // -1 introduction, 0..n-1 questions, n results
  answers: Record<string, string[]>
  /** The completion was already counted (so reopening the results does not count it twice). */
  counted?: boolean
}

const progressKey = (q: PublicQuiz) => `nlc-quiz:${q.id}:${q.version}`

/** The quiz itself. Used in the storefront panel and, with `preview`, in the admin test mode (nothing recorded). */
export function QuizFlow({ quiz, preview, onNavigate, titleId }: { quiz: PublicQuiz; preview?: boolean; onNavigate?: () => void; titleId?: string }) {
  const c = quiz.content
  const [p, setP] = useState<Progress>(() => {
    if (preview) return { step: -1, answers: {} }
    try {
      const saved = JSON.parse(readStore('session', progressKey(quiz)) ?? 'null') as Progress | null
      if (saved && typeof saved.step === 'number' && saved.answers) return saved
    } catch {
      /* start fresh */
    }
    return { step: -1, answers: {} }
  })
  const n = c.questions.length
  const headingRef = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    if (!preview) writeStore('session', progressKey(quiz), JSON.stringify(p))
  }, [p, preview, quiz])
  // Move focus to the new question or result heading so keyboard and screen reader users follow along.
  const first = useRef(true)
  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    headingRef.current?.focus()
  }, [p.step])

  const available = useMemo(() => new Map(quiz.products.map((x) => [x.id, x])), [quiz.products])
  const tutorialIds = useMemo(() => new Set(quiz.tutorials.map((t) => t.id)), [quiz.tutorials])
  const hasContent = useCallback((r: QuizResult) => r.productIds.some((id) => available.has(id)) || r.collections.length > 0 || r.tutorialIds.some((id) => tutorialIds.has(id)) || r.freebieCorner, [available, tutorialIds])
  const outcome = useMemo(() => (p.step >= n ? pickResult(c, p.answers, hasContent) : null), [p, n, c, hasContent])

  useEffect(() => {
    if (p.step >= n && n > 0 && !p.counted) {
      setP((prev) => ({ ...prev, counted: true }))
      if (!preview) sendQuizEvent(quiz.id, quiz.version, 'complete')
    }
  }, [p.step, p.counted, n, preview, quiz])

  const start = () => {
    setP({ step: 0, answers: {} })
    if (!preview) sendQuizEvent(quiz.id, quiz.version, 'start')
  }
  const restart = () => setP({ step: -1, answers: {} })

  if (p.step < 0) {
    return (
      <div className="quiz">
        <h2 id={titleId} className="quiz__title" ref={headingRef} tabIndex={-1}>
          {c.title}
        </h2>
        <p className="quiz__intro">{c.intro}</p>
        <p className="quiz__fine">A few quick questions about the resources you are looking for. No email needed, and your answers are not saved.</p>
        <button type="button" className="button quiz__start" onClick={start}>
          Start <ArrowRight aria-hidden="true" size={18} />
        </button>
      </div>
    )
  }

  if (p.step < n) {
    const q = c.questions[p.step]
    const chosen = p.answers[q.id] ?? []
    const choose = (id: string, on: boolean) =>
      setP((prev) => ({ ...prev, answers: { ...prev.answers, [q.id]: q.type === 'single' ? [id] : on ? [...(prev.answers[q.id] ?? []), id] : (prev.answers[q.id] ?? []).filter((x) => x !== id) } }))
    const canNext = !q.required || chosen.length > 0
    return (
      <div className="quiz">
        <p className="quiz__progress-label" id={`${quiz.id}-progress`}>
          Question {p.step + 1} of {n}
        </p>
        <div className="quiz__progress" role="progressbar" aria-labelledby={`${quiz.id}-progress`} aria-valuemin={0} aria-valuemax={n} aria-valuenow={p.step + 1}>
          <span style={{ width: `${((p.step + 1) / n) * 100}%` }} />
        </div>
        <fieldset className="quiz__question">
          <legend>
            <h2 id={titleId} className="quiz__q" ref={headingRef} tabIndex={-1}>
              {q.text}
            </h2>
          </legend>
          {(q.helper || q.type === 'multiple' || !q.required) && (
            <p className="quiz__helper">
              {q.helper}
              {q.helper && ' '}
              {q.type === 'multiple' ? 'Choose any that apply.' : ''}
              {!q.required ? ' Optional.' : ''}
            </p>
          )}
          <div className="quiz__answers">
            {q.answers.map((a) => (
              <label key={a.id} className={`quiz__answer ${chosen.includes(a.id) ? 'is-chosen' : ''}`}>
                <input type={q.type === 'single' ? 'radio' : 'checkbox'} name={`${quiz.id}-${q.id}`} checked={chosen.includes(a.id)} onChange={(e) => choose(a.id, e.target.checked)} />
                <span>{a.label}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <div className="quiz__nav">
          <button type="button" className="button button--outline button--small" onClick={() => setP((prev) => ({ ...prev, step: prev.step - 1 }))}>
            <ChevronLeft aria-hidden="true" size={16} /> Back
          </button>
          <button type="button" className="button button--small" disabled={!canNext} onClick={() => setP((prev) => ({ ...prev, step: prev.step + 1 }))}>
            {p.step === n - 1 ? 'See my results' : 'Next'} <ArrowRight aria-hidden="true" size={16} />
          </button>
        </div>
      </div>
    )
  }

  const r = outcome?.result
  const products = r ? r.productIds.map((id) => available.get(id)).filter((x): x is PublicQuiz['products'][number] => Boolean(x)) : []
  const tutorials = r ? quiz.tutorials.filter((t) => r.tutorialIds.includes(t.id)) : []
  return (
    <div className="quiz">
      <p className="quiz__progress-label">Your results</p>
      <h2 id={titleId} className="quiz__title" ref={headingRef} tabIndex={-1}>
        {r ? r.title : 'Let us help you look around'}
      </h2>
      <p className="quiz__intro">{r ? r.description : 'We could not find a close match from your answers yet. Browse everything, or visit The Freebie Corner to try a free resource first.'}</p>
      {products.length > 0 && (
        <ul className="quiz__products">
          {products.map((prod) => (
            <li key={prod.id}>
              <a
                href={href(`product-${prod.slug}`)}
                className="quiz__product"
                onClick={(e) => {
                  if (preview) {
                    e.preventDefault()
                    return
                  }
                  sendQuizEvent(quiz.id, quiz.version, 'product_click')
                  onNavigate?.()
                }}
              >
                {prod.imageUrl ? <img src={prod.imageUrl} alt="" loading="lazy" /> : <span className="quiz__product-art" aria-hidden="true" />}
                <span>
                  <span className="quiz__product-title">{prod.title}</span>
                  {prod.priceCents !== null && <span className="quiz__product-price">{formatPrice(prod.salePriceCents ?? prod.priceCents)}</span>}
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
      {(r?.collections.length || tutorials.length || r?.freebieCorner || !r) && (
        <div className="quiz__more">
          {r?.collections.map((cid) => (
            <a key={cid} className="chip" href={href(getCategory(cid as never).route)} onClick={(e) => (preview ? e.preventDefault() : onNavigate?.())}>
              {getCategory(cid as never).title}
            </a>
          ))}
          {tutorials.map((t) => (
            <a key={t.id} className="chip" href={href(`tutorial-${t.slug}`)} onClick={(e) => (preview ? e.preventDefault() : onNavigate?.())}>
              Tutorial: {t.title}
            </a>
          ))}
          {(r?.freebieCorner || !r) && (
            <a className="chip" href={href('freebie-corner')} onClick={(e) => (preview ? e.preventDefault() : onNavigate?.())}>
              The Freebie Corner
            </a>
          )}
        </div>
      )}
      <div className="quiz__nav">
        <button type="button" className="button button--outline button--small" onClick={restart}>
          <RotateCcw aria-hidden="true" size={16} /> Restart
        </button>
        <a className="button button--small" href={href('shop')} onClick={(e) => (preview ? e.preventDefault() : onNavigate?.())}>
          {c.ctaLabel}
        </a>
      </div>
      {preview && outcome && (
        <p className="quiz__fine">
          Test mode. Points: {c.results.map((x) => `${x.title || 'Untitled'} ${outcome.totals[x.id] ?? 0}`).join(', ')}.{outcome.usedFallback ? ' The fallback was used.' : ''}
        </p>
      )}
    </div>
  )
}

/* ---------- Nurse Kin ---------- */

/** The Nurse Kin invitation. A plain link to Nurse Kin; nothing is collected here. */
export function NurseKinCard({ popup, preview, titleId, onClick }: { popup: PublicPopup; preview?: boolean; titleId?: string; onClick?: () => void }) {
  return (
    <div className="kin">
      {popup.image && <img className="kin__image" src={popup.image.url} alt={popup.image.alt} />}
      <h2 id={titleId} className="kin__title" tabIndex={-1}>
        {popup.headline}
      </h2>
      {popup.body.split(/\n{2,}/).map((t, i) => (
        <p key={i} className="kin__text">
          {t}
        </p>
      ))}
      <a
        className="button kin__cta"
        href={popup.url || '#'}
        target={isExternal(popup.url) ? '_blank' : undefined}
        rel="noopener noreferrer"
        onClick={(e) => {
          if (preview) e.preventDefault()
          else onClick?.()
        }}
      >
        {popup.ctaLabel}
        <ExternalLink aria-hidden="true" size={16} />
        <span className="visually-hidden"> (opens Nurse Kin in a new tab)</span>
      </a>
      <p className="kin__fine">You will join on the Nurse Kin website. Nurse Love Company does not sign you up or collect your email.</p>
    </div>
  )
}

/* ---------- Launchers ---------- */

const HIDDEN_ROUTES: Array<Route['name']> = ['auth', 'checkout', 'account', 'admin', 'email-preferences']
const focusables = (root: HTMLElement) => Array.from(root.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])')).filter((el) => el.offsetParent !== null)

export function FloatingLaunchers() {
  const { quiz, popup } = useMarketing()
  const route = useRoute()
  const [open, setOpen] = useState<'quiz' | 'kin' | null>(null)
  const [sheet, setSheet] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 600px)').matches)
  const [videoPlaying, setVideoPlaying] = useState(false)
  const quizBtn = useRef<HTMLButtonElement>(null)
  const kinBtn = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const stackRef = useRef<HTMLDivElement>(null)
  const panelId = useId()
  const hidden = HIDDEN_ROUTES.includes(route.name) || videoPlaying
  const visible = !hidden && Boolean(quiz || popup)

  const close = useCallback((returnFocus = true) => {
    setOpen((current) => {
      if (returnFocus && current) window.setTimeout(() => (current === 'quiz' ? quizBtn : kinBtn).current?.focus(), 0)
      return null
    })
  }, [])

  // "Find your essentials" on the home page opens the quiz panel.
  useEffect(() => {
    const onOpen = () => setOpen('quiz')
    window.addEventListener('nlc:open-quiz', onOpen)
    return () => window.removeEventListener('nlc:open-quiz', onOpen)
  }, [])

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 600px)')
    const onChange = () => setSheet(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  // Step aside while a tutorial video plays.
  useEffect(() => {
    const update = () => setVideoPlaying(Array.from(document.querySelectorAll('video')).some((v) => !v.paused && !v.ended))
    document.addEventListener('play', update, true)
    document.addEventListener('pause', update, true)
    document.addEventListener('ended', update, true)
    return () => {
      document.removeEventListener('play', update, true)
      document.removeEventListener('pause', update, true)
      document.removeEventListener('ended', update, true)
    }
  }, [])

  useEffect(() => {
    if (!visible && open) setOpen(null)
  }, [visible, open])

  // Keep the back to top button clear of the launchers.
  useEffect(() => {
    const root = document.documentElement
    const el = stackRef.current
    if (!visible || !el) {
      root.style.removeProperty('--launcher-stack')
      return
    }
    const set = () => root.style.setProperty('--launcher-stack', `${el.offsetHeight + 10}px`)
    set()
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(set) : null
    ro?.observe(el)
    return () => {
      ro?.disconnect()
      root.style.removeProperty('--launcher-stack')
    }
  }, [visible, quiz, popup])

  // Focus the panel when it opens; lock page scrolling for the phone sheet.
  useEffect(() => {
    if (!open) return
    const panel = panelRef.current
    window.setTimeout(() => (panel?.querySelector<HTMLElement>('[tabindex="-1"]') ?? (panel ? focusables(panel)[0] : null))?.focus(), 0)
    if (open === 'kin' && popup) sendMarketingEvent('popup', 'nurse_kin', popup.version, 'view')
    if (sheet) document.documentElement.classList.add('has-sheet')
    return () => document.documentElement.classList.remove('has-sheet')
  }, [open, sheet, popup])

  if (!visible) return null

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation()
      close()
    } else if (e.key === 'Tab' && sheet && panelRef.current) {
      // The phone sheet is modal: keep focus inside it.
      const items = focusables(panelRef.current)
      if (!items.length) return
      const firstEl = items[0]
      const lastEl = items[items.length - 1]
      if (e.shiftKey && document.activeElement === firstEl) {
        e.preventDefault()
        lastEl.focus()
      } else if (!e.shiftKey && document.activeElement === lastEl) {
        e.preventDefault()
        firstEl.focus()
      }
    }
  }

  const toggle = (which: 'quiz' | 'kin') => setOpen((cur) => (cur === which ? null : which))

  return (
    <>
      {open && sheet && <div className="launcher-backdrop" aria-hidden="true" onClick={() => close()} />}
      {open && (
        <div
          ref={panelRef}
          id={panelId}
          className={`launcher-panel ${sheet ? 'launcher-panel--sheet' : ''} ${open === 'kin' && popup ? `launcher-panel--themed promo-theme--${popup.theme}` : ''}`}
          role="dialog"
          aria-modal={sheet ? true : undefined}
          aria-label={open === 'quiz' ? quiz?.content.title || 'Find my resources' : popup?.headline || 'Nurse Kin'}
          onKeyDown={onKeyDown}
        >
          <button type="button" className="launcher-panel__close" onClick={() => close()} aria-label={open === 'quiz' ? 'Minimize the resource finder' : 'Close Nurse Kin'}>
            <X aria-hidden="true" size={20} />
          </button>
          {open === 'quiz' && quiz && <QuizFlow quiz={quiz} onNavigate={() => close(false)} />}
          {open === 'kin' && popup && <NurseKinCard popup={popup} onClick={() => sendMarketingEvent('popup', 'nurse_kin', popup.version, 'click')} />}
        </div>
      )}
      <div className="launchers" ref={stackRef} role="group" aria-label="Helpful extras">
        {popup && (
          <button ref={kinBtn} type="button" className={`launcher ${open === 'kin' ? 'is-open' : ''}`} aria-expanded={open === 'kin'} aria-controls={open === 'kin' ? panelId : undefined} onClick={() => toggle('kin')}>
            <HeartHandshake aria-hidden="true" size={18} />
            {popup.launcherLabel}
          </button>
        )}
        {quiz && (
          <button ref={quizBtn} type="button" className={`launcher ${open === 'quiz' ? 'is-open' : ''}`} aria-expanded={open === 'quiz'} aria-controls={open === 'quiz' ? panelId : undefined} onClick={() => toggle('quiz')}>
            <Sparkles aria-hidden="true" size={18} />
            Find my resources
          </button>
        )}
      </div>
    </>
  )
}
