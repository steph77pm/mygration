import { useEffect, useState } from 'react'
import { LocationBucket } from './components/LocationBucket.jsx'
import { LocationDetail } from './components/LocationDetail.jsx'
import { LocationFormModal } from './components/LocationFormModal.jsx'
import { LocationsStoreProvider, useLocationsStore } from './hooks/useLocationsStore.jsx'
import { SelectedChildProvider } from './hooks/useSelectedChild.jsx'

/**
 * Mygration app shell.
 *
 * Layout follows the prototype:
 *   - `.app-header` row: title + nav buttons (Dashboard / Trip Planner)
 *   - `.app-main`:       the current view
 *
 * Views:
 *   - dashboard    → three always-visible buckets (Active / Watching / Future)
 *   - tripPlanner  → placeholder card until Phase 2 lands
 */
export default function App() {
  return (
    <LocationsStoreProvider>
      <SelectedChildProvider>
        <AppShell />
        <LocationDetail />
        <LocationFormModal />
      </SelectedChildProvider>
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
        {view === 'dashboard' ? <Dashboard /> : <TripPlannerPlaceholder />}
      </main>
    </div>
  )
}

/**
 * Dashboard body — renders the three buckets once the locations store has
 * loaded. Always-visible (no bucket collapse).
 */
function Dashboard() {
  const { locations, error } = useLocationsStore()

  if (error) return <div className="global-error">Failed to load: {error}</div>
  if (!locations) return <div className="global-loading">Loading…</div>

  return (
    <div className="dashboard">
      <LocationBucket
        bucketKey="active"
        title="Active Locations"
        areas={locations.active || []}
      />
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

/** Placeholder content for the Trip Planner tab until Phase 2 ships. */
function TripPlannerPlaceholder() {
  return (
    <div className="trip-planner-placeholder">
      <div className="card">
        <h2 className="section-title" style={{ marginBottom: 8 }}>
          Trip planner
        </h2>
        <p className="section-sub">Coming soon.</p>
      </div>
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
