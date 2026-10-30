import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Route } from './router'

/*
  Live banners and the Nurse Kin popup, as published by the owner. If the
  store server is unavailable nothing is shown. Visitor memory (closed
  banners, popup frequency) lives only in this browser:
  * A closed banner stays closed in this browser until the owner chooses
    "Show again to visitors who closed it" (a new dismissal version).
  * The popup shows at most once per browser session. After "Maybe later" or
    closing it, it waits the owner's chosen number of days; after a click
    through to Nurse Kin it does not show again in this browser until the
    owner starts a new campaign version.
  Browser memory cannot follow a visitor to another device, and it resets
  when they clear their browsing data or use a private window.
*/

export type Theme = 'blush' | 'raspberry' | 'ivory' | 'sage'
export type IconName = 'none' | 'heart' | 'sparkles' | 'gift' | 'download' | 'truck' | 'star' | 'tag'

export interface PublicBanner {
  id: string
  style: 'announcement' | 'strip' | 'image'
  placement: 'top' | 'below_hero' | 'above_freebies'
  headline: string
  body: string
  buttonLabel: string
  link: string
  image: { url: string; alt: string } | null
  theme: Theme
  icon: IconName
  couponCode: string
  couponOffer: string
  endsAt: string | null
  pages: string[]
  dismissible: boolean
  dismissVersion: number
}

export interface PublicPopup {
  headline: string
  body: string
  ctaLabel: string
  url: string
  image: { url: string; alt: string } | null
  theme: Theme
  delaySeconds: number
  scrollPercent: number
  suppressDays: number
  pages: string[]
  version: number
}

interface MarketingValue {
  banners: PublicBanner[]
  popup: PublicPopup | null
}

const Ctx = createContext<MarketingValue>({ banners: [], popup: null })

export function MarketingProvider({ children }: { children: ReactNode }) {
  const [value, setValue] = useState<MarketingValue>({ banners: [], popup: null })
  useEffect(() => {
    let alive = true
    fetch('/api/marketing', { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (alive && d && Array.isArray(d.banners)) setValue({ banners: d.banners, popup: d.popup ?? null })
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export const useMarketing = () => useContext(Ctx)

/** Which public page a route is, for banner and popup page rules. Null means never show marketing here. */
export function pageKey(route: Route): string | null {
  switch (route.name) {
    case 'home':
      return 'home'
    case 'shop':
      return 'shop'
    case 'collection':
      return 'collections'
    case 'extra-cute':
      return 'extra'
    case 'freebies':
      return 'freebies'
    case 'tutorials':
    case 'tutorial':
      return 'tutorials'
    case 'product':
      return 'product'
    case 'story':
      return 'story'
    case 'help':
      return 'help'
    default:
      // Sign in, account recovery, checkout, accounts, admin and missing pages.
      return null
  }
}

export const appliesTo = (pages: string[], page: string | null) => page !== null && (pages.includes('all') || pages.includes(page))

/* Browser storage. Every access is guarded: private windows and blocked storage simply show content again. */
export function readStore(kind: 'local' | 'session', key: string): string | null {
  try {
    return (kind === 'local' ? localStorage : sessionStorage).getItem(key)
  } catch {
    return null
  }
}
export function writeStore(kind: 'local' | 'session', key: string, value: string) {
  try {
    ;(kind === 'local' ? localStorage : sessionStorage).setItem(key, value)
  } catch {
    /* storage unavailable */
  }
}

export const bannerDismissKey = (id: string) => `nlc-banner-closed:${id}`
export const isBannerDismissed = (b: PublicBanner) => readStore('local', bannerDismissKey(b.id)) === String(b.dismissVersion)

/** Aggregate counts only. Never sent from previews. */
export function sendMarketingEvent(kind: 'banner' | 'popup', id: string, version: number, event: 'view' | 'click' | 'dismiss') {
  if (event === 'view') {
    const seen = `nlc-seen:${kind}:${id}:${version}`
    if (readStore('session', seen)) return
    writeStore('session', seen, '1')
  }
  void fetch('/api/marketing/events', {
    method: 'POST',
    credentials: 'same-origin',
    keepalive: true,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ kind, id, version, event }),
  }).catch(() => {})
}

/** Internal links (#shop) stay in the tab; https links open a new tab. */
export const isExternal = (link: string) => /^https:\/\//.test(link)
