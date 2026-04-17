import { useEffect, useState } from 'react'
import { api } from '../api.js'
import { useSelectedChild } from '../hooks/useSelectedChild.jsx'

/**
 * Drill-in detail view for a single child location.
 *
 * Rendered as a full-screen modal (drawer on mobile). Triggered by clicking a
 * child row on the dashboard. Shows:
 *   - Current conditions header (temp, feels-like, condition, wind)
 *   - Today's summary (high/low/rain chance/total precip)
 *   - Astro block (sunrise, sunset, moon)
 *   - Hourly strip (next ~24h: hour, icon, temp, rain %, wind)
 *
 * Per Stephanie's Phase 1 test plan: she wants to see hourly mornings/evenings
 * (clear or overcast), sunrise/sunset for photography planning, and wind dir.
 *
 * Data source: GET /api/children/:id/weather/detail (backed by the same
 * WeatherAPI forecast cache as the dashboard, so no extra upstream call).
 */
export function LocationDetail() {
  const { selectedChild, setSelectedChild } = useSelectedChild()
  const [detail, setDetail] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)

  const childId = selectedChild?.id

  // Fetch detail when a new child is selected; reset when closed.
  useEffect(() => {
    if (!childId) {
      setDetail(null)
      setError(null)
      return
    }
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
      <div className="detail-panel" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <header className="detail-header">
          <div>
            <h2 className="detail-title">{selectedChild.name}</h2>
            <p className="detail-coords">
              {selectedChild.lat.toFixed(3)}, {selectedChild.lng.toFixed(3)}
            </p>
          </div>
          <button type="button" className="detail-close" onClick={close} aria-label="Close detail view">
            ×
          </button>
        </header>

        <div className="detail-body">
          {loading && <div className="detail-loading">Loading forecast…</div>}
          {error && <div className="detail-error">Couldn’t load detail: {error}</div>}
          {detail && <DetailContent detail={detail} />}
        </div>
      </div>
    </div>
  )
}

function DetailContent({ detail }) {
  const current = detail.current || {}
  const today = detail.today || {}
  const astro = detail.astro || {}
  const hourly = Array.isArray(detail.hourly) ? detail.hourly : []

  // Slice hourly to "from now (local) onward, next 24 hours".
  const nowEpoch = detail.location_localtime_epoch || Math.floor(Date.now() / 1000)
  const upcoming = hourly
    .filter((h) => h.time_epoch >= nowEpoch - 60 * 30)  // include current hour
    .slice(0, 24)

  return (
    <>
      <section className="detail-now">
        <div className="detail-now-main">
          <span className="detail-temp">{Math.round(current.temp_f)}°</span>
          <div className="detail-now-meta">
            <span className="detail-condition">{current.condition}</span>
            <span className="detail-feels">
              feels like {Math.round(current.feels_like_f)}°
            </span>
          </div>
        </div>
        <div className="detail-now-side">
          <WindBlock speed={current.wind_mph} dir={current.wind_dir} degree={current.wind_degree} />
        </div>
      </section>

      <section className="detail-today-grid">
        <Stat label="High" value={today.high_f != null ? `${Math.round(today.high_f)}°` : '—'} />
        <Stat label="Low" value={today.low_f != null ? `${Math.round(today.low_f)}°` : '—'} />
        <Stat label="Rain chance" value={today.rain_chance_pct != null ? `${today.rain_chance_pct}%` : '—'} />
        <Stat label="Humidity" value={today.avg_humidity != null ? `${Math.round(today.avg_humidity)}%` : '—'} />
      </section>

      <section className="detail-astro">
        <AstroItem label="Sunrise" value={astro.sunrise} icon="🌅" />
        <AstroItem label="Sunset" value={astro.sunset} icon="🌇" />
        <AstroItem label="Moon" value={astro.moon_phase} icon="🌙" />
      </section>

      <section className="detail-hourly">
        <h3 className="detail-section-title">Next 24 hours</h3>
        <div className="hourly-strip">
          {upcoming.length === 0 && (
            <div className="hourly-empty">No hourly data available.</div>
          )}
          {upcoming.map((h) => (
            <HourCard key={h.time_epoch} hour={h} />
          ))}
        </div>
      </section>
    </>
  )
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
      <span className="detail-astro-icon" aria-hidden="true">{icon}</span>
      <div className="detail-astro-text">
        <span className="detail-astro-label">{label}</span>
        <span className="detail-astro-value">{value || '—'}</span>
      </div>
    </div>
  )
}

/** Wind with a rotating arrow pointing in the compass direction wind is coming FROM.
 *  WeatherAPI's `wind_degree` is the direction wind is blowing FROM — so we add 180
 *  for an arrow that points where the wind is going TO, which is more intuitive.
 */
function WindBlock({ speed, dir, degree }) {
  if (speed == null) return null
  const rotate = typeof degree === 'number' ? (degree + 180) % 360 : null
  return (
    <div className="wind-block" title={`Wind ${dir || ''} at ${Math.round(speed)} mph`}>
      {rotate !== null && (
        <span className="wind-arrow" style={{ transform: `rotate(${rotate}deg)` }} aria-hidden="true">
          ↑
        </span>
      )}
      <div className="wind-text">
        <span className="wind-speed">{Math.round(speed)} mph</span>
        <span className="wind-dir">{dir || ''}</span>
      </div>
    </div>
  )
}

/**
 * A single hour in the horizontal strip.
 *
 * Picks an emoji based on WeatherAPI's condition code + is_day — keeps it
 * dependency-free (no icon lib). Stephanie flagged mornings/evenings as the
 * key times, so we always show the hour label prominently.
 */
function HourCard({ hour }) {
  const label = formatHourLabel(hour.time)
  const icon = conditionEmoji(hour.condition_code, hour.is_day)
  return (
    <div className="hour-card">
      <span className="hour-label">{label}</span>
      <span className="hour-icon" aria-hidden="true">{icon}</span>
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

/** Map WeatherAPI condition codes to emoji. Sparse on purpose — we only care
 *  about the broad buckets (clear / cloud / rain / snow / thunder / fog).
 *  Full list at https://www.weatherapi.com/docs/weather_conditions.json.
 */
function conditionEmoji(code, isDay) {
  if (code == null) return ''
  // Clear / sunny
  if (code === 1000) return isDay ? '☀️' : '🌙'
  // Partly / overcast
  if ([1003, 1006].includes(code)) return isDay ? '⛅' : '☁️'
  if (code === 1009) return '☁️'
  // Mist / fog
  if ([1030, 1135, 1147].includes(code)) return '🌫️'
  // Rain (all the various drizzle/rain/shower codes)
  if ([
    1063, 1150, 1153, 1168, 1171, 1180, 1183, 1186, 1189, 1192, 1195,
    1240, 1243, 1246, 1198, 1201, 1072, 1087,
  ].includes(code)) return '🌧️'
  // Thunder
  if ([1273, 1276, 1279, 1282, 1087].includes(code)) return '⛈️'
  // Snow / sleet
  if ([
    1066, 1069, 1114, 1117, 1204, 1207, 1210, 1213, 1216, 1219, 1222, 1225,
    1237, 1249, 1252, 1255, 1258, 1261, 1264,
  ].includes(code)) return '❄️'
  return '☁️'
}
