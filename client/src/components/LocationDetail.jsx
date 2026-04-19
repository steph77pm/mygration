import { useEffect, useState } from 'react'
import { api } from '../api.js'
import { useLocationsStore } from '../hooks/useLocationsStore.jsx'
import { useSelectedChild } from '../hooks/useSelectedChild.jsx'
import { ComfortBadge } from './ComfortBadge.jsx'
import { alertTagsFor, humidityLabel } from './LocationCard.jsx'

/**
 * Drill-in detail view for a single child location.
 *
 * Two modes depending on which bucket the row came from:
 *   - live:       current conditions + 10-day table + hourly + astro
 *                 + comfort breakdown modal. Matches the prototype's
 *                 `renderLocationDetail` shape.
 *   - historical: pick a month → aggregate digest from the same month last year
 *                 + 4 sample days (Future Planning — fed by /weather/historical).
 *
 * Mode is read from the SelectedChild context; a single modal handles both so
 * open/close animations, scroll-lock, and Escape-to-close stay in one place.
 */
export function LocationDetail() {
  const { selectedChild, selectedMode, setSelectedChild } = useSelectedChild()

  // Close on Escape key.
  useEffect(() => {
    if (!selectedChild) return
    const onKey = (e) => {
      if (e.key === 'Escape') setSelectedChild(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedChild, setSelectedChild])

  // Lock body scroll while modal is open so background doesn't scroll behind it.
  useEffect(() => {
    if (!selectedChild) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [selectedChild])

  if (!selectedChild) return null

  const close = () => setSelectedChild(null)

  return (
    <div className="detail-overlay" onClick={close}>
      <div
        className="detail-panel"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="detail-header">
          <div>
            <button
              type="button"
              className="btn btn-ghost back-btn"
              onClick={close}
            >
              ← Back to Dashboard
            </button>
            <h2 className="detail-title">{selectedChild.name}</h2>
            <p className="detail-coords">
              {selectedChild.lat.toFixed(3)}, {selectedChild.lng.toFixed(3)}
              {selectedMode === 'historical' && (
                <span className="detail-mode-chip"> · Historical research</span>
              )}
            </p>
          </div>
          <button
            type="button"
            className="detail-close"
            onClick={close}
            aria-label="Close detail view"
          >
            ×
          </button>
        </header>

        <div className="detail-body">
          {selectedMode === 'historical' ? (
            <HistoricalMode child={selectedChild} />
          ) : (
            <LiveMode childId={selectedChild.id} />
          )}
        </div>
      </div>
    </div>
  )
}

// -------------------------------------------------------------------------
// Live mode (comfort header + current + 10-day + hourly + astro)
// -------------------------------------------------------------------------

function LiveMode({ childId }) {
  const [detail, setDetail] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)
  const [breakdownOpen, setBreakdownOpen] = useState(false)

  useEffect(() => {
    if (!childId) return
    let cancelled = false
    setLoading(true)
    setError(null)
    api
      .getChildWeatherDetail(childId)
      .then((data) => {
        if (!cancelled) setDetail(data)
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
  }, [childId])

  if (loading) return <div className="detail-loading">Loading forecast…</div>
  if (error) return <div className="detail-error">Couldn’t load detail: {error}</div>
  if (!detail) return null
  return (
    <>
      <DetailContent
        detail={detail}
        childId={childId}
        onOpenBreakdown={() => setBreakdownOpen(true)}
      />
      {breakdownOpen && (
        <ComfortBreakdownModal
          detail={detail}
          onClose={() => setBreakdownOpen(false)}
        />
      )}
    </>
  )
}

function DetailContent({ detail, childId, onOpenBreakdown }) {
  const current = detail.current || {}
  const today = detail.today || {}
  const astro = detail.astro || {}
  const hourly = Array.isArray(detail.hourly) ? detail.hourly : []
  const comfort = detail.comfort
  const alerts = detail.alerts || {}
  const bugRisk = detail.bug_risk
  const forecast = Array.isArray(detail.forecast_days) ? detail.forecast_days : []
  const child = detail.child || {}

  // Slice hourly to "from now (local) onward, next 24 hours".
  const nowEpoch = detail.location_localtime_epoch || Math.floor(Date.now() / 1000)
  const upcoming = hourly
    .filter((h) => h.time_epoch >= nowEpoch - 60 * 30) // include current hour
    .slice(0, 24)

  const alertTags = alertTagsFor(alerts, comfort?.composite)
  const humLabel = current.humidity != null ? humidityLabel(current.humidity) : null
  const comfortLabel = comfortScoreLabel(comfort?.composite)

  return (
    <>
      {comfort?.composite != null && (
        <section className="detail-comfort-row">
          <button
            type="button"
            className="detail-comfort-block"
            onClick={onOpenBreakdown}
            title="See how this score was calculated"
          >
            <ComfortBadge score={comfort.composite} size={48} />
            <span className="detail-comfort-label">{comfortLabel}</span>
            <span className="detail-comfort-hint">ⓘ</span>
          </button>
        </section>
      )}

      <div className="detail-grid">
        <section className="card detail-card">
          <div className="card-section-title">Current Conditions</div>
          <div className="detail-big-temp">
            {Math.round(current.temp_f)}°
            <span className="detail-feels">
              {' '}
              / {Math.round(current.feels_like_f)}° feels like
            </span>
          </div>
          <div className="detail-stats">
            {current.humidity != null && (
              <span>
                💧 Humidity: {Math.round(current.humidity)}%
                {humLabel && ` (${humLabel})`}
              </span>
            )}
            {current.wind_mph != null && (
              <span>💨 Wind: {Math.round(current.wind_mph)} mph</span>
            )}
            {bugRisk && <BugInd level={bugRisk} />}
          </div>
          {(alertTags.length > 0 || alerts?.bug_note) && (
            <div className="detail-alerts-list">
              {alertTags.map((t, i) => (
                <div key={i} className={`alert-tag ${t.cls}`}>
                  {t.label}
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="card detail-card">
          <div className="card-section-title">Today</div>
          <div className="detail-today-grid">
            <Stat
              label="High"
              value={today.high_f != null ? `${Math.round(today.high_f)}°` : '—'}
            />
            <Stat
              label="Low"
              value={today.low_f != null ? `${Math.round(today.low_f)}°` : '—'}
            />
            <Stat
              label="Rain chance"
              value={
                today.rain_chance_pct != null
                  ? `${today.rain_chance_pct}%`
                  : '—'
              }
            />
            <Stat
              label="Avg humidity"
              value={
                today.avg_humidity != null
                  ? `${Math.round(today.avg_humidity)}%`
                  : '—'
              }
            />
          </div>
          <div className="detail-astro">
            <AstroItem label="Sunrise" value={astro.sunrise} icon="🌅" />
            <AstroItem label="Sunset" value={astro.sunset} icon="🌇" />
            <AstroItem label="Moon" value={astro.moon_phase} icon="🌙" />
          </div>
        </section>
      </div>

      {forecast.length > 0 && (
        <section className="card detail-card">
          <div className="card-section-title">10-Day Forecast</div>
          <div className="table-wrapper">
            <table className="weekly-table">
              <thead>
                <tr>
                  <th>Day</th>
                  <th>Condition</th>
                  <th>High/Low</th>
                  <th>Humidity</th>
                  <th>Rain</th>
                  <th>Wind</th>
                </tr>
              </thead>
              <tbody>
                {forecast.map((d, i) => (
                  <tr key={d.date || i}>
                    <td>{shortDay(d.date, i)}</td>
                    <td>{d.condition || '—'}</td>
                    <td>
                      {d.high_f != null ? `${Math.round(d.high_f)}°` : '—'}
                      {' / '}
                      {d.low_f != null ? `${Math.round(d.low_f)}°` : '—'}
                    </td>
                    <td>
                      {d.avg_humidity != null
                        ? `${Math.round(d.avg_humidity)}%`
                        : '—'}
                    </td>
                    <td>
                      {d.rain_chance_pct != null
                        ? `${d.rain_chance_pct}%`
                        : '—'}
                    </td>
                    <td>
                      {d.max_wind_mph != null
                        ? `${Math.round(d.max_wind_mph)} mph`
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {childId && <TemperatureDistributionCard childId={childId} />}

      <section className="card detail-card detail-hourly-card">
        <div className="card-section-title">Next 24 hours</div>
        <div className="hourly-strip">
          {upcoming.length === 0 && (
            <div className="hourly-empty">No hourly data available.</div>
          )}
          {upcoming.map((h) => (
            <HourCard key={h.time_epoch} hour={h} />
          ))}
        </div>
      </section>

      {child?.id && <PlanningNotesCard child={child} />}
      {childId && <WeatherLogCaptureCard childId={childId} />}
      {childId && <WeatherLogsHistoryCard childId={childId} />}
    </>
  )
}

/**
 * Comfort score → short human label. Matches the prototype's labels
 * ("Great" / "Good" / "Moderate" / "Poor" / "Bad").
 */
function comfortScoreLabel(score) {
  if (score == null) return ''
  if (score >= 8) return 'Great'
  if (score >= 7) return 'Good'
  if (score >= 5) return 'Moderate'
  if (score >= 3) return 'Poor'
  return 'Bad'
}

function Stat({ label, value }) {
  return (
    <div className="detail-stat">
      <span className="detail-stat-label">{label}</span>
      <span className="detail-stat-value">{value}</span>
    </div>
  )
}

function AstroItem({ label, value, icon }) {
  return (
    <div className="detail-astro-item">
      <span className="detail-astro-icon" aria-hidden="true">
        {icon}
      </span>
      <div className="detail-astro-text">
        <span className="detail-astro-label">{label}</span>
        <span className="detail-astro-value">{value || '—'}</span>
      </div>
    </div>
  )
}

/** Bug indicator chip used in detail-stats. */
function BugInd({ level, note }) {
  const label = level.charAt(0).toUpperCase() + level.slice(1)
  return (
    <span className={`bug-ind ${level}`} title={note || ''}>
      🪲 {label}
    </span>
  )
}

// -------------------------------------------------------------------------
// Temperature Distribution card — histogram of recent daily highs
// -------------------------------------------------------------------------

function TemperatureDistributionCard({ childId }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!childId) return
    let cancelled = false
    setLoading(true)
    setError(null)
    api
      .getChildDistribution(childId)
      .then((d) => {
        if (!cancelled) setData(d)
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
  }, [childId])

  if (loading) {
    return (
      <section className="card detail-card">
        <div className="card-section-title">Temperature Distribution</div>
        <div className="detail-loading">Loading distribution…</div>
      </section>
    )
  }
  if (error) {
    // Keep a soft failure — the rest of the detail still works.
    return null
  }
  if (!data || !Array.isArray(data.bins) || data.samples_used === 0) {
    return null
  }

  const subLabel =
    data.samples_used >= 20
      ? `Based on last ${data.samples_used} days`
      : `Based on last ${data.samples_used} days (limited sample)`

  return (
    <section className="card detail-card">
      <div className="card-section-title">Temperature Distribution</div>
      <div className="card-section-sub">
        {subLabel}
        {data.most_likely && (
          <>
            . Most likely: <strong>{data.most_likely}</strong>
          </>
        )}
      </div>
      {data.bins.map((b) => (
        <div className="temp-dist-row" key={b.label}>
          <div className="temp-dist-label">
            <span>{b.label}</span>
            <strong>{b.pct}%</strong>
          </div>
          <div className="temp-dist-bar">
            <div
              className="temp-dist-segment"
              style={{ width: `${b.pct}%`, background: b.fill }}
            />
          </div>
        </div>
      ))}
      <div className="dist-legend">
        {data.avg_humidity != null && (
          <span>Avg humidity: {Math.round(data.avg_humidity)}%</span>
        )}
        {data.rain_days != null && <span>Rain days: {data.rain_days}/mo</span>}
      </div>
    </section>
  )
}

// -------------------------------------------------------------------------
// Editable planning notes — pencil → textarea → save
// -------------------------------------------------------------------------

function PlanningNotesCard({ child }) {
  const { refresh } = useLocationsStore()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(child.planning_notes || '')
  // Optimistic copy so the card shows the new value immediately after save,
  // without waiting for the detail payload to be refetched.
  const [current, setCurrent] = useState(child.planning_notes || '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  // Reset if a different child is loaded.
  useEffect(() => {
    setCurrent(child.planning_notes || '')
    if (!editing) setDraft(child.planning_notes || '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [child.id])

  const startEdit = () => {
    setDraft(current)
    setError(null)
    setEditing(true)
  }
  const cancel = () => {
    setEditing(false)
    setError(null)
  }
  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      const trimmed = draft.trim()
      await api.updateChild(child.id, { planning_notes: trimmed || null })
      setCurrent(trimmed)
      await refresh()
      setEditing(false)
    } catch (e) {
      setError(e.message || 'Save failed.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="card detail-card">
      <div className="editable-notes-head">
        <div className="card-section-title" style={{ margin: 0 }}>
          Planning notes
        </div>
        {!editing && (
          <button
            type="button"
            className="editable-notes-edit"
            onClick={startEdit}
            aria-label="Edit planning notes"
          >
            ✎ Edit
          </button>
        )}
      </div>
      {editing ? (
        <div className="editable-notes-block">
          <textarea
            className="editable-notes-textarea"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={4}
            placeholder="Anything worth remembering about this spot."
            autoFocus
          />
          {error && <div className="form-error">{error}</div>}
          <div className="editable-notes-actions">
            <button
              type="button"
              className="btn btn-ghost"
              onClick={cancel}
              disabled={saving}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={save}
              disabled={saving}
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      ) : current ? (
        <p className="editable-notes-text">{current}</p>
      ) : (
        <p className="editable-notes-empty">
          No notes yet — tap Edit to add one.
        </p>
      )}
    </section>
  )
}

// -------------------------------------------------------------------------
// Weather Log capture card — 3 rating rows + notes + submit
// -------------------------------------------------------------------------

const RATING_VALUES = ['up', 'neutral', 'down']
const RATING_ICON = { up: '👍', neutral: '—', down: '👎' }

function WeatherLogCaptureCard({ childId }) {
  // Bump this key to re-mount the history card after a successful save.
  const [historyKey, setHistoryKey] = useState(0)
  const [ratings, setRatings] = useState({
    temp: null,
    humidity: null,
    bug: null,
  })
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [justSaved, setJustSaved] = useState(false)
  const [error, setError] = useState(null)

  const setR = (key, value) =>
    setRatings((r) => ({ ...r, [key]: r[key] === value ? null : value }))

  const submit = async () => {
    setSubmitting(true)
    setError(null)
    try {
      await api.createChildLog(childId, {
        temp_rating: ratings.temp,
        humidity_rating: ratings.humidity,
        bug_rating: ratings.bug,
        note: note.trim() || null,
      })
      setRatings({ temp: null, humidity: null, bug: null })
      setNote('')
      setJustSaved(true)
      setHistoryKey((k) => k + 1)
      // History card listens on the same event via a custom event below.
      window.dispatchEvent(new CustomEvent('mygration:log-saved', { detail: { childId } }))
      setTimeout(() => setJustSaved(false), 2500)
    } catch (e) {
      setError(e.message || 'Save failed.')
    } finally {
      setSubmitting(false)
    }
  }

  const anyRating = Object.values(ratings).some(Boolean) || note.trim().length > 0

  return (
    <section className="card detail-card">
      <div className="quick-log">
        <div className="log-title">📝 Log Today's Conditions</div>
        <div className="log-subtitle">
          How does it actually feel compared to the forecast?
        </div>
        <LogRatingRow label="Temp" value={ratings.temp} onChange={(v) => setR('temp', v)} />
        <LogRatingRow
          label="Humidity"
          value={ratings.humidity}
          onChange={(v) => setR('humidity', v)}
        />
        <LogRatingRow label="Bugs" value={ratings.bug} onChange={(v) => setR('bug', v)} />
        <textarea
          className="log-notes"
          rows={3}
          placeholder="Add notes… (e.g., 'afternoon turned muggy, hard to stay in the van')"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        {error && <div className="form-error">{error}</div>}
        {justSaved ? (
          <div className="log-submitted">✓ Logged!</div>
        ) : (
          <button
            type="button"
            className="btn btn-primary log-submit"
            disabled={submitting || !anyRating}
            onClick={submit}
          >
            {submitting ? 'Saving…' : '📤 Save Log Entry'}
          </button>
        )}
      </div>
    </section>
  )
}

function LogRatingRow({ label, value, onChange }) {
  return (
    <div className="log-rating-row">
      <span className="log-rating-label">{label}</span>
      <div className="log-rating-buttons">
        {RATING_VALUES.map((v) => (
          <button
            key={v}
            type="button"
            className={`log-rating-btn${value === v ? ` sel-${v}` : ''}`}
            onClick={() => onChange(v)}
            aria-pressed={value === v}
            aria-label={`${label} ${v}`}
          >
            {RATING_ICON[v]}
          </button>
        ))}
      </div>
    </div>
  )
}

// -------------------------------------------------------------------------
// Weather Logs history — list of past entries
// -------------------------------------------------------------------------

function WeatherLogsHistoryCard({ childId }) {
  const [logs, setLogs] = useState(null)
  const [error, setError] = useState(null)

  const load = () => {
    if (!childId) return
    api
      .listChildLogs(childId)
      .then(setLogs)
      .catch((e) => setError(e.message))
  }

  useEffect(() => {
    load()
    // Refresh when a log is saved in the capture card.
    const handler = (e) => {
      if (!e.detail || e.detail.childId === childId) load()
    }
    window.addEventListener('mygration:log-saved', handler)
    return () => window.removeEventListener('mygration:log-saved', handler)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [childId])

  const onDelete = async (id) => {
    if (!window.confirm('Delete this log entry?')) return
    try {
      await api.deleteLog(id)
      load()
    } catch (e) {
      window.alert(`Delete failed: ${e.message}`)
    }
  }

  if (error) return null
  if (logs == null) return null

  return (
    <section className="card detail-card">
      <div className="card-section-title">Your Weather Logs</div>
      {logs.length === 0 ? (
        <p className="no-logs">No logs yet — log today's conditions above.</p>
      ) : (
        <div className="logs-list">
          {logs.map((log) => (
            <LogEntry key={log.id} log={log} onDelete={() => onDelete(log.id)} />
          ))}
        </div>
      )}
    </section>
  )
}

function LogEntry({ log, onDelete }) {
  const dateLabel = formatLogDate(log.logged_at)
  return (
    <div className="log-entry">
      <div className="log-date">📅 {dateLabel}</div>
      <button
        type="button"
        className="log-delete"
        onClick={onDelete}
        aria-label="Delete log entry"
        title="Delete log"
      >
        ×
      </button>
      <div className="log-ratings">
        <span>Temp: {RATING_ICON[log.temp_rating] || '—'}</span>
        <span>Humidity: {RATING_ICON[log.humidity_rating] || '—'}</span>
        <span>Bugs: {RATING_ICON[log.bug_rating] || '—'}</span>
      </div>
      {log.note && <p className="log-note">"{log.note}"</p>}
    </div>
  )
}

/** "2026-04-18T14:03:00" → "Apr 18, 2026" */
function formatLogDate(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

/**
 * Comfort score breakdown modal. Tap the comfort block to open.
 * Mirrors the prototype's modal: per-factor subscores + composite + a
 * paragraph of explanatory text.
 */
function ComfortBreakdownModal({ detail, onClose }) {
  const comfort = detail.comfort || {}
  const alerts = detail.alerts || {}
  const bugRisk = detail.bug_risk
  const composite = comfort.composite

  // Stop Escape from bubbling to the outer detail-close.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-content"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h3 className="modal-title">Comfort Score Breakdown</h3>
          <button
            type="button"
            className="modal-close"
            onClick={onClose}
            aria-label="Close breakdown"
          >
            ×
          </button>
        </div>
        <BreakdownRow label="Temperature" value={comfort.temperature} />
        <BreakdownRow
          label="Humidity (heaviest weight)"
          value={comfort.humidity}
        />
        <BreakdownRow label="Rain" value={comfort.rain} />
        <BreakdownRow label="Wind" value={comfort.wind} />
        <BreakdownRow
          label="Overall score"
          value={composite}
          emphasize
        />
        <p className="breakdown-note">
          The comfort score combines humidity, temperature, rain, and wind,
          weighted by how much each actually affects your day. Humidity has the
          heaviest influence.
          {(bugRisk === 'high' || bugRisk === 'severe') && (
            <> Bug levels are a significant concern right now.</>
          )}
          {alerts.extended_heat && <> Extended heat is in the forecast.</>}
          {alerts.extended_cold && <> Cold nights may require prep.</>}
        </p>
      </div>
    </div>
  )
}

function BreakdownRow({ label, value, emphasize }) {
  const display = value != null ? `${value.toFixed(1)}/10` : '—'
  return (
    <div className="breakdown-row">
      <span className="breakdown-label">{label}</span>
      <span className={`breakdown-score${emphasize ? ' emphasize' : ''}`}>
        {display}
      </span>
    </div>
  )
}

/** "2026-04-19" → "Sun". First row becomes "Today" for clarity. */
function shortDay(date, idx) {
  if (idx === 0) return 'Today'
  if (!date) return ''
  const d = typeof date === 'string' ? new Date(date + 'T00:00:00') : date
  if (Number.isNaN(d?.getTime?.())) return String(date).slice(0, 3)
  return d.toLocaleDateString(undefined, { weekday: 'short' })
}

/**
 * A single hour in the horizontal strip.
 */
function HourCard({ hour }) {
  const label = formatHourLabel(hour.time)
  const icon = conditionEmoji(hour.condition_code, hour.is_day)
  return (
    <div className="hour-card">
      <span className="hour-label">{label}</span>
      <span className="hour-icon" aria-hidden="true">
        {icon}
      </span>
      <span className="hour-temp">{Math.round(hour.temp_f)}°</span>
      {hour.chance_of_rain >= 20 && (
        <span className="hour-rain">{hour.chance_of_rain}%</span>
      )}
      <span className="hour-wind">
        {Math.round(hour.wind_mph)} {hour.wind_dir}
      </span>
    </div>
  )
}

/** "2026-04-17 06:00" → "6 AM" */
function formatHourLabel(time) {
  if (!time || typeof time !== 'string') return ''
  const parts = time.split(' ')
  if (parts.length !== 2) return time
  const [hh] = parts[1].split(':')
  const h = Number(hh)
  if (Number.isNaN(h)) return parts[1]
  if (h === 0) return '12 AM'
  if (h === 12) return '12 PM'
  return h < 12 ? `${h} AM` : `${h - 12} PM`
}

/** Map WeatherAPI condition codes to emoji. */
function conditionEmoji(code, isDay) {
  if (code == null) return ''
  if (code === 1000) return isDay ? '☀️' : '🌙'
  if ([1003, 1006].includes(code)) return isDay ? '⛅' : '☁️'
  if (code === 1009) return '☁️'
  if ([1030, 1135, 1147].includes(code)) return '🌫️'
  if (
    [
      1063, 1150, 1153, 1168, 1171, 1180, 1183, 1186, 1189, 1192, 1195, 1240,
      1243, 1246, 1198, 1201, 1072, 1087,
    ].includes(code)
  )
    return '🌧️'
  if ([1273, 1276, 1279, 1282].includes(code)) return '⛈️'
  if (
    [
      1066, 1069, 1114, 1117, 1204, 1207, 1210, 1213, 1216, 1219, 1222, 1225,
      1237, 1249, 1252, 1255, 1258, 1261, 1264,
    ].includes(code)
  )
    return '❄️'
  return '☁️'
}

// -------------------------------------------------------------------------
// Historical mode (Future Planning): month picker + digest
// -------------------------------------------------------------------------

const MONTHS = [
  { num: 1, short: 'Jan', long: 'January' },
  { num: 2, short: 'Feb', long: 'February' },
  { num: 3, short: 'Mar', long: 'March' },
  { num: 4, short: 'Apr', long: 'April' },
  { num: 5, short: 'May', long: 'May' },
  { num: 6, short: 'Jun', long: 'June' },
  { num: 7, short: 'Jul', long: 'July' },
  { num: 8, short: 'Aug', long: 'August' },
  { num: 9, short: 'Sep', long: 'September' },
  { num: 10, short: 'Oct', long: 'October' },
  { num: 11, short: 'Nov', long: 'November' },
  { num: 12, short: 'Dec', long: 'December' },
]

function HistoricalMode({ child }) {
  const [month, setMonth] = useState(() => new Date().getMonth() + 1)
  const [digest, setDigest] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!child?.id || !month) return
    let cancelled = false
    setLoading(true)
    setError(null)
    setDigest(null)
    api
      .getChildHistorical(child.id, month)
      .then((data) => {
        if (!cancelled) setDigest(data)
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
  }, [child?.id, month])

  const selectedMonthMeta = MONTHS.find((m) => m.num === month)

  return (
    <>
      <section className="historical-intro">
        <p className="historical-blurb">
          Pick a month to see what the weather here was like in that month last
          year. Four sample days per month — enough to spot the shape without
          burning API calls.
        </p>
      </section>

      <section className="historical-months">
        <div className="historical-months-grid">
          {MONTHS.map((m) => (
            <button
              key={m.num}
              type="button"
              className={`historical-month-chip${month === m.num ? ' selected' : ''}`}
              onClick={() => setMonth(m.num)}
              aria-pressed={month === m.num}
            >
              {m.short}
            </button>
          ))}
        </div>
      </section>

      {loading && (
        <div className="detail-loading">
          Loading historical data for {selectedMonthMeta?.long}…
        </div>
      )}
      {error && (
        <div className="detail-error">
          Couldn’t load historical data: {error}
        </div>
      )}
      {digest && (
        <HistoricalDigest digest={digest} monthLabel={selectedMonthMeta?.long} />
      )}
    </>
  )
}

function HistoricalDigest({ digest, monthLabel }) {
  const agg = digest.aggregate || {}
  const samples = Array.isArray(digest.samples) ? digest.samples : []
  const errors = Array.isArray(digest.errors) ? digest.errors : []
  const hasSamples = samples.length > 0
  const needsPaidPlan =
    !hasSamples &&
    errors.some((e) => /403|denied|not subscribed|only.*day/i.test(e))

  if (!hasSamples) {
    return (
      <section className="historical-empty">
        <h3 className="detail-section-title">No samples available</h3>
        {needsPaidPlan ? (
          <p className="historical-blurb">
            WeatherAPI’s historical data isn’t available on the current plan.
            Upgrading the API key unlocks this view; until then, live forecasts
            still work for Active and Watching spots.
          </p>
        ) : (
          <p className="historical-blurb">
            All four sample days returned errors. This can happen if the
            coordinates are far from any reporting station.
          </p>
        )}
        {errors.length > 0 && (
          <details className="historical-error-details">
            <summary>Details</summary>
            <ul>
              {errors.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          </details>
        )}
      </section>
    )
  }

  return (
    <>
      <section className="historical-summary">
        <h3 className="detail-section-title">
          Typical {monthLabel} · sampled from {digest.sampled_year}
        </h3>
        <div className="detail-today-grid">
          <Stat
            label="Avg high"
            value={agg.avg_high_f != null ? `${Math.round(agg.avg_high_f)}°` : '—'}
          />
          <Stat
            label="Avg low"
            value={agg.avg_low_f != null ? `${Math.round(agg.avg_low_f)}°` : '—'}
          />
          <Stat
            label="Avg humidity"
            value={agg.avg_humidity != null ? `${Math.round(agg.avg_humidity)}%` : '—'}
          />
          <Stat
            label="Avg rain"
            value={agg.avg_precip_in != null ? `${agg.avg_precip_in}"` : '—'}
          />
        </div>
        {agg.typical_condition && (
          <p className="historical-typical">
            Typical condition: <strong>{agg.typical_condition}</strong>
            {agg.avg_max_wind_mph != null && (
              <>
                {' '}· Avg max wind{' '}
                <strong>{Math.round(agg.avg_max_wind_mph)} mph</strong>
              </>
            )}
          </p>
        )}
      </section>

      <section className="historical-samples">
        <h3 className="detail-section-title">Sample days</h3>
        <div className="historical-sample-grid">
          {samples.map((s) => (
            <SampleDay key={s.date} sample={s} />
          ))}
        </div>
      </section>

      {errors.length > 0 && (
        <details className="historical-error-details">
          <summary>
            {errors.length} of {errors.length + samples.length} days unavailable
          </summary>
          <ul>
            {errors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </details>
      )}
    </>
  )
}

function SampleDay({ sample }) {
  const icon = conditionEmoji(sample.condition_code, 1)
  const dayLabel = formatSampleDate(sample.date)
  return (
    <div className="historical-sample">
      <div className="historical-sample-head">
        <span className="historical-sample-date">{dayLabel}</span>
        <span className="historical-sample-icon" aria-hidden="true">
          {icon}
        </span>
      </div>
      <div className="historical-sample-temp">
        {sample.high_f != null ? `${Math.round(sample.high_f)}°` : '—'}
        <span className="historical-sample-low">
          {' '}
          / {sample.low_f != null ? `${Math.round(sample.low_f)}°` : '—'}
        </span>
      </div>
      <div className="historical-sample-meta">
        {sample.condition && (
          <span className="historical-sample-condition">{sample.condition}</span>
        )}
        <span className="historical-sample-stats">
          {sample.avg_humidity != null && (
            <>💧 {Math.round(sample.avg_humidity)}% </>
          )}
          {sample.max_wind_mph != null && (
            <>🌬 {Math.round(sample.max_wind_mph)}mph</>
          )}
        </span>
      </div>
    </div>
  )
}

/** "2025-07-18" → "Jul 18" */
function formatSampleDate(dateStr) {
  if (!dateStr) return ''
  const [, mm, dd] = dateStr.split('-')
  const short = MONTHS.find((m) => m.num === Number(mm))?.short
  return short ? `${short} ${Number(dd)}` : dateStr
}
