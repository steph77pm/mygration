import { useEffect, useState } from 'react'

/**
 * useState that persists to localStorage under `key`.
 *
 * Used to remember per-device UI preferences like which buckets the user has
 * collapsed, so opening the app from the same device reflects their last layout.
 */
export function usePersistedState(key, initialValue) {
  const [value, setValue] = useState(() => {
    if (typeof window === 'undefined') return initialValue
    try {
      const raw = window.localStorage.getItem(key)
      return raw != null ? JSON.parse(raw) : initialValue
    } catch {
      return initialValue
    }
  })

  useEffect(() => {
    try {
      window.localStorage.setItem(key, JSON.stringify(value))
    } catch {
      // quota exceeded or private mode — silently ignore, state still lives in memory
    }
  }, [key, value])

  return [value, setValue]
}
