/*
  Vercel Routing Middleware: the staging password in front of EVERYTHING,
  including the static storefront and dashboard pages that Vercel serves
  without calling the API. It runs before Vercel's cache and file serving.

  Not gated: payment, email and video webhooks (they prove themselves with
  signatures), the health check (status words only) and the scheduled job
  (it needs CRON_SECRET). The API repeats the same check, with rate limiting
  of wrong attempts, so it holds even if this file were bypassed.

  Does nothing unless DEPLOY_ENV=staging.

  Coming soon (COMING_SOON=on, any environment): every visitor sees a
  "Coming soon" page and nothing else; the storefront, sign up, sign in and
  the whole API are closed. The same webhooks, health check and scheduled job
  stay open. The owner previews the real site with a private link,
  /?preview=<COMING_SOON_KEY>, which sets a cookie on that browser for 30 days
  (/?preview=off removes it). With no key of at least 16 characters, nobody
  can preview. Turn it off by removing COMING_SOON and redeploying.
*/
import { next } from '@vercel/functions'

export const config = { matcher: '/:path*', runtime: 'nodejs' }

const OPEN_PATHS = [/^\/api\/webhooks\//, /^\/api\/health$/, /^\/api\/cron\/maintenance$/]

/** Compares without stopping at the first difference. */
function sameText(a: string, b: string) {
  let diff = a.length ^ b.length
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0)
  return diff === 0
}

const PREVIEW_COOKIE = 'nlc_preview'

function comingSoonPage() {
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Nurse Love Company | Coming soon</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&family=Nunito+Sans:wght@400;700&display=swap" rel="stylesheet">
<style>
  :root { --ivory: #fffaf6; --blush: #fff0f2; --pink: #fbdde5; --raspberry: #d80853; --burgundy: #680c35; --soft: #7d3a55; }
  * { box-sizing: border-box; }
  html, body { margin: 0; min-height: 100%; }
  body { min-height: 100vh; display: grid; place-items: center; padding: 32px 16px; background: radial-gradient(ellipse 70% 60% at 50% 40%, var(--blush), var(--ivory) 75%); color: var(--burgundy); font-family: 'Nunito Sans', 'Segoe UI', system-ui, sans-serif; text-align: center; }
  .strip { position: fixed; inset: 0 0 auto; height: 36px; display: flex; align-items: center; justify-content: center; gap: 8px; font-size: 14px; color: var(--burgundy); background: linear-gradient(90deg, rgb(246 201 214 / .55) 50%, transparent 50%), linear-gradient(0deg, rgb(246 201 214 / .55) 50%, transparent 50%), var(--ivory); background-size: 12px 12px; }
  main { max-width: 640px; }
  .brand { font-family: 'DM Serif Display', Georgia, serif; font-size: clamp(30px, 6vw, 44px); line-height: 1; margin: 0; }
  .brand small { display: block; font-family: 'Nunito Sans', sans-serif; font-size: 13px; letter-spacing: .35em; margin-top: 6px; }
  h1 { font-family: 'DM Serif Display', Georgia, serif; font-weight: 400; font-size: clamp(44px, 10vw, 76px); line-height: 1; margin: 40px 0 18px; }
  h1 em { color: var(--raspberry); }
  p { font-size: clamp(17px, 2.6vw, 20px); line-height: 1.55; color: var(--soft); margin: 0 auto 14px; max-width: 30em; }
  .heart { width: 44px; height: 44px; margin: 28px auto 0; display: block; }
  a { color: var(--raspberry); font-weight: 700; }
</style>
</head>
<body>
  <div class="strip">&#9825; Made by a nurse, for nurses. &#9825;</div>
  <main>
    <p class="brand">Nurse Love<small>COMPANY</small></p>
    <h1>Coming <em>soon</em></h1>
    <p>We're putting the finishing touches on study resources, printable inserts and everyday favorites for your nursing life.</p>
    <p>Check back soon. We can't wait to share it with you.</p>
    <svg class="heart" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 8.3a4.3 4.3 0 0 1 7.5 2.5C19.5 16.4 12 21 12 21z" fill="none" stroke="#d80853" stroke-width="1.6" stroke-linejoin="round"/></svg>
  </main>
</body>
</html>`
  return new Response(html, {
    status: 503,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'retry-after': '86400', 'x-robots-tag': 'noindex, nofollow' },
  })
}

function readCookie(request: Request, name: string) {
  for (const part of (request.headers.get('cookie') ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=')
    if (k === name) return decodeURIComponent(v.join('='))
  }
  return ''
}

/** Returns a response when the coming soon gate answers the request, or null to let it through. */
function comingSoon(request: Request): Response | null {
  if (!['on', 'true', '1'].includes((process.env.COMING_SOON ?? '').toLowerCase())) return null
  const url = new URL(request.url)
  if (OPEN_PATHS.some((p) => p.test(url.pathname))) return null
  const key = process.env.COMING_SOON_KEY ?? ''
  const given = url.searchParams.get('preview')
  if (given !== null) {
    url.searchParams.delete('preview')
    const ok = key.length >= 16 && sameText(given, key)
    const cookie = ok
      ? `${PREVIEW_COOKIE}=${encodeURIComponent(key)}; Path=/; Max-Age=${30 * 86400}; HttpOnly; Secure; SameSite=Lax`
      : `${PREVIEW_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`
    return new Response(null, { status: 303, headers: { location: url.pathname + url.search + url.hash, 'set-cookie': cookie, 'cache-control': 'no-store' } })
  }
  if (key.length >= 16 && sameText(readCookie(request, PREVIEW_COOKIE), key)) return null
  if (url.pathname.startsWith('/api/')) {
    return new Response(JSON.stringify({ error: 'Nurse Love Company is coming soon.' }), { status: 503, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } })
  }
  // The coming soon page loads its own icon.
  if (url.pathname === '/favicon.svg') return null
  return comingSoonPage()
}

export default function middleware(request: Request) {
  const soon = comingSoon(request)
  if (soon) return soon
  if (process.env.DEPLOY_ENV !== 'staging') return next()
  const { pathname } = new URL(request.url)
  if (OPEN_PATHS.some((p) => p.test(pathname))) return next({ headers: { 'x-robots-tag': 'noindex, nofollow' } })

  const password = process.env.STAGING_ACCESS_PASSWORD ?? ''
  const user = process.env.STAGING_ACCESS_USER ?? 'nurselove'
  const header = request.headers.get('authorization') ?? ''
  let given = ''
  try {
    given = header.startsWith('Basic ') ? atob(header.slice(6)) : ''
  } catch {
    given = ''
  }
  // With no password configured the site stays closed rather than open.
  if (password.length >= 16 && sameText(given, `${user}:${password}`)) return next({ headers: { 'x-robots-tag': 'noindex, nofollow' } })
  return new Response('This is a private staging preview. Please sign in with the staging username and password.', {
    status: 401,
    headers: {
      'www-authenticate': 'Basic realm="Nurse Love Company staging", charset="UTF-8"',
      'cache-control': 'no-store',
      'x-robots-tag': 'noindex, nofollow',
      'content-type': 'text/plain; charset=utf-8',
    },
  })
}
