import { ChevronDown, Mail, Search, X } from 'lucide-react'
import { Fragment, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { answerText, parseAnswer, type PublicFaq } from '../../shared/faq'
import { site } from '../data/site'
import { openQuizPanel } from '../lib/marketing'
import { href } from '../lib/router'
import { PageHeader } from '../pages/PageHeader'
import { TutorialHelpLink } from './TutorialCard'
import './HelpFaq.css'

/*
  Help & FAQs: searchable, with categories and questions that open
  independently. Everything starts closed; several can stay open. While
  searching, matching categories and answers open and matching words are
  highlighted; Clear search returns to the previous open and closed state.
  Only the published FAQ reaches this page.
*/

export const DEFAULT_HEADING = 'A little help, a lot of nurse love'
export const DEFAULT_INTRO = 'Questions about your goodies? Let’s get you sorted.'

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

function Highlight({ text, terms }: { text: string; terms: string[] }) {
  if (!terms.length) return <>{text}</>
  const re = new RegExp(`(${terms.map(escapeRe).join('|')})`, 'gi')
  return (
    <>
      {text.split(re).map((part, i) =>
        i % 2 ? (
          <mark key={i} className="faq-mark">
            {part}
          </mark>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        ),
      )}
    </>
  )
}

function Answer({ answer, terms, preview }: { answer: string; terms: string[]; preview?: boolean }) {
  return (
    <>
      {parseAnswer(answer).map((p, i) => (
        <p key={i}>
          {p.parts.map((part, j) => {
            if (part.type === 'text') return <Highlight key={j} text={part.text} terms={terms} />
            const label = <Highlight text={part.label} terms={terms} />
            if (part.href === '#find-my-resources') {
              return (
                <a
                  key={j}
                  href={href('help')}
                  onClick={(e) => {
                    e.preventDefault()
                    if (!preview) openQuizPanel()
                  }}
                >
                  {label}
                </a>
              )
            }
            const external = part.href.startsWith('https://')
            return (
              <a key={j} href={part.href} onClick={preview ? (e) => e.preventDefault() : undefined} {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>
                {label}
                {external && <span className="visually-hidden"> (opens in a new tab)</span>}
              </a>
            )
          })}
        </p>
      ))}
    </>
  )
}

function ContactCard({ contact }: { contact: PublicFaq['contact'] }) {
  const hours = [contact.hours, contact.timezone].filter(Boolean).join(', ')
  return (
    <aside className="help__contact" aria-labelledby="help-contact-title">
      <h2 id="help-contact-title" className="help__title">
        Still need help?
      </h2>
      {contact.email && (
        <a className="help__email" href={`mailto:${contact.email}`}>
          <Mail aria-hidden="true" size={18} /> {contact.email}
        </a>
      )}
      {hours && <p>Support hours: {hours}</p>}
      {contact.responseTime && <p>{contact.responseTime}</p>}
      <a className="arrow-link" href={href('account-support')}>
        Message us from your account
      </a>
      {!contact.email && (
        <p className="muted">
          You can also visit the current{' '}
          <a href={site.existingSite} target="_blank" rel="noopener noreferrer">
            Nurse Love Company website
            <span className="visually-hidden"> (opens in a new tab)</span>
          </a>
          .
        </p>
      )}
      <div className="help__guides">
        <TutorialHelpLink category="np-inserts" />
        <TutorialHelpLink category="nurse-inserts" />
      </div>
    </aside>
  )
}

export function HelpView({ help, preview = false, narrow = false }: { help: PublicFaq | null; preview?: boolean; narrow?: boolean }) {
  const uid = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [openCats, setOpenCats] = useState<Set<string>>(new Set())
  const [openQs, setOpenQs] = useState<Set<string>>(new Set())
  const [searchCats, setSearchCats] = useState<Set<string>>(new Set())
  const [searchQs, setSearchQs] = useState<Set<string>>(new Set())
  const [announced, setAnnounced] = useState('')

  const categories = help?.categories ?? []
  const terms = useMemo(() => query.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 8), [query])
  const searching = terms.length > 0

  // Every word typed must appear in the category name, question, answer or keywords.
  const results = useMemo(() => {
    if (!searching) return categories.map((c) => ({ ...c, matches: c.questions }))
    return categories
      .map((c) => ({
        ...c,
        matches: c.questions.filter((q) => {
          const hay = `${c.title} ${q.question} ${answerText(parseAnswer(q.answer))} ${q.keywords.join(' ')}`.toLowerCase()
          return terms.every((t) => hay.includes(t))
        }),
      }))
      .filter((c) => c.matches.length)
  }, [categories, terms, searching])
  const count = results.reduce((n, c) => n + c.matches.length, 0)
  const countText = searching ? (count ? `${count} matching ${count === 1 ? 'question' : 'questions'}` : 'No matching questions') : ''

  // Matching categories and answers open; the visitor's own open state is kept for when the search is cleared.
  const resultKey = results.map((c) => `${c.id}:${c.matches.map((q) => q.id).join(',')}`).join('|')
  useEffect(() => {
    if (!searching) return
    setSearchCats(new Set(results.map((c) => c.id)))
    setSearchQs(new Set(results.flatMap((c) => c.matches.map((q) => q.id))))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resultKey, searching])

  // Announce the count once typing pauses, not on every key press.
  useEffect(() => {
    const t = window.setTimeout(() => setAnnounced(countText), 700)
    return () => window.clearTimeout(t)
  }, [countText])

  const cats = searching ? searchCats : openCats
  const qs = searching ? searchQs : openQs
  const toggle = (set: Set<string>, id: string, write: (s: Set<string>) => void) => {
    const next = new Set(set)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    write(next)
  }
  const toggleCat = (id: string) => toggle(cats, id, searching ? setSearchCats : setOpenCats)
  const toggleQ = (id: string) => toggle(qs, id, searching ? setSearchQs : setOpenQs)

  const heading = help?.heading || DEFAULT_HEADING
  const intro = help?.intro || DEFAULT_INTRO
  const hasFaqs = categories.length > 0

  return (
    <>
      <PageHeader title={heading} crumbs={preview ? undefined : [{ label: 'Home', route: 'home' }, { label: 'Help & contact' }]} intro={<p>{intro}</p>} />
      <section className={`container help ${narrow ? 'help--narrow' : ''}`}>
        <div className="help__faqs">
          {hasFaqs ? (
            <>
              <div className="faq-search" role="search">
                <label className="faq-search__label" htmlFor={`${uid}-search`}>
                  How can we help?
                </label>
                <div className="faq-search__row">
                  <Search className="faq-search__icon" aria-hidden="true" size={20} />
                  <input
                    ref={inputRef}
                    id={`${uid}-search`}
                    className="faq-search__input"
                    type="search"
                    placeholder="Search downloads, shipping, returns…"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    autoComplete="off"
                    aria-describedby={`${uid}-count`}
                  />
                  {query && (
                    <button
                      type="button"
                      className="faq-search__clear"
                      onClick={() => {
                        setQuery('')
                        inputRef.current?.focus()
                      }}
                    >
                      <X aria-hidden="true" size={16} /> Clear search
                    </button>
                  )}
                </div>
                <p className="faq-search__count" id={`${uid}-count`}>
                  {countText}
                </p>
                <p className="visually-hidden" aria-live="polite" aria-atomic="true">
                  {announced}
                </p>
              </div>

              {searching && !count && (
                <div className="faq-empty">
                  <p>
                    We couldn’t find that one. Try another keyword or{' '}
                    <a
                      href={href('help')}
                      onClick={(e) => {
                        // The site uses # for pages, so scroll to the contact card instead of following the link.
                        e.preventDefault()
                        const card = document.getElementById('help-contact-title')
                        card?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' })
                      }}
                    >
                      contact us
                    </a>
                    .
                  </p>
                </div>
              )}

              {results.map((c) => {
                const open = cats.has(c.id)
                const panel = `${uid}-cat-${c.id}`
                return (
                  <section key={c.id} className={`faq-cat ${open ? 'is-open' : ''}`}>
                    <h2 className="faq-cat__heading">
                      <button type="button" className="faq-cat__toggle" aria-expanded={open} aria-controls={panel} onClick={() => toggleCat(c.id)}>
                        <span className="faq-cat__title">
                          <Highlight text={c.title} terms={terms} />
                        </span>
                        <span className="faq-cat__count">
                          {c.matches.length} {c.matches.length === 1 ? 'question' : 'questions'}
                        </span>
                        <ChevronDown className="faq-chevron" aria-hidden="true" size={22} />
                      </button>
                    </h2>
                    <div id={panel} className="faq-cat__panel" hidden={!open}>
                      {c.matches.map((q) => {
                        const qOpen = qs.has(q.id)
                        const answerId = `${uid}-a-${q.id}`
                        return (
                          <div key={q.id} className={`faq-q ${qOpen ? 'is-open' : ''}`}>
                            <h3 className="faq-q__heading">
                              <button type="button" className="faq-q__toggle" aria-expanded={qOpen} aria-controls={answerId} onClick={() => toggleQ(q.id)}>
                                <span>
                                  <Highlight text={q.question} terms={terms} />
                                </span>
                                <ChevronDown className="faq-chevron" aria-hidden="true" size={18} />
                              </button>
                            </h3>
                            <div id={answerId} className="faq-q__answer" hidden={!qOpen}>
                              <Answer answer={q.answer} terms={terms} preview={preview} />
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </section>
                )
              })}
            </>
          ) : (
            <div className="faq-empty">
              <p>Answers to common questions are on their way. In the meantime, we are happy to help you directly.</p>
            </div>
          )}
        </div>
        <ContactCard contact={help?.contact ?? {}} />
      </section>
    </>
  )
}

export function HelpLoading({ children }: { children?: ReactNode }) {
  return (
    <div className="container page-loading" role="status">
      {children ?? 'Loading help...'}
    </div>
  )
}
