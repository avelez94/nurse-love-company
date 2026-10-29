import { useEffect, useRef } from 'react'
import { getCategory, getProduct } from './data/catalog'
import { getTutorial } from './data/tutorials'
import { site } from './data/site'
import { BackToTop, ToastHost } from './components/Chrome'
import { Footer } from './components/Footer'
import { Header } from './components/Header'
import { Overlays } from './components/Overlays'
import { CartProvider } from './lib/cart'
import { useRoute, type Route } from './lib/router'
import { UIProvider, useUI } from './lib/ui'
import { Collection } from './pages/Collection'
import { ExtraCute } from './pages/ExtraCute'
import { Home } from './pages/Home'
import { Product } from './pages/Product'
import { Shop } from './pages/Shop'
import { Tutorials, TutorialWatch } from './pages/Tutorials'
import { Freebies, Help, NotFound, Story } from './pages/Simple'

function titleFor(route: Route): string {
  switch (route.name) {
    case 'home':
      return `${site.name} | ${site.statement}`
    case 'shop':
      return `Shop digital resources | ${site.name}`
    case 'collection':
      return `${getCategory(route.id).title} | ${site.name}`
    case 'extra-cute':
      return `${route.tab === 'all' ? site.extraHeading : getCategory(route.tab).title} | ${site.name}`
    case 'freebies':
      return `${site.freebie.heading} | ${site.name}`
    case 'tutorials':
      return `Tutorials | ${site.name}`
    case 'tutorial':
      return `${getTutorial(route.slug)?.title ?? 'Tutorial'} | Tutorials | ${site.name}`
    case 'story':
      return `Our Story | ${site.name}`
    case 'help':
      return `Help & contact | ${site.name}`
    case 'product':
      return `${getProduct(route.slug)?.title ?? 'Product'} | ${site.name}`
    case 'not-found':
      return `Page not found | ${site.name}`
  }
}

function Page({ route }: { route: Route }) {
  switch (route.name) {
    case 'home':
      return <Home />
    case 'shop':
      return <Shop />
    case 'collection':
      return <Collection id={route.id} />
    case 'extra-cute':
      return <ExtraCute tab={route.tab} />
    case 'freebies':
      return <Freebies />
    case 'tutorials':
      return <Tutorials />
    case 'tutorial':
      return <TutorialWatch slug={route.slug} />
    case 'story':
      return <Story />
    case 'help':
      return <Help />
    case 'product':
      return <Product slug={route.slug} />
    case 'not-found':
      return <NotFound />
  }
}

function Shell() {
  const route = useRoute()
  const { close } = useUI()
  const main = useRef<HTMLElement>(null)
  const first = useRef(true)
  const key = JSON.stringify(route)

  useEffect(() => {
    document.title = titleFor(route)
    if (first.current) {
      first.current = false
      return
    }
    close()
    window.scrollTo({ top: 0 })
    main.current?.focus({ preventScroll: true })
  }, [key])

  return (
    <>
      <a className="skip-link" href="#main" onClick={(e) => { e.preventDefault(); main.current?.focus() }}>
        Skip to content
      </a>
      <Header route={route} />
      <main id="main" ref={main} tabIndex={-1} className="page-enter" key={key}>
        <Page route={route} />
      </main>
      <Footer />
      <BackToTop />
      <ToastHost />
      <Overlays />
    </>
  )
}

export function App() {
  return (
    <UIProvider>
      <CartProvider>
        <Shell />
      </CartProvider>
    </UIProvider>
  )
}
