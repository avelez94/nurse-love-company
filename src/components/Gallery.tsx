import { Maximize2 } from 'lucide-react'
import { useState } from 'react'
import type { ImageRef } from '../data/types'
import { Dialog } from './Dialog'
import { ProductArt } from './ProductArt'
import './Gallery.css'

/*
  Product gallery. Images keep their full proportions (marketing graphics are
  never cropped) and every image can be enlarged.
*/
export function Gallery({ images, title, enlargeable = true }: { images: ImageRef[]; title: string; enlargeable?: boolean }) {
  const [index, setIndex] = useState(0)
  const [zoom, setZoom] = useState(false)
  const image = images[index]
  return (
    <div className="gallery">
      <div className="gallery__main">
        <ProductArt key={index} image={image} className="gallery__image" />
        <span className="gallery__note">Illustrative image</span>
        {enlargeable && (
          <button type="button" className="icon-button gallery__zoom" aria-label={`Enlarge image of ${title}`} onClick={() => setZoom(true)}>
            <Maximize2 aria-hidden="true" size={20} />
          </button>
        )}
      </div>
      {images.length > 1 && (
        <div className="gallery__thumbs" role="group" aria-label="Choose an image">
          {images.map((img, i) => (
            <button key={i} type="button" className="gallery__thumb" aria-pressed={i === index} aria-label={`Show image ${i + 1}`} onClick={() => setIndex(i)}>
              <ProductArt image={img} />
            </button>
          ))}
        </div>
      )}
      {enlargeable && (
        <Dialog open={zoom} onClose={() => setZoom(false)} title={`${title}, enlarged`} hideTitle variant="wide">
          <div className="gallery__zoomed">
            <ProductArt image={image} />
          </div>
        </Dialog>
      )}
    </div>
  )
}
