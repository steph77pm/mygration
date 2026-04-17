import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { api, loadLocations } from '../api.js'

/**
 * Central store for locations data + CRUD modal state.
 *
 * Owns:
 *   - the fetched locations object ({ active, watching, future_planning })
 *   - which, if any, form modal is open (add/edit × parent/child)
 *   - delete actions (with confirm())
 *
 * Any component can grab what it needs via useLocationsStore(). This keeps
 * LocationBucket / ParentAreaCard / ChildLocationRow free of prop drilling.
 */
const LocationsStoreContext = createContext(null)

export function LocationsStoreProvider({ children }) {
  const [locations, setLocations] = useState(null)
  const [error, setError] = useState(null)
  const [modalState, setModalState] = useState(null) // null or { mode, ... }

  const refresh = useCallback(async () => {
    try {
      const data = await loadLocations()
      setLocations(data)
      setError(null)
    } catch (e) {
      setError(e.message)
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  // --- Modal openers (a form modal reads this to decide what to render) ---
  const openAddParent = useCallback((bucket) => {
    setModalState({ mode: 'add-parent', bucket })
  }, [])
  const openEditParent = useCallback((area) => {
    setModalState({ mode: 'edit-parent', area })
  }, [])
  const openAddChild = useCallback((parentId, parentName) => {
    setModalState({ mode: 'add-child', parentId, parentName })
  }, [])
  const openEditChild = useCallback((child, parentName) => {
    setModalState({ mode: 'edit-child', child, parentName })
  }, [])
  const closeModal = useCallback(() => setModalState(null), [])

  // --- Direct delete actions (no form) ---
  const deleteParent = useCallback(
    async (area) => {
      const childCount = (area.children || []).length
      const msg = childCount
        ? `Delete "${area.name}" and its ${childCount} spot${childCount === 1 ? '' : 's'}?`
        : `Delete "${area.name}"?`
      if (!window.confirm(msg)) return
      try {
        await api.deleteParent(area.id)
        await refresh()
      } catch (e) {
        window.alert(`Delete failed: ${e.message}`)
      }
    },
    [refresh]
  )

  const deleteChild = useCallback(
    async (child) => {
      if (!window.confirm(`Delete "${child.name}"?`)) return
      try {
        await api.deleteChild(child.id)
        await refresh()
      } catch (e) {
        window.alert(`Delete failed: ${e.message}`)
      }
    },
    [refresh]
  )

  const value = {
    locations,
    error,
    refresh,
    modalState,
    openAddParent,
    openEditParent,
    openAddChild,
    openEditChild,
    closeModal,
    deleteParent,
    deleteChild,
  }

  return (
    <LocationsStoreContext.Provider value={value}>{children}</LocationsStoreContext.Provider>
  )
}

export function useLocationsStore() {
  const ctx = useContext(LocationsStoreContext)
  if (!ctx) throw new Error('useLocationsStore must be used inside LocationsStoreProvider')
  return ctx
}
