import { useEffect, useState } from 'react'
import { pathFor, routeNameFor } from '../../shared/routes'

/*
  Tiny router. Routes are plain names (shop, product-glaucoma). Each one has a
  real address (/shop, /products/glaucoma; see shared/routes.ts) so search
  engines can index every page. Old links like /#shop still work: they are
  turned into the new address. The single file preview build (artifact mode)
  has no server, so it keeps using #names.
*/
const HASH_MODE = import.meta.env?.MODE === 'artifact'

export type Route =
  | { name: 'home' }
  | { name: 'shop' }
  | { name: 'collection'; id: 'nurse-inserts' | 'np-inserts' }
  | { name: 'extra-cute'; tab: 'all' | 'apparel' | 'accessories' | 'pens' }
  | { name: 'freebies' }
  | { name: 'tutorials' }
  | { name: 'tutorial'; slug: string }
  | { name: 'story' }
  | { name: 'help' }
  | { name: 'policy'; key: 'terms' | 'privacy' }
  | { name: 'product'; slug: string }
  | { name: 'auth'; mode: 'sign-in' | 'sign-up' | 'forgot-password' | 'reset-password' | 'admin-setup'; token?: string; expired?: boolean }
  | { name: 'checkout'; result: 'success' | 'canceled'; free?: boolean }
  | { name: 'account'; view: AccountView; param?: string }
  | { name: 'admin'; view: AdminView; param?: string }
  | { name: 'email-preferences'; token: string }
  | { name: 'not-found'; hash: string }

export type AccountView = 'overview' | 'orders' | 'order' | 'downloads' | 'settings' | 'support' | 'review'
export type AdminView =
  | 'overview'
  | 'products'
  | 'product'
  | 'orders'
  | 'order'
  | 'customers'
  | 'customer'
  | 'emails'
  | 'email'
  | 'templates'
  | 'tutorials'
  | 'tutorial'
  | 'settings'
  | 'audit'
  | 'support'
  | 'marketing'
  | 'banner'
  | 'popup'
  | 'quizzes'
  | 'quiz'
  | 'reviews'
  | 'story'
  | 'automations'
  | 'help'
  | 'email-list'
  | 'policies'
  | 'printful'
  | 'coupons'

const accountViews: Record<string, AccountView> = { account: 'overview', 'account-orders': 'orders', 'account-downloads': 'downloads', 'account-settings': 'settings', 'account-support': 'support' }
const adminViews: Record<string, AdminView> = {
  admin: 'overview',
  'admin-products': 'products',
  'admin-orders': 'orders',
  'admin-customers': 'customers',
  'admin-emails': 'emails',
  'admin-email-templates': 'templates',
  'admin-tutorials': 'tutorials',
  'admin-settings': 'settings',
  'admin-audit': 'audit',
  'admin-support': 'support',
  'admin-marketing': 'marketing',
  'admin-nurse-kin': 'popup',
  'admin-quizzes': 'quizzes',
  'admin-reviews': 'reviews',
  'admin-our-story': 'story',
  'admin-email-automations': 'automations',
  'admin-help-faqs': 'help',
  'admin-email-list': 'email-list',
  'admin-policies': 'policies',
  'admin-printful': 'printful',
  'admin-coupons': 'coupons',
}
const adminDetail: Array<[string, AdminView]> = [
  ['admin-product-', 'product'],
  ['admin-order-', 'order'],
  ['admin-customer-', 'customer'],
  ['admin-email-', 'email'],
  ['admin-tutorial-', 'tutorial'],
  ['admin-banner-', 'banner'],
  ['admin-quiz-', 'quiz'],
  ['admin-policy-', 'policies'],
]

/**
 * `search` is the page's query string. The password reset email link returns
 * through the server, which puts the reset code there (/?token=...#reset-password)
 * rather than after the #.
 */
export function parseHash(raw: string, search = ''): Route {
  const [path, query = ''] = decodeURIComponent(raw.replace(/^#/, '')).split('?')
  const hash = path
  const params = new URLSearchParams(query)
  if (hash in accountViews) return { name: 'account', view: accountViews[hash] }
  if (hash.startsWith('account-order-')) return { name: 'account', view: 'order', param: hash.slice('account-order-'.length) }
  // From review request emails: opens that product's review form (after sign in if needed).
  if (hash.startsWith('account-review-')) return { name: 'account', view: 'review', param: hash.slice('account-review-'.length) }
  if (hash === 'email-preferences') return { name: 'email-preferences', token: params.get('t') ?? '' }
  if (hash in adminViews) return { name: 'admin', view: adminViews[hash] }
  for (const [prefix, view] of adminDetail) if (hash.startsWith(prefix)) return { name: 'admin', view, param: hash.slice(prefix.length) }
  switch (hash) {
    case 'sign-in':
    case 'sign-up':
    case 'forgot-password':
    case 'admin-setup':
      return { name: 'auth', mode: hash }
    case 'reset-password': {
      const outer = new URLSearchParams(search)
      const token = params.get('token') || outer.get('token') || undefined
      const expired = !token && (params.get('error') || outer.get('error')) === 'INVALID_TOKEN'
      return { name: 'auth', mode: 'reset-password', token, expired }
    }
    case 'checkout-success':
      return { name: 'checkout', result: 'success', free: params.get('free') === '1' }
    case 'checkout-canceled':
      return { name: 'checkout', result: 'canceled' }
    case '':
    case 'home':
      return { name: 'home' }
    case 'shop':
      return { name: 'shop' }
    case 'nurse-binder-inserts':
      return { name: 'collection', id: 'nurse-inserts' }
    case 'np-binder-inserts':
      return { name: 'collection', id: 'np-inserts' }
    case 'extra-cute':
      return { name: 'extra-cute', tab: 'all' }
    case 'apparel':
    case 'accessories':
    case 'pens':
      return { name: 'extra-cute', tab: hash }
    case 'freebie-corner':
      return { name: 'freebies' }
    case 'tutorials':
      return { name: 'tutorials' }
    case 'our-story':
      return { name: 'story' }
    case 'help':
      return { name: 'help' }
    case 'terms':
    case 'privacy':
      return { name: 'policy', key: hash }
  }
  if (hash.startsWith('tutorial-')) return { name: 'tutorial', slug: hash.slice('tutorial-'.length) }
  if (hash.startsWith('product-')) return { name: 'product', slug: hash.slice('product-'.length) }
  return { name: 'not-found', hash }
}

export function href(route: string): string {
  if (HASH_MODE) return route ? `#${route}` : '#home'
  return pathFor(route)
}

/** A stored link (banner, Our Story button): "#shop" style internal links become real addresses. */
export function linkHref(link: string): string {
  return link.startsWith('#') ? href(link.slice(1)) : link
}

const ROUTE_EVENT = 'nlc:route'

/** The current route name, with its ?query, for example 'account-downloads' or 'reset-password?token=abc'. */
export function currentRouteName(): string {
  if (HASH_MODE) return window.location.hash.slice(1) || 'home'
  const name = routeNameFor(window.location.pathname)
  return window.location.search ? `${name}${window.location.search}` : name
}

/** Turns an old /#name link into the new address. True when it did. */
function upgradeLegacyHash(): boolean {
  const raw = decodeURIComponent(window.location.hash.replace(/^#/, ''))
  if (!raw) return false
  const [name, hashQuery = ''] = raw.split('?')
  if (parseHash(name).name === 'not-found' && name !== '') return false
  const params = new URLSearchParams(window.location.search)
  new URLSearchParams(hashQuery).forEach((v, k) => params.set(k, v))
  const query = params.toString()
  window.history.replaceState(null, '', `${pathFor(name)}${query ? `?${query}` : ''}`)
  return true
}

function readRoute(): Route {
  if (HASH_MODE) return parseHash(window.location.hash, window.location.search)
  const name = routeNameFor(window.location.pathname)
  return parseHash(`#${name}${window.location.search}`, window.location.search)
}

export function navigate(route: string) {
  if (HASH_MODE) {
    const target = href(route)
    if (window.location.hash === target) {
      window.scrollTo({ top: 0 })
      return
    }
    window.location.hash = target
    return
  }
  const target = href(route)
  if (`${window.location.pathname}${window.location.search}` !== target) window.history.pushState(null, '', target)
  window.scrollTo({ top: 0 })
  window.dispatchEvent(new Event(ROUTE_EVENT))
}

/** Same site links open without reloading the page. */
function onLinkClick(e: MouseEvent) {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
  const a = (e.target as Element | null)?.closest?.('a')
  if (!a || (a.target && a.target !== '_self') || a.hasAttribute('download')) return
  const raw = a.getAttribute('href') ?? ''
  if (raw.startsWith('#')) {
    // An old style internal link (#shop). In page anchors (#main) are left alone.
    if (parseHash(raw).name === 'not-found') return
    e.preventDefault()
    navigate(raw.slice(1))
    return
  }
  const url = new URL(a.href, window.location.href)
  if (url.origin !== window.location.origin || url.pathname.startsWith('/api/')) return
  e.preventDefault()
  navigate(`${routeNameFor(url.pathname)}${url.search}`)
}

// Installed once for the whole page and never removed (several components use the route).
let linksInstalled = false
function installLinkHandler() {
  if (linksInstalled || HASH_MODE) return
  linksInstalled = true
  document.addEventListener('click', onLinkClick)
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => {
    if (!HASH_MODE) upgradeLegacyHash()
    return readRoute()
  })
  useEffect(() => {
    const onChange = () => {
      if (!HASH_MODE) upgradeLegacyHash()
      setRoute(readRoute())
    }
    window.addEventListener('hashchange', onChange)
    if (HASH_MODE) return () => window.removeEventListener('hashchange', onChange)
    window.addEventListener('popstate', onChange)
    window.addEventListener(ROUTE_EVENT, onChange)
    installLinkHandler()
    return () => {
      window.removeEventListener('hashchange', onChange)
      window.removeEventListener('popstate', onChange)
      window.removeEventListener(ROUTE_EVENT, onChange)
    }
  }, [])
  return route
}
