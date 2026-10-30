import { Download, ExternalLink, Gift, Heart as HeartIcon, Sparkles, Star, Tag, Truck, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { site } from '../data/site'
import {
  appliesTo,
  bannerDismissKey,
  isBannerDismissed,
  isExternal,
  pageKey,
  sendMarketingEvent,
  useMarketing,
  writeStore,
  type IconName,
  type PublicBanner,
} from '../lib/marketing'
import { useRoute, type Route } from '../lib/router'
import { Heart } from './illustrations/Objects'
import './Marketing.css'

const icons: Record<Exclude<IconName, 'none'>, typeof Gift> = { heart: HeartIcon, sparkles: Sparkles, gift: Gift, download: Download, truck: Truck, star: Star, tag: Tag }

function BannerIcon({ name }: { name: IconName }) {
  if (name === 'none') return null
  const I = icons[name]
  return <I className="promo__icon" size={18} aria-hidden="true" />
}

/** A banner's link: internal pages stay in the tab, https addresses open a new tab and say so. */
function BannerLink({ banner, className, preview, onClick }: { banner: Pick<PublicBanner, 'link' | 'buttonLabel'>; className: string; preview?: boolean; onClick?: () => void }) {
  if (!banner.link || !banner.buttonLabel) return null
  const external = isExternal(banner.link)
  return (
    <a
      className={className}
      href={banner.link}
      {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
      onClick={(e) => {
        if (preview) e.preventDefault()
        else onClick?.()
      }}
    >
      {banner.buttonLabel}
      {external && (
        <>
          <ExternalLink size={14} aria-hidden="true" />
          <span className="visually-hidden"> (opens in a new tab)</span>
        </>
      )}
    </a>
  )
}

function endsText(endsAt: string | null) {
  if (!endsAt) return ''
  return `Offer ends ${new Date(endsAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`
}

/** The slim top bar. Replaces the brand line while live; the brand line stays in the footer. */
export function AnnouncementView({ banner, preview, onDismiss, onClick }: { banner: PublicBanner; preview?: boolean; onDismiss?: () => void; onClick?: () => void }) {
  return (
    <div className={`promo-bar promo-theme--${banner.theme}`} role="region" aria-label="Store announcement">
      <p className="promo-bar__text">
        <BannerIcon name={banner.icon} />
        <span>{banner.headline}</span>
        {banner.couponCode && (
          <span className="promo-bar__code">
            Code <strong>{banner.couponCode}</strong>
          </span>
        )}
        <BannerLink banner={banner} className="promo-bar__link" preview={preview} onClick={onClick} />
      </p>
      {banner.couponOffer && <p className="promo-bar__fine">{banner.couponOffer} {endsText(banner.endsAt)}</p>}
      {banner.dismissible && (
        <button type="button" className="promo-bar__close" aria-label="Close announcement" onClick={onDismiss}>
          <X size={16} aria-hidden="true" />
        </button>
      )}
    </div>
  )
}

/** Promotional strip or image and text banner. Uses container queries so admin previews show the real phone layout. */
export function PromoView({ banner, preview, onDismiss, onClick, imageUrl }: { banner: PublicBanner; preview?: boolean; onDismiss?: () => void; onClick?: () => void; imageUrl?: string | null }) {
  const img = imageUrl !== undefined ? (imageUrl ? { url: imageUrl, alt: banner.image?.alt ?? '' } : null) : banner.image
  return (
    <div className="promo-wrap">
      <section className={`promo promo--${banner.style} promo-theme--${banner.theme} ${img ? 'promo--has-image' : ''}`} aria-label={banner.headline || 'Promotion'}>
        {img && (
          <div className="promo__media">
            <img src={img.url} alt={img.alt} loading="lazy" />
          </div>
        )}
        <div className="promo__copy">
          <h2 className="promo__headline">
            <BannerIcon name={banner.icon} />
            {banner.headline}
          </h2>
          {banner.body && <p className="promo__body">{banner.body}</p>}
          {banner.couponCode && (
            <p className="promo__coupon">
              <span className="promo__code">{banner.couponCode}</span>
              <span>
                {banner.couponOffer} {endsText(banner.endsAt)}
              </span>
            </p>
          )}
          <BannerLink banner={banner} className="button promo__button" preview={preview} onClick={onClick} />
        </div>
        {banner.dismissible && (
          <button type="button" className="promo__close" aria-label={`Close: ${banner.headline}`} onClick={onDismiss}>
            <X size={18} aria-hidden="true" />
          </button>
        )}
      </section>
    </div>
  )
}

/** Reports a view once the banner is actually on screen (once per browser session). */
function useViewed(banner: PublicBanner | undefined) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!banner || !el || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          sendMarketingEvent('banner', banner.id, banner.dismissVersion, 'view')
          io.disconnect()
        }
      },
      { threshold: 0.5 },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [banner])
  return ref
}

/** One banner per placement: the first (highest priority) that applies to this page and was not closed here. */
function useBannerFor(placement: PublicBanner['placement'], route: Route) {
  const { banners } = useMarketing()
  const page = pageKey(route)
  const candidate = banners.find((b) => b.placement === placement && appliesTo(b.pages, page))
  const [closed, setClosed] = useState(false)
  useEffect(() => setClosed(candidate ? isBannerDismissed(candidate) : false), [candidate])
  const dismiss = () => {
    if (!candidate) return
    writeStore('local', bannerDismissKey(candidate.id), String(candidate.dismissVersion))
    sendMarketingEvent('banner', candidate.id, candidate.dismissVersion, 'dismiss')
    setClosed(true)
  }
  return { banner: candidate && !closed ? candidate : undefined, dismiss }
}

/** The strip above the header: a live announcement, or the brand line. */
export function HeaderAnnouncement({ route }: { route: Route }) {
  const { banner, dismiss } = useBannerFor('top', route)
  const ref = useViewed(banner)
  if (banner) {
    return (
      <div ref={ref}>
        <AnnouncementView banner={banner} onDismiss={dismiss} onClick={() => sendMarketingEvent('banner', banner.id, banner.dismissVersion, 'click')} />
      </div>
    )
  }
  return (
    <div className="announcement">
      <p className="announcement__text">
        <Heart className="announcement__heart" />
        {site.statement}
        <Heart className="announcement__heart" />
      </p>
    </div>
  )
}

/** A strip or image banner slot on the home page. */
export function BannerSlot({ placement }: { placement: 'below_hero' | 'above_freebies' }) {
  const route = useRoute()
  const { banner, dismiss } = useBannerFor(placement, route)
  const ref = useViewed(banner)
  if (!banner) return null
  return (
    <div ref={ref} className="container promo-slot">
      <PromoView banner={banner} onDismiss={dismiss} onClick={() => sendMarketingEvent('banner', banner.id, banner.dismissVersion, 'click')} />
    </div>
  )
}
