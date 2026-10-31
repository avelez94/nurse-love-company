/*
  Public catalog reads. Only published, active, unarchived products appear.
  Private product files are never referenced here: only public images.
*/
import { one, q, type Queryable } from '../db/pool.js'
import { sanitizeDoc } from '../../shared/richtext.js'
import { ymd } from '../lib/dates.js'

export interface PublicVariant {
  id: string
  title: string
  options: Record<string, string>
  priceCents: number | null
  inStock: boolean
  imageIds: string[]
}

export interface PublicImage {
  id: string
  url: string
  alt: string
  width: number | null
  height: number | null
  kind: 'gallery' | 'sample' | 'detail'
  variantId: string | null
}

export interface PublicProduct {
  id: string
  slug: string
  title: string
  category: string
  collection: string
  type: 'digital' | 'physical'
  shortDescription: string
  description: unknown
  priceCents: number | null
  salePriceCents: number | null
  featured: boolean
  /** In the Freebie Corner: free, claimed through checkout with an email list signup. */
  isFreebie: boolean
  isDemo: boolean
  images: PublicImage[]
  whatsIncluded: string[]
  walkthrough: { slug: string; title: string } | null
  variants: PublicVariant[]
  inStock: boolean
  soldOutBehavior: string
  /** Items that ship: paid now, made and shipped once ready, by this date (YYYY-MM-DD). */
  preorder: null | { shipBy: string }
  digital: null | {
    pageCount: number | null
    pageSize: string | null
    orientation: string | null
    fileFormat: string | null
    fileSizeBytes: number | null
    usage: string[]
    apps: string[]
    binderNotice: boolean
    versionNumber: number | null
    versionReleasedAt: string | null
  }
}

export const imageUrl = (id: string) => `/api/media/${id}`

type Row = Record<string, unknown> & { id: string }

export async function loadProducts(where: string, params: unknown[], client?: Queryable, opts: { publicView?: boolean } = {}): Promise<PublicProduct[]> {
  const rows = await q<Row>(
    `select p.*, v.file_size as version_file_size, v.version_number, v.released_at as version_released_at,
            t.slug as walkthrough_slug, t.title as walkthrough_title
       from products p left join product_versions v on v.id = p.current_version_id
       left join tutorials t on t.id = p.walkthrough_tutorial_id and t.status = 'published'
      where ${where} order by p.sort_order, p.created_at`,
    params,
    client,
  )
  if (!rows.length) return []
  const ids = rows.map((r) => r.id)
  // Sample pages and details are public only once the owner approved the watermarked image.
  const images = await q<Row>(`select * from product_images where product_id = any($1) ${opts.publicView ? 'and approved' : ''} order by sort_order, created_at`, [ids], client)
  const variants = await q<Row>('select * from product_variants where product_id = any($1) and active order by sort_order, created_at', [ids], client)
  // Physical items are made by Printful: available means linked to a Printful variant that can be made now. No local stock.
  const links = await q<Row>(`select product_id, variant_id from printful_links where product_id = any($1) and availability = 'active' and synced and not ignored and files_ready`, [ids], client)
  const makeable = (productId: string, variantId: string | null) => links.some((l) => l.product_id === productId && ((l.variant_id as string | null) ?? null) === variantId)
  return rows.map((r) => {
    const vs = variants.filter((v) => v.product_id === r.id)
    const imgs = images.filter((i) => i.product_id === r.id)
    const inStock = r.type === 'digital' || (vs.length ? vs.some((v) => makeable(r.id, v.id)) : makeable(r.id, null))
    return {
      id: r.id,
      slug: String(r.slug),
      title: String(r.title),
      category: String(r.category),
      collection: String(r.collection ?? ''),
      type: r.type as 'digital' | 'physical',
      shortDescription: String(r.short_description ?? ''),
      description: sanitizeDoc(r.description),
      priceCents: (r.price_cents as number | null) ?? null,
      salePriceCents: (r.sale_price_cents as number | null) ?? null,
      featured: Boolean(r.featured),
      isFreebie: Boolean(r.is_freebie),
      isDemo: Boolean(r.is_demo),
      inStock,
      soldOutBehavior: String(r.out_of_stock_behavior),
      preorder: r.type === 'physical' && r.preorder && r.preorder_ship_by ? { shipBy: ymd(r.preorder_ship_by as Date | string)! } : null,
      images: imgs.map((i) => ({ id: i.id, url: imageUrl(i.id), alt: String(i.alt ?? ''), width: (i.width as number) ?? null, height: (i.height as number) ?? null, kind: i.kind as 'gallery' | 'sample' | 'detail', variantId: (i.variant_id as string) ?? null })),
      whatsIncluded: (r.whats_included as string[]) ?? [],
      walkthrough: r.walkthrough_slug ? { slug: String(r.walkthrough_slug), title: String(r.walkthrough_title) } : null,
      variants: vs.map((v) => ({
        id: v.id,
        title: String(v.title),
        options: (v.options as Record<string, string>) ?? {},
        priceCents: (v.price_cents as number | null) ?? null,
        inStock: makeable(r.id, v.id),
        imageIds: imgs.filter((i) => i.variant_id === v.id).map((i) => i.id),
      })),
      digital:
        r.type === 'digital'
          ? {
              pageCount: (r.page_count as number) ?? null,
              pageSize: (r.page_size as string) ?? null,
              orientation: (r.orientation as string) ?? null,
              fileFormat: (r.file_format as string) ?? null,
              fileSizeBytes: (r.version_file_size as number) ?? null,
              usage: (r.usage_attributes as string[]) ?? [],
              apps: (r.app_compatibility as string[]) ?? [],
              binderNotice: Boolean(r.show_binder_notice),
              versionNumber: (r.version_number as number) ?? null,
              versionReleasedAt: (r.version_released_at as string) ?? null,
            }
          : null,
    }
  })
}

export const PUBLIC_WHERE = `p.status = 'published' and p.active and p.archived_at is null`

export async function publicCatalog() {
  const all = await loadProducts(PUBLIC_WHERE, [], undefined, { publicView: true })
  // Sold out items marked "hide" leave the shop.
  return all.filter((p) => p.inStock || p.soldOutBehavior !== 'hide')
}

export async function publicProduct(slug: string) {
  const [p] = await loadProducts(`${PUBLIC_WHERE} and p.slug = $1`, [slug], undefined, { publicView: true })
  return p ?? null
}

/** Admin preview: any product regardless of state. */
export async function previewProduct(id: string) {
  const [p] = await loadProducts('p.id = $1', [id])
  return p ?? null
}

/** May this image be served to the public? Only images of public products. */
export async function imageVisibility(imageId: string) {
  return one<{ storage_key: string; content_type: string; public: boolean }>(
    `select i.storage_key, i.content_type, (p.status = 'published' and p.active and p.archived_at is null and i.approved) as public
       from product_images i join products p on p.id = i.product_id where i.id = $1`,
    [imageId],
  )
}
