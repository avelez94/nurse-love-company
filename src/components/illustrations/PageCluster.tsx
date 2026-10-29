import type { SamplePage } from '../../data/types'
import { InsertPage } from './InsertPage'

/* A few loose insert pages laid side by side, used on cards and covers. */
export function PageCluster({ variant, caption, pages }: { variant: 'nurse' | 'np'; caption?: string; pages?: SamplePage[] }) {
  const drawn = pages?.filter((p) => p.kind === 'illustration')
  if (drawn && drawn.length > 0) {
    return (
      <div className={`page-cluster page-cluster--${drawn.length >= 3 ? 'three' : 'two'}`}>
        {drawn.slice(0, 3).map((p, i) =>
          p.kind === 'illustration' ? (
            <InsertPage key={p.title + i} className={`page-cluster__page p${i + 1}`} title={p.title} layout={p.layout} fields={p.fields} heart={i === drawn.length - 1} />
          ) : null,
        )}
      </div>
    )
  }
  if (variant === 'np') {
    return (
      <div className="page-cluster page-cluster--two">
        <InsertPage className="page-cluster__page p1" title={caption ?? 'Assessment'} layout="checklist" />
        <InsertPage className="page-cluster__page p2" title="Care Plan" layout="sections" fields={['Nursing Diagnosis', 'Interventions', 'Evaluation']} />
      </div>
    )
  }
  return (
    <div className="page-cluster page-cluster--three">
      <InsertPage className="page-cluster__page p1" title={caption ?? 'Nurse Report'} layout="table" fields={['Time', 'Notes', 'Follow up']} />
      <InsertPage className="page-cluster__page p2" title="Medication" subtitle="Tracker" layout="table" fields={['Med', 'Dose', 'Time']} />
      <InsertPage className="page-cluster__page p3" title="Clinical Notes" layout="lined" heart />
    </div>
  )
}
