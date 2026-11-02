import { HeaderAnnouncement } from './Marketing'
import { Menu, Search, ShoppingBag, User } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { site } from '../data/site'
import { useCart } from '../lib/cart'
import { useCategoryOpen } from '../lib/store'
import { useSession } from '../lib/session'
import { href, type Route } from '../lib/router'
import { useUI } from '../lib/ui'
import { Dialog } from './Dialog'
import { Wordmark } from './Wordmark'
import './Header.css'

function isActive(route: Route, target: string) {
  if (target === 'shop') return route.name === 'shop' || route.name === 'collection' || route.name === 'extra-cute' || route.name === 'product'
  if (target === 'freebie-corner') return route.name === 'freebies'
  if (target === 'tutorials') return route.name === 'tutorials' || route.name === 'tutorial'
  if (target === 'our-story') return route.name === 'story'
  return false
}

export function Header({ route }: { route: Route }) {
  const { open, overlay, close } = useUI()
  const { count, bump } = useCart()
  const { user } = useSession()
  const categoryOpen = useCategoryOpen()
  const [bumping, setBumping] = useState(false)
  const first = useRef(true)

  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    setBumping(true)
    const t = window.setTimeout(() => setBumping(false), 450)
    return () => window.clearTimeout(t)
  }, [bump])

  return (
    <>
      <HeaderAnnouncement route={route} />
      <header className="site-header">
        <div className="container site-header__inner">
          <button type="button" className="icon-button site-header__menu" aria-label="Open menu" onClick={() => open({ kind: 'menu' })}>
            <Menu aria-hidden="true" size={24} />
          </button>
          <a className="site-header__brand" href={href('home')} aria-label="Nurse Love Company home">
            <Wordmark />
          </a>
          <nav className="site-nav" aria-label="Main">
            <ul>
              {site.nav.map((item) => (
                <li key={item.route}>
                  <a href={href(item.route)} aria-current={isActive(route, item.route) ? 'page' : undefined}>
                    {item.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
          <div className="site-header__tools">
            <button type="button" className="search-trigger" onClick={() => open({ kind: 'search' })}>
              <Search aria-hidden="true" size={18} />
              <span className="search-trigger__text">{site.searchPlaceholder}</span>
              <span className="visually-hidden">Open search</span>
            </button>
            <button type="button" className="icon-button search-trigger--icon" aria-label="Search" onClick={() => open({ kind: 'search' })}>
              <Search aria-hidden="true" size={22} />
            </button>
            <a className="icon-button site-header__account" href={href(user ? (user.role === 'admin' ? 'admin' : 'account') : 'sign-in')} aria-label={user ? (user.role === 'admin' ? 'Store admin' : 'My account') : 'Sign in'} title={user ? 'My account' : 'Sign in'}>
              <User aria-hidden="true" size={22} />
            </a>
            <button
              type="button"
              className={`icon-button bag-button ${bumping ? 'is-bumping' : ''}`}
              aria-label={`Bag, ${count} ${count === 1 ? 'item' : 'items'}`}
              onClick={() => open({ kind: 'bag' })}
            >
              <ShoppingBag aria-hidden="true" size={23} />
              {count > 0 && (
                <span className="bag-button__count" key={bump} aria-hidden="true">
                  {count}
                </span>
              )}
            </button>
          </div>
        </div>
      </header>

      <Dialog open={overlay.kind === 'menu'} onClose={close} title="Menu" variant="menu">
        <nav aria-label="Mobile">
          <ul className="mobile-nav">
            <li><a href={href('home')} onClick={close}>Home</a></li>
            {site.nav.map((item) => (
              <li key={item.route}>
                <a href={href(item.route)} onClick={close} aria-current={isActive(route, item.route) ? 'page' : undefined}>
                  {item.label}
                </a>
              </li>
            ))}
          </ul>
          <p className="mobile-nav__group">Shop by collection</p>
          <ul className="mobile-nav mobile-nav--small">
            <li><a href={href('nurse-binder-inserts')} onClick={close}>Nurse Binder Inserts</a></li>
            <li><a href={href('np-binder-inserts')} onClick={close}>Nurse Practitioner Binder Inserts</a></li>
            {categoryOpen('apparel') && <li><a href={href('apparel')} onClick={close}>Apparel</a></li>}
            {categoryOpen('accessories') && <li><a href={href('accessories')} onClick={close}>Accessories</a></li>}
            {categoryOpen('pens') && <li><a href={href('pens')} onClick={close}>Pens</a></li>}
            <li><a href={href('help')} onClick={close}>Help & contact</a></li>
            <li><a href={href(user ? 'account' : 'sign-in')} onClick={close}>{user ? 'My account' : 'Sign in'}</a></li>
          </ul>
          <button type="button" className="button button--outline button--small mobile-nav__finder" onClick={() => open({ kind: 'finder' })}>
            {site.hero.secondary}
          </button>
        </nav>
      </Dialog>
    </>
  )
}
