/*
  Simple illustrative product art on transparent backgrounds. Each sits on a
  plain frame supplied by the card. Replace with real photography when ready.
*/

const RASP = '#D80853'
const INK = '#680C35'
const LINE = '#EFD8DF'
const GOLD = '#C9A15B'
const GOLD_LIGHT = '#E8CD94'

interface ArtProps {
  className?: string
}

const hidden = { 'aria-hidden': true as const, focusable: 'false' as const }

export function Heart({ className, strokeWidth = 2 }: ArtProps & { strokeWidth?: number }) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...hidden}>
      <path
        pathLength={1}
        d="M12 20.5s-8.5-5.1-8.5-11a4.7 4.7 0 0 1 8.5-2.8 4.7 4.7 0 0 1 8.5 2.8c0 5.9-8.5 11-8.5 11z"
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  )
}

export function Tablet({ className }: ArtProps) {
  const times = ['7:00', '8:00', '9:00', '10:00', '11:00', '12:00']
  const slots = ['Report', 'Patient care', 'Study block', 'Charting', 'Lunch', 'Skills lab']
  return (
    <svg viewBox="0 0 300 390" className={className} {...hidden}>
      <rect x="2" y="2" width="296" height="386" rx="22" fill="#2B1820" />
      <rect x="6" y="6" width="288" height="378" rx="19" fill="#3A222C" />
      <rect x="18" y="18" width="264" height="354" rx="8" fill="#FFFAF6" />
      <rect x="18" y="18" width="264" height="44" rx="8" fill="#FDE6EC" />
      <rect x="18" y="50" width="264" height="12" fill="#FDE6EC" />
      <text x="36" y="49" className="svg-script" fontSize="26" fill={INK}>Today</text>
      <g transform="translate(104 31) scale(0.75)">
        <path d="M10 18s-8-4.9-8-10.4A4.4 4.4 0 0 1 10 5.2a4.4 4.4 0 0 1 8 2.4C18 13.1 10 18 10 18z" fill="none" stroke={RASP} strokeWidth="2" />
      </g>
      <text x="36" y="84" className="svg-body" fontSize="10" fill={INK} fontWeight="700">Your day at a glance</text>

      <text x="36" y="112" className="svg-display" fontSize="13" fill={INK}>Top 3</text>
      {['Clinical prep', 'Study session', 'Movement break'].map((t, i) => (
        <g key={t}>
          <rect x="36" y={122 + i * 22} width="9" height="9" rx="1.5" fill="none" stroke={RASP} strokeWidth="1.1" />
          <text x="52" y={130 + i * 22} className="svg-body" fontSize="9" fill={INK}>{t}</text>
        </g>
      ))}
      <line x1="36" x2="140" y1="196" y2="196" stroke={LINE} />
      <text x="36" y="220" className="svg-display" fontSize="13" fill={INK}>Notes</text>
      <text x="40" y="262" className="svg-script" fontSize="17" fill={INK}>{"You've got this!"}</text>
      <g transform="translate(78 278) scale(0.8)">
        <path d="M10 18s-8-4.9-8-10.4A4.4 4.4 0 0 1 10 5.2a4.4 4.4 0 0 1 8 2.4C18 13.1 10 18 10 18z" fill="none" stroke={RASP} strokeWidth="2" />
      </g>
      {[300, 320, 340].map((y) => (
        <line key={y} x1="36" x2="140" y1={y} y2={y} stroke={LINE} />
      ))}

      <line x1="156" x2="156" y1="98" y2="356" stroke={LINE} />
      <text x="168" y="112" className="svg-display" fontSize="13" fill={INK}>Schedule</text>
      {times.map((t, i) => (
        <g key={t}>
          <text x="168" y={140 + i * 36} className="svg-body" fontSize="8.5" fill="#9A6B7D">{t}</text>
          <text x="200" y={140 + i * 36} className="svg-body" fontSize="8.5" fill={INK}>{slots[i]}</text>
          <line x1="168" x2="266" y1={150 + i * 36} y2={150 + i * 36} stroke={LINE} />
        </g>
      ))}
      <rect x="18" y="18" width="264" height="354" rx="8" fill="none" stroke="#000" strokeOpacity="0.06" />
    </svg>
  )
}

function FoldedTop({ color, shade, band }: { color: string; shade: string; band?: boolean }) {
  return (
    <g>
      <path d="M40 70 L95 38 Q150 58 205 38 L260 70 L246 118 L224 110 L224 262 Q150 274 76 262 L76 110 L54 118 Z" fill={color} />
      <path d="M95 38 Q150 80 205 38 Q150 58 95 38 Z" fill={shade} />
      <path d="M116 44 Q150 74 184 44" fill="none" stroke={shade} strokeWidth="7" strokeLinecap="round" />
      <path d="M76 110 L76 262" stroke={shade} strokeWidth="2" opacity="0.6" />
      <path d="M224 110 L224 262" stroke={shade} strokeWidth="2" opacity="0.6" />
      {band && <path d="M76 250 Q150 262 224 250 L224 262 Q150 274 76 262 Z" fill={shade} />}
      {band && <path d="M40 70 L54 118 L64 114 L50 66 Z M260 70 L246 118 L236 114 L250 66 Z" fill={shade} opacity="0.7" />}
    </g>
  )
}

export function Tee({ className }: ArtProps) {
  return (
    <svg viewBox="0 0 300 300" className={className} {...hidden}>
      <ellipse cx="150" cy="276" rx="110" ry="9" fill="#680C35" opacity="0.06" />
      <FoldedTop color="#F6B6C8" shade="#EE9DB4" />
      <text x="150" y="178" textAnchor="middle" className="svg-script" fontSize="40" fill={RASP} transform="rotate(-8 150 170)">
        Nurse Love
      </text>
      <g transform="translate(140 196) scale(1)">
        <path d="M10 18s-8-4.9-8-10.4A4.4 4.4 0 0 1 10 5.2a4.4 4.4 0 0 1 8 2.4C18 13.1 10 18 10 18z" fill="none" stroke={RASP} strokeWidth="2" />
      </g>
    </svg>
  )
}

export function Crewneck({ className }: ArtProps) {
  return (
    <svg viewBox="0 0 300 300" className={className} {...hidden}>
      <ellipse cx="150" cy="276" rx="110" ry="9" fill="#680C35" opacity="0.06" />
      <FoldedTop color="#FBD3DE" shade="#F2B5C6" band />
      <g transform="translate(138 120) scale(1.2)">
        <path d="M10 18s-8-4.9-8-10.4A4.4 4.4 0 0 1 10 5.2a4.4 4.4 0 0 1 8 2.4C18 13.1 10 18 10 18z" fill="none" stroke={RASP} strokeWidth="2" />
      </g>
    </svg>
  )
}

function HeartShape({ x, y, s, fill, stroke }: { x: number; y: number; s: number; fill: string; stroke: string }) {
  return (
    <path
      transform={`translate(${x} ${y}) scale(${s})`}
      d="M10 18.5s-8.5-5-8.5-10.6A4.6 4.6 0 0 1 10 5a4.6 4.6 0 0 1 8.5 2.9C18.5 13.5 10 18.5 10 18.5z"
      fill={fill}
      stroke={stroke}
      strokeWidth={1.4 / s}
      strokeLinejoin="round"
    />
  )
}

export function EarringsDrop({ className }: ArtProps) {
  return (
    <svg viewBox="0 0 300 300" className={className} {...hidden}>
      {[
        [95, -8],
        [205, 10],
      ].map(([c, r]) => (
        <g key={c} transform={`rotate(${r} ${c} 150)`}>
          <path d={`M${c} 62 q-18 0 -18 20 q0 16 18 24`} fill="none" stroke={GOLD} strokeWidth="4" strokeLinecap="round" />
          <circle cx={c} cy="110" r="5" fill={GOLD_LIGHT} stroke={GOLD} strokeWidth="1.5" />
          <HeartShape x={c - 40} y={100} s={4} fill="#F7B3C6" stroke={GOLD} />
          <path d={`M${c - 26} 140 q9 -12 23 -9`} fill="none" stroke="#FFFFFF" strokeWidth="3.5" strokeLinecap="round" opacity="0.7" />
        </g>
      ))}
      <ellipse cx="150" cy="250" rx="100" ry="7" fill="#680C35" opacity="0.05" />
    </svg>
  )
}

export function EarringStuds({ className }: ArtProps) {
  return (
    <svg viewBox="0 0 300 300" className={className} {...hidden}>
      <HeartShape x={52} y={96} s={4} fill="#F49AB5" stroke={GOLD} />
      <HeartShape x={168} y={106} s={4} fill="#F49AB5" stroke={GOLD} />
      <path d="M74 132 q8 -11 21 -8 M190 142 q8 -11 21 -8" fill="none" stroke="#FFFFFF" strokeWidth="3.5" strokeLinecap="round" opacity="0.7" />
      <ellipse cx="150" cy="210" rx="90" ry="6" fill="#680C35" opacity="0.05" />
    </svg>
  )
}

export function BadgeReel({ className }: ArtProps) {
  return (
    <svg viewBox="0 0 300 300" className={className} {...hidden}>
      <rect x="132" y="30" width="36" height="46" rx="6" fill={GOLD_LIGHT} stroke={GOLD} strokeWidth="2" />
      <rect x="140" y="70" width="20" height="20" rx="3" fill={GOLD} />
      <circle cx="150" cy="150" r="66" fill="#FBD3DE" stroke="#EE9DB4" strokeWidth="5" />
      <circle cx="150" cy="150" r="52" fill="#FFF0F2" />
      <HeartShape x={118} y={118} s={3.2} fill="none" stroke={RASP} />
      <path d="M150 216 L150 252" stroke="#C9B7BE" strokeWidth="2.5" />
      <rect x="138" y="252" width="24" height="12" rx="3" fill={GOLD} />
    </svg>
  )
}

function Pen({ x, y, r, body, cap }: { x: number; y: number; r: number; body: string; cap: string }) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${r})`}>
      <path d="M-9 0 L9 0 L9 190 L3 212 L0 222 L-3 212 L-9 190 Z" fill={body} />
      <path d="M-9 190 L9 190 L3 212 L-3 212 Z" fill={GOLD_LIGHT} />
      <path d="M-3 212 L3 212 L0 222 Z" fill={GOLD} />
      <rect x="-10" y="-6" width="20" height="70" rx="6" fill={cap} />
      <rect x="-2.5" y="-2" width="5" height="62" rx="2.5" fill={GOLD} />
      <rect x="-10" y="58" width="20" height="6" fill={GOLD_LIGHT} />
      <path d="M-5 80 L-5 180" stroke="#FFFFFF" strokeWidth="3" strokeLinecap="round" opacity="0.45" />
    </g>
  )
}

export function PenPair({ className }: ArtProps) {
  return (
    <svg viewBox="0 0 300 300" className={className} {...hidden}>
      <ellipse cx="150" cy="276" rx="80" ry="7" fill="#680C35" opacity="0.06" />
      <Pen x={112} y={34} r={-12} body="#F6B6C8" cap="#F09AB4" />
      <Pen x={170} y={44} r={-12} body="#FBD3DE" cap="#F6B6C8" />
    </svg>
  )
}

export function PenTrio({ className }: ArtProps) {
  return (
    <svg viewBox="0 0 300 300" className={className} {...hidden}>
      <ellipse cx="150" cy="276" rx="96" ry="7" fill="#680C35" opacity="0.06" />
      <Pen x={88} y={40} r={-12} body="#FFF0F2" cap="#FBD3DE" />
      <Pen x={136} y={32} r={-12} body="#F6B6C8" cap="#F09AB4" />
      <Pen x={184} y={42} r={-12} body="#FBD3DE" cap="#F6B6C8" />
    </svg>
  )
}
