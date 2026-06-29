import { createContext, useEffect, useRef, useState } from 'react'
import { login as cognitoLogin, logout as cognitoLogout, refreshSession } from './CognitoAuth'

interface Tokens {
  idToken: string
  accessToken: string
  refreshToken: string
  expiresAt: number
}

interface AuthContextValue {
  status: 'loading' | 'authed' | 'anon'
  isAuthed: boolean
  idToken: string | null
  login: (email: string, password: string) => Promise<Tokens>
  logout: () => void
}

export const AuthContext = createContext<AuthContextValue | null>(null)

const REFRESH_MARGIN_MS = 5 * 60 * 1000

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [tokens, setTokens] = useState<Tokens | null>(null)
  const [status, setStatus] = useState<'loading' | 'authed' | 'anon'>('loading')
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  function scheduleRefresh(expiresAt: number) {
    if (refreshTimer.current) clearTimeout(refreshTimer.current)
    const delay = Math.max(expiresAt - Date.now() - REFRESH_MARGIN_MS, 0)
    refreshTimer.current = setTimeout(async () => {
      const fresh = await refreshSession()
      if (fresh) {
        setTokens(fresh)
        scheduleRefresh(fresh.expiresAt)
      } else {
        setTokens(null)
        setStatus('anon')
      }
    }, delay)
  }

  useEffect(() => {
    ;(async () => {
      const restored = await refreshSession()
      if (restored) {
        setTokens(restored)
        setStatus('authed')
        scheduleRefresh(restored.expiresAt)
      } else {
        setStatus('anon')
      }
    })()
    return () => { if (refreshTimer.current) clearTimeout(refreshTimer.current) }
  }, [])

  async function handleLogin(email: string, password: string): Promise<Tokens> {
    const fresh = await cognitoLogin(email, password)
    setTokens(fresh)
    setStatus('authed')
    scheduleRefresh(fresh.expiresAt)
    return fresh
  }

  function handleLogout() {
    if (refreshTimer.current) clearTimeout(refreshTimer.current)
    cognitoLogout()
    setTokens(null)
    setStatus('anon')
  }

  const value: AuthContextValue = {
    status,
    isAuthed: status === 'authed',
    idToken: tokens?.idToken ?? null,
    login: handleLogin,
    logout: handleLogout,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
