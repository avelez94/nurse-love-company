import { Mark, mergeAttributes } from '@tiptap/core'
import { EditorContent, useEditor, useEditorState } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { Bold, Heading2, Heading3, Italic, Link as LinkIcon, List, ListOrdered, Pilcrow, Unlink } from 'lucide-react'
import { useEffect, useId, useState } from 'react'
import { FONT_STYLES, safeHref, sanitizeDoc, TEXT_SIZES, type RichDoc } from '../../shared/richtext'
import './RichTextEditor.css'

/*
  Controlled rich text editor. Only the approved formatting exists in the
  editor at all: bold, italic, lists, links, two heading sizes, two font
  styles and two text sizes. Pasted content is reduced to the same set, and
  the server sanitizes again on save.
*/

const FontStyle = Mark.create({
  name: 'fontStyle',
  addAttributes() {
    return { font: { default: 'display', parseHTML: (el) => el.getAttribute('data-font'), renderHTML: (a) => ({ 'data-font': a.font, class: `rt-font-${a.font}` }) } }
  },
  parseHTML() {
    return [{ tag: 'span[data-font]', getAttrs: (el) => (FONT_STYLES.includes((el as HTMLElement).getAttribute('data-font') as never) ? null : false) }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes), 0]
  },
})

const TextSize = Mark.create({
  name: 'textSize',
  addAttributes() {
    return { size: { default: 'large', parseHTML: (el) => el.getAttribute('data-size'), renderHTML: (a) => ({ 'data-size': a.size, class: `rt-size-${a.size}` }) } }
  },
  parseHTML() {
    return [{ tag: 'span[data-size]', getAttrs: (el) => (TEXT_SIZES.includes((el as HTMLElement).getAttribute('data-size') as never) ? null : false) }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes), 0]
  },
})

const fontLabels: Record<string, string> = { '': 'Body text', display: 'Elegant serif', script: 'Handwritten script' }
const sizeLabels: Record<string, string> = { '': 'Normal size', small: 'Small', large: 'Large' }

export function RichTextEditor({ label, value, onChange, hint }: { label: string; value: unknown; onChange: (doc: RichDoc) => void; hint?: string }) {
  const labelId = useId()
  const [linkOpen, setLinkOpen] = useState(false)
  const [linkUrl, setLinkUrl] = useState('')
  const [linkError, setLinkError] = useState('')

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
        blockquote: false,
        code: false,
        codeBlock: false,
        strike: false,
        underline: false,
        horizontalRule: false,
        link: { openOnClick: false, autolink: true, protocols: ['mailto'], defaultProtocol: 'https', isAllowedUri: (url) => Boolean(safeHref(url)) },
      }),
      FontStyle,
      TextSize,
    ],
    content: sanitizeDoc(value),
    editorProps: { attributes: { 'aria-labelledby': labelId, 'aria-multiline': 'true', role: 'textbox', class: 'rte__content rich-text' } },
    onUpdate: ({ editor: e }) => onChange(sanitizeDoc(e.getJSON())),
  })

  // Load new content when switching between records.
  useEffect(() => {
    if (!editor) return
    const next = sanitizeDoc(value)
    if (JSON.stringify(sanitizeDoc(editor.getJSON())) !== JSON.stringify(next)) editor.commands.setContent(next, { emitUpdate: false })
  }, [value, editor])

  const state = useEditorState({
    editor,
    selector: ({ editor: e }) =>
      e
        ? {
            bold: e.isActive('bold'),
            italic: e.isActive('italic'),
            bullet: e.isActive('bulletList'),
            ordered: e.isActive('orderedList'),
            h2: e.isActive('heading', { level: 2 }),
            h3: e.isActive('heading', { level: 3 }),
            link: e.isActive('link'),
            font: (e.getAttributes('fontStyle').font as string) ?? '',
            size: (e.getAttributes('textSize').size as string) ?? '',
          }
        : null,
  })

  if (!editor || !state) return null

  const btn = (active: boolean, label: string, onClick: () => void, icon: React.ReactNode) => (
    <button type="button" className="rte__btn" aria-pressed={active} aria-label={label} title={label} onMouseDown={(e) => e.preventDefault()} onClick={onClick}>
      {icon}
    </button>
  )

  const applyLink = () => {
    const href = safeHref(linkUrl.trim().match(/^[a-z]+:|^#/i) ? linkUrl.trim() : `https://${linkUrl.trim()}`)
    if (!href) return setLinkError('Use a web address (https://...) or an email (mailto:...).')
    editor.chain().focus().extendMarkRange('link').setLink({ href }).run()
    setLinkOpen(false)
    setLinkUrl('')
    setLinkError('')
  }

  return (
    <div className="rte">
      <span id={labelId} className="field__label">
        {label}
      </span>
      <div className="rte__toolbar" role="toolbar" aria-label={`${label} formatting`}>
        {btn(state.bold, 'Bold', () => editor.chain().focus().toggleBold().run(), <Bold size={18} />)}
        {btn(state.italic, 'Italic', () => editor.chain().focus().toggleItalic().run(), <Italic size={18} />)}
        <span className="rte__sep" />
        {btn(!state.h2 && !state.h3, 'Paragraph', () => editor.chain().focus().setParagraph().run(), <Pilcrow size={18} />)}
        {btn(state.h2, 'Heading', () => editor.chain().focus().toggleHeading({ level: 2 }).run(), <Heading2 size={18} />)}
        {btn(state.h3, 'Small heading', () => editor.chain().focus().toggleHeading({ level: 3 }).run(), <Heading3 size={18} />)}
        <span className="rte__sep" />
        {btn(state.bullet, 'Bulleted list', () => editor.chain().focus().toggleBulletList().run(), <List size={18} />)}
        {btn(state.ordered, 'Numbered list', () => editor.chain().focus().toggleOrderedList().run(), <ListOrdered size={18} />)}
        <span className="rte__sep" />
        {btn(state.link, 'Add link', () => setLinkOpen((o) => !o), <LinkIcon size={18} />)}
        {state.link && btn(false, 'Remove link', () => editor.chain().focus().unsetLink().run(), <Unlink size={18} />)}
        <span className="rte__sep" />
        <select
          className="rte__select"
          aria-label="Font style"
          value={state.font}
          onChange={(e) => {
            const v = e.target.value
            if (v) editor.chain().focus().setMark('fontStyle', { font: v }).run()
            else editor.chain().focus().unsetMark('fontStyle').run()
          }}
        >
          {['', ...FONT_STYLES].map((f) => (
            <option key={f} value={f}>
              {fontLabels[f]}
            </option>
          ))}
        </select>
        <select
          className="rte__select"
          aria-label="Text size"
          value={state.size}
          onChange={(e) => {
            const v = e.target.value
            if (v) editor.chain().focus().setMark('textSize', { size: v }).run()
            else editor.chain().focus().unsetMark('textSize').run()
          }}
        >
          {['', ...TEXT_SIZES].map((s) => (
            <option key={s} value={s}>
              {sizeLabels[s]}
            </option>
          ))}
        </select>
      </div>
      {linkOpen && (
        <div className="rte__link">
          <input className="input" placeholder="https://example.com" value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} aria-label="Link address" onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), applyLink())} />
          <button type="button" className="button button--small" onClick={applyLink}>Apply link</button>
          {linkError && <p className="field__error">{linkError}</p>}
        </div>
      )}
      <EditorContent editor={editor} />
      {hint && <p className="field__hint">{hint}</p>}
    </div>
  )
}
