/* Calendar dates (Postgres date columns) without timezone shifts. */

/** "December 15, 2026" from YYYY-MM-DD, without timezone shifts. */
export const longDate = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' })

/** A date column as YYYY-MM-DD. The driver reads dates as local midnight, so the local parts are the stored date. */
export function ymd(v: Date | string | null | undefined): string | null {
  if (!v) return null
  if (typeof v === 'string') return v.slice(0, 10)
  return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`
}
