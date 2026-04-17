import { useEffect, useState } from 'react'
import { api } from '../api.js'
import { useLocationsStore } from '../hooks/useLocationsStore.jsx'
import { useSelectedChild } from '../hooks/useSelectedChild.jsx'
import { ComfortBadge } from './ComfortBadge.jsx'

/**
 * A single child location (a specific spot, e.g., "Coast Spot").
 *
 * Shows the core glance-view: current temp, humidity, comfort index, bug risk.
 * Clicking the row opens the detail drill-in view (hourly, sun/wind/astro).
 * Edit / delete buttons stop propagation so they don't also open the detail.
 * Future Planning rows skip the live weather fetch and open the historical
 * detail view instead of the live one.
 */
export function ChildLocationRow({ child, parentName, showLiveWeather }) {
  const [weather, setWeather] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(showLiveWeather)
  const { setSelectedChild } = useSelectedChild()
  const { openEditChild, deleteChild } = useLocationsStore()

  useEffect(() => {
    if (!showLiveWeather) return
    let cancelled = false
    setLoading(true)
    api
      .getChildWeather(child.id)
      .then((data) => {
        if (!cancelled) setWeather(data)
      })
      .catch((e) => {
        if (!cancelled) setError(e.message)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [child.id, showLiveWeather])

  // Rows open detail on click. Future Planning rows also open detail now
  // (historical mode) — the detail component decides which data to fetch.
  const onRowClick = () => setSelectedChild(child)
  const onRowKey = (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      setSelectedChild(child)
    }
  }

  const stop = (fn) => (e) => {
    e.stopPropagation()
    fn()
  }

  return (
    <div
      className="child-row child-row-clickable"
      onClick={onRowClick}
      onKeyDown={onRowKey}
      role="button"
      tabIndex={0}
      aria-label={`Open detail view for ${child.name}`}
    >
      <div className="child-name-block">
        <div className="child-name-row">
          <span className="location-icon child-icon" aria-hidden="true">
            <svg viewBox="0 0 12 12" fill="currentColor" width="100%" height="100%">
              <circle cx="6" cy="6" r="4" />
            </svg>
          </span>
          <h4 className="child-name">{child.name}</h4>
        </div>
        <span className="child-coords">
          {child.lat.toFixed(3)}, {child.lng.toFixed(3)}
        </span>
      </div>

      {!showLiveWeather && (
        <div className="child-historical-hint">
          Historical mode — tap to research past conditions.
        </div>
      )}

      {showLiveWeather && loading && <div className="child-loading">Loading weather…</div>}

      {showLiveWeather && error && (
        <div className="child-error" title={error}>
          Weather unavailable
        </div>
      )}

      {showLiveWeather && weather?.current && (
        <div className="child-weather">
          <div className="temp-block">
            <span className="temp">{Math.round(weather.current.temp_f)}°</span>
            <span className="feels-like">
              feels {Math.round(weather.current.feels_like_f)}°
            </span>
          </div>
          <div className="humidity-block">
            <span className="humidity">{weather.current.humidity}%</span>
            <span className="humidity-label">humidity</span>
          </div>
          {weather.comfort && <ComfortBadge score={weather.comfort.composite} />}
          {weather.bug_risk && (
            <div className={`bug-risk bug-${weather.bug_risk}`}>
              <span className="bug-label">bugs</span>
              <span className="bug-value">{weather.bug_risk}</span>
            </div>
          )}
        </div>
      )}

      <div className="child-actions">
        <button
          type="button"
          className="icon-btn"
          onClick={stop(() => openEditChild(child, parentName))}
          aria-label={`Edit ${child.name}`}
          title="Edit spot"
        >
          ✎
        </button>
        <button
          type="button"
          className="icon-btn icon-btn-danger"
          onClick={stop(() => deleteChild(child))}
          aria-label={`Delete ${child.name}`}
          title="Delete spot"
        >
          ×
        </button>
      </div>
    </div>
  )
}
