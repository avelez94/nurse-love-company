import { useEffect, useState } from 'react'
import { href } from '../lib/router'
import { parsePolicyBody, POLICY_META, type Inline, type PolicyKey, type PublishedPolicy } from '../../shared/policies'
import { PageHeader } from './PageHeader'
import './Policy.css'

/*
  Terms & Conditions and Privacy Policy. Visitors see only what the owner
  published, with its date; until then the page says it is being prepared.
*/

export function usePublishedPolicy(key: PolicyKey) {
  const [state, setState] = useState<{ loading: boolean; policy: PublishedPolicy | null }>({ loading: true, policy: null })
  useEffect(() => {
    let alive = true
    setState({ loading: true, policy: null })
    fetch(`/api/content/policies/${key}`, { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => alive && setState({ loading: false, policy: (d?.policy as PublishedPolicy | null) ?? null }))
      .catch(() => alive && setState({ loading: false, policy: null }))
    return () => {
      alive = false
    }
  }, [key])
  return state
}

const longDate = (iso: string) => new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })

function Parts({ parts }: { parts: Inline[] }) {
  return (
    <>
      {parts.map((p, i) =>
        p.type === 'text' ? (
          <span key={i}>{p.text}</span>
        ) : p.href.startsWith('#') ? (
          <a key={i} href={p.href}>
            {p.label}
          </a>
        ) : (
          <a key={i} href={p.href} target="_blank" rel="noopener noreferrer">
            {p.label}
            <span className="visually-hidden"> (opens in a new tab)</span>
          </a>
        ),
      )}
    </>
  )
}

/** The policy body. Exported so the admin preview matches the public page. */
export function PolicyView({ policy }: { policy: PublishedPolicy }) {
  return (
    <article className="policy">
      <p className="policy__updated">Last updated {longDate(policy.lastUpdated)}</p>
      {policy.intro && <p className="policy__intro">{policy.intro}</p>}
      {policy.sections.length > 2 && (
        <nav className="policy__toc" aria-label="On this page">
          <p className="policy__toc-title">On this page</p>
          <ol>
            {policy.sections.map((s) => (
              <li key={s.id}>
                <a
                  href={`#policy-${s.id}`}
                  onClick={(e) => {
                    // Hash routes drive the site, so jump within the page instead of changing the address.
                    e.preventDefault()
                    document.getElementById(`policy-${s.id}`)?.scrollIntoView({ block: 'start' })
                    document.getElementById(`policy-${s.id}`)?.focus({ preventScroll: true })
                  }}
                >
                  {s.heading}
                </a>
              </li>
            ))}
          </ol>
        </nav>
      )}
      {policy.sections.map((s) => (
        <section key={s.id} className="policy__section" aria-labelledby={`policy-${s.id}`}>
          <h2 id={`policy-${s.id}`} className="policy__heading" tabIndex={-1}>
            {s.heading}
          </h2>
          {parsePolicyBody(s.body).map((b, i) =>
            b.type === 'p' ? (
              <p key={i}>
                <Parts parts={b.parts} />
              </p>
            ) : (
              <ul key={i}>
                {b.items.map((item, j) => (
                  <li key={j}>
                    <Parts parts={item} />
                  </li>
                ))}
              </ul>
            ),
          )}
        </section>
      ))}
    </article>
  )
}

export function PolicyPage({ policyKey }: { policyKey: PolicyKey }) {
  const { loading, policy } = usePublishedPolicy(policyKey)
  const { title } = POLICY_META[policyKey]
  return (
    <>
      <PageHeader title={title} crumbs={[{ label: 'Home', route: 'home' }, { label: title }]} />
      <section className="container policy-page">
        {loading ? (
          <p className="muted">Loading...</p>
        ) : policy ? (
          <PolicyView policy={policy} />
        ) : (
          <div className="story__card">
            <p>Our {title} is being prepared and will appear here soon.</p>
            <p>
              Have a question in the meantime? Visit <a href={href('help')}>Help & contact</a>.
            </p>
          </div>
        )}
      </section>
    </>
  )
}
