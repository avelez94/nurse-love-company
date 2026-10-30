import { q, type Queryable } from '../db/pool.js'
import type { SessionUser } from '../auth.js'

export interface AuditInput {
  actor: SessionUser | null
  action: string
  entityType: string
  entityId?: string | null
  summary: string
  data?: Record<string, unknown>
  ip?: string | null
}

/** Append only audit history of important admin actions. */
export async function audit(input: AuditInput, client?: Queryable) {
  await q(
    `insert into audit_log (actor_id, actor_email, action, entity_type, entity_id, summary, data, ip) values ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [input.actor?.id ?? null, input.actor?.email ?? 'system', input.action, input.entityType, input.entityId ?? null, input.summary, JSON.stringify(input.data ?? {}), input.ip ?? null],
    client,
  )
}
