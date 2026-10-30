import { ArrowRight } from 'lucide-react'
import { getCategory } from '../data/catalog'
import { useStore } from '../lib/store'
import { DigitalLabel } from '../components/Labels'
import { ProductCard } from '../components/ProductCard'
import { href } from '../lib/router'
import { PageHeader } from './PageHeader'

export function Collection({ id }: { id: 'nurse-inserts' | 'np-inserts' }) {
  const category = getCategory(id)
  const other = getCategory(id === 'nurse-inserts' ? 'np-inserts' : 'nurse-inserts')
  const { productsIn } = useStore()
  const list = productsIn(id)
  return (
    <>
      <PageHeader
        title={category.title}
        crumbs={[{ label: 'Home', route: 'home' }, { label: 'Shop', route: 'shop' }, { label: category.title }]}
        intro={
          <>
            <p>{category.tagline}</p>
            <DigitalLabel />
            <p className="muted page-header__small">Inserts only. Use them with your own binder or digitally where a resource says so.</p>
          </>
        }
      />
      <section className="container shop" aria-label={`${category.title} resources`}>
        <p className="shop__count">{list.length} {list.length === 1 ? 'resource' : 'resources'}</p>
        <div className="product-grid">
          {list.map((p, i) => (
            <ProductCard key={p.id} product={p} style={{ animationDelay: `${i * 40}ms` }} />
          ))}
        </div>
        <div className="collection-next">
          <a className="arrow-link" href={href(other.route)}>
            Explore {other.title} <ArrowRight className="arrow" aria-hidden="true" size={18} />
          </a>
          <a className="arrow-link" href={href('shop')}>
            Browse all digital resources <ArrowRight className="arrow" aria-hidden="true" size={18} />
          </a>
        </div>
      </section>
    </>
  )
}
