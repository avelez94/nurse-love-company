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
    </footer>
  )
}
