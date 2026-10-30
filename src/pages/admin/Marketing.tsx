import { Copy, HeartHandshake, Plus } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { AnnouncementView, PromoView } from '../../components/Marketing'
import { NurseKinCard } from '../../components/Launchers'
import { Checkbox, Confirm, dateTime, Empty, FormError, Loading, Notice, Pill, Select, TextArea, TextInput, useApiData } from '../../components/ui'
import { api, errorMessage, uploadAsset } from '../../lib/api'
import type { IconName, PublicBanner, PublicPopup, Theme } from '../../lib/marketing'
import { href, navigate } from '../../lib/router'
import { useUI } from '../../lib/ui'
import { PageTitle } from './AdminApp'

/* ---------- Shared ---------- */

type State = 'draft' | 'archived' | 'inactive' | 'scheduled' | 'live' | 'expired'
const stateLabel: Record<State, string> = { draft: 'Draft', archived: 'Archived', inactive: 'Inactive', scheduled: 'Scheduled', live: 'Showing now', expired: 'Ended' }
const stateTone: Record<State, string> = { draft: 'draft', archived: 'archived', inactive: 'inactive', scheduled: 'pending', live: 'active', expired: 'canceled' }
const StatePill = ({ state }: { state: State }) => <Pill value={stateTone[state]} label={stateLabel[state]} />

const themes: Array<{ value: Theme; label: string }> = [
  { value: 'blush', label: 'Blush pink' },
  { value: 'raspberry', label: 'Raspberry pink (light text)' },
  { value: 'ivory', label: 'Warm ivory' },
  { value: 'sage', label: 'Soft sage' },
]
const iconOptions: Array<{ value: IconName; label: string }> = [
  { value: 'none', label: 'No icon' },
  { value: 'heart', label: 'Heart' },
  { value: 'sparkles', label: 'Sparkles' },
  { value: 'gift', label: 'Gift' },
  { value: 'download', label: 'Download' },
  { value: 'truck', label: 'Delivery truck' },
  { value: 'star', label: 'Star' },
  { value: 'tag', label: 'Price tag' },
]
const pageOptions = [
  { value: 'home', label: 'Home page' },
  { value: 'shop', label: 'Shop' },
  { value: 'collections', label: 'Insert collections' },
  { value: 'extra', label: 'A little extra cute' },
  { value: 'freebies', label: 'Freebie Corner' },
  { value: 'tutorials', label: 'Tutorials' },
  { value: 'product', label: 'Product pages' },
  { value: 'story', label: 'Our Story' },
  { value: 'help', label: 'Help & contact' },
]

/** The admin's own timezone, shown next to every date and time. */
function timezoneLabel() {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
  const short = new Intl.DateTimeFormat(undefined, { timeZoneName: 'short' }).formatToParts(new Date()).find((p) => p.type === 'timeZoneName')?.value
  return `${zone}${short ? ` (${short} right now)` : ''}`
}
/** datetime-local value in the admin's timezone. The browser applies daylight saving time correctly. */
const toLocalInput = (iso: string | null) => {
  if (!iso) return ''
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
const fromLocalInput = (v: string) => (v ? new Date(v).toISOString() : null)

function DateTimeInput({ label, value, onChange, hint }: { label: string; value: string; onChange: (v: string) => void; hint?: string }) {
  return (
    <label className="field">
      <span className="field__label">{label}</span>
      <input className="input" type="datetime-local" value={value} onChange={(e) => onChange(e.target.value)} />
      {hint && <span className="field__hint">{hint}</span>}
    </label>
  )
}

function Stats({ views, clicks, dismissals, clickWord = 'Button clicks' }: { views: number; clicks: number; dismissals: number; clickWord?: string }) {
  return (
    <dl className="mk-stats">
      <div><dt>Times shown</dt><dd>{views}</dd></div>
      <div><dt>{clickWord}</dt><dd>{clicks}</dd></div>
      <div><dt>Click rate</dt><dd>{views ? `${Math.round((clicks / views) * 1000) / 10}%` : 'None yet'}</dd></div>
      <div><dt>Closed</dt><dd>{dismissals}</dd></div>
    </dl>
  )
}

function PreviewFrames({ children }: { children: (size: 'desktop' | 'phone') => React.ReactNode }) {
  return (
    <div className="mk-previews">
      <figure className="mk-preview mk-preview--desktop">
        <figcaption>Computer</figcaption>
        <div className="mk-preview__screen">{children('desktop')}</div>
      </figure>
      <figure className="mk-preview mk-preview--phone">
        <figcaption>Phone</figcaption>
        <div className="mk-preview__screen">{children('phone')}</div>
      </figure>
    </div>
  )
}

/* ---------- Banner list ---------- */

interface BannerRow {
  id: string
  name: string
  style: 'announcement' | 'strip' | 'image'
  placement: string
  placementLabel: string
  headline: string
  status: string
  active: boolean
  state: State
  starts_at: string | null
  ends_at: string | null
  priority: number
  coupon_code: string
  conflictsWith: string[]
  stats: { views: number; clicks: number; dismissals: number }
}
const styleLabel = { announcement: 'Announcement bar', strip: 'Promotional strip', image: 'Image and text' }

export function Banners() {
  const { data, error, loading } = useApiData<{ banners: BannerRow[] }>('/api/admin/marketing/banners')
  const [showArchived, setShowArchived] = useState(false)
  const rows = (data?.banners ?? []).filter((b) => showArchived || b.status !== 'archived')
  return (
    <>
      <PageTitle title="Marketing">
        <a className="button button--small button--outline" href={href('admin-nurse-kin')}>Nurse Kin</a>
        <a className="button button--small" href={href('admin-banner-new')}>
          <Plus size={16} aria-hidden="true" /> New banner
        </a>
      </PageTitle>
      <Notice>
        Banners appear only when they are <strong>published</strong>, <strong>active</strong> and inside their start and end times. Each place on the site shows one banner at a time: the lowest
        priority number wins. A sale banner never creates a discount; see the coupon section when editing.
      </Notice>
      {error && <FormError message={error} />}
      {loading && !data ? (
        <Loading />
      ) : !rows.length ? (
        <Empty title="No banners yet">
          <a className="button button--small" href={href('admin-banner-new')}>Create the first banner</a>
        </Empty>
      ) : (
        <div className="data-table-wrap">
          <table className="data-table">
            <thead><tr><th>Banner</th><th>Where</th><th>Status</th><th>Schedule</th><th className="num">Priority</th><th className="num">Shown / clicks</th></tr></thead>
            <tbody>
              {rows.map((b) => (
                <tr key={b.id}>
                  <td>
                    <a href={href(`admin-banner-${b.id}`)}>{b.name}</a>
                    <div className="muted">{styleLabel[b.style]}{b.coupon_code ? ` • code ${b.coupon_code}` : ''}</div>
                    {b.conflictsWith.length > 0 && <div className="field__error">Overlaps with {b.conflictsWith.join(', ')}. Only one shows at a time.</div>}
                  </td>
                  <td>{b.placementLabel}</td>
                  <td><StatePill state={b.state} /></td>
                  <td className="muted">{b.starts_at || b.ends_at ? `${b.starts_at ? dateTime(b.starts_at) : 'Now'} to ${b.ends_at ? dateTime(b.ends_at) : 'no end'}` : 'Always'}</td>
                  <td className="num">{b.priority}</td>
                  <td className="num">{b.stats.views} / {b.stats.clicks}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Checkbox label="Show archived banners" checked={showArchived} onChange={setShowArchived} />
      <p className="muted">Times are shown in your timezone: {timezoneLabel()}.</p>
    </>
  )
}

/* ---------- Banner editor ---------- */

interface BannerForm {
  name: string
  style: 'announcement' | 'strip' | 'image'
  placement: 'top' | 'below_hero' | 'above_freebies'
  headline: string
  body: string
  button_label: string
  link: string
  image_alt: string
  theme: Theme
  icon: IconName
  coupon_code: string
  starts_at: string
  ends_at: string
  priority: number
  pages: string[]
  dismissible: boolean
}
const blankBanner: BannerForm = { name: '', style: 'announcement', placement: 'top', headline: '', body: '', button_label: '', link: '', image_alt: '', theme: 'blush', icon: 'none', coupon_code: '', starts_at: '', ends_at: '', priority: 10, pages: ['all'], dismissible: true }

interface BannerDetail extends BannerForm {
  id: string
  status: 'draft' | 'published' | 'archived'
  active: boolean
  state: State
  image_key: string | null
  coupon_offer: string
  coupon_expires_at: string | null
  coupon_checked_at: string | null
  dismiss_version: number
  conflictsWith: string[]
  updated_at: string
  starts_at: string
  ends_at: string
}

export function BannerEditor({ id }: { id: string }) {
  const isNew = id === 'new'
  const detail = useApiData<BannerDetail>(isNew ? null : `/api/admin/marketing/banners/${id}`)
  const listStats = useApiData<{ banners: BannerRow[] }>(isNew ? null : '/api/admin/marketing/banners')
  const { showToast } = useUI()
  const [form, setForm] = useState<BannerForm>(blankBanner)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [codeCheck, setCodeCheck] = useState<{ offer: string; expiresAt: string | null } | null>(null)
  const [codeError, setCodeError] = useState('')
  const [confirm, setConfirm] = useState<null | 'archive' | 'reset_dismissals'>(null)
  const [imageBust, setImageBust] = useState(0)
  const d = detail.data

  useEffect(() => {
    if (!d) return
    setForm({ ...blankBanner, ...d, starts_at: toLocalInput(d.starts_at), ends_at: toLocalInput(d.ends_at), body: d.body ?? '', image_alt: d.image_alt ?? '' })
    setCodeCheck(d.coupon_offer ? { offer: d.coupon_offer, expiresAt: d.coupon_expires_at } : null)
  }, [d])

  const set = <K extends keyof BannerForm>(k: K, v: BannerForm[K]) => setForm((f) => ({ ...f, [k]: v }))
  const payload = () => ({ ...form, starts_at: fromLocalInput(form.starts_at), ends_at: fromLocalInput(form.ends_at) })
  const dirty = useMemo(() => !d || JSON.stringify(form) !== JSON.stringify({ ...blankBanner, ...d, starts_at: toLocalInput(d.starts_at), ends_at: toLocalInput(d.ends_at), body: d.body ?? '', image_alt: d.image_alt ?? '' }), [form, d])

  const save = async () => {
    setBusy(true)
    setError('')
    try {
      if (isNew) {
        const r = await api<{ id: string }>('/api/admin/marketing/banners', { body: payload() })
        showToast('Draft saved. It is not visible to visitors until you publish it.')
        navigate(`admin-banner-${r.id}`)
      } else {
        await api(`/api/admin/marketing/banners/${id}`, { method: 'PUT', body: payload() })
        showToast(d?.status === 'published' ? 'Saved. The live banner is updated.' : 'Saved.')
        await detail.reload()
      }
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const act = async (action: string) => {
    setBusy(true)
    setError('')
    try {
      if (dirty && !isNew && action !== 'duplicate') await api(`/api/admin/marketing/banners/${id}`, { method: 'PUT', body: payload() })
      if (action === 'duplicate') {
        const r = await api<{ id: string }>(`/api/admin/marketing/banners/${id}/duplicate`, { body: {} })
        showToast('Copied as a new draft.')
        navigate(`admin-banner-${r.id}`)
        return
      }
      await api(`/api/admin/marketing/banners/${id}/${action}`, { body: {} })
      const words: Record<string, string> = { publish: 'Published.', unpublish: 'Moved back to draft. Visitors no longer see it.', activate: 'Active again.', deactivate: 'Paused. Visitors no longer see it.', archive: 'Archived.', restore: 'Restored as a draft.', reset_dismissals: 'Visitors who closed it will see it again.' }
      showToast(words[action] ?? 'Done.')
      await detail.reload()
      await listStats.reload()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
      setConfirm(null)
    }
  }

  const checkCode = async () => {
    setCodeError('')
    setCodeCheck(null)
    try {
      setCodeCheck(await api<{ offer: string; expiresAt: string | null }>('/api/admin/marketing/check-code', { body: { code: form.coupon_code } }))
    } catch (err) {
      setCodeError(errorMessage(err))
    }
  }

  const uploadImage = async (file: File | undefined) => {
    if (!file || isNew) return
    setError('')
    try {
      await uploadAsset('banner_image', id, file)
      setImageBust(Date.now())
      await detail.reload()
      showToast('Image uploaded.')
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  if (!isNew && detail.loading && !d) return <Loading />
  if (!isNew && detail.error) return <FormError message={detail.error} />

  const codeVerified = Boolean(form.coupon_code && codeCheck && (!d || form.coupon_code === d.coupon_code || codeCheck))
  const previewBanner: PublicBanner = {
    id: 'preview',
    style: form.style,
    placement: form.style === 'announcement' ? 'top' : form.placement,
    headline: form.headline || 'Your headline',
    body: form.body,
    buttonLabel: form.button_label,
    link: form.link,
    image: d?.image_key ? { url: `/api/admin/marketing/banners/${id}/preview-image?v=${imageBust || d.updated_at}`, alt: form.image_alt } : null,
    theme: form.theme,
    icon: form.icon,
    couponCode: codeVerified ? form.coupon_code : '',
    couponOffer: codeVerified ? codeCheck!.offer : '',
    endsAt: [fromLocalInput(form.ends_at), codeVerified ? codeCheck!.expiresAt : null].filter(Boolean).sort()[0] ?? null,
    pages: form.pages,
    dismissible: form.dismissible,
    dismissVersion: 1,
  }
  const stats = listStats.data?.banners.find((b) => b.id === id)?.stats

  return (
    <>
      <PageTitle title={isNew ? 'New banner' : form.name || 'Banner'} back={{ label: 'Marketing', route: 'admin-marketing' }}>
        {d && <StatePill state={d.state} />}
      </PageTitle>
      {d?.conflictsWith.length ? (
        <Notice tone="warn">
          This banner's schedule overlaps with <strong>{d.conflictsWith.join(', ')}</strong> in the same place. Only one shows at a time: the lowest priority number, then the most recently published.
        </Notice>
      ) : null}
      {d?.state === 'expired' && <Notice tone="warn">This banner has ended and no longer shows. Change the end time or duplicate it for a new campaign.</Notice>}

      <div className="mk-editor">
        <section className="panel form-stack">
          <h2 className="panel__title">Banner</h2>
          <TextInput label="Internal name" value={form.name} onChange={(v) => set('name', v)} maxLength={80} hint="Only admins see this." required />
          <Select
            label="Style"
            value={form.style}
            onChange={(v) => setForm((f) => ({ ...f, style: v, placement: v === 'announcement' ? 'top' : f.placement === 'top' ? 'below_hero' : f.placement }))}
            options={[
              { value: 'announcement', label: 'Announcement bar (slim bar at the top of every page)' },
              { value: 'strip', label: 'Promotional strip (home page)' },
              { value: 'image', label: 'Image and text (home page)' },
            ]}
          />
          {form.style !== 'announcement' && (
            <Select label="Placement" value={form.placement as 'below_hero' | 'above_freebies'} onChange={(v) => set('placement', v)} options={[{ value: 'below_hero', label: 'Below the home page hero' }, { value: 'above_freebies', label: 'Above the Freebie Corner' }]} />
          )}
          {form.style === 'announcement' && <p className="muted">While an announcement shows, it takes the place of the "Made by a nurse, for nurses." line at the top. That line always stays in the footer.</p>}
          <TextInput label="Headline" value={form.headline} onChange={(v) => set('headline', v)} maxLength={form.style === 'announcement' ? 120 : 90} hint='For example "A little nurse love, a little less." Only say "sitewide" if nothing is excluded.' />
          {form.style !== 'announcement' && <TextArea label="Supporting text (optional)" value={form.body} onChange={(v) => set('body', v)} maxLength={280} rows={3} />}
          <div className="form-grid">
            <TextInput label="Button label (optional)" value={form.button_label} onChange={(v) => set('button_label', v)} maxLength={30} />
            <TextInput label="Button destination" value={form.link} onChange={(v) => set('link', v)} placeholder="#shop or https://..." hint="A page on this site like #shop, #np-inserts or #freebie-corner, or a full https:// address (opens in a new tab)." />
          </div>
          <div className="form-grid">
            <Select label="Theme" value={form.theme} onChange={(v) => set('theme', v)} options={themes} />
            <Select label="Small icon" value={form.icon} onChange={(v) => set('icon', v)} options={iconOptions} />
          </div>
          {form.style === 'image' && (
            <div className="form-stack">
              <label className="field">
                <span className="field__label">Image</span>
                {isNew ? (
                  <span className="muted">Save the draft first, then add an image.</span>
                ) : (
                  <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => { void uploadImage(e.target.files?.[0]); e.target.value = '' }} />
                )}
                <span className="field__hint">PNG, JPG or WebP. A wide photo works best; it is shown about 4:3.</span>
              </label>
              {d?.image_key && (
                <button type="button" className="button button--outline button--small" onClick={async () => { await api(`/api/admin/marketing/banners/${id}/image`, { method: 'DELETE' }); await detail.reload() }}>
                  Remove image
                </button>
              )}
              <TextInput label="Image description (alt text)" value={form.image_alt} onChange={(v) => set('image_alt', v)} maxLength={160} hint="Describe the photo for people using screen readers." />
            </div>
          )}
        </section>

        <section className="panel form-stack">
          <h2 className="panel__title">Coupon code (optional)</h2>
          <Notice tone="warn">
            A banner never creates a discount. Create the promotion code in <strong>Stripe</strong> first. The banner then shows the code with the offer exactly as Stripe defines it, and
            stops showing when the code ends or is switched off. Codes can only be shown once Stripe is connected.
          </Notice>
          <div className="form-grid">
            <TextInput label="Code" value={form.coupon_code} onChange={(v) => { set('coupon_code', v.toUpperCase()); setCodeCheck(null); setCodeError('') }} maxLength={40} />
            <div className="field">
              <span className="field__label">&nbsp;</span>
              <button type="button" className="button button--outline button--small" disabled={!form.coupon_code} onClick={checkCode}>Check with Stripe</button>
            </div>
          </div>
          {codeError && <FormError message={codeError} />}
          {codeCheck && form.coupon_code && <Notice tone="success">Stripe confirms: {codeCheck.offer}{codeCheck.expiresAt ? ` Ends ${dateTime(codeCheck.expiresAt)}.` : ''}</Notice>}
        </section>

        <section className="panel form-stack">
          <h2 className="panel__title">When and where</h2>
          <p className="muted">Times are in your timezone: <strong>{timezoneLabel()}</strong>. Daylight saving time is handled automatically.</p>
          <div className="form-grid">
            <DateTimeInput label="Start (optional)" value={form.starts_at} onChange={(v) => set('starts_at', v)} hint="Empty means as soon as it is published." />
            <DateTimeInput label="End (optional)" value={form.ends_at} onChange={(v) => set('ends_at', v)} hint="Empty means until you stop it." />
          </div>
          <TextInput label="Priority" type="number" value={String(form.priority)} onChange={(v) => set('priority', Math.max(1, Math.min(100, Number(v) || 10)))} hint="1 to 100. When banners overlap in the same place, the lowest number shows." />
          {form.style === 'announcement' ? (
            <fieldset className="mk-pages">
              <legend className="field__label">Show on</legend>
              <Checkbox label="All store pages" checked={form.pages.includes('all')} onChange={(v) => set('pages', v ? ['all'] : ['home'])} />
              {!form.pages.includes('all') &&
                pageOptions.map((p) => (
                  <Checkbox key={p.value} label={p.label} checked={form.pages.includes(p.value)} onChange={(v) => set('pages', v ? [...form.pages, p.value] : form.pages.filter((x) => x !== p.value))} />
                ))}
              <p className="field__hint">Never shown on sign in, checkout, account or admin pages.</p>
            </fieldset>
          ) : (
            <p className="muted">Strips and image banners appear on the home page only.</p>
          )}
          <Checkbox
            label="Visitors can close it"
            checked={form.dismissible}
            onChange={(v) => set('dismissible', v)}
            hint="A closed banner stays closed in that visitor's browser until you choose “Show again to visitors who closed it”. It cannot follow them to another device."
          />
        </section>
      </div>

      <section className="panel">
        <h2 className="panel__title">Preview</h2>
        <PreviewFrames>
          {() => (form.style === 'announcement' ? <AnnouncementView banner={previewBanner} preview onDismiss={() => {}} /> : <PromoView banner={previewBanner} preview onDismiss={() => {}} />)}
        </PreviewFrames>
      </section>

      {stats && (
        <section className="panel">
          <h2 className="panel__title">Results</h2>
          <Stats {...stats} />
          <p className="muted">Counted per browser session when the banner is actually on screen. Previews are never counted.</p>
        </section>
      )}

      <FormError message={error} />
      <div className="sticky-actions">
        <button type="button" className="button" disabled={busy || !form.name} onClick={save}>
          {isNew ? 'Save draft' : 'Save changes'}
        </button>
        {d && d.status === 'draft' && <button type="button" className="button button--outline" disabled={busy} onClick={() => act('publish')}>Publish</button>}
        {d && d.status === 'published' && <button type="button" className="button button--outline" disabled={busy} onClick={() => act('unpublish')}>Unpublish</button>}
        {d && d.status === 'published' && (d.active ? <button type="button" className="button button--outline" disabled={busy} onClick={() => act('deactivate')}>Pause</button> : <button type="button" className="button button--outline" disabled={busy} onClick={() => act('activate')}>Resume</button>)}
        {d && d.status === 'published' && d.dismissible && <button type="button" className="button button--outline" disabled={busy} onClick={() => setConfirm('reset_dismissals')}>Show again to visitors who closed it</button>}
        {d && (
          <button type="button" className="button button--outline" disabled={busy} onClick={() => act('duplicate')}>
            <Copy size={16} aria-hidden="true" /> Duplicate
          </button>
        )}
        {d && d.status !== 'archived' && <button type="button" className="button button--outline" disabled={busy} onClick={() => setConfirm('archive')}>Archive</button>}
        {d && d.status === 'archived' && <button type="button" className="button button--outline" disabled={busy} onClick={() => act('restore')}>Restore as draft</button>}
      </div>

      <Confirm open={confirm === 'archive'} title="Archive this banner?" confirmLabel="Archive" onConfirm={() => act('archive')} onClose={() => setConfirm(null)} busy={busy}>
        It stops showing and moves out of the list. You can restore it later as a draft.
      </Confirm>
      <Confirm open={confirm === 'reset_dismissals'} title="Show it again to everyone?" confirmLabel="Show again" onConfirm={() => act('reset_dismissals')} onClose={() => setConfirm(null)} busy={busy}>
        Visitors who closed this banner will see it again. Use this when the campaign changed in a meaningful way.
      </Confirm>
    </>
  )
}

/* ---------- Nurse Kin launcher ---------- */

interface PopupForm {
  launcher_label: string
  headline: string
  body: string
  cta_label: string
  url: string
  image_alt: string
  theme: Theme
  starts_at: string
  ends_at: string
}
interface PopupDetail extends Omit<PopupForm, 'starts_at' | 'ends_at'> {
  status: 'draft' | 'published'
  enabled: boolean
  state: State
  problems: string[]
  image_key: string | null
  campaign_version: number
  starts_at: string | null
  ends_at: string | null
  updated_at: string
  uploadTarget: string
  stats: { views: number; clicks: number; dismissals: number }
}

export function PopupEditor() {
  const detail = useApiData<PopupDetail>('/api/admin/marketing/popup')
  const { showToast } = useUI()
  const [form, setForm] = useState<PopupForm | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirmReset, setConfirmReset] = useState(false)
  const d = detail.data

  useEffect(() => {
    if (d) setForm({ launcher_label: d.launcher_label, headline: d.headline, body: d.body, cta_label: d.cta_label, url: d.url, image_alt: d.image_alt, theme: d.theme, starts_at: toLocalInput(d.starts_at), ends_at: toLocalInput(d.ends_at) })
  }, [d])
  if (detail.error) return <FormError message={detail.error} />
  if (!d || !form) return <Loading />

  const set = <K extends keyof PopupForm>(k: K, v: PopupForm[K]) => setForm((f) => (f ? { ...f, [k]: v } : f))
  const payload = () => ({ ...form, starts_at: fromLocalInput(form.starts_at), ends_at: fromLocalInput(form.ends_at) })
  const save = async () => {
    setBusy(true)
    setError('')
    try {
      await api('/api/admin/marketing/popup', { method: 'PUT', body: payload() })
      showToast(d.status === 'published' ? 'Saved. The live launcher is updated.' : 'Saved as a draft.')
      await detail.reload()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }
  const act = async (action: string) => {
    setBusy(true)
    setError('')
    try {
      await api('/api/admin/marketing/popup', { method: 'PUT', body: payload() })
      await api(`/api/admin/marketing/popup/${action}`, { body: {} })
      const words: Record<string, string> = { publish: 'Published.', unpublish: 'Moved back to draft.', enable: 'Switched on.', disable: 'Switched off.', reset_campaign: 'Results reset. Counting starts fresh.' }
      showToast(words[action] ?? 'Done.')
      await detail.reload()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
      setConfirmReset(false)
    }
  }
  const uploadImage = async (file: File | undefined) => {
    if (!file) return
    try {
      await uploadAsset('popup_image', d.uploadTarget, file)
      await detail.reload()
      showToast('Image uploaded.')
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  const popup: PublicPopup = {
    launcherLabel: form.launcher_label || 'Meet Nurse Kin',
    headline: form.headline || 'Your headline',
    body: form.body || 'A short description of Nurse Kin.',
    ctaLabel: form.cta_label || 'Visit Nurse Kin',
    url: form.url,
    image: d.image_key ? { url: `/api/admin/marketing/popup/preview-image?v=${d.updated_at}`, alt: form.image_alt } : null,
    theme: form.theme,
    version: d.campaign_version,
  }

  return (
    <>
      <PageTitle title="Nurse Kin" back={{ label: 'Marketing', route: 'admin-marketing' }}>
        <StatePill state={d.state} />
      </PageTitle>
      <Notice>
        A small "Meet Nurse Kin" button sits in the bottom right corner of the store. Visitors open it themselves; it never pops up on its own. It links to Nurse Kin, where people can join. It does
        not sign anyone up or collect email addresses. The button stays hidden until you add the real Nurse Kin address and your approved description, then publish.
      </Notice>
      {d.problems.length > 0 && <Notice tone="warn">Before it can be published: {d.problems.join(' ')}</Notice>}

      <div className="mk-editor">
        <section className="panel form-stack">
          <h2 className="panel__title">Content</h2>
          <TextInput label="Button label in the corner" value={form.launcher_label} onChange={(v) => set('launcher_label', v)} maxLength={30} hint='Keep it short, for example "Meet Nurse Kin".' />
          <TextInput label="Headline" value={form.headline} onChange={(v) => set('headline', v)} maxLength={80} />
          <TextArea label="What Nurse Kin is" value={form.body} onChange={(v) => set('body', v)} maxLength={400} rows={4} hint="Use your approved description. Do not promise benefits or prices that are not on Nurse Kin." />
          <div className="form-grid">
            <TextInput label="Link button label" value={form.cta_label} onChange={(v) => set('cta_label', v)} maxLength={30} hint='For example "Visit Nurse Kin".' />
            <TextInput label="Nurse Kin address" value={form.url} onChange={(v) => set('url', v)} placeholder="https://..." hint="Must start with https://. Opens in a new tab." />
          </div>
          <Select label="Theme" value={form.theme} onChange={(v) => set('theme', v)} options={themes} />
          <label className="field">
            <span className="field__label">Logo or image (optional)</span>
            <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => { void uploadImage(e.target.files?.[0]); e.target.value = '' }} />
          </label>
          {d.image_key && (
            <button type="button" className="button button--outline button--small" onClick={async () => { await api('/api/admin/marketing/popup/image', { method: 'DELETE' }); await detail.reload() }}>
              Remove image
            </button>
          )}
          <TextInput label="Image description (alt text)" value={form.image_alt} onChange={(v) => set('image_alt', v)} maxLength={160} hint="Required when there is an image." />
        </section>

        <section className="panel form-stack">
          <h2 className="panel__title">Schedule (optional)</h2>
          <p className="muted">
            Times use your timezone: <strong>{timezoneLabel()}</strong>. They are saved as an exact moment, so the button appears and disappears at the same instant for every visitor.
          </p>
          <div className="form-grid">
            <DateTimeInput label="Start (optional)" value={form.starts_at} onChange={(v) => set('starts_at', v)} />
            <DateTimeInput label="End (optional)" value={form.ends_at} onChange={(v) => set('ends_at', v)} />
          </div>
          <Notice>
            The button is hidden during sign in, password recovery, checkout, customer accounts and the admin, and steps aside while a tutorial video plays or another window is open. Only one corner
            panel is open at a time.
          </Notice>
        </section>
      </div>

      <section className="panel">
        <h2 className="panel__title">Preview</h2>
        <p className="muted">How the open panel looks. The link does nothing in the preview.</p>
        <PreviewFrames>
          {(size) => (
            <div className={`mk-kin-preview mk-kin-preview--${size}`}>
              <div className={`launcher-panel launcher-panel--static launcher-panel--themed promo-theme--${popup.theme}`}>
                <NurseKinCard popup={popup} preview />
              </div>
              <span className="launcher is-open" aria-hidden="true">
                <HeartHandshake size={18} />
                {popup.launcherLabel}
              </span>
            </div>
          )}
        </PreviewFrames>
      </section>

      <section className="panel">
        <h2 className="panel__title">Results</h2>
        <Stats {...d.stats} clickWord="Clicks to Nurse Kin" />
        <p className="muted">
          "Times shown" counts panel openings (once per visit). A click means someone opened the Nurse Kin website, not that they joined. Joining can only be measured on Nurse Kin itself.
        </p>
      </section>

      <FormError message={error} />
      <div className="sticky-actions">
        <button type="button" className="button" disabled={busy} onClick={save}>Save</button>
        {d.status === 'draft' && <button type="button" className="button button--outline" disabled={busy || d.problems.length > 0} onClick={() => act('publish')}>Publish</button>}
        {d.status === 'published' && <button type="button" className="button button--outline" disabled={busy} onClick={() => act('unpublish')}>Unpublish</button>}
        {d.status === 'published' && (d.enabled ? <button type="button" className="button button--outline" disabled={busy} onClick={() => act('disable')}>Switch off</button> : <button type="button" className="button button--outline" disabled={busy} onClick={() => act('enable')}>Switch on</button>)}
        <button type="button" className="button button--outline" disabled={busy} onClick={() => setConfirmReset(true)}>Reset results</button>
      </div>

      <Confirm open={confirmReset} title="Reset the results?" confirmLabel="Reset results" onConfirm={() => act('reset_campaign')} onClose={() => setConfirmReset(false)} busy={busy}>
        The counts start again from zero. Use this when you change to a meaningfully new message.
      </Confirm>
    </>
  )
}
