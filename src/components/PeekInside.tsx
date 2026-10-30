import { ChevronLeft, ChevronRight, Maximize2, Minimize2 } from 'lucide-react'
import { useRef, useState } from 'react'
import type { SamplePage } from '../data/types'
import { SamplePageView } from './SamplePageView'
import './PeekInside.css'

/*
  Sample viewer: thumbnails, previous and next, a counter, keyboard arrows,
  swipe and an enlarge toggle. A gentle slide plays between pages.
  Real samples are owner approved, watermarked preview images. They are
  separate files from the paid download, which is never shown here.
*/
export function PeekInside({ pages, title, start = 0 }: { pages: SamplePage[]; title: string; start?: number }) {
  const [index, setIndex] = useState(Math.min(start, Math.max(pages.length - 1, 0)))
  const [direction, setDirection] = useState<'next' | 'prev'>('next')
  const touch = useRef<number | null>(null)
  const [large, setLarge] = useState(false)
  const real = pages.length > 0 && pages.every((p) => p.kind === 'photo')

  if (pages.length === 0) {
    return <p className="muted">Sample pages will be added for this product.</p>
  }

  const go = (to: number) => {
    const next = (to + pages.length) % pages.length
    setDirection(to > index || (index === pages.length - 1 && next === 0) ? 'next' : 'prev')
    setIndex(next)
  }

  const page = pages[index]

  return (
    <div
      className={`peek ${large ? 'peek--large' : ''}`}
      onKeyDown={(e) => {
        if (e.key === 'ArrowRight') {
          e.preventDefault()
          go(index + 1)
        } else if (e.key === 'ArrowLeft') {
          e.preventDefault()
          go(index - 1)
        }
      }}
    >
      <div
        className="peek__stage"
        onTouchStart={(e) => (touch.current = e.touches[0].clientX)}
        onTouchEnd={(e) => {
          if (touch.current === null) return
          const dx = e.changedTouches[0].clientX - touch.current
          if (Math.abs(dx) > 40) go(dx < 0 ? index + 1 : index - 1)
          touch.current = null
        }}
      >
        <button type="button" className="peek__nav peek__nav--prev" onClick={() => go(index - 1)} aria-label="Previous sample page" disabled={pages.length < 2}>
          <ChevronLeft aria-hidden="true" size={24} />
        </button>
        <div className="peek__frame" aria-live="polite" style={page.kind === 'photo' ? { aspectRatio: `${page.width} / ${page.height}` } : undefined}>
          {real && <span className="peek__tag">Sample</span>}
          <SamplePageView key={index} page={page} className={`peek__page peek__page--${direction}`} label={`${title}, sample ${index + 1} of ${pages.length}: ${page.title}. Illustrative layout.`} />
        </div>
        <button type="button" className="peek__nav peek__nav--next" onClick={() => go(index + 1)} aria-label="Next sample page" disabled={pages.length < 2}>
          <ChevronRight aria-hidden="true" size={24} />
        </button>
      </div>
      <p className="peek__meta">
        <span className="peek__counter">
          Sample {index + 1} of {pages.length}
        </span>
        <span className="peek__name">{page.title}</span>
        {real && (
          <button type="button" className="peek__enlarge" onClick={() => setLarge((v) => !v)} aria-pressed={large}>
            {large ? <Minimize2 aria-hidden="true" size={16} /> : <Maximize2 aria-hidden="true" size={16} />}
            {large ? 'Smaller' : 'Enlarge'}
          </button>
        )}
      </p>
      <div className="peek__thumbs" role="group" aria-label="Choose a sample page">
        {pages.map((p, i) => (
          <button
            key={p.title + i}
            type="button"
            className="peek__thumb"
            aria-pressed={i === index}
            aria-label={`Show sample ${i + 1}: ${p.title}`}
            onClick={() => go(i)}
          >
            <SamplePageView page={p} className="peek__thumb-img" label="" />
            <span className="peek__thumb-label" aria-hidden="true">{p.title}</span>
          </button>
        ))}
      </div>
      <p className="peek__note">
        {real
          ? 'Only selected pages and details are shown here, marked as previews. Your download is the complete resource, without the preview marks.'
          : 'Illustrative sample layouts for this preview. Not the final resource.'}
      </p>
    </div>
  )
}
