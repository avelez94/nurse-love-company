import type { IllustrationName, ImageRef } from '../data/types'
import { BadgeReel, Crewneck, EarringStuds, EarringsDrop, PenPair, PenTrio, Tee } from './illustrations/Objects'
import { PageCluster } from './illustrations/PageCluster'
import './ProductArt.css'

/*
  Renders one product image. Illustrations are placeholders; real photos and
  full marketing graphics use <img> with fixed dimensions and are never
  cropped when fit is "contain".
*/

const objects: Partial<Record<IllustrationName, (p: { className?: string }) => React.JSX.Element>> = {
  tee: Tee,
  crewneck: Crewneck,
  'earrings-drop': EarringsDrop,
  'earrings-studs': EarringStuds,
  'badge-reel': BadgeReel,
  'pens-pair': PenPair,
  'pens-trio': PenTrio,
}

export function ProductArt({ image, className = '' }: { image: ImageRef; className?: string }) {
  if (image.kind === 'photo') {
    return (
      <img
        className={`product-art product-art--photo ${image.fit === 'contain' ? 'is-contain' : ''} ${className}`}
        src={image.src}
        alt={image.alt}
        width={image.width}
        height={image.height}
        loading="lazy"
        decoding="async"
      />
    )
  }
  const Obj = objects[image.name]
  return (
    <div className={`product-art product-art--${image.name} ${className}`} role="img" aria-label={image.alt}>
      {Obj ? <Obj className="product-art__object" /> : <PageCluster variant={image.name === 'pages-np' ? 'np' : 'nurse'} caption={image.caption} pages={image.pages} />}
    </div>
  )
}
