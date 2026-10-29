import { categories, freebies, getCategory, products } from '../data/catalog'
import { getTutorialCategory, tutorials } from '../data/tutorials'

/* Local search across the sample catalog, freebies and site pages. */

export interface SearchResult {
  id: string
  kind: 'digital' | 'physical' | 'freebie' | 'tutorial' | 'page'
  title: string
  detail: string
  route: string
}

interface Entry extends SearchResult {
  haystack: string
}

const pageEntries: Entry[] = [
  { id: 'page-shop', kind: 'page', title: 'Shop digital resources', detail: 'All digital downloads', route: 'shop', haystack: 'shop digital downloads resources study inserts all' },
  ...categories.map<Entry>((c) => ({
    id: `page-${c.id}`,
    kind: 'page',
    title: c.title,
    detail: c.tagline,
    route: c.route,
    haystack: `${c.title} ${c.tagline} collection category`.toLowerCase(),
  })),
  { id: 'page-freebies', kind: 'page', title: 'The Freebie Corner', detail: 'Free printables', route: 'freebie-corner', haystack: 'freebie corner free printables downloads' },
  { id: 'page-tutorials', kind: 'page', title: 'Tutorials', detail: 'Free how to videos', route: 'tutorials', haystack: 'tutorials videos how to help setup watch' },
  { id: 'page-story', kind: 'page', title: 'Our Story', detail: 'Made by a nurse, for nurses.', route: 'our-story', haystack: 'our story about founder nurse' },
  { id: 'page-help', kind: 'page', title: 'Help & contact', detail: 'Questions and contact', route: 'help', haystack: 'help contact questions faq support' },
]

const entries: Entry[] = [
  ...products.map<Entry>((p) => ({
    id: p.id,
    kind: p.type,
    title: p.title,
    detail: getCategory(p.category).title,
    route: `product-${p.slug}`,
    haystack: [p.title, p.summary, getCategory(p.category).title, p.audience, ...p.keywords].join(' ').toLowerCase(),
  })),
  ...freebies.map<Entry>((f) => ({
    id: f.id,
    kind: 'freebie',
    title: f.title,
    detail: 'The Freebie Corner',
    route: 'freebie-corner',
    haystack: [f.title, f.summary, ...f.keywords].join(' ').toLowerCase(),
  })),
  ...tutorials.map<Entry>((t) => ({
    id: t.id,
    kind: 'tutorial',
    title: t.title,
    detail: `Tutorial • ${getTutorialCategory(t.category).title}`,
    route: `tutorial-${t.slug}`,
    haystack: [t.title, t.summary, getTutorialCategory(t.category).title, 'tutorial video how to', ...t.keywords].join(' ').toLowerCase(),
  })),
  ...pageEntries,
]

export function search(query: string): SearchResult[] {
  const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean)
  if (terms.length === 0) return []
  return entries
    .map((e) => {
      const title = e.title.toLowerCase()
      let score = 0
      for (const t of terms) {
        if (!e.haystack.includes(t) && !title.includes(t)) return null
        score += title.startsWith(t) ? 3 : title.includes(t) ? 2 : 1
      }
      return { e, score }
    })
    .filter((x): x is { e: Entry; score: number } => x !== null)
    .sort((a, b) => b.score - a.score)
    .map(({ e }) => ({ id: e.id, kind: e.kind, title: e.title, detail: e.detail, route: e.route }))
}

export const searchSuggestions = ['planner', 'NP', 'glaucoma', 'earrings', 'pens']
