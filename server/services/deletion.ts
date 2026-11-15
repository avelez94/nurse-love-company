/*
  Delete forever: products, banners, quizzes and tutorials.

  This replaced "Archive". Deleting removes the item, its pictures, files and
  videos for good. Nothing can be restored.

  The one exception is a product someone has bought or claimed. Its order
  records and the buyer's downloads must stay, so it cannot be deleted. The
  owner is told to turn it off instead (it stays out of the shop).

  Items archived before this change are deleted once by the maintenance job
  (deleteArchivedOnce), and every deletion is written to the audit log.
*/
import type { SessionUser } from '../auth.js'
import { one, q, tx } from '../db/pool.js'
import { audit } from '../lib/audit.js'
import { conflict, notFound } from '../lib/errors.js'
import { storage } from '../lib/storage.js'
import { deleteMuxAsset } from './tutorials.js'

export type DeleteKind = 'product' | 'banner' | 'quiz' | 'tutorial'

/** Removes stored objects nothing else points at. Never fails the delete. */
async function removeObjects(keys: Array<string | null | undefined>) {
  for (const key of new Set(keys.filter((k): k is string => Boolean(k)))) {
    const stillUsed = await one(
      `select 1 where exists (select 1 from product_images where storage_key = $1)
          or exists (select 1 from product_versions where storage_key = $1)
          or exists (select 1 from product_file_uploads where storage_key = $1)
          or exists (select 1 from marketing_banners where image_key = $1)
          or exists (select 1 from marketing_popup where image_key = $1)
          or exists (select 1 from tutorials where $1 in (thumbnail_key, video_key, poster_key))`,
      [key],
    )
    if (!stillUsed) await storage().remove(key).catch(() => {})
  }
}

/** Why a product cannot be deleted, or null when it can. */
export async function productDeleteBlock(id: string) {
  const r = await one<{ items: number; ents: number }>(
    `select (select count(*) from order_items where product_id = $1)::int as items,
            (select count(*) from entitlements where product_id = $1)::int as ents`,
    [id],
  )
  if (r && (r.items || r.ents)) {
    return 'Someone has bought or claimed this product, so it cannot be deleted: their order and downloads must stay. Turn it off instead (Deactivate) and it stays out of the shop.'
  }
  return null
}

async function deleteProductRow(id: string) {
  const p = await one<{ title: string }>('select title from products where id = $1', [id])
  if (!p) throw notFound('Product')
  const block = await productDeleteBlock(id)
  if (block) throw conflict(block, 'has_purchases')
  const keys = await tx(async (c) => {
    const found = await q<{ k: string }>(
      `select storage_key as k from product_images where product_id = $1
       union select storage_key from product_versions where product_id = $1
       union select storage_key from product_file_uploads where product_id = $1
       union select storage_key from storage_uploads where target_id = $1`,
      [id],
      c,
    )
    // Lets this transaction, and only this one, remove the product's file versions.
    await q(`select set_config('nlc.deleting_product', $1, true)`, [id], c)
    await q('update products set current_version_id = null where id = $1', [id], c)
    await q('delete from update_notifications where product_id = $1', [id], c)
    await q('delete from product_releases where product_id = $1', [id], c)
    await q('delete from product_file_uploads where product_id = $1', [id], c)
    await q('delete from product_versions where product_id = $1', [id], c)
    await q('delete from storage_uploads where target_id = $1', [id], c)
    await q('delete from products where id = $1', [id], c)
    return found.map((f) => f.k)
  })
  await removeObjects(keys)
  return p.title
}

async function deleteBannerRow(id: string) {
  const b = await one<{ name: string; image_key: string | null }>('select name, image_key from marketing_banners where id = $1', [id])
  if (!b) throw notFound('Banner')
  const keys = await tx(async (c) => {
    const found = await q<{ k: string }>('select storage_key as k from storage_uploads where target_id = $1', [id], c)
    await q(`delete from marketing_stats where kind = 'banner' and item_id = $1`, [id], c)
    await q('delete from storage_uploads where target_id = $1', [id], c)
    await q('delete from marketing_banners where id = $1', [id], c)
    return found.map((f) => f.k)
  })
  await removeObjects([b.image_key, ...keys])
  return b.name
}

async function deleteQuizRow(id: string) {
  const r = await one<{ name: string }>('select name from quizzes where id = $1', [id])
  if (!r) throw notFound('Quiz')
  await q('delete from quizzes where id = $1', [id])
  return r.name
}

async function deleteTutorialRow(id: string) {
  const t = await one<{ title: string; thumbnail_key: string | null; video_key: string | null; poster_key: string | null; mux_asset_id: string | null }>(
    'select title, thumbnail_key, video_key, poster_key, mux_asset_id from tutorials where id = $1',
    [id],
  )
  if (!t) throw notFound('Tutorial')
  const keys = await tx(async (c) => {
    const found = await q<{ k: string }>('select storage_key as k from storage_uploads where target_id = $1', [id], c)
    await q('delete from storage_uploads where target_id = $1', [id], c)
    await q('delete from tutorials where id = $1', [id], c)
    return found.map((f) => f.k)
  })
  await removeObjects([t.thumbnail_key, t.video_key, t.poster_key, ...keys])
  if (t.mux_asset_id) await deleteMuxAsset(t.mux_asset_id).catch(() => {})
  return t.title
}

const deleters: Record<DeleteKind, (id: string) => Promise<string>> = {
  product: deleteProductRow,
  banner: deleteBannerRow,
  quiz: deleteQuizRow,
  tutorial: deleteTutorialRow,
}
const words: Record<DeleteKind, string> = { product: 'product', banner: 'banner', quiz: 'quiz', tutorial: 'tutorial' }

/** Deletes one item forever and records it in the audit log. */
export async function deleteForever(actor: SessionUser | null, kind: DeleteKind, id: string, ip?: string) {
  const name = await deleters[kind](id)
  await audit({ actor, action: `${kind}.deleted`, entityType: kind, entityId: id, summary: `Deleted ${words[kind]} "${name}" forever`, ip })
  return { deleted: true }
}

/**
  One time cleanup: deletes everything that was archived before archiving was
  replaced by delete. Products someone bought are kept (see above). Runs once.
*/
export async function deleteArchivedOnce() {
  // Waits until the database update that allows deleting products has been run.
  const ready = await one(`select 1 from schema_migrations where name = '011_delete_forever.sql'`).catch(() => null)
  if (!ready) return null
  const claimed = await one(
    `insert into app_settings (key, value, updated_by) values ('archived_items_deleted', to_jsonb(now()), 'system')
     on conflict (key) do nothing returning key`,
  )
  if (!claimed) return null
  const rows = await q<{ kind: DeleteKind; id: string }>(
    `select 'product' as kind, id::text from products where archived_at is not null
     union all select 'banner', id::text from marketing_banners where status = 'archived'
     union all select 'quiz', id::text from quizzes where status = 'archived'
     union all select 'tutorial', id::text from tutorials where status = 'archived'`,
  )
  const result = { deleted: 0, kept: [] as string[] }
  for (const r of rows) {
    try {
      await deleteForever(null, r.kind, r.id)
      result.deleted++
    } catch (err) {
      if ((err as { code?: string }).code !== 'has_purchases') {
        result.kept.push(`${r.kind} ${r.id}: ${(err as Error).message}`)
        continue
      }
      const title = await one<{ title: string }>('select title from products where id = $1', [r.id])
      result.kept.push(title?.title ?? r.id)
      if (r.kind === 'product') {
        await q('update products set archived_at = null, active = false, featured = false, updated_at = now() where id = $1', [r.id])
        await audit({
          actor: null,
          action: 'product.kept',
          entityType: 'product',
          entityId: r.id,
          summary: `Kept "${title?.title ?? r.id}" instead of deleting it: someone bought or claimed it. It stays turned off.`,
        })
      }
    }
  }
  return result
}
