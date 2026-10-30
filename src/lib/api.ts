/* Small fetch wrapper for the store API. Cookies carry the session. */

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code = 'error',
  ) {
    super(message)
  }
}

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  let res: Response
  try {
    res = await fetch(path, {
      method: opts.method ?? (opts.body !== undefined ? 'POST' : 'GET'),
      credentials: 'same-origin',
      headers: opts.body !== undefined ? { 'content-type': 'application/json' } : undefined,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: opts.signal,
    })
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err
    throw new ApiError(0, 'We could not reach the store. Check your connection and try again.', 'network')
  }
  const type = res.headers.get('content-type') ?? ''
  const data = type.includes('json') ? await res.json().catch(() => ({})) : await res.text()
  if (!res.ok) {
    const msg = typeof data === 'object' && data ? (data.error ?? data.message) : null
    throw new ApiError(res.status, msg || `Request failed (${res.status}).`, typeof data === 'object' && data?.code ? data.code : 'error')
  }
  return data as T
}

export function errorMessage(err: unknown) {
  if (err instanceof ApiError) return err.message
  if (err instanceof Error) return err.message
  return 'Something went wrong.'
}

/** A random key used once per confirmation dialog, so repeated clicks are safe. */
export function newKey() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export interface UploadOptions {
  method?: string
  headers?: Record<string, string>
  onProgress?: (fraction: number) => void
  signal?: AbortSignal
  withCredentials?: boolean
}

/** Uploads a file with progress events (fetch cannot report upload progress). */
export function uploadFile<T = any>(url: string, file: Blob, opts: UploadOptions = {}): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open(opts.method ?? 'POST', url)
    xhr.withCredentials = opts.withCredentials ?? false
    for (const [k, v] of Object.entries(opts.headers ?? {})) xhr.setRequestHeader(k, v)
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) opts.onProgress?.(e.loaded / e.total)
    }
    xhr.onload = () => {
      let data: any = xhr.responseText
      try {
        data = JSON.parse(xhr.responseText)
      } catch {
        /* not JSON */
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data)
      else reject(new ApiError(xhr.status, (data && (data.error || data.message)) || `Upload failed (${xhr.status}).`, data?.code))
    }
    xhr.onerror = () => reject(new ApiError(0, 'The upload was interrupted. Check your connection and try again.', 'network'))
    xhr.onabort = () => reject(new ApiError(0, 'The upload was canceled.', 'aborted'))
    opts.signal?.addEventListener('abort', () => xhr.abort())
    xhr.send(file)
  })
}

export const fileHeaders = (file: File, extra: Record<string, string> = {}) => ({
  'content-type': file.type || 'application/octet-stream',
  'x-file-name': encodeURIComponent(file.name),
  ...extra,
})

export type UploadPurpose = 'product_image' | 'product_file' | 'tutorial_thumbnail' | 'tutorial_video'

/**
 * Uploads an admin file. The server decides how: on Vercel the file goes
 * straight to private Supabase Storage through a one path link, then the
 * server checks it; on a normal server it is sent to the server itself.
 */
export async function uploadAsset<T = any>(
  purpose: UploadPurpose,
  targetId: string,
  file: File,
  opts: { imageKind?: 'gallery' | 'sample'; alt?: string; onProgress?: (fraction: number) => void; signal?: AbortSignal } = {},
): Promise<T> {
  const start = await api<{ mode: 'server' | 'direct'; url: string; id?: string }>('/api/admin/uploads', {
    body: { purpose, target_id: targetId, file_name: file.name, size: file.size, type: file.type, image_kind: opts.imageKind, alt: opts.alt ?? '' },
  })
  if (start.mode === 'server') {
    const headers = fileHeaders(file, purpose === 'product_image' ? { 'x-alt-text': encodeURIComponent(opts.alt ?? '') } : {})
    return uploadFile<T>(start.url, file, { method: purpose === 'tutorial_video' ? 'PUT' : 'POST', headers, withCredentials: true, onProgress: opts.onProgress, signal: opts.signal })
  }
  try {
    await uploadFile(start.url, file, { method: 'PUT', headers: { 'content-type': file.type || 'application/octet-stream', 'x-upsert': 'false' }, onProgress: opts.onProgress, signal: opts.signal })
  } catch (err) {
    await api(`/api/admin/uploads/${start.id}/failed`, { body: { message: errorMessage(err) } }).catch(() => {})
    throw err
  }
  return api<T>(`/api/admin/uploads/${start.id}/complete`, { body: {} })
}
