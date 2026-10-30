import { ArrowRight, ExternalLink, FileText, Heart, PenLine } from 'lucide-react'
import type { Product } from '../data/types'
import { ProductCard } from '../components/ProductCard'
import { href } from '../lib/router'
import { useStore } from '../lib/store'
import { paragraphs, usePublishedStory, type PublicStory } from '../lib/story'
import { showNurseKin } from '../../shared/story'
import { PageHeader } from './PageHeader'
import './OurStory.css'

/*
  Our Story: a little handwritten welcome from the founder. Every word comes
  from the owner's published content; sections she leaves empty are left out.
  Decorations are drawn in CSS and hidden from screen readers.
*/

const icons = [FileText, Heart, PenLine]

/** A loose, hand drawn heart beside the page heading. */
function DrawnHeart({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 40 36" aria-hidden="true" focusable="false">
      <path d="M20 31C11 24.5 4.5 18.6 5.2 11.6 5.8 6.2 11.6 3.9 15.8 6.6c2 1.3 3.4 3.3 4 5.2.9-2.4 2.6-4.6 5.1-5.7 4.6-2 9.6.8 9.7 6 .1 6.6-6.3 12.6-14.6 18.9" />
      <path d="M20.6 31.4c1.6 1.2 3.4 1.6 5 1.1" />
    </svg>
  )
}

const shopHref = (link: string) => (link.startsWith('#') ? href(link.slice(1)) : link || href('shop'))

/** Up to three of her chosen favorites, in her order, among products currently for sale. */
export function useFavorites(ids: string[]): Product[] {
  const { products } = useStore()
  return ids.map((id) => products.find((p) => p.id === id)).filter((p): p is Product => Boolean(p))
}

/** The page body. Exported so the admin preview shows exactly the public layout. */
export function StoryView({ story, favorites }: { story: PublicStory; favorites: Product[] }) {
  const role = [story.professionalTitle, story.credentials].filter(Boolean).join(', ')
  const hasStore = Boolean(story.storeHeading || story.storeIntro)
  const features = story.features.filter((f) => f.heading || f.text)
  const more: Array<[string, string]> = story.showFullStory
    ? (
        [
          ['Nursing background', story.background],
          ['Why Nurse Love Company began', story.whyCreated],
          ['How each resource is made', story.process],
          ['Who we hope to support', story.whoWeSupport],
        ] as Array<[string, string]>
      ).filter(([, t]) => t.trim())
    : []
  // The earlier closing message stands in only while the new one is empty.
  const closing = story.closingNote || story.closing
  return (
    <div className="os">
      <div className={`os-intro${hasStore ? '' : ' os-intro--solo'}`}>
        <section className="os-founder" aria-labelledby="os-founder-name">
          {story.portraitUrl && (
            <div className="os-photo">
              <figure className="os-frame">
                <span className="os-tape" aria-hidden="true" />
                <img src={story.portraitUrl} alt={story.portraitAlt} />
              </figure>
              {story.greeting && <p className="os-bubble">{story.greeting}</p>}
            </div>
          )}
          <div className="os-founder__text">
            <h2 id="os-founder-name" className="os-name">
              Meet {story.founderName}
            </h2>
            {role && <p className="os-role">{role}</p>}
            {paragraphs(story.introduction).map((t, i) => (
              <p key={i}>{t}</p>
            ))}
          </div>
        </section>

        {hasStore && (
          <section className="os-store" aria-labelledby="os-store-title">
            <p className="eyebrow">About the store</p>
            {story.storeHeading && (
              <h2 id="os-store-title" className="os-store__title">
                {story.storeHeading}
              </h2>
            )}
            {paragraphs(story.storeIntro).map((t, i) => (
              <p key={i}>{t}</p>
            ))}
            {story.shopLabel && (
              <a className="button os-store__cta" href={shopHref(story.shopLink)}>
                {story.shopLabel}
                <ArrowRight className="arrow" aria-hidden="true" size={20} />
              </a>
            )}
          </section>
        )}
      </div>

      {features.length > 0 && (
        <ul className="os-features" aria-label="What you will find here">
          {features.map((f, i) => {
            const Icon = icons[i % icons.length]
            return (
              <li key={i} className="os-feature">
                <span className="os-feature__icon" aria-hidden="true">
                  <Icon size={22} strokeWidth={1.75} />
                </span>
                {f.heading && <h3 className="os-feature__title">{f.heading}</h3>}
                {f.text && <p>{f.text}</p>}
              </li>
            )
          })}
        </ul>
      )}

      {more.length > 0 && (
        <section className="os-more" aria-labelledby="os-more-title">
          <h2 id="os-more-title" className="os-section-title">
            More of my story
          </h2>
          <div className="os-more__grid">
            {more.map(([heading, text]) => (
              <section key={heading} className="os-more__card">
                <h3 className="os-more__heading">{heading}</h3>
                {paragraphs(text).map((t, i) => (
                  <p key={i}>{t}</p>
                ))}
              </section>
            ))}
          </div>
        </section>
      )}

      {favorites.length > 0 && (
        <section className="os-favs" aria-labelledby="os-favs-title">
          <h2 id="os-favs-title" className="os-section-title">
            A few of my favorites
          </h2>
          <div className="product-grid os-favs__grid">
            {favorites.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        </section>
      )}

      {(closing || story.signature) && (
        <section className="os-note" aria-label={`A note from ${story.founderName}`}>
          {paragraphs(closing).map((t, i) => (
            <p key={i} className="os-note__text">
              {t}
            </p>
          ))}
          {story.signature && (
            <p className="os-signature">
              {story.signature}
              {!/[♡♥❤]/.test(story.signature) && (
                <svg className="os-signature__heart" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                  <path pathLength={1} d="M12 20.5s-8.5-5.1-8.5-11a4.7 4.7 0 0 1 8.5-2.8 4.7 4.7 0 0 1 8.5 2.8c0 5.9-8.5 11-8.5 11z" />
                </svg>
              )}
            </p>
          )}
        </section>
      )}

      {showNurseKin(story) && (
        <aside className="os-kin" aria-labelledby="os-kin-title">
          <h2 id="os-kin-title" className="os-kin__title">
            Nurse Kin
          </h2>
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

export function StoryHeader() {
  return (
    <PageHeader
      title="Meet the nurse behind the love"
      titleAccent={<DrawnHeart className="os-heading-heart" />}
      crumbs={[{ label: 'Home', route: 'home' }, { label: 'Our Story' }]}
      intro={<p className="os-subtitle">A little introduction to the heart behind Nurse Love Company.</p>}
    />
  )
}

export function Story() {
  const { story } = usePublishedStory()
  const favorites = useFavorites(story?.favoriteIds ?? [])
  return (
    <>
      <StoryHeader />
      <section className="container os-page">
        {story ? (
          <StoryView story={story} favorites={favorites} />
        ) : (
          <div className="story__card">
            <Heart className="story__heart" aria-hidden="true" />
            <p>
              Nurse Love Company creates study resources, printable inserts and everyday favorites for nurses and nursing students, with a separate path for nurse practitioner
              students.
            </p>
            <p>Every digital resource is made to support your nursing life, and every physical favorite is chosen to add a little extra cute to your day.</p>
          </div>
        )}
        {!story?.shopLabel && (
          <div className="chip-row story__links">
            <a className="button button--small" href={href('shop')}>
              Shop resources <ArrowRight className="arrow" aria-hidden="true" size={18} />
            </a>
            <a className="chip" href={href('freebie-corner')}>
              The Freebie Corner
            </a>
          </div>
        )}
      </section>
    </>
  )
}
