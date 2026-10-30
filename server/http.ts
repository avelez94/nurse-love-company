import type { Context, MiddlewareHandler } from 'hono'
import { auth, type Role, type SessionUser } from './auth.js'
import { config } from './env.js'
import { forbidden, HttpError, unauthorized } from './lib/errors.js'

export type AppEnv = { Variables: { user: SessionUser | null } }

/** Loads the signed in user (if any) from the session cookie on every request. */
export const sessionMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  let user: SessionUser | null = null
  try {
    const s = await auth().api.getSession({ headers: c.req.raw.headers })
    if (s?.user) {
      const u = s.user as unknown as { id: string; email: string; name: string; role?: string }
      user = { id: u.id, email: u.email, name: u.name, role: (u.role === 'admin' ? 'admin' : 'customer') as Role }
    }
  } catch {
    user = null
  }
  c.set('user', user)
  await next()
}

/**
 * Blocks cross site form posts. State changing requests must come from the
 * store's own origin (or carry no Origin header, as server to server webhooks do).
 */
export const originGuard: MiddlewareHandler<AppEnv> = async (c, next) => {
  const method = c.req.method
  if (method !== 'GET' && method !== 'HEAD' && !c.req.path.startsWith('/api/webhooks/')) {
    const origin = c.req.header('origin')
    if (origin && origin !== config.appUrl && !(process.env.EXTRA_ORIGINS ?? '').split(',').includes(origin)) {
      throw new HttpError(403, 'Request blocked: unexpected origin.', 'bad_origin')
    }
  }
  await next()
}

export function requireUser(c: Context<AppEnv>): SessionUser {
  const u = c.get('user')
  if (!u) throw unauthorized()
  return u
}

export function requireAdmin(c: Context<AppEnv>): SessionUser {
  const u = requireUser(c)
  if (u.role !== 'admin') throw forbidden()
  return u
}

/** Middleware form, applied to every /api/admin route. */
export const adminOnly: MiddlewareHandler<AppEnv> = async (c, next) => {
  requireAdmin(c)
  await next()
}

export function clientIp(c: Context): string {
  return (c.req.header('x-forwarded-for') ?? '').split(',')[0].trim() || c.req.header('x-real-ip') || 'local'
}

export async function jsonBody<T = Record<string, unknown>>(c: Context): Promise<T> {
  try {
    return (await c.req.json()) as T
  } catch {
    throw new HttpError(400, 'Request body must be valid JSON.', 'bad_json')
  }
}
