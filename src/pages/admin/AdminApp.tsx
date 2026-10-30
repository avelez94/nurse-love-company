import { BarChart3, BookHeart, ClipboardList, ExternalLink, FileVideo, LifeBuoy, LogOut, Mail, Megaphone, Menu, Package, ScrollText, Settings as SettingsIcon, UserRound, Users, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { href, navigate, type AdminView } from '../../lib/router'
import { useSession } from '../../lib/session'
import { Wordmark } from '../../components/Wordmark'
import { Loading } from '../../components/ui'
import { rememberReturn } from '../Auth'
import { Audit } from './Audit'
import { BannerEditor, Banners, PopupEditor } from './Marketing'
import { CustomerDetail, Customers } from './Customers'
import { EmailDetail, Emails, Templates } from './Emails'
import { OrderDetail, Orders } from './Orders'
import { Automations } from './Automations'
import { QuizEditor, Quizzes } from './Quizzes'
import { ReviewsAdmin } from './Reviews'
import { StoryEditor } from './Story'
import { Overview } from './Overview'
import { ProductEditor, Products } from './Products'
import { SettingsPage } from './Settings'
import { SupportPage } from './Support'
import { TutorialEditor, TutorialsAdmin } from './Tutorials'
import './Admin.css'

type NavItem = { view: AdminView; label: string; route: string; icon: typeof BarChart3; match: AdminView[]; children?: Array<{ label: string; route: string; match: AdminView[] }> }
const nav: NavItem[] = [
  { view: 'overview', label: 'Overview', route: 'admin', icon: BarChart3, match: ['overview'] },
  { view: 'orders', label: 'Orders', route: 'admin-orders', icon: ClipboardList, match: ['orders', 'order'] },
  { view: 'products', label: 'Products', route: 'admin-products', icon: Package, match: ['products', 'product'] },
  {
    view: 'customers',
    label: 'Customers',
    route: 'admin-customers',
    icon: Users,
    match: ['customers', 'customer'],
    children: [{ label: 'Reviews', route: 'admin-reviews', match: ['reviews'] }],
  },
  { view: 'tutorials', label: 'Tutorials', route: 'admin-tutorials', icon: FileVideo, match: ['tutorials', 'tutorial'] },
  {
    view: 'marketing',
    label: 'Marketing',
    route: 'admin-marketing',
    icon: Megaphone,
    match: ['marketing', 'banner'],
    children: [
      { label: 'Resource Quiz', route: 'admin-quizzes', match: ['quizzes', 'quiz'] },
      { label: 'Email Automations', route: 'admin-email-automations', match: ['automations'] },
      { label: 'Nurse Kin', route: 'admin-nurse-kin', match: ['popup'] },
    ],
  },
  { view: 'story', label: 'Content', route: 'admin-our-story', icon: BookHeart, match: [], children: [{ label: 'Our Story', route: 'admin-our-story', match: ['story'] }] },
  { view: 'emails', label: 'Email center', route: 'admin-emails', icon: Mail, match: ['emails', 'email', 'templates'] },
  { view: 'support', label: 'Support', route: 'admin-support', icon: LifeBuoy, match: ['support'] },
  { view: 'settings', label: 'Settings', route: 'admin-settings', icon: SettingsIcon, match: ['settings'] },
  { view: 'audit', label: 'Audit log', route: 'admin-audit', icon: ScrollText, match: ['audit'] },
]

export default function AdminApp({ view, param }: { view: AdminView; param?: string }) {
  const { user, loading, signOut } = useSession()
  const [menuOpen, setMenuOpen] = useState(false)
  useEffect(() => setMenuOpen(false), [view, param])
  useEffect(() => {
    if (!loading && !user) {
      rememberReturn(window.location.hash.slice(1) || 'admin')
      navigate('sign-in')
    }
  }, [loading, user])

  if (loading || !user) return <Loading label="Checking your access..." />
  if (user.role !== 'admin') {
    return (
      <div className="admin-denied">
        <h1>Store admin</h1>
        <p>This area is for store administrators. Your account does not have admin access.</p>
        <a className="button button--small" href={href('account')}>Go to my account</a>
      </div>
    )
  }

  return (
    <div className="admin">
      <header className="admin__bar">
        <button type="button" className="icon-button admin__menu" aria-label={menuOpen ? 'Close admin menu' : 'Open admin menu'} aria-expanded={menuOpen} onClick={() => setMenuOpen((o) => !o)}>
          {menuOpen ? <X size={22} aria-hidden="true" /> : <Menu size={22} aria-hidden="true" />}
        </button>
        <a href={href('admin')} className="admin__brand" aria-label="Store admin home">
          <Wordmark size="sm" />
          <span className="admin__brand-label">Store admin</span>
        </a>
        <div className="admin__bar-tools">
          <a className="chip" href={href('home')} target="_blank" rel="noopener">
            View store <ExternalLink size={14} aria-hidden="true" />
          </a>
          <span className="admin__who">{user.email}</span>
          <a className="icon-button" href={href('account-settings')} aria-label="My account: profile and password" title="My account: profile and password">
            <UserRound size={20} aria-hidden="true" />
          </a>
          <button
            type="button"
            className="icon-button"
            aria-label="Sign out"
            title="Sign out"
            onClick={async () => {
              await signOut()
              navigate('home')
            }}
          >
            <LogOut size={20} aria-hidden="true" />
          </button>
        </div>
      </header>
      <div className="admin__body">
        <nav className={`admin__nav ${menuOpen ? 'is-open' : ''}`} aria-label="Admin">
          <ul>
            {nav.map((n) => (
              <li key={n.view}>
                <a href={href(n.route)} aria-current={n.match.includes(view) ? 'page' : undefined}>
                  <n.icon size={18} aria-hidden="true" />
                  {n.label}
                </a>
                {n.children && (
                  <ul className="admin__subnav">
                    {n.children.map((s) => (
                      <li key={s.route}>
                        <a href={href(s.route)} aria-current={s.match.includes(view) ? 'page' : undefined}>
                          {s.label}
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </nav>
        <main className="admin__main" id="main" tabIndex={-1}>
          {view === 'overview' && <Overview />}
          {view === 'products' && <Products />}
          {view === 'product' && <ProductEditor id={param ?? 'new'} />}
          {view === 'orders' && <Orders />}
          {view === 'order' && param && <OrderDetail id={param} />}
          {view === 'customers' && <Customers />}
          {view === 'customer' && param && <CustomerDetail id={param} />}
          {view === 'emails' && <Emails />}
          {view === 'email' && param && <EmailDetail id={param} />}
          {view === 'templates' && <Templates />}
          {view === 'tutorials' && <TutorialsAdmin />}
          {view === 'tutorial' && <TutorialEditor id={param ?? 'new'} />}
          {view === 'support' && <SupportPage />}
          {view === 'marketing' && <Banners />}
          {view === 'banner' && <BannerEditor id={param ?? 'new'} />}
          {view === 'popup' && <PopupEditor />}
          {view === 'quizzes' && <Quizzes />}
          {view === 'quiz' && param && <QuizEditor id={param} />}
          {view === 'reviews' && <ReviewsAdmin />}
          {view === 'story' && <StoryEditor />}
          {view === 'automations' && <Automations />}
          {view === 'settings' && <SettingsPage />}
          {view === 'audit' && <Audit />}
        </main>
      </div>
    </div>
  )
}

export function PageTitle({ title, children, back }: { title: string; children?: React.ReactNode; back?: { label: string; route: string } }) {
  return (
    <div className="admin-title">
      {back && (
        <a className="admin-title__back" href={href(back.route)}>
          ← {back.label}
        </a>
      )}
      <div className="admin-title__row">
        <h1>{title}</h1>
        {children && <div className="button-row">{children}</div>}
      </div>
    </div>
  )
}
