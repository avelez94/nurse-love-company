import { ArrowDown, ArrowUp, Copy, Eye, FileUp, ImagePlus, Plus, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { api, errorMessage, uploadAsset } from '../../lib/api'
import { href, navigate } from '../../lib/router'
import { toProduct, type ApiProduct } from '../../lib/store'
import { useUI } from '../../lib/ui'
import { Dialog } from '../../components/Dialog'
import { RichTextEditor } from '../../components/RichTextEditor'
import { Checkbox, Confirm, dateTime, Empty, FormError, Loading, money, MoneyInput, Notice, Pill, ProgressBar, Select, TextArea, TextInput, useApiData } from '../../components/ui'
import { ProductView } from '../Product'
import { slugify } from './slug'
import { PreorderPanel, PrintfulLinks } from './PrintfulLinks'
import { PageTitle } from './AdminApp'

interface ListRow {
  id: string
  slug: string
  title: string
  category: string
  type: string
  status: string
  active: boolean
  archived_at: string | null
  featured: boolean
  price_cents: number | null
  sale_price_cents: number | null
  is_demo: boolean
  inventory_quantity: number
  low_stock_threshold: number
  variant_stock: number
  variant_count: number
  pf_items: number
  pf_ready: number
  version_number: number | null
  image_id: string | null
}

const categoryOptions = [
  { value: 'nurse-inserts', label: 'Nurse Binder Inserts' },
  { value: 'np-inserts', label: 'Nurse Practitioner Binder Inserts' },
  { value: 'apparel', label: 'Apparel' },
  { value: 'accessories', label: 'Accessories' },
  { value: 'pens', label: 'Pens' },
  { value: 'other', label: 'Other' },
] as const

export function Products() {
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('active')
  const q = new URLSearchParams({ search, status }).toString()
  const { data, error, loading } = useApiData<{ products: ListRow[] }>(`/api/admin/products?${q}`)
  return (
    <>
      <PageTitle title="Products">
        <a className="button button--small" href={href('admin-product-new')}>
          <Plus size={16} aria-hidden="true" /> New product
        </a>
      </PageTitle>
      <div className="filters">
        <label className="field field--grow">
          <span className="field__label">Search</span>
          <input className="input" type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Title, slug or SKU" />
        </label>
        <Select label="Show" value={status} onChange={setStatus} options={[{ value: 'active', label: 'All except archived' }, { value: 'published', label: 'Published' }, { value: 'draft', label: 'Drafts' }, { value: 'inactive', label: 'Inactive' }, { value: 'archived', label: 'Archived' }, { value: 'all', label: 'Everything' }]} />
      </div>
      {error && <FormError message={error} />}
      {loading && !data ? (
        <Loading />
      ) : !data?.products.length ? (
        <Empty title="No products match">
          <a className="button button--small" href={href('admin-product-new')}>Create a product</a>
        </Empty>
      ) : (
        <div className="data-table-wrap">
          <table className="data-table">
            <thead>
              <tr><th></th><th>Product</th><th>Type</th><th>Status</th><th className="num">Price</th><th className="num">Printful / file</th></tr>
            </thead>
            <tbody>
              {data.products.map((p) => {
                return (
                  <tr key={p.id}>
                    <td>{p.image_id ? <img className="thumb" src={`/api/media/${p.image_id}`} alt="" /> : <span className="thumb" />}</td>
                    <td>
                      <a href={href(`admin-product-${p.id}`)}>{p.title}</a>
                      {p.is_demo && <span className="demo-tag">Demo</span>}
                      {p.featured && <span className="demo-tag">Featured</span>}
                      <br />
                      <span className="muted">/{p.slug}</span>
                    </td>
                    <td>{p.type === 'digital' ? 'Digital' : 'Physical'}</td>
                    <td className="status-line">
                      {p.archived_at ? <Pill value="archived" /> : <Pill value={p.status} />}
                      {!p.active && !p.archived_at && <Pill value="inactive" />}
                    </td>
                    <td className="num">{p.price_cents === null ? 'Not set' : money(p.sale_price_cents ?? p.price_cents)}</td>
                    <td className="num">{p.type === 'digital' ? (p.version_number ? `File v${p.version_number}` : 'No file yet') : p.pf_items === 0 ? 'Printful: not linked' : p.pf_ready < p.pf_items ? <strong>Printful: {p.pf_ready} of {p.pf_items} ready</strong> : `Printful: ${p.pf_ready} ready`}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}

type Form = {
  title: string
  slug: string
  category: string
  collection: string
  type: 'digital' | 'physical'
  short_description: string
  description: unknown
  price_cents: number | null
  sale_price_cents: number | null
  featured: boolean
  sort_order: number
  page_count: number | null
  page_size: string
  orientation: string
  file_format: string
  usage_attributes: string[]
  app_compatibility: string[]
  show_binder_notice: boolean
  sku: string
  weight_grams: number | null
  shipping_info: string
  inventory_quantity: number
  low_stock_threshold: number
  out_of_stock_behavior: string
  preorder: boolean
  preorder_ship_by: string
  whats_included: string[]
  walkthrough_tutorial_id: string | null
  is_freebie: boolean
}

const blank: Form = {
  title: '', slug: '', category: 'nurse-inserts', collection: '', type: 'digital', short_description: '', description: { type: 'doc', content: [] }, price_cents: null, sale_price_cents: null, featured: false, sort_order: 0,
  page_count: null, page_size: '', orientation: '', file_format: '', usage_attributes: [], app_compatibility: [], show_binder_notice: true,
  sku: '', weight_grams: null, shipping_info: '', inventory_quantity: 0, low_stock_threshold: 3, out_of_stock_behavior: 'show_sold_out', preorder: false, preorder_ship_by: '', whats_included: [], walkthrough_tutorial_id: null, is_freebie: false,
}

interface Detail {
  product: Form & { id: string; status: string; active: boolean; archived_at: string | null; is_demo: boolean; current_version_id: string | null; updated_at: string }
  images: Array<{ id: string; kind: 'gallery' | 'sample' | 'detail'; approved: boolean; alt: string; width: number | null; height: number | null; sort_order: number; variant_id: string | null }>
  variants: Array<{ id: string; title: string; options: { size?: string; color?: string }; sku: string | null; price_cents: number | null; inventory_quantity: number; active: boolean }>
  versions: Array<{ id: string; version_number: number; file_name: string; file_size: number; notes: string; released_at: string; released_by: string }>
  uploads: Array<{ id: string; file_name: string; file_size: number; created_at: string; uploaded_by: string }>
  releases: Array<{ id: string; version_id: string; notify: boolean; trigger: string; affected_count: number; granted_count: number; created_by: string; created_at: string }>
  releaseStatus: Record<string, Record<'queued' | 'sent' | 'skipped' | 'held' | 'failed' | 'canceled', number>>
  emailConfigured: boolean
  affected: { items: number; customers: number }
  orderCount: number
  fileLimitMb?: number
}

const size = (b: number) => (b > 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(b / 1024)} KB`)
const listToText = (l: string[]) => l.join(', ')
const textToList = (t: string) => t.split(',').map((x) => x.trim()).filter(Boolean)

export function ProductEditor({ id }: { id: string }) {
  const isNew = id === 'new'
  const { data, error, loading, reload } = useApiData<Detail>(isNew ? null : `/api/admin/products/${id}`)
  const { showToast } = useUI()
  const [form, setForm] = useState<Form>(blank)
  const [slugTouched, setSlugTouched] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [preview, setPreview] = useState<ApiProduct | null>(null)
  const [confirmAction, setConfirmAction] = useState<null | 'archive' | 'deactivate'>(null)
  const [replacement, setReplacement] = useState<Detail['uploads'][number] | null>(null)
  const [updateNotes, setUpdateNotes] = useState('')
  const [fileResult, setFileResult] = useState<FileResult | null>(null)
  const tutorials = useApiData<{ tutorials: Array<{ id: string; title: string; status: string }> }>('/api/admin/tutorials')

  useEffect(() => {
    if (data) {
      const p = data.product
      setForm({ ...blank, ...Object.fromEntries(Object.entries(p).filter(([k]) => k in blank)), page_size: p.page_size ?? '', orientation: p.orientation ?? '', file_format: p.file_format ?? '', sku: p.sku ?? '', preorder_ship_by: p.preorder_ship_by ? String(p.preorder_ship_by).slice(0, 10) : '' } as Form)
      setSlugTouched(true)
    }
  }, [data])

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v, ...(k === 'title' && !slugTouched ? { slug: slugify(String(v)) } : {}) }))

  const save = async (e?: FormEvent) => {
    e?.preventDefault()
    setSaving(true)
    setSaveError('')
    const body = { ...form, page_size: form.page_size || null, orientation: form.orientation || null, file_format: form.file_format || null, sku: form.sku || null }
    try {
      if (isNew) {
        const created = await api<{ id: string }>('/api/admin/products', { body })
        showToast('Draft saved. Add photos, files and details, then publish when ready.')
        navigate(`admin-product-${created.id}`)
      } else {
        const r = await api<{ file: FileResult | null; emailConfigured: boolean }>(`/api/admin/products/${id}`, {
          method: 'PUT',
          body: { ...body, ...(replacement ? { replacement_upload_id: replacement.id, update_notes: updateNotes } : {}) },
        })
        setFileResult(r.file ? { ...r.file, emailConfigured: r.emailConfigured } : null)
        setReplacement(null)
        setUpdateNotes('')
        showToast(r.file ? fileMessage(r.file) : 'Product saved. Listing edits never grant new downloads.')
        await reload()
      }
    } catch (err) {
      setSaveError(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  const act = async (action: string) => {
    setSaveError('')
    try {
      if (action === 'duplicate') {
        const copy = await api<{ id: string }>(`/api/admin/products/${id}/duplicate`, { method: 'POST' })
        showToast('Duplicated as a new draft.')
        navigate(`admin-product-${copy.id}`)
        return
      }
      await api(`/api/admin/products/${id}/${action}`, { method: 'POST' })
      showToast({ publish: 'Published to the shop.', unpublish: 'Moved back to draft. It is no longer in the shop.', activate: 'Activated.', deactivate: 'Deactivated. New purchases are blocked.', archive: 'Archived. Order history and downloads are kept.', unarchive: 'Restored from the archive.' }[action] ?? 'Done.')
      await reload()
    } catch (err) {
      setSaveError(errorMessage(err))
    }
  }

  const openPreview = async () => {
    try {
      const res = await api<{ product: ApiProduct }>(`/api/admin/products/${id}/preview`)
      setPreview(res.product)
    } catch (err) {
      setSaveError(errorMessage(err))
    }
  }

  if (!isNew && loading && !data) return <Loading />
  if (error) return <FormError message={error} />
  const p = data?.product

  return (
    <>
      <PageTitle title={isNew ? 'New product' : form.title || 'Product'} back={{ label: 'Products', route: 'admin-products' }} />
      {p && (
        <div className="status-line">
          {p.archived_at ? <Pill value="archived" /> : <Pill value={p.status} />}
          {!p.active && <Pill value="inactive" />}
          {p.is_demo && <span className="demo-tag">Demo product</span>}
          <span className="muted">Last saved {dateTime(p.updated_at)} • in {data!.orderCount} orders</span>
        </div>
      )}
      {p?.is_demo && <Notice tone="warn">This is a demo product created for the preview. Its price and file are placeholders.</Notice>}

      <form className="admin-cols" onSubmit={save}>
        <div>
          <section className="panel form-stack">
            <h2 className="panel__title">Listing</h2>
            <TextInput label="Product title" value={form.title} onChange={(v) => set('title', v)} maxLength={160} required />
            <TextInput label="URL slug" value={form.slug} onChange={(v) => { setSlugTouched(true); set('slug', v.toLowerCase()) }} hint={`Shop address: #product-${form.slug || 'your-slug'}`} maxLength={100} />
            <TextArea label="Short description" value={form.short_description} onChange={(v) => set('short_description', v)} maxLength={300} rows={2} hint="Shown on product cards. Up to 300 characters." />
            <RichTextEditor label="Full description" value={form.description} onChange={(d) => set('description', d)} hint="Bold, italic, lists, links and a few approved font styles and sizes." />
          </section>

          {form.type === 'digital' ? (
            <section className="panel form-stack">
              <h2 className="panel__title">Digital details</h2>
              <p className="muted">Only fill in what is confirmed for this product. Empty fields show "To be confirmed" in the shop.</p>
              <div className="form-grid">
                <TextInput label="Number of pages" value={form.page_count === null ? '' : String(form.page_count)} onChange={(v) => set('page_count', v ? Number(v.replace(/\D/g, '')) || null : null)} />
                <Select label="Page size" value={form.page_size} onChange={(v) => set('page_size', v)} options={[{ value: '', label: 'Not set' }, ...['US Letter (8.5 × 11 in)', 'A4 (210 × 297 mm)', 'A5 (148 × 210 mm)', 'Half Letter (5.5 × 8.5 in)'].map((s) => ({ value: s, label: s }))]} />
                <Select label="Orientation" value={form.orientation} onChange={(v) => set('orientation', v)} options={[{ value: '', label: 'Not set' }, { value: 'portrait', label: 'Portrait' }, { value: 'landscape', label: 'Landscape' }]} />
                <TextInput label="File format" value={form.file_format} onChange={(v) => set('file_format', v)} placeholder="PDF" maxLength={40} />
              </div>
              <TextInput label="Confirmed uses" value={listToText(form.usage_attributes)} onChange={(v) => set('usage_attributes', textToList(v))} hint="Comma separated, for example: Printable, Fillable. Only list what you have confirmed." />
              <TextInput label="Confirmed app compatibility" value={listToText(form.app_compatibility)} onChange={(v) => set('app_compatibility', textToList(v))} hint="Comma separated. Leave empty if not confirmed." />
              <Checkbox label='Show "Inserts only • Binder not included"' checked={form.show_binder_notice} onChange={(v) => set('show_binder_notice', v)} />
              <p className="muted">File size is calculated automatically from the released file.</p>
            </section>
          ) : (
            <section className="panel form-stack">
              <h2 className="panel__title">Physical details</h2>
              <div className="form-grid">
                <TextInput label="SKU" value={form.sku} onChange={(v) => set('sku', v)} maxLength={64} />
                <TextInput label="Weight (grams)" value={form.weight_grams === null ? '' : String(form.weight_grams)} onChange={(v) => set('weight_grams', v ? Number(v.replace(/\D/g, '')) : null)} />
              </div>
              <p className="muted">Printful makes and ships this item, so there is no stock to count. Availability comes from Printful once its options are linked below.</p>
              <Checkbox
                label="Preorder"
                checked={form.preorder}
                onChange={(v) => set('preorder', v)}
                hint="Customers pay now. Their whole order waits on the website until you press Send preorders to Printful (below, after saving)."
              />
              {form.preorder && (
                <TextInput
                  label="Ships by"
                  type="date"
                  value={form.preorder_ship_by}
                  onChange={(v) => set('preorder_ship_by', v)}
                  hint='Shown to customers as "Ships by ...". Pick a date you can keep, allowing for Printful production and shipping; if it slips, customers should be told and offered a refund.'
                />
              )}
              <Select label="When Printful cannot make it" value={form.out_of_stock_behavior === 'allow_backorder' ? 'show_sold_out' : form.out_of_stock_behavior} onChange={(v) => set('out_of_stock_behavior', v)} options={[{ value: 'show_sold_out', label: 'Show as unavailable' }, { value: 'hide', label: 'Hide from the shop' }]} />
              <TextArea label="Shipping information" value={form.shipping_info} onChange={(v) => set('shipping_info', v)} maxLength={500} rows={2} />
            </section>
          )}

          {!isNew && data && form.type === 'physical' && <Variants productId={id} variants={data.variants} reload={reload} />}
          {!isNew && form.type === 'physical' && <PreorderPanel productId={id} />}
          {!isNew && data && form.type === 'physical' && <PrintfulLinks productId={id} variantsKey={data.variants.map((v) => `${v.id}:${v.active}`).join(',')} reload={reload} />}
          {!isNew && data && <Images productId={id} images={data.images.filter((i) => i.kind === 'gallery')} variants={data.variants} reload={reload} />}
          {/* Sample previews, "What's included" and walkthroughs are for digital files, so physical items do not show them. Saved values are kept. */}
          {!isNew && data && form.type === 'digital' && <Previews productId={id} images={data.images.filter((i) => i.kind !== 'gallery')} reload={reload} />}
          {form.type === 'digital' && (
            <section className="panel form-stack">
              <h2 className="panel__title">What's included and walkthrough</h2>
              <TextArea
                label="What's included"
                value={form.whats_included.join('\n')}
                onChange={(v) => set('whats_included', v.split('\n').map((x) => x.replace(/^\s*[•*]\s*/, '')).slice(0, 25))}
                rows={5}
                hint="One item per line, for example a section name and its page count. Shown as a list on the product page. Leave empty to hide."
              />
              <Select
                label="Walkthrough video (optional)"
                value={form.walkthrough_tutorial_id ?? ''}
                onChange={(v) => set('walkthrough_tutorial_id', v || null)}
                options={[{ value: '', label: 'None' }, ...(tutorials.data?.tutorials ?? []).filter((t) => t.status !== 'archived').map((t) => ({ value: t.id, label: `${t.title}${t.status === 'published' ? '' : ' (not published yet, hidden until it is)'}` }))]}
                hint="Pick a tutorial that walks through this product. The link appears only while the tutorial is published."
              />
            </section>
          )}
          {!isNew && data && form.type === 'digital' && (
            <Files
              productId={id}
              data={data}
              reload={reload}
              replacement={replacement}
              setReplacement={setReplacement}
              notes={updateNotes}
              setNotes={setUpdateNotes}
              result={fileResult}
            />
          )}
        </div>

        <div>
          <section className="panel form-stack">
            <h2 className="panel__title">Organization</h2>
            <Select label="Product type" value={form.type} onChange={(v) => set('type', v)} options={[{ value: 'digital', label: 'Digital download' }, { value: 'physical', label: 'Physical item (ships)' }]} hint={data?.orderCount ? 'Cannot change after the product has been ordered.' : undefined} />
            <Select label="Category" value={form.category} onChange={(v) => set('category', v)} options={categoryOptions.map((c) => ({ value: c.value, label: c.label }))} />
            <TextInput label="Collection" value={form.collection} onChange={(v) => set('collection', v)} maxLength={80} />
            <TextInput label="Display order" value={String(form.sort_order)} onChange={(v) => set('sort_order', Number(v.replace(/[^\d-]/g, '')) || 0)} hint="Lower numbers appear first." />
            <Checkbox label="Featured product" checked={form.featured} onChange={(v) => set('featured', v)} />
          </section>
          <section className="panel form-stack">
            <h2 className="panel__title">Price</h2>
            {form.type === 'digital' && (
              <Checkbox
                label="Include in Freebie Corner"
                checked={form.is_freebie}
                onChange={(v) => setForm((f) => ({ ...f, is_freebie: v, price_cents: v ? 0 : null, sale_price_cents: null }))}
                hint="Free with an email list signup, claimed through checkout and delivered in the customer's account."
              />
            )}
            {form.is_freebie ? (
              <Notice tone="warn">
                Saving sets the price to <strong>$0</strong> and removes any sale price. Once published, it appears in the Freebie Corner. Customers claim it by checking out with their account email and joining your
                email list; the file stays private and is delivered in their account with one download. Free claims are reported separately from sales.
              </Notice>
            ) : (
              <>
                {p?.is_freebie && <Notice tone="warn">This product is leaving the Freebie Corner. Enter the selling price you want before saving; the earlier price does not come back by itself.</Notice>}
                <MoneyInput label="Price" cents={form.price_cents} onChange={(c) => set('price_cents', c)} hint="Leave empty until the price is approved. Products without a price cannot be bought." />
                <MoneyInput label="Sale price (optional)" cents={form.sale_price_cents} onChange={(c) => set('sale_price_cents', c)} />
              </>
            )}
          </section>
        </div>

        <div className="sticky-actions" style={{ gridColumn: '1 / -1' }}>
          <button type="submit" className="button button--small" disabled={saving}>
            {saving ? 'Saving...' : isNew ? 'Save draft' : 'Save changes'}
          </button>
          {!isNew && p && (
            <>
              <button type="button" className="button button--outline button--small" onClick={openPreview}>
                <Eye size={16} aria-hidden="true" /> Preview
              </button>
              {!p.archived_at && (p.status === 'draft' ? <button type="button" className="button button--outline button--small" onClick={() => act('publish')}>Publish</button> : <button type="button" className="button button--outline button--small" onClick={() => act('unpublish')}>Move to draft</button>)}
              {!p.archived_at && (p.active ? <button type="button" className="button button--outline button--small" onClick={() => setConfirmAction('deactivate')}>Deactivate</button> : <button type="button" className="button button--outline button--small" onClick={() => act('activate')}>Activate</button>)}
              <button type="button" className="button button--outline button--small" onClick={() => act('duplicate')}>
                <Copy size={16} aria-hidden="true" /> Duplicate
              </button>
              {p.archived_at ? <button type="button" className="button button--outline button--small" onClick={() => act('unarchive')}>Restore</button> : <button type="button" className="button button--outline button--small" onClick={() => setConfirmAction('archive')}>Archive</button>}
            </>
          )}
          <span className="spacer" />
          <FormError message={saveError} />
        </div>
      </form>

      <Confirm
        open={Boolean(confirmAction)}
        title={confirmAction === 'archive' ? 'Archive this product?' : 'Deactivate this product?'}
        confirmLabel={confirmAction === 'archive' ? 'Archive' : 'Deactivate'}
        onClose={() => setConfirmAction(null)}
        onConfirm={async () => {
          const a = confirmAction!
          setConfirmAction(null)
          await act(a)
        }}
      >
        <p>It disappears from the shop and new purchases are blocked. Existing customers keep their order records, receipts and any eligible downloads. Nothing is deleted.</p>
      </Confirm>

      <Dialog open={Boolean(preview)} onClose={() => setPreview(null)} title="Preview (not public)" variant="wide">
        {preview && (
          <div className="admin-preview">
            <Notice tone="warn">This is how the product page will look. Buying is switched off in preview.{p?.status === 'draft' ? ' This product is a draft and is not in the shop.' : ''}</Notice>
            <ProductView product={toProduct(preview)} preview />
          </div>
        )}
      </Dialog>
    </>
  )
}

function Variants({ productId, variants, reload }: { productId: string; variants: Detail['variants']; reload: () => void }) {
  type Row = { id?: string; title: string; size: string; color: string; sku: string; price_cents: number | null; inventory_quantity: number; active: boolean }
  const toRows = () => variants.map((v) => ({ id: v.id, title: v.title, size: v.options.size ?? '', color: v.options.color ?? '', sku: v.sku ?? '', price_cents: v.price_cents, inventory_quantity: v.inventory_quantity, active: v.active }))
  const [rows, setRows] = useState<Row[]>(toRows)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState('')
  useEffect(() => setRows(toRows()), [variants])
  const update = (i: number, patch: Partial<Row>) => setRows((r) => r.map((x, j) => (j === i ? { ...x, ...patch, title: patch.size !== undefined || patch.color !== undefined ? [patch.size ?? x.size, patch.color ?? x.color].filter(Boolean).join(' / ') || x.title : (patch.title ?? x.title) } : x)))
  const save = async () => {
    setError('')
    try {
      await api(`/api/admin/products/${productId}/variants`, { method: 'PUT', body: { variants: rows.map((r) => ({ ...r, sku: r.sku || null })) } })
      setSaved('Variants saved.')
      reload()
    } catch (err) {
      setError(errorMessage(err))
    }
  }
  return (
    <section className="panel form-stack">
      <div className="panel__head">
        <h2 className="panel__title">Variants (size and color)</h2>
        <button type="button" className="button button--outline button--small" onClick={() => setRows([...rows, { title: '', size: '', color: '', sku: '', price_cents: null, inventory_quantity: 0, active: true }])}>
          <Plus size={16} aria-hidden="true" /> Add variant
        </button>
      </div>
      {!rows.length && <p className="muted">No variants. Add them only for real options such as shirt sizes.</p>}
      {rows.map((r, i) => (
        <div className="variant-row" key={r.id ?? `new-${i}`}>
          <TextInput label="Name" value={r.title} onChange={(v) => update(i, { title: v })} maxLength={80} />
          <TextInput label="Size" value={r.size} onChange={(v) => update(i, { size: v })} maxLength={30} />
          <TextInput label="Color" value={r.color} onChange={(v) => update(i, { color: v })} maxLength={30} />
          <TextInput label="SKU" value={r.sku} onChange={(v) => update(i, { sku: v })} maxLength={64} />
          <MoneyInput label="Price (optional)" cents={r.price_cents} onChange={(c) => update(i, { price_cents: c })} />
          <button type="button" className="icon-button" aria-label={`Remove variant ${r.title}`} onClick={() => setRows(rows.filter((_, j) => j !== i))}>
            <Trash2 size={18} aria-hidden="true" />
          </button>
        </div>
      ))}
      <FormError message={error} />
      <div className="button-row">
        <button type="button" className="button button--small" onClick={save}>Save variants</button>
        {saved && <span role="status">{saved}</span>}
      </div>
      <p className="muted">Variants with past orders are switched off instead of deleted, so order history stays intact.</p>
    </section>
  )
}

function Images({ productId, images, variants, reload }: { productId: string; images: Detail['images']; variants: Detail['variants']; reload: () => void }) {
  const [list, setList] = useState(images)
  const [progress, setProgress] = useState<{ name: string; value: number } | null>(null)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState('')
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => setList(images), [images])

  const upload = async (files: FileList | null, kind: 'gallery') => {
    if (!files?.length) return
    setError('')
    for (const f of Array.from(files)) {
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(f.type)) {
        setError(`${f.name} is not a PNG, JPG or WebP image.`)
        continue
      }
      try {
        setProgress({ name: f.name, value: 0 })
        await uploadAsset('product_image', productId, f, { imageKind: kind, onProgress: (v) => setProgress({ name: f.name, value: v }) })
      } catch (err) {
        setError(`${f.name}: ${errorMessage(err)}`)
      }
    }
    setProgress(null)
    reload()
  }

  const move = (i: number, d: number) => {
    const next = [...list]
    const [x] = next.splice(i, 1)
    next.splice(i + d, 0, x)
    setList(next)
  }
  const save = async () => {
    setError('')
    try {
      await api(`/api/admin/products/${productId}/images`, { method: 'PUT', body: { images: list.map((i) => ({ id: i.id, alt: i.alt, kind: i.kind, variant_id: i.variant_id })) } })
      setSaved('Image details saved.')
      reload()
    } catch (err) {
      setError(errorMessage(err))
    }
  }
  const missingAlt = list.filter((i) => !i.alt.trim()).length
  return (
    <section className="panel form-stack">
      <div className="panel__head">
        <h2 className="panel__title">Product photos</h2>
        <div className="button-row">
          <label className="button button--outline button--small">
            <ImagePlus size={16} aria-hidden="true" /> Add photos
            <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" multiple hidden onChange={(e) => { void upload(e.target.files, 'gallery'); e.target.value = '' }} />
          </label>
        </div>
      </div>
      <p className="muted">Full marketing graphics are shown whole, never cropped, and shoppers can enlarge them. Images are public only while the product is published.</p>
      {progress && <ProgressBar value={progress.value} label={`Uploading ${progress.name}`} />}
      <FormError message={error} />
      {missingAlt > 0 && <Notice tone="warn">{missingAlt} image{missingAlt === 1 ? ' needs' : 's need'} alt text for shoppers using screen readers.</Notice>}
      {!list.length ? (
        <p className="muted">No images yet. The shop shows a simple illustration until you add photos.</p>
      ) : (
        <div className="image-grid">
          {list.map((img, i) => (
            <div className="image-tile" key={img.id}>
              <img src={`/api/media/${img.id}`} alt="" />
              <TextInput label="Alt text" value={img.alt} onChange={(v) => setList(list.map((x) => (x.id === img.id ? { ...x, alt: v } : x)))} maxLength={250} />
              {variants.length > 0 && (
                <Select label="Variant" value={img.variant_id ?? ''} onChange={(v) => setList(list.map((x) => (x.id === img.id ? { ...x, variant_id: v || null } : x)))} options={[{ value: '', label: 'All variants' }, ...variants.map((v) => ({ value: v.id, label: v.title }))]} />
              )}
              <div className="button-row">
                <button type="button" className="icon-button" aria-label="Move earlier" disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp size={16} aria-hidden="true" /></button>
                <button type="button" className="icon-button" aria-label="Move later" disabled={i === list.length - 1} onClick={() => move(i, 1)}><ArrowDown size={16} aria-hidden="true" /></button>
                <button
                  type="button"
                  className="icon-button"
                  aria-label="Delete image"
                  onClick={async () => {
                    await api(`/api/admin/products/${productId}/images/${img.id}`, { method: 'DELETE' })
                    reload()
                  }}
                >
                  <Trash2 size={16} aria-hidden="true" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      {list.length > 0 && (
        <div className="button-row">
          <button type="button" className="button button--small" onClick={save}>Save image order and alt text</button>
          {saved && <span role="status">{saved}</span>}
        </div>
      )}
    </section>
  )
}

/**
 * Sample pages and close up details for "Peek inside". Each upload is
 * flattened with a PREVIEW watermark on the server, then waits for the
 * owner's approval. These are separate images: the paid file is never used
 * or shown here.
 */
function Previews({ productId, images, reload }: { productId: string; images: Detail['images']; reload: () => void }) {
  const [list, setList] = useState(images)
  const [progress, setProgress] = useState<{ name: string; value: number } | null>(null)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState('')
  useEffect(() => setList(images), [images])

  const upload = async (files: FileList | null, kind: 'sample' | 'detail') => {
    if (!files?.length) return
    setError('')
    for (const f of Array.from(files)) {
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(f.type)) {
        setError(`${f.name} is not a PNG, JPG or WebP image.`)
        continue
      }
      try {
        setProgress({ name: f.name, value: 0 })
        await uploadAsset('product_image', productId, f, { imageKind: kind, onProgress: (v) => setProgress({ name: f.name, value: v }) })
      } catch (err) {
        setError(`${f.name}: ${errorMessage(err)}`)
      }
    }
    setProgress(null)
    reload()
  }
  const approve = async (imageId: string, approved: boolean) => {
    setError('')
    try {
      await api(`/api/admin/products/${productId}/images/${imageId}/approval`, { body: { approved } })
      reload()
    } catch (err) {
      setError(errorMessage(err))
    }
  }
  const move = (i: number, d: number) => {
    const next = [...list]
    const [x] = next.splice(i, 1)
    next.splice(i + d, 0, x)
    setList(next)
  }
  const save = async () => {
    setError('')
    try {
      await api(`/api/admin/products/${productId}/images`, { method: 'PUT', body: { images: list.map((i) => ({ id: i.id, alt: i.alt, kind: i.kind, variant_id: i.variant_id })) } })
      setSaved('Preview details saved.')
      reload()
    } catch (err) {
      setError(errorMessage(err))
    }
  }
  const waiting = list.filter((i) => !i.approved).length
  return (
    <section className="panel form-stack">
      <div className="panel__head">
        <h2 className="panel__title">Sample previews</h2>
        <div className="button-row">
          <label className="button button--outline button--small">
            <ImagePlus size={16} aria-hidden="true" /> Add sample pages
            <input type="file" accept="image/png,image/jpeg,image/webp" multiple hidden onChange={(e) => { void upload(e.target.files, 'sample'); e.target.value = '' }} />
          </label>
          <label className="button button--outline button--small">
            <ImagePlus size={16} aria-hidden="true" /> Add close up details
            <input type="file" accept="image/png,image/jpeg,image/webp" multiple hidden onChange={(e) => { void upload(e.target.files, 'detail'); e.target.value = '' }} />
          </label>
        </div>
      </div>
      <p className="muted">
        Upload a few selected pages or cropped details (screenshots or exports), not the whole resource. Each image is stamped with a PREVIEW watermark built into the picture, then waits for your
        approval. Approved previews appear behind the “Peek inside” button. Your paid file is never shown. Products can also be published with no previews at all.
      </p>
      {progress && <ProgressBar value={progress.value} label={`Uploading and watermarking ${progress.name}`} />}
      <FormError message={error} />
      {waiting > 0 && <Notice tone="warn">{waiting} preview{waiting === 1 ? ' is' : 's are'} waiting for your approval and not shown yet.</Notice>}
      {!list.length ? (
        <p className="muted">No previews. The “Peek inside” button is hidden for this product.</p>
      ) : (
        <div className="image-grid">
          {list.map((img, i) => (
            <div className="image-tile" key={img.id}>
              <img src={`/api/media/${img.id}`} alt="" />
              <Pill value={img.approved ? 'published' : 'pending'} label={img.approved ? 'Approved, shown' : 'Waiting for approval'} />
              <TextInput label="Caption and alt text" value={img.alt} onChange={(v) => setList(list.map((x) => (x.id === img.id ? { ...x, alt: v } : x)))} maxLength={250} hint="For example “Daily planner page”." />
              <Select label="Type" value={img.kind as 'sample' | 'detail'} onChange={(v) => setList(list.map((x) => (x.id === img.id ? { ...x, kind: v } : x)))} options={[{ value: 'sample', label: 'Sample page' }, { value: 'detail', label: 'Close up detail' }]} />
              <div className="button-row">
                {img.approved ? (
                  <button type="button" className="button button--outline button--small" onClick={() => approve(img.id, false)}>Hide</button>
                ) : (
                  <button type="button" className="button button--small" onClick={() => approve(img.id, true)}>Approve</button>
                )}
                <button type="button" className="icon-button" aria-label="Move earlier" disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp size={16} aria-hidden="true" /></button>
                <button type="button" className="icon-button" aria-label="Move later" disabled={i === list.length - 1} onClick={() => move(i, 1)}><ArrowDown size={16} aria-hidden="true" /></button>
                <button
                  type="button"
                  className="icon-button"
                  aria-label="Delete preview"
                  onClick={async () => {
                    await api(`/api/admin/products/${productId}/images/${img.id}`, { method: 'DELETE' })
                    reload()
                  }}
                >
                  <Trash2 size={16} aria-hidden="true" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      {list.length > 0 && (
        <div className="button-row">
          <button type="button" className="button button--small" onClick={save}>Save preview order and captions</button>
          {saved && <span role="status">{saved}</span>}
        </div>
      )}
    </section>
  )
}

interface FileResult {
  outcome: 'released' | 'first_file' | 'identical' | 'kept_for_draft' | 'already_released'
  versionNumber?: number | null
  releaseId?: string
  granted?: number
  notifications?: number
  emailConfigured?: boolean
}

function fileMessage(f: FileResult) {
  switch (f.outcome) {
    case 'released':
      return `Saved. Version ${f.versionNumber} is live: ${f.granted} eligible buyer${f.granted === 1 ? '' : 's'} have one download of it, and ${f.notifications} customer${f.notifications === 1 ? '' : 's'} who downloaded an older version will be emailed.`
    case 'first_file':
      return `Saved. Version ${f.versionNumber} is the product's file.`
    case 'identical':
      return 'Saved. The new file is identical to the current one, so nothing was released and no one was emailed.'
    case 'kept_for_draft':
      return 'Saved. The product is a draft, so the new file was kept and not released. Publish the product and save again to release it.'
    default:
      return 'Saved. This file was already released.'
  }
}

const statusWords: Array<['queued' | 'sent' | 'skipped' | 'held' | 'failed' | 'canceled', string]> = [
  ['queued', 'queued'],
  ['sent', 'sent'],
  ['skipped', 'skipped'],
  ['held', 'held (email not connected)'],
  ['failed', 'failed'],
  ['canceled', 'replaced by a newer version'],
]

/**
 * The product's downloadable file. Choosing a new file uploads it privately;
 * nothing changes for customers until the product is saved. Saving an
 * existing published product with a new file releases it automatically.
 */
function Files({
  productId,
  data,
  reload,
  replacement,
  setReplacement,
  notes,
  setNotes,
  result,
}: {
  productId: string
  data: Detail
  reload: () => void
  replacement: Detail['uploads'][number] | null
  setReplacement: (u: Detail['uploads'][number] | null) => void
  notes: string
  setNotes: (v: string) => void
  result: FileResult | null
}) {
  const [progress, setProgress] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const { showToast } = useUI()
  const notices = useApiData<{ notifications: Array<{ id: string; status: string; status_reason: string; customer_email: string; email_id: string | null; email_status: string | null; user_id: string }> }>(
    open ? `/api/admin/products/${productId}/releases/${open}/notifications` : null,
  )

  const upload = async (f: File | undefined) => {
    if (!f) return
    setError('')
    try {
      setProgress(0)
      const row = await uploadAsset<Detail['uploads'][number]>('product_file', productId, f, { onProgress: setProgress })
      setReplacement(row)
      showToast('File uploaded privately. Press Save to use it.')
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setProgress(null)
    }
  }
  const retry = async (releaseId: string) => {
    setError('')
    try {
      const r = await api<{ count: number }>(`/api/admin/products/${productId}/releases/${releaseId}/notifications/retry`, { body: {} })
      showToast(`Trying ${r.count} notification${r.count === 1 ? '' : 's'} again.`)
      reload()
      notices.reload()
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  const current = data.versions[0]
  const published = data.product.status === 'published' && !data.product.archived_at
  return (
    <section className="panel form-stack">
      <h2 className="panel__title">Downloadable file</h2>
      {current ? (
        <p>
          Current file: <strong>{current.file_name}</strong> • version {current.version_number} • {size(current.file_size)} • released {dateTime(current.released_at)}
        </p>
      ) : (
        <p className="muted">No file yet. Customers who buy before the first file see "Your file is being prepared", and receive their download when you save the product with a file.</p>
      )}
      <div className="replace-file">
        <label className="button button--outline button--small" style={{ justifySelf: 'start' }}>
          <FileUp size={16} aria-hidden="true" /> {current ? 'Choose a replacement file' : 'Choose the file'}
          <input type="file" accept=".pdf,.zip,.png,.jpg,.jpeg,application/pdf,application/zip,image/png,image/jpeg" hidden onChange={(e) => { void upload(e.target.files?.[0]); e.target.value = '' }} />
        </label>
        {current && (
          <p className="replace-file__note">
            Saving a new PDF will automatically update this product, make one download of the latest version available to eligible buyers, and notify customers who downloaded an older version.
          </p>
        )}
      </div>
      <p className="field__hint">PDF, ZIP, PNG or JPG, up to {data.fileLimitMb ?? 200} MB. Stored privately. Saving the same file again changes nothing.</p>
      {progress !== null && <ProgressBar value={progress} label="Uploading file" />}
      {replacement && (
        <Notice tone="warn">
          <strong>{replacement.file_name}</strong> ({size(replacement.file_size)}) is uploaded and ready. It is used when you press <strong>Save changes</strong>.
          {current && !published && ' This product is not published, so saving keeps the file without releasing it.'}{' '}
          <button type="button" className="button button--outline button--small" onClick={() => setReplacement(null)}>Don't use this file</button>
        </Notice>
      )}
      {replacement && current && published && (
        <TextArea label="What changed (optional)" value={notes} onChange={setNotes} maxLength={2000} rows={3} hint="Shown in the update email and on My downloads. You can leave it empty." />
      )}
      <FormError message={error} />
      {result && (
        <div className="update-status" role="status">
          <strong>{fileMessage(result)}</strong>
          {result.outcome === 'released' && !result.emailConfigured && Boolean(result.notifications) && (
            <p>Email sending (Resend) is not connected yet. The update and downloads are live; the emails are kept and shown as held until you retry them below.</p>
          )}
        </div>
      )}
      {!replacement && data.uploads.length > 0 && (
        <details>
          <summary>Uploaded earlier but never saved ({data.uploads.length})</summary>
          <ul className="plain-list">
            {data.uploads.map((u) => (
              <li key={u.id}>
                {u.file_name} <span className="muted">• {size(u.file_size)} • {dateTime(u.created_at)}</span>{' '}
                <button type="button" className="button button--outline button--small" onClick={() => setReplacement(u)}>Use this file</button>
              </li>
            ))}
          </ul>
        </details>
      )}
      {data.versions.length > 0 && (
        <div className="data-table-wrap">
          <table className="data-table">
            <thead><tr><th>Version</th><th>File</th><th>What changed</th><th>Released</th><th>Downloads and emails</th></tr></thead>
            <tbody>
              {data.versions.map((v) => {
                const r = data.releases.find((x) => x.version_id === v.id)
                const st = r ? data.releaseStatus[r.id] : undefined
                const total = st ? Object.values(st).reduce((a, b) => a + b, 0) : 0
                return (
                  <tr key={v.id}>
                    <td>v{v.version_number}</td>
                    <td>{v.file_name}<br /><span className="muted">{size(v.file_size)}</span></td>
                    <td>{v.notes || <span className="muted">None</span>}</td>
                    <td>{dateTime(v.released_at)}<br /><span className="muted">{v.released_by}</span></td>
                    <td>
                      {!r || (!r.notify && r.trigger === 'save') ? 'First file: no update emails' : `${r.granted_count} of ${r.affected_count} eligible buyers have one download`}
                      {r && (r.notify || r.trigger !== 'save') && (total ? (
                        <>
                          <br />
                          Emails: {statusWords.filter(([k]) => st![k]).map(([k, w]) => `${st![k]} ${w}`).join(', ')}
                          <div className="button-row">
                            <button type="button" className="button button--outline button--small" onClick={() => setOpen(open === r.id ? null : r.id)}>
                              {open === r.id ? 'Hide' : 'Show'} customers
                            </button>
                            {(st!.held > 0 || st!.failed > 0) && (
                              <button type="button" className="button button--small" disabled={!data.emailConfigured} onClick={() => retry(r.id)}>
                                Retry notifications
                              </button>
                            )}
                          </div>
                          {(st!.held > 0 || st!.failed > 0) && !data.emailConfigured && <span className="muted">Connect Resend to retry.</span>}
                        </>
                      ) : (
                        <><br /><span className="muted">{r.trigger === 'save' ? 'No one to email (no one downloaded an older version).' : 'Released before automatic emails.'}</span></>
                      ))}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      {open && (
        <div className="data-table-wrap">
          <table className="data-table">
            <thead><tr><th>Customer</th><th>Email</th><th>Why</th></tr></thead>
            <tbody>
              {(notices.data?.notifications ?? []).map((n) => (
                <tr key={n.id}>
                  <td><a href={href(`admin-customer-${n.user_id}`)}>{n.customer_email}</a></td>
                  <td>
                    <Pill value={n.email_status ?? n.status} />
                    {n.email_id && <> <a href={href(`admin-email-${n.email_id}`)}>Email log</a></>}
                  </td>
                  <td className="muted">{n.status_reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
