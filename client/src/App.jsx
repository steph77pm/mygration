import { useEffect, useState } from 'react'
import { LocationBucket } from './components/LocationBucket.jsx'
import { LocationDetail } from './components/LocationDetail.jsx'
import { LocationFormModal } from './components/LocationFormModal.jsx'
import { PlanBucket } from './components/PlanBucket.jsx'
import { TripFormModal } from './components/TripFormModal.jsx'
import { TripPlanner } from './components/TripPlanner.jsx'
import { LocationsStoreProvider, useLocationsStore } from './hooks/useLocationsStore.jsx'
import { SelectedChildProvider } from './hooks/useSelectedChild.jsx'
import { TripsStoreProvider, useTripsStore } from './hooks/useTripsStore.jsx'

/**
 * Mygration app shell.
 *
 * Layout follows the prototype:
 *   - `.app-header` row: title + nav buttons (Dashboard / Trip Planner)
 *   - `.app-main`:       the current view
 *
 * Views:
 *   - dashboard    → three always-visible buckets (Active / Watching / Future)
 *   - tripPlanner  → real Trip Planner (Phase 2 commit #1: CRUD + visual,
 *                    weather projection follows in commit #2)
 */
export default function App() {
  return (
    <LocationsStoreProvider>
      <TripsStoreProvider>
        <SelectedChildProvider>
          <AppShell />
          <LocationDetail />
          <LocationFormModal />
          <TripFormModal />
        </SelectedChildProvider>
      </TripsStoreProvider>
    </LocationsStoreProvider>
  )
}

function AppShell() {
  const [view, setView] = useState('dashboard')
  const online = useOnlineStatus()

  return (
    <div className="app">
      <header className="app-header">
        <h1 className="app-title">
          <span className="title-my">My</span>gration
        </h1>
        <nav className="app-nav">
          <button
            type="button"
            className={`nav-btn ${view === 'dashboard' ? 'active' : ''}`}
            onClick={() => setView('dashboard')}
          >
            Dashboard
          </button>
          <button
            type="button"
            className={`nav-btn ${view === 'tripPlanner' ? 'active' : ''}`}
            onClick={() => setView('tripPlanner')}
          >
            Trip Planner
          </button>
        </nav>
      </header>

      {!online && (
        <div className="offline-banner" role="status">
          You’re offline — showing last-known data.
        </div>
      )}

      <main className="app-main">
        {view === 'dashboard' ? <Dashboard /> : <TripPlanner />}
      </main>
    </div>
  )
}

/**
 * Dashboard body — renders the three location buckets plus one bucket per
 * trip plan. Always-visible (no bucket collapse).
 *
 * Order is Active → Plans → Watching → Future Planning so near-term travel
 * (Active + Plans) sits above the exploratory buckets.
 */
function Dashboard() {
  const { locations, error } = useLocationsStore()
  // Trip buckets load independently; if trips haven't arrived yet we just
  // render without them rather than blocking the whole dashboard.
  const { trips } = useTripsStore()

  if (error) return <div className="global-error">Failed to load: {error}</div>
  if (!locations) return <div className="global-loading">Loading…</div>

  const planList = Array.isArray(trips) ? trips : []

  return (
    <div className="dashboard">
      <LocationBucket
        bucketKey="active"
        title="Active Locations"
        areas={locations.active || []}
      />
      {planList.map((trip) => (
        <PlanBucket key={trip.id} trip={trip} />
      ))}
      <LocationBucket
        bucketKey="watching"
        title="Watching"
        areas={locations.watching || []}
      />
      <LocationBucket
        bucketKey="future_planning"
        title="Future Planning"
        areas={locations.future_planning || []}
      />
    </div>
  )
}

/**
 * Small watcher for navigator.onLine. When offline, we show a banner so
 * Stephanie knows the data she's seeing came from the service worker cache
 * and not a live fetch.
 */
function useOnlineStatus() {
  const [online, setOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  )
  useEffect(() => {
    const up = () => setOnline(true)
    const down = () => setOnline(false)
    window.addEventListener('online', up)
    window.addEventListener('offline', down)
    return () => {
      window.removeEventListener('online', up)
      window.removeEventListener('offline', down)
    }
  }, [])
  return online
}
