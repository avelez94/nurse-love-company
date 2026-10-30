import { useEffect, useState } from 'react'
import type { PublicFaq } from '../../shared/faq'

/** The published Help & FAQs, or null before the owner publishes (or if the store server is unavailable). */
export function usePublishedHelp() {
  const [state, setState] = useState<{ loading: boolean; help: PublicFaq | null }>({ loading: true, help: null })
  useEffect(() => {
    let alive = true
    fetch('/api/content/help', { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => alive && setState({ loading: false, help: (d?.help as PublicFaq | null) ?? null }))
      .catch(() => alive && setState({ loading: false, help: null }))
    return () => {
      alive = false
    }
  }, [])
  return state
}
