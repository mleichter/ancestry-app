import { useState, useCallback } from 'react'

export interface AppSettings {
  anonymize_living: boolean
  ai_enabled: boolean
}

const KEY = 'ancestry_settings'
const DEFAULTS: AppSettings = { anonymize_living: false, ai_enabled: true }

function load(): AppSettings {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : DEFAULTS
  } catch {
    return DEFAULTS
  }
}

export function useSettings() {
  const [settings, setSettings] = useState<AppSettings>(load)

  const update = useCallback((patch: Partial<AppSettings>) => {
    setSettings(prev => {
      const next = { ...prev, ...patch }
      localStorage.setItem(KEY, JSON.stringify(next))
      return next
    })
  }, [])

  return { settings, update }
}
