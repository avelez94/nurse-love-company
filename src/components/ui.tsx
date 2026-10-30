import { Eye, EyeOff } from 'lucide-react'
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { api, errorMessage } from '../lib/api'
import { formatPrice } from '../lib/format'
import { Dialog } from './Dialog'
import './ui.css'

/* Shared form and data display pieces for the account and admin areas. */

export function Field({ label, hint, error, children, id }: { label: string; hint?: ReactNode; error?: string; children: (id: string, describedBy?: string) => ReactNode; id?: string }) {
  const auto = useId()
  const fid = id ?? auto
  const hintId = hint ? `${fid}-hint` : undefined
  const errId = error ? `${fid}-err` : undefined
  return (
    <div className={`field ${error ? 'field--error' : ''}`}>
      <label htmlFor={fid} className="field__label">
        {label}
      </label>
      {children(fid, [hintId, errId].filter(Boolean).join(' ') || undefined)}
      {hint && (
        <p id={hintId} className="field__hint">
          {hint}
        </p>
      )}
      {error && (
        <p id={errId} className="field__error">
          {error}
        </p>
      )}
    </div>
  )
}

export function TextInput(props: { label: string; value: string; onChange: (v: string) => void; type?: string; hint?: ReactNode; required?: boolean; autoComplete?: string; placeholder?: string; maxLength?: number; id?: string; disabled?: boolean }) {
  return (
    <Field label={props.label} hint={props.hint} id={props.id}>
      {(id, d) => (
        <input
          id={id}
          className="input"
          type={props.type ?? 'text'}
          value={props.value}
          onChange={(e) => props.onChange(e.target.value)}
          required={props.required}
          autoComplete={props.autoComplete}
          placeholder={props.placeholder}
          maxLength={props.maxLength}
          aria-describedby={d}
          disabled={props.disabled}
        />
      )}
    </Field>
  )
}

/** Password field with a button to show or hide what was typed. */
export function PasswordInput(props: { label: string; value: string; onChange: (v: string) => void; hint?: ReactNode; error?: string; required?: boolean; autoComplete?: string; id?: string }) {
  const [visible, setVisible] = useState(false)
  return (
    <Field label={props.label} hint={props.hint} error={props.error} id={props.id}>
      {(id, d) => (
        <div className="password-field">
          <input
            id={id}
            className="input"
            type={visible ? 'text' : 'password'}
            value={props.value}
            onChange={(e) => props.onChange(e.target.value)}
            required={props.required}
            autoComplete={props.autoComplete}
            aria-describedby={d}
            aria-invalid={props.error ? true : undefined}
            spellCheck={false}
            autoCapitalize="none"
          />
          <button type="button" className="password-field__toggle" onClick={() => setVisible((v) => !v)} aria-label={visible ? `Hide ${props.label.toLowerCase()}` : `Show ${props.label.toLowerCase()}`} aria-pressed={visible} aria-controls={id}>
            {visible ? <EyeOff size={20} aria-hidden="true" /> : <Eye size={20} aria-hidden="true" />}
          </button>
        </div>
      )}
    </Field>
  )
}

export function TextArea(props: { label: string; value: string; onChange: (v: string) => void; rows?: number; hint?: ReactNode; maxLength?: number; required?: boolean; id?: string }) {
  return (
    <Field label={props.label} hint={props.hint} id={props.id}>
      {(id, d) => <textarea id={id} className="input" rows={props.rows ?? 4} value={props.value} onChange={(e) => props.onChange(e.target.value)} maxLength={props.maxLength} required={props.required} aria-describedby={d} />}
    </Field>
  )
}

export function Select<T extends string>(props: { label: string; value: T; onChange: (v: T) => void; options: Array<{ value: T; label: string }>; hint?: ReactNode; id?: string }) {
  return (
    <Field label={props.label} hint={props.hint} id={props.id}>
      {(id, d) => (
        <select id={id} className="input" value={props.value} onChange={(e) => props.onChange(e.target.value as T)} aria-describedby={d}>
          {props.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      )}
    </Field>
  )
}

export function Checkbox({ label, checked, onChange, hint }: { label: ReactNode; checked: boolean; onChange: (v: boolean) => void; hint?: ReactNode }) {
  const id = useId()
  return (
    <div className="checkbox">
      <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <label htmlFor={id}>
        {label}
        {hint && <span className="checkbox__hint">{hint}</span>}
      </label>
    </div>
  )
}

/** Dollar input that stores whole cents. Empty means "not set". */
export function MoneyInput({ label, cents, onChange, hint }: { label: string; cents: number | null; onChange: (c: number | null) => void; hint?: ReactNode }) {
  const [text, setText] = useState(cents === null ? '' : (cents / 100).toFixed(2))
  useEffect(() => {
    setText((t) => {
      const parsed = t.trim() === '' ? null : Math.round(Number(t) * 100)
      return parsed === cents ? t : cents === null ? '' : (cents / 100).toFixed(2)
    })
  }, [cents])
  return (
    <Field label={label} hint={hint}>
      {(id, d) => (
        <div className="money">
          <span aria-hidden="true">$</span>
          <input
            id={id}
            className="input"
            inputMode="decimal"
            value={text}
            aria-describedby={d}
            onChange={(e) => {
              const v = e.target.value.replace(/[^0-9.]/g, '')
              setText(v)
              if (v.trim() === '') onChange(null)
              else if (!Number.isNaN(Number(v))) onChange(Math.round(Number(v) * 100))
            }}
          />
        </div>
      )}
    </Field>
  )
}

export function FormError({ message }: { message: string }) {
  if (!message) return null
  return (
    <p className="form-error" role="alert">
      {message}
    </p>
  )
}

export function Notice({ tone = 'info', children }: { tone?: 'info' | 'warn' | 'success'; children: ReactNode }) {
  return <div className={`ui-notice ui-notice--${tone}`}>{children}</div>
}

export function Loading({ label = 'Loading...' }: { label?: string }) {
  return (
    <p className="ui-loading" role="status">
      <span className="ui-spinner" aria-hidden="true" />
      {label}
    </p>
  )
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty-state">
      <p className="empty-state__title">{title}</p>
      {children}
    </div>
  )
}

const pillTone: Record<string, string> = {
  paid: 'good', fulfilled: 'good', delivered: 'good', sent: 'good', ready: 'good', published: 'good', active: 'good', succeeded: 'good', available: 'good', resolved: 'good',
  pending: 'wait', unfulfilled: 'wait', partially_fulfilled: 'wait', queued: 'wait', sending: 'wait', processing: 'wait', uploading: 'wait', draft: 'wait', open: 'wait', delivery_delayed: 'wait', shipped: 'wait', in_transit: 'wait', label_created: 'wait', unpublished: 'wait',
  failed: 'bad', bounced: 'bad', complained: 'bad', disputed: 'bad', errored: 'bad', canceled: 'muted', refunded: 'muted', partially_refunded: 'muted', archived: 'muted', inactive: 'muted', not_required: 'muted', not_configured: 'muted', suppressed: 'bad', redeemed: 'muted', superseded: 'muted', revoked: 'bad', declined: 'muted', exception: 'bad', none: 'muted',
}

export function Pill({ value, label }: { value: string; label?: string }) {
  return <span className={`pill pill--${pillTone[value] ?? 'muted'}`}>{label ?? value.replace(/_/g, ' ')}</span>
}

export const money = (c: number | null | undefined) => (c === null || c === undefined ? 'Not available' : formatPrice(c))
export const dateTime = (d: string | null | undefined) => (d ? new Date(d).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '')
export const dateOnly = (d: string | null | undefined) => (d ? new Date(d).toLocaleDateString(undefined, { dateStyle: 'medium' }) : '')

/** Loads JSON from the API, with loading and error state and a reload function. */
export function useApiData<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(Boolean(path))
  const seq = useRef(0)
  const reload = useCallback(async () => {
    if (!path) return
    const n = ++seq.current
    setLoading(true)
    try {
      const d = await api<T>(path)
      if (n === seq.current) {
        setData(d)
        setError('')
      }
    } catch (err) {
      if (n === seq.current) setError(errorMessage(err))
    } finally {
      if (n === seq.current) setLoading(false)
    }
  }, [path])
  useEffect(() => {
    void reload()
  }, [reload])
  return { data, error, loading, reload, setData }
}

/** Confirmation dialog for actions that matter. */
export function Confirm({ open, title, children, confirmLabel, onConfirm, onClose, busy, danger, disabled }: { open: boolean; title: string; children: ReactNode; confirmLabel: string; onConfirm: () => void; onClose: () => void; busy?: boolean; danger?: boolean; disabled?: boolean }) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <div className="confirm__actions">
          <button type="button" className="button button--outline button--small" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className={`button button--small ${danger ? 'button--danger' : ''}`} onClick={onConfirm} disabled={busy || disabled}>
            {busy ? 'Working...' : confirmLabel}
          </button>
        </div>
      }
    >
      <div className="confirm__body">{children}</div>
    </Dialog>
  )
}

export function ProgressBar({ value, label }: { value: number; label: string }) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100)
  return (
    <div className="progress">
      <div className="progress__track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={label}>
        <div className="progress__bar" style={{ width: `${pct}%` }} />
      </div>
      <span className="progress__label">
        {label} {pct}%
      </span>
    </div>
  )
}
