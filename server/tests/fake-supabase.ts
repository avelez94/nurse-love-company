/*
  A small stand in for Supabase Storage's REST API, following the endpoints
  the official storage-js client uses. It enforces the same rules the tests
  depend on: the service role key for everything except signed links, one
  path upload links that work once and never overwrite, private buckets, and
  read links that keep working until they expire (which is exactly why the
  store never hands one out for a purchasable file).
*/
import { randomBytes } from 'node:crypto'
import { createServer, type IncomingMessage, type Server } from 'node:http'

export interface FakeObject {
  bucket: string
  path: string
  body: Buffer
  contentType: string
}

export class FakeSupabase {
  objects = new Map<string, FakeObject>()
  buckets = new Map<string, { public: boolean; file_size_limit: number }>()
  uploadTokens = new Map<string, string>()
  readTokens = new Map<string, { id: string; expires: number }>()
  log: Array<{ method: string; path: string; status: number }> = []
  private server: Server | null = null

  constructor(private key: string) {}

  start(port: number) {
    this.server = createServer(async (req, res) => {
      const body = await read(req)
      const r = this.handle(req, body)
      this.log.push({ method: req.method!, path: req.url!.split('?')[0], status: r.status })
      res.writeHead(r.status, r.headers ?? { 'content-type': 'application/json' })
      res.end(req.method === 'HEAD' ? undefined : r.body)
    })
    return new Promise<void>((ok) => this.server!.listen(port, '127.0.0.1', () => ok()))
  }

  stop() {
    return new Promise<void>((ok) => (this.server ? this.server.close(() => ok()) : ok()))
  }

  /** Every signed read link handed out, so tests can prove none points at a product file. */
  signedReads() {
    return [...this.readTokens.values()].map((t) => t.id)
  }

  private authed(req: IncomingMessage) {
    return req.headers.apikey === this.key && req.headers.authorization === `Bearer ${this.key}`
  }

  private handle(req: IncomingMessage, body: Buffer): { status: number; body?: Buffer | string; headers?: Record<string, string> } {
    const url = new URL(req.url!, 'http://fake')
    const p = decodeURIComponent(url.pathname.replace(/^\/storage\/v1/, ''))
    const json = (status: number, data: unknown) => ({ status, body: JSON.stringify(data) })
    let m: RegExpMatchArray | null

    if ((m = p.match(/^\/bucket(?:\/([^/]+))?$/))) {
      if (!this.authed(req)) return json(401, { error: 'unauthorized' })
      if (req.method === 'GET') return this.buckets.has(m[1]) ? json(200, { id: m[1], ...this.buckets.get(m[1]) }) : json(404, { error: 'Bucket not found' })
      const b = JSON.parse(body.toString() || '{}')
      if (req.method === 'POST' && this.buckets.has(b.id)) return json(409, { error: 'exists' })
      this.buckets.set(b.id ?? m[1], { public: Boolean(b.public), file_size_limit: Number(b.file_size_limit) })
      return json(200, { name: b.id })
    }
    if ((m = p.match(/^\/object\/upload\/sign\/([^/]+)\/(.+)$/))) {
      const id = `${m[1]}/${m[2]}`
      if (req.method === 'POST') {
        if (!this.authed(req)) return json(401, { error: 'unauthorized' })
        const token = randomBytes(16).toString('hex')
        this.uploadTokens.set(token, id)
        return json(200, { url: `/object/upload/sign/${m[1]}/${m[2]}?token=${token}` })
      }
      if (req.method === 'PUT') {
        const token = url.searchParams.get('token') ?? ''
        if (this.uploadTokens.get(token) !== id) return json(400, { error: 'Invalid upload token' })
        if (this.objects.has(id)) return json(409, { error: 'The resource already exists' })
        const limit = this.buckets.get(m[1])?.file_size_limit
        if (limit && body.length > limit) return json(413, { error: 'The object exceeded the maximum allowed size' })
        this.uploadTokens.delete(token)
        this.objects.set(id, { bucket: m[1], path: m[2], body, contentType: String(req.headers['content-type'] ?? '') })
        return json(200, { Key: id })
      }
    }
    if ((m = p.match(/^\/object\/sign\/([^/]+)\/(.+)$/))) {
      const id = `${m[1]}/${m[2]}`
      if (req.method === 'POST') {
        if (!this.authed(req)) return json(401, { error: 'unauthorized' })
        if (!this.objects.has(id)) return json(404, { error: 'not found' })
        const token = randomBytes(16).toString('hex')
        this.readTokens.set(token, { id, expires: Date.now() + Number(JSON.parse(body.toString()).expiresIn) * 1000 })
        return json(200, { signedURL: `/object/sign/${m[1]}/${m[2]}?token=${token}` })
      }
      const t = this.readTokens.get(url.searchParams.get('token') ?? '')
      if (!t || t.id !== id || t.expires < Date.now()) return json(400, { error: 'invalid signature' })
      const o = this.objects.get(id)!
      return { status: 200, body: o.body, headers: { 'content-type': o.contentType, 'content-length': String(o.body.length) } }
    }
    if ((m = p.match(/^\/object\/info\/([^/]+)\/(.+)$/))) {
      if (!this.authed(req)) return json(401, { error: 'unauthorized' })
      const o = this.objects.get(`${m[1]}/${m[2]}`)
      return o ? json(200, { size: o.body.length }) : json(404, { error: 'not found' })
    }
    if ((m = p.match(/^\/object\/([^/]+)$/)) && req.method === 'DELETE') {
      if (!this.authed(req)) return json(401, { error: 'unauthorized' })
      for (const prefix of JSON.parse(body.toString()).prefixes as string[]) this.objects.delete(`${m[1]}/${prefix}`)
      return json(200, [])
    }
    if ((m = p.match(/^\/object\/([^/]+)\/(.+)$/))) {
      if (!this.authed(req)) return json(401, { error: 'unauthorized' })
      const id = `${m[1]}/${m[2]}`
      if (req.method === 'POST') {
        if (this.objects.has(id)) return json(409, { error: 'exists' })
        this.objects.set(id, { bucket: m[1], path: m[2], body, contentType: String(req.headers['content-type'] ?? '') })
        return json(200, { Key: id })
      }
      const o = this.objects.get(id)
      if (!o) return json(404, { error: 'not found' })
      const range = String(req.headers.range ?? '').match(/^bytes=(\d+)-(\d+)$/)
      if (range) {
        const slice = o.body.subarray(Number(range[1]), Number(range[2]) + 1)
        return { status: 206, body: slice, headers: { 'content-type': o.contentType, 'content-length': String(slice.length) } }
      }
      return { status: 200, body: o.body, headers: { 'content-type': o.contentType, 'content-length': String(o.body.length) } }
    }
    return json(404, { error: 'unknown route' })
  }
}

function read(req: IncomingMessage) {
  return new Promise<Buffer>((ok) => {
    const chunks: Buffer[] = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => ok(Buffer.concat(chunks)))
  })
}
