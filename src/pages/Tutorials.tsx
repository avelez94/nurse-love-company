import { ServerUnavailable, ServerUnavailablePage } from '../components/Unavailable'
import { ArrowRight, Info, PlayCircle } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { Tutorial, TutorialCategoryId } from '../data/types'
import { captionText, formatDuration, getTutorialCategory, MIN_TUTORIALS_FOR_FILTERS, tutorialCategories } from '../data/tutorials'
import { RichText } from '../components/RichText'
import { useStore } from '../lib/store'
import { TutorialCard } from '../components/TutorialCard'
import { TutorialThumb } from '../components/TutorialThumb'
import { VideoPlayer } from '../components/VideoPlayer'
import { href } from '../lib/router'
import { PageHeader } from './PageHeader'
import { NotFound } from './Simple'
import './Tutorials.css'

function BinderNote() {
  return (
    <p className="notice tutorials-note">
      <Info aria-hidden="true" size={18} />
      <span>
        These videos show how to use the inserts. <strong>Physical binders are not included</strong> with digital purchases.
      </span>
    </p>
  )
}

function PlaceholderNote({ tutorial }: { tutorial: Tutorial }) {
  if (!tutorial.isExample && !tutorial.placeholderVideo) return null
  return (
    <span className="label label--example label--wrap">
      <Info aria-hidden="true" />
      {tutorial.placeholderVideo ? 'Placeholder video • not the owner\'s recording' : 'Example tutorial'}
    </span>
  )
}

export function Tutorials() {
  const [filter, setFilter] = useState<TutorialCategoryId | 'all'>('all')
  const { tutorials, status } = useStore()
  const featured = tutorials.find((t) => t.featured) ?? tutorials[0]
  const showFilters = tutorials.length >= MIN_TUTORIALS_FOR_FILTERS
  const usedCategories = tutorialCategories.filter((c) => tutorials.some((t) => t.category === c.id))
  const list = filter === 'all' ? tutorials.filter((t) => t !== featured) : tutorials.filter((t) => t.category === filter)

  return (
    <>
      <PageHeader
        title="Tutorials"
        crumbs={[{ label: 'Home', route: 'home' }, { label: 'Tutorials' }]}
        intro={
          <>
            <p>Short videos that show you how to set up and use your inserts. Free to watch, no account needed.</p>
            <BinderNote />
          </>
        }
      />

      {featured && filter === 'all' && (
        <section className="container tutorials-featured" aria-labelledby="featured-title">
          <p className="eyebrow">Featured tutorial</p>
          <a className="tutorial-feature" href={href(`tutorial-${featured.slug}`)}>
            <span className="tutorial-feature__media">
              <TutorialThumb tutorial={featured} size="lg" />
            </span>
            <span className="tutorial-feature__body">
              <span className="tutorial-card__meta">
                <span className="eyebrow">{getTutorialCategory(featured.category).title}</span>
                <span className="tutorial-card__duration">{formatDuration(featured.durationSeconds)}</span>
              </span>
              <h2 id="featured-title" className="tutorial-feature__title">
                {featured.title}
              </h2>
              <span className="tutorial-feature__summary">{featured.summary}</span>
              <PlaceholderNote tutorial={featured} />
              <span className="button tutorial-feature__button">
                <PlayCircle aria-hidden="true" size={20} />
                Watch tutorial
              </span>
            </span>
          </a>
        </section>
      )}

      <section className="container tutorials-list" aria-labelledby="all-tutorials-title">
        <div className="tutorials-list__head">
          <h2 id="all-tutorials-title" className="tutorials-list__title">
            {filter === 'all' ? 'More tutorials' : getTutorialCategory(filter).title}
          </h2>
          {showFilters && (
            <div className="shop__filters" role="group" aria-label="Filter tutorials by category">
              <button type="button" className="chip" aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>
                All
              </button>
              {usedCategories.map((c) => (
                <button key={c.id} type="button" className="chip" aria-pressed={filter === c.id} onClick={() => setFilter(c.id)}>
                  {c.title}
                </button>
              ))}
            </div>
          )}
        </div>
        <p className="shop__count" aria-live="polite">
          {status === 'loading' ? 'Loading tutorials...' : status === 'offline' && tutorials.length === 0 ? '' : filter === 'all' ? `${tutorials.length} ${tutorials.length === 1 ? 'tutorial' : 'tutorials'}` : `${list.length} ${list.length === 1 ? 'tutorial' : 'tutorials'} in ${getTutorialCategory(filter).title}`}
        </p>
        {status === 'offline' && tutorials.length === 0 ? (
          <ServerUnavailable title="Tutorials are on their way">This preview is not connected to the store yet, so there are no tutorials to show. They will appear here once it is.</ServerUnavailable>
        ) : list.length > 0 ? (
          <div className="tutorial-grid" key={filter}>
            {list.map((t, i) => (
              <TutorialCard key={t.id} tutorial={t} style={{ animationDelay: `${i * 50}ms` }} />
            ))}
          </div>
        ) : (
          <div className="empty-state">
            <p className="empty-state__title">No tutorials here yet</p>
            <p className="muted">Try another category.</p>
            <button type="button" className="button button--small" onClick={() => setFilter('all')}>
              Show all tutorials
            </button>
          </div>
        )}
        {tutorials.some((t) => t.placeholderVideo) && <p className="muted shop__fineprint">Tutorials marked "placeholder video" use a short stand in clip until the owner's own recordings are added.</p>}
      </section>
    </>
  )
}

/** Transcript from the tutorial, or else the caption file's text. */
function Transcript({ paragraphs, captionSrc }: { paragraphs: string[]; captionSrc?: string }) {
  const [fromCaptions, setFromCaptions] = useState<string[]>([])
  useEffect(() => {
    if (paragraphs.length || !captionSrc) return
    let live = true
    fetch(captionSrc)
      .then((r) => (r.ok ? r.text() : ''))
      .then((t) => live && setFromCaptions(t ? captionText(t) : []))
      .catch(() => {})
    return () => {
      live = false
    }
  }, [paragraphs, captionSrc])
  const lines = paragraphs.length ? paragraphs : fromCaptions
  if (!lines.length) return null
  return (
    <details className="faq watch__transcript">
      <summary>Transcript</summary>
      {lines.map((p, i) => (
        <p key={i}>{p}</p>
      ))}
    </details>
  )
}

function relatedTutorials(all: Tutorial[], t: Tutorial, count = 3) {
  const others = all.filter((x) => x.id !== t.id)
  const same = others.filter((x) => x.category === t.category)
  const rest = others.filter((x) => x.category !== t.category)
  return [...same, ...rest].slice(0, count)
}

export function TutorialWatch({ slug }: { slug: string }) {
  const { getTutorial, tutorials, products, status } = useStore()
  const tutorial = getTutorial(slug)
  if (!tutorial && status === 'loading') return <div className="container page-loading" role="status">Loading tutorial...</div>
  if (!tutorial && status === 'offline') return <ServerUnavailablePage title="This tutorial is not available yet" />
  if (!tutorial) return <NotFound />
  const category = getTutorialCategory(tutorial.category)
  const transcript = tutorial.transcript ?? tutorial.captions.flatMap((c) => (c.vtt ? captionText(c.vtt) : []))
  const related = relatedTutorials(tutorials, tutorial)
  const relatedProducts = tutorial.relatedProducts?.length
    ? tutorial.relatedProducts
    : products.filter((p) => tutorial.productCategories.includes(p.category) && p.type === 'digital').slice(0, 3)

  return (
    <>
      <div className="page-header page-header--compact">
        <div className="container">
          <nav aria-label="Breadcrumb" className="crumbs">
            <ol>
              <li><a href={href('home')}>Home</a></li>
              <li><a href={href('tutorials')}>Tutorials</a></li>
              <li><span aria-current="page">{tutorial.title}</span></li>
            </ol>
          </nav>
        </div>
      </div>

      <article className="container watch">
        <header className="watch__head">
          <p className="tutorial-card__meta watch__meta">
            <span className="eyebrow">{category.title}</span>
            <span className="tutorial-card__duration">{formatDuration(tutorial.durationSeconds)}</span>
          </p>
          <h1 className="watch__title">{tutorial.title}</h1>
          <p className="watch__summary">{tutorial.summary}</p>
          <PlaceholderNote tutorial={tutorial} />
        </header>

        <div className="watch__player">
          {tutorial.video ? (
            <VideoPlayer video={tutorial.video} captions={tutorial.captions} title={tutorial.title} />
          ) : (
            <p className="notice">The video for this tutorial is not available right now. The written instructions below cover the same steps.</p>
          )}
        </div>
        <BinderNote />

        <div className="watch__content">
          <div className="watch__main">
            <section aria-labelledby="steps-title" className="watch__section">
              <h2 id="steps-title" className="watch__heading">Written instructions</h2>
              {tutorial.isExample && <p className="muted watch__small">Sample steps for the preview. Final instructions will come from Nurse Love Company.</p>}
              {tutorial.steps.length > 0 ? (
                <ol className="steps">
                  {tutorial.steps.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ol>
              ) : (
                <RichText doc={tutorial.instructions} className="watch__instructions" />
              )}
            </section>
            <Transcript paragraphs={transcript} captionSrc={tutorial.captions[0]?.src} />
          </div>

          {(tutorial.links.length > 0 || relatedProducts.length > 0) && (
            <aside className="watch__aside" aria-labelledby="resources-title">
              <h2 id="resources-title" className="watch__heading">Helpful resources</h2>
              {relatedProducts.length > 0 && (
                <ul className="watch__links">
                  {relatedProducts.map((p) => (
                    <li key={p.id}>
                      <a className="arrow-link" href={href(`product-${p.slug}`)}>
                        {p.title} <ArrowRight className="arrow" aria-hidden="true" size={16} />
                      </a>
                    </li>
                  ))}
                </ul>
              )}
              <div className="chip-row">
                {tutorial.links.map((l) => (
                  <a key={l.route} className="chip" href={href(l.route)}>
                    {l.label}
                  </a>
                ))}
              </div>
            </aside>
          )}
        </div>
      </article>

      {related.length > 0 && (
        <section className="container related" aria-labelledby="related-tutorials-title">
          <div className="related__head">
            <h2 id="related-tutorials-title" className="related__title">Related tutorials</h2>
            <a className="arrow-link" href={href('tutorials')}>
              All tutorials <ArrowRight className="arrow" aria-hidden="true" size={18} />
            </a>
          </div>
          <div className="tutorial-grid">
            {related.map((t) => (
              <TutorialCard key={t.id} tutorial={t} />
            ))}
          </div>
        </section>
      )}
    </>
  )
}
