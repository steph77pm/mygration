import { useEffect, useState } from 'react'
import { api } from '../api.js'
import { usePersistedState } from '../hooks/usePersistedState.js'
import { useTripsStore } from '../hooks/useTripsStore.jsx'
import { ComfortBadge } from './ComfortBadge.jsx'

/**
 * Trip Planner view — Phase 2 commit #2: CRUD + visual shell + weather
 * projection.
 *
 * Matches the prototype:
 *   - Section header: title + view toggles (Timeline/List) + compare toggles
 *     (Compare/Single) + "+ New Track"
 *   - Summary strip: one summary per track with stop count, avg comfort, worst
 *     bug risk, and a "Has warnings" chip if any stop has heat/cold/native alerts.
 *   - Tracks container: compare-mode = side-by-side, single-mode = one wide
 *   - Track panel: header stripe + stop rows/cards with comfort badge, temp,
 *     humidity, bug chip, and alert tags per stop.
 *
 * Weather comes from GET /api/trips/:id/weather (each stop → forecast day if
 * within the 10-day window, otherwise current conditions). Fetched per visible
 * trip so switching between Compare/Single doesn't re-pull everything.
 */
export function TripPlanner() {
  const {
    trips,
    error,
    openAddTrip,
    openEditTrip,
    openAddStop,
    openEditStop,
    deleteTrip,
    deleteStop,
    moveStop,
  } = useTripsStore()

  const [viewMode, setViewMode] = usePersistedState('mygration.trip.view', 'timeline')
  const [compareMode, setCompareMode] = usePersistedState(
    'mygration.trip.compare',
    true
  )

  if (error) return <div className="global-error">Failed to load trips: {error}</div>
  if (!trips) return <div className="global-loading">Loading…</div>

  const hasTrips = trips.length > 0
  const visibleTrips = compareMode ? trips.slice(0, 3) : trips.slice(0, 1)

  return (
    <div className="trip-planner">
      <div className="section-header">
        <div>
          <h2 className="section-title">Trip Planner</h2>
          <span className="section-sub">Compare routes and plan your next move</span>
        </div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <div className="toggle-group" role="tablist" aria-label="View">
            <button
              type="button"
              className={`toggle-btn ${viewMode === 'timeline' ? 'active' : ''}`}
              onClick={() => setViewMode('timeline')}
            >
              Timeline
            </button>
            <button
              type="button"
              className={`toggle-btn ${viewMode === 'list' ? 'active' : ''}`}
              onClick={() => setViewMode('list')}
            >
              List
            </button>
          </div>
          <div className="toggle-group" role="tablist" aria-label="Compare">
            <button
              type="button"
              className={`toggle-btn ${compareMode ? 'active' : ''}`}
              onClick={() => setCompareMode(true)}
            >
              Compare
            </button>
            <button
              type="button"
              className={`toggle-btn ${!compareMode ? 'active' : ''}`}
              onClick={() => setCompareMode(false)}
            >
              Single
            </button>
          </div>
          <button type="button" className="btn btn-primary" onClick={openAddTrip}>
            + New Track
          </button>
        </div>
      </div>

      {!hasTrips ? (
        <div className="card" style={{ textAlign: 'center', color: '#64748b' }}>
          No tracks yet.{' '}
          <button
            type="button"
            className="btn btn-ghost"
            style={{ marginLeft: 8 }}
            onClick={openAddTrip}
          >
            Create your first track
          </button>
        </div>
      ) : (
        <>
          <div className="track-summary-bar">
            {trips.map((t) => (
              <TrackSummary key={t.id} track={t} />
            ))}
          </div>

          <div className={`tracks-container ${compareMode ? 'compare' : 'single'}`}>
            {visibleTrips.map((track) => (
              <TrackPanel
                key={track.id}
                track={track}
                viewMode={viewMode}
                onEditTrack={() => openEditTrip(track)}
                onDeleteTrack={() => deleteTrip(track)}
                onAddStop={() => openAddStop(track.id, track.name)}
                onEditStop={(stop) => openEditStop(stop, track.name)}
                onDeleteStop={(stop) => deleteStop(stop)}
                onMoveStop={(stopId, direction) => moveStop(stopId, direction)}
              />
            ))}
          </div>
        </>
      )}
    </div>
  )
}

/**
 * Hook: fetch /api/trips/:id/weather for one trip. Returns { weather, loading,
 * error } and re-fetches when the trip's stop composition changes (we key on
 * stop ids + coords so a rename alone doesn't re-fetch).
 */
function useTripWeather(track) {
  const stopKey = (track.stops || [])
    .map((s) => `${s.id}:${s.lat}:${s.lng}:${s.start_date || ''}`)
    .join(',')

  const [state, setState] = useState({
    weather: null,
    loading: false,
    error: null,
  })

  useEffect(() => {
    // No stops → no fetch, clear state.
    if (!track.id || (track.stops || []).length === 0) {
      setState({ weather: null, loading: false, error: null })
      return
    }
    let cancelled = false
    setState((s) => ({ ...s, loading: true, error: null }))
    api
      .getTripWeather(track.id)
      .then((data) => {
        if (!cancelled) setState({ weather: data, loading: false, error: null })
      })
      .catch((e) => {
        if (!cancelled)
          setState({ weather: null, loading: false, error: e.message })
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track.id, stopKey])

  return state
}

/**
 * Top summary strip. Shows stop count + avg comfort + worst bug + warnings
 * flag using the trip weather data.
 */
function TrackSummary({ track }) {
  const stopCount = (track.stops || []).length
  const { weather } = useTripWeather(track)
  const summary = weather?.summary

  return (
    <div className="track-summary" style={{ borderTopColor: track.color }}>
      <div className="summary-name">{track.name}</div>
      <div className="summary-stats">
        <span>
          {stopCount} stop{stopCount === 1 ? '' : 's'}
        </span>
        {summary?.avg_comfort != null && (
          <span>
            Avg comfort: <strong>{summary.avg_comfort}/10</strong>
          </span>
        )}
        {summary?.worst_bug && <BugInd level={summary.worst_bug} />}
        {summary?.has_warnings && (
          <span className="alert-tag severe" style={{ fontSize: 10 }}>
            Has warnings
          </span>
        )}
      </div>
    </div>
  )
}

function TrackPanel({
  track,
  viewMode,
  onEditTrack,
  onDeleteTrack,
  onAddStop,
  onEditStop,
  onDeleteStop,
  onMoveStop,
}) {
  const stops = track.stops || []
  const { weather, loading, error } = useTripWeather(track)

  // Build a stop_id → weather entry lookup so render is O(1) per stop.
  const weatherByStop = {}
  for (const w of weather?.stops || []) {
    weatherByStop[w.stop_id] = w
  }

  return (
    <div className="track-panel">
      <div className="track-header" style={{ borderLeftColor: track.color }}>
        <div className="track-name">{track.name}</div>
        <span className="track-stop-count">
          {stops.length} stop{stops.length === 1 ? '' : 's'}
        </span>
        <div className="track-actions">
          <button
            type="button"
            className="icon-btn"
            onClick={onEditTrack}
            aria-label={`Edit ${track.name}`}
            title="Edit track"
          >
            ✎
          </button>
          <button
            type="button"
            className="icon-btn icon-btn-danger"
            onClick={onDeleteTrack}
            aria-label={`Delete ${track.name}`}
            title="Delete track"
          >
            ×
          </button>
        </div>
      </div>

      {loading && stops.length > 0 && (
        <div className="track-weather-loading">Loading weather…</div>
      )}
      {error && (
        <div className="track-weather-error" title={error}>
          Weather unavailable
        </div>
      )}

      {stops.length === 0 ? (
        <div className="track-empty">
          No stops yet.{' '}
          <button type="button" className="btn btn-ghost" onClick={onAddStop}>
            + Add Stop
          </button>
        </div>
      ) : viewMode === 'timeline' ? (
        <>
          {stops.map((s, i) => (
            <div key={s.id}>
              <StopTimelineCard
                stop={s}
                weather={weatherByStop[s.id]}
                trackColor={track.color}
                isFirst={i === 0}
                isLast={i === stops.length - 1}
                onEdit={() => onEditStop(s)}
                onDelete={() => onDeleteStop(s)}
                onMoveUp={() => onMoveStop(s.id, 'up')}
                onMoveDown={() => onMoveStop(s.id, 'down')}
              />
              {i < stops.length - 1 && <div className="timeline-connector">↓</div>}
            </div>
          ))}
          <button type="button" className="btn btn-ghost track-add-stop" onClick={onAddStop}>
            + Add Stop
          </button>
        </>
      ) : (
        <>
          {stops.map((s, i) => (
            <StopListRow
              key={s.id}
              stop={s}
              weather={weatherByStop[s.id]}
              trackColor={track.color}
              isFirst={i === 0}
              isLast={i === stops.length - 1}
              onEdit={() => onEditStop(s)}
              onDelete={() => onDeleteStop(s)}
              onMoveUp={() => onMoveStop(s.id, 'up')}
              onMoveDown={() => onMoveStop(s.id, 'down')}
            />
          ))}
          <button type="button" className="btn btn-ghost track-add-stop" onClick={onAddStop}>
            + Add Stop
          </button>
        </>
      )}
    </div>
  )
}

function StopTimelineCard({
  stop,
  weather,
  trackColor,
  isFirst,
  isLast,
  onEdit,
  onDelete,
  onMoveUp,
  onMoveDown,
}) {
  const comfortScore = weather?.comfort?.composite
  const tempLabel = weather?.temp_f != null ? `${Math.round(weather.temp_f)}°F` : null
  const humidityLabel =
    weather?.humidity != null ? `${Math.round(weather.humidity)}% humidity` : null
  const alertTags = buildAlertTags(weather)

  return (
    <div className="stop-card" style={{ borderLeftColor: trackColor }}>
      <div className="stop-header">
        <div className="stop-name-row">
          <span>📍</span>
          <span className="stop-name">{stop.name}</span>
        </div>
        {comfortScore != null && <ComfortBadge score={comfortScore} size={28} />}
        <StopRowActions
          isFirst={isFirst}
          isLast={isLast}
          onEdit={onEdit}
          onDelete={onDelete}
          onMoveUp={onMoveUp}
          onMoveDown={onMoveDown}
        />
      </div>
      <div className="stop-dates">
        📅 {formatDateRange(stop.start_date, stop.end_date)}
        {weather?.mode === 'current' && (
          <span className="stop-mode-hint"> · current conditions</span>
        )}
        {weather?.mode === 'forecast' && (
          <span className="stop-mode-hint"> · forecast</span>
        )}
      </div>
      {stop.planning_notes && (
        <div className="stop-notes">{stop.planning_notes}</div>
      )}
      <div className="stop-details">
        {tempLabel ? (
          <span className="stop-stat">{tempLabel}</span>
        ) : weather?.mode === 'error' ? (
          <span className="stop-stat" style={{ color: '#64748b' }}>
            Weather unavailable
          </span>
        ) : (
          <span className="stop-stat" style={{ color: '#64748b' }}>
            —
          </span>
        )}
        {humidityLabel && <span className="stop-stat">{humidityLabel}</span>}
        {weather?.bug_risk && <BugInd level={weather.bug_risk} />}
      </div>
      {alertTags.length > 0 && (
        <div className="stop-alerts">
          {alertTags.map((t, i) => (
            <span key={i} className={`alert-tag ${t.cls}`}>
              {t.label}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

function StopListRow({
  stop,
  weather,
  trackColor,
  isFirst,
  isLast,
  onEdit,
  onDelete,
  onMoveUp,
  onMoveDown,
}) {
  const comfortScore = weather?.comfort?.composite
  const tempLabel = weather?.temp_f != null ? `${Math.round(weather.temp_f)}°F` : null
  const alertTags = buildAlertTags(weather)

  return (
    <div className="list-stop-row">
      <div className="list-stop-grip" aria-hidden="true">≡</div>
      <div className="list-stop-dot" style={{ background: trackColor }} />
      <div className="list-stop-info">
        <div className="list-stop-name">{stop.name}</div>
        <div className="list-stop-dates">
          {formatDateRange(stop.start_date, stop.end_date)}
        </div>
      </div>
      <div className="list-stop-weather">
        {tempLabel ? (
          <span>{tempLabel}</span>
        ) : (
          <span style={{ color: '#64748b' }}>—</span>
        )}
        {comfortScore != null && <ComfortBadge score={comfortScore} size={28} />}
      </div>
      <div className="list-stop-flags">
        {weather?.bug_risk && <BugInd level={weather.bug_risk} />}
        {alertTags.map((t, i) => (
          <span key={i} className={`alert-tag ${t.cls}`}>
            {t.label}
          </span>
        ))}
      </div>
      <StopRowActions
        isFirst={isFirst}
        isLast={isLast}
        onEdit={onEdit}
        onDelete={onDelete}
        onMoveUp={onMoveUp}
        onMoveDown={onMoveDown}
      />
    </div>
  )
}

function StopRowActions({ isFirst, isLast, onEdit, onDelete, onMoveUp, onMoveDown }) {
  return (
    <div className="stop-actions" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        className="icon-btn"
        onClick={onMoveUp}
        disabled={isFirst}
        aria-label="Move stop up"
        title="Move up"
      >
        ↑
      </button>
      <button
        type="button"
        className="icon-btn"
        onClick={onMoveDown}
        disabled={isLast}
        aria-label="Move stop down"
        title="Move down"
      >
        ↓
      </button>
      <button
        type="button"
        className="icon-btn"
        onClick={onEdit}
        aria-label="Edit stop"
        title="Edit stop"
      >
        ✎
      </button>
      <button
        type="button"
        className="icon-btn icon-btn-danger"
        onClick={onDelete}
        aria-label="Delete stop"
        title="Delete stop"
      >
        ×
      </button>
    </div>
  )
}

/** Bug indicator chip. Same look as the dashboard card version. */
function BugInd({ level }) {
  if (!level) return null
  const label = level.charAt(0).toUpperCase() + level.slice(1)
  return (
    <span className={`bug-ind ${level}`}>
      🪲 {label}
    </span>
  )
}

/**
 * Build alert-tag objects for a stop from its weather payload. Mirrors
 * alertTagsFor() in LocationCard.jsx but only surfaces the ones relevant at
 * the stop level (heat, cold, native). Skip the "Looking good" tag — too
 * noisy on the stop cards.
 */
function buildAlertTags(weather) {
  const out = []
  const a = weather?.alerts
  if (!a) return out
  if (a.extended_heat) {
    out.push({ cls: 'heat', label: `🔥 Heat ${a.extended_heat_days}+ days` })
  }
  if (a.extended_cold) {
    out.push({ cls: 'cold', label: `❄️ Cold nights ${a.extended_cold_days}+ days` })
  }
  for (const n of a.native || []) {
    const label = n.event || n.headline || 'Weather alert'
    out.push({ cls: 'severe', label: `⚠️ ${label}` })
  }
  return out
}

/**
 * "2026-05-12" + "2026-05-18" → "May 12 – May 18"
 * one side blank → "May 12+" / "by May 18"
 * both blank → "Dates not set"
 */
function formatDateRange(start, end) {
  if (!start && !end) return 'Dates not set'
  const fmt = (iso) => {
    const d = new Date(iso + 'T00:00:00')
    if (Number.isNaN(d.getTime())) return iso
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  }
  if (start && !end) return `${fmt(start)}+`
  if (!start && end) return `by ${fmt(end)}`
  return `${fmt(start)} – ${fmt(end)}`
}
