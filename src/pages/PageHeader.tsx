import type { ReactNode } from 'react'
import { href } from '../lib/router'
import './Pages.css'

export interface Crumb {
  label: string
  route?: string
}

export function PageHeader({ title, titleAccent, intro, crumbs, children, eyebrow }: { title: string; titleAccent?: ReactNode; intro?: ReactNode; crumbs?: Crumb[]; children?: ReactNode; eyebrow?: string }) {
  return (
    <header className="page-header">
      <div className="container">
        {crumbs && (
          <nav aria-label="Breadcrumb" className="crumbs">
            <ol>
              {crumbs.map((c, i) => (
                <li key={c.label}>
                  {c.route !== undefined && i < crumbs.length - 1 ? <a href={href(c.route)}>{c.label}</a> : <span aria-current="page">{c.label}</span>}
                </li>
              ))}
            </ol>
          </nav>
        )}
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h1 className="page-header__title">
          {title}
          {titleAccent}
        </h1>
        {intro && <div className="page-header__intro">{intro}</div>}
        {children}
      </div>
    </header>
  )
}
