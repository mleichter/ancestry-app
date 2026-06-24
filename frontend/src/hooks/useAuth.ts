import { useState, useCallback } from 'react'
import axios from 'axios'

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
    const res = await axios.post<{ access_token: string; token_type: string }>(
      '/api/v1/auth/login',
      { password },
    )
    localStorage.setItem(TOKEN_KEY, res.data.access_token)
    setToken(res.data.access_token)
  }, [])

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY)
    setToken(null)
  }, [])

  return { token, authEnabled, login, logout, setAuthEnabled }
}
