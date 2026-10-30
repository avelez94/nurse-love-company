import { href } from '../lib/router'

/**
 * Shown where content or actions need the store server and it is not
 * connected (for example the design preview before the database exists).
 * Never pretends: nothing is shown as available that is not.
 */
export function ServerUnavailable({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="empty-state" role="status">
      <p className="empty-state__title">{title}</p>
      <p className="muted">{children ?? 'This preview is not connected to the store yet. It will appear here once it is.'}</p>
      <div className="chip-row">
        <a className="chip" href={href('home')}>Back to home</a>
        <a className="chip" href={href('freebie-corner')}>Visit The Freebie Corner</a>
      </div>
    </div>
  )
}

/** Full page version, for areas that need an account or checkout. */
export function ServerUnavailablePage({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <section className="container shop" aria-label={title}>
      <ServerUnavailable title={title}>{children}</ServerUnavailable>
    </section>
  )
}
