import { useEffect, useState } from 'react'
import { FormError, Loading, Notice, Pill, TextArea, TextInput, useApiData } from '../../components/ui'
import { api, errorMessage, uploadAsset } from '../../lib/api'
import type { PublicStory } from '../../lib/story'
import { useUI } from '../../lib/ui'
import { FounderIntroView } from '../Home'
import { StoryContent } from '../Simple'
import { PageTitle } from './AdminApp'

/*
  Content > Our Story. Everything here is the owner's own words. Edits are
  saved as a draft; visitors see only what was published, and the home page
  introduction stays hidden until the first publish.
*/

type Draft = Omit<PublicStory, 'portraitUrl'> & { portraitKey: string | null }
interface StoryDetail {
  draft: Draft
  published: Draft | null
  publishedAt: string | null
  unpublishedChanges: boolean
  problems: string[]
  uploadTarget: string
}

const fields: Array<{ key: keyof Draft; label: string; rows?: number; max: number; hint?: string }> = [
  { key: 'introduction', label: 'Introduction', rows: 4, max: 1500, hint: 'Opens the page. Leave a blank line between paragraphs.' },
  { key: 'background', label: 'Nursing background', rows: 5, max: 3000 },
  { key: 'whyCreated', label: 'Why Nurse Love Company began', rows: 5, max: 3000 },
  { key: 'process', label: 'How each resource is made and reviewed', rows: 5, max: 3000, hint: 'Describe your real process only.' },
  { key: 'whoWeSupport', label: 'Who you hope to support', rows: 4, max: 2000 },
  { key: 'closing', label: 'Closing message', rows: 3, max: 1500 },
]

export function StoryEditor() {
  const detail = useApiData<StoryDetail>('/api/admin/content/our-story')
  const { showToast } = useUI()
  const [form, setForm] = useState<Draft | null>(null)
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [portraitVersion, setPortraitVersion] = useState(0)
  const d = detail.data

  useEffect(() => {
    if (d) {
      setForm(d.draft)
      setDirty(false)
    }
  }, [d])
  if (detail.error) return <FormError message={detail.error} />
  if (!d || !form) return <Loading />

  const set = (k: keyof Draft, v: string) => {
    setForm((f) => (f ? { ...f, [k]: v } : f))
    setDirty(true)
  }
  const save = async (quiet = false) => {
    setBusy(true)
    setError('')
    try {
      await api('/api/admin/content/our-story', { method: 'PUT', body: form })
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
      await api(`/api/admin/content/our-story/${action}`, { body: {} })
      showToast(action === 'publish' ? 'Published. Our Story and the home page introduction are live.' : 'Unpublished. The page shows the general text again.')
      await detail.reload()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }
  const upload = async (file: File | undefined) => {
    if (!file) return
    setError('')
    try {
      await uploadAsset('story_portrait', d.uploadTarget, file)
      setPortraitVersion((v) => v + 1)
      await detail.reload()
      showToast('Portrait uploaded to the draft.')
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  const preview: PublicStory = { ...form, portraitUrl: form.portraitKey ? `/api/admin/content/our-story/portrait?v=${encodeURIComponent(form.portraitKey)}-${portraitVersion}` : null }
  const live = Boolean(d.published)

  return (
    <>
      <PageTitle title="Our Story">
        <Pill value={live ? 'published' : 'draft'} label={live ? 'Published' : 'Not published yet'} />
      </PageTitle>
      <Notice>
        The page is titled "Meet the nurse behind the love". Write it in your own words; nothing is filled in for you. Empty sections are left out. A short introduction with the portrait also
        appears on the home page, between "A little extra cute" and The Freebie Corner, once you publish.
      </Notice>
      {live && (dirty || d.unpublishedChanges) && <Notice tone="warn">You have changes that are not live yet. Visitors see the published version until you publish.</Notice>}

      <div className="mk-editor">
        <section className="panel form-stack">
          <h2 className="panel__title">About the founder</h2>
          <TextInput label="Founder name" value={form.founderName} onChange={(v) => set('founderName', v)} maxLength={80} />
          <div className="form-grid">
            <TextInput label="Professional title (optional)" value={form.professionalTitle} onChange={(v) => set('professionalTitle', v)} maxLength={120} />
            <TextInput label="Credentials (optional)" value={form.credentials} onChange={(v) => set('credentials', v)} maxLength={200} hint="Only credentials she actually holds." />
          </div>
          <label className="field">
            <span className="field__label">Portrait</span>
            <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => { void upload(e.target.files?.[0]); e.target.value = '' }} />
            <span className="field__hint">A clear photo, ideally square. It is stored privately and shown only after publishing.</span>
          </label>
          {form.portraitKey && <img className="story-ed__portrait" src={preview.portraitUrl!} alt="" />}
          <TextInput label="Portrait description (alt text)" value={form.portraitAlt} onChange={(v) => set('portraitAlt', v)} maxLength={200} hint='For example "Founder smiling in pink scrubs".' />
          <TextArea label="Home page introduction" value={form.homeExcerpt} onChange={(v) => set('homeExcerpt', v)} rows={3} maxLength={400} hint="Two or three sentences, shown on the home page with a “Meet the founder” link." />
        </section>

        <section className="panel form-stack">
          <h2 className="panel__title">Her story</h2>
          {fields.map((f) => (
            <TextArea key={f.key} label={f.label} value={String(form[f.key] ?? '')} onChange={(v) => set(f.key, v)} rows={f.rows} maxLength={f.max} hint={f.hint} />
          ))}
          <h3 className="panel__title">Nurse Kin (optional)</h3>
          <TextArea label="About Nurse Kin" value={form.nurseKinText} onChange={(v) => set('nurseKinText', v)} rows={3} maxLength={600} hint="Only your approved description." />
          <TextInput label="Nurse Kin link" value={form.nurseKinUrl} onChange={(v) => set('nurseKinUrl', v)} placeholder="https://..." hint="Must start with https://." />
        </section>
      </div>

      <section className="panel">
        <h2 className="panel__title">Preview</h2>
        <p className="muted">Your current edits, as visitors would see them after publishing.</p>
        <div className="story-ed__preview">
          <p className="eyebrow">Home page</p>
          <FounderIntroView story={preview} />
          <p className="eyebrow">Our Story page</p>
          <StoryContent story={preview} />
        </div>
      </section>

      {d.problems.length > 0 && (
        <Notice tone="warn">
          Before it can be published (based on the last saved draft): {d.problems.join(' ')}
        </Notice>
      )}
      <FormError message={error} />
      <div className="sticky-actions">
        <button type="button" className="button" disabled={busy} onClick={() => save()}>Save draft</button>
        <button type="button" className="button button--outline" disabled={busy || (!dirty && d.problems.length > 0)} onClick={() => act('publish')}>
          {live ? 'Publish changes' : 'Publish'}
        </button>
        {live && <button type="button" className="button button--outline" disabled={busy} onClick={() => act('unpublish')}>Unpublish</button>}
        {dirty && <span className="muted">Unsaved changes</span>}
      </div>
    </>
  )
}
