import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { Checkbox, FormError, Loading, Notice, Pill, Select, TextArea, TextInput, useApiData } from '../../components/ui'
import { api, errorMessage, uploadAsset } from '../../lib/api'
import type { PublicStory } from '../../lib/story'
import { useUI } from '../../lib/ui'
import { isPlaceholderUrl, type StoryFeature } from '../../../shared/story'
import { FounderIntroView } from '../Home'
import { StoryHeader, StoryView, useFavorites } from '../OurStory'
import { PageTitle } from './AdminApp'

/*
  Content > Our Story. Everything here is the owner's own words; starter
  wording fills only fields she has never saved, for her to review. Edits are
  saved as a draft and visitors see only what was published. The home page
  introduction stays hidden until the first publish.
*/

type Draft = Omit<PublicStory, 'portraitUrl'> & { portraitKey: string | null; favoritesEnabled: boolean }
interface StoryDetail {
  draft: Draft
  published: Draft | null
  publishedAt: string | null
  unpublishedChanges: boolean
  problems: string[]
  uploadTarget: string
}
interface ProductRow {
  id: string
  title: string
  status: string
  active: boolean
  archived_at: string | null
}

const longFields: Array<{ key: keyof Draft; label: string; rows?: number; max: number; hint?: string }> = [
  { key: 'background', label: 'Nursing background', rows: 4, max: 3000 },
  { key: 'whyCreated', label: 'Why Nurse Love Company began', rows: 4, max: 3000 },
  { key: 'process', label: 'How each resource is made and reviewed', rows: 4, max: 3000, hint: 'Describe your real process only.' },
  { key: 'whoWeSupport', label: 'Who you hope to support', rows: 4, max: 2000 },
  { key: 'closing', label: 'Earlier closing message', rows: 3, max: 1500, hint: 'Shown only while the closing message above is empty.' },
]

const widths = { desktop: 'Desktop', tablet: 'Tablet', phone: 'Phone' } as const
type Width = keyof typeof widths
const pagePx: Record<Width, number> = { desktop: 1280, tablet: 820, phone: 390 }

/** Lays the preview out at a real screen width, then scales it down to fit the panel. */
function ScaledFrame({ width, children }: { width: Width; children: ReactNode }) {
  const outer = useRef<HTMLDivElement>(null)
  const inner = useRef<HTMLDivElement>(null)
  const [fit, setFit] = useState({ scale: 1, height: 0 })
  useLayoutEffect(() => {
    const measure = () => {
      if (!outer.current || !inner.current) return
      const scale = Math.min(1, outer.current.clientWidth / pagePx[width])
      setFit({ scale, height: inner.current.offsetHeight * scale })
    }
    measure()
    const ro = new ResizeObserver(measure)
    if (outer.current) ro.observe(outer.current)
    if (inner.current) ro.observe(inner.current)
    return () => ro.disconnect()
  }, [width])
  return (
    <div ref={outer} className="story-ed__frame-wrap" style={{ height: fit.height || undefined }}>
      <div ref={inner} className="story-ed__frame" style={{ width: pagePx[width], transform: `scale(${fit.scale})` }} inert>
        {children}
      </div>
    </div>
  )
}

export function StoryEditor() {
  const detail = useApiData<StoryDetail>('/api/admin/content/our-story')
  const productList = useApiData<{ products: ProductRow[] }>('/api/admin/products?status=all')
  const { showToast } = useUI()
  const [form, setForm] = useState<Draft | null>(null)
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [portraitVersion, setPortraitVersion] = useState(0)
  const [width, setWidth] = useState<Width>('desktop')
  const d = detail.data
  const favorites = useFavorites(form?.favoritesEnabled ? form.favoriteIds : [])

  useEffect(() => {
    if (d) {
      setForm(d.draft)
      setDirty(false)
    }
  }, [d])
  if (detail.error) return <FormError message={detail.error} />
  if (!d || !form) return <Loading />

  const update = (patch: Partial<Draft>) => {
    setForm((f) => (f ? { ...f, ...patch } : f))
    setDirty(true)
  }
  const set = (k: keyof Draft, v: string) => update({ [k]: v } as Partial<Draft>)
  const setFeature = (i: number, patch: Partial<StoryFeature>) => {
    const features = [0, 1, 2].map((n) => form.features[n] ?? { heading: '', text: '' })
    features[i] = { ...features[i], ...patch }
    update({ features })
  }
  const setFavorite = (slot: number, id: string) => {
    const ids = [0, 1, 2].map((n) => form.favoriteIds[n] ?? '')
    ids[slot] = id
    update({ favoriteIds: [...new Set(ids.filter(Boolean))] })
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
  const forSale = (productList.data?.products ?? []).filter((p) => p.status === 'published' && p.active && !p.archived_at)
  const titleOf = (id: string) => productList.data?.products.find((p) => p.id === id)?.title ?? 'A removed product'
  const placeholderKin = Boolean(form.nurseKinUrl && isPlaceholderUrl(form.nurseKinUrl))

  return (
    <>
      <PageTitle title="Our Story">
        <Pill value={live ? 'published' : 'draft'} label={live ? 'Published' : 'Not published yet'} />
      </PageTitle>
      <Notice>
        The page is titled "Meet the nurse behind the love". Write it in your own words. Fields you have never saved start with suggested wording for you to review; nothing reaches
        visitors until you publish. Empty sections are left out.
      </Notice>
      {live && (dirty || d.unpublishedChanges) && <Notice tone="warn">You have changes that are not live yet. Visitors see the published version until you publish.</Notice>}

      <div className="mk-editor">
        <section className="panel form-stack">
          <h2 className="panel__title">About the founder</h2>
          <TextInput label="Public display name" value={form.founderName} onChange={(v) => set('founderName', v)} maxLength={80} hint="Shown as “Meet …” beside the portrait." />
          <div className="form-grid">
            <TextInput label="Professional title (optional)" value={form.professionalTitle} onChange={(v) => set('professionalTitle', v)} maxLength={120} />
            <TextInput label="Credentials (optional)" value={form.credentials} onChange={(v) => set('credentials', v)} maxLength={200} hint="Only credentials she actually holds." />
          </div>
          <label className="field">
            <span className="field__label">Portrait</span>
            <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => { void upload(e.target.files?.[0]); e.target.value = '' }} />
            <span className="field__hint">A clear photo, ideally portrait shaped. It is stored privately and shown only after publishing.</span>
          </label>
          {form.portraitKey && <img className="story-ed__portrait" src={preview.portraitUrl!} alt="" />}
          <TextInput label="Portrait description (alt text)" value={form.portraitAlt} onChange={(v) => set('portraitAlt', v)} maxLength={200} hint='For example "Founder smiling in pink scrubs".' />
          <TextInput label="Speech bubble greeting" value={form.greeting} onChange={(v) => set('greeting', v)} maxLength={140} hint="A short hello beside the portrait. Leave empty to hide the bubble." />
          <TextArea
            label="Short founder introduction"
            value={form.introduction}
            onChange={(v) => set('introduction', v)}
            rows={5}
            maxLength={1500}
            hint="A few friendly sentences. No need for employers, dates or private details. Leave a blank line between paragraphs."
          />
        </section>

        <section className="panel form-stack">
          <h2 className="panel__title">About the store</h2>
          <TextInput label="Section heading" value={form.storeHeading} onChange={(v) => set('storeHeading', v)} maxLength={120} />
          <TextArea label="Store introduction" value={form.storeIntro} onChange={(v) => set('storeIntro', v)} rows={7} maxLength={1500} hint="Leave a blank line between paragraphs." />
          <fieldset className="form-stack">
            <legend className="field__label">Three feature cards</legend>
            {[0, 1, 2].map((i) => (
              <div key={i} className="form-grid">
                <TextInput label={`Card ${i + 1} heading`} value={form.features[i]?.heading ?? ''} onChange={(v) => setFeature(i, { heading: v })} maxLength={60} />
                <TextInput label={`Card ${i + 1} description`} value={form.features[i]?.text ?? ''} onChange={(v) => setFeature(i, { text: v })} maxLength={200} />
              </div>
            ))}
            <span className="field__hint">Icons: a page, a heart and a pen, in that order. Empty cards are left out.</span>
          </fieldset>
          <div className="form-grid">
            <TextInput label="Shop button label" value={form.shopLabel} onChange={(v) => set('shopLabel', v)} maxLength={40} hint="Leave empty to hide the button." />
            <TextInput label="Shop button destination" value={form.shopLink} onChange={(v) => set('shopLink', v)} placeholder="#shop" hint="A page on this site such as #shop, or a full https:// address." />
          </div>
        </section>

        <section className="panel form-stack">
          <h2 className="panel__title">Closing and extras</h2>
          <TextArea label="Closing message" value={form.closingNote} onChange={(v) => set('closingNote', v)} rows={3} maxLength={600} />
          <TextArea label="Signature" value={form.signature} onChange={(v) => set('signature', v)} rows={2} maxLength={80} hint="Shown in the handwritten style. A new line starts a second line." />

          <h3 className="panel__title">A few of my favorites (optional)</h3>
          <Checkbox
            label="Show “A few of my favorites” on the page"
            checked={form.favoritesEnabled}
            onChange={(v) => update({ favoritesEnabled: v })}
            hint="Shown only when this is on and at least one chosen product is published and for sale."
          />
          {[0, 1, 2].map((slot) => {
            const current = form.favoriteIds[slot] ?? ''
            const options = [{ value: '', label: 'None' }, ...forSale.map((p) => ({ value: p.id, label: p.title }))]
            if (current && !forSale.some((p) => p.id === current)) options.push({ value: current, label: `${titleOf(current)} (not for sale now, hidden)` })
            return <Select key={slot} label={`Favorite ${slot + 1}`} value={current} onChange={(v) => setFavorite(slot, v)} options={options} />
          })}

          <h3 className="panel__title">Nurse Kin (optional)</h3>
          <TextArea label="About Nurse Kin" value={form.nurseKinText} onChange={(v) => set('nurseKinText', v)} rows={3} maxLength={600} hint="Only your approved description." />
          <TextInput label="Nurse Kin link" value={form.nurseKinUrl} onChange={(v) => set('nurseKinUrl', v)} placeholder="https://..." hint="The real Nurse Kin address, starting with https://. Shown only with both a description and a real link." />
          {placeholderKin && <Notice tone="warn">This is a placeholder address, so Nurse Kin stays hidden. Add the real address, or clear the link and description.</Notice>}
        </section>

        <section className="panel form-stack">
          <h2 className="panel__title">Homepage introduction</h2>
          <TextArea
            label="Home page introduction"
            value={form.homeExcerpt}
            onChange={(v) => set('homeExcerpt', v)}
            rows={3}
            maxLength={400}
            hint="Two or three sentences, shown with the portrait between “A little extra cute” and The Freebie Corner, with a “Meet the founder” link."
          />
          <details className="story-ed__more">
            <summary>
              <strong>More of her story (optional)</strong>
            </summary>
            <div className="form-stack">
              <p className="muted">Longer sections, kept even while hidden. Turn them on to show them under “More of my story”.</p>
              <Checkbox label="Show these sections on the page" checked={form.showFullStory} onChange={(v) => update({ showFullStory: v })} />
              {longFields.map((f) => (
                <TextArea key={f.key} label={`${f.label} (optional)`} value={String(form[f.key] ?? '')} onChange={(v) => set(f.key, v)} rows={f.rows} maxLength={f.max} hint={f.hint} />
              ))}
            </div>
          </details>
        </section>
      </div>

      <section className="panel">
        <div className="story-ed__preview-bar">
          <div>
            <h2 className="panel__title">Preview</h2>
            <p className="muted">Your current edits, laid out at a real screen width as visitors would see them after publishing.</p>
          </div>
          <div className="segmented" role="group" aria-label="Preview width">
            {(Object.keys(widths) as Width[]).map((w) => (
              <button key={w} type="button" className={`button button--small ${width === w ? '' : 'button--outline'}`} aria-pressed={width === w} onClick={() => setWidth(w)}>
                {widths[w]}
              </button>
            ))}
          </div>
        </div>
        <div className="story-ed__preview">
          <p className="eyebrow">Our Story page</p>
          <ScaledFrame width={width}>
            <StoryHeader />
            <div className="container os-page">
              <StoryView story={preview} favorites={favorites} />
            </div>
          </ScaledFrame>
          <p className="eyebrow">Home page</p>
          <ScaledFrame width={width}>
            <FounderIntroView story={preview} />
          </ScaledFrame>
        </div>
      </section>

      {d.problems.length > 0 && <Notice tone="warn">Before it can be published (based on the last saved draft): {d.problems.join(' ')}</Notice>}
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
