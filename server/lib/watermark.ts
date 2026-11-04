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

/**
 * blur: 0 (off) to 100 percent. At 100 the blur radius is about 0.6% of the
 * image width, so the same setting looks alike on small and large pages.
 * sharpTop: the top percent left sharp (for the title). The blur is flattened
 * in before the watermark, so the watermark itself stays crisp.
 */
export async function watermarkPreview(input: Buffer, contentType: string, opts: { blur?: number; sharpTop?: number } = {}) {
  const base = sharp(input, { failOn: 'error' }).rotate().flatten({ background: '#ffffff' }).resize({ width: MAX_EDGE, height: MAX_EDGE, fit: 'inside', withoutEnlargement: true })
  let { data, info } = await base.png().toBuffer({ resolveWithObject: true })
  const sigma = (Math.min(100, Math.max(0, opts.blur ?? 0)) / 100) * info.width * 0.006
  if (sigma >= 0.3) {
    const keep = Math.round((Math.min(60, Math.max(0, opts.sharpTop ?? 0)) / 100) * info.height)
    const blurred = await sharp(data).blur(sigma).png().toBuffer()
    const layers = keep > 0 ? [{ input: await sharp(data).extract({ left: 0, top: 0, width: info.width, height: keep }).png().toBuffer(), left: 0, top: 0 }] : []
    data = await sharp(blurred).composite(layers).png().toBuffer()
  }
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
