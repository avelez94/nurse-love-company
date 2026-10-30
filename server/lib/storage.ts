/*
  Private object storage. Product files, tutorial videos and uploaded images
  are stored outside the public web folder and are only read by the server.
  Drivers: "local" (a private folder, for development and single servers) and
  "s3" (any S3 compatible service: Cloudflare R2, AWS S3, Backblaze B2,
  Supabase Storage S3 API). Credentials never reach the browser.
*/
import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream, existsSync } from 'node:fs'
import { mkdir, rename, rm, stat } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { AwsClient } from 'aws4fetch'
import { config } from '../env.js'
import { HttpError } from './errors.js'

export interface StoredObject {
  key: string
  size: number
  sha256: string
}

export interface OpenedObject {
  stream: Readable
  size: number
}

export interface Storage {
  /** Streams a body into storage while counting bytes and hashing, enforcing maxBytes. */
  put(key: string, body: Readable, contentType: string, maxBytes: number): Promise<StoredObject>
  /** Opens an object for reading. Throws if it is missing or unreadable. */
  open(key: string, range?: { start: number; end: number }): Promise<OpenedObject>
  size(key: string): Promise<number>
  remove(key: string): Promise<void>
}

function guard(maxBytes: number) {
  let total = 0
  const hash = createHash('sha256')
  const t = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      total += chunk.length
      if (total > maxBytes) return cb(new HttpError(413, `File is larger than the ${Math.round(maxBytes / 1024 / 1024)} MB limit.`, 'too_large'))
      hash.update(chunk)
      cb(null, chunk)
    },
  })
  return { t, done: () => ({ size: total, sha256: hash.digest('hex') }) }
}

class LocalStorage implements Storage {
  root = resolve(config.storage.localDir)
  private path(key: string) {
    const p = resolve(this.root, key)
    if (!p.startsWith(this.root + '/')) throw new Error('Invalid storage key')
    return p
  }
  async put(key: string, body: Readable, _contentType: string, maxBytes: number) {
    const target = this.path(key)
    await mkdir(dirname(target), { recursive: true })
    const tmp = `${target}.${randomUUID()}.part`
    const g = guard(maxBytes)
    try {
      await pipeline(body, g.t, createWriteStream(tmp))
      await rename(tmp, target)
    } catch (err) {
      await rm(tmp, { force: true })
      throw err
    }
    const { size, sha256 } = g.done()
    return { key, size, sha256 }
  }
  async open(key: string, range?: { start: number; end: number }) {
    const p = this.path(key)
    if (!existsSync(p)) throw new Error(`Object ${key} is missing from storage`)
    const s = await stat(p)
    const stream = createReadStream(p, range)
    await new Promise<void>((res, rej) => {
      stream.once('open', () => res())
      stream.once('error', rej)
    })
    return { stream, size: s.size }
  }
  async size(key: string) {
    return (await stat(this.path(key))).size
  }
  async remove(key: string) {
    await rm(this.path(key), { force: true })
  }
}

class S3Storage implements Storage {
  private client = new AwsClient({
    accessKeyId: config.storage.s3.accessKeyId,
    secretAccessKey: config.storage.s3.secretAccessKey,
    region: config.storage.s3.region,
    service: 's3',
  })
  private url(key: string) {
    return `${config.storage.s3.endpoint.replace(/\/$/, '')}/${config.storage.s3.bucket}/${key.split('/').map(encodeURIComponent).join('/')}`
  }
  async put(key: string, body: Readable, contentType: string, maxBytes: number) {
    // Buffer through a guard so limits and hashes are enforced before upload.
    const g = guard(maxBytes)
    const chunks: Buffer[] = []
    await pipeline(body, g.t, async function* (source) {
      for await (const c of source) chunks.push(c as Buffer)
    })
    const buf = Buffer.concat(chunks)
    const res = await this.client.fetch(this.url(key), { method: 'PUT', body: buf, headers: { 'content-type': contentType } })
    if (!res.ok) throw new Error(`Storage upload failed with ${res.status}`)
    const { size, sha256 } = g.done()
    return { key, size, sha256 }
  }
  async open(key: string, range?: { start: number; end: number }) {
    const headers: Record<string, string> = {}
    if (range) headers.range = `bytes=${range.start}-${range.end}`
    const res = await this.client.fetch(this.url(key), { headers })
    if (!res.ok || !res.body) throw new Error(`Storage read failed with ${res.status}`)
    const size = Number(res.headers.get('content-length') ?? 0)
    return { stream: Readable.fromWeb(res.body as never), size }
  }
  async size(key: string) {
    const res = await this.client.fetch(this.url(key), { method: 'HEAD' })
    if (!res.ok) throw new Error(`Storage head failed with ${res.status}`)
    return Number(res.headers.get('content-length') ?? 0)
  }
  async remove(key: string) {
    await this.client.fetch(this.url(key), { method: 'DELETE' })
  }
}

let instance: Storage | null = null
export function storage(): Storage {
  if (!instance) instance = config.storage.driver === 's3' ? new S3Storage() : new LocalStorage()
  return instance
}
/** Tests can swap in a failing or fake storage. */
export function setStorage(s: Storage | null) {
  instance = s
}

export function localPath(key: string) {
  return join(resolve(config.storage.localDir), key)
}
