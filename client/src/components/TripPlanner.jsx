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
    refresh,
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
            <button
              type="button"
              className={`toggle-btn ${viewMode === 'calendar' ? 'active' : ''}`}
              onClick={() => setViewMode('calendar')}
            >
              Calendar
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
                setViewMode={setViewMode}
                refresh={refresh}
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
          <span className="alert-tag severe" style={{ fontSize: 10 }} title="Has warnings">
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
  setViewMode,
  refresh,
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
          {viewMode !== 'calendar' && (
            <button
              type="button"
              className="icon-btn icon-btn-danger"
              onClick={onDeleteTrack}
              aria-label={`Delete ${track.name}`}
              title="Delete track"
            >
              ×
            </button>
          )}
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
      ) : viewMode === 'list' ? (
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
      ) : (
        <CalendarView
          stops={stops}
          trackColor={track.color}
          refresh={refresh}
          weatherByStop={weatherByStop}
          onEditStop={onEditStop}
          onAddStop={onAddStop}
          onExitCalendar={() => setViewMode('list')}
        />
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
  const { tempLabel, comfortScore, bugRisk, isRange } = summarizeWeather(weather)
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
          <span
            className="stop-stat"
            title={isRange ? 'Low–High across this stop' : undefined}
          >
            {tempLabel}
          </span>
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
        {bugRisk && <BugInd level={bugRisk} />}
      </div>
      {alertTags.length > 0 && (
        <div className="stop-alerts">
          {alertTags.map((t, i) => (
            <span key={i} className={`alert-tag ${t.cls}`} title={t.label}>
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
  const { tempLabel, comfortScore, bugRisk, isRange } = summarizeWeather(weather)
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
          <span title={isRange ? 'Low–High across this stop' : undefined}>
            {tempLabel}
          </span>
        ) : (
          <span style={{ color: '#64748b' }}>—</span>
        )}
        {comfortScore != null && <ComfortBadge score={comfortScore} size={28} />}
      </div>
      <div className="list-stop-flags">
        {bugRisk && <BugInd level={bugRisk} />}
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

/**
 * Summarize a multi-day stop's weather from its `days` array (per-day
 * forecast coming from the backend). Returns the high–low range, the
 * lowest comfort score, and the worst bug risk across the span. Falls
 * back to the single-point fields on the weather payload (temp_f,
 * comfort.composite, bug_risk) when the stop isn't dated or only has
 * one day of forecast. Also produces a tempLabel string ready to
 * render: `68–78°F` for multi-day, `72°F` for single-day.
 */
function summarizeWeather(weather) {
  const out = {
    tempLabel: null,
    comfortScore: weather?.comfort?.composite,
    bugRisk: weather?.bug_risk || null,
    isRange: false,
  }
  const days = (weather?.days || []).filter((d) => d && d.temp_f_high != null)
  if (days.length >= 2) {
    const highs = days.map((d) => d.temp_f_high)
    const lows = days
      .map((d) => d.temp_f_low)
      .filter((v) => v != null)
    const hi = Math.max(...highs)
    const lo = lows.length ? Math.min(...lows) : Math.min(...highs)
    out.tempLabel = `${Math.round(lo)}–${Math.round(hi)}°F`
    out.isRange = true
    // Worst (lowest) comfort score across the range
    const scores = days
      .map((d) => d?.comfort?.composite)
      .filter((v) => v != null)
    if (scores.length) out.comfortScore = Math.min(...scores)
    // Worst bug risk across the range
    const rank = { low: 0, moderate: 1, high: 2, severe: 3 }
    let worstBug = null
    for (const d of days) {
      if (!d.bug_risk) continue
      if (worstBug === null || (rank[d.bug_risk] ?? -1) > (rank[worstBug] ?? -1)) {
        worstBug = d.bug_risk
      }
    }
    if (worstBug) out.bugRisk = worstBug
  } else if (days.length === 1) {
    out.tempLabel = `${Math.round(days[0].temp_f_high)}°F`
  } else if (weather?.temp_f != null) {
    out.tempLabel = `${Math.round(weather.temp_f)}°F`
  }
  return out
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
 * noisy on the stop cards. De-duplicates native alerts by label so that a
 * county that issues e.g. two "Beach Hazards Statement" notices only renders
 * one chip.
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
  const seen = new Set()
  for (const n of a.native || []) {
    const label = `⚠️ ${n.event || n.headline || 'Weather alert'}`
    if (seen.has(label)) continue
    seen.add(label)
    out.push({ cls: 'severe', label })
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

// ---------------------------------------------------------------------------
// Calendar view
//
// Month-grid drag-and-drop for assigning/shifting stop dates. Stops with no
// dates live in a tray at the top; drag them onto a day to give them a date.
// Stops with dates render as chips on every day they cover (a 3-day stop
// shows on 3 cells). Dragging a chip and dropping on another day shifts the
// whole stop by (drop − source), preserving duration. Dropping on the tray
// clears both start_date and end_date.
//
// We hold a module-level drag payload as a fallback because
// dataTransfer.getData() isn't readable during dragover (only drop), which
// means we can't style drop targets without this. Set on dragstart, cleared
// on dragend.
// ---------------------------------------------------------------------------

let _calendarDrag = null // { stopId, srcIso | null, startIso | null, endIso | null }

function CalendarView({
  stops,
  trackColor,
  refresh,
  weatherByStop,
  onEditStop,
  onAddStop,
  onExitCalendar,
}) {
  // ISO → { temp_f (rounded high), low_f } lookup, aggregated across every
  // stop's per-day forecast. First stop wins if two stops happen to cover
  // the same day (rare — would require overlapping date ranges).
  const dayTempByIso = (() => {
    const m = {}
    for (const s of stops) {
      const w = weatherByStop?.[s.id]
      if (!w?.days) continue
      for (const d of w.days) {
        if (!d?.date || d.temp_f_high == null) continue
        if (m[d.date]) continue
        m[d.date] = {
          temp_f: d.temp_f_high,
          low_f: d.temp_f_low,
        }
      }
    }
    return m
  })()

  const today = new Date()
  const initialMonth = (() => {
    // Prefer the month of the earliest dated stop if any, else today.
    const dated = stops.filter((s) => s.start_date).map((s) => s.start_date).sort()
    if (dated.length) {
      const [y, m] = dated[0].split('-').map(Number)
      return new Date(y, m - 1, 1)
    }
    return new Date(today.getFullYear(), today.getMonth(), 1)
  })()
  const [cursor, setCursor] = useState(initialMonth)
  const [dropTargetIso, setDropTargetIso] = useState(null) // day cell currently hovered
  const [trayHover, setTrayHover] = useState(false)

  const grid = buildMonthGrid(cursor) // 42 date objects
  const todayIso = isoLocal(today)

  // Undated stops → tray
  const tray = stops.filter((s) => !s.start_date && !s.end_date)

  async function shiftStop(stopId, patch) {
    try {
      await api.updateStop(stopId, patch)
      await refresh()
    } catch (e) {
      window.alert(`Update failed: ${e.message}`)
    }
  }

  function handleDropOnCell(dropIso) {
    const p = _calendarDrag
    _calendarDrag = null
    setDropTargetIso(null)
    if (!p) return
    // Tray → just anchor on dropIso (single-day stop).
    if (!p.startIso && !p.endIso) {
      shiftStop(p.stopId, { start_date: dropIso, end_date: dropIso })
      return
    }
    // Dated → shift by (dropIso − srcIso). If srcIso missing, anchor at start.
    const src = p.srcIso || p.startIso
    const delta = daysBetween(src, dropIso)
    const newStart = p.startIso ? addDaysIso(p.startIso, delta) : dropIso
    const newEnd = p.endIso ? addDaysIso(p.endIso, delta) : newStart
    // No-op: same dates
    if (newStart === p.startIso && newEnd === p.endIso) return
    shiftStop(p.stopId, { start_date: newStart, end_date: newEnd })
  }

  function handleDropOnTray() {
    const p = _calendarDrag
    _calendarDrag = null
    setTrayHover(false)
    if (!p) return
    if (!p.startIso && !p.endIso) return // already undated
    shiftStop(p.stopId, { start_date: null, end_date: null })
  }

  return (
    <div className="calendar-view">
      <div
        className={`calendar-tray ${trayHover ? 'drop-hover' : ''}`}
        onDragOver={(e) => {
          if (!_calendarDrag) return
          e.preventDefault()
          setTrayHover(true)
        }}
        onDragLeave={() => setTrayHover(false)}
        onDrop={(e) => {
          e.preventDefault()
          handleDropOnTray()
        }}
      >
        <span className="calendar-tray-label">Undated</span>
        <div className="calendar-tray-stops">
          {tray.length === 0 ? (
            <span className="calendar-tray-empty">Drop a stop here to clear its dates</span>
          ) : (
            tray.map((s) => (
              <CalendarStopChip
                key={s.id}
                stop={s}
                trackColor={trackColor}
                srcIso={null}
                onEditStop={onEditStop}
              />
            ))
          )}
        </div>
      </div>

      <div className="calendar-exit-row">
        <button
          type="button"
          className="btn btn-ghost calendar-exit-btn"
          onClick={onExitCalendar}
          title="Back to List view"
        >
          ← Back to List
        </button>
      </div>

      <div className="calendar-header">
        <button
          type="button"
          className="icon-btn"
          onClick={() => setCursor(addMonths(cursor, -1))}
          aria-label="Previous month"
          title="Previous month"
        >
          ‹
        </button>
        <div className="calendar-month-label">{formatMonth(cursor)}</div>
        <button
          type="button"
          className="icon-btn"
          onClick={() => setCursor(addMonths(cursor, 1))}
          aria-label="Next month"
          title="Next month"
        >
          ›
        </button>
        <button
          type="button"
          className="btn btn-ghost calendar-today-btn"
          onClick={() => setCursor(new Date(today.getFullYear(), today.getMonth(), 1))}
        >
          Today
        </button>
        <button
          type="button"
          className="btn btn-ghost track-add-stop"
          onClick={onAddStop}
          style={{ marginLeft: 'auto' }}
        >
          + Add Stop
        </button>
      </div>

      <div className="calendar-dow">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
          <div key={d} className="calendar-dow-cell">{d}</div>
        ))}
      </div>

      <div className={`calendar-grid ${_calendarDrag ? 'dragging' : ''}`}>
        {[0, 1, 2, 3, 4, 5].map((wi) => {
          const week = grid.slice(wi * 7, wi * 7 + 7)
          const segments = segmentsForWeek(week, stops)
          const laneCount = segments.reduce((m, s) => Math.max(m, s.lane + 1), 0)
          // Date label 22px + lane rows (18px each + 2px gap) + 6px bottom.
          const minCellHeight = Math.max(64, 28 + laneCount * 20 + 6)
          return (
            <div key={wi} className="calendar-week" style={{ minHeight: minCellHeight }}>
              {week.map((day) => {
                const iso = isoLocal(day)
                const inMonth = day.getMonth() === cursor.getMonth()
                const isToday = iso === todayIso
                return (
                  <div
                    key={iso}
                    className={`calendar-cell ${inMonth ? 'current-month' : 'other-month'} ${
                      isToday ? 'today' : ''
                    } ${dropTargetIso === iso ? 'drop-hover' : ''}`}
                    onDragOver={(e) => {
                      if (!_calendarDrag) return
                      e.preventDefault()
                      if (dropTargetIso !== iso) setDropTargetIso(iso)
                    }}
                    onDragLeave={() => {
                      if (dropTargetIso === iso) setDropTargetIso(null)
                    }}
                    onDrop={(e) => {
                      e.preventDefault()
                      handleDropOnCell(iso)
                    }}
                  >
                    <div className="calendar-cell-head">
                      <span className="calendar-cell-date">{day.getDate()}</span>
                      {dayTempByIso[iso] && (
                        <span
                          className="calendar-cell-temp"
                          title={
                            dayTempByIso[iso].low_f != null
                              ? `High ${Math.round(dayTempByIso[iso].temp_f)}°F · Low ${Math.round(dayTempByIso[iso].low_f)}°F`
                              : `${Math.round(dayTempByIso[iso].temp_f)}°F`
                          }
                        >
                          {Math.round(dayTempByIso[iso].temp_f)}°
                        </span>
                      )}
                    </div>
                  </div>
                )
              })}
              <div className="calendar-week-bars">
                {segments.map((seg) => (
                  <div
                    key={`${seg.stop.id}-${wi}`}
                    className={`calendar-stop-bar ${seg.cutLeft ? 'cut-left' : ''} ${
                      seg.cutRight ? 'cut-right' : ''
                    }`}
                    style={{
                      background: trackColor,
                      gridColumn: `${seg.startCol + 1} / span ${seg.span}`,
                      gridRow: seg.lane + 1,
                    }}
                    draggable
                    onDragStart={(e) => {
                      _calendarDrag = {
                        stopId: seg.stop.id,
                        srcIso: null,
                        startIso: seg.stop.start_date || null,
                        endIso: seg.stop.end_date || null,
                      }
                      try {
                        e.dataTransfer.setData('text/plain', String(seg.stop.id))
                        e.dataTransfer.effectAllowed = 'move'
                      } catch {
                        /* ignore */
                      }
                    }}
                    onDragEnd={() => {
                      _calendarDrag = null
                    }}
                    onDoubleClick={() => onEditStop(seg.stop)}
                    title={`${seg.stop.name} — double-click to edit`}
                  >
                    <span className="calendar-stop-bar-label">{seg.stop.name}</span>
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function CalendarStopChip({ stop, trackColor, srcIso, onEditStop }) {
  return (
    <div
      className="calendar-stop-chip"
      style={{ background: trackColor }}
      draggable
      onDragStart={(e) => {
        _calendarDrag = {
          stopId: stop.id,
          srcIso,
          startIso: stop.start_date || null,
          endIso: stop.end_date || null,
        }
        // Also stash in dataTransfer so something is attached (required in FF).
        try {
          e.dataTransfer.setData('text/plain', String(stop.id))
          e.dataTransfer.effectAllowed = 'move'
        } catch {
          /* ignore */
        }
      }}
      onDragEnd={() => {
        _calendarDrag = null
      }}
      onDoubleClick={() => onEditStop(stop)}
      title={`${stop.name} — double-click to edit`}
    >
      {stop.name}
    </div>
  )
}

// --- Calendar helpers ------------------------------------------------------

/** '2026-04-18' from a Date, using local time (not UTC). */
function isoLocal(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** Parse 'YYYY-MM-DD' at local midnight. */
function parseIso(iso) {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d)
}

function addDaysIso(iso, delta) {
  const d = parseIso(iso)
  d.setDate(d.getDate() + delta)
  return isoLocal(d)
}

function daysBetween(fromIso, toIso) {
  const from = parseIso(fromIso).getTime()
  const to = parseIso(toIso).getTime()
  return Math.round((to - from) / 86400000)
}

function addMonths(date, delta) {
  return new Date(date.getFullYear(), date.getMonth() + delta, 1)
}

function formatMonth(date) {
  return date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
}

/**
 * 6-week (42-cell) grid starting on Sunday, buffered with prev/next month
 * days as needed. Matches Google Calendar's month view.
 */
function buildMonthGrid(cursor) {
  const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1)
  const startOffset = first.getDay() // 0=Sun
  const gridStart = new Date(first)
  gridStart.setDate(first.getDate() - startOffset)
  const cells = []
  for (let i = 0; i < 42; i++) {
    const d = new Date(gridStart)
    d.setDate(gridStart.getDate() + i)
    cells.push(d)
  }
  return cells
}

/**
 * Given a week (array of 7 Date objects, Sun–Sat) and the full stops list,
 * return segment descriptors for every stop that overlaps this week.
 *
 * A multi-week stop produces one segment per week it appears in. Each
 * segment reports the column it starts on (0=Sun), how many columns it
 * spans, and a "lane" index so the caller can stack overlapping stops
 * vertically without collisions. `cutLeft`/`cutRight` flag segments that
 * are continuations of a stop that started before this week (or extends
 * past the end), so the bar can render with a flat edge instead of a
 * rounded one.
 *
 * Lane algorithm: greedy — sort by start date ascending (longer first as
 * tiebreaker), then assign each segment the lowest-index lane whose
 * most-recent span has already ended.
 */
function segmentsForWeek(week, stops) {
  const weekStart = isoLocal(week[0])
  const weekEnd = isoLocal(week[6])
  const overlapping = stops.filter((s) => {
    if (!s.start_date && !s.end_date) return false
    const sStart = s.start_date || s.end_date
    const sEnd = s.end_date || s.start_date
    return sStart <= weekEnd && sEnd >= weekStart
  })
  overlapping.sort((a, b) => {
    const aStart = a.start_date || a.end_date
    const bStart = b.start_date || b.end_date
    if (aStart !== bStart) return aStart.localeCompare(bStart)
    // Longer bars first so they claim the lowest lane; keeps visuals tidy.
    const aEnd = a.end_date || a.start_date
    const bEnd = b.end_date || b.start_date
    return bEnd.localeCompare(aEnd)
  })
  const lanes = [] // each entry: last-used-column-end (exclusive)
  const out = []
  for (const s of overlapping) {
    const sStart = s.start_date || s.end_date
    const sEnd = s.end_date || s.start_date
    const segStartIso = sStart < weekStart ? weekStart : sStart
    const segEndIso = sEnd > weekEnd ? weekEnd : sEnd
    const startCol = daysBetween(weekStart, segStartIso)
    const span = daysBetween(segStartIso, segEndIso) + 1
    let lane = 0
    while (lane < lanes.length && lanes[lane] > startCol) lane++
    if (lane === lanes.length) lanes.push(0)
    lanes[lane] = startCol + span
    out.push({
      stop: s,
      startCol,
      span,
      lane,
      cutLeft: sStart < weekStart,
      cutRight: sEnd > weekEnd,
    })
  }
  return out
}
