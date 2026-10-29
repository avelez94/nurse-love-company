import { Heart } from './illustrations/Objects'

/* Temporary text wordmark until the real logo file is supplied. */
export function Wordmark({ size = 'md' }: { size?: 'md' | 'sm' }) {
  return (
    <span className={`wordmark wordmark--${size}`}>
      <span className="wordmark__main">
        Nurse Love
        <Heart className="wordmark__heart" strokeWidth={1.8} />
      </span>
      <span className="wordmark__sub">Company</span>
    </span>
  )
}
