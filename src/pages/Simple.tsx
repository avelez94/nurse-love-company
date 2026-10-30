import { ArrowRight, BookOpen, ExternalLink } from 'lucide-react'
import { freebies } from '../data/catalog'
import { site } from '../data/site'
import { ExampleLabel } from '../components/Labels'
import { Heart } from '../components/illustrations/Objects'
import { SamplePageView } from '../components/SamplePageView'
import { href } from '../lib/router'
import { HelpLoading, HelpView } from '../components/HelpFaq'
import { usePublishedHelp } from '../lib/help'
import { paragraphs, usePublishedStory, type PublicStory } from '../lib/story'
import { useUI } from '../lib/ui'
import { useStore } from '../lib/store'
import { ProductCard } from '../components/ProductCard'
import { CONSENT_WORDING } from '../../shared/consent'
import { PageHeader } from './PageHeader'

/** The condition for every Freebie Corner resource, shown here and again in the bag before claiming. */
function FreebieConsentNote() {
  return (
    <p className="freebie-terms">
      <strong>How freebies work:</strong> {CONSENT_WORDING['freebie-v1']} You claim it through a short checkout with your account email; no payment or card details are needed.
    </p>
  )
}

export function Freebies() {
  const { open } = useUI()
  const { products, status } = useStore()
  const real = products.filter((p) => p.isFreebie)
  if (real.length) {
    return (
      <>
        <PageHeader
          title={site.freebie.heading}
          crumbs={[{ label: 'Home', route: 'home' }, { label: site.freebie.heading }]}
          intro={
            <>
              <p className="page-header__tagline">{site.freebie.tagline}</p>
              <p>{site.freebie.copy}</p>
              <FreebieConsentNote />
            </>
          }
        />
        <section className="container freebie-list" aria-label="Free resources">
          <div className="product-grid">
            {real.map((p, i) => (
              <ProductCard key={p.id} product={p} style={{ animationDelay: `${i * 50}ms` }} />
            ))}
          </div>
        </section>
      </>
    )
  }
  if (status === 'loading') return <div className="container page-loading" role="status">Loading...</div>
  return (
    <>
      <PageHeader
        title={site.freebie.heading}
        crumbs={[{ label: 'Home', route: 'home' }, { label: site.freebie.heading }]}
        intro={
          <>
            <p className="page-header__tagline">{site.freebie.tagline}</p>
            <p>{site.freebie.copy}</p>
            <p className="muted page-header__small">No email or sign up needed. Preview each printable before you download.</p>
          </>
        }
      />
      <section className="container freebie-list" aria-label="Free printables">
        <div className="product-grid">
          {freebies.map((f, i) => (
            <article key={f.id} className="product-card freebie-card" style={{ animationDelay: `${i * 50}ms` }}>
              <button type="button" className="freebie-card__media" onClick={() => open({ kind: 'freebie', freebie: f })} aria-label={`Preview ${f.title}`}>
                <SamplePageView page={f.page} className="freebie-card__page" label="" />
              </button>
              <div className="product-card__body">
                <span className="label-row">
                  <span className="label">Free printable</span>
                  <ExampleLabel />
                </span>
                <h2 className="product-card__title">{f.title}</h2>
                <p className="product-card__summary">{f.summary}</p>
                <div className="product-card__actions">
                  <button type="button" className="button button--small" onClick={() => open({ kind: 'freebie', freebie: f })}>
                    <BookOpen aria-hidden="true" size={18} />
                    {f.downloadable ? 'Preview & download' : 'Preview'}
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>
    </>
  )
}

/** The body of Our Story. Exported so the admin preview shows exactly what visitors will see. */
export function StoryContent({ story }: { story: PublicStory }) {
  const sections: Array<[string, string]> = [
    ['Nursing background', story.background],
    ['Why Nurse Love Company began', story.whyCreated],
    ['How each resource is made', story.process],
    ['Who we hope to support', story.whoWeSupport],
  ]
  return (
    <div className="story__card story__card--founder">
      <div className="story__founder">
        {story.portraitUrl && <img className="story__portrait" src={story.portraitUrl} alt={story.portraitAlt} />}
        <div>
          <p className="story__name">{story.founderName}</p>
          {(story.professionalTitle || story.credentials) && (
            <p className="story__role">{[story.professionalTitle, story.credentials].filter(Boolean).join(', ')}</p>
          )}
        </div>
      </div>
      {paragraphs(story.introduction).map((t, i) => (
        <p key={i}>{t}</p>
      ))}
      {sections
        .filter(([, text]) => text.trim())
        .map(([heading, text]) => (
          <section key={heading} className="story__section">
            <h2 className="story__heading">{heading}</h2>
            {paragraphs(text).map((t, i) => (
              <p key={i}>{t}</p>
            ))}
          </section>
        ))}
      {paragraphs(story.closing).map((t, i) => (
        <p key={i} className="story__closing">
          {t}
        </p>
      ))}
      {story.nurseKinText && story.nurseKinUrl && (
        <aside className="story__kin">
          <h2 className="story__heading">Nurse Kin</h2>
          {paragraphs(story.nurseKinText).map((t, i) => (
            <p key={i}>{t}</p>
          ))}
          <a className="arrow-link" href={story.nurseKinUrl} target="_blank" rel="noopener noreferrer">
            Visit Nurse Kin <ExternalLink aria-hidden="true" size={16} />
            <span className="visually-hidden"> (opens in a new tab)</span>
          </a>
        </aside>
      )}
    </div>
  )
}

export function Story() {
  const { story } = usePublishedStory()
  return (
    <>
      <PageHeader title="Meet the nurse behind the love" crumbs={[{ label: 'Home', route: 'home' }, { label: 'Our Story' }]} intro={<p className="page-header__tagline">{site.statement}</p>} />
      <section className="container story">
        {story ? (
          <StoryContent story={story} />
        ) : (
          <div className="story__card">
            <Heart className="story__heart" />
            <p>
              Nurse Love Company creates study resources, printable inserts and everyday favorites for nurses and nursing students, with a separate path for nurse practitioner students.
            </p>
            <p>
              Every digital resource is made to support your nursing life, and every physical favorite is chosen to add a little extra cute to your day.
            </p>
          </div>
        )}
        <div className="chip-row story__links">
          <a className="button button--small" href={href('shop')}>
            Shop resources <ArrowRight className="arrow" aria-hidden="true" size={18} />
          </a>
          <a className="chip" href={href('freebie-corner')}>The Freebie Corner</a>
        </div>
      </section>
    </>
  )
}

export function Help() {
  const { loading, help } = usePublishedHelp()
  if (loading) return <HelpLoading />
  return <HelpView help={help} />
}

export function NotFound() {
  return (
    <>
      <PageHeader title="We couldn't find that page" intro={<p>The link may be old, or the page may have moved.</p>} />
      <section className="container story">
        <div className="chip-row">
          <a className="button button--small" href={href('home')}>Go to the homepage</a>
          <a className="chip" href={href('shop')}>Shop resources</a>
          <a className="chip" href={href('freebie-corner')}>The Freebie Corner</a>
        </div>
      </section>
    </>
  )
}
