import { site } from '../data/site'
import { href } from '../lib/router'
import { Heart } from './illustrations/Objects'
import { Wordmark } from './Wordmark'
import './Footer.css'

export function Footer() {
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
        <p className="site-footer__notice">
          {site.prototypeNotice}
          <Heart className="site-footer__heart" />
        </p>
      </div>
    </footer>
  )
}
