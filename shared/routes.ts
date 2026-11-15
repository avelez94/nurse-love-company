/*
  Page addresses. Every page has a real path so search engines can index it:

    home                  /
    product-<slug>        /products/<slug>
    tutorial-<slug>       /tutorials/<slug>
    any other name        /<name>          (/shop, /np-binder-inserts, /account-downloads, ...)

  Route names are the same ones the site used before, when addresses were
  /#shop and /#product-<slug>. Those old links still work: the storefront
  turns them into the new address.
*/

/** The path for a route name, keeping any ?query (for example 'email-preferences?t=abc'). */
export function pathFor(route: string): string {
  const [name, query] = splitQuery(route)
  let path: string
  if (!name || name === 'home') path = '/'
  else if (name.startsWith('product-')) path = `/products/${name.slice('product-'.length)}`
  else if (name.startsWith('tutorial-')) path = `/tutorials/${name.slice('tutorial-'.length)}`
  else path = `/${name}`
  return query ? `${path}?${query}` : path
}

/** The route name for a path (no query). */
export function routeNameFor(pathname: string): string {
  const p = decodeURIComponent(pathname).replace(/\/+$/, '') || '/'
  if (p === '/') return 'home'
  const products = p.match(/^\/products\/([^/]+)$/)
  if (products) return `product-${products[1]}`
  const tutorials = p.match(/^\/tutorials\/([^/]+)$/)
  if (tutorials) return `tutorial-${tutorials[1]}`
  return p.slice(1)
}

function splitQuery(route: string): [string, string] {
  const i = route.indexOf('?')
  return i === -1 ? [route, ''] : [route.slice(0, i), route.slice(i + 1)]
}

/** Public pages worth listing for search engines (the rest are accounts, checkout and admin). */
export const STATIC_PUBLIC_ROUTES = ['home', 'shop', 'np-binder-inserts', 'nurse-binder-inserts', 'extra-cute', 'apparel', 'accessories', 'pens', 'freebie-corner', 'tutorials', 'our-story', 'help', 'terms', 'privacy'] as const

/** Paths search engines should skip: accounts, sign in, checkout, admin and one time links. */
export const PRIVATE_PATH_PREFIXES = ['/account', '/admin', '/sign-in', '/sign-up', '/forgot-password', '/reset-password', '/checkout-', '/email-preferences', '/api/']
