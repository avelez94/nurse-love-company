import { badRequest } from './errors.js'

/* Small input validation helpers. Every admin and customer input passes through these. */

export function str(v: unknown, field: string, { max = 500, min = 0, optional = false } = {}): string {
  if (v === undefined || v === null) {
    if (optional) return ''
    throw badRequest(`${field} is required.`)
  }
  if (typeof v !== 'string') throw badRequest(`${field} must be text.`)
  const s = v.trim()
  if (s.length < min) throw badRequest(min <= 1 ? `${field} is required.` : `${field} must be at least ${min} characters.`)
  if (s.length > max) throw badRequest(`${field} must be ${max} characters or fewer.`)
  return s
}

export function int(v: unknown, field: string, { min = 0, max = 1_000_000_000, optional = false } = {}): number | null {
  if (v === undefined || v === null || v === '') {
    if (optional) return null
    throw badRequest(`${field} is required.`)
  }
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isInteger(n)) throw badRequest(`${field} must be a whole number.`)
  if (n < min || n > max) throw badRequest(`${field} must be between ${min} and ${max}.`)
  return n
}

export function bool(v: unknown): boolean {
  return v === true || v === 'true'
}

export function oneOf<T extends string>(v: unknown, field: string, options: readonly T[], fallback?: T): T {
  if ((v === undefined || v === null || v === '') && fallback !== undefined) return fallback
  if (typeof v === 'string' && (options as readonly string[]).includes(v)) return v as T
  throw badRequest(`${field} must be one of: ${options.join(', ')}.`)
}

export function strList(v: unknown, field: string, { maxItems = 20, maxLen = 60 } = {}): string[] {
  if (v === undefined || v === null) return []
  if (!Array.isArray(v)) throw badRequest(`${field} must be a list.`)
  if (v.length > maxItems) throw badRequest(`${field} can have at most ${maxItems} entries.`)
  return v.map((x, i) => str(x, `${field} ${i + 1}`, { max: maxLen, min: 1 }))
}

export function slug(v: unknown, field = 'URL slug'): string {
  const s = str(v, field, { max: 100, min: 1 }).toLowerCase()
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(s)) throw badRequest(`${field} can only use lowercase letters, numbers and single hyphens between words.`)
  return s
}

export function slugify(title: string): string {
  return title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 90)
}

export function uuid(v: unknown, field = 'id'): string {
  if (typeof v !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)) throw badRequest(`Invalid ${field}.`)
  return v
}

export function email(v: unknown, field = 'Email'): string {
  const s = str(v, field, { max: 254, min: 3 }).toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) throw badRequest(`${field} is not a valid email address.`)
  return s
}

export function isoDate(v: unknown, field: string): Date {
  const d = new Date(String(v))
  if (Number.isNaN(d.getTime())) throw badRequest(`${field} is not a valid date.`)
  return d
}
