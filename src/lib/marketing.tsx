import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { QuizContent } from '../../shared/quiz'
import type { Route } from './router'

/*
  Live banners, the Nurse Kin launcher and the resource quiz, as published
  by the owner. If the store server is unavailable nothing is shown.
  Visitor memory lives only in this browser: a closed banner stays closed
  until the owner chooses "Show again to visitors who closed it", and quiz
  progress is kept for the current browsing session only. Browser memory
  cannot follow a visitor to another device.
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

/** The Nurse Kin launcher. Visitors open it themselves; it never opens automatically. */
export interface PublicPopup {
  launcherLabel: string
  headline: string
  body: string
  ctaLabel: string
  url: string
  image: { url: string; alt: string } | null
  theme: Theme
  version: number
}

/** The published resource quiz, with only products that are public right now. */
export interface PublicQuiz {
  id: string
  version: number
  content: QuizContent
  products: Array<{ id: string; slug: string; title: string; type: string; priceCents: number | null; salePriceCents: number | null; imageUrl: string | null }>
  tutorials: Array<{ id: string; slug: string; title: string }>
}

interface MarketingValue {
  banners: PublicBanner[]
  popup: PublicPopup | null
  quiz: PublicQuiz | null
}

const Ctx = createContext<MarketingValue>({ banners: [], popup: null, quiz: null })

const getJson = (url: string) =>
  fetch(url, { credentials: 'same-origin' })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null)

export function MarketingProvider({ children }: { children: ReactNode }) {
  const [value, setValue] = useState<MarketingValue>({ banners: [], popup: null, quiz: null })
  useEffect(() => {
    let alive = true
    void Promise.all([getJson('/api/marketing'), getJson('/api/quiz')]).then(([m, qz]) => {
      if (!alive) return
      setValue({ banners: Array.isArray(m?.banners) ? m.banners : [], popup: m?.popup ?? null, quiz: qz?.quiz ?? null })
    })
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

/** Opens the resource quiz panel (used by the home page "Find your essentials" button). */
export const openQuizPanel = () => window.dispatchEvent(new CustomEvent('nlc:open-quiz'))

/** Aggregate quiz counts only: answers are never sent. */
export function sendQuizEvent(quizId: string, version: number, event: 'start' | 'complete' | 'product_click') {
  void fetch('/api/quiz/events', {
    method: 'POST',
    credentials: 'same-origin',
    keepalive: true,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ quiz_id: quizId, version, event }),
  }).catch(() => {})
}
