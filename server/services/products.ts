/*
  Admin product management. Listing edits (title, description, price,
  images, typos) only change the products table and never touch product
  versions or entitlements. New downloads come only from publishRelease().
*/
import { config } from '../env.js'
import type { SessionUser } from '../auth.js'
import { one, q, tx } from '../db/pool.js'
import { audit } from '../lib/audit.js'
import { badRequest, conflict, notFound } from '../lib/errors.js'
import { storage } from '../lib/storage.js'
import { bool, int, oneOf, slug as slugField, str, strList, uuid } from '../lib/validate.js'
import { sanitizeDoc } from '../../shared/richtext.js'
import { countAffectedPurchasers } from './entitlements.js'

export const CATEGORIES = ['nurse-inserts', 'np-inserts', 'apparel', 'accessories', 'pens', 'other'] as const
export const PAGE_SIZES = ['US Letter (8.5 × 11 in)', 'A4 (210 × 297 mm)', 'A5 (148 × 210 mm)', 'Half Letter (5.5 × 8.5 in)', 'Other'] as const

export function parseProductInput(b: Record<string, unknown>) {
  const type = oneOf(b.type, 'Product type', ['digital', 'physical'] as const)
  const price = int(b.price_cents, 'Price', { optional: true, max: 10_000_000 })
  const sale = int(b.sale_price_cents, 'Sale price', { optional: true, max: 10_000_000 })
  if (sale !== null && (price === null || sale >= price)) throw badRequest('Sale price must be lower than the regular price.')
  const base = {
    title: str(b.title, 'Product title', { min: 1, max: 160 }),
    slug: slugField(b.slug),
    category: oneOf(b.category, 'Category', CATEGORIES),
    collection: str(b.collection, 'Collection', { optional: true, max: 80 }),
    type,
    short_description: str(b.short_description, 'Short description', { optional: true, max: 300 }),
    description: sanitizeDoc(b.description),
    price_cents: price,
    sale_price_cents: sale,
    featured: bool(b.featured),
    sort_order: int(b.sort_order, 'Display order', { optional: true, min: -100000, max: 100000 }) ?? 0,
  }
  const digital =
    type === 'digital'
      ? {
          page_count: int(b.page_count, 'Number of pages', { optional: true, min: 1, max: 5000 }),
          page_size: b.page_size ? str(b.page_size, 'Page size', { max: 60 }) : null,
          orientation: b.orientation ? oneOf(b.orientation, 'Orientation', ['portrait', 'landscape'] as const) : null,
          file_format: b.file_format ? str(b.file_format, 'File format', { max: 40 }) : null,
          usage_attributes: strList(b.usage_attributes, 'Usage'),
          app_compatibility: strList(b.app_compatibility, 'App compatibility'),
          show_binder_notice: bool(b.show_binder_notice),
        }
      : { page_count: null, page_size: null, orientation: null, file_format: null, usage_attributes: [], app_compatibility: [], show_binder_notice: false }
  const physical =
    type === 'physical'
      ? {
          sku: b.sku ? str(b.sku, 'SKU', { max: 64 }) : null,
          weight_grams: int(b.weight_grams, 'Weight', { optional: true, max: 100000 }),
          shipping_info: str(b.shipping_info, 'Shipping information', { optional: true, max: 500 }),
          inventory_quantity: int(b.inventory_quantity, 'Inventory', { optional: true, min: -100000, max: 1000000 }) ?? 0,
          low_stock_threshold: int(b.low_stock_threshold, 'Low stock threshold', { optional: true, max: 100000 }) ?? 3,
          out_of_stock_behavior: oneOf(b.out_of_stock_behavior, 'Out of stock behavior', ['hide', 'show_sold_out', 'allow_backorder'] as const, 'show_sold_out'),
        }
      : { sku: null, weight_grams: null, shipping_info: '', inventory_quantity: 0, low_stock_threshold: 3, out_of_stock_behavior: 'show_sold_out' as const }
  return { ...base, ...digital, ...physical }
}

type ProductInput = ReturnType<typeof parseProductInput>
const COLUMNS: Array<keyof ProductInput> = [
  'title', 'slug', 'category', 'collection', 'type', 'short_description', 'description', 'price_cents', 'sale_price_cents', 'featured', 'sort_order',
  'page_count', 'page_size', 'orientation', 'file_format', 'usage_attributes', 'app_compatibility', 'show_binder_notice',
  'sku', 'weight_grams', 'shipping_info', 'inventory_quantity', 'low_stock_threshold', 'out_of_stock_behavior',
]

function values(input: ProductInput) {
  return COLUMNS.map((c) => (c === 'description' ? JSON.stringify(input[c]) : input[c]))
}

async function assertUnique(slugValue: string, sku: string | null, exceptId: string | null) {
  if (await one('select 1 from products where slug = $1 and id is distinct from $2', [slugValue, exceptId])) throw conflict('Another product already uses that URL slug.')
  if (sku && (await one('select 1 from products where sku = $1 and id is distinct from $2', [sku, exceptId]))) throw conflict('Another product already uses that SKU.')
}

export async function createProduct(actor: SessionUser, body: Record<string, unknown>, ip?: string) {
  const input = parseProductInput(body)
  await assertUnique(input.slug, input.sku, null)
  const placeholders = COLUMNS.map((_, i) => `$${i + 1}`).join(',')
  const row = await one<{ id: string }>(`insert into products (${COLUMNS.join(',')}, status, active) values (${placeholders}, 'draft', true) returning id`, values(input))
  await audit({ actor, action: 'product.created', entityType: 'product', entityId: row!.id, summary: `Created product ${input.title} (draft)`, ip })
  return row!
}

export async function updateProduct(actor: SessionUser, id: string, body: Record<string, unknown>, ip?: string) {
  const before = await one<Record<string, unknown>>('select * from products where id = $1', [id])
  if (!before) throw notFound('Product')
  const input = parseProductInput(body)
  if (input.type !== before.type) {
    const sold = await one('select 1 from order_items where product_id = $1', [id])
    if (sold) throw badRequest('The product type cannot change after it has been ordered. Duplicate it instead.')
  }
  await assertUnique(input.slug, input.sku, id)
  const sets = COLUMNS.map((c, i) => `${c} = $${i + 2}`).join(', ')
  await q(`update products set ${sets}, updated_at = now() where id = $1`, [id, ...values(input)])
  const changed = COLUMNS.filter((c) => JSON.stringify(before[c] ?? null) !== JSON.stringify(c === 'description' ? input[c] : (input[c] ?? null)))
  await audit({ actor, action: 'product.updated', entityType: 'product', entityId: id, summary: `Edited ${input.title}${changed.length ? `: ${changed.join(', ')}` : ''}. Listing edits do not grant downloads.`, data: { changed }, ip })
}

export async function setProductState(actor: SessionUser, id: string, action: 'publish' | 'unpublish' | 'activate' | 'deactivate' | 'archive' | 'unarchive', ip?: string) {
  const p = await one<{ title: string; type: string; price_cents: number | null; status: string; current_version_id: string | null }>('select * from products where id = $1', [id])
  if (!p) throw notFound('Product')
  const sql: Record<typeof action, string> = {
    publish: `status = 'published', published_at = coalesce(published_at, now())`,
    unpublish: `status = 'draft'`,
    activate: 'active = true',
    deactivate: 'active = false',
    archive: 'archived_at = now(), active = false, featured = false',
    unarchive: 'archived_at = null',
  }
  await q(`update products set ${sql[action]}, updated_at = now() where id = $1`, [id])
  const note = action === 'archive' || action === 'deactivate' ? ' New purchases are blocked; order history and eligible downloads are kept.' : ''
  const verb = { publish: 'Published', unpublish: 'Moved to draft', activate: 'Activated', deactivate: 'Deactivated', archive: 'Archived', unarchive: 'Restored from archive' }[action]
  await audit({ actor, action: `product.${action}`, entityType: 'product', entityId: id, summary: `${verb}: ${p.title}.${note}`, ip })
}

export async function duplicateProduct(actor: SessionUser, id: string, ip?: string) {
  return tx(async (client) => {
    const p = await one<Record<string, unknown>>('select * from products where id = $1', [id], client)
    if (!p) throw notFound('Product')
    let newSlug = `${p.slug}-copy`
    for (let n = 2; await one('select 1 from products where slug = $1', [newSlug], client); n++) newSlug = `${p.slug}-copy-${n}`
    const cols = COLUMNS.filter((c) => c !== 'slug' && c !== 'title' && c !== 'sku')
    const row = await one<{ id: string }>(
      `insert into products (title, slug, sku, ${cols.join(',')}, status, active, featured)
       select $2, $3, null, ${cols.join(',')}, 'draft', true, false from products where id = $1 returning id`,
      [id, `${p.title} (copy)`, newSlug],
      client,
    )
    // Images are copied as references to the same stored files. Product files and versions are not copied.
    await q(`insert into product_images (product_id, kind, storage_key, content_type, width, height, alt, sort_order) select $2, kind, storage_key, content_type, width, height, alt, sort_order from product_images where product_id = $1 and variant_id is null`, [id, row!.id], client)
    await q(`insert into product_variants (product_id, title, options, price_cents, inventory_quantity, sort_order) select $2, title, options, price_cents, 0, sort_order from product_variants where product_id = $1`, [id, row!.id], client)
    await audit({ actor, action: 'product.duplicated', entityType: 'product', entityId: row!.id, summary: `Duplicated ${p.title} as a new draft`, data: { from: id }, ip }, client)
    return row!
  })
}

export async function saveVariants(actor: SessionUser, productId: string, list: unknown, ip?: string) {
  if (!Array.isArray(list) || list.length > 100) throw badRequest('Variants must be a list of up to 100 options.')
  const p = await one<{ type: string; title: string }>('select type, title from products where id = $1', [productId])
  if (!p) throw notFound('Product')
  if (p.type !== 'physical') throw badRequest('Only physical products have variants.')
  const parsed = list.map((v: Record<string, unknown>, i) => ({
    id: v.id ? uuid(v.id, 'variant id') : null,
    title: str(v.title, `Variant ${i + 1} name`, { min: 1, max: 80 }),
    options: {
      ...(v.size ? { size: str(v.size, 'Size', { max: 30 }) } : {}),
      ...(v.color ? { color: str(v.color, 'Color', { max: 30 }) } : {}),
    },
    sku: v.sku ? str(v.sku, 'Variant SKU', { max: 64 }) : null,
    price_cents: int(v.price_cents, 'Variant price', { optional: true, max: 10_000_000 }),
    inventory_quantity: int(v.inventory_quantity, 'Variant inventory', { min: -100000, max: 1000000, optional: true }) ?? 0,
    active: v.active === undefined ? true : bool(v.active),
  }))
  await tx(async (client) => {
    const existing = await q<{ id: string }>('select id from product_variants where product_id = $1', [productId], client)
    const keep = new Set(parsed.filter((v) => v.id).map((v) => v.id))
    for (const e of existing) {
      if (keep.has(e.id)) continue
      const ordered = await one('select 1 from order_items where variant_id = $1', [e.id], client)
      // Variants with order history are deactivated rather than deleted.
      if (ordered) await q('update product_variants set active = false where id = $1', [e.id], client)
      else await q('delete from product_variants where id = $1', [e.id], client)
    }
    for (const [i, v] of parsed.entries()) {
      if (v.id && existing.some((e) => e.id === v.id)) {
        await q(`update product_variants set title=$2, options=$3, sku=$4, price_cents=$5, inventory_quantity=$6, active=$7, sort_order=$8 where id=$1`, [v.id, v.title, JSON.stringify(v.options), v.sku, v.price_cents, v.inventory_quantity, v.active, i], client)
      } else {
        await q(`insert into product_variants (product_id, title, options, sku, price_cents, inventory_quantity, active, sort_order) values ($1,$2,$3,$4,$5,$6,$7,$8)`, [productId, v.title, JSON.stringify(v.options), v.sku, v.price_cents, v.inventory_quantity, v.active, i], client)
      }
    }
    await audit({ actor, action: 'product.variants_saved', entityType: 'product', entityId: productId, summary: `Saved ${parsed.length} variant${parsed.length === 1 ? '' : 's'} for ${p.title}`, ip }, client)
  }).catch((err) => {
    if (String((err as Error).message).includes('product_variants_sku_key')) throw conflict('Two variants cannot share the same SKU.')
    throw err
  })
}

export async function updateImages(actor: SessionUser, productId: string, list: unknown, ip?: string) {
  if (!Array.isArray(list)) throw badRequest('Images must be a list.')
  for (const [i, img] of (list as Array<Record<string, unknown>>).entries()) {
    const id = uuid(img.id, 'image id')
    const alt = str(img.alt, 'Alt text', { optional: true, max: 250 })
    const variant = img.variant_id ? uuid(img.variant_id, 'variant') : null
    const kind = oneOf(img.kind, 'Image type', ['gallery', 'sample'] as const, 'gallery')
    await q('update product_images set alt = $3, sort_order = $4, variant_id = $5, kind = $6 where id = $1 and product_id = $2', [id, productId, alt, i, variant, kind])
  }
  await audit({ actor, action: 'product.images_updated', entityType: 'product', entityId: productId, summary: 'Updated image order, alt text or assignments', ip })
}

export async function deleteImage(actor: SessionUser, productId: string, imageId: string, ip?: string) {
  const img = await one<{ storage_key: string }>('delete from product_images where id = $1 and product_id = $2 returning storage_key', [imageId, productId])
  if (!img) throw notFound('Image')
  const stillUsed = await one('select 1 from product_images where storage_key = $1', [img.storage_key])
  if (!stillUsed) await storage().remove(img.storage_key).catch(() => {})
  await audit({ actor, action: 'product.image_deleted', entityType: 'product', entityId: productId, summary: 'Removed a product image', ip })
}

export async function adminProductList(filter: { search?: string; status?: string }) {
  const params: unknown[] = []
  const where: string[] = ['true']
  if (filter.search) {
    params.push(`%${filter.search.toLowerCase()}%`)
    where.push(`(lower(p.title) like $${params.length} or lower(p.slug) like $${params.length} or lower(coalesce(p.sku,'')) like $${params.length})`)
  }
  if (filter.status === 'archived') where.push('p.archived_at is not null')
  else if (filter.status === 'draft') where.push(`p.status = 'draft' and p.archived_at is null`)
  else if (filter.status === 'published') where.push(`p.status = 'published' and p.archived_at is null`)
  else if (filter.status === 'inactive') where.push('not p.active and p.archived_at is null')
  else if (filter.status !== 'all') where.push('p.archived_at is null')
  return q(
    `select p.id, p.slug, p.title, p.category, p.type, p.status, p.active, p.archived_at, p.featured, p.price_cents, p.sale_price_cents, p.is_demo, p.updated_at,
            p.inventory_quantity, p.low_stock_threshold,
            (select coalesce(sum(inventory_quantity),0) from product_variants v where v.product_id = p.id and v.active) as variant_stock,
            (select count(*) from product_variants v where v.product_id = p.id and v.active) as variant_count,
            (select version_number from product_versions v where v.id = p.current_version_id) as version_number,
            (select id from product_images i where i.product_id = p.id and i.kind = 'gallery' order by sort_order limit 1) as image_id
       from products p where ${where.join(' and ')} order by p.archived_at nulls first, p.sort_order, p.created_at desc`,
    params,
  )
}

export async function adminProductDetail(id: string) {
  const p = await one<Record<string, unknown>>('select * from products where id = $1', [id])
  if (!p) throw notFound('Product')
  const [images, variants, versions, uploads, releases, affected] = await Promise.all([
    q('select id, kind, alt, width, height, sort_order, variant_id, content_type from product_images where product_id = $1 order by kind, sort_order', [id]),
    q('select * from product_variants where product_id = $1 order by sort_order', [id]),
    q('select id, version_number, file_name, content_type, file_size, sha256, notes, released_at, released_by from product_versions where product_id = $1 order by version_number desc', [id]),
    q('select id, file_name, content_type, file_size, created_at, uploaded_by from product_file_uploads where product_id = $1 and released_version_id is null order by created_at desc', [id]),
    q('select id, version_id, notify, affected_count, granted_count, created_by, created_at from product_releases where product_id = $1 order by created_at desc', [id]),
    countAffectedPurchasers(id),
  ])
  const orders = await one<{ n: number }>('select count(distinct order_id)::int as n from order_items where product_id = $1', [id])
  return { product: p, images, variants, versions, uploads, releases, affected, orderCount: orders?.n ?? 0, fileLimitMb: Math.round(config.limits.productFileBytes / 1024 / 1024) }
}
