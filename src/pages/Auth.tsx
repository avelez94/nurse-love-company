import { useState, type FormEvent } from 'react'
import { api, errorMessage } from '../lib/api'
import { href, navigate } from '../lib/router'
import { useSession } from '../lib/session'
import { FormError, Notice, TextInput } from '../components/ui'
import { Heart } from '../components/illustrations/Objects'
import './Auth.css'

/** Where to go after signing in (set before sending someone to sign in). */
export function rememberReturn(route: string) {
  try {
    sessionStorage.setItem('nlc-return', route)
  } catch {
    /* ignore */
  }
}
function takeReturn(fallback: string) {
  try {
    const r = sessionStorage.getItem('nlc-return')
    sessionStorage.removeItem('nlc-return')
    return r || fallback
  } catch {
    return fallback
  }
}

function AuthCard({ title, intro, children }: { title: string; intro?: string; children: React.ReactNode }) {
  return (
    <section className="auth container">
      <div className="auth__card">
        <Heart className="auth__heart" />
        <h1 className="auth__title">{title}</h1>
        {intro && <p className="auth__intro">{intro}</p>}
        {children}
      </div>
    </section>
  )
}

export function SignIn() {
  const { signIn } = useSession()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await signIn(email, password)
      const me = await api<{ user: { role: string } }>('/api/account/me')
      navigate(takeReturn(me.user.role === 'admin' ? 'admin' : 'account'))
    } catch (err) {
      setError(errorMessage(err) === 'Invalid email or password' ? 'That email and password do not match an account.' : errorMessage(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <AuthCard title="Welcome back" intro="Sign in to see your orders and downloads.">
      <form className="form-stack" onSubmit={submit} noValidate>
        <TextInput label="Email" type="email" value={email} onChange={setEmail} autoComplete="email" required />
        <TextInput label="Password" type="password" value={password} onChange={setPassword} autoComplete="current-password" required />
        <FormError message={error} />
        <button type="submit" className="button" disabled={busy || !email || !password}>
          {busy ? 'Signing in...' : 'Sign in'}
        </button>
      </form>
      <p className="auth__links">
        <a href={href('forgot-password')}>Forgot your password?</a>
        <span>
          New here? <a href={href('sign-up')}>Create an account</a>
        </span>
      </p>
    </AuthCard>
  )
}

export function SignUp() {
  const { signUp } = useSession()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (password.length < 10) return setError('Please choose a password with at least 10 characters.')
    setBusy(true)
    setError('')
    try {
      await signUp(name, email, password)
      navigate(takeReturn('account'))
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <AuthCard title="Create your account" intro="Your account keeps your orders, receipts and downloads in one place.">
      <form className="form-stack" onSubmit={submit} noValidate>
        <TextInput label="Name" value={name} onChange={setName} autoComplete="name" required maxLength={100} />
        <TextInput label="Email" type="email" value={email} onChange={setEmail} autoComplete="email" required />
        <TextInput label="Password" type="password" value={password} onChange={setPassword} autoComplete="new-password" required hint="At least 10 characters." />
        <FormError message={error} />
        <button type="submit" className="button" disabled={busy || !name || !email || !password}>
          {busy ? 'Creating account...' : 'Create account'}
        </button>
      </form>
      <p className="auth__links">
        <span>
          Already have an account? <a href={href('sign-in')}>Sign in</a>
        </span>
      </p>
    </AuthCard>
  )
}

export function ForgotPassword() {
  const [email, setEmail] = useState('')
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await api('/api/auth/request-password-reset', { body: { email, redirectTo: `${window.location.origin}/#reset-password` } })
      setDone(true)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <AuthCard title="Reset your password" intro="Enter your account email and we will send you a link to choose a new password.">
      {done ? (
        <Notice tone="success">If an account exists for that email, a reset link is on its way. The link expires in one hour.</Notice>
      ) : (
        <form className="form-stack" onSubmit={submit} noValidate>
          <TextInput label="Email" type="email" value={email} onChange={setEmail} autoComplete="email" required />
          <FormError message={error} />
          <button type="submit" className="button" disabled={busy || !email}>
            {busy ? 'Sending...' : 'Send reset link'}
          </button>
        </form>
      )}
      <p className="auth__links">
        <a href={href('sign-in')}>Back to sign in</a>
      </p>
    </AuthCard>
  )
}

export function ResetPassword({ token }: { token?: string }) {
  const [password, setPassword] = useState('')
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (password.length < 10) return setError('Please choose a password with at least 10 characters.')
    setBusy(true)
    setError('')
    try {
      await api('/api/auth/reset-password', { body: { newPassword: password, token } })
      setDone(true)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }
  if (!token) return <AuthCard title="Reset link not valid" intro="This reset link is missing its code. Please request a new link."><a className="button" href={href('forgot-password')}>Request a new link</a></AuthCard>
  return (
    <AuthCard title="Choose a new password">
      {done ? (
        <>
          <Notice tone="success">Your password has been changed. For your security, you have been signed out of other devices.</Notice>
          <a className="button" href={href('sign-in')}>Sign in</a>
        </>
      ) : (
        <form className="form-stack" onSubmit={submit} noValidate>
          <TextInput label="New password" type="password" value={password} onChange={setPassword} autoComplete="new-password" hint="At least 10 characters." required />
          <FormError message={error} />
          <button type="submit" className="button" disabled={busy || !password}>
            {busy ? 'Saving...' : 'Save new password'}
          </button>
        </form>
      )}
    </AuthCard>
  )
}

/**
 * First admin setup. Needs a signed in account and the one time setup code
 * (ADMIN_BOOTSTRAP_TOKEN on the server). Stops working once an admin exists.
 */
export function AdminSetup() {
  const { user, loading, refresh } = useSession()
  const [token, setToken] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  if (loading) return null
  if (!user) {
    return (
      <AuthCard title="Store admin setup" intro="First create your own account (or sign in), then come back to this page.">
        <div className="button-row">
          <a className="button button--small" href={href('sign-up')} onClick={() => rememberReturn('admin-setup')}>Create account</a>
          <a className="button button--outline button--small" href={href('sign-in')} onClick={() => rememberReturn('admin-setup')}>Sign in</a>
        </div>
      </AuthCard>
    )
  }
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await api('/api/admin-bootstrap', { body: { token } })
      await refresh()
      navigate('admin')
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <AuthCard title="Store admin setup" intro={`Signed in as ${user.email}. Enter the one time setup code to make this account the store's first admin.`}>
      <form className="form-stack" onSubmit={submit}>
        <TextInput label="Setup code" type="password" value={token} onChange={setToken} autoComplete="off" required />
        <FormError message={error} />
        <button type="submit" className="button" disabled={busy || !token}>{busy ? 'Checking...' : 'Make me the admin'}</button>
      </form>
      <p className="muted">This only works while the store has no admin. Afterwards, admins add other admins in Settings.</p>
    </AuthCard>
  )
}
