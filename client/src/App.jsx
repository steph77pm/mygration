import { useEffect, useState } from 'react'
import { loadLocations } from './api.js'
import { LocationBucket } from './components/LocationBucket.jsx'
import { LocationDetail } from './components/LocationDetail.jsx'
import { useIsMobile } from './hooks/useMediaQuery.js'
import { SelectedChildProvider } from './hooks/useSelectedChild.jsx'

/**
 * Mygration dashboard shell.
 *
 * Three collapsible buckets (Active, Watching, Future Planning) with default
 * expand states that depend on device size:
 *   - Desktop: Active + Watching expanded, Future Planning collapsed
 *   - Mobile: only Active expanded
 * Once the user toggles a bucket, their choice is remembered per device.
 */
export default function App() {
  const [locations, setLocations] = useState(null)
  const [error, setError] = useState(null)
  const isMobile = useIsMobile()

  useEffect(() => {
    loadLocations()
      .then(setLocations)
      .catch((e) => setError(e.message))
  }, [])

  return (
    <SelectedChildProvider>
      <div className="app">
        <header className="app-header">
          <h1 className="app-title">
            <span className="title-my">My</span>gration
          </h1>
          <p className="app-subtitle">Weather planning for van life</p>
        </header>

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
      <LocationDetail />
    </SelectedChildProvider>
  )
}
