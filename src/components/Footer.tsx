import { site } from '../data/site'
import { href } from '../lib/router'
import { useStore } from '../lib/store'
import { Heart } from './illustrations/Objects'
import { Wordmark } from './Wordmark'
import './Footer.css'

export function Footer() {
  const { status, payments } = useStore()
  const notice =
    status === 'offline'
      ? 'Design preview. The store is not connected yet, so nothing can be purchased.'
      : payments === 'live'
        ? null
        : payments === 'test'
          ? 'Test mode. Payments use Stripe test cards and no real money moves.'
          : 'Preview store. Checkout is not connected yet, so nothing can be purchased.'
  return (
    <footer className="site-footer">
      <div className="container site-footer__inner">
        <div className="site-footer__brand">
          <a href={href('home')} className="site-footer__logo" aria-label="Nurse Love Company home">
            <Wordmark size="sm" />
          </a>
          <p>{site.statement}</p>
        </div>
        <nav aria-label="Footer">
          <ul className="site-footer__links">
            {site.nav.map((item) => (
              <li key={item.route}>
                <a href={href(item.route)}>{item.label}</a>
              </li>
            ))}
            <li>
              <a href={href('help')}>Help & contact</a>
            </li>
          </ul>
        </nav>
        {notice && (
          <p className="site-footer__notice">
            {notice}
            <Heart className="site-footer__heart" />
          </p>
        )}
      </div>
      <div className="container site-footer__legal">
        <nav aria-label="Legal">
          <ul className="site-footer__legal-links">
            <li>
              <a href={href('terms')}>Terms & Conditions</a>
            </li>
            <li>
              <a href={href('privacy')}>Privacy Policy</a>
            </li>
          </ul>
        </nav>
        {/* The website builder's credit. Store questions go to Help & contact, never here. */}
        <p className="site-footer__credit">
          <span className="visually-hidden">Website </span>
          Made with <Heart className="site-footer__credit-heart" />
          <span className="visually-hidden">love</span> by{' '}
          <a href="https://alantevelez.com" target="_blank" rel="noopener noreferrer">
            Alante Velez
            <span className="visually-hidden"> (website designer, opens in a new tab)</span>
          </a>
        </p>
      </div>
    </footer>
  )
}
