import { useEffect, useState } from 'react'

/*
  Tiny hash router. Routes are plain names (#shop, #product-glaucoma) so links
  work on any static host, including the hosted preview, with no server setup.
*/

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
  | { name: 'product'; slug: string }
  | { name: 'auth'; mode: 'sign-in' | 'sign-up' | 'forgot-password' | 'reset-password' | 'admin-setup'; token?: string }
  | { name: 'checkout'; result: 'success' | 'canceled' }
  | { name: 'account'; view: AccountView; param?: string }
  | { name: 'admin'; view: AdminView; param?: string }
  | { name: 'not-found'; hash: string }

export type AccountView = 'overview' | 'orders' | 'order' | 'downloads' | 'settings' | 'support'
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
}
const adminDetail: Array<[string, AdminView]> = [
  ['admin-product-', 'product'],
  ['admin-order-', 'order'],
  ['admin-customer-', 'customer'],
  ['admin-email-', 'email'],
  ['admin-tutorial-', 'tutorial'],
]

export function parseHash(raw: string): Route {
  const [path, query = ''] = decodeURIComponent(raw.replace(/^#/, '')).split('?')
  const hash = path
  const params = new URLSearchParams(query)
  if (hash in accountViews) return { name: 'account', view: accountViews[hash] }
  if (hash.startsWith('account-order-')) return { name: 'account', view: 'order', param: hash.slice('account-order-'.length) }
  if (hash in adminViews) return { name: 'admin', view: adminViews[hash] }
  for (const [prefix, view] of adminDetail) if (hash.startsWith(prefix)) return { name: 'admin', view, param: hash.slice(prefix.length) }
  switch (hash) {
    case 'sign-in':
    case 'sign-up':
    case 'forgot-password':
    case 'admin-setup':
      return { name: 'auth', mode: hash }
    case 'reset-password':
      return { name: 'auth', mode: 'reset-password', token: params.get('token') ?? undefined }
    case 'checkout-success':
      return { name: 'checkout', result: 'success' }
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
  }
  if (hash.startsWith('tutorial-')) return { name: 'tutorial', slug: hash.slice('tutorial-'.length) }
  if (hash.startsWith('product-')) return { name: 'product', slug: hash.slice('product-'.length) }
  return { name: 'not-found', hash }
}

export function href(route: string): string {
  return route ? `#${route}` : '#home'
}

export function navigate(route: string) {
  const target = href(route)
  if (window.location.hash === target) {
    window.scrollTo({ top: 0 })
    return
  }
  window.location.hash = target
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseHash(window.location.hash))
  useEffect(() => {
    const onChange = () => setRoute(parseHash(window.location.hash))
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  return route
}
