import { ServerUnavailable } from '../components/Unavailable'
import { Search, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { categories } from '../data/catalog'
import { useCategoryOpen, useStore } from '../lib/store'
import { site } from '../data/site'
import type { CategoryId } from '../data/types'
import { DigitalLabel } from '../components/Labels'
import { ProductCard } from '../components/ProductCard'
import { href } from '../lib/router'
import { PageHeader } from './PageHeader'

const filters: Array<{ id: CategoryId; label: string }> = [
  { id: 'nurse-inserts', label: 'Nurse Binder Inserts' },
  { id: 'np-inserts', label: 'Nurse Practitioner Binder Inserts' },
]


/* Digital shop: every downloadable resource, with collection filters and search. */
export function Shop() {
  const [selected, setSelected] = useState<CategoryId[]>([])
  const [query, setQuery] = useState('')
  const { products, status } = useStore()
  const categoryOpen = useCategoryOpen()
  // Only categories of items that ship with something to order right now; the box steps aside when there are none.
  const shipping = categories.filter((c) => c.type === 'physical' && categoryOpen(c.id))
  const all = useMemo(() => products.filter((p) => p.type === 'digital'), [products])

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    return all.filter(
      (p) =>
        (selected.length === 0 || selected.includes(p.category)) &&
        (!q || [p.title, p.summary, ...p.keywords].join(' ').toLowerCase().includes(q)),
    )
  }, [all, selected, query])

  const toggle = (id: CategoryId) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))
  const hasFilters = selected.length > 0 || query.trim() !== ''
  const clearAll = () => {
    setSelected([])
    setQuery('')
  }

  return (
    <>
      <PageHeader
        title={site.shopHeading}
        crumbs={[{ label: 'Home', route: 'home' }, { label: 'Shop' }]}
        intro={
          <>
            <p>Study resources and printable inserts for every step of your journey.</p>
            <DigitalLabel />
          </>
        }
      />
      <section className="container shop" aria-label="Digital resources">
        <div className="shop__controls">
          <div className="shop__search">
            <Search aria-hidden="true" size={18} />
            <label htmlFor="shop-search" className="visually-hidden">
              Search digital resources
            </label>
            <input id="shop-search" type="search" placeholder="Search digital resources" value={query} onChange={(e) => setQuery(e.target.value)} />
            {query && (
              <button type="button" className="icon-button" aria-label="Clear search" onClick={() => setQuery('')}>
                <X aria-hidden="true" size={18} />
              </button>
            )}
          </div>
          <div className="shop__filters" role="group" aria-label="Filter by collection">
            {filters.map((f) => (
              <button key={f.id} type="button" className="chip" aria-pressed={selected.includes(f.id)} onClick={() => toggle(f.id)}>
                {f.label}
              </button>
            ))}
            <button type="button" className="shop__clear" onClick={clearAll} disabled={!hasFilters}>
              Clear selected filters
            </button>
          </div>
        </div>
        <p className="shop__count" aria-live="polite">
          {status === 'loading' ? 'Loading resources...' : status === 'offline' && all.length === 0 ? '' : `Showing ${results.length} of ${all.length} resources`}
        </p>
        {status === 'offline' && all.length === 0 ? (
          <ServerUnavailable title="Products are on their way">This preview is not connected to the store yet, so there are no products to show. They will appear here once it is.</ServerUnavailable>
        ) : results.length > 0 ? (
          <div className="product-grid" key={selected.join() + query}>
            {results.map((p, i) => (
              <ProductCard key={p.id} product={p} style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }} />
            ))}
          </div>
        ) : (
          <div className="empty-state">
            <p className="empty-state__title">Nothing matches yet</p>
            <p className="muted">Try another word, or clear your filters to see every resource.</p>
            <div className="chip-row">
              <button type="button" className="button button--small" onClick={clearAll}>
                Clear selected filters
              </button>
              <a className="chip" href={href('freebie-corner')}>Visit The Freebie Corner</a>
            </div>
          </div>
        )}
        {shipping.length > 0 && (
          <aside className="shop__more">
            <p>Looking for something that ships?</p>
            <div className="chip-row">
              {shipping.map((c) => (
                  <a key={c.id} className="chip" href={href(c.route)}>
                    {c.title}
                  </a>
                ))}
            </div>
          </aside>
        )}
      </section>
    </>
  )
}
