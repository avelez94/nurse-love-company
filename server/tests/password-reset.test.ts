import './env.js'
import assert from 'node:assert/strict'
import { after, beforeEach, describe, it } from 'node:test'
import { parseHash } from '../../src/lib/router.js'
import { api, app, one, ORIGIN, setup, signUp, teardown } from './helpers.js'

beforeEach(setup)
after(teardown)

/** The reset link exactly as it appears in the email. */
async function emailedLink(email: string) {
  await api('/api/auth/request-password-reset', { body: { email, redirectTo: `${ORIGIN}/#reset-password` } })
  const row = await one<{ html: string }>(`select html from emails where type = 'password_reset' and to_email = $1 order by id desc limit 1`, [email])
  const m = row!.html.match(/href="([^"]*\/api\/auth\/reset-password\/[^"]+)"/)
  assert.ok(m, 'the email has a reset button')
  return m[1].replace(/&amp;/g, '&')
}

/** Follows the email link the way a browser does and reads the page it lands on. */
async function land(link: string) {
  const u = new URL(link)
  const res = await app.request(`${u.pathname}${u.search}`, { headers: { origin: ORIGIN } })
  assert.equal(res.status, 302)
  const to = new URL(res.headers.get('location')!)
  return parseHash(to.hash, to.search)
}

describe('password reset from the email link', () => {
  it('opens the new password form with its code, and the new password works', async () => {
    const user = await signUp('mom@example.com')
    const route = await land(await emailedLink(user.email))
    assert.equal(route.name, 'auth')
    assert.ok(route.name === 'auth' && route.mode === 'reset-password' && route.token, `landed on ${JSON.stringify(route)}`)
    const reset = await api('/api/auth/reset-password', { body: { newPassword: 'A-brand-new-password-7', token: route.token } })
    assert.equal(reset.status, 200, JSON.stringify(reset.data))
    const signIn = await api('/api/auth/sign-in/email', { body: { email: user.email, password: 'A-brand-new-password-7' } })
    assert.equal(signIn.status, 200)
  })

  it('a used or expired link says so instead of asking for a code', async () => {
    const user = await signUp('mom@example.com')
    const link = await emailedLink(user.email)
    const first = await land(link)
    assert.ok(first.name === 'auth' && first.token)
    await api('/api/auth/reset-password', { body: { newPassword: 'A-brand-new-password-7', token: first.token } })
    const again = await land(link)
    assert.ok(again.name === 'auth' && again.mode === 'reset-password' && !again.token && again.expired, JSON.stringify(again))
  })
})
