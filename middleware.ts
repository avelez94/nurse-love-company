/*
  Vercel Routing Middleware: the staging password in front of EVERYTHING,
  including the static storefront and dashboard pages that Vercel serves
  without calling the API. It runs before Vercel's cache and file serving.

  Not gated: payment, email and video webhooks (they prove themselves with
  signatures), the health check (status words only) and the scheduled job
  (it needs CRON_SECRET). The API repeats the same check, with rate limiting
  of wrong attempts, so it holds even if this file were bypassed.

  Does nothing unless DEPLOY_ENV=staging.
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

export default function middleware(request: Request) {
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
