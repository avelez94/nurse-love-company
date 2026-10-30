import { randomUUID } from 'node:crypto'
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

/**
 * Streams a raw request body (sent with fetch or XHR, not multipart) into
 * private storage, then checks the real file type from its first bytes.
 * Files that fail any check are removed immediately.
 */
export async function receiveUpload(c: Context, kind: Kind, prefix: string, maxBytes: number): Promise<UploadedFile> {
  const fileName = safeFileName(decodeURIComponent(c.req.header('x-file-name') ?? 'file'))
  const declared = Number(c.req.header('content-length') ?? 0)
  if (declared > maxBytes) throw new HttpError(413, `File is larger than the ${Math.round(maxBytes / 1024 / 1024)} MB limit.`, 'too_large')
  const body = c.req.raw.body
  if (!body) throw badRequest('No file was received.')
  const key = `${prefix}/${randomUUID()}`
  const stored = await storage().put(key, Readable.fromWeb(body as never), 'application/octet-stream', maxBytes)
  if (stored.size === 0) {
    await storage().remove(key)
    throw badRequest('The file is empty.')
  }
  const opened = await storage().open(key, { start: 0, end: 4095 })
  const chunks: Buffer[] = []
  for await (const ch of opened.stream) chunks.push(ch as Buffer)
  const head = Buffer.concat(chunks)
  const type = sniff(head, kind)
  if (!type || !extensionMatches(fileName, type)) {
    await storage().remove(key)
    throw new HttpError(415, `That file type is not supported. Please upload ${allowedLabel[kind]}.`, 'unsupported_type')
  }
  return { key, fileName, contentType: type, size: stored.size, sha256: stored.sha256, head }
}
