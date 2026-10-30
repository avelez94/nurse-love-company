import { createHash, randomUUID } from 'node:crypto'
import { Readable } from 'node:stream'
import type { Context } from 'hono'
import { badRequest, HttpError } from './errors.js'
import { allowedLabel, extensionMatches, safeFileName, sniff, type Kind } from './files.js'
import { storage } from './storage.js'

export interface UploadedFile {
  key: string
  fileName: string
  contentType: string
  size: number
  sha256: string
  head: Buffer
}

const tooLarge = (maxBytes: number) => new HttpError(413, `File is larger than the ${Math.round(maxBytes / 1024 / 1024)} MB limit.`, 'too_large')

/**
 * Streams a raw request body (sent with fetch or XHR, not multipart) into
 * private storage, then checks it. Used by servers with their own disk; on
 * Vercel files go straight to Supabase Storage and are checked by
 * checkStoredUpload instead.
 */
export async function receiveUpload(c: Context, kind: Kind, prefix: string, maxBytes: number): Promise<UploadedFile> {
  const fileName = safeFileName(decodeURIComponent(c.req.header('x-file-name') ?? 'file'))
  const declared = Number(c.req.header('content-length') ?? 0)
  if (declared > maxBytes) throw tooLarge(maxBytes)
  const body = c.req.raw.body
  if (!body) throw badRequest('No file was received.')
  const key = `${prefix}/${randomUUID()}`
  const stored = await storage().put(key, Readable.fromWeb(body as never), 'application/octet-stream', maxBytes)
  const head = await readHead(key, stored.size)
  return verify(key, fileName, kind, stored.size, stored.sha256, head)
}

/**
 * Checks a file the browser uploaded straight to storage: real size, real type
 * from its first bytes, and a SHA-256 of the whole file read back from storage.
 * Anything that fails is deleted.
 */
export async function checkStoredUpload(key: string, fileName: string, kind: Kind, maxBytes: number): Promise<UploadedFile> {
  let size: number
  try {
    size = await storage().size(key)
  } catch {
    throw badRequest('The upload did not reach storage. Please try again.')
  }
  if (size > maxBytes) {
    await storage().remove(key)
    throw tooLarge(maxBytes)
  }
  const opened = await storage().open(key)
  const hash = createHash('sha256')
  const headChunks: Buffer[] = []
  let headLength = 0
  let total = 0
  for await (const chunk of opened.stream) {
    const b = chunk as Buffer
    hash.update(b)
    total += b.length
    if (headLength < 4096) {
      headChunks.push(b)
      headLength += b.length
    }
  }
  return verify(key, safeFileName(fileName), kind, total, hash.digest('hex'), Buffer.concat(headChunks).subarray(0, 4096))
}

async function readHead(key: string, size: number) {
  if (!size) return Buffer.alloc(0)
  const opened = await storage().open(key, { start: 0, end: Math.min(size, 4096) - 1 })
  const chunks: Buffer[] = []
  for await (const ch of opened.stream) chunks.push(ch as Buffer)
  return Buffer.concat(chunks)
}

async function verify(key: string, fileName: string, kind: Kind, size: number, sha256: string, head: Buffer): Promise<UploadedFile> {
  if (size === 0) {
    await storage().remove(key)
    throw badRequest('The file is empty.')
  }
  const type = sniff(head, kind)
  if (!type || !extensionMatches(fileName, type)) {
    await storage().remove(key)
    throw new HttpError(415, `That file type is not supported. Please upload ${allowedLabel[kind]}.`, 'unsupported_type')
  }
  return { key, fileName, contentType: type, size, sha256, head }
}
