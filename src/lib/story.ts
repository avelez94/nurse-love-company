import { useEffect, useState } from 'react'
import type { StoryFeature } from '../../shared/story'

/** The published Our Story content. Null until the owner publishes it (or if the store server is unavailable). */
export interface PublicStory {
  founderName: string
  professionalTitle: string
  credentials: string
  portraitUrl: string | null
  portraitAlt: string
  greeting: string
  introduction: string
  storeHeading: string
  storeIntro: string
  features: StoryFeature[]
  shopLabel: string
  shopLink: string
  closingNote: string
  signature: string
  /** Favorites still for sale, in her order. Empty when the section is off. */
  favoriteIds: string[]
  showFullStory: boolean
  background: string
  whyCreated: string
  process: string
  whoWeSupport: string
  closing: string
  nurseKinText: string
  nurseKinUrl: string
  homeExcerpt: string
}

let cache: Promise<PublicStory | null> | null = null
const load = () =>
  (cache ??= fetch('/api/content/our-story', { credentials: 'same-origin' })
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => (d?.story as PublicStory | null) ?? null)
    .catch(() => null))

export function usePublishedStory() {
  const [state, setState] = useState<{ loading: boolean; story: PublicStory | null }>({ loading: true, story: null })
  useEffect(() => {
    let alive = true
    void load().then((story) => alive && setState({ loading: false, story }))
    return () => {
      alive = false
    }
  }, [])
  return state
}

/** Splits owner text into paragraphs on blank lines. */
export const paragraphs = (text: string) => text.split(/\n{2,}/).map((t) => t.trim()).filter(Boolean)
