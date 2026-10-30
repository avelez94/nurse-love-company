import { useState } from 'react'
import { dateTime, Empty, FormError, Loading, useApiData } from '../../components/ui'
import { PageTitle } from './AdminApp'

interface Entry {
  id: number
  actor_email: string
  action: string
  entity_type: string
  entity_id: string | null
  summary: string
  ip: string | null
  created_at: string
}

export function Audit() {
  const [search, setSearch] = useState('')
  const { data, error, loading } = useApiData<{ entries: Entry[] }>(`/api/admin/audit?search=${encodeURIComponent(search)}`)
  return (
    <>
      <PageTitle title="Audit log" />
      <p className="muted">A permanent record of important admin actions. Entries cannot be edited or deleted.</p>
      <div className="filters">
        <label className="field field--grow">
          <span className="field__label">Search</span>
          <input className="input" type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Action, person or description" />
        </label>
      </div>
      {error && <FormError message={error} />}
      {loading && !data ? (
        <Loading />
      ) : !data?.entries.length ? (
        <Empty title="No entries" />
      ) : (
        <div className="data-table-wrap">
          <table className="data-table">
            <thead><tr><th>When</th><th>Who</th><th>What happened</th><th>Action</th></tr></thead>
            <tbody>
              {data.entries.map((e) => (
                <tr key={e.id}>
                  <td>{dateTime(e.created_at)}</td>
                  <td>{e.actor_email}</td>
                  <td>{e.summary}</td>
                  <td className="muted">{e.action}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}
