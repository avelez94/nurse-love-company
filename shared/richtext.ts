/*
  Controlled rich text. Product descriptions and tutorial instructions are
  stored as a small JSON document (the Tiptap/ProseMirror shape), never as raw
  HTML. sanitizeDoc() keeps only the approved formatting:
    bold, italic, links (http, https, mailto), bulleted and numbered lists,
    two heading sizes, and a short list of font styles and text sizes.
  It runs on the server on every save and again in the browser before display.
*/

export const FONT_STYLES = ['display', 'script'] as const
export const TEXT_SIZES = ['small', 'large'] as const
export type FontStyle = (typeof FONT_STYLES)[number]
export type TextSize = (typeof TEXT_SIZES)[number]

export type Mark =
  | { type: 'bold' }
  | { type: 'italic' }
  | { type: 'link'; attrs: { href: string } }
  | { type: 'fontStyle'; attrs: { font: FontStyle } }
  | { type: 'textSize'; attrs: { size: TextSize } }

export type RichNode =
  | { type: 'doc'; content: RichNode[] }
  | { type: 'paragraph'; content?: RichNode[] }
  | { type: 'heading'; attrs: { level: 2 | 3 }; content?: RichNode[] }
  | { type: 'bulletList'; content: RichNode[] }
  | { type: 'orderedList'; content: RichNode[] }
  | { type: 'listItem'; content: RichNode[] }
  | { type: 'hardBreak' }
  | { type: 'text'; text: string; marks?: Mark[] }

export type RichDoc = { type: 'doc'; content: RichNode[] }

export const emptyDoc = (): RichDoc => ({ type: 'doc', content: [] })

const MAX_NODES = 4000
const MAX_TEXT = 40000

export function safeHref(href: unknown): string | null {
  if (typeof href !== 'string') return null
  const h = href.trim()
  if (h.length > 2000) return null
  if (/^(https?:\/\/|mailto:)/i.test(h)) return h
  if (/^#[a-z0-9-]*$/i.test(h)) return h
  return null
}

function sanitizeMarks(marks: unknown): Mark[] | undefined {
  if (!Array.isArray(marks)) return undefined
  const out: Mark[] = []
  const seen = new Set<string>()
  for (const m of marks) {
    if (!m || typeof m !== 'object') continue
    const type = (m as { type?: unknown }).type
    const attrs = ((m as { attrs?: Record<string, unknown> }).attrs ?? {}) as Record<string, unknown>
    if (typeof type !== 'string' || seen.has(type)) continue
    if (type === 'bold' || type === 'italic') out.push({ type })
    else if (type === 'link') {
      const href = safeHref(attrs.href)
      if (href) out.push({ type, attrs: { href } })
    } else if (type === 'fontStyle' && FONT_STYLES.includes(attrs.font as FontStyle)) out.push({ type, attrs: { font: attrs.font as FontStyle } })
    else if (type === 'textSize' && TEXT_SIZES.includes(attrs.size as TextSize)) out.push({ type, attrs: { size: attrs.size as TextSize } })
    else continue
    seen.add(type)
  }
  return out.length ? out : undefined
}

/** Returns a clean copy of any input, keeping only approved nodes, marks and attributes. */
export function sanitizeDoc(input: unknown): RichDoc {
  let nodes = 0
  let chars = 0
  const inline = (list: unknown): RichNode[] => {
    if (!Array.isArray(list)) return []
    const out: RichNode[] = []
    for (const n of list) {
      if (++nodes > MAX_NODES || !n || typeof n !== 'object') continue
      const t = (n as { type?: unknown }).type
      if (t === 'text') {
        const text = String((n as { text?: unknown }).text ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
        if (!text) continue
        chars += text.length
        if (chars > MAX_TEXT) continue
        const marks = sanitizeMarks((n as { marks?: unknown }).marks)
        out.push(marks ? { type: 'text', text, marks } : { type: 'text', text })
      } else if (t === 'hardBreak') out.push({ type: 'hardBreak' })
    }
    return out
  }
  const block = (n: unknown, depth: number): RichNode | null => {
    if (++nodes > MAX_NODES || !n || typeof n !== 'object' || depth > 6) return null
    const node = n as { type?: unknown; content?: unknown; attrs?: Record<string, unknown> }
    switch (node.type) {
      case 'paragraph':
        return { type: 'paragraph', content: inline(node.content) }
      case 'heading': {
        const level = node.attrs?.level === 3 ? 3 : 2
        return { type: 'heading', attrs: { level }, content: inline(node.content) }
      }
      case 'bulletList':
      case 'orderedList': {
        const items = (Array.isArray(node.content) ? node.content : [])
          .map((c) => block(c, depth + 1))
          .filter((c): c is RichNode => c !== null && c.type === 'listItem')
        return items.length ? { type: node.type, content: items } : null
      }
      case 'listItem': {
        const content = (Array.isArray(node.content) ? node.content : [])
          .map((c) => block(c, depth + 1))
          .filter((c): c is RichNode => c !== null && c.type !== 'listItem')
        return { type: 'listItem', content: content.length ? content : [{ type: 'paragraph', content: [] }] }
      }
      default:
        return null
    }
  }
  const root = input && typeof input === 'object' ? (input as { content?: unknown }).content : null
  const content = (Array.isArray(root) ? root : []).map((c) => block(c, 0)).filter((c): c is RichNode => c !== null)
  return { type: 'doc', content }
}

/** Plain text version, for search, summaries and emails. */
export function plainText(doc: RichDoc | null | undefined): string {
  const walk = (n: RichNode): string => {
    if (n.type === 'text') return n.text
    if (n.type === 'hardBreak') return '\n'
    const inner = ('content' in n && n.content ? n.content : []).map(walk).join(n.type === 'doc' || n.type.endsWith('List') ? '\n' : '')
    return inner
  }
  return doc ? walk(doc).trim() : ''
}

/** Builds a document from plain paragraphs (used by seed data). */
export function docFromParagraphs(paragraphs: string[]): RichDoc {
  return { type: 'doc', content: paragraphs.map((p) => ({ type: 'paragraph', content: p ? [{ type: 'text', text: p }] : [] })) }
}

export function docFromList(items: string[], ordered = true): RichDoc {
  return {
    type: 'doc',
    content: [
      {
        type: ordered ? 'orderedList' : 'bulletList',
        content: items.map((t) => ({ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] })),
      },
    ],
  }
}
