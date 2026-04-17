import { useEffect, useState } from 'react'
import { api } from '../api.js'
import { useLocationsStore } from '../hooks/useLocationsStore.jsx'
import { useSelectedChild } from '../hooks/useSelectedChild.jsx'
import { ComfortBadge } from './ComfortBadge.jsx'

/**
 * Prototype-shaped location card — the visual atom of the dashboard.
 *
 * Each ChildLocation renders as one of these. The parent ParentArea used to
 * have its own card wrapper; now parents only exist as a label above each
 * child card (`card-city`).
 *
 * Modes:
 *   - live:       fetch /api/children/:id/weather, render full card
 *                 (comfort badge, current temp/feels/condition/humidity/wind,
 *                 bug indicator, humidity label, alert tags, 5-day mini strip).
 *                 Clicking opens the detail drill-in in live mode.
 *   - historical: no fetch, no current weather, no mini. Just name + city +
 *                 a subtle "tap to research past conditions" hint. Clicking
 *                 opens the detail drill-in in historical mode.
 *   - watching:   dashed-border `.watching-card` variant. Shows the seasonal
 *                 note the user wrote instead of live weather. Clicking opens
 *                 the detail drill-in in live mode (we still have weather).
 */
export function LocationCard({ child, parentName, mode = 'live' }) {
  const { setSelectedChild } = useSelectedChild()
  const { openEditChild, deleteChild } = useLocationsStore()

  const stop = (fn) => (e) => {
    e.stopPropagation()
    fn()
  }

  const openDetail = () => {
    // Historical mode is only used from Future Planning; watching still gets
    // live-mode detail because we have live weather for those children.
    const detailMode = mode === 'historical' ? 'historical' : 'live'
    setSelectedChild(child, detailMode)
  }

  const onKey = (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      openDetail()
    }
  }

  const editDeleteButtons = (
    <div className="child-actions" onClick={(e) => e.stopPropagation()}>
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
  )

  if (mode === 'watching') {
    return (
      <div
        className="card card-clickable watching-card"
        role="button"
        tabIndex={0}
        onClick={openDetail}
        onKeyDown={onKey}
        aria-label={`Open detail view for ${child.name}`}
      >
        <div className="watching-header">👁 WATCHING</div>
        <div className="watching-name">{child.name}</div>
        <p className="watching-note">
          {child.seasonal_note ||
            child.planning_notes ||
            'Add a seasonal note in edit mode.'}
        </p>
        {editDeleteButtons}
      </div>
    )
  }

  if (mode === 'historical') {
    return (
      <div
        className="card card-clickable location-card"
        role="button"
        tabIndex={0}
        onClick={openDetail}
        onKeyDown={onKey}
        aria-label={`Open historical detail for ${child.name}`}
      >
        <div className="card-top">
          <div>
            <div className="card-name">{child.name}</div>
            <span className="card-city">{parentName}</span>
          </div>
        </div>
        <div className="card-historical-hint">
          Tap to research past conditions →
        </div>
        {editDeleteButtons}
      </div>
    )
  }

  // mode === 'live'
  return <LiveLocationCard child={child} parentName={parentName} onOpen={openDetail} onKey={onKey} editDeleteButtons={editDeleteButtons} />
}

/**
 * Broken out so the live card can own the fetch lifecycle without cluttering
 * the historical / watching branches above.
 */
function LiveLocationCard({ child, parentName, onOpen, onKey, editDeleteButtons }) {
  const [weather, setWeather] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
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
  }, [child.id])

  const current = weather?.current
  const comfort = weather?.comfort
  const alerts = weather?.alerts || {}
  const bugRisk = weather?.bug_risk
  const forecast = weather?.forecast_days || []

  const humidityPct = current?.humidity
  const humClass = humidityPct != null ? humidityClass(humidityPct) : 'hm'
  const humLabel = humidityPct != null ? humidityLabel(humidityPct) : '—'

  const tags = alertTagsFor(alerts, comfort?.composite)

  return (
    <div
      className="card card-clickable location-card"
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={onKey}
      aria-label={`Open detail view for ${child.name}`}
    >
      <div className="card-top">
        <div>
          <div className="card-name">{child.name}</div>
          <span className="card-city">{parentName}</span>
        </div>
        {comfort?.composite != null && <ComfortBadge score={comfort.composite} />}
      </div>

      {loading && <div className="card-loading">Loading weather…</div>}
      {error && !loading && (
        <div className="card-error" title={error}>
          Weather unavailable
        </div>
      )}

      {current && (
        <div className="card-current">
          <div>
            <span className="temp-value">{Math.round(current.temp_f)}°</span>
            <span className="temp-feels">Feels {Math.round(current.feels_like_f)}°</span>
          </div>
          <div>
            <span className="condition-text">{current.condition}</span>
            <span className="condition-detail">
              💧 {Math.round(current.humidity)}%&nbsp;&nbsp;💨 {Math.round(current.wind_mph)} mph
            </span>
          </div>
        </div>
      )}

      {(bugRisk || humidityPct != null) && (
        <div className="card-indicators">
          {bugRisk && <BugInd level={bugRisk} />}
          {humidityPct != null && (
            <span className={`humidity-label ${humClass}`}>💧 {humLabel}</span>
          )}
        </div>
      )}

      {tags.length > 0 && (
        <div className="alert-tags">
          {tags.map((t, i) => (
            <span key={i} className={`alert-tag ${t.cls}`}>
              {t.label}
            </span>
          ))}
        </div>
      )}

      {forecast.length > 0 && (
        <div className="card-weekly-mini">
          {forecast.slice(0, 5).map((d, i) => (
            <div className="mini-day" key={d.date || i}>
              <span className="mini-label">{shortDay(d.date)}</span>
              <span className="mini-high">{Math.round(d.high_f)}°</span>
              <span className="mini-low">{Math.round(d.low_f)}°</span>
              {d.rain_chance_pct >= 40 && <span className="mini-rain">🌧</span>}
            </div>
          ))}
        </div>
      )}

      {editDeleteButtons}
    </div>
  )
}

/* ------------------------------ helpers ------------------------------ */

/**
 * Prototype bins its humidity label into 5 brackets. Map a numeric humidity
 * percentage to the matching class name (`hvh`/`hh`/`hm`/`hl`/`hvl`).
 */
export function humidityClass(pct) {
  if (pct >= 80) return 'hvh'
  if (pct >= 65) return 'hh'
  if (pct >= 45) return 'hm'
  if (pct >= 25) return 'hl'
  return 'hvl'
}

/** Human-readable version of the same 5 brackets. */
export function humidityLabel(pct) {
  if (pct >= 80) return 'Very High'
  if (pct >= 65) return 'High'
  if (pct >= 45) return 'Moderate'
  if (pct >= 25) return 'Low'
  return 'Very Low'
}

/**
 * Build the list of alert-tag objects for a card, matching the prototype's
 * `renderAlerts`. Returns [] when nothing to show.
 */
export function alertTagsFor(alerts, comfortScore) {
  const out = []
  if (alerts?.extended_heat) {
    out.push({ cls: 'heat', label: `🔥 Heat ${alerts.extended_heat_days}+ days` })
  }
  if (alerts?.extended_cold) {
    out.push({ cls: 'cold', label: `❄️ Cold nights ${alerts.extended_cold_days}+ days` })
  }
  const native = alerts?.native || []
  for (const n of native) {
    const label = n.event || n.headline || 'Weather alert'
    out.push({ cls: 'severe', label: `⚠️ ${label}` })
  }
  if (out.length === 0 && comfortScore != null && comfortScore >= 7) {
    out.push({ cls: 'good', label: '✓ Looking good' })
  }
  return out
}

/** "2026-04-19" → "Sun". Falls back to a short form of any non-ISO string. */
function shortDay(date) {
  if (!date) return ''
  const d = typeof date === 'string' ? new Date(date) : date
  if (Number.isNaN(d?.getTime?.())) return String(date).slice(0, 3)
  return d.toLocaleDateString(undefined, { weekday: 'short' })
}

/** Small bug indicator used in the card's `.card-indicators` row. */
function BugInd({ level, note }) {
  const label = level.charAt(0).toUpperCase() + level.slice(1)
  return (
    <span className={`bug-ind ${level}`} title={note || ''}>
      🪲 {label}
    </span>
  )
}
