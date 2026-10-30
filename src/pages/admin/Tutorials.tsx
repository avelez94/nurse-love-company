import { Eye, FileVideo, ImagePlus, Plus, Trash2, Upload } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { api, ApiError, errorMessage, uploadAsset, uploadFile } from '../../lib/api'
import { href, navigate } from '../../lib/router'
import { toTutorial, type ApiTutorial } from '../../lib/store'
import { useUI } from '../../lib/ui'
import { Dialog } from '../../components/Dialog'
import { RichText } from '../../components/RichText'
import { RichTextEditor } from '../../components/RichTextEditor'
import { VideoPlayer } from '../../components/VideoPlayer'
import { Checkbox, Confirm, dateTime, Empty, FormError, Loading, Notice, Pill, ProgressBar, Select, TextArea, TextInput, useApiData } from '../../components/ui'
import { slugify } from './slug'
import { PageTitle } from './AdminApp'

const categories = [
  { value: 'np-binder', label: 'NP Binder' },
  { value: 'nurse-binder', label: 'Nurse Binder' },
  { value: 'printing-assembly', label: 'Printing & Assembly' },
  { value: 'digital-files', label: 'Using Your Digital Files' },
]

interface Row {
  id: string
  slug: string
  title: string
  category: string
  status: string
  featured: boolean
  display_order: number
  video_status: string
  video_provider: string | null
  video_error: string
  is_placeholder: boolean
  duration_seconds: number | null
  caption_count: number
  updated_at: string
}

export function TutorialsAdmin() {
  const { data, error, loading } = useApiData<{ tutorials: Row[]; provider: string }>('/api/admin/tutorials')
  return (
    <>
      <PageTitle title="Tutorials">
        <a className="button button--small" href={href('admin-tutorial-new')}>
          <Plus size={16} aria-hidden="true" /> New tutorial
        </a>
      </PageTitle>
      <Notice>Published tutorials are free to watch without an account. Drafts, unpublished and archived tutorials never appear publicly and their videos cannot be played from public links. Watching a tutorial never affects anyone's downloads.</Notice>
      {error && <FormError message={error} />}
      {loading && !data ? (
        <Loading />
      ) : !data?.tutorials.length ? (
        <Empty title="No tutorials yet">
          <a className="button button--small" href={href('admin-tutorial-new')}>Create the first tutorial</a>
        </Empty>
      ) : (
        <div className="data-table-wrap">
          <table className="data-table">
            <thead><tr><th>Tutorial</th><th>Category</th><th>Status</th><th>Video</th><th className="num">Order</th></tr></thead>
            <tbody>
              {data.tutorials.map((t) => (
                <tr key={t.id}>
                  <td>
                    <a href={href(`admin-tutorial-${t.id}`)}>{t.title}</a>
                    {t.featured && <span className="demo-tag">Featured</span>}
                    {t.is_placeholder && <span className="demo-tag">Placeholder video</span>}
                    <div className="muted">Updated {dateTime(t.updated_at)}</div>
                  </td>
                  <td>{categories.find((c) => c.value === t.category)?.label}</td>
                  <td><Pill value={t.status} /></td>
                  <td>
                    <Pill value={t.video_status} />
                    {t.video_provider && <span className="muted"> {t.video_provider}</span>}
                    {t.caption_count > 0 && <span className="muted"> • captions</span>}
                    {t.video_error && <div className="field__error">{t.video_error}</div>}
                  </td>
                  <td className="num">{t.display_order}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}

interface Detail {
  tutorial: Record<string, any> & { id: string; status: string; video_status: string; video_error: string; video_provider: string | null; embed_url: string | null; is_placeholder: boolean; thumbnail_key: string | null; instructions: unknown }
  preview: ApiTutorial
  uploads: Array<{ id: string; provider: string; status: string; file_name: string; bytes: number | null; error: string; created_at: string }>
  productIds: string[]
  muxConfigured: boolean
  videoUpload?: { convert: boolean; maxMb: number }
  provider: 'local' | 'mux'
}

type Form = { title: string; slug: string; category: string; summary: string; instructions: unknown; transcript: string; featured: boolean; display_order: number; product_ids: string[] }
const blank: Form = { title: '', slug: '', category: 'np-binder', summary: '', instructions: { type: 'doc', content: [] }, transcript: '', featured: false, display_order: 0, product_ids: [] }

const VIDEO_TYPES = ['video/mp4', 'video/quicktime', 'video/webm']

export function TutorialEditor({ id }: { id: string }) {
  const isNew = id === 'new'
  const { data, error, loading, reload } = useApiData<Detail>(isNew ? null : `/api/admin/tutorials/${id}`)
  const products = useApiData<{ products: Array<{ id: string; title: string; type: string; status: string }> }>('/api/admin/products?status=all')
  const { showToast } = useUI()
  const [form, setForm] = useState<Form>(blank)
  const [slugTouched, setSlugTouched] = useState(false)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [previewOpen, setPreviewOpen] = useState(false)
  const [confirm, setConfirm] = useState<null | 'archive' | 'unpublish'>(null)

  useEffect(() => {
    if (!data) return
    const t = data.tutorial
    setForm({ title: t.title, slug: t.slug, category: t.category, summary: t.summary, instructions: t.instructions, transcript: t.transcript, featured: t.featured, display_order: t.display_order, product_ids: data.productIds })
    setSlugTouched(true)
  }, [data])

  // While a video is processing, check back every few seconds.
  const processing = data?.tutorial.video_status === 'processing' || data?.tutorial.video_status === 'uploading'
  useEffect(() => {
    if (!processing) return
    const t = window.setInterval(() => void reload(), 3000)
    return () => window.clearInterval(t)
  }, [processing, reload])

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v, ...(k === 'title' && !slugTouched ? { slug: slugify(String(v)) } : {}) }))

  const save = async (e?: FormEvent) => {
    e?.preventDefault()
    setSaving(true)
    setFormError('')
    try {
      if (isNew) {
        const created = await api<{ id: string }>('/api/admin/tutorials', { body: form })
        showToast('Draft saved. Add the video next.')
        navigate(`admin-tutorial-${created.id}`)
      } else {
        await api(`/api/admin/tutorials/${id}`, { method: 'PUT', body: form })
        showToast('Draft saved.')
        await reload()
      }
    } catch (err) {
      setFormError(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  const status = async (action: 'publish' | 'unpublish' | 'archive' | 'restore') => {
    setFormError('')
    try {
      if (action === 'publish') await api(`/api/admin/tutorials/${id}`, { method: 'PUT', body: form })
      await api(`/api/admin/tutorials/${id}/${action}`, { method: 'POST' })
      showToast({ publish: 'Published. Anyone can watch it now.', unpublish: 'Unpublished. It is hidden and its video no longer plays publicly.', archive: 'Archived.', restore: 'Restored to draft.' }[action])
      reload()
    } catch (err) {
      setFormError(errorMessage(err))
    }
  }

  if (!isNew && loading && !data) return <Loading />
  if (error) return <FormError message={error} />
  const t = data?.tutorial

  return (
    <>
      <PageTitle title={isNew ? 'New tutorial' : form.title || 'Tutorial'} back={{ label: 'Tutorials', route: 'admin-tutorials' }} />
      {t && (
        <div className="status-line">
          <Pill value={t.status} />
          <span className="muted">Video:</span> <Pill value={t.video_status} />
          {t.is_placeholder && <span className="demo-tag">Placeholder video, not the owner's recording</span>}
          {t.status === 'published' && <a className="chip" href={href(`tutorial-${t.slug}`)} target="_blank" rel="noopener">View public page</a>}
        </div>
      )}
      <form className="admin-cols" onSubmit={save}>
        <div>
          <section className="panel form-stack">
            <h2 className="panel__title">Tutorial</h2>
            <TextInput label="Title" value={form.title} onChange={(v) => set('title', v)} maxLength={140} required />
            <TextInput label="URL slug" value={form.slug} onChange={(v) => { setSlugTouched(true); set('slug', v.toLowerCase()) }} hint={`Address: #tutorial-${form.slug || 'your-slug'}`} maxLength={100} />
            <TextArea label="Short description" value={form.summary} onChange={(v) => set('summary', v)} maxLength={300} rows={2} />
            <RichTextEditor label="Written instructions" value={form.instructions} onChange={(d) => set('instructions', d)} hint="Shown under the video. Use a numbered list for steps." />
            <TextArea label="Transcript" value={form.transcript} onChange={(v) => set('transcript', v)} rows={6} maxLength={60000} hint="Optional. If empty, the caption text is shown as the transcript." />
          </section>
          {!isNew && data && <VideoPanel data={data} reload={reload} />}
          {!isNew && data && <CaptionsPanel tutorialId={id} captions={data.preview.captions} reload={reload} />}
        </div>
        <div>
          <section className="panel form-stack">
            <h2 className="panel__title">Organization</h2>
            <Select label="Category" value={form.category} onChange={(v) => set('category', v)} options={categories} />
            <TextInput label="Display order" value={String(form.display_order)} onChange={(v) => set('display_order', Number(v.replace(/[^\d-]/g, '')) || 0)} hint="Lower numbers appear first." />
            <Checkbox label="Featured tutorial" checked={form.featured} onChange={(v) => set('featured', v)} hint="Shown at the top of the Tutorials page." />
          </section>
          <section className="panel form-stack">
            <h2 className="panel__title">Related products</h2>
            <p className="muted">These appear as helpful links on the watch page.</p>
            <div className="check-list">
              {products.data?.products.filter((p) => p.status === 'published').map((p) => (
                <Checkbox key={p.id} label={p.title} checked={form.product_ids.includes(p.id)} onChange={(v) => set('product_ids', v ? [...form.product_ids, p.id] : form.product_ids.filter((x) => x !== p.id))} />
              ))}
            </div>
          </section>
          {!isNew && data && <ThumbnailPanel tutorialId={id} hasCustom={Boolean(t?.thumbnail_key)} preview={data.preview.thumbnail} reload={reload} />}
        </div>
        <div className="sticky-actions" style={{ gridColumn: '1 / -1' }}>
          <button type="submit" className="button button--small" disabled={saving}>{saving ? 'Saving...' : 'Save draft'}</button>
          {t && (
            <>
              <button type="button" className="button button--outline button--small" onClick={() => setPreviewOpen(true)}>
                <Eye size={16} aria-hidden="true" /> Preview
              </button>
              {t.status !== 'published' && t.status !== 'archived' && <button type="button" className="button button--outline button--small" onClick={() => status('publish')}>Publish</button>}
              {t.status === 'published' && <button type="button" className="button button--outline button--small" onClick={() => setConfirm('unpublish')}>Unpublish</button>}
              {t.status !== 'archived' ? <button type="button" className="button button--outline button--small" onClick={() => setConfirm('archive')}>Archive</button> : <button type="button" className="button button--outline button--small" onClick={() => status('restore')}>Restore to draft</button>}
            </>
          )}
          <span className="spacer" />
          <FormError message={formError} />
        </div>
      </form>
      <Confirm
        open={Boolean(confirm)}
        title={confirm === 'archive' ? 'Archive this tutorial?' : 'Unpublish this tutorial?'}
        confirmLabel={confirm === 'archive' ? 'Archive' : 'Unpublish'}
        onClose={() => setConfirm(null)}
        onConfirm={async () => {
          const a = confirm!
          setConfirm(null)
          await status(a)
        }}
      >
        <p>It disappears from the Tutorials page and its video stops playing from public links. Nothing is deleted; you can publish it again later.</p>
      </Confirm>
      <Dialog open={previewOpen} onClose={() => setPreviewOpen(false)} title="Preview (not public)" variant="wide">
        {data && <TutorialPreview api={data.preview} form={form} />}
      </Dialog>
    </>
  )
}

function TutorialPreview({ api: tut, form }: { api: ApiTutorial; form: Form }) {
  const t = toTutorial({ ...tut, title: form.title, summary: form.summary, instructions: form.instructions })
  return (
    <div className="form-stack">
      <Notice tone="warn">Preview of your current draft. Only signed in admins can play this video before it is published.</Notice>
      <h2 className="panel__title">{t.title}</h2>
      <p className="muted">{t.summary}</p>
      {t.video ? <VideoPlayer video={t.video} captions={t.captions} title={t.title} /> : <Notice>No playable video yet.</Notice>}
      <p className="notice">These videos show how to use the inserts. <strong>Physical binders are not included</strong> with digital purchases.</p>
      <h3>Written instructions</h3>
      <RichText doc={t.instructions} className="watch__instructions" />
    </div>
  )
}

function VideoPanel({ data, reload }: { data: Detail; reload: () => void }) {
  const t = data.tutorial
  const [progress, setProgress] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [link, setLink] = useState(t.embed_url ?? '')
  const abort = useRef<AbortController | null>(null)
  const { showToast } = useUI()
  const useMux = data.provider === 'mux'
  const canConvert = data.videoUpload?.convert ?? true

  const upload = async (file: File | undefined) => {
    if (!file) return
    setError('')
    if (!useMux && !canConvert && file.type !== 'video/mp4') return setError('Please choose an MP4 video (H.264 video with AAC audio). This hosting plays MP4 without converting it; MOV and WebM need converting to MP4 first.')
    if (!VIDEO_TYPES.includes(file.type)) return setError('Please choose an MP4, MOV or WebM video file.')
    abort.current = new AbortController()
    setProgress(0)
    let muxUploadId: string | null = null
    try {
      if (useMux) {
        const created = await api<{ uploadId: string; url: string }>(`/api/admin/tutorials/${t.id}/video/mux-upload`, { body: { name: file.name, size: file.size, type: file.type } })
        muxUploadId = created.uploadId
        await uploadFile(created.url, file, { method: 'PUT', onProgress: setProgress, signal: abort.current.signal })
        showToast('Upload finished. Mux is preparing streaming versions; this page updates automatically.')
      } else {
        await uploadAsset('tutorial_video', t.id, file, { onProgress: setProgress, signal: abort.current.signal })
        showToast('Upload finished. The video is being checked; this page updates automatically.')
      }
    } catch (err) {
      const msg = errorMessage(err)
      setError(`${msg} Your draft is saved and unchanged. You can try the upload again.`)
      if (muxUploadId) await api(`/api/admin/tutorials/${t.id}/video/uploads/${muxUploadId}/failed`, { body: { message: msg } }).catch(() => {})
    } finally {
      setProgress(null)
      abort.current = null
      reload()
    }
  }

  const saveLink = async (value: string | null) => {
    setError('')
    try {
      await api(`/api/admin/tutorials/${t.id}/embed`, { method: 'PUT', body: { url: value } })
      showToast(value ? 'Hosted video link saved.' : 'Hosted video link removed.')
      reload()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : errorMessage(err))
    }
  }

  const latest = data.uploads[0]
  return (
    <section className="panel form-stack">
      <h2 className="panel__title"><FileVideo size={20} aria-hidden="true" /> Video</h2>
      {t.is_placeholder && <Notice tone="warn">This tutorial uses a short placeholder video. Upload the real recording to replace it.</Notice>}
      <div className="status-line">
        <span>Current status:</span> <Pill value={t.video_status} />
        {t.video_provider && <span className="muted">({t.video_provider === 'embed' ? 'hosted link' : t.video_provider === 'mux' ? 'Mux streaming' : 'stored on this server'})</span>}
        {t.duration_seconds && <span className="muted">{Math.round(t.duration_seconds)} seconds</span>}
      </div>
      {t.video_status === 'processing' && <Notice>Processing your video. This can take a few minutes for long videos. You can keep editing; the draft saves separately.</Notice>}
      {t.video_error && <FormError message={`Last upload problem: ${t.video_error}`} />}
      <div className="button-row">
        <label className="button button--small">
          <Upload size={16} aria-hidden="true" /> {t.video_status === 'ready' ? 'Replace video' : 'Upload video'}
          <input type="file" accept="video/mp4,video/quicktime,video/webm" hidden disabled={progress !== null} onChange={(e) => { void upload(e.target.files?.[0]); e.target.value = '' }} />
        </label>
        {progress !== null && <button type="button" className="button button--outline button--small" onClick={() => abort.current?.abort()}>Cancel upload</button>}
      </div>
      <p className="field__hint">
        {useMux
          ? 'MP4, MOV or WebM. Uploads go straight to Mux, which creates streaming versions and thumbnails.'
          : canConvert
            ? 'MP4, MOV or WebM. This server makes a web friendly MP4 and a poster image. For long videos, connect Mux.'
            : `MP4 only (H.264 video with AAC audio), up to ${data.videoUpload?.maxMb ?? 50} MB. The video plays exactly as uploaded, so export it with "optimize for web" or "fast start" turned on. For longer videos, connect Mux.`}{' '}
        A failed upload never changes your saved draft or a video that already works.
      </p>
      {progress !== null && <ProgressBar value={progress} label="Uploading" />}
      <FormError message={error} />
      <div className="form-stack">
        <TextInput label="Or use a hosted video link (YouTube or Vimeo)" value={link} onChange={setLink} placeholder="https://www.youtube.com/watch?v=..." maxLength={500} />
        <div className="button-row">
          <button type="button" className="button button--outline button--small" onClick={() => saveLink(link || null)} disabled={!link}>Save link</button>
          {t.embed_url && <button type="button" className="button button--outline button--small" onClick={() => { setLink(''); void saveLink(null) }}>Remove link</button>}
        </div>
      </div>
      {data.uploads.length > 0 && (
        <details open={latest?.status === 'failed'}>
          <summary>Upload history</summary>
          <ul className="timeline">
            {data.uploads.map((u) => (
              <li key={u.id}>
                <Pill value={u.status === 'uploaded' ? 'processing' : u.status} label={u.status} /> {u.file_name} <span className="muted">{dateTime(u.created_at)}</span>
                {u.error && <div className="field__error">{u.error}</div>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  )
}

function CaptionsPanel({ tutorialId, captions, reload }: { tutorialId: string; captions: Array<{ label: string; srclang: string }>; reload: () => void }) {
  const [label, setLabel] = useState('English')
  const [lang, setLang] = useState('en')
  const [error, setError] = useState('')
  const { showToast } = useUI()
  const upload = async (file: File | undefined) => {
    if (!file) return
    setError('')
    if (!file.name.toLowerCase().endsWith('.vtt')) return setError('Captions must be a WebVTT file ending in .vtt.')
    if (file.size > 512 * 1024) return setError('Caption files must be smaller than 512 KB.')
    try {
      await api(`/api/admin/tutorials/${tutorialId}/captions`, { method: 'PUT', body: { label, srclang: lang, vtt: await file.text() } })
      showToast(`${label} captions saved.`)
      reload()
    } catch (err) {
      setError(errorMessage(err))
    }
  }
  return (
    <section className="panel form-stack">
      <h2 className="panel__title">Captions</h2>
      {captions.length ? (
        <ul className="timeline">
          {captions.map((c) => (
            <li key={c.srclang}>
              {c.label} ({c.srclang})
              <button
                type="button"
                className="icon-button"
                aria-label={`Remove ${c.label} captions`}
                onClick={async () => {
                  await api(`/api/admin/tutorials/${tutorialId}/captions/${c.srclang}`, { method: 'DELETE' })
                  reload()
                }}
              >
                <Trash2 size={16} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <Notice tone="warn">No captions yet. Captions help many viewers and are recommended for every tutorial.</Notice>
      )}
      <div className="form-grid">
        <TextInput label="Caption label" value={label} onChange={setLabel} maxLength={40} />
        <TextInput label="Language code" value={lang} onChange={setLang} maxLength={10} hint="For example en or es" />
      </div>
      <label className="button button--outline button--small" style={{ justifySelf: 'start' }}>
        <Upload size={16} aria-hidden="true" /> Upload .vtt captions
        <input type="file" accept=".vtt,text/vtt" hidden onChange={(e) => { void upload(e.target.files?.[0]); e.target.value = '' }} />
      </label>
      <FormError message={error} />
    </section>
  )
}

function ThumbnailPanel({ tutorialId, hasCustom, preview, reload }: { tutorialId: string; hasCustom: boolean; preview: string | null; reload: () => void }) {
  const [progress, setProgress] = useState<number | null>(null)
  const [error, setError] = useState('')
  const upload = async (f: File | undefined) => {
    if (!f) return
    setError('')
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(f.type)) return setError('Please choose a PNG, JPG or WebP image.')
    try {
      setProgress(0)
      await uploadAsset('tutorial_thumbnail', tutorialId, f, { onProgress: setProgress })
      reload()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setProgress(null)
    }
  }
  return (
    <section className="panel form-stack">
      <h2 className="panel__title">Thumbnail</h2>
      {preview ? <img src={preview} alt="Current thumbnail" style={{ borderRadius: 12, border: '1px solid var(--border)' }} /> : <p className="muted">No thumbnail yet. The site shows a simple illustration, or the video's poster frame once processed.</p>}
      <label className="button button--outline button--small" style={{ justifySelf: 'start' }}>
        <ImagePlus size={16} aria-hidden="true" /> {hasCustom ? 'Replace thumbnail' : 'Upload thumbnail'}
        <input type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => { void upload(e.target.files?.[0]); e.target.value = '' }} />
      </label>
      {hasCustom && (
        <button
          type="button"
          className="button button--outline button--small"
          style={{ justifySelf: 'start' }}
          onClick={async () => {
            await api(`/api/admin/tutorials/${tutorialId}/thumbnail`, { method: 'DELETE' })
            reload()
          }}
        >
          Use the video's own frame instead
        </button>
      )}
      {progress !== null && <ProgressBar value={progress} label="Uploading" />}
      <FormError message={error} />
    </section>
  )
}
