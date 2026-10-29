import placeholderVideo from '../assets/tutorials/placeholder.mp4'
import placeholderPoster from '../assets/tutorials/placeholder-poster.jpg'
import placeholderCaptions from '../assets/tutorials/placeholder.en.vtt?raw'
import type { CategoryId, Tutorial, TutorialCategory, TutorialCategoryId } from './types'

/*
  Public tutorials. Free to watch, no account needed.
  Every record below is an example that uses the same short placeholder video.
  Replace the video, captions, steps and transcript with the real tutorial
  content from Nurse Love Company before launch.
*/

export const tutorialCategories: TutorialCategory[] = [
  { id: 'np-binder', title: 'NP Binder' },
  { id: 'nurse-binder', title: 'Nurse Binder' },
  { id: 'printing-assembly', title: 'Printing & Assembly' },
  { id: 'digital-files', title: 'Using Your Digital Files' },
]

/** Show category filters once there are at least this many tutorials. */
export const MIN_TUTORIALS_FOR_FILTERS = 4

const placeholder = {
  durationSeconds: 18,
  video: { kind: 'file', src: placeholderVideo, type: 'video/mp4', poster: placeholderPoster },
  captions: [{ label: 'English', srclang: 'en', vtt: placeholderCaptions }],
  transcript: null,
  isExample: true,
  placeholderVideo: true,
  published: true,
} satisfies Partial<Tutorial>

const assemblySteps = (collection: string) => [
  `Choose the ${collection} you want to use and save the files somewhere easy to find.`,
  'Check each resource page for its confirmed format and printing details.',
  'Print the pages you need. Only print what helps you right now; you can always add more later.',
  'Hole punch the printed pages to match your own binder. A binder is not included with digital purchases.',
  'Arrange the sections in an order that works for you, then add tabs or dividers if you like.',
]

const allTutorials: Tutorial[] = [
  {
    ...placeholder,
    id: 'how-to-put-together-your-np-binder',
    slug: 'how-to-put-together-your-np-binder',
    title: 'How to Put Together Your NP Binder',
    category: 'np-binder',
    summary: 'A walkthrough of printing your NP Binder Inserts and arranging them in your own binder.',
    thumbnail: { kind: 'illustration', name: 'pages-np', alt: 'Illustrated NP insert pages' },
    steps: assemblySteps('NP Binder Inserts'),
    productCategories: ['np-inserts'],
    links: [
      { label: 'Browse NP Binder Inserts', route: 'np-binder-inserts' },
      { label: 'Try a free printable', route: 'freebie-corner' },
    ],
    featured: true,
    keywords: ['np', 'nurse practitioner', 'binder', 'assemble', 'setup', 'put together'],
  },
  {
    ...placeholder,
    id: 'how-to-put-together-your-nurse-binder',
    slug: 'how-to-put-together-your-nurse-binder',
    title: 'How to Put Together Your Nurse Binder',
    category: 'nurse-binder',
    summary: 'Set up your Nurse Binder Inserts in your own binder, one section at a time.',
    thumbnail: { kind: 'illustration', name: 'pages-nurse', alt: 'Illustrated nurse insert pages' },
    steps: assemblySteps('Nurse Binder Inserts'),
    productCategories: ['nurse-inserts'],
    links: [
      { label: 'Browse Nurse Binder Inserts', route: 'nurse-binder-inserts' },
      { label: 'Try a free printable', route: 'freebie-corner' },
    ],
    featured: false,
    keywords: ['nurse', 'binder', 'assemble', 'setup', 'put together', 'student'],
  },
  {
    ...placeholder,
    id: 'printing-your-inserts-at-home',
    slug: 'printing-your-inserts-at-home',
    title: 'Printing Your Inserts at Home',
    category: 'printing-assembly',
    summary: 'Tips for printing your inserts so they are ready for your binder.',
    thumbnail: { kind: 'illustration', name: 'printing', alt: 'An illustrated printable page' },
    steps: [
      'Open the file and check the resource page for its confirmed page size.',
      'Preview the pages in your print settings before printing.',
      'Print one test page first to check the margins and the look of the colors.',
      'Print the rest of the pages you need.',
      'Hole punch the pages to match your own binder. A binder is not included.',
    ],
    productCategories: ['nurse-inserts', 'np-inserts'],
    links: [{ label: 'Shop digital resources', route: 'shop' }],
    featured: false,
    keywords: ['print', 'printing', 'printer', 'paper', 'hole punch', 'assembly'],
  },
  {
    ...placeholder,
    id: 'using-your-digital-files',
    slug: 'using-your-digital-files',
    title: 'Using Your Digital Files',
    category: 'digital-files',
    summary: 'Find, open and organize your downloads on a computer or tablet.',
    thumbnail: { kind: 'illustration', name: 'tablet', alt: 'An illustrated tablet showing a planner page' },
    steps: [
      'Save your downloaded files in one folder so they are easy to find.',
      'Check each resource page to see how that resource can be used.',
      'Open the file in an app that supports its file type.',
      'Keep a backup copy of your files in case you change devices.',
    ],
    productCategories: ['nurse-inserts', 'np-inserts'],
    links: [{ label: 'Shop digital resources', route: 'shop' }],
    featured: false,
    keywords: ['digital', 'tablet', 'download', 'files', 'app', 'open'],
  },
  {
    ...placeholder,
    id: 'adding-new-inserts-to-your-np-binder',
    slug: 'adding-new-inserts-to-your-np-binder',
    title: 'Adding New Inserts to Your NP Binder',
    category: 'np-binder',
    summary: 'Keep your NP binder tidy as you add new inserts through your program.',
    thumbnail: { kind: 'illustration', name: 'pages-np', alt: 'Illustrated NP insert pages' },
    steps: [
      'Decide where the new section fits in your binder.',
      'Print and hole punch the new pages to match your own binder.',
      'Add a tab or divider so the new section is easy to find.',
      'Move pages you no longer need to a separate folder.',
    ],
    productCategories: ['np-inserts'],
    links: [{ label: 'Browse NP Binder Inserts', route: 'np-binder-inserts' }],
    featured: false,
    keywords: ['np', 'binder', 'organize', 'add', 'new inserts'],
  },
]

export const tutorials = allTutorials.filter((t) => t.published)

export function getTutorial(slug: string): Tutorial | undefined {
  return tutorials.find((t) => t.slug === slug)
}

export function getTutorialCategory(id: TutorialCategoryId): TutorialCategory {
  return tutorialCategories.find((c) => c.id === id) ?? { id, title: id }
}

export function featuredTutorial(): Tutorial | undefined {
  return tutorials.find((t) => t.featured) ?? tutorials[0]
}

/** The most relevant tutorial for a product category, for "Watch the tutorial" links. */
export function tutorialForProductCategory(category: CategoryId): Tutorial | undefined {
  const matches = tutorials.filter((t) => t.productCategories.includes(category))
  return matches.find((t) => t.steps.length && t.title.startsWith('How to')) ?? matches[0]
}

export function relatedTutorials(t: Tutorial, count = 3): Tutorial[] {
  const others = tutorials.filter((x) => x.id !== t.id)
  const same = others.filter((x) => x.category === t.category)
  const shared = others.filter((x) => x.category !== t.category && x.productCategories.some((c) => t.productCategories.includes(c)))
  const rest = others.filter((x) => !same.includes(x) && !shared.includes(x))
  return [...same, ...shared, ...rest].slice(0, count)
}

export function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.round(seconds % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

/** Plain caption lines from WebVTT text, used as a transcript fallback. */
export function captionText(vtt: string): string[] {
  return vtt
    .split(/\r?\n\r?\n/)
    .map((block) => block.split(/\r?\n/).filter((l) => l && !l.includes('-->') && l !== 'WEBVTT' && !/^\d+$/.test(l)).join(' '))
    .filter(Boolean)
}
