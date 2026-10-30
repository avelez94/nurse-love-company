import { HttpError } from './errors.js'

/*
  Simple fixed window rate limiter kept in memory. Fine for a single server.
  When running more than one instance, move this to a shared store (Redis or
  the database) so limits apply across instances.
*/
const buckets = new Map<string, { count: number; resetAt: number }>()

export function rateLimit(key: string, max: number, windowSeconds: number) {
  const now = Date.now()
  const b = buckets.get(key)
  if (!b || b.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + windowSeconds * 1000 })
    return
  }
  b.count++
  if (b.count > max) {
    throw new HttpError(429, 'Too many requests. Please wait a minute and try again.', 'rate_limited')
  }
}

export function resetRateLimits() {
  buckets.clear()
}
