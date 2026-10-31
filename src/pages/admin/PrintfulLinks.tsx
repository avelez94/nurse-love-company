import { RefreshCw } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Checkbox, dateTime, FormError, Loading, Notice, Pill, Select, useApiData } from '../../components/ui'
import { Dialog } from '../../components/Dialog'
import { api, errorMessage } from '../../lib/api'
import { href } from '../../lib/router'
import { useUI } from '../../lib/ui'

/*
  Product editor > Printful. Each sellable option is linked by hand to one
  exact Printful variant (the product and design already set up in
  Printful). Nothing is matched automatically; unlinked or unavailable
  options cannot be bought.
*/

interface Link {
  sync_variant_id: string
  name: string
  size: string
  color: string
  available: boolean
  problem: string
  checked_at: string | null
}
interface Item {
  variant_id: string | null
  title: string
  link: Link | null
}
interface SyncVariant {
  id: number
  name: string
  size?: string
  color?: string
  availability_status?: string
  is_ignored?: boolean
  synced?: boolean
}

export function PrintfulLinks({ productId, variantsKey, reload }: { productId: string; variantsKey: string; reload: () => void }) {
  const links = useApiData<{ items: Item[]; syncProductId: string | null; extraLinks: number }>(`/api/admin/products/${productId}/printful?k=${encodeURIComponent(variantsKey)}`)
  const [catalog, setCatalog] = useState<Array<{ id: number; name: string; variants: number }> | null>(null)
  const [catalogError, setCatalogError] = useState('')
  const [syncProductId, setSyncProductId] = useState('')
  const [variants, setVariants] = useState<SyncVariant[] | null>(null)
  const [choice, setChoice] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const { showToast } = useUI()
  const d = links.data

  useEffect(() => {
    api<{ products: Array<{ id: number; name: string; variants: number }> }>('/api/admin/printful/products').then(
      (r) => setCatalog(r.products),
      (err) => setCatalogError(errorMessage(err)),
    )
  }, [])
  useEffect(() => {
    if (!d) return
    if (d.syncProductId && !syncProductId) setSyncProductId(String(d.syncProductId))
    setChoice(Object.fromEntries(d.items.map((i) => [i.variant_id ?? 'product', i.link ? String(i.link.sync_variant_id) : ''])))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d])
  useEffect(() => {
    if (!syncProductId) return setVariants(null)
    setVariants(null)
    api<{ sync_variants: SyncVariant[] }>(`/api/admin/printful/products/${syncProductId}`).then(
      (r) => setVariants(r.sync_variants),
      (err) => setError(errorMessage(err)),
    )
  }, [syncProductId])

  const act = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true)
    setError('')
    try {
      await fn()
      showToast(done)
      await links.reload()
      reload()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }
  const save = () =>
    act(
      () =>
        api(`/api/admin/products/${productId}/printful`, {
          method: 'PUT',
          body: { sync_product_id: Number(syncProductId), links: Object.entries(choice).map(([k, v]) => ({ variant_id: k === 'product' ? null : k, sync_variant_id: v ? Number(v) : '' })) },
        }),
      'Printful links saved.',
    )
  const label = (v: SyncVariant) => `${v.name}${v.availability_status && v.availability_status !== 'active' ? ` (${v.availability_status.replace(/_/g, ' ')})` : ''}${v.is_ignored ? ' (ignored)' : ''}`
  const noOptions = d?.items.length === 1 && d.items[0].variant_id === null

  return (
    <section className="panel form-stack">
      <div className="panel__head">
        <h2 className="panel__title">Printful (made and shipped by Printful)</h2>
        <button type="button" className="button button--outline button--small" disabled={busy} onClick={() => act(() => api('/api/admin/printful/refresh', { body: {} }), 'Checked with Printful.')}>
          <RefreshCw size={16} aria-hidden="true" /> Check availability
        </button>
      </div>
      <p className="muted">
        Link each option to its exact variant in your Printful store (with its approved design). Options that are not linked, or that Printful cannot make right now, cannot be bought. See{' '}
        <a href={href('admin-printful')}>Settings, Printful</a> for the connection.
      </p>
      {catalogError && <Notice tone="warn">{catalogError}</Notice>}
      {!d ? (
        <Loading />
      ) : (
        <>
          <ul className="plain-list">
            {d.items.map((i) => (
              <li key={i.variant_id ?? 'product'}>
                <strong>{i.title}</strong>:{' '}
                {i.link ? (
                  <>
                    {i.link.name} <Pill value={i.link.available ? 'ready' : 'failed'} label={i.link.available ? 'Ready' : 'Cannot be bought'} />
                    {i.link.problem && <span className="muted"> {i.link.problem}</span>}
                  </>
                ) : (
                  <Pill value="pending" label="Not linked: cannot be bought" />
                )}
              </li>
            ))}
          </ul>
          {catalog && (
            <Select
              label="Printful product"
              value={syncProductId}
              onChange={setSyncProductId}
              options={[{ value: '', label: 'Choose the product in your Printful store' }, ...catalog.map((p) => ({ value: String(p.id), label: `${p.name} (${p.variants} variants)` }))]}
            />
          )}
          {syncProductId && !variants && !error && <Loading label="Reading the Printful product..." />}
          {variants && (
            <>
              {d.items.map((i) => {
                const key = i.variant_id ?? 'product'
                return (
                  <Select
                    key={key}
                    label={`${i.title} is Printful variant`}
                    value={choice[key] ?? ''}
                    onChange={(v) => setChoice({ ...choice, [key]: v })}
                    options={[{ value: '', label: 'Not linked' }, ...variants.map((v) => ({ value: String(v.id), label: label(v) }))]}
                  />
                )
              })}
              <div className="button-row">
                <button type="button" className="button button--small" disabled={busy} onClick={save}>
                  Save links
                </button>
                {noOptions && variants.length > 1 && (
                  <button
                    type="button"
                    className="button button--outline button--small"
                    disabled={busy}
                    onClick={() => act(() => api(`/api/admin/products/${productId}/printful/import`, { body: { sync_product_id: Number(syncProductId) } }), 'Options created from Printful and linked.')}
                  >
                    Create options from these {variants.filter((v) => !v.is_ignored).length} Printful variants
                  </button>
                )}
              </div>
            </>
          )}
        </>
      )}
      <FormError message={error || links.error} />
    </section>
  )
}

/**
 * Paid preorders for this product waiting on the website. "Send preorders to
 * Printful" sends every waiting order whose preorder items are all ready.
 */
export function PreorderPanel({ productId }: { productId: string }) {
  const data = useApiData<{ preorders: Array<{ orders: number; items: number; oldest: string }> }>(`/api/admin/printful/preorders?product=${productId}`)
  const { showToast } = useUI()
  const [open, setOpen] = useState(false)
  const [confirm, setConfirm] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const waiting = data.data?.preorders[0]
  if (!waiting) return null
  const release = async () => {
    setBusy(true)
    setError('')
    try {
      const r = await api<{ sent: number; stillWaiting: number }>(`/api/admin/products/${productId}/preorders/release`, { body: { confirm } })
      showToast(`Sent ${r.sent} order${r.sent === 1 ? '' : 's'} to Printful.${r.stillWaiting ? ` ${r.stillWaiting} still wait for another preorder item.` : ''}`)
      setOpen(false)
      await data.reload()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="panel form-stack">
      <h2 className="panel__title">Preorders waiting</h2>
      <p>
        <strong>
          {waiting.orders} paid order{waiting.orders === 1 ? '' : 's'} ({waiting.items} item{waiting.items === 1 ? '' : 's'})
        </strong>{' '}
        waiting since {dateTime(waiting.oldest)}. Nothing has been sent to Printful yet.
      </p>
      <button type="button" className="button button--small" onClick={() => setOpen(true)}>
        Send preorders to Printful
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Send preorders to Printful?">
        <p>Every waiting order for this product goes to Printful now, with each customer's address and the shipping they paid for. Customers get an email that their order is being made.</p>
        <Checkbox
          label="Confirm for production now"
          checked={confirm}
          onChange={setConfirm}
          hint="Printful starts making them and charges your Printful billing method. Untick to send them as drafts you confirm later."
        />
        <p className="muted">Orders that also hold another preorder item keep waiting until that one is sent too. Turn off Preorder on the product when you want new orders to go straight to Printful.</p>
        <FormError message={error} />
        <div className="button-row">
          <button type="button" className="button button--small" disabled={busy} onClick={release}>
            {busy ? 'Sending...' : 'Send to Printful'}
          </button>
          <button type="button" className="button button--outline button--small" onClick={() => setOpen(false)}>
            Not yet
          </button>
        </div>
      </Dialog>
    </section>
  )
}
