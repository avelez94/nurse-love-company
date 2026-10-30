/*
  Accounts and sessions use Better Auth (email and password, httpOnly session
  cookies, scrypt password hashing, built in rate limiting). Roles live on the
  user record and cannot be set by the browser: "customer" by default, "admin"
  only through the server side admin tool (npm run admin:create).
*/
import { betterAuth } from 'better-auth'
import type pg from 'pg'
import { config, isProduction, isTest } from './env.js'
import { queueEmail } from './email/outbox.js'

export function authOptions(pool: pg.Pool) {
  return {
    database: pool,
    baseURL: config.appUrl,
    basePath: '/api/auth',
    secret: config.authSecret,
    trustedOrigins: [config.appUrl],
    telemetry: { enabled: false },
    rateLimit: { enabled: !isTest, window: 60, max: 30 },
    user: {
      additionalFields: {
        role: { type: 'string' as const, defaultValue: 'customer', input: false },
      },
    },
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 10,
      maxPasswordLength: 128,
      revokeSessionsOnPasswordReset: true,
      resetPasswordTokenExpiresIn: 60 * 60,
      sendResetPassword: async ({ user, url }: { user: { id: string; email: string; name: string }; url: string }) => {
        // Password emails never touch download entitlements.
        await queueEmail({
          type: 'password_reset',
          to: user.email,
          userId: user.id,
          vars: { name: user.name, url },
          idempotencyKey: `password_reset:${user.id}:${Date.now()}`,
        })
      },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 14,
      updateAge: 60 * 60 * 24,
    },
    advanced: {
      useSecureCookies: isProduction,
      cookiePrefix: 'nlc',
    },
  }
}

export function createAuth(pool: pg.Pool) {
  return betterAuth(authOptions(pool))
}

export type Auth = ReturnType<typeof createAuth>

let instance: Auth | null = null
export function setAuth(a: Auth) {
  instance = a
}
export function auth(): Auth {
  if (!instance) throw new Error('Auth not initialised')
  return instance
}

export type Role = 'customer' | 'admin'
export interface SessionUser {
  id: string
  email: string
  name: string
  role: Role
}
