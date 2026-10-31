import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { products as exampleProducts } from '../data/catalog'
import type { CategoryId, ImageRef, Product, SamplePage, Tutorial, TutorialCategoryId, Variant } from '../data/types'
import { tutorials as exampleTutorials } from '../data/tutorials'
import { plainText, sanitizeDoc, type RichDoc } from '../../shared/richtext'
import { api } from './api'

/*
  Live catalog from the store API. If the API cannot be reached (for example
  the design preview before the database is connected), lists stay empty and
  pages show that the store is not connected, rather than standing in other
  content. Only the single page "artifact" design build uses the bundled
  example catalog.
*/

interface ApiImage {
  id: string
  url: string
  alt: string
  width: number | null
  height: number | null
  kind: 'gallery' | 'sample' | 'detail'
  variantId: string | null
}

export interface ApiProduct {
  id: string
  slug: string
  title: string
  category: CategoryId
  collection: string
  type: 'digital' | 'physical'
  shortDescription: string
  description: unknown
  priceCents: number | null
  salePriceCents: number | null
  featured: boolean
  isDemo: boolean
  images: ApiImage[]
  variants: Variant[]
  inStock: boolean
  digital: Product['digital']
  whatsIncluded?: string[]
  walkthrough?: { slug: string; title: string } | null
  isFreebie?: boolean
  preorder?: { shipBy: string } | null
}

export interface ApiTutorial {
  id: string
  slug: string
  title: string
  category: TutorialCategoryId
  summary: string
  instructions: unknown
  transcript: string
  featured: boolean
  durationSeconds: number | null
  isPlaceholder: boolean
  status?: string
  video: Tutorial['video']
  thumbnail: string | null
  captions: Array<{ label: string; srclang: string; src: string }>
  products: Array<{ id: string; slug: string; title: string }>
}

const photo = (img: ApiImage): ImageRef => ({ kind: 'photo', src: img.url, alt: img.alt, width: img.width ?? 1200, height: img.height ?? 900, fit: 'contain' })

const defaultArt: Record<string, ImageRef['kind'] extends never ? never : string> = {
  apparel: 'tee',
  accessories: 'earrings-drop',
  pens: 'pens-pair',
  other: 'pens-trio',
}

export function toProduct(p: ApiProduct): Product {
  const example = exampleProducts.find((e) => e.slug === p.slug)
  const gallery = p.images.filter((i) => i.kind === 'gallery')
  // Only previews the owner approved reach the storefront (the server filters them). Samples first, then details.
  const samples = [...p.images.filter((i) => i.kind === 'sample'), ...p.images.filter((i) => i.kind === 'detail')]
  const doc = sanitizeDoc(p.description)
  const fallbackGallery: ImageRef[] = example?.gallery ?? [
    p.type === 'digital'
      ? { kind: 'illustration', name: p.category === 'np-inserts' ? 'pages-np' : 'pages-nurse', caption: p.title.slice(0, 18), alt: `Illustrated insert pages for ${p.title}. Illustrative image.` }
      : { kind: 'illustration', name: (defaultArt[p.category] ?? 'pens-trio') as 'tee', alt: `Illustration for ${p.title}. Illustrative image.` },
  ]
  return {
    id: p.id,
    slug: p.slug,
    title: p.title,
    category: p.category,
    audience: p.category === 'np-inserts' ? 'Nurse practitioner students and NPs' : p.type === 'digital' ? 'Nursing students and nurses' : 'All nurses and nursing students',
    type: p.type,
    summary: p.shortDescription,
    description: plainText(doc as RichDoc),
    descriptionDoc: doc,
    gallery: gallery.length ? gallery.map(photo) : fallbackGallery,
    samplePages: samples.map((s): SamplePage => ({ kind: 'photo', title: s.alt || (s.kind === 'detail' ? 'Close up detail' : 'Sample page'), src: s.url, alt: s.alt || `${s.kind === 'detail' ? 'Close up detail' : 'Sample page'} from ${p.title}, watermarked preview`, width: s.width ?? 850, height: s.height ?? 1100 })),
    realSamples: samples.length > 0,
    whatsIncluded: p.whatsIncluded ?? [],
    walkthrough: p.walkthrough ?? null,
    priceCents: p.priceCents,
    salePriceCents: p.salePriceCents,
    fileFormat: p.digital?.fileFormat ?? null,
    appCompatibility: p.digital?.apps.length ? p.digital.apps : null,
    variants: p.variants.length ? p.variants : null,
    availability: p.inStock ? (p.isDemo ? 'example' : 'available') : 'sold-out',
    deliveryRef: null,
    isExample: p.isDemo,
    isDemo: p.isDemo,
    isFreebie: Boolean(p.isFreebie),
    preorder: p.preorder ?? null,
    inStock: p.inStock,
    featured: p.featured,
    digital: p.digital,
    keywords: example?.keywords ?? [p.collection, p.category].filter(Boolean),
  }
}

const tutorialProductCategories: Record<TutorialCategoryId, CategoryId[]> = {
  'np-binder': ['np-inserts'],
  'nurse-binder': ['nurse-inserts'],
  'printing-assembly': ['nurse-inserts', 'np-inserts'],
  'digital-files': ['nurse-inserts', 'np-inserts'],
}

const thumbArt: Record<TutorialCategoryId, 'pages-np' | 'pages-nurse' | 'printing' | 'tablet'> = {
  'np-binder': 'pages-np',
  'nurse-binder': 'pages-nurse',
  'printing-assembly': 'printing',
  'digital-files': 'tablet',
}

export function toTutorial(t: ApiTutorial): Tutorial {
  return {
    id: t.id,
    slug: t.slug,
    title: t.title,
    category: t.category,
    summary: t.summary,
    durationSeconds: t.durationSeconds,
    video: t.video,
    captions: t.captions.map((c) => ({ label: c.label, srclang: c.srclang, src: c.src })),
    thumbnail: t.thumbnail ? { kind: 'url', src: t.thumbnail, alt: `Thumbnail for ${t.title}` } : { kind: 'illustration', name: thumbArt[t.category], alt: `Illustrated thumbnail for ${t.title}` },
    steps: [],
    instructions: sanitizeDoc(t.instructions),
    transcript: t.transcript ? t.transcript.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean) : null,
    productCategories: tutorialProductCategories[t.category] ?? [],
    links: t.products.map((p) => ({ label: p.title, route: `product-${p.slug}` })),
    relatedProducts: t.products,
    featured: t.featured,
    published: true,
    isExample: t.isPlaceholder,
    placeholderVideo: t.isPlaceholder,
    keywords: t.title.toLowerCase().split(/\s+/),
  }
}

type Status = 'loading' | 'live' | 'offline'

interface StoreValue {
  status: Status
  products: Product[]
  tutorials: Tutorial[]
  featuredIds: string[]
  supportEmail: string
  payments: 'test' | 'live' | 'live-blocked' | 'not-configured' | 'unknown'
  /** Items that ship (made by Printful): whether they can be ordered now, why not, and where they ship. */
  physicalSales: { open: boolean; reason: string; countries: string[] }
  environment: 'development' | 'staging' | 'production' | 'unknown'
  reload: () => Promise<void>
  getProduct: (slug: string) => Product | undefined
  productById: (id: string) => Product | undefined
  productsIn: (...cats: CategoryId[]) => Product[]
  getTutorial: (slug: string) => Tutorial | undefined
  tutorialForCategory: (cat: CategoryId) => Tutorial | undefined
}

const Ctx = createContext<StoreValue | null>(null)

export function StoreProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('loading')
  const [products, setProducts] = useState<Product[]>([])
  const [tutorials, setTutorials] = useState<Tutorial[]>([])
  const [featuredIds, setFeatured] = useState<string[]>([])
  const [supportEmail, setSupport] = useState('')
  const [payments, setPayments] = useState<StoreValue['payments']>('unknown')
  const [environment, setEnvironment] = useState<StoreValue['environment']>('unknown')
  const [physicalSales, setPhysicalSales] = useState<StoreValue['physicalSales']>({ open: false, reason: '', countries: [] })

  const reload = useCallback(async () => {
    try {
      const [cat, tut, st] = await Promise.all([
        api<{ products: ApiProduct[]; featuredIds: string[]; store: { supportEmail: string } }>('/api/catalog'),
        api<{ tutorials: ApiTutorial[] }>('/api/tutorials'),
        api<{ payments: StoreValue['payments']; environment: StoreValue['environment']; physicalSales?: StoreValue['physicalSales'] }>('/api/status'),
      ])
      setProducts(cat.products.map(toProduct))
      setTutorials(tut.tutorials.map(toTutorial))
      setFeatured(cat.featuredIds)
      setSupport(cat.store.supportEmail)
      setPayments(st.payments)
      setEnvironment(st.environment ?? 'unknown')
      setPhysicalSales(st.physicalSales ?? { open: false, reason: '', countries: [] })
      setStatus('live')
    } catch {
      const artifact = import.meta.env.MODE === 'artifact'
      setProducts(artifact ? exampleProducts : [])
      setTutorials(artifact ? exampleTutorials : [])
      setStatus('offline')
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  const value = useMemo<StoreValue>(() => {
    const getProduct = (slug: string) => products.find((p) => p.slug === slug)
    return {
      status,
      products,
      tutorials,
      featuredIds,
      supportEmail,
      payments,
      physicalSales,
      environment,
      reload,
      getProduct,
      productById: (id) => products.find((p) => p.id === id),
      productsIn: (...cats) => products.filter((p) => cats.includes(p.category)),
      getTutorial: (slug) => tutorials.find((t) => t.slug === slug),
      tutorialForCategory: (cat) => {
        const matches = tutorials.filter((t) => t.productCategories.includes(cat))
        return matches.find((t) => t.title.startsWith('How to')) ?? matches[0]
      },
    }
  }, [status, products, tutorials, featuredIds, supportEmail, payments, physicalSales, environment, reload])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useStore() {
  const v = useContext(Ctx)
  if (!v) throw new Error('useStore must be inside StoreProvider')
  return v
}

/**
 * Whether a category has something customers can order right now: a published
 * product that is available or on preorder. While the store is loading this is
 * false (so nothing flashes in and out); in the offline design preview it is
 * true, so the layout can still be reviewed.
 */
export function useCategoryOpen() {
  const { status, products } = useStore()
  return (category: string) => (status === 'offline' ? true : status === 'live' && products.some((p) => p.category === category && (p.inStock !== false || Boolean(p.preorder))))
}

/** Price shown to customers: sale price when set. */
export function displayPrice(p: Pick<Product, 'priceCents' | 'salePriceCents'>, variant?: Variant | null) {
  if (variant?.priceCents !== null && variant?.priceCents !== undefined) return { now: variant.priceCents, was: null }
  if (p.salePriceCents !== null && p.salePriceCents !== undefined && p.priceCents !== null) return { now: p.salePriceCents, was: p.priceCents }
  return { now: p.priceCents, was: null }
}
