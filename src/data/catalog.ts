import type { Category, CategoryId, Freebie, Product, SampleLayout, SamplePage } from './types'

/*
  Sample catalog for the preview. Every record is marked isExample: true.
  Titles are example topics only. Prices, formats, app compatibility, page
  counts and variants stay null until Nurse Love Company confirms them.
  Replace these records with real products before launch.
*/

export const categories: Category[] = [
  {
    id: 'nurse-inserts',
    title: 'Nurse Binder Inserts',
    tagline: 'Printable resources for your nursing journey.',
    type: 'digital',
    route: 'nurse-binder-inserts',
  },
  {
    id: 'np-inserts',
    title: 'NP Binder Inserts',
    tagline: 'Resources for your NP journey.',
    type: 'digital',
    route: 'np-binder-inserts',
  },
  {
    id: 'apparel',
    title: 'Nurse-Love Apparel',
    tagline: 'Soft, comfy favorites for off-duty days.',
    type: 'physical',
    route: 'apparel',
  },
  {
    id: 'accessories',
    title: 'Cute Accessories',
    tagline: 'Sweet little details for every day.',
    type: 'physical',
    route: 'accessories',
  },
  {
    id: 'pens',
    title: 'Pretty Pens',
    tagline: 'Write your nursing story in style.',
    type: 'physical',
    route: 'pens',
  },
  {
    id: 'other',
    title: 'More favorites',
    tagline: 'Other resources and favorites.',
    type: 'physical',
    route: 'shop',
  },
]

export function getCategory(id: CategoryId): Category {
  const found = categories.find((c) => c.id === id)
  if (!found) throw new Error(`Unknown category ${id}`)
  return found
}

const exampleNote =
  'This is an example listing that shows how the resource will be presented. The final description, included pages and file details will be added by Nurse Love Company.'

const shippedNote =
  'This is an example listing that shows how physical favorites will be presented. Photos, sizes, colors and shipping details will be added by Nurse Love Company.'

function pages(topic: string, list: Array<[string, SampleLayout, string[]?]>): SamplePage[] {
  return list.map(([title, layout, fields]) => ({
    kind: 'illustration',
    title: title.replace('{topic}', topic),
    layout,
    fields,
  }))
}

function digital(
  p: Pick<Product, 'id' | 'title' | 'category' | 'summary' | 'keywords' | 'samplePages'> & { coverCaption: string },
): Product {
  const isNp = p.category === 'np-inserts'
  return {
    id: p.id,
    slug: p.id,
    title: p.title,
    category: p.category,
    audience: isNp ? 'Nurse practitioner students and NPs' : 'Nursing students and nurses',
    type: 'digital',
    summary: p.summary,
    description: exampleNote,
    gallery: [
      {
        kind: 'illustration',
        name: isNp ? 'pages-np' : 'pages-nurse',
        caption: p.coverCaption,
        pages: p.samplePages.slice(0, isNp ? 2 : 3),
        alt: `Illustrated loose insert pages for ${p.title}. Inserts only, binder not included.`,
      },
    ],
    samplePages: p.samplePages,
    priceCents: null,
    fileFormat: null,
    appCompatibility: null,
    variants: null,
    availability: 'example',
    deliveryRef: null,
    isExample: true,
    keywords: [...p.keywords, 'digital', 'download', 'printable', 'insert', isNp ? 'np' : 'nurse'],
  }
}

function physical(
  p: Pick<Product, 'id' | 'title' | 'category' | 'summary' | 'keywords' | 'gallery'>,
): Product {
  return {
    id: p.id,
    slug: p.id,
    title: p.title,
    category: p.category,
    audience: 'All nurses and nursing students',
    type: 'physical',
    summary: p.summary,
    description: shippedNote,
    gallery: p.gallery,
    samplePages: [],
    priceCents: null,
    fileFormat: null,
    appCompatibility: null,
    variants: null,
    availability: 'example',
    deliveryRef: null,
    isExample: true,
    keywords: [...p.keywords, 'ships', 'physical', 'gift'],
  }
}

export const products: Product[] = [
  digital({
    id: 'dermatology-documentation',
    title: 'Dermatology Documentation',
    category: 'nurse-inserts',
    coverCaption: 'Dermatology',
    summary: 'Example insert topic for organizing your dermatology notes.',
    keywords: ['dermatology', 'skin', 'documentation', 'notes'],
    samplePages: pages('Dermatology', [
      ['{topic} Notes', 'sections', ['Date', 'Topic', 'Key points', 'Questions to review']],
      ['Documentation Log', 'table', ['Date', 'Entry', 'Notes']],
      ['Study Checklist', 'checklist'],
      ['Brain Dump', 'lined'],
    ]),
  }),
  digital({
    id: 'sickle-cell',
    title: 'Sickle Cell',
    category: 'nurse-inserts',
    coverCaption: 'Sickle Cell',
    summary: 'Example insert topic for building your sickle cell study notes.',
    keywords: ['sickle cell', 'hematology', 'study', 'notes'],
    samplePages: pages('Sickle Cell', [
      ['{topic} Study Notes', 'sections', ['Date', 'Topic', 'Key points', 'My summary']],
      ['Review Checklist', 'checklist'],
      ['Notes', 'lined'],
    ]),
  }),
  digital({
    id: 'glaucoma',
    title: 'Glaucoma',
    category: 'nurse-inserts',
    coverCaption: 'Glaucoma',
    summary: 'Example insert topic for organizing your glaucoma study notes.',
    keywords: ['glaucoma', 'eye', 'ophthalmology', 'study'],
    samplePages: pages('Glaucoma', [
      ['{topic} Study Notes', 'sections', ['Date', 'Topic', 'Key points', 'Questions to review']],
      ['Notes Grid', 'grid'],
      ['Brain Dump', 'lined'],
    ]),
  }),
  digital({
    id: 'nurse-report-sheet',
    title: 'Nurse Report Pages',
    category: 'nurse-inserts',
    coverCaption: 'Nurse Report',
    summary: 'Example layout pages for keeping your shift notes tidy.',
    keywords: ['report', 'shift', 'sbar', 'handoff', 'brain sheet'],
    samplePages: pages('', [
      ['Nurse Report', 'table', ['Time', 'Notes', 'Follow up']],
      ['Shift Schedule', 'schedule'],
      ['To Do', 'checklist'],
    ]),
  }),
  digital({
    id: 'daily-brain-dump',
    title: 'Daily Brain Dump',
    category: 'nurse-inserts',
    coverCaption: 'Brain Dump',
    summary: 'Example planner pages for clearing your head before a busy day.',
    keywords: ['planner', 'brain dump', 'daily', 'organize', 'to do'],
    samplePages: pages('', [
      ['Brain Dump', 'lined'],
      ['Today', 'schedule'],
      ['Top 3', 'checklist'],
    ]),
  }),
  digital({
    id: 'np-assessment-pages',
    title: 'Assessment Pages',
    category: 'np-inserts',
    coverCaption: 'Assessment',
    summary: 'Example NP insert layout for organizing assessment notes.',
    keywords: ['assessment', 'np', 'nurse practitioner', 'clinical'],
    samplePages: pages('', [
      ['Assessment', 'checklist'],
      ['Assessment Notes', 'sections', ['Date', 'Focus', 'Notes', 'Questions to review']],
      ['Notes', 'lined'],
    ]),
  }),
  digital({
    id: 'np-care-plan-pages',
    title: 'Care Plan Pages',
    category: 'np-inserts',
    coverCaption: 'Care Plan',
    summary: 'Example NP insert layout with space to plan and review.',
    keywords: ['care plan', 'np', 'nurse practitioner', 'planning'],
    samplePages: pages('', [
      ['Care Plan', 'sections', ['Nursing Diagnosis', 'Interventions', 'Evaluation']],
      ['Planning Grid', 'grid'],
      ['Notes', 'lined'],
    ]),
  }),
  digital({
    id: 'np-clinical-rotation-log',
    title: 'Clinical Rotation Log',
    category: 'np-inserts',
    coverCaption: 'Clinical Log',
    summary: 'Example NP insert layout for tracking rotation days and reflections.',
    keywords: ['clinical', 'rotation', 'log', 'hours', 'np', 'preceptor'],
    samplePages: pages('', [
      ['Clinical Log', 'table', ['Date', 'Site', 'Notes']],
      ['Weekly Schedule', 'schedule'],
      ['Reflection', 'lined'],
    ]),
  }),

  physical({
    id: 'nurse-love-tee',
    title: 'Nurse Love Tee',
    category: 'apparel',
    summary: 'Example listing for a soft pink tee with the Nurse Love script.',
    keywords: ['shirt', 'tee', 't-shirt', 'apparel', 'clothing', 'pink'],
    gallery: [
      { kind: 'illustration', name: 'tee', alt: 'Illustration of a folded pink tee with Nurse Love script on a plain background.' },
    ],
  }),
  physical({
    id: 'nurse-love-crewneck',
    title: 'Nurse Love Crewneck',
    category: 'apparel',
    summary: 'Example listing for a cozy crewneck for off-duty days.',
    keywords: ['sweatshirt', 'crewneck', 'apparel', 'clothing', 'cozy'],
    gallery: [
      { kind: 'illustration', name: 'crewneck', alt: 'Illustration of a folded blush crewneck sweatshirt on a plain background.' },
    ],
  }),
  physical({
    id: 'heart-drop-earrings',
    title: 'Heart Drop Earrings',
    category: 'accessories',
    summary: 'Example listing for a simple pair of pink heart earrings.',
    keywords: ['earrings', 'jewelry', 'heart', 'accessories'],
    gallery: [
      { kind: 'illustration', name: 'earrings-drop', alt: 'Illustration of a pair of pink heart drop earrings with gold hoops on a plain background.' },
    ],
  }),
  physical({
    id: 'heart-stud-earrings',
    title: 'Heart Stud Earrings',
    category: 'accessories',
    summary: 'Example listing for tiny heart studs for every day.',
    keywords: ['earrings', 'studs', 'jewelry', 'heart', 'accessories'],
    gallery: [
      { kind: 'illustration', name: 'earrings-studs', alt: 'Illustration of a pair of small heart stud earrings on a plain background.' },
    ],
  }),
  physical({
    id: 'heart-badge-reel',
    title: 'Heart Badge Reel',
    category: 'accessories',
    summary: 'Example listing for a sweet badge reel for your work badge.',
    keywords: ['badge reel', 'badge', 'id', 'accessories', 'heart'],
    gallery: [
      { kind: 'illustration', name: 'badge-reel', alt: 'Illustration of a round pink badge reel with a heart on a plain background.' },
    ],
  }),
  physical({
    id: 'pretty-pen-pair',
    title: 'Pretty Pen Pair',
    category: 'pens',
    summary: 'Example listing for two pink pens with gold accents.',
    keywords: ['pens', 'pen', 'writing', 'stationery'],
    gallery: [
      { kind: 'illustration', name: 'pens-pair', alt: 'Illustration of two pink pens with gold clips on a plain background.' },
    ],
  }),
  physical({
    id: 'pretty-pen-trio',
    title: 'Pretty Pen Trio',
    category: 'pens',
    summary: 'Example listing for a trio of soft pink pens.',
    keywords: ['pens', 'pen', 'set', 'writing', 'stationery'],
    gallery: [
      { kind: 'illustration', name: 'pens-trio', alt: 'Illustration of three pink and ivory pens on a plain background.' },
    ],
  }),
]

export const freebies: Freebie[] = [
  {
    id: 'daily-planner-sample',
    title: 'Daily Planner Page',
    summary: 'A general planner page with a top 3, schedule and notes. Prototype sample.',
    page: { kind: 'illustration', title: 'Sample printable', layout: 'checklist' },
    downloadable: true,
    fileName: 'nurse-love-prototype-daily-planner-sample.pdf',
    isExample: true,
    keywords: ['planner', 'daily', 'free', 'printable', 'notes'],
  },
  {
    id: 'weekly-study-planner',
    title: 'Weekly Study Planner',
    summary: 'Example freebie listing. Preview only in this prototype.',
    page: { kind: 'illustration', title: 'Weekly Study', layout: 'schedule' },
    downloadable: false,
    fileName: null,
    isExample: true,
    keywords: ['weekly', 'study', 'planner', 'free'],
  },
  {
    id: 'notes-page',
    title: 'Simple Notes Page',
    summary: 'Example freebie listing. Preview only in this prototype.',
    page: { kind: 'illustration', title: 'Notes', layout: 'lined' },
    downloadable: false,
    fileName: null,
    isExample: true,
    keywords: ['notes', 'lined', 'free', 'printable'],
  },
]

export function getProduct(slug: string): Product | undefined {
  return products.find((p) => p.slug === slug)
}

export function productsIn(...ids: CategoryId[]): Product[] {
  return products.filter((p) => ids.includes(p.category))
}
