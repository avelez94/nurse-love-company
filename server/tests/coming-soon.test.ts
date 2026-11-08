import './env.js'
import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'

/* middleware.ts: the coming soon gate in front of the whole site. */
const ORIGIN = 'https://nurselovecompany.com'
const KEY = 'a-private-preview-key-for-tests'
const load = async () => (await import('../../middleware.js')).default
const req = (path: string, cookie?: string) => new Request(`${ORIGIN}${path}`, { headers: cookie ? { cookie } : {} })

describe('coming soon gate', () => {
  afterEach(() => {
    delete process.env.COMING_SOON
    delete process.env.COMING_SOON_KEY
  })

  it('is off unless COMING_SOON is set', async () => {
    const mw = await load()
    assert.equal(mw(req('/')).headers.get('x-middleware-next'), '1')
  })

  it('shows the page to visitors, closes the API, and keeps webhooks and jobs open', async () => {
    process.env.COMING_SOON = 'on'
    process.env.COMING_SOON_KEY = KEY
    const mw = await load()
    for (const path of ['/', '/index.html', '/assets/index.js', '/#shop']) {
      const r = mw(req(path))
      assert.equal(r.status, 503, path)
      assert.match(await r.text(), /Coming <em>soon<\/em>/)
    }
    for (const path of ['/api/catalog', '/api/auth/sign-up/email', '/api/checkout', '/api/admin/settings']) {
      const r = mw(req(path))
      assert.equal(r.status, 503, path)
      assert.equal(r.headers.get('content-type'), 'application/json')
    }
    for (const open of ['/api/webhooks/stripe', '/api/webhooks/resend', '/api/webhooks/printful/token', '/api/health', '/api/cron/maintenance', '/favicon.svg']) {
      assert.equal(mw(req(open)).headers.get('x-middleware-next'), '1', open)
    }
  })

  it('lets the owner in with the preview link, and only with the right key', async () => {
    process.env.COMING_SOON = 'on'
    process.env.COMING_SOON_KEY = KEY
    const mw = await load()
    const wrong = mw(req('/?preview=guess'))
    assert.equal(wrong.status, 303)
    assert.match(wrong.headers.get('set-cookie') ?? '', /Max-Age=0/)
    const right = mw(req(`/?preview=${KEY}`))
    assert.equal(right.status, 303)
    assert.equal(right.headers.get('location'), '/')
    const cookie = (right.headers.get('set-cookie') ?? '').split(';')[0]
    assert.match(right.headers.get('set-cookie') ?? '', /HttpOnly; Secure/)
    assert.equal(mw(req('/', cookie)).headers.get('x-middleware-next'), '1')
    assert.equal(mw(req('/api/admin/settings', cookie)).headers.get('x-middleware-next'), '1')
    assert.equal(mw(req('/', 'nlc_preview=nope')).status, 503)
    assert.match(mw(req('/?preview=off', cookie)).headers.get('set-cookie') ?? '', /Max-Age=0/)
  })

  it('stays closed to everyone when the key is missing or short', async () => {
    process.env.COMING_SOON = 'on'
    process.env.COMING_SOON_KEY = 'short'
    const mw = await load()
    const r = mw(req('/?preview=short'))
    assert.match(r.headers.get('set-cookie') ?? '', /Max-Age=0/)
    assert.equal(mw(req('/', 'nlc_preview=short')).status, 503)
  })
})
