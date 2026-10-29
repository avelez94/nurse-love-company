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
  | { name: 'not-found'; hash: string }

export function parseHash(raw: string): Route {
  const hash = decodeURIComponent(raw.replace(/^#/, ''))
  switch (hash) {
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
