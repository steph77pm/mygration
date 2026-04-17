import { useState } from 'react'
import { usePersistedState } from '../hooks/usePersistedState.js'
import { useTripsStore } from '../hooks/useTripsStore.jsx'

/**
 * Trip Planner view — Phase 2 commit #1: CRUD + visual shell, no weather yet.
 *
 * Matches the prototype:
 *   - Section header: title + view toggles (Timeline/List) + compare toggles
 *     (Compare/Single) + "+ New Track"
 *   - Summary strip: one summary per track (stop count, + avg comfort + worst
 *     bug once weather lands in commit #2)
 *   - Tracks container: compare-mode = side-by-side, single-mode = one wide
 *   - Track panel: header stripe + (Timeline stop cards ∥ List stop rows)
 *
 * "Sometimes just one track being mapped out" — that's why Compare/Single is a
 * toggle even before we have multiple trips. Single mode shows the first track
 * full-width; Compare shows up to 3 side-by-side (PROJECT-GUIDE cap).
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

  // View mode toggles persist across sessions so you don't re-configure every
  // time you open the tab.
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
 * Top summary strip. Stop count today; avg comfort + worst bug + warning flag
 * plug in when the /api/trips/:id/weather endpoint lands (commit #2).
 */
function TrackSummary({ track }) {
  const stopCount = (track.stops || []).length
  return (
    <div className="track-summary" style={{ borderTopColor: track.color }}>
      <div className="summary-name">{track.name}</div>
      <div className="summary-stats">
        <span>
          {stopCount} stop{stopCount === 1 ? '' : 's'}
        </span>
        <span className="summary-pending" title="Weather projection arrives in the next update">
          Weather projection: soon
        </span>
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
  trackColor,
  isFirst,
  isLast,
  onEdit,
  onDelete,
  onMoveUp,
  onMoveDown,
}) {
  return (
    <div className="stop-card" style={{ borderLeftColor: trackColor }}>
      <div className="stop-header">
        <div className="stop-name-row">
          <span>📍</span>
          <span className="stop-name">{stop.name}</span>
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
      <div className="stop-dates">📅 {formatDateRange(stop.start_date, stop.end_date)}</div>
      {stop.planning_notes && (
        <div className="stop-notes">{stop.planning_notes}</div>
      )}
      <div className="stop-details">
        <span className="stop-stat">Weather projection pending</span>
      </div>
    </div>
  )
}

function StopListRow({
  stop,
  trackColor,
  isFirst,
  isLast,
  onEdit,
  onDelete,
  onMoveUp,
  onMoveDown,
}) {
  return (
    <div className="list-stop-row">
      <div className="list-stop-dot" style={{ background: trackColor }} />
      <div className="list-stop-info">
        <div className="list-stop-name">{stop.name}</div>
        <div className="list-stop-dates">
          {formatDateRange(stop.start_date, stop.end_date)}
        </div>
      </div>
      <div className="list-stop-weather">
        <span style={{ color: '#64748b', fontStyle: 'italic' }}>—</span>
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
