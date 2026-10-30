import { ServerUnavailable } from '../components/Unavailable'
import { categories } from '../data/catalog'
import { useStore } from '../lib/store'
import { site } from '../data/site'
import type { CategoryId } from '../data/types'
import { ShipsLabel } from '../components/Labels'
import { ProductCard } from '../components/ProductCard'
import { href } from '../lib/router'
import { PageHeader } from './PageHeader'

type Tab = 'all' | 'apparel' | 'accessories' | 'pens'

const tabs: Array<{ id: Tab; label: string; route: string }> = [
  { id: 'all', label: 'All', route: 'extra-cute' },
  { id: 'apparel', label: 'Apparel', route: 'apparel' },
  { id: 'accessories', label: 'Accessories', route: 'accessories' },
  { id: 'pens', label: 'Pens', route: 'pens' },
]

/* Physical merchandise. Kept separate from digital downloads. */
export function ExtraCute({ tab }: { tab: Tab }) {
  const { productsIn, status } = useStore()
  const category = tab === 'all' ? null : categories.find((c) => c.id === tab)
  const list = tab === 'all' ? productsIn('apparel', 'accessories', 'pens', 'other').filter((p) => p.type === 'physical') : productsIn(tab as CategoryId)
  return (
    <>
      <PageHeader
        title={category ? category.title : site.extraHeading}
        crumbs={[{ label: 'Home', route: 'home' }, { label: 'Shop', route: 'shop' }, ...(category ? [{ label: site.extraHeading, route: 'extra-cute' }, { label: category.title }] : [{ label: site.extraHeading }])]}
        intro={
          <>
            <p>{category ? category.tagline : 'Physical favorites for your nursing life.'}</p>
            <ShipsLabel />
          </>
        }
      />
      <section className="container shop" aria-label="Physical favorites">
        <nav className="tabs" aria-label="Physical categories">
          {tabs.map((t) => (
            <a key={t.id} className="chip" href={href(t.route)} aria-current={t.id === tab ? 'page' : undefined}>
              {t.label}
            </a>
          ))}
        </nav>
        {status !== 'offline' && <p className="shop__count">{list.length} {list.length === 1 ? 'item' : 'items'}</p>}
        {status === 'offline' && list.length === 0 ? (
          <ServerUnavailable title="Items are on their way">This preview is not connected to the store yet, so there are no items to show. They will appear here once it is.</ServerUnavailable>
        ) : list.length > 0 ? (
          <div className="product-grid" key={tab}>
            {list.map((p, i) => (
              <ProductCard key={p.id} product={p} style={{ animationDelay: `${i * 40}ms` }} />
            ))}
          </div>
        ) : (
          <div className="empty-state">
            <p className="empty-state__title">No items in this category yet</p>
            <p className="muted">Try another category above.</p>
          </div>
        )}
        <p className="muted shop__fineprint">Photos, sizes, colors, prices and shipping details will be added before launch.</p>
      </section>
    </>
  )
}
