import { useState, useCallback } from 'react'
import { authApi } from '../api/client'

const TOKEN_KEY = 'ancestry_token'

export interface AuthState {
  token: string | null
  authEnabled: boolean | null
  login: (password: string) => Promise<void>
  logout: () => void
  setAuthEnabled: (v: boolean) => void
}

export function useAuthState(): AuthState {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(TOKEN_KEY))
  const [authEnabled, setAuthEnabled] = useState<boolean | null>(null)

  const login = useCallback(async (password: string) => {
    const data = await authApi.login(password)
    localStorage.setItem(TOKEN_KEY, data.access_token)
    setToken(data.access_token)
  }, [])

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY)
    setToken(null)
  }, [])

  return { token, authEnabled, login, logout, setAuthEnabled }
}
