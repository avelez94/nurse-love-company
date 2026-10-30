import { lazy, Suspense, useEffect, useRef } from 'react'
import { getCategory } from './data/catalog'
import { site } from './data/site'
import { BackToTop, ToastHost } from './components/Chrome'
import { Footer } from './components/Footer'
import { Header } from './components/Header'
import { Overlays } from './components/Overlays'
import { Loading } from './components/ui'
import { CartProvider } from './lib/cart'
import { useRoute, type Route } from './lib/router'
import { SessionProvider } from './lib/session'
import { StoreProvider, useStore } from './lib/store'
import { UIProvider, useUI } from './lib/ui'
import { AccountArea, CheckoutResult } from './pages/account/Account'
import { EmailPreferences } from './pages/EmailPreferences'
import { AdminSetup, ForgotPassword, ResetPassword, SignIn, SignUp } from './pages/Auth'
import { Collection } from './pages/Collection'
import { ExtraCute } from './pages/ExtraCute'
import { Home } from './pages/Home'
import { Product } from './pages/Product'
import { Shop } from './pages/Shop'
import { Tutorials, TutorialWatch } from './pages/Tutorials'
import { Freebies, Help, NotFound, Story } from './pages/Simple'
import { ServerUnavailablePage } from './components/Unavailable'
import { FloatingLaunchers } from './components/Launchers'
import { MarketingProvider } from './lib/marketing'

// The admin dashboard (and its rich text editor) loads only for admins.
const AdminApp = lazy(() => import('./pages/admin/AdminApp'))

function useTitle(route: Route): string {
  const { getProduct, getTutorial } = useStore()
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
    case 'auth':
      return `${{ 'sign-in': 'Sign in', 'sign-up': 'Create account', 'forgot-password': 'Reset password', 'reset-password': 'Choose a new password', 'admin-setup': 'Admin setup' }[route.mode]} | ${site.name}`
    case 'checkout':
      return `Checkout | ${site.name}`
    case 'account':
      return `My account | ${site.name}`
    case 'admin':
      return `Store admin | ${site.name}`
    case 'email-preferences':
      return `Email preferences | ${site.name}`
    case 'not-found':
      return `Page not found | ${site.name}`
  }
}

function Page({ route }: { route: Route }) {
  const { status } = useStore()
  // Accounts, checkout and dashboards need the store server; say so instead of offering forms that cannot work.
  if (status === 'offline' && (route.name === 'auth' || route.name === 'account' || route.name === 'checkout' || route.name === 'admin')) {
    const title = route.name === 'checkout' ? 'Checkout is not available yet' : route.name === 'admin' ? 'Store admin is not available yet' : 'Accounts are not available yet'
    return <ServerUnavailablePage title={title}>This preview is for reviewing the design. Signing in, accounts, checkout and the store dashboards turn on once the store is connected.</ServerUnavailablePage>
  }
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
    case 'auth':
      if (route.mode === 'sign-in') return <SignIn />
      if (route.mode === 'sign-up') return <SignUp />
      if (route.mode === 'forgot-password') return <ForgotPassword />
      if (route.mode === 'admin-setup') return <AdminSetup />
      return <ResetPassword token={route.token} />
    case 'checkout':
      return <CheckoutResult result={route.result} free={route.free} />
    case 'account':
      return <AccountArea view={route.view} param={route.param} />
    case 'admin':
      return null
    case 'email-preferences':
      return <EmailPreferences token={route.token} />
    case 'not-found':
      return <NotFound />
  }
}

function OfflineBanner() {
  const { status, environment } = useStore()
  if (environment === 'staging') {
    return (
      <p className="offline-banner" role="status">
        Staging preview for review. Payments are in test mode or switched off, and items marked Demo are sample content.
      </p>
    )
  }
  if (status !== 'offline') return null
  return (
    <p className="offline-banner" role="status">
      Design preview. The store is not connected yet, so products, tutorials, accounts and checkout are switched off.
    </p>
  )
}

function Shell() {
  const route = useRoute()
  const { close } = useUI()
  const main = useRef<HTMLElement>(null)
  const first = useRef(true)
  const key = JSON.stringify(route)
  const title = useTitle(route)
  const { status } = useStore()

  useEffect(() => {
    document.title = title
  }, [title])

  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    close()
    window.scrollTo({ top: 0 })
    main.current?.focus({ preventScroll: true })
  }, [key])

  if (route.name === 'admin' && status !== 'offline') {
    return (
      <Suspense fallback={<Loading label="Loading store admin..." />}>
        <AdminApp view={route.view} param={route.param} />
        <ToastHost />
      </Suspense>
    )
  }

  return (
    <>
      <a className="skip-link" href="#main" onClick={(e) => { e.preventDefault(); main.current?.focus() }}>
        Skip to content
      </a>
      <OfflineBanner />
      <Header route={route} />
      <main id="main" ref={main} tabIndex={-1} className="page-enter" key={key}>
        <Page route={route} />
      </main>
      <Footer />
      <BackToTop />
      <ToastHost />
      <Overlays />
      <FloatingLaunchers />
    </>
  )
}

export function App() {
  return (
    <UIProvider>
      <SessionProvider>
        <StoreProvider>
          <CartProvider>
            <MarketingProvider>
              <Shell />
            </MarketingProvider>
          </CartProvider>
        </StoreProvider>
      </SessionProvider>
    </UIProvider>
  )
}
