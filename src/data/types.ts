/*
  Product record shape. Components read these records and never hard code
  product facts. Anything not yet confirmed by Nurse Love Company stays null,
  and the UI shows an honest "to be confirmed" state instead of guessing.
*/

export type CategoryId = 'nurse-inserts' | 'np-inserts' | 'apparel' | 'accessories' | 'pens' | 'other'

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
  title: string
  options: Record<string, string>
  priceCents: number | null
  inStock: boolean
  imageIds: string[]
}

/** Confirmed digital file details, shown only when the owner has entered them. */
export interface DigitalInfo {
  pageCount: number | null
  pageSize: string | null
  orientation: string | null
  fileFormat: string | null
  fileSizeBytes: number | null
  usage: string[]
  apps: string[]
  binderNotice: boolean
  versionNumber: number | null
  versionReleasedAt: string | null
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
  /** Fields below come from the live store. */
  salePriceCents?: number | null
  inStock?: boolean
  digital?: DigitalInfo | null
  descriptionDoc?: unknown
  isDemo?: boolean
  featured?: boolean
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

/* Tutorials */

export type TutorialCategoryId = 'np-binder' | 'nurse-binder' | 'printing-assembly' | 'digital-files'

export interface TutorialCategory {
  id: TutorialCategoryId
  title: string
}

export type TutorialVideo =
  | {
      /** A video file hosted with the site or on a video CDN. */
      kind: 'file'
      src: string
      type: string
      poster?: string
    }
  | {
      /** Adaptive streaming (Mux). Played with hls.js where the browser needs it. */
      kind: 'hls'
      src: string
      poster?: string | null
    }
  | {
      /** A video hosted elsewhere (YouTube, Vimeo). Use a privacy friendly embed URL. */
      kind: 'embed'
      url: string
    }

export interface CaptionTrack {
  label: string
  srclang: string
  /** URL of a WebVTT file... */
  src?: string
  /** ...or the WebVTT text itself. */
  vtt?: string
}

export type TutorialThumbnail =
  | { kind: 'illustration'; name: 'pages-np' | 'pages-nurse' | 'printing' | 'tablet'; alt: string }
  | { kind: 'url'; src: string; alt: string }
  | { kind: 'photo'; src: string; alt: string; width: number; height: number }

export interface Tutorial {
  id: string
  slug: string
  title: string
  category: TutorialCategoryId
  summary: string
  /** Length of the video in seconds, taken from the actual file. */
  durationSeconds: number | null
  video: TutorialVideo | null
  captions: CaptionTrack[]
  thumbnail: TutorialThumbnail
  /** Written, step by step instructions shown under the video. */
  steps: string[]
  /** Transcript paragraphs. When null, the caption text is shown instead. */
  transcript: string[] | null
  /** Product categories this tutorial helps with (drives the help links). */
  productCategories: CategoryId[]
  /** Optional links to products and resources. */
  links: Array<{ label: string; route: string }>
  featured: boolean
  /** Only published tutorials appear on the site. */
  published: boolean
  isExample: boolean
  /** True while the video is the temporary placeholder. */
  placeholderVideo: boolean
  keywords: string[]
  /** Formatted written instructions from the admin editor. */
  instructions?: unknown
  relatedProducts?: Array<{ id: string; slug: string; title: string }>
}
