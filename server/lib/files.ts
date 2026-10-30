/* File type checks by content (magic bytes), not just by name. */

export type Kind = 'image' | 'product-file' | 'video'

const sigs: Array<{ type: string; ext: string[]; test: (b: Buffer) => boolean }> = [
  { type: 'application/pdf', ext: ['pdf'], test: (b) => b.subarray(0, 5).toString('latin1') === '%PDF-' },
  { type: 'application/zip', ext: ['zip'], test: (b) => b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04 },
  { type: 'image/png', ext: ['png'], test: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { type: 'image/jpeg', ext: ['jpg', 'jpeg'], test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { type: 'image/webp', ext: ['webp'], test: (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP' },
  { type: 'video/mp4', ext: ['mp4', 'm4v'], test: (b) => b.subarray(4, 8).toString('latin1') === 'ftyp' && !b.subarray(8, 12).toString('latin1').startsWith('qt') },
  { type: 'video/quicktime', ext: ['mov'], test: (b) => b.subarray(4, 8).toString('latin1') === 'ftyp' || b.subarray(4, 8).toString('latin1') === 'moov' || b.subarray(4, 8).toString('latin1') === 'wide' },
  { type: 'video/webm', ext: ['webm'], test: (b) => b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3 },
]

export const allowed: Record<Kind, string[]> = {
  image: ['image/png', 'image/jpeg', 'image/webp'],
  'product-file': ['application/pdf', 'application/zip', 'image/png', 'image/jpeg'],
  video: ['video/mp4', 'video/quicktime', 'video/webm'],
}

export const allowedLabel: Record<Kind, string> = {
  image: 'PNG, JPG or WebP',
  'product-file': 'PDF, ZIP, PNG or JPG',
  video: 'MP4, MOV or WebM',
}

/** Detects the real type of a file from its first bytes. */
export function sniff(head: Buffer, kind: Kind): string | null {
  for (const s of sigs) if (allowed[kind].includes(s.type) && s.test(head)) return s.type
  return null
}

export function extensionMatches(fileName: string, type: string) {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? ''
  return sigs.find((s) => s.type === type)?.ext.includes(ext) ?? false
}

export function safeFileName(name: string) {
  const base = name.split(/[\\/]/).pop() ?? 'file'
  const cleaned = base.replace(/[^A-Za-z0-9._ -]/g, '').replace(/\s+/g, ' ').trim().slice(0, 120)
  return cleaned || 'file'
}

/** Reads width and height from PNG, JPEG or WebP headers. */
export function imageSize(b: Buffer): { width: number; height: number } | null {
  if (b[0] === 0x89 && b.length >= 24) return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) }
  if (b.subarray(0, 4).toString('latin1') === 'RIFF' && b.length >= 30) {
    const chunk = b.subarray(12, 16).toString('latin1')
    if (chunk === 'VP8X') return { width: 1 + b.readUIntLE(24, 3), height: 1 + b.readUIntLE(27, 3) }
    if (chunk === 'VP8 ') return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff }
    if (chunk === 'VP8L') {
      const bits = b.readUInt32LE(21)
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 }
    }
  }
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) return null
      const marker = b[i + 1]
      const len = b.readUInt16BE(i + 2)
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) }
      i += 2 + len
    }
  }
  return null
}
