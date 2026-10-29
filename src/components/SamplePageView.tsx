import type { SamplePage } from '../data/types'
import { InsertPage } from './illustrations/InsertPage'

export function SamplePageView({ page, className, label }: { page: SamplePage; className?: string; label?: string }) {
  if (page.kind === 'photo') {
    return <img className={className} src={page.src} alt={page.alt} width={page.width} height={page.height} loading="lazy" decoding="async" />
  }
  return (
    <InsertPage
      className={className}
      title={page.title}
      layout={page.layout}
      fields={page.fields}
      script={page.title === 'Sample printable'}
      heart={page.title === 'Sample printable'}
      sampleTag
      label={label ?? `Illustrative sample layout: ${page.title}`}
    />
  )
}
