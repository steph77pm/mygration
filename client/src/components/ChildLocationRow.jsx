import { useEffect, useState } from 'react'
import { api } from '../api.js'
import { useSelectedChild } from '../hooks/useSelectedChild.jsx'
import { ComfortBadge } from './ComfortBadge.jsx'

/**
 * A single child location (a specific spot, e.g., "Coast Spot").
 *
 * Shows the core glance-view: current temp, humidity, comfort index, bug risk.
 * Clicking the row opens the detail drill-in view (hourly, sun/wind/astro).
 * For Future Planning locations, skips the live weather fetch and the drill-in
 * (detail-view historical mode lands in a later phase).
 */
export function ChildLocationRow({ child, showLiveWeather }) {
  const [weather, setWeather] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(showLiveWeather)
  const { setSelectedChild } = useSelectedChild()

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

  const clickable = showLiveWeather
  const onRowClick = clickable ? () => setSelectedChild(child) : undefined
  const onRowKey = clickable
    ? (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          setSelectedChild(child)
        }
      }
    : undefined

  return (
    <div
      className={`child-row ${clickable ? 'child-row-clickable' : ''}`}
      onClick={onRowClick}
      onKeyDown={onRowKey}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      aria-label={clickable ? `Open detail view for ${child.name}` : undefined}
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
          Historical mode — no live data pulled. Click to explore past conditions.
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
    </div>
  )
}
