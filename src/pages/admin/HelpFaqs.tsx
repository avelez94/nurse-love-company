import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { applyConditions, hasPlaceholder, publishedSnapshot, type FaqCategory, type FaqContent, type FaqQuestion, type PublicFaq } from '../../../shared/faq'
import { HelpView } from '../../components/HelpFaq'
import { Checkbox, dateTime, FormError, Loading, Notice, Pill, Select, TextArea, TextInput, useApiData } from '../../components/ui'
import { api, errorMessage } from '../../lib/api'
import { useUI } from '../../lib/ui'
import { PageTitle } from './AdminApp'

/*
  Content > Help & FAQs. The owner edits a draft. Publish shows visitors
  only the questions she approved; answers with a placeholder in
  [BRACKETS] cannot be approved. Owner notes never leave the admin.
*/

interface HelpDetail {
  draft: FaqContent
  published: PublicFaq | null
  publishedAt: string | null
  updatedAt: string
  updatedBy: string | null
  counts: { questions: number; approved: number; needsConfirmation: number }
  unpublishedChanges: boolean
}

const newId = (p: string) => `${p}${Math.random().toString(36).slice(2, 8)}`
const move = <T,>(list: T[], i: number, by: number) => {
  const j = i + by
  if (j < 0 || j >= list.length) return list
  const next = [...list]
  ;[next[i], next[j]] = [next[j], next[i]]
  return next
}

function Order({ i, n, what, onMove, onRemove, canRemove = true }: { i: number; n: number; what: string; onMove: (by: number) => void; onRemove: () => void; canRemove?: boolean }) {
  return (
    <div className="quiz-ed__order">
      <button type="button" className="icon-button" aria-label={`Move ${what} up`} disabled={i === 0} onClick={() => onMove(-1)}>
        <ArrowUp size={16} aria-hidden="true" />
      </button>
      <button type="button" className="icon-button" aria-label={`Move ${what} down`} disabled={i === n - 1} onClick={() => onMove(1)}>
        <ArrowDown size={16} aria-hidden="true" />
      </button>
      <button type="button" className="icon-button" aria-label={`Delete ${what}`} disabled={!canRemove} onClick={onRemove}>
        <Trash2 size={16} aria-hidden="true" />
      </button>
    </div>
  )
}

export function HelpFaqsEditor() {
  const detail = useApiData<HelpDetail>('/api/admin/content/help')
  const { showToast } = useUI()
  const [c, setC] = useState<FaqContent | null>(null)
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const d = detail.data

  useEffect(() => {
    if (d) {
      setC(d.draft)
      setDirty(false)
    }
  }, [d])
  const preview = useMemo(() => (c ? applyConditions(publishedSnapshot(c), { quiz: true, tutorials: true }) : null), [c])

  if (detail.error) return <FormError message={detail.error} />
  if (!d || !c) return <Loading />

  const update = (fn: (x: FaqContent) => FaqContent) => {
    setC((prev) => (prev ? fn(prev) : prev))
    setDirty(true)
  }
  const setCat = (ci: number, patch: Partial<FaqCategory>) => update((x) => ({ ...x, categories: x.categories.map((cat, i) => (i === ci ? { ...cat, ...patch } : cat)) }))
  const setQ = (ci: number, qi: number, patch: Partial<FaqQuestion>) =>
    update((x) => ({ ...x, categories: x.categories.map((cat, i) => (i === ci ? { ...cat, questions: cat.questions.map((q, j) => (j === qi ? { ...q, ...patch } : q)) } : cat)) }))
  const moveTo = (ci: number, qi: number, targetId: string) =>
    update((x) => {
      const q = x.categories[ci].questions[qi]
      return {
        ...x,
        categories: x.categories.map((cat, i) =>
          i === ci ? { ...cat, questions: cat.questions.filter((_, j) => j !== qi) } : cat.id === targetId ? { ...cat, questions: [...cat.questions, q] } : cat,
        ),
      }
    })

  const save = async (quiet = false) => {
    setBusy(true)
    setError('')
    try {
      await api('/api/admin/content/help', { method: 'PUT', body: c })
      if (!quiet) showToast(d.published ? 'Draft saved. Visitors see the published version until you publish.' : 'Draft saved.')
      await detail.reload()
      return true
    } catch (err) {
      setError(errorMessage(err))
      return false
    } finally {
      setBusy(false)
    }
  }
  const act = async (action: 'publish' | 'unpublish') => {
    if (dirty && !(await save(true))) return
    setBusy(true)
    setError('')
    try {
      await api(`/api/admin/content/help/${action}`, { body: {} })
      showToast(action === 'publish' ? 'Published. Only approved questions are visible.' : 'Unpublished. The Help page shows only the contact card.')
      await detail.reload()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const approvedNow = c.categories.flatMap((x) => x.questions).filter((q) => q.approved).length
  const live = Boolean(d.published)
  const contactKeys: Array<[keyof FaqContent['contact'], string, string]> = [
    ['email', 'Contact email', 'For example help@yourdomain.com'],
    ['hours', 'Support hours', 'For example Monday to Friday, 9 to 5'],
    ['timezone', 'Timezone', 'For example Eastern Time'],
    ['responseTime', 'Response time wording', 'For example "We aim to reply within two business days."'],
  ]

  return (
    <>
      <PageTitle title="Help & FAQs">
        <Pill value={live ? 'published' : 'draft'} label={live ? 'Published' : 'Not published'} />
      </PageTitle>
      <Notice>
        Visitors only ever see questions you mark <strong>Approved</strong> and then <strong>Publish</strong>. The starter answers are drafts: check each one against how the store really works,
        replace anything in [BRACKETS], then approve it. Owner notes are only visible here. {approvedNow} of {d.counts.questions} questions are approved.
      </Notice>
      {live && (dirty || d.unpublishedChanges) && <Notice tone="warn">You have changes that are not live yet. Visitors see the published version until you press Publish changes.</Notice>}

      <section className="panel form-stack">
        <h2 className="panel__title">Page</h2>
        <TextInput label="Heading" value={c.heading} onChange={(v) => update((x) => ({ ...x, heading: v }))} maxLength={100} />
        <TextInput label="Introduction" value={c.intro} onChange={(v) => update((x) => ({ ...x, intro: v }))} maxLength={300} />
      </section>

      <section className="panel form-stack">
        <h2 className="panel__title">Contact card</h2>
        <p className="muted">Only filled in fields without [BRACKETS] are shown. "Message us from your account" is always shown.</p>
        <div className="form-grid">
          {contactKeys.map(([k, label, hint]) => (
            <TextInput key={k} label={label} value={c.contact[k]} onChange={(v) => update((x) => ({ ...x, contact: { ...x.contact, [k]: v } }))} maxLength={k === 'responseTime' ? 160 : 120} hint={hasPlaceholder(c.contact[k]) ? 'Still a placeholder: hidden from visitors.' : hint} />
          ))}
        </div>
      </section>

      <section className="panel form-stack">
        <div className="panel__head">
          <h2 className="panel__title">Categories and questions</h2>
          <button type="button" className="button button--outline button--small" onClick={() => update((x) => ({ ...x, categories: [...x.categories, { id: newId('c'), title: 'New category', questions: [] }] }))}>
            <Plus size={16} aria-hidden="true" /> Add category
          </button>
        </div>
        <p className="muted">
          Answers are plain text; leave a blank line between paragraphs. Links: <code>[label](#account-downloads)</code> for a page on this site or <code>[label](https://...)</code>. <code>[label](#find-my-resources)</code> opens
          the resource quiz. Start a paragraph with <code>{'{{if quiz}}'}</code> or <code>{'{{if tutorials}}'}</code> to show it only while a quiz or a tutorial is published. Empty categories are hidden.
        </p>
        {c.categories.map((cat, ci) => (
          <div key={cat.id} className="quiz-ed__card">
            <div className="quiz-ed__card-head">
              <TextInput label={`Category ${ci + 1}`} value={cat.title} onChange={(v) => setCat(ci, { title: v })} maxLength={80} />
              <Order i={ci} n={c.categories.length} what={`category ${cat.title}`} canRemove={!cat.questions.length} onMove={(by) => update((x) => ({ ...x, categories: move(x.categories, ci, by) }))} onRemove={() => update((x) => ({ ...x, categories: x.categories.filter((_, i) => i !== ci) }))} />
            </div>
            {cat.questions.map((q, qi) => {
              const placeholder = hasPlaceholder(`${q.question}\n${q.answer}`)
              return (
                <details key={q.id} className="help-ed__q">
                  <summary>
                    <span>{q.question || 'New question'}</span>
                    {q.approved ? <Pill value="published" label="Approved" /> : <Pill value="draft" label={q.needsConfirmation ? 'Owner to confirm' : 'Draft'} />}
                  </summary>
                  <div className="form-stack">
                    {q.ownerNote && <Notice tone="warn">Owner note: {q.ownerNote}</Notice>}
                    <TextInput label="Question" value={q.question} onChange={(v) => setQ(ci, qi, { question: v })} maxLength={200} />
                    <TextArea label="Answer" value={q.answer} onChange={(v) => setQ(ci, qi, { answer: v, approved: hasPlaceholder(`${q.question}\n${v}`) ? false : q.approved })} rows={6} maxLength={3000} />
                    <TextInput label="Search keywords (optional)" value={q.keywords.join(', ')} onChange={(v) => setQ(ci, qi, { keywords: v.split(',').map((k) => k.trim()).filter(Boolean) })} hint="Comma separated, including other words people might use, for example: coupon, promo." />
                    <div className="form-grid">
                      <Select label="Category" value={cat.id} onChange={(v) => v !== cat.id && moveTo(ci, qi, v)} options={c.categories.map((x) => ({ value: x.id, label: x.title || 'Untitled' }))} />
                      <TextInput label="Owner note (only shown here)" value={q.ownerNote} onChange={(v) => setQ(ci, qi, { ownerNote: v })} maxLength={600} />
                    </div>
                    <Checkbox
                      label="Approved: I checked this answer and it can be published"
                      checked={q.approved}
                      onChange={(v) => setQ(ci, qi, { approved: v && !placeholder })}
                      hint={placeholder ? 'Replace the text in [BRACKETS] before approving.' : q.needsConfirmation && !q.approved ? 'This starter answer needs your confirmation before it can be published.' : undefined}
                    />
                    <Order i={qi} n={cat.questions.length} what={`question ${q.question}`} onMove={(by) => setCat(ci, { questions: move(cat.questions, qi, by) })} onRemove={() => setCat(ci, { questions: cat.questions.filter((_, j) => j !== qi) })} />
                  </div>
                </details>
              )
            })}
            <button
              type="button"
              className="button button--outline button--small"
              onClick={() => setCat(ci, { questions: [...cat.questions, { id: newId('q'), question: '', answer: '', keywords: [], approved: false, needsConfirmation: false, ownerNote: '' }] })}
            >
              <Plus size={16} aria-hidden="true" /> Add question
            </button>
          </div>
        ))}
      </section>

      <section className="panel">
        <h2 className="panel__title">Preview</h2>
        <p className="muted">Approved questions only, as visitors will see them after you publish. Conditional sentences are shown as if a quiz and tutorials are published. Links do nothing here.</p>
        <div className="help-ed__previews">
          <figure className="mk-preview">
            <figcaption>Computer</figcaption>
            <div className="help-ed__frame">{preview && <HelpView help={preview} preview />}</div>
          </figure>
          <figure className="mk-preview">
            <figcaption>Phone</figcaption>
            <div className="help-ed__frame help-ed__frame--phone">{preview && <HelpView help={preview} preview narrow />}</div>
          </figure>
        </div>
      </section>

      <FormError message={error} />
      <div className="sticky-actions">
        <button type="button" className="button" disabled={busy} onClick={() => save()}>Save draft</button>
        <button type="button" className="button button--outline" disabled={busy} onClick={() => act('publish')}>{live ? 'Publish changes' : 'Publish'}</button>
        {live && <button type="button" className="button button--outline" disabled={busy} onClick={() => act('unpublish')}>Unpublish</button>}
        {dirty && <span className="muted">Unsaved changes</span>}
        {d.publishedAt && <span className="muted">Last published {dateTime(d.publishedAt)}</span>}
      </div>
    </>
  )
}
