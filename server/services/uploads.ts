/*
  Uploads, two ways, one set of rules:
  * Through the server (local development and single servers): the browser
    sends the file to an admin endpoint, which stores and checks it.
  * Direct to Supabase Storage (Vercel): an admin asks for an upload, the
    server records exactly what may be uploaded where and returns a one path
    upload link; the browser sends the file straight to storage; then the
    server reads the file back, checks its real size and type, and only then
    attaches it. Nothing uploaded is visible to customers until it is attached
    and, for product files, released.
*/
import { randomUUID } from 'node:crypto'
import type { SessionUser } from '../auth.js'
import { one, q } from '../db/pool.js'
import { config } from '../env.js'
import { audit } from '../lib/audit.js'
import { badRequest, HttpError, notFound } from '../lib/errors.js'
import { allowed, imageSize, safeFileName, type Kind } from '../lib/files.js'
import { storage } from '../lib/storage.js'
import { checkStoredUpload, type UploadedFile } from '../lib/upload.js'
import { processLocalVideo, recordUploadFailure, recordUploadStart } from './tutorials.js'

export type Purpose = 'product_image' | 'product_file' | 'tutorial_thumbnail' | 'tutorial_video'

const rules: Record<Purpose, { kind: Kind; limit: () => number; prefix: (id: string) => string; serverUrl: (id: string, imageKind: string) => string }> = {
  product_image: { kind: 'image', limit: () => config.limits.imageBytes, prefix: (id) => `product-images/${id}`, serverUrl: (id, k) => `/api/admin/products/${id}/images?kind=${k}` },
  product_file: { kind: 'product-file', limit: () => config.limits.productFileBytes, prefix: (id) => `product-files/${id}`, serverUrl: (id) => `/api/admin/products/${id}/files` },
  tutorial_thumbnail: { kind: 'image', limit: () => config.limits.imageBytes, prefix: (id) => `tutorial-thumbnails/${id}`, serverUrl: (id) => `/api/admin/tutorials/${id}/thumbnail` },
  tutorial_video: { kind: 'video', limit: () => config.limits.videoBytes, prefix: (id) => `tutorial-videos/${id}`, serverUrl: (id) => `/api/admin/tutorials/${id}/video` },
}

const extensions: Record<string, string[]> = {
  'application/pdf': ['pdf'],
  'application/zip': ['zip'],
  'image/png': ['png'],
  'image/jpeg': ['jpg', 'jpeg'],
  'image/webp': ['webp'],
  'video/mp4': ['mp4', 'm4v'],
  'video/quicktime': ['mov'],
  'video/webm': ['webm'],
}

/** Video formats this deployment can play without converting. Only a local server with ffmpeg converts MOV or WebM. */
function acceptedVideoExtensions() {
  return config.storage.driver === 'local' ? ['mp4', 'm4v', 'mov', 'webm'] : ['mp4', 'm4v']
}

export interface UploadRequest {
  purpose: Purpose
  targetId: string
  fileName: string
  size: number
  type: string
  imageKind?: 'gallery' | 'sample'
  alt?: string
}

async function checkTarget(r: UploadRequest) {
  if (r.purpose === 'product_image' || r.purpose === 'product_file') {
    const p = await one<{ type: string }>('select type from products where id = $1', [r.targetId])
    if (!p) throw notFound('Product')
    if (r.purpose === 'product_file' && p.type !== 'digital') throw badRequest('Only digital products have downloadable files.')
  } else {
    if (!(await one('select 1 from tutorials where id = $1', [r.targetId]))) throw notFound('Tutorial')
    if (r.purpose === 'tutorial_video' && config.video.provider === 'mux') throw badRequest('This store uploads videos to Mux. Use the Mux upload instead.')
  }
}

/** Quick checks before any bytes move. The real type is checked again from the file itself. */
function precheck(r: UploadRequest) {
  const rule = rules[r.purpose]
  const max = rule.limit()
  if (!Number.isFinite(r.size) || r.size <= 0) throw badRequest('The file is empty.')
  if (r.size > max) throw new HttpError(413, `File is larger than the ${Math.round(max / 1024 / 1024)} MB limit.`, 'too_large')
  const ext = r.fileName.split('.').pop()?.toLowerCase() ?? ''
  const ok = r.purpose === 'tutorial_video' ? acceptedVideoExtensions() : allowed[rule.kind].flatMap((t) => extensions[t] ?? [])
  if (!ok.includes(ext)) {
    if (r.purpose === 'tutorial_video') throw new HttpError(415, 'On this hosting, tutorial videos must be MP4 files (H.264 video with AAC audio). Convert MOV or WebM to MP4 first, or connect Mux.', 'unsupported_type')
    throw new HttpError(415, `That file type is not supported. Please upload ${ok.map((e) => e.toUpperCase()).join(', ')}.`, 'unsupported_type')
  }
}

/**
 * Step 1. Returns either a one path direct upload link (Supabase Storage) or
 * the server endpoint to send the file to (local development).
 */
export async function startUpload(actor: SessionUser, r: UploadRequest) {
  r.fileName = safeFileName(r.fileName)
  await checkTarget(r)
  precheck(r)
  const s = storage()
  const imageKind = r.imageKind ?? 'gallery'
  if (!s.directUploadUrl) return { mode: 'server' as const, url: rules[r.purpose].serverUrl(r.targetId, imageKind) }

  const key = `${rules[r.purpose].prefix(r.targetId)}/${randomUUID()}`
  const videoUploadId = r.purpose === 'tutorial_video' ? await recordUploadStart(r.targetId, 'local', { name: r.fileName, type: r.type, size: r.size }) : null
  const row = await one<{ id: string }>(
    `insert into storage_uploads (purpose, target_id, image_kind, alt, storage_key, file_name, declared_size, declared_type, video_upload_id, created_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id`,
    [r.purpose, r.targetId, r.purpose === 'product_image' ? imageKind : null, r.alt ?? '', key, r.fileName, r.size, r.type, videoUploadId, actor.email],
  )
  let url: string
  try {
    url = await s.directUploadUrl(key)
  } catch (err) {
    await q(`update storage_uploads set status = 'rejected', error = $2 where id = $1`, [row!.id, (err as Error).message])
    if (videoUploadId) await recordUploadFailure(r.targetId, videoUploadId, 'Storage is not reachable right now.')
    throw new HttpError(503, 'File storage is not reachable right now. Nothing was changed. Please try again.', 'storage_unavailable')
  }
  return { mode: 'direct' as const, id: row!.id, url }
}

interface PendingUpload {
  id: string
  purpose: Purpose
  target_id: string
  image_kind: string | null
  alt: string
  storage_key: string
  file_name: string
  video_upload_id: string | null
}

/** Step 2 (direct uploads). Checks the stored file and attaches it. Safe against double submits. */
export async function completeUpload(actor: SessionUser, id: string, ip?: string) {
  // Claiming the row first means two simultaneous "complete" calls cannot both attach it.
  const u = await one<PendingUpload>(`update storage_uploads set status = 'completed', completed_at = now() where id = $1 and status = 'pending' returning *`, [id])
  if (!u) throw notFound('Pending upload')
  let f: UploadedFile
  try {
    f = await checkStoredUpload(u.storage_key, u.file_name, rules[u.purpose].kind, rules[u.purpose].limit())
  } catch (err) {
    await q(`update storage_uploads set status = 'rejected', error = $2 where id = $1`, [id, (err as Error).message])
    if (u.video_upload_id) await recordUploadFailure(u.target_id, u.video_upload_id, (err as Error).message)
    throw err
  }
  return attachUpload(actor, u.purpose, u.target_id, f, { imageKind: (u.image_kind ?? 'gallery') as 'gallery' | 'sample', alt: u.alt, videoUploadId: u.video_upload_id, wait: true }, ip)
}

/** The browser reports a direct upload that did not finish. Nothing is attached; the object is removed. */
export async function abandonUpload(id: string, message: string) {
  const u = await one<PendingUpload>(`update storage_uploads set status = 'rejected', error = $2 where id = $1 and status = 'pending' returning *`, [id, message])
  if (!u) return
  await storage().remove(u.storage_key).catch(() => {})
  if (u.video_upload_id) await recordUploadFailure(u.target_id, u.video_upload_id, message)
}

/** Removes direct uploads that were started but never completed (the link expires after about two hours). */
export async function cleanAbandonedUploads() {
  const stale = await q<{ id: string }>(`select id from storage_uploads where status = 'pending' and created_at < now() - interval '3 hours' limit 50`)
  for (const s of stale) await abandonUpload(s.id, 'The upload was never finished.')
  return stale.length
}

/** Attaches a checked file to its product or tutorial. Shared by both upload paths. */
export async function attachUpload(
  actor: SessionUser,
  purpose: Purpose,
  targetId: string,
  f: UploadedFile,
  opts: { imageKind?: 'gallery' | 'sample'; alt?: string; videoUploadId?: string | null; wait?: boolean },
  ip?: string,
) {
  if (purpose === 'product_image') {
    const kind = opts.imageKind ?? 'gallery'
    const size = imageSize(f.head)
    const row = await one(
      `insert into product_images (product_id, kind, storage_key, content_type, width, height, alt, sort_order)
       values ($1,$2,$3,$4,$5,$6,$7,(select coalesce(max(sort_order),-1)+1 from product_images where product_id = $1 and kind = $2)) returning id, kind, alt, width, height, sort_order, variant_id`,
      [targetId, kind, f.key, f.contentType, size?.width ?? null, size?.height ?? null, opts.alt ?? ''],
    )
    await audit({ actor, action: 'product.image_uploaded', entityType: 'product', entityId: targetId, summary: `Uploaded ${kind === 'sample' ? 'a sample page image' : 'a product photo'} (${f.fileName})`, ip })
    return row
  }
  if (purpose === 'product_file') {
    const p = await one<{ title: string }>('select title from products where id = $1', [targetId])
    const row = await one(
      `insert into product_file_uploads (product_id, storage_key, file_name, content_type, file_size, sha256, uploaded_by) values ($1,$2,$3,$4,$5,$6,$7) returning id, file_name, content_type, file_size, created_at`,
      [targetId, f.key, f.fileName, f.contentType, f.size, f.sha256, actor.email],
    )
    await audit({ actor, action: 'product.file_uploaded', entityType: 'product', entityId: targetId, summary: `Uploaded private file ${f.fileName} for ${p?.title ?? 'a product'} (not released yet)`, ip })
    return row
  }
  if (purpose === 'tutorial_thumbnail') {
    await q('update tutorials set thumbnail_key = $2, thumbnail_type = $3, updated_at = now() where id = $1', [targetId, f.key, f.contentType])
    await audit({ actor, action: 'tutorial.thumbnail_uploaded', entityType: 'tutorial', entityId: targetId, summary: `Uploaded a thumbnail (${f.fileName})`, ip })
    return { ok: true }
  }
  const uploadId = opts.videoUploadId!
  await q(`update video_uploads set status = 'uploaded', bytes = $2, updated_at = now() where id = $1`, [uploadId, f.size])
  await audit({ actor, action: 'tutorial.video_uploaded', entityType: 'tutorial', entityId: targetId, summary: `Uploaded video ${f.fileName}`, ip })
  // Without ffmpeg (Vercel) this only confirms the MP4 and marks it ready, so it finishes within the request.
  const processing = processLocalVideo(targetId, uploadId, f.key, f.contentType)
  if (!opts.wait) return { uploadId, status: 'processing' }
  await processing
  const done = await one<{ status: string; error: string }>('select status, error from video_uploads where id = $1', [uploadId])
  if (done?.status === 'failed') throw new HttpError(415, done.error || 'This video could not be used.', 'video_failed')
  return { uploadId, status: done?.status ?? 'ready' }
}
