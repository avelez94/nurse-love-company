/*
  Private object storage. Product files, tutorial videos and uploaded images
  are stored outside the public web folder and are only read by the server.
  Drivers:
  * "supabase": Supabase Storage, used on Vercel. Two private buckets:
    product files (never given a signed link; only streamed by the server
    after a download is redeemed) and media (photos, sample pages, tutorial
    media, shown through short lived signed links only when allowed).
    Uploads go straight from the admin's browser to a one path upload link.
  * "local": a private folder, for development and single servers.
  * "s3": any S3 compatible service, for a single long running server.
  Credentials never reach the browser.
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
  /** Drivers that accept uploads straight from the browser. */
  directUploadUrl?(key: string): Promise<string>
  /** Short lived read link for media. Never available for product files. */
  signedUrl?(key: string, expiresInSeconds: number): Promise<string>
}

/** Keys under product-files/ are purchasable downloads; everything else is media. */
export const isProductFileKey = (key: string) => key.startsWith('product-files/')

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

/** Supabase Storage through its REST API, authenticated with the server only service role key. */
export class SupabaseStorage implements Storage {
  constructor(
    private base = `${config.storage.supabase.url}/storage/v1`,
    private key = config.storage.supabase.serviceRoleKey,
    private buckets = { files: config.storage.supabase.filesBucket, media: config.storage.supabase.mediaBucket },
  ) {}
  private headers(extra: Record<string, string> = {}) {
    return { apikey: this.key, authorization: `Bearer ${this.key}`, ...extra }
  }
  bucketFor(key: string) {
    return isProductFileKey(key) ? this.buckets.files : this.buckets.media
  }
  private path(key: string) {
    if (key.split('/').some((p) => !p || p === '.' || p === '..')) throw new Error('Invalid storage key')
    return `${this.bucketFor(key)}/${key.split('/').map(encodeURIComponent).join('/')}`
  }
  private async fail(res: Response, what: string): Promise<never> {
    const detail = (await res.text().catch(() => '')).slice(0, 200)
    throw new Error(`Storage ${what} failed with ${res.status}${detail ? `: ${detail}` : ''}`)
  }
  async put(key: string, body: Readable, contentType: string, maxBytes: number) {
    const g = guard(maxBytes)
    const chunks: Buffer[] = []
    await pipeline(body, g.t, async function* (source) {
      for await (const c of source) chunks.push(c as Buffer)
    })
    const res = await fetch(`${this.base}/object/${this.path(key)}`, { method: 'POST', body: Buffer.concat(chunks), headers: this.headers({ 'content-type': contentType, 'x-upsert': 'false' }) })
    if (!res.ok) await this.fail(res, 'upload')
    const { size, sha256 } = g.done()
    return { key, size, sha256 }
  }
  async open(key: string, range?: { start: number; end: number }) {
    const res = await fetch(`${this.base}/object/${this.path(key)}`, { headers: this.headers(range ? { range: `bytes=${range.start}-${range.end}` } : {}) })
    if (!res.ok || !res.body) await this.fail(res, 'read')
    const size = Number(res.headers.get('content-length') ?? 0)
    return { stream: Readable.fromWeb(res.body as never), size }
  }
  async size(key: string) {
    const res = await fetch(`${this.base}/object/${this.path(key)}`, { method: 'HEAD', headers: this.headers() })
    if (!res.ok) await this.fail(res, 'lookup')
    const length = Number(res.headers.get('content-length') ?? 0)
    if (length) return length
    // Some proxies drop the length on HEAD; the object info endpoint always has it.
    const info = await fetch(`${this.base}/object/info/${this.path(key)}`, { headers: this.headers() })
    if (!info.ok) await this.fail(info, 'lookup')
    const data = (await info.json()) as { size?: number; metadata?: { size?: number } }
    return Number(data.size ?? data.metadata?.size ?? 0)
  }
  async remove(key: string) {
    await fetch(`${this.base}/object/${this.bucketFor(key)}`, { method: 'DELETE', headers: this.headers({ 'content-type': 'application/json' }), body: JSON.stringify({ prefixes: [key] }) })
  }
  /** One path upload link (valid about two hours, cannot overwrite). Only the admin who asked receives it. */
  async directUploadUrl(key: string) {
    const res = await fetch(`${this.base}/object/upload/sign/${this.path(key)}`, { method: 'POST', headers: this.headers({ 'content-type': 'application/json' }), body: '{}' })
    if (!res.ok) await this.fail(res, 'upload link')
    const data = (await res.json()) as { url: string }
    return `${this.base}${data.url}`
  }
  async signedUrl(key: string, expiresInSeconds: number) {
    // Defense in depth: purchasable files are only ever streamed after an entitlement is redeemed.
    if (isProductFileKey(key)) throw new Error('Product files never get signed links')
    const res = await fetch(`${this.base}/object/sign/${this.path(key)}`, { method: 'POST', headers: this.headers({ 'content-type': 'application/json' }), body: JSON.stringify({ expiresIn: expiresInSeconds }) })
    if (!res.ok) await this.fail(res, 'signed link')
    const data = (await res.json()) as { signedURL: string }
    return `${this.base}${data.signedURL}`
  }
  /** Creates the two private buckets, or brings their settings up to date. Safe to repeat. */
  async ensureBuckets(limits: { files: number; media: number }) {
    const want = [
      { id: this.buckets.files, file_size_limit: limits.files },
      { id: this.buckets.media, file_size_limit: limits.media },
    ]
    for (const b of want) {
      const body = JSON.stringify({ id: b.id, name: b.id, public: false, file_size_limit: b.file_size_limit })
      const exists = await fetch(`${this.base}/bucket/${b.id}`, { headers: this.headers() })
      const res = exists.ok
        ? await fetch(`${this.base}/bucket/${b.id}`, { method: 'PUT', headers: this.headers({ 'content-type': 'application/json' }), body })
        : await fetch(`${this.base}/bucket`, { method: 'POST', headers: this.headers({ 'content-type': 'application/json' }), body })
      if (!res.ok) await this.fail(res, `bucket ${b.id} setup`)
    }
  }
}

let instance: Storage | null = null
export function storage(): Storage {
  if (!instance) instance = config.storage.driver === 'supabase' ? new SupabaseStorage() : config.storage.driver === 's3' ? new S3Storage() : new LocalStorage()
  return instance
}
/** Tests can swap in a failing or fake storage. */
export function setStorage(s: Storage | null) {
  instance = s
}

export function localPath(key: string) {
  return join(resolve(config.storage.localDir), key)
}
