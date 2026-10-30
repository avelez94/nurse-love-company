/*
  Tutorials: public, free to watch, and completely separate from digital
  product purchases and download entitlements (no table or code path is shared).

  Video providers
  * mux   (production): the browser uploads straight to Mux with a one time
          upload URL created on the server. Mux generates streaming formats
          (HLS) and thumbnails. Assets use a signed playback policy; a public
          playback ID is added only when a tutorial is published and removed
          when it is unpublished or archived, so drafts can never be played
          through a public link.
  * local (development and small single servers): the file is streamed to
          private storage, then ffmpeg (when installed) makes a web friendly
          MP4 and a poster image. Video is only served for published tutorials,
          or to signed in admins for previews.
  * embed : a YouTube or Vimeo link, shown with a privacy friendly player.
*/
import { spawn } from 'node:child_process'
import { createHmac, createSign, timingSafeEqual } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, rm } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { SessionUser } from '../auth.js'
import { one, q, tx } from '../db/pool.js'
import { config } from '../env.js'
import { audit } from '../lib/audit.js'
import { badRequest, conflict, HttpError, notFound } from '../lib/errors.js'
import { localPath, storage } from '../lib/storage.js'
import { bool, int, oneOf, slug as slugField, str, uuid } from '../lib/validate.js'
import { sanitizeDoc } from '../../shared/richtext.js'

export const TUTORIAL_CATEGORIES = ['np-binder', 'nurse-binder', 'printing-assembly', 'digital-files'] as const

/** Accepts YouTube and Vimeo links and returns a privacy friendly embed URL. */
export function normalizeEmbedUrl(raw: string): string {
  let u: URL
  try {
    u = new URL(raw.trim())
  } catch {
    throw badRequest('That video link is not a valid URL.')
  }
  if (u.protocol !== 'https:') throw badRequest('Video links must start with https://')
  const host = u.hostname.replace(/^www\./, '')
  let id: string | null = null
  if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'youtube-nocookie.com') {
    id = u.searchParams.get('v') ?? u.pathname.match(/^\/(?:embed|shorts|live)\/([\w-]{6,})/)?.[1] ?? null
    if (id && /^[\w-]{6,20}$/.test(id)) return `https://www.youtube-nocookie.com/embed/${id}?rel=0`
  }
  if (host === 'youtu.be') {
    id = u.pathname.slice(1)
    if (/^[\w-]{6,20}$/.test(id)) return `https://www.youtube-nocookie.com/embed/${id}?rel=0`
  }
  if (host === 'vimeo.com' || host === 'player.vimeo.com') {
    id = u.pathname.match(/(\d{6,12})/)?.[1] ?? null
    if (id) return `https://player.vimeo.com/video/${id}?dnt=1`
  }
  throw badRequest('Supported video links are YouTube and Vimeo.')
}

export function parseTutorialInput(b: Record<string, unknown>) {
  const productIds = Array.isArray(b.product_ids) ? b.product_ids.slice(0, 12).map((x) => uuid(x, 'product')) : []
  return {
    title: str(b.title, 'Title', { min: 1, max: 140 }),
    slug: slugField(b.slug),
    category: oneOf(b.category, 'Category', TUTORIAL_CATEGORIES),
    summary: str(b.summary, 'Short description', { optional: true, max: 300 }),
    instructions: sanitizeDoc(b.instructions),
    transcript: str(b.transcript, 'Transcript', { optional: true, max: 60000 }),
    featured: bool(b.featured),
    display_order: int(b.display_order, 'Display order', { optional: true, min: -10000, max: 10000 }) ?? 0,
    product_ids: productIds,
  }
}

export async function createTutorial(actor: SessionUser, b: Record<string, unknown>, ip?: string) {
  const t = parseTutorialInput(b)
  if (await one('select 1 from tutorials where slug = $1', [t.slug])) throw conflict('Another tutorial already uses that URL slug.')
  const row = await tx(async (client) => {
    const r = await one<{ id: string }>(
      `insert into tutorials (title, slug, category, summary, instructions, transcript, featured, display_order, created_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`,
      [t.title, t.slug, t.category, t.summary, JSON.stringify(t.instructions), t.transcript, t.featured, t.display_order, actor.email],
      client,
    )
    for (const pid of t.product_ids) await q('insert into tutorial_products (tutorial_id, product_id) values ($1,$2) on conflict do nothing', [r!.id, pid], client)
    return r!
  })
  await audit({ actor, action: 'tutorial.created', entityType: 'tutorial', entityId: row.id, summary: `Created tutorial draft "${t.title}"`, ip })
  return row
}

export async function updateTutorial(actor: SessionUser, id: string, b: Record<string, unknown>, ip?: string) {
  const t = parseTutorialInput(b)
  if (await one('select 1 from tutorials where slug = $1 and id <> $2', [t.slug, id])) throw conflict('Another tutorial already uses that URL slug.')
  await tx(async (client) => {
    const r = await q(
      `update tutorials set title=$2, slug=$3, category=$4, summary=$5, instructions=$6, transcript=$7, featured=$8, display_order=$9, updated_at=now() where id=$1 returning id`,
      [id, t.title, t.slug, t.category, t.summary, JSON.stringify(t.instructions), t.transcript, t.featured, t.display_order],
      client,
    )
    if (!r.length) throw notFound('Tutorial')
    await q('delete from tutorial_products where tutorial_id = $1', [id], client)
    for (const pid of t.product_ids) await q('insert into tutorial_products (tutorial_id, product_id) values ($1,$2) on conflict do nothing', [id, pid], client)
  })
  await audit({ actor, action: 'tutorial.updated', entityType: 'tutorial', entityId: id, summary: `Saved tutorial "${t.title}"`, ip })
}

export async function setEmbed(actor: SessionUser, id: string, url: string | null, ip?: string) {
  const embed = url ? normalizeEmbedUrl(url) : null
  const r = await q(
    `update tutorials set embed_url = $2, video_provider = case when $2::text is null then (case when video_key is not null then 'local' when mux_asset_id is not null then 'mux' else null end) else 'embed' end, updated_at = now() where id = $1 returning id`,
    [id, embed],
  )
  if (!r.length) throw notFound('Tutorial')
  await audit({ actor, action: 'tutorial.video_link_set', entityType: 'tutorial', entityId: id, summary: embed ? `Set hosted video link ${embed}` : 'Removed hosted video link', ip })
  return embed
}

export function validateVtt(vtt: string) {
  if (Buffer.byteLength(vtt) > config.limits.captionBytes) throw badRequest('Caption files must be smaller than 512 KB.')
  if (!/^﻿?WEBVTT/.test(vtt)) throw badRequest('Captions must be a WebVTT (.vtt) file that starts with WEBVTT.')
  if (!/-->/.test(vtt)) throw badRequest('The caption file has no timed cues.')
  if (/<\s*script/i.test(vtt)) throw badRequest('The caption file contains markup that is not allowed.')
}

export async function setCaption(actor: SessionUser, id: string, b: Record<string, unknown>, ip?: string) {
  const srclang = str(b.srclang, 'Language code', { min: 2, max: 10 }).toLowerCase()
  if (!/^[a-z]{2,3}(-[a-z0-9]{2,8})?$/.test(srclang)) throw badRequest('Language code should look like "en" or "es".')
  const label = str(b.label, 'Caption label', { min: 1, max: 40 })
  const vtt = typeof b.vtt === 'string' ? b.vtt : ''
  validateVtt(vtt)
  if (!(await one('select 1 from tutorials where id = $1', [id]))) throw notFound('Tutorial')
  await q(`insert into tutorial_captions (tutorial_id, label, srclang, vtt) values ($1,$2,$3,$4) on conflict (tutorial_id, srclang) do update set label = excluded.label, vtt = excluded.vtt`, [id, label, srclang, vtt])
  await audit({ actor, action: 'tutorial.captions_saved', entityType: 'tutorial', entityId: id, summary: `Saved ${label} captions`, ip })
}

/* ---------- Mux ---------- */

const muxConfigured = () => Boolean(config.video.mux.tokenId && config.video.mux.tokenSecret)

async function mux(path: string, init: { method?: string; body?: unknown } = {}) {
  if (!muxConfigured()) throw new HttpError(503, 'Video hosting (Mux) is awaiting configuration.', 'mux_not_configured')
  const res = await fetch(`https://api.mux.com${path}`, {
    method: init.method ?? 'GET',
    headers: { authorization: `Basic ${Buffer.from(`${config.video.mux.tokenId}:${config.video.mux.tokenSecret}`).toString('base64')}`, 'content-type': 'application/json' },
    body: init.body ? JSON.stringify(init.body) : undefined,
  })
  if (!res.ok && res.status !== 204) throw new HttpError(502, `Mux request failed (${res.status}).`, 'mux_error')
  return res.status === 204 ? null : ((await res.json()) as { data: Record<string, unknown> })
}

/** Creates a one time Mux upload URL. The browser uploads directly to Mux. */
export async function createMuxUpload(actor: SessionUser, tutorialId: string, file: { name: string; size: number; type: string }) {
  if (!(await one('select 1 from tutorials where id = $1', [tutorialId]))) throw notFound('Tutorial')
  validateVideoMeta(file)
  const row = await one<{ id: string }>(`insert into video_uploads (tutorial_id, provider, status, file_name, content_type, bytes) values ($1,'mux','created',$2,$3,$4) returning id`, [tutorialId, file.name, file.type, file.size])
  const res = await mux('/video/v1/uploads', {
    method: 'POST',
    body: { cors_origin: config.appUrl, new_asset_settings: { playback_policy: ['signed'], passthrough: `${tutorialId}:${row!.id}`, video_quality: 'basic' } },
  })
  const upload = res!.data as { id: string; url: string }
  await q(`update tutorials set mux_upload_id = $2, video_status = 'uploading', video_error = '', updated_at = now() where id = $1`, [tutorialId, upload.id])
  await q(`update video_uploads set status = 'uploading', updated_at = now() where id = $1`, [row!.id])
  await audit({ actor, action: 'tutorial.video_upload_started', entityType: 'tutorial', entityId: tutorialId, summary: `Started a Mux upload (${file.name})` })
  return { uploadId: row!.id, url: upload.url }
}

export function verifyMuxSignature(raw: string, header: string | undefined) {
  if (!config.video.mux.webhookSecret) throw new HttpError(503, 'Mux webhook secret is not configured.', 'webhook_not_configured')
  const parts = Object.fromEntries((header ?? '').split(',').map((p) => p.split('=') as [string, string]))
  const t = Number(parts.t)
  if (!t || !parts.v1 || Math.abs(Date.now() / 1000 - t) > 300) throw new HttpError(400, 'Invalid Mux signature.', 'bad_signature')
  const expected = createHmac('sha256', config.video.mux.webhookSecret).update(`${t}.${raw}`).digest('hex')
  const ok = expected.length === parts.v1.length && timingSafeEqual(Buffer.from(expected), Buffer.from(parts.v1))
  if (!ok) throw new HttpError(400, 'Invalid Mux signature.', 'bad_signature')
}

export async function handleMuxEvent(event: { type: string; data: Record<string, unknown> }) {
  const data = event.data
  const passthrough = String((data.passthrough ?? (data.new_asset_settings as Record<string, unknown> | undefined)?.passthrough) ?? '')
  const [tutorialId, uploadId] = passthrough.split(':')
  if (!tutorialId) return 'ignored'
  if (event.type === 'video.asset.created' || event.type === 'video.upload.asset_created') {
    const assetId = String(data.asset_id ?? data.id)
    await q(`update tutorials set video_status = 'processing', updated_at = now() where id = $1`, [tutorialId])
    await q(`update video_uploads set status = 'processing', updated_at = now() where id = $1`, [uploadId])
    if (event.type === 'video.asset.created') await q(`update tutorials set mux_asset_id = $2 where id = $1`, [tutorialId, assetId])
    return 'processed'
  }
  if (event.type === 'video.asset.ready') {
    const playback = ((data.playback_ids as Array<{ id: string; policy: string }>) ?? []).find((p) => p.policy === 'signed')
    await tx(async (client) => {
      const t = await one<{ status: string; mux_public_playback_id: string | null; mux_asset_id: string | null }>('select status, mux_public_playback_id, mux_asset_id from tutorials where id = $1 for update', [tutorialId], client)
      if (!t) return
      // A replaced video on a published tutorial: drop the old public ID; publish adds a new one.
      await q(
        `update tutorials set mux_asset_id = $2, mux_signed_playback_id = $3, duration_seconds = $4, video_provider = 'mux', video_status = 'ready', video_error = '', is_placeholder = false, embed_url = null, updated_at = now() where id = $1`,
        [tutorialId, String(data.id), playback?.id ?? null, Number(data.duration ?? 0) || null],
        client,
      )
      await q(`update video_uploads set status = 'ready', updated_at = now() where id = $1`, [uploadId], client)
    })
    const t = await one<{ status: string }>('select status from tutorials where id = $1', [tutorialId])
    if (t?.status === 'published') await ensureMuxPublic(tutorialId)
    return 'processed'
  }
  if (event.type === 'video.asset.errored' || event.type === 'video.upload.errored' || event.type === 'video.upload.cancelled') {
    const msg = ((data.errors as { messages?: string[] } | undefined)?.messages ?? []).join(' ') || 'Mux could not process this video.'
    await q(`update video_uploads set status = 'failed', error = $2, updated_at = now() where id = $1`, [uploadId, msg])
    // Keep any earlier working video. Only mark errored when nothing is playable.
    await q(`update tutorials set video_error = $2, video_status = case when (mux_signed_playback_id is not null or video_key is not null or embed_url is not null) then 'ready' else 'errored' end, updated_at = now() where id = $1`, [tutorialId, msg])
    return 'processed'
  }
  return 'ignored'
}

async function ensureMuxPublic(tutorialId: string) {
  const t = await one<{ mux_asset_id: string | null; mux_public_playback_id: string | null }>('select mux_asset_id, mux_public_playback_id from tutorials where id = $1', [tutorialId])
  if (!t?.mux_asset_id || t.mux_public_playback_id) return
  const res = await mux(`/video/v1/assets/${t.mux_asset_id}/playback-ids`, { method: 'POST', body: { policy: 'public' } })
  await q('update tutorials set mux_public_playback_id = $2 where id = $1', [tutorialId, (res!.data as { id: string }).id])
}

async function removeMuxPublic(tutorialId: string) {
  const t = await one<{ mux_asset_id: string | null; mux_public_playback_id: string | null }>('select mux_asset_id, mux_public_playback_id from tutorials where id = $1', [tutorialId])
  if (!t?.mux_asset_id || !t.mux_public_playback_id) return
  await mux(`/video/v1/assets/${t.mux_asset_id}/playback-ids/${t.mux_public_playback_id}`, { method: 'DELETE' })
  await q('update tutorials set mux_public_playback_id = null where id = $1', [tutorialId])
}

/** Short lived signed playback token for admin previews of unpublished Mux videos. */
export function muxSignedToken(playbackId: string, aud: 'v' | 't' = 'v') {
  const { signingKeyId, signingPrivateKey } = config.video.mux
  if (!signingKeyId || !signingPrivateKey) return null
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
  const head = b64({ alg: 'RS256', typ: 'JWT', kid: signingKeyId })
  const body = b64({ sub: playbackId, aud, exp: Math.floor(Date.now() / 1000) + 600, kid: signingKeyId })
  const key = signingPrivateKey.includes('BEGIN') ? signingPrivateKey : Buffer.from(signingPrivateKey, 'base64').toString('utf8')
  const sig = createSign('RSA-SHA256').update(`${head}.${body}`).sign(key).toString('base64url')
  return `${head}.${body}.${sig}`
}

/* ---------- Local video processing ---------- */

export function validateVideoMeta(file: { name: string; size: number; type: string }) {
  if (!['video/mp4', 'video/quicktime', 'video/webm'].includes(file.type)) throw new HttpError(415, 'Please upload an MP4, MOV or WebM video.', 'unsupported_type')
  if (file.size > config.limits.videoBytes) throw new HttpError(413, `Videos must be smaller than ${Math.round(config.limits.videoBytes / 1024 / 1024)} MB.`, 'too_large')
}

function run(cmd: string, args: string[]): Promise<{ code: number; out: string; err: string }> {
  return new Promise((resolve) => {
    const p = spawn(cmd, args)
    let out = ''
    let err = ''
    p.stdout.on('data', (d) => (out += d))
    p.stderr.on('data', (d) => (err += d))
    p.on('error', (e) => resolve({ code: -1, out, err: e.message }))
    p.on('close', (code) => resolve({ code: code ?? -1, out, err }))
  })
}

let ffmpegAvailable: boolean | null = null
async function hasFfmpeg() {
  if (ffmpegAvailable === null) ffmpegAvailable = (await run('ffmpeg', ['-version'])).code === 0
  return ffmpegAvailable
}

/**
 * Turns an uploaded source video into a web friendly MP4 and poster image.
 * The tutorial's current video is only swapped after processing succeeds, so a
 * failed upload never breaks the existing draft.
 */
export async function processLocalVideo(tutorialId: string, uploadId: string, sourceKey: string, sourceType: string) {
  await q(`update video_uploads set status = 'processing', updated_at = now() where id = $1`, [uploadId])
  await q(`update tutorials set video_status = 'processing', updated_at = now() where id = $1`, [tutorialId])
  const outKey = `tutorial-videos/${tutorialId}/${uploadId}/video.mp4`
  const posterKey = `tutorial-videos/${tutorialId}/${uploadId}/poster.jpg`
  try {
    let duration: number | null = null
    let finalKey = sourceKey
    let finalPoster: string | null = null
    if (config.storage.driver === 'local' && (await hasFfmpeg())) {
      const src = localPath(sourceKey)
      const out = localPath(outKey)
      const poster = localPath(posterKey)
      await mkdir(dirname(out), { recursive: true })
      const probe = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', src])
      if (probe.code !== 0) throw new Error('This file could not be read as a video.')
      duration = Number(probe.out.trim()) || null
      const enc = await run('ffmpeg', ['-y', '-loglevel', 'error', '-i', src, '-vf', "scale='min(1280,iw)':-2", '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '24', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', out])
      if (enc.code !== 0) throw new Error(`Video processing failed: ${enc.err.split('\n').filter(Boolean).pop() ?? 'unknown error'}`)
      await run('ffmpeg', ['-y', '-loglevel', 'error', '-ss', String(Math.min(1, (duration ?? 2) / 2)), '-i', out, '-frames:v', '1', '-q:v', '4', poster])
      finalKey = outKey
      finalPoster = existsSync(poster) ? posterKey : null
      await rm(src, { force: true })
    } else if (sourceType !== 'video/mp4') {
      throw new Error('This server cannot convert MOV or WebM files (ffmpeg is not installed). Upload an MP4, or use Mux.')
    }
    await tx(async (client) => {
      await q(
        `update tutorials set video_provider = 'local', video_key = $2, poster_key = coalesce($3, poster_key), duration_seconds = $4, video_status = 'ready', video_error = '', is_placeholder = false, embed_url = null, updated_at = now() where id = $1`,
        [tutorialId, finalKey, finalPoster, duration],
        client,
      )
      await q(`update video_uploads set status = 'ready', updated_at = now() where id = $1`, [uploadId], client)
    })
  } catch (err) {
    const msg = (err as Error).message
    await q(`update video_uploads set status = 'failed', error = $2, updated_at = now() where id = $1`, [uploadId, msg])
    await q(
      `update tutorials set video_error = $2, video_status = case when (video_key is not null or mux_signed_playback_id is not null or embed_url is not null) then 'ready' else 'errored' end, updated_at = now() where id = $1`,
      [tutorialId, msg],
    )
    await storage().remove(sourceKey).catch(() => {})
  }
}

export async function recordUploadStart(tutorialId: string, provider: string, file: { name: string; type: string; size: number }) {
  if (!(await one('select 1 from tutorials where id = $1', [tutorialId]))) throw notFound('Tutorial')
  const row = await one<{ id: string }>(`insert into video_uploads (tutorial_id, provider, status, file_name, content_type, bytes) values ($1,$2,'uploading',$3,$4,$5) returning id`, [tutorialId, provider, file.name, file.type, file.size])
  await q(`update tutorials set video_status = case when video_status = 'ready' then 'ready' else 'uploading' end, video_error = '', updated_at = now() where id = $1`, [tutorialId])
  return row!.id
}

export async function recordUploadFailure(tutorialId: string, uploadId: string, message: string) {
  await q(`update video_uploads set status = 'failed', error = $2, updated_at = now() where id = $1`, [uploadId, message])
  await q(`update tutorials set video_error = $2, video_status = case when (video_key is not null or mux_signed_playback_id is not null or embed_url is not null) then 'ready' else 'none' end, updated_at = now() where id = $1`, [tutorialId, message])
}

/* ---------- Publishing ---------- */

export async function setTutorialStatus(actor: SessionUser, id: string, action: 'publish' | 'unpublish' | 'archive' | 'restore', ip?: string) {
  const t = await one<{ title: string; status: string; video_status: string; video_provider: string | null; embed_url: string | null; summary: string }>('select * from tutorials where id = $1', [id])
  if (!t) throw notFound('Tutorial')
  if (action === 'publish') {
    if (t.status === 'archived') throw badRequest('Restore this tutorial before publishing it.')
    const playable = t.embed_url || t.video_status === 'ready'
    if (!playable) throw badRequest('Add a video that has finished processing (or a hosted video link) before publishing.')
    if (t.video_provider === 'mux' && !t.embed_url) await ensureMuxPublic(id)
    await q(`update tutorials set status = 'published', published_at = coalesce(published_at, now()), updated_at = now() where id = $1`, [id])
  } else if (action === 'unpublish') {
    await q(`update tutorials set status = 'unpublished', updated_at = now() where id = $1`, [id])
    if (t.video_provider === 'mux') await removeMuxPublic(id).catch(() => {})
  } else if (action === 'archive') {
    await q(`update tutorials set status = 'archived', featured = false, archived_at = now(), updated_at = now() where id = $1`, [id])
    if (t.video_provider === 'mux') await removeMuxPublic(id).catch(() => {})
  } else {
    await q(`update tutorials set status = 'draft', archived_at = null, updated_at = now() where id = $1`, [id])
  }
  const verb = { publish: 'Published', unpublish: 'Unpublished', archive: 'Archived', restore: 'Restored to draft' }[action]
  await audit({ actor, action: `tutorial.${action}`, entityType: 'tutorial', entityId: id, summary: `${verb} tutorial "${t.title}"`, ip })
}

/* ---------- Reads ---------- */

export interface TutorialView {
  id: string
  slug: string
  title: string
  category: string
  summary: string
  instructions: unknown
  transcript: string
  featured: boolean
  displayOrder: number
  durationSeconds: number | null
  isPlaceholder: boolean
  status: string
  video:
    | { kind: 'file'; src: string; type: string; poster: string | null }
    | { kind: 'hls'; src: string; poster: string | null }
    | { kind: 'embed'; url: string }
    | null
  thumbnail: string | null
  captions: Array<{ label: string; srclang: string; src: string }>
  products: Array<{ id: string; slug: string; title: string }>
}

type TRow = Record<string, unknown> & { id: string; slug: string }

async function shape(rows: TRow[], mode: 'public' | 'admin'): Promise<TutorialView[]> {
  if (!rows.length) return []
  const ids = rows.map((r) => r.id)
  const caps = await q<{ tutorial_id: string; label: string; srclang: string }>('select tutorial_id, label, srclang from tutorial_captions where tutorial_id = any($1) order by srclang', [ids])
  const prods = await q<{ tutorial_id: string; id: string; slug: string; title: string }>(
    `select tp.tutorial_id, p.id, p.slug, p.title from tutorial_products tp join products p on p.id = tp.product_id
      where tp.tutorial_id = any($1) ${mode === 'public' ? `and p.status = 'published' and p.active and p.archived_at is null` : ''}`,
    [ids],
  )
  return rows.map((r) => {
    const base = mode === 'public' ? `/api/tutorials/${r.slug}` : `/api/admin/tutorials/${r.id}/preview`
    let video: TutorialView['video'] = null
    let poster: string | null = r.poster_key ? `${base}/poster` : null
    if (r.embed_url) video = { kind: 'embed', url: String(r.embed_url) }
    else if (r.video_provider === 'local' && r.video_key && r.video_status === 'ready') video = { kind: 'file', src: `${base}/video`, type: 'video/mp4', poster }
    else if (r.video_provider === 'mux' && r.video_status === 'ready') {
      if (mode === 'public' && r.mux_public_playback_id) {
        video = { kind: 'hls', src: `https://stream.mux.com/${r.mux_public_playback_id}.m3u8`, poster: `https://image.mux.com/${r.mux_public_playback_id}/thumbnail.jpg?width=1280` }
        poster = video.poster
      } else if (mode === 'admin' && r.mux_signed_playback_id) {
        const tok = muxSignedToken(String(r.mux_signed_playback_id))
        const tTok = muxSignedToken(String(r.mux_signed_playback_id), 't')
        if (tok) {
          video = { kind: 'hls', src: `https://stream.mux.com/${r.mux_signed_playback_id}.m3u8?token=${tok}`, poster: tTok ? `https://image.mux.com/${r.mux_signed_playback_id}/thumbnail.jpg?token=${tTok}` : null }
          poster = video.poster
        }
      }
    }
    return {
      id: r.id,
      slug: r.slug,
      title: String(r.title),
      category: String(r.category),
      summary: String(r.summary ?? ''),
      instructions: sanitizeDoc(r.instructions),
      transcript: String(r.transcript ?? ''),
      featured: Boolean(r.featured),
      displayOrder: Number(r.display_order ?? 0),
      durationSeconds: r.duration_seconds === null || r.duration_seconds === undefined ? null : Number(r.duration_seconds),
      isPlaceholder: Boolean(r.is_placeholder),
      status: String(r.status),
      video,
      thumbnail: r.thumbnail_key ? `${base}/thumbnail` : poster,
      captions: caps.filter((c) => c.tutorial_id === r.id).map((c) => ({ label: c.label, srclang: c.srclang, src: `${base}/captions/${c.srclang}` })),
      products: prods.filter((p) => p.tutorial_id === r.id).map((p) => ({ id: p.id, slug: p.slug, title: p.title })),
    }
  })
}

/** Only published tutorials, ever. */
export async function publicTutorials() {
  return shape(await q<TRow>(`select * from tutorials where status = 'published' order by display_order, published_at desc`), 'public')
}

export async function publicTutorial(slug: string) {
  const rows = await q<TRow>(`select * from tutorials where status = 'published' and slug = $1`, [slug])
  return (await shape(rows, 'public'))[0] ?? null
}

export async function adminTutorial(id: string) {
  const rows = await q<TRow>('select * from tutorials where id = $1', [id])
  if (!rows.length) throw notFound('Tutorial')
  const [view] = await shape(rows, 'admin')
  const uploads = await q('select id, provider, status, file_name, content_type, bytes, error, created_at, updated_at from video_uploads where tutorial_id = $1 order by created_at desc limit 10', [id])
  const productIds = (await q<{ product_id: string }>('select product_id from tutorial_products where tutorial_id = $1', [id])).map((r) => r.product_id)
  return { tutorial: { ...rows[0], instructions: sanitizeDoc(rows[0].instructions) }, preview: view, uploads, productIds, muxConfigured: muxConfigured(), provider: config.video.provider, videoUpload: { convert: config.storage.driver === 'local', maxMb: Math.round(config.limits.videoBytes / 1024 / 1024) } }
}

export async function adminTutorialList() {
  return q(
    `select t.id, t.slug, t.title, t.category, t.status, t.featured, t.display_order, t.video_status, t.video_provider, t.video_error, t.is_placeholder, t.duration_seconds, t.updated_at, t.published_at,
            (select count(*) from tutorial_captions c where c.tutorial_id = t.id) as caption_count
       from tutorials t order by (t.status = 'archived'), t.display_order, t.created_at desc`,
  )
}

/** Resolves a stored media key for a tutorial, enforcing published state for public requests. */
export async function tutorialMedia(where: { slug?: string; id?: string }, kind: 'video' | 'poster' | 'thumbnail', mode: 'public' | 'admin') {
  const t = where.slug
    ? await one<Record<string, string | null>>(`select * from tutorials where slug = $1`, [where.slug])
    : await one<Record<string, string | null>>(`select * from tutorials where id = $1`, [where.id])
  if (!t || (mode === 'public' && t.status !== 'published')) throw notFound('Video')
  const key = kind === 'video' ? t.video_key : kind === 'poster' ? t.poster_key : t.thumbnail_key
  if (!key || (kind === 'video' && t.video_status !== 'ready')) throw notFound('Video')
  const type = kind === 'video' ? 'video/mp4' : kind === 'poster' ? 'image/jpeg' : (t.thumbnail_type ?? 'image/jpeg')
  return { key, type }
}

export async function captionText(where: { slug?: string; id?: string }, lang: string, mode: 'public' | 'admin') {
  const row = await one<{ vtt: string; status: string }>(
    `select c.vtt, t.status from tutorial_captions c join tutorials t on t.id = c.tutorial_id where ${where.slug ? 't.slug = $1' : 't.id = $1'} and c.srclang = $2`,
    [where.slug ?? where.id, lang],
  )
  if (!row || (mode === 'public' && row.status !== 'published')) throw notFound('Captions')
  return row.vtt
}

