import { useEffect, useState } from 'react'
import { api } from '../api.js'
import { ComfortBadge } from './ComfortBadge.jsx'
import { alertTagsFor, humidityClass, humidityLabel } from './LocationCard.jsx'

/**
 * Dashboard bucket for a single trip plan.
 *
 * Each TripPlan from the Trip Planner shows up on the Dashboard as its own
 * bucket, named after the plan. Each stop renders as a card matching the
 * Active-bucket card shape (comfort badge, current temp/feels/condition,
 * bug indicator, humidity label, alerts, 5-day mini forecast).
 *
 * Design choices baked in here:
 *   - **Today + 10-day at lat/lng**, not the planned-date forecast.
 *     Stephanie iterates on dates constantly while planning, so a temp keyed
 *     to start_date stales out the moment she shuffles. The Trip Planner's
 *     own views (Timeline / List / Calendar) keep the date-aware projection.
 *   - **No edit / delete on stop cards.** Stops are managed in the Trip
 *     Planner — exposing destructive actions here would be the same trap as
 *     the calendar-delete bug (#47). The card title hints "edit in Trip
 *     Planner" via tooltip.
 *   - **No detail modal** for now. ChildLocation has a rich drill-in built
 *     around child id; stops don't have a parallel. Click does nothing.
 */
export function PlanBucket({ trip }) {
  const stops = trip.stops || []
  const stopCount = stops.length
  // Use the trip color for a thin top accent matching the Trip Planner's
  // track-summary cards, so the visual link is obvious.
  const accent = trip.color || '#3b82f6'

  return (
    <section className="bucket bucket-plan">
      <div className="section-header">
        <div>
          <h2 className="section-title">
            <span
              className="plan-bucket-color-dot"
              style={{ background: accent }}
              aria-hidden="true"
            />
            {trip.name}
          </h2>
          <span className="section-sub">
            {stopCount} stop{stopCount === 1 ? '' : 's'} · plan from Trip Planner
          </span>
        </div>
      </div>

      {stopCount === 0 ? (
        <div className="card" style={{ textAlign: 'center', color: '#64748b' }}>
          No stops in this plan yet — add some in the Trip Planner.
        </div>
      ) : (
        <div className="card-grid">
          {stops.map((stop) => (
            <StopCard key={stop.id} stop={stop} tripName={trip.name} />
          ))}
        </div>
      )}
    </section>
  )
}

/**
 * Card for a single trip stop. Mirrors LiveLocationCard's visual shape but
 * fetches weather from /api/stops/:id/weather instead of /api/children/:id.
 *
 * Not interactive (no detail modal, no edit/delete) — see PlanBucket comment.
 */
function StopCard({ stop, tripName }) {
  const [weather, setWeather] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    api
      .getStopWeather(stop.id)
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
  }, [stop.id])

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
      className="card location-card plan-stop-card"
      title={`${stop.name} — manage in Trip Planner`}
    >
      <div className="card-top">
        <div>
          <div className="card-name">{stop.name}</div>
          <span className="card-city">{tripName}</span>
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
              💨 {Math.round(current.wind_mph)} mph
            </span>
          </div>
        </div>
      )}

      {(bugRisk || humidityPct != null) && (
        <div className="card-indicators">
          {bugRisk && (
            <span className={`bug-ind ${bugRisk}`}>
              🪲 {bugRisk.charAt(0).toUpperCase() + bugRisk.slice(1)}
            </span>
          )}
          {humidityPct != null && (
            <span className={`humidity-label ${humClass}`}>
              HUM {Math.round(humidityPct)}% ({humLabel})
            </span>
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
              <span className="mini-label">{shortDay(d.date, i)}</span>
              <span className="mini-high">{Math.round(d.high_f)}°</span>
              <span className="mini-low">{Math.round(d.low_f)}°</span>
              {d.rain_chance_pct >= 40 && <span className="mini-rain">🌧</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/** Same local-time-safe ISO→short-day helper as LocationCard. Duplicated to
 *  avoid pulling in a tiny export across the module boundary. */
function shortDay(date, idx) {
  if (idx === 0) return 'Today'
  if (!date) return ''
  const d = typeof date === 'string' ? new Date(date + 'T00:00:00') : date
  if (Number.isNaN(d?.getTime?.())) return String(date).slice(0, 3)
  return d.toLocaleDateString(undefined, { weekday: 'short' })
}
