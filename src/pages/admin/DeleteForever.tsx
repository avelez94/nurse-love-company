import { Trash2 } from 'lucide-react'
import { useState } from 'react'
import { api, errorMessage } from '../../lib/api'
import { navigate } from '../../lib/router'
import { useUI } from '../../lib/ui'
import { Checkbox, Confirm, FormError } from '../../components/ui'

/**
  The "Delete forever" button (it replaced Archive). It always warns first
  that this is permanent, and the owner must tick a box before it can run.
*/
export function DeleteForever({ what, name, endpoint, backTo, extra }: { what: string; name: string; endpoint: string; backTo: string; extra?: string }) {
  const [open, setOpen] = useState(false)
  const [sure, setSure] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const { showToast } = useUI()
  const close = () => {
    setOpen(false)
    setSure(false)
    setError('')
  }
  const run = async () => {
    setBusy(true)
    setError('')
    try {
      await api(endpoint, { method: 'DELETE' })
      showToast(`Deleted "${name}" forever.`)
      close()
      navigate(backTo)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <button type="button" className="button button--outline button--small button--danger-outline" onClick={() => setOpen(true)}>
        <Trash2 size={16} aria-hidden="true" /> Delete forever
      </button>
      <Confirm open={open} title={`Delete this ${what} forever?`} confirmLabel="Delete forever" danger busy={busy} disabled={!sure} onClose={close} onConfirm={() => void run()}>
        <p>
          <strong>This is permanent and cannot be undone.</strong> "{name}" will be deleted for good{extra ? `, ${extra}` : ''}. There is no archive and no way to bring it back.
        </p>
        <Checkbox label={`I understand this ${what} will be gone forever`} checked={sure} onChange={setSure} />
        <FormError message={error} />
      </Confirm>
    </>
  )
}
