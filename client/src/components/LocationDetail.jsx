import { useEffect, useState } from 'react'
import { api } from '../api.js'
import { useSelectedChild } from '../hooks/useSelectedChild.jsx'

/**
 * Drill-in detail view for a single child location.
 *
 * Two modes depending on which bucket the row came from:
 *   - live:       current conditions, today stats, astro, next 24h hourly
 *                 (Active + Watching — fed by /weather/detail)
 *   - historical: pick a month → aggregate digest from the same month last year
 *                 + 4 sample days (Future Planning — fed by /weather/historical)
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
// Live mode (current conditions + hourly + astro)
// -------------------------------------------------------------------------

function LiveMode({ childId }) {
  const [detail, setDetail] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)

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
  return <DetailContent detail={detail} />
}

function DetailContent({ detail }) {
  const current = detail.current || {}
  const today = detail.today || {}
  const astro = detail.astro || {}
  const hourly = Array.isArray(detail.hourly) ? detail.hourly : []

  // Slice hourly to "from now (local) onward, next 24 hours".
  const nowEpoch = detail.location_localtime_epoch || Math.floor(Date.now() / 1000)
  const upcoming = hourly
    .filter((h) => h.time_epoch >= nowEpoch - 60 * 30) // include current hour
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
          <WindBlock
            speed={current.wind_mph}
            dir={current.wind_dir}
            degree={current.wind_degree}
          />
        </div>
      </section>

      <section className="detail-today-grid">
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
            today.rain_chance_pct != null ? `${today.rain_chance_pct}%` : '—'
          }
        />
        <Stat
          label="Humidity"
          value={
            today.avg_humidity != null ? `${Math.round(today.avg_humidity)}%` : '—'
          }
        />
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
        <span
          className="wind-arrow"
          style={{ transform: `rotate(${rotate}deg)` }}
          aria-hidden="true"
        >
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
  if (
    [
      1063, 1150, 1153, 1168, 1171, 1180, 1183, 1186, 1189, 1192, 1195, 1240,
      1243, 1246, 1198, 1201, 1072, 1087,
    ].includes(code)
  )
    return '🌧️'
  // Thunder
  if ([1273, 1276, 1279, 1282, 1087].includes(code)) return '⛈️'
  // Snow / sleet
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
  // Default to the current month — likely the most immediately useful pick.
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
