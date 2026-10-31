import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { hasPlaceholder, policyProblems, publishedSnapshot, POLICY_META, type PolicyDraft, type PolicyKey, type PolicySection, type PublishedPolicy } from '../../../shared/policies'
import { Checkbox, dateTime, FormError, Loading, Notice, Pill, TextArea, TextInput, useApiData } from '../../components/ui'
import { api, errorMessage } from '../../lib/api'
import { href } from '../../lib/router'
import { useUI } from '../../lib/ui'
import { PolicyView } from '../Policy'
import { PageTitle } from './AdminApp'

/*
  Content > Policies. Terms & Conditions and the Privacy Policy, each a
  draft of sections the owner reviews one by one. Publishing needs every
  section marked reviewed and no [PLACEHOLDER] text. The starter drafts are
  suggestions describing how this store works, not legal advice.
*/

interface Services {
  environment: string
  payments: { state: string; webhook: boolean }
  email: { configured: boolean; webhook: boolean }
  storage: { driver: string; configured: boolean }
  video: { provider: string; configured: boolean }
  printful?: { configured: boolean; webhook: boolean }
}
interface Detail {
  key: PolicyKey
  title: string
  draft: PolicyDraft
  published: PublishedPolicy | null
  publishedAt: string | null
  updatedAt: string
  updatedBy: string | null
  problems: string[]
  unpublishedChanges: boolean
  services: Services
}

function ServicesPanel({ s }: { s: Services }) {
  const rows: Array<[string, string, boolean]> = [
    ['Vercel', 'Hosting', true],
    ['Supabase', s.storage.driver === 'supabase' ? 'Database and file storage' : 'Database', s.storage.driver === 'supabase' ? s.storage.configured : true],
    ['Stripe', 'Payments', s.payments.state === 'live' || s.payments.state === 'test'],
    ['Resend', 'Order and account emails, email list', s.email.configured],
    ['Mux', 'Tutorial video', s.video.provider === 'mux' && s.video.configured],
    ['Google Fonts', 'Website fonts', true],
  ]
  return (
    <details className="panel">
      <summary>
        <strong>Services: connected now and planned</strong>
      </summary>
      <p className="muted">Name only services that are actually in use when you publish. This list reflects this site right now.</p>
      <ul className="plain-list">
        {rows.map(([name, what, on]) => (
          <li key={name}>
            <strong>{name}</strong> ({what}): {on ? 'connected' : 'built in, not connected yet'}
          </li>
        ))}
        <li>
          <strong>Printful</strong> (makes and ships physical items): {s.printful?.configured ? 'connected' : 'built in, not connected yet'}
        </li>
        <li>
          <strong>Analytics</strong>: none in use
        </li>
      </ul>
    </details>
  )
}

const blankSection = (): PolicySection => ({ id: `section-${Math.random().toString(36).slice(2, 9)}`, heading: '', body: '', reviewed: false, ownerNote: '' })

export function PoliciesEditor({ policyKey }: { policyKey: PolicyKey }) {
  const detail = useApiData<Detail>(`/api/admin/content/policies/${policyKey}`)
  const { showToast } = useUI()
  const [form, setForm] = useState<PolicyDraft | null>(null)
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const d = detail.data

  useEffect(() => {
    if (d) {
      setForm(d.draft)
      setDirty(false)
    }
  }, [d])
  if (detail.error) return <FormError message={detail.error} />
  if (!d || !form) return <Loading />

  const update = (next: PolicyDraft) => {
    setForm(next)
    setDirty(true)
  }
  const setSection = (i: number, patch: Partial<PolicySection>) => update({ ...form, sections: form.sections.map((s, j) => (j === i ? { ...s, ...patch } : s)) })
  const move = (i: number, by: number) => {
    const list = [...form.sections]
    const [s] = list.splice(i, 1)
    list.splice(i + by, 0, s)
    update({ ...form, sections: list })
  }
  const save = async (quiet = false) => {
    setBusy(true)
    setError('')
    try {
      await api(`/api/admin/content/policies/${policyKey}`, { method: 'PUT', body: form })
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
      await api(`/api/admin/content/policies/${policyKey}/${action}`, { body: {} })
      showToast(action === 'publish' ? `Published. ${d.title} is live with today's date.` : `Unpublished. The page says it is being prepared.`)
      await detail.reload()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const problems = policyProblems(form)
  const reviewed = form.sections.filter((s) => s.reviewed).length
  const live = Boolean(d.published)

  return (
    <>
      <PageTitle title="Policies">
        <Pill value={live ? 'published' : 'draft'} label={live ? `Published ${dateTime(d.publishedAt)}` : 'Not published yet'} />
      </PageTitle>
      <nav className="chip-row policy-ed__tabs" aria-label="Choose a policy">
        {(Object.keys(POLICY_META) as PolicyKey[]).map((k) => (
          <a key={k} className="chip" href={href(`admin-policy-${k}`)} aria-current={k === policyKey ? 'page' : undefined}>
            {POLICY_META[k].title}
          </a>
        ))}
      </nav>
      <Notice tone="warn">
        These are starter drafts written from how this store works. They are not legal advice and have not been reviewed by a lawyer. Replace every [BRACKETED] item with your own
        details, read each section, and consider asking a qualified adviser before publishing. Publishing does not make a policy legally approved.
      </Notice>
      {live && (dirty || d.unpublishedChanges) && <Notice tone="warn">You have changes that are not live yet. Visitors see the version published {dateTime(d.publishedAt)} until you publish again.</Notice>}
      <ServicesPanel s={d.services} />

      <section className="panel form-stack">
        <h2 className="panel__title">{d.title}</h2>
        <p className="muted">
          {reviewed} of {form.sections.length} sections reviewed. Last saved {dateTime(d.updatedAt)}
          {d.updatedBy ? ` by ${d.updatedBy}` : ''}. Visitors see it at <a href={href(POLICY_META[policyKey].route)} target="_blank" rel="noopener">#{POLICY_META[policyKey].route}</a>.
        </p>
        <TextArea label="Introduction (optional)" value={form.intro} onChange={(v) => update({ ...form, intro: v })} rows={2} maxLength={2000} />
        <p className="field__hint">
          In sections, leave a blank line between paragraphs, start list items with "* ", and write links as [label](#help) or [label](https://...).
        </p>
      </section>

      {form.sections.map((s, i) => {
        const placeholder = hasPlaceholder(`${s.heading}\n${s.body}`)
        return (
          <section key={s.id} className="panel form-stack policy-ed__section" aria-label={s.heading || `Section ${i + 1}`}>
            <div className="policy-ed__head">
              <span className="eyebrow">Section {i + 1}</span>
              {placeholder ? <Pill value="failed" label="Has placeholders" /> : s.reviewed ? <Pill value="published" label="Reviewed" /> : <Pill value="pending" label="Needs review" />}
              <span className="policy-ed__tools">
                <button type="button" className="icon-button" aria-label={`Move "${s.heading || `section ${i + 1}`}" up`} disabled={i === 0} onClick={() => move(i, -1)}>
                  <ArrowUp size={16} aria-hidden="true" />
                </button>
                <button type="button" className="icon-button" aria-label={`Move "${s.heading || `section ${i + 1}`}" down`} disabled={i === form.sections.length - 1} onClick={() => move(i, 1)}>
                  <ArrowDown size={16} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`Remove "${s.heading || `section ${i + 1}`}"`}
                  onClick={() => window.confirm('Remove this section from the draft?') && update({ ...form, sections: form.sections.filter((_, j) => j !== i) })}
                >
                  <Trash2 size={16} aria-hidden="true" />
                </button>
              </span>
            </div>
            <TextInput label="Heading" value={s.heading} onChange={(v) => setSection(i, { heading: v, reviewed: false })} maxLength={120} />
            <TextArea label="Text" value={s.body} onChange={(v) => setSection(i, { body: v, reviewed: false })} rows={Math.min(14, Math.max(4, Math.ceil(s.body.length / 90) + 2))} maxLength={8000} />
            <TextInput label="Private note (never published)" value={s.ownerNote} onChange={(v) => setSection(i, { ownerNote: v })} maxLength={1000} />
            <Checkbox
              label="I have reviewed this section and it is accurate for my store"
              checked={s.reviewed}
              onChange={(v) => setSection(i, { reviewed: v })}
              hint={placeholder ? 'Replace the [BRACKETED] text first.' : 'Editing the heading or text clears this, so changes are always reviewed.'}
            />
          </section>
        )
      })}
      <button type="button" className="button button--outline button--small" onClick={() => update({ ...form, sections: [...form.sections, blankSection()] })}>
        <Plus size={16} aria-hidden="true" /> Add a section
      </button>

      <section className="panel">
        <h2 className="panel__title">Preview</h2>
        <p className="muted">Your current edits as visitors would see them, dated today. Unfinished sections are shown so you can read them; they cannot be published.</p>
        <div className="story-ed__preview" inert>
          <PolicyView policy={publishedSnapshot(form, new Date())} />
        </div>
      </section>

      {problems.length > 0 && (
        <Notice tone="warn">
          <strong>Before it can be published:</strong>
          <ul className="plain-list">
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </Notice>
      )}
      <FormError message={error} />
      <div className="sticky-actions">
        <button type="button" className="button" disabled={busy} onClick={() => save()}>Save draft</button>
        <button type="button" className="button button--outline" disabled={busy || problems.length > 0} onClick={() => act('publish')}>
          {live ? 'Publish changes' : 'Publish'}
        </button>
        {live && <button type="button" className="button button--outline" disabled={busy} onClick={() => act('unpublish')}>Unpublish</button>}
        {dirty && <span className="muted">Unsaved changes</span>}
      </div>
    </>
  )
}
