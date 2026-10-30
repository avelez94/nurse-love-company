import { Play } from 'lucide-react'
import type { Tutorial } from '../data/types'
import { formatDuration } from '../data/tutorials'
import { InsertPage } from './illustrations/InsertPage'
import { Tablet } from './illustrations/Objects'
import { PageCluster } from './illustrations/PageCluster'
import './Tutorials.css'

/* Tutorial thumbnail with a play badge and the video length. */
export function TutorialThumb({ tutorial, size = 'md' }: { tutorial: Tutorial; size?: 'md' | 'lg' }) {
  const t = tutorial.thumbnail
  return (
    <span className={`tutorial-thumb tutorial-thumb--${size}`}>
      <span className="tutorial-thumb__art" role="img" aria-label={`${t.alt}. Illustrative thumbnail.`}>
        {t.kind === 'photo' || t.kind === 'url' ? (
          <img src={t.src} alt="" width={t.kind === 'photo' ? t.width : 1280} height={t.kind === 'photo' ? t.height : 720} loading="lazy" />
        ) : t.name === 'tablet' ? (
          <Tablet className="tutorial-thumb__tablet" />
        ) : t.name === 'printing' ? (
          <InsertPage className="tutorial-thumb__page" title="Ready to print" layout="checklist" heart />
        ) : (
          <PageCluster variant={t.name === 'pages-np' ? 'np' : 'nurse'} />
        )}
      </span>
      <span className="tutorial-thumb__play" aria-hidden="true">
        <Play size={size === 'lg' ? 30 : 22} fill="currentColor" />
      </span>
      {tutorial.durationSeconds ? (
        <span className="tutorial-thumb__duration">
          <span className="visually-hidden">Length </span>
          {formatDuration(tutorial.durationSeconds)}
        </span>
      ) : null}
    </span>
  )
}
