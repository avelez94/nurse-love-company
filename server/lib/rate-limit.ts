import { q } from '../db/pool.js'
import { HttpError } from './errors.js'

/*
  Fixed window rate limiter stored in the database, so the limit holds across
  every serverless instance (an in memory counter would reset per instance).
*/
export async function rateLimit(key: string, max: number, windowSeconds: number) {
  const rows = await q<{ count: number }>(
    `insert into rate_limits (key, count, reset_at) values ($1, 1, now() + make_interval(secs => $2))
     on conflict (key) do update set
       count = case when rate_limits.reset_at < now() then 1 else rate_limits.count + 1 end,
       reset_at = case when rate_limits.reset_at < now() then excluded.reset_at else rate_limits.reset_at end
     returning count`,
    [key, windowSeconds],
  )
  if ((rows[0]?.count ?? 0) > max) {
    throw new HttpError(429, 'Too many requests. Please wait a minute and try again.', 'rate_limited')
  }
}

/** Removes expired windows. Called by the scheduled maintenance job. */
export async function pruneRateLimits() {
  await q('delete from rate_limits where reset_at < now()')
}

export async function resetRateLimits() {
  await q('delete from rate_limits')
}
