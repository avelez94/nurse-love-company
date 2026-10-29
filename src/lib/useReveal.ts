import { useEffect, useRef } from 'react'

/*
  Section entrance that runs once. Content is visible by default; the hidden
  start state is only applied once JavaScript confirms the element is below
  the fold, so nothing stays invisible if scripts or observers fail.
*/
export function useReveal<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  useEffect(() => {
    const el = ref.current
    if (!el || !('IntersectionObserver' in window)) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const rect = el.getBoundingClientRect()
    if (rect.top < window.innerHeight * 0.9) return
    el.dataset.reveal = 'pending'
    const io = new IntersectionObserver(
      (items) => {
        for (const item of items) {
          if (item.isIntersecting) {
            el.dataset.reveal = 'shown'
            io.disconnect()
          }
        }
      },
      { rootMargin: '0px 0px -10% 0px', threshold: 0.12 },
    )
    io.observe(el)
    // Safety net: never leave content hidden.
    const t = window.setTimeout(() => {
      if (el.dataset.reveal === 'pending' && el.getBoundingClientRect().top < window.innerHeight) el.dataset.reveal = 'shown'
    }, 4000)
    return () => {
      io.disconnect()
      window.clearTimeout(t)
    }
  }, [])
  return ref
}
