/*
  Printful API client (API v1, https://api.printful.com).

  Every response is {code, result} or an error {code, result|error}. Calls
  are split into three outcomes so callers never guess:
    * success: the parsed result;
    * PrintfulError: Printful answered and refused (for example a bad
      address or a variant that cannot be made). Retrying will not help;
    * PrintfulUncertain: no clear answer (timeout, network failure, 5xx,
      rate limit). The request may or may not have been applied, so order
      creation reconciles by external id before trying again.

  Tests swap the transport with setPrintfulTransport, so no test ever
  reaches the real service.
*/
import { config } from '../env.js'
import { HttpError } from './errors.js'

export class PrintfulError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly reason = '',
  ) {
    super(message)
  }
}

/** The outcome is unknown: Printful may have done it. */
export class PrintfulUncertain extends Error {}

export interface PrintfulResponse {
  status: number
  body: unknown
}
export type PrintfulTransport = (req: { method: string; url: string; headers: Record<string, string>; body?: string }) => Promise<PrintfulResponse>

const TIMEOUT_MS = 15_000

const fetchTransport: PrintfulTransport = async (req) => {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(req.url, { method: req.method, headers: req.headers, body: req.body, signal: ctrl.signal })
    const text = await res.text()
    let body: unknown = text
    try {
      body = JSON.parse(text)
    } catch {
      /* keep the text */
    }
    return { status: res.status, body }
  } finally {
    clearTimeout(timer)
  }
}

let transport: PrintfulTransport = fetchTransport

/** Tests replace the network with a fake Printful. */
export function setPrintfulTransport(t: PrintfulTransport | null) {
  transport = t ?? fetchTransport
}

export const printfulConfigured = () => Boolean(config.printful.apiToken)

function message(body: unknown, status: number) {
  const b = body as { result?: unknown; error?: { message?: string; reason?: string } } | null
  const text = (typeof b?.error?.message === 'string' && b.error.message) || (typeof b?.result === 'string' && b.result) || `Printful answered with status ${status}.`
  return { text: String(text).slice(0, 500), reason: String(b?.error?.reason ?? '') }
}

export async function printful<T = unknown>(method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, body?: unknown): Promise<T> {
  if (!printfulConfigured()) throw new HttpError(503, 'Printful is not connected yet.', 'printful_not_configured')
  const headers: Record<string, string> = { authorization: `Bearer ${config.printful.apiToken}`, accept: 'application/json' }
  if (config.printful.storeId) headers['x-pf-store-id'] = config.printful.storeId
  if (body !== undefined) headers['content-type'] = 'application/json'
  let res: PrintfulResponse
  try {
    res = await transport({ method, url: `${config.printful.apiBase}${path}`, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  } catch (err) {
    throw new PrintfulUncertain(`No answer from Printful (${(err as Error).name === 'AbortError' ? 'timed out' : (err as Error).message}).`)
  }
  if (res.status >= 200 && res.status < 300) return (res.body as { result: T }).result
  const m = message(res.body, res.status)
  if (res.status === 429 || res.status >= 500) throw new PrintfulUncertain(`Printful is busy or had a problem (${res.status}): ${m.text}`)
  throw new PrintfulError(m.text, res.status, m.reason)
}

/* ---------- Shapes used here (only the fields this store reads) ---------- */

export interface PfStore {
  id: number
  name: string
  type?: string
}

export interface PfSyncProductSummary {
  id: number
  external_id?: string
  name: string
  variants: number
  synced: number
  thumbnail_url?: string
  is_ignored?: boolean
}

export interface PfFile {
  type?: string
  status?: string
  preview_url?: string
  thumbnail_url?: string
}

export interface PfSyncVariant {
  id: number
  external_id?: string
  sync_product_id: number
  name: string
  synced: boolean
  variant_id: number
  retail_price?: string
  currency?: string
  is_ignored?: boolean
  sku?: string
  size?: string
  color?: string
  availability_status?: string
  files?: PfFile[]
  product?: { variant_id?: number; product_id?: number; image?: string; name?: string }
}

export interface PfShippingRate {
  id: string
  name: string
  rate: string
  currency: string
  minDeliveryDays?: number
  maxDeliveryDays?: number
  min_delivery_days?: number
  max_delivery_days?: number
}

export interface PfShipment {
  id: number
  carrier?: string
  service?: string
  tracking_number?: string | number
  tracking_url?: string
  created?: number
  ship_date?: string
  shipped_at?: number
  reshipment?: boolean
  items?: Array<{ item_id: number; quantity: number }>
  /** Only acted on if Printful reports it; shipping alone never counts as delivery. */
  delivered_at?: number | string | null
  status?: string
}

export interface PfOrder {
  id: number
  external_id?: string
  status: string
  shipping?: string
  shipping_service_name?: string
  items?: Array<{ id: number; external_id?: string; sync_variant_id?: number; quantity: number }>
  costs?: Record<string, unknown>
  shipments?: PfShipment[]
}

/** Printful's sync variant states that can be made and shipped right now. */
export const AVAILABLE_STATUSES = new Set(['active'])
