import { ArrowRight, Download, Heart as HeartIcon, Laptop } from 'lucide-react'
import { freebies, getCategory } from '../data/catalog'
import { site } from '../data/site'
import type { CategoryId, IllustrationName } from '../data/types'
import { Heart } from '../components/illustrations/Objects'
import heroUti from '../assets/hero/uti.webp'
import heroBrainDump from '../assets/hero/brain-dump.webp'
import { InsertPage } from '../components/illustrations/InsertPage'
import { PageCluster } from '../components/illustrations/PageCluster'
import { DigitalLabel, ShipsLabel } from '../components/Labels'
import { BannerSlot } from '../components/Marketing'
import { openQuizPanel, useMarketing } from '../lib/marketing'
import { paragraphs, usePublishedStory, type PublicStory } from '../lib/story'
import { ProductArt } from '../components/ProductArt'
import { href } from '../lib/router'
import { useReveal } from '../lib/useReveal'
import { useUI } from '../lib/ui'
import { useCategoryOpen } from '../lib/store'
import './Home.css'

const benefitIcons = { download: Download, heart: HeartIcon, laptop: Laptop }

export function SectionHeading({ children, id }: { children: React.ReactNode; id?: string }) {
  return (
    <h2 className="section-heading" id={id}>
      <Heart className="heart" />
      <span>{children}</span>
      <Heart className="heart heart--flip" />
    </h2>
  )
}

function Hero() {
  const { open } = useUI()
  const { quiz } = useMarketing()
  return (
    <section className="hero" aria-labelledby="hero-title">
      <div className="hero__art" role="img" aria-label="Sample insert pages: a medication tracker, the Brain Dump Sheet, and the UTI Diagnosis and Treatment clinical guide from the NP binder inserts.">
        <div className="hero__backdrop" />
        <InsertPage className="hero__page hero__page--med" title="Medication" subtitle="Tracker" layout="table" fields={['Med', 'Dose', 'Time']} />
        <div className="hero__page hero__page--dump">
          <img className="hero__page-img" src={heroBrainDump} alt="" width={900} height={1165} decoding="async" />
        </div>
        {/* The front page floats gently (switched off for reduced motion). */}
        <div className="hero__tablet">
          <img className="hero__page-img hero__front" src={heroUti} alt="" width={900} height={1165} decoding="async" />
        </div>
      </div>
      <div className="container hero__inner">
        <div className="hero__text">
          <h1 id="hero-title" className="hero__title">
            <span className="hero-enter" style={{ '--i': 0 } as React.CSSProperties}>
              {site.hero.line1}
            </span>{' '}
            <em className="hero-enter" style={{ '--i': 1 } as React.CSSProperties}>
              {site.hero.line2}
            </em>
            <Heart className="hero__heart" strokeWidth={1.6} />
          </h1>
          <p className="hero__copy hero-enter" style={{ '--i': 2 } as React.CSSProperties}>
            {site.hero.copy}
          </p>
          <div className="hero__actions hero-enter" style={{ '--i': 3 } as React.CSSProperties}>
            <a className="button" href={href('shop')}>
              {site.hero.primary}
              <ArrowRight className="arrow" aria-hidden="true" size={20} />
            </a>
            <button
              type="button"
              className="button button--outline"
              onClick={() => (quiz ? openQuizPanel() : open({ kind: 'finder' }))}
              aria-haspopup="dialog"
            >
              {site.hero.secondary}
            </button>
          </div>
        </div>
      </div>
      <div className="container hero__label-wrap">
        <span className="label hero__label">{site.hero.label}</span>
      </div>
    </section>
  )
}

function Benefits() {
  return (
    <section className="benefits" aria-label="About our digital resources">
      <ul className="container benefits__list">
        {site.benefits.map((b) => {
          const Icon = benefitIcons[b.icon]
          return (
            <li key={b.title} className="benefit">
              <span className="benefit__icon" aria-hidden="true">
                <Icon strokeWidth={1.5} />
              </span>
              <span>
                <strong className="benefit__title">{b.title}</strong>
                <span className="benefit__text">{b.text}</span>
              </span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function CollectionCard({ id }: { id: 'nurse-inserts' | 'np-inserts' }) {
  const category = getCategory(id)
  return (
    <a className="collection-card" href={href(category.route)}>
      <span className="collection-card__media">
        <span className="collection-card__art">
          <PageCluster variant={id === 'np-inserts' ? 'np' : 'nurse'} />
        </span>
      </span>
      <span className="collection-card__body">
        <span className="collection-card__head">
          <h3 className="collection-card__title">{category.title}</h3>
          <DigitalLabel />
        </span>
        <span className="collection-card__text">{category.tagline}</span>
        <span className="button collection-card__button">
          {site.insertButton}
          <ArrowRight className="arrow" aria-hidden="true" size={20} />
        </span>
      </span>
    </a>
  )
}

function Collections() {
  const ref = useReveal<HTMLElement>()
  return (
    <section className="section collections" ref={ref} aria-labelledby="collections-title">
      <div className="container">
        <SectionHeading id="collections-title">{site.collectionsHeading}</SectionHeading>
        <div className="collections__grid">
          <CollectionCard id="nurse-inserts" />
          <CollectionCard id="np-inserts" />
        </div>
      </div>
    </section>
  )
}

function ExtraCute() {
  const ref = useReveal<HTMLElement>()
  const open = useCategoryOpen()
  // Only categories with something to order right now; the whole section steps aside when there are none.
  const cards = site.extraCards.filter((card) => open(card.category))
  if (!cards.length) return null
  return (
    <section className="section extra" ref={ref} aria-labelledby="extra-title">
      <div className="container">
        <SectionHeading id="extra-title">{site.extraHeading}</SectionHeading>
        <div className={`extra__grid extra__grid--${cards.length}`}>
          {cards.map((card) => {
            const category = getCategory(card.category as CategoryId)
            return (
              <a key={card.category} className="extra-card" href={href(category.route)}>
                <span className="extra-card__media">
                  <ProductArt image={{ kind: 'illustration', name: card.image as IllustrationName, alt: `Illustration for ${category.title}` }} />
                </span>
                <span className="extra-card__body">
                  <ShipsLabel />
                  <h3 className="extra-card__title">{category.title}</h3>
                  <span className="extra-card__text">{category.tagline}</span>
                  <span className="button button--outline button--small extra-card__button">
                    {card.button}
                    <ArrowRight className="arrow" aria-hidden="true" size={18} />
                  </span>
                </span>
              </a>
            )
          })}
        </div>
      </div>
    </section>
  )
}

/** A short founder introduction. Shown only once the owner publishes Our Story. */
function FounderIntro() {
  const { story } = usePublishedStory()
  return story ? <FounderIntroView story={story} /> : null
}

/** Exported for the admin preview. */
export function FounderIntroView({ story }: { story: PublicStory }) {
  return (
    <section className="section founder" aria-labelledby="founder-title">
      <div className="container founder__inner">
        {story.portraitUrl && <img className="founder__portrait" src={story.portraitUrl} alt={story.portraitAlt} loading="lazy" />}
        <div className="founder__text">
          <h2 id="founder-title" className="founder__title">
            Meet the nurse behind the love
          </h2>
          {paragraphs(story.homeExcerpt).map((t, i) => (
            <p key={i}>{t}</p>
          ))}
          <a className="button button--outline button--small" href={href('our-story')}>
            Meet the founder
            <ArrowRight className="arrow" aria-hidden="true" size={18} />
          </a>
        </div>
      </div>
    </section>
  )
}

function FreebieCorner() {
  const ref = useReveal<HTMLElement>()
  const { open } = useUI()
  const sample = freebies.find((f) => f.downloadable) ?? freebies[0]
  return (
    <section className="freebie" ref={ref} aria-labelledby="freebie-title">
      <div className="container freebie__inner">
        <div className="freebie__text">
          <Heart className="freebie__heart freebie__heart--a" />
          <h2 id="freebie-title" className="freebie__title">{site.freebie.heading}</h2>
          <p className="freebie__tagline">{site.freebie.tagline}</p>
          <p className="freebie__copy">{site.freebie.copy}</p>
          <a className="button" href={href('freebie-corner')}>
            {site.freebie.button}
            <ArrowRight className="arrow" aria-hidden="true" size={20} />
          </a>
        </div>
        <button type="button" className="freebie__sample" onClick={() => open({ kind: 'freebie', freebie: sample })} aria-haspopup="dialog">
          <span className="freebie__sample-page">
            <InsertPage title="Sample printable" layout="table" fields={['Task', 'Notes', 'Done']} script heart />
          </span>
          <span className="freebie__sample-cta">Preview the sample printable</span>
        </button>
      </div>
    </section>
  )
}

export function Home() {
  return (
    <>
      <Hero />
      <BannerSlot placement="below_hero" />
      <Benefits />
      <Collections />
      <ExtraCute />
      <FounderIntro />
      <BannerSlot placement="above_freebies" />
      <FreebieCorner />
    </>
  )
}
