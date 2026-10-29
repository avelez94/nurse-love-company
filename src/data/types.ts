/*
  Product record shape. Components read these records and never hard code
  product facts. Anything not yet confirmed by Nurse Love Company stays null,
  and the UI shows an honest "to be confirmed" state instead of guessing.
*/

export type CategoryId = 'nurse-inserts' | 'np-inserts' | 'apparel' | 'accessories' | 'pens'

export type ProductType = 'digital' | 'physical'

/** Names of the built in illustrative images (see components/illustrations). */
export type IllustrationName =
  | 'pages-nurse'
  | 'pages-np'
  | 'tee'
  | 'crewneck'
  | 'earrings-drop'
  | 'earrings-studs'
  | 'badge-reel'
  | 'pens-pair'
  | 'pens-trio'

/** Layouts used to draw neutral sample pages. No clinical content. */
export type SampleLayout = 'lined' | 'table' | 'checklist' | 'sections' | 'schedule' | 'grid'

export type ImageRef =
  | {
      kind: 'illustration'
      name: IllustrationName
      alt: string
      /** Optional title drawn on illustrated insert pages. */
      caption?: string
      /** Sample layouts to fan out on an illustrated insert cover. */
      pages?: SamplePage[]
    }
  | {
      /** A real photo or a full marketing graphic supplied by the business. */
      kind: 'photo'
      src: string
      alt: string
      width: number
      height: number
      /** Marketing graphics keep their full artwork: never crop. */
      fit?: 'contain' | 'cover'
    }

export type SamplePage =
  | {
      kind: 'illustration'
      title: string
      layout: SampleLayout
      /** Short neutral field labels drawn on the page. */
      fields?: string[]
    }
  | {
      kind: 'photo'
      title: string
      src: string
      alt: string
      width: number
      height: number
    }

export interface Variant {
  id: string
  label: string
  options: string[]
}

export type Availability = 'example' | 'available' | 'coming-soon' | 'sold-out'

export interface Product {
  id: string
  slug: string
  title: string
  category: CategoryId
  audience: string
  type: ProductType
  /** One or two sentence card summary. */
  summary: string
  /** Longer overview on the product page. */
  description: string
  gallery: ImageRef[]
  samplePages: SamplePage[]
  /** Price in US cents once confirmed. */
  priceCents: number | null
  /** e.g. "PDF". Only when confirmed for this product. */
  fileFormat: string | null
  /** e.g. ["Goodnotes"]. Only when confirmed for this product. */
  appCompatibility: string[] | null
  /** Physical variants (size, color). Only when supplied. */
  variants: Variant[] | null
  availability: Availability
  /** Future link to the digital delivery service (Shopify, etc). */
  deliveryRef: string | null
  /** True for sample listings shown before real products are supplied. */
  isExample: boolean
  /** Extra words that help local search. */
  keywords: string[]
}

export interface Category {
  id: CategoryId
  title: string
  tagline: string
  type: ProductType
  route: string
}

export interface Freebie {
  id: string
  title: string
  summary: string
  page: SamplePage
  /** Only the prototype sample can be downloaded in this preview. */
  downloadable: boolean
  fileName: string | null
  isExample: boolean
  keywords: string[]
}
