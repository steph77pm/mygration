import { useEffect, useState } from 'react'
import { LocationBucket } from './components/LocationBucket.jsx'
import { LocationDetail } from './components/LocationDetail.jsx'
import { LocationFormModal } from './components/LocationFormModal.jsx'
import { useIsMobile } from './hooks/useMediaQuery.js'
import { LocationsStoreProvider, useLocationsStore } from './hooks/useLocationsStore.jsx'
import { SelectedChildProvider } from './hooks/useSelectedChild.jsx'

/**
 * Mygration dashboard shell.
 *
 * Three collapsible buckets (Active, Watching, Future Planning) with default
 * expand states that depend on device size:
 *   - Desktop: Active + Watching expanded, Future Planning collapsed
 *   - Mobile: only Active expanded
 * Once the user toggles a bucket, their choice is remembered per device.
 *
 * The LocationsStoreProvider owns the fetched data + CRUD modal state. The
 * dashboard itself is small — all the real work happens in the providers and
 * the bucket/card components.
 */
export default function App() {
  return (
    <LocationsStoreProvider>
      <SelectedChildProvider>
        <Dashboard />
        <LocationDetail />
        <LocationFormModal />
      </SelectedChildProvider>
    </LocationsStoreProvider>
  )
}

/**
 * Small watcher for navigator.onLine. When offline, we show a banner so
 * Stephanie knows the data she's seeing came from the service worker cache
 * and not a live fetch. Not a perfect signal (browser API can be noisy on
 * some networks) but a useful hint.
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

function Dashboard() {
  const { locations, error } = useLocationsStore()
  const isMobile = useIsMobile()
  const online = useOnlineStatus()

  return (
    <div className="app">
      <header className="app-header">
        <h1 className="app-title">
          <span className="title-my">My</span>gration
        </h1>
        <p className="app-subtitle">Weather planning for van life</p>
      </header>

      {!online && (
        <div className="offline-banner" role="status">
          You’re offline — showing last-known data.
        </div>
      )}

      {error && <div className="global-error">Failed to load: {error}</div>}

      {!locations && !error && <div className="global-loading">Loading…</div>}

      {locations && (
        <main className="dashboard">
          <LocationBucket
            bucketKey="active"
            title="Active Locations"
            description="Where you are or heading to right now. Live weather, full comfort scoring."
            areas={locations.active || []}
            defaultOpen={true}
          />
          <LocationBucket
            bucketKey="watching"
            title="Watching"
            description="Nearby backup options while you're in the area — pivot-ready."
            areas={locations.watching || []}
            defaultOpen={!isMobile}
          />
          <LocationBucket
            bucketKey="future_planning"
            title="Future Planning"
            description="Long-horizon trip ideas. Historical research mode, no live data."
            areas={locations.future_planning || []}
            defaultOpen={false}
          />
        </main>
      )}
    </div>
  )
}
