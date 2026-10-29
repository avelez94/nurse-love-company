import type { SampleLayout } from '../../data/types'

/*
  Illustrated loose insert page. Placeholder art drawn as neutral layouts only:
  lines, boxes and generic field labels, never clinical content.
*/

const LINE = '#EFD8DF'
const PINK = '#F3BFD0'
const RASP = '#D80853'
const INK = '#680C35'
const MUTED = '#9A6B7D'

interface InsertPageProps {
  title: string
  subtitle?: string
  layout: SampleLayout
  fields?: string[]
  /** Use a handwritten title, like the Freebie Corner sample. */
  script?: boolean
  heart?: boolean
  /** Draw a small "Sample" tag in the corner. */
  sampleTag?: boolean
  className?: string
  /** Decorative by default. Pass a label to expose it as an image. */
  label?: string
}

export function InsertPage({ title, subtitle, layout, fields, script, heart, sampleTag, className, label }: InsertPageProps) {
  const a11y = label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true as const }
  const titleSize = title.length > 18 ? 17 : title.length > 13 ? 20 : 23
  return (
    <svg viewBox="0 0 300 390" className={className} {...a11y} focusable="false">
      <rect x="1" y="1" width="298" height="388" rx="6" fill="#FFFFFF" stroke={LINE} strokeWidth="1.5" />
      {Array.from({ length: 7 }, (_, i) => (
        <circle key={i} cx="16" cy={40 + i * 50} r="4.2" fill="#F7EEF0" stroke="#E6CBD3" />
      ))}
      {sampleTag && (
        <g>
          <rect x="222" y="12" width="64" height="20" rx="10" fill="#FFF0F2" stroke={PINK} />
          <text x="254" y="26" textAnchor="middle" fontSize="10" className="svg-body" fontWeight="700" fill={RASP} letterSpacing="1">
            SAMPLE
          </text>
        </g>
      )}
      <text
        x="160"
        y={subtitle ? 50 : 56}
        textAnchor="middle"
        fill={INK}
        className={script ? 'svg-script' : 'svg-display'}
        fontSize={script ? titleSize + 6 : titleSize}
      >
        {title}
      </text>
      {subtitle && (
        <text x="160" y="68" textAnchor="middle" fill={INK} fontSize="8.5" letterSpacing="2.5" className="svg-body">
          {subtitle.toUpperCase()}
        </text>
      )}
      {heart && <SmallHeart x={150} y={subtitle ? 76 : 64} />}
      <Layout layout={layout} fields={fields} />
    </svg>
  )
}

function SmallHeart({ x, y, size = 10 }: { x: number; y: number; size?: number }) {
  return (
    <path
      transform={`translate(${x} ${y}) scale(${size / 20})`}
      d="M10 18s-8-4.9-8-10.4A4.4 4.4 0 0 1 10 5.2a4.4 4.4 0 0 1 8 2.4C18 13.1 10 18 10 18z"
      fill="none"
      stroke={RASP}
      strokeWidth="2"
      strokeLinejoin="round"
    />
  )
}

function Layout({ layout, fields }: { layout: SampleLayout; fields?: string[] }) {
  const x0 = 40
  const x1 = 280
  const top = 96
  switch (layout) {
    case 'lined':
      return (
        <g>
          <text x={x0} y={top} fontSize="9" fill={MUTED} className="svg-body">DATE</text>
          <line x1={x0 + 32} x2={x0 + 120} y1={top + 1} y2={top + 1} stroke={LINE} />
          {Array.from({ length: 14 }, (_, i) => (
            <line key={i} x1={x0} x2={x1} y1={top + 26 + i * 18} y2={top + 26 + i * 18} stroke={LINE} />
          ))}
        </g>
      )
    case 'checklist':
      return (
        <g>
          {Array.from({ length: 13 }, (_, i) => (
            <g key={i}>
              <rect x={x0} y={top - 6 + i * 21} width="9" height="9" rx="1.5" fill="none" stroke={RASP} strokeWidth="1.1" />
              <line x1={x0 + 18} x2={x1} y1={top + 3 + i * 21} y2={top + 3 + i * 21} stroke={LINE} />
            </g>
          ))}
        </g>
      )
    case 'table': {
      const cols = fields?.length ? fields : ['Item', 'Detail', 'Notes']
      const colW = (x1 - x0 - 16) / cols.length
      return (
        <g>
          <rect x={x0} y={top - 12} width={x1 - x0} height="18" fill="#FFF0F2" />
          {cols.map((c, i) => (
            <text key={c} x={x0 + 16 + i * colW + colW / 2} y={top + 1} textAnchor="middle" fontSize="8.5" fill={INK} className="svg-body">
              {c}
            </text>
          ))}
          {cols.slice(1).map((_, i) => (
            <line key={i} x1={x0 + 16 + (i + 1) * colW} x2={x0 + 16 + (i + 1) * colW} y1={top - 12} y2={top + 262} stroke={LINE} />
          ))}
          {Array.from({ length: 13 }, (_, i) => (
            <g key={i}>
              <rect x={x0 + 2} y={top + 13 + i * 20} width="8" height="8" rx="1.5" fill="none" stroke={RASP} strokeWidth="1" />
              <line x1={x0} x2={x1} y1={top + 26 + i * 20} y2={top + 26 + i * 20} stroke={LINE} />
            </g>
          ))}
        </g>
      )
    }
    case 'sections': {
      const list = fields?.length ? fields : ['Section', 'Section', 'Section']
      const h = (270 - (list.length - 1) * 10) / list.length
      return (
        <g>
          {list.map((f, i) => {
            const y = top - 12 + i * (h + 10)
            return (
              <g key={f + i}>
                <text x={x0} y={y + 4} fontSize="9" fill={INK} className="svg-body">{f}:</text>
                <rect x={x0} y={y + 10} width={x1 - x0} height={h - 16} rx="4" fill="#FDE6EC" />
              </g>
            )
          })}
        </g>
      )
    }
    case 'schedule':
      return (
        <g>
          <text x={x0} y={top} fontSize="10" fill={INK} className="svg-display">Top 3</text>
          {[0, 1, 2].map((i) => (
            <g key={i}>
              <rect x={x0} y={top + 12 + i * 20} width="9" height="9" rx="1.5" fill="none" stroke={RASP} strokeWidth="1.1" />
              <line x1={x0 + 16} x2={x0 + 104} y1={top + 21 + i * 20} y2={top + 21 + i * 20} stroke={LINE} />
            </g>
          ))}
          <text x={x0} y={top + 100} fontSize="10" fill={INK} className="svg-display">Notes</text>
          {Array.from({ length: 8 }, (_, i) => (
            <line key={i} x1={x0} x2={x0 + 104} y1={top + 120 + i * 20} y2={top + 120 + i * 20} stroke={LINE} />
          ))}
          <text x={160} y={top} fontSize="10" fill={INK} className="svg-display">Schedule</text>
          {['7:00', '8:00', '9:00', '10:00', '11:00', '12:00', '1:00', '2:00', '3:00', '4:00', '5:00', '6:00'].map((t, i) => (
            <g key={t}>
              <text x={160} y={top + 22 + i * 22} fontSize="8" fill={MUTED} className="svg-body">{t}</text>
              <line x1={186} x2={x1} y1={top + 24 + i * 22} y2={top + 24 + i * 22} stroke={LINE} />
            </g>
          ))}
        </g>
      )
    case 'grid':
      return (
        <g>
          {Array.from({ length: 14 }, (_, r) =>
            Array.from({ length: 13 }, (_, c) => <circle key={`${r}-${c}`} cx={x0 + c * 20} cy={top - 6 + r * 20} r="1.2" fill={PINK} />),
          )}
        </g>
      )
  }
}
