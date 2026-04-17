import { useEffect, useState } from 'react'
import { api } from '../api.js'
import { ComfortBadge } from './ComfortBadge.jsx'

/**
 * A single child location (a specific spot, e.g., "Coast Spot").
 *
 * Shows the core glance-view: current temp, humidity, comfort index, bug risk.
 * For Future Planning locations, skips the live weather fetch and shows a
 * "historical mode" hint instead.
 */
export function ChildLocationRow({ child, showLiveWeather }) {
  const [weather, setWeather] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(showLiveWeather)

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

  return (
    <div className="child-row">
      <div className="child-name-block">
        <h4 className="child-name">{child.name}</h4>
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
