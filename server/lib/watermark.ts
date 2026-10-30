/*
  Preview images for product pages. The watermark is flattened into the
  pixels (not a CSS overlay), and images are reduced to preview size so the
  full resolution page is never published. The watermark artwork is a
  bundled PNG, so no fonts are needed on the server.
*/
import { readFileSync } from 'node:fs'
import sharp from 'sharp'

const MAX_EDGE = 1400
let mark: Buffer | null = null
const watermark = () => (mark ??= readFileSync(new URL('../assets/preview-watermark.png', import.meta.url)))

export async function watermarkPreview(input: Buffer, contentType: string) {
  const base = sharp(input, { failOn: 'error' }).rotate().flatten({ background: '#ffffff' }).resize({ width: MAX_EDGE, height: MAX_EDGE, fit: 'inside', withoutEnlargement: true })
  const { data, info } = await base.toBuffer({ resolveWithObject: true })
  // Tile the mark across the whole image at about half its width per repeat
  // (never larger than the image itself, which sharp requires for tiling).
  const tileWidth = Math.min(info.width, Math.max(240, Math.round(info.width * 0.48)))
  const tile = await sharp(watermark()).resize({ width: tileWidth, height: info.height, fit: 'inside' }).png().toBuffer()
  // One flat, opaque image: the mark cannot be separated or switched off.
  const out = sharp(await sharp(data).composite([{ input: tile, tile: true, blend: 'over' }]).toBuffer()).removeAlpha()
  const format = contentType === 'image/png' ? 'png' : contentType === 'image/webp' ? 'webp' : 'jpeg'
  const buffer = format === 'png' ? await out.png({ compressionLevel: 9 }).toBuffer() : format === 'webp' ? await out.webp({ quality: 82 }).toBuffer() : await out.jpeg({ quality: 82, mozjpeg: true }).toBuffer()
  return { buffer, contentType: `image/${format}`, width: info.width, height: info.height }
}
