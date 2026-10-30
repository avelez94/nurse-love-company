import { Fragment, type ReactNode } from 'react'
import { safeHref, sanitizeDoc, type Mark, type RichNode } from '../../shared/richtext'
import './RichText.css'

/* Renders a stored rich text document as React elements. Never uses innerHTML. */

function withMarks(text: ReactNode, marks: Mark[] = []): ReactNode {
  return marks.reduce<ReactNode>((child, m) => {
    switch (m.type) {
      case 'bold':
        return <strong>{child}</strong>
      case 'italic':
        return <em>{child}</em>
      case 'link': {
        const href = safeHref(m.attrs.href)
        if (!href) return child
        const external = /^https?:/.test(href)
        return (
          <a href={href} {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>
            {child}
          </a>
        )
      }
      case 'fontStyle':
        return <span className={`rt-font-${m.attrs.font}`}>{child}</span>
      case 'textSize':
        return <span className={`rt-size-${m.attrs.size}`}>{child}</span>
    }
    return child
  }, text)
}

function node(n: RichNode, key: number): ReactNode {
  const kids = 'content' in n && n.content ? n.content.map(node) : null
  switch (n.type) {
    case 'text':
      return <Fragment key={key}>{withMarks(n.text, n.marks)}</Fragment>
    case 'hardBreak':
      return <br key={key} />
    case 'paragraph':
      return <p key={key}>{kids}</p>
    case 'heading':
      return n.attrs.level === 3 ? <h4 key={key}>{kids}</h4> : <h3 key={key}>{kids}</h3>
    case 'bulletList':
      return <ul key={key}>{kids}</ul>
    case 'orderedList':
      return <ol key={key}>{kids}</ol>
    case 'listItem':
      return <li key={key}>{kids}</li>
    default:
      return null
  }
}

export function RichText({ doc, className = '' }: { doc: unknown; className?: string }) {
  const clean = sanitizeDoc(doc)
  if (!clean.content.length) return null
  return <div className={`rich-text ${className}`}>{clean.content.map(node)}</div>
}
