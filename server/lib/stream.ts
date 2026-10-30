import { PassThrough, Readable } from 'node:stream'
import type { Context } from 'hono'
import { storage } from './storage.js'

/** Wraps a Node stream as a web Response body and reports how it ended. */
export function toWebBody(src: Readable, onDone?: (completed: boolean, detail: string) => void) {
  const pass = new PassThrough()
  let finished = false
  src.on('error', (e) => {
    if (!finished) {
      finished = true
      onDone?.(false, e.message)
    }
    pass.destroy(e)
  })
  pass.on('end', () => {
    if (!finished) {
      finished = true
      onDone?.(true, '')
    }
  })
  pass.on('close', () => {
    if (!finished) {
      finished = true
      onDone?.(false, 'Connection closed before the file finished sending')
    }
    src.destroy()
  })
  src.pipe(pass)
  return Readable.toWeb(pass) as unknown as ReadableStream
}

/** Serves a stored file with HTTP range support (needed for video seeking on iOS). */
export async function serveRange(c: Context, key: string, contentType: string, cache = 'private, max-age=300') {
  const total = await storage().size(key)
  const range = c.req.header('range')
  const m = range?.match(/^bytes=(\d*)-(\d*)$/)
  if (m && (m[1] || m[2])) {
    let start = m[1] ? Number(m[1]) : Math.max(0, total - Number(m[2]))
    let end = m[1] && m[2] ? Number(m[2]) : total - 1
    end = Math.min(end, total - 1)
    if (start > end || start >= total) return new Response(null, { status: 416, headers: { 'content-range': `bytes */${total}` } })
    const opened = await storage().open(key, { start, end })
    return new Response(toWebBody(opened.stream), {
      status: 206,
      headers: { 'content-type': contentType, 'content-length': String(end - start + 1), 'content-range': `bytes ${start}-${end}/${total}`, 'accept-ranges': 'bytes', 'cache-control': cache },
    })
  }
  const opened = await storage().open(key)
  return new Response(toWebBody(opened.stream), { headers: { 'content-type': contentType, 'content-length': String(total), 'accept-ranges': 'bytes', 'cache-control': cache } })
}

/**
 * Sends media (photos, sample pages, tutorial video) the caller is allowed to
 * see. The permission check happens before this is called, on every request.
 * With Supabase Storage the bytes come from a short lived signed link, so
 * large videos never pass through a size limited serverless response; once a
 * product or tutorial is unpublished no new links are issued, and links
 * already handed out expire within the hour.
 */
export async function serveMedia(c: Context, key: string, contentType: string, cache: string) {
  const s = storage()
  if (!s.signedUrl) return serveRange(c, key, contentType, cache)
  const url = await s.signedUrl(key, 3600)
  // The redirect may be cached briefly; the link it points to lasts an hour.
  const redirectCache = cache.startsWith('public') ? 'public, max-age=300' : 'private, no-store'
  return new Response(null, { status: 302, headers: { location: url, 'cache-control': redirectCache } })
}
