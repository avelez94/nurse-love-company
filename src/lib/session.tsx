import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api } from './api'

/*
  Signed in state. Accounts are handled by the server (Better Auth): passwords
  never touch anything except its endpoints, and the session lives in an
  httpOnly cookie the page cannot read.
*/

export interface SessionUser {
  id: string
  name: string
  email: string
  role: 'customer' | 'admin'
}

interface SessionValue {
  user: SessionUser | null
  loading: boolean
  refresh: () => Promise<void>
  signIn: (email: string, password: string) => Promise<void>
  signUp: (name: string, email: string, password: string) => Promise<void>
  signOut: () => Promise<void>
}

const Ctx = createContext<SessionValue | null>(null)

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    try {
      const s = await api<{ user?: { id: string; name: string; email: string; role?: string } } | null>('/api/auth/get-session')
      const u = s?.user
      setUser(u ? { id: u.id, name: u.name, email: u.email, role: u.role === 'admin' ? 'admin' : 'customer' } : null)
    } catch {
      setUser(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const value = useMemo<SessionValue>(
    () => ({
      user,
      loading,
      refresh,
      signIn: async (email, password) => {
        await api('/api/auth/sign-in/email', { body: { email, password } })
        await refresh()
      },
      signUp: async (name, email, password) => {
        await api('/api/auth/sign-up/email', { body: { name, email, password } })
        await refresh()
      },
      signOut: async () => {
        await api('/api/auth/sign-out', { body: {} })
        setUser(null)
      },
    }),
    [user, loading, refresh],
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useSession() {
  const v = useContext(Ctx)
  if (!v) throw new Error('useSession must be inside SessionProvider')
  return v
}
