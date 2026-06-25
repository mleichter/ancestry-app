import { useState, useCallback } from 'react'
import { authApi } from '../api/client'

export interface AuthState {
  authenticated: boolean | null
  authEnabled: boolean | null
  login: (password: string) => Promise<void>
  logout: () => Promise<void>
  setAuthStatus: (enabled: boolean, authenticated: boolean) => void
}

export function useAuthState(): AuthState {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null)
  const [authEnabled, setAuthEnabled] = useState<boolean | null>(null)

  const login = useCallback(async (password: string) => {
    await authApi.login(password)
    // Re-fetch status so authenticated flips to true from the cookie
    const status = await authApi.status()
    setAuthEnabled(status.auth_enabled)
    setAuthenticated(status.authenticated)
  }, [])

  const logout = useCallback(async () => {
    await authApi.logout()
    setAuthenticated(false)
  }, [])

  const setAuthStatus = useCallback((enabled: boolean, auth: boolean) => {
    setAuthEnabled(enabled)
    setAuthenticated(auth)
  }, [])

  return { authenticated, authEnabled, login, logout, setAuthStatus }
}
