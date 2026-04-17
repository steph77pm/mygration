import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { api } from '../api.js'

/**
 * Central store for the Trip Planner: the list of tracks + which trip/stop
 * form modal (if any) is open.
 *
 * Mirrors the useLocationsStore pattern. Any component under the provider
 * grabs what it needs via useTripsStore(). Modal openers route through here
 * so TripFormModal / StopFormModal can be mounted once at the app shell.
 *
 * Phase 2 commit #1: CRUD only. Weather per stop comes in commit #2.
 */
const TripsStoreContext = createContext(null)

export function TripsStoreProvider({ children }) {
  const [trips, setTrips] = useState(null)
  const [error, setError] = useState(null)
  const [modalState, setModalState] = useState(null) // null or { mode, ... }

  const refresh = useCallback(async () => {
    try {
      const data = await api.listTrips()
      setTrips(Array.isArray(data) ? data : [])
      setError(null)
    } catch (e) {
      setError(e.message)
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  // --- Modal openers ---
  const openAddTrip = useCallback(() => {
    setModalState({ mode: 'add-trip' })
  }, [])
  const openEditTrip = useCallback((trip) => {
    setModalState({ mode: 'edit-trip', trip })
  }, [])
  const openAddStop = useCallback((tripId, tripName) => {
    setModalState({ mode: 'add-stop', tripId, tripName })
  }, [])
  const openEditStop = useCallback((stop, tripName) => {
    setModalState({ mode: 'edit-stop', stop, tripName })
  }, [])
  const closeModal = useCallback(() => setModalState(null), [])

  // --- Direct delete actions (no form) ---
  const deleteTrip = useCallback(
    async (trip) => {
      const stopCount = (trip.stops || []).length
      const msg = stopCount
        ? `Delete "${trip.name}" and its ${stopCount} stop${stopCount === 1 ? '' : 's'}?`
        : `Delete "${trip.name}"?`
      if (!window.confirm(msg)) return
      try {
        await api.deleteTrip(trip.id)
        await refresh()
      } catch (e) {
        window.alert(`Delete failed: ${e.message}`)
      }
    },
    [refresh]
  )

  const deleteStop = useCallback(
    async (stop) => {
      if (!window.confirm(`Delete stop "${stop.name}"?`)) return
      try {
        await api.deleteStop(stop.id)
        await refresh()
      } catch (e) {
        window.alert(`Delete failed: ${e.message}`)
      }
    },
    [refresh]
  )

  const moveStop = useCallback(
    async (stopId, direction) => {
      try {
        await api.moveStop(stopId, direction)
        await refresh()
      } catch (e) {
        window.alert(`Reorder failed: ${e.message}`)
      }
    },
    [refresh]
  )

  const value = {
    trips,
    error,
    refresh,
    modalState,
    openAddTrip,
    openEditTrip,
    openAddStop,
    openEditStop,
    closeModal,
    deleteTrip,
    deleteStop,
    moveStop,
  }

  return (
    <TripsStoreContext.Provider value={value}>{children}</TripsStoreContext.Provider>
  )
}

export function useTripsStore() {
  const ctx = useContext(TripsStoreContext)
  if (!ctx) throw new Error('useTripsStore must be used inside TripsStoreProvider')
  return ctx
}
