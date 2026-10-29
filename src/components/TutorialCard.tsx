import { ArrowRight, PlayCircle } from 'lucide-react'
import type { CategoryId, Tutorial } from '../data/types'
import { formatDuration, getTutorialCategory, tutorialForProductCategory } from '../data/tutorials'
import { href } from '../lib/router'
import { TutorialThumb } from './TutorialThumb'
import './Tutorials.css'

export function TutorialCard({ tutorial, style }: { tutorial: Tutorial; style?: React.CSSProperties }) {
  const link = href(`tutorial-${tutorial.slug}`)
  return (
    <article className="tutorial-card" style={style}>
      <a className="tutorial-card__media" href={link} tabIndex={-1} aria-hidden="true">
        <TutorialThumb tutorial={tutorial} />
      </a>
      <div className="tutorial-card__body">
        <p className="tutorial-card__meta">
          <span className="eyebrow">{getTutorialCategory(tutorial.category).title}</span>
          <span className="tutorial-card__duration">{formatDuration(tutorial.durationSeconds)}</span>
        </p>
        <h3 className="tutorial-card__title">
          <a href={link}>{tutorial.title}</a>
        </h3>
        <p className="tutorial-card__summary">{tutorial.summary}</p>
        <a className="arrow-link tutorial-card__watch" href={link} tabIndex={-1} aria-hidden="true">
          Watch <ArrowRight className="arrow" size={18} />
        </a>
      </div>
    </article>
  )
}

/** "Need help getting started? Watch the tutorial" for product pages, the bag and help. */
export function TutorialHelpLink({ category, onNavigate, showTitle }: { category: CategoryId; onNavigate?: () => void; showTitle?: boolean }) {
  const tutorial = tutorialForProductCategory(category)
  if (!tutorial) return null
  return (
    <a className="tutorial-help" href={href(`tutorial-${tutorial.slug}`)} onClick={onNavigate}>
      <PlayCircle aria-hidden="true" size={26} />
      <span>
        <span className="tutorial-help__lead">Need help getting started?</span>
        <span className="tutorial-help__action">
          Watch the tutorial <ArrowRight className="arrow" aria-hidden="true" size={16} />
        </span>
        {showTitle ? <span className="tutorial-help__title">{tutorial.title}</span> : <span className="visually-hidden">: {tutorial.title}</span>}
      </span>
    </a>
  )
}
