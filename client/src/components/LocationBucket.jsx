import { useEffect, useState } from 'react'
import { api } from '../api.js'
import { usePersistedState } from '../hooks/usePersistedState.js'
import { useLocationsStore } from '../hooks/useLocationsStore.jsx'
import { useSelectedChild } from '../hooks/useSelectedChild.jsx'
import { ComfortBadge } from './ComfortBadge.jsx'
import {
  LocationCard,
  alertTagsFor,
  humidityClass,
  humidityLabel,
} from './LocationCard.jsx'

/**
 * A dashboard bucket: Active / Watching / Future Planning.
 *
 * Buckets never collapse anymore (prototype doesn't have the chevron /
 * hidden-content pattern). They always show:
 *   - section-header with title, count, layout toggle, "+ Add Location"
 *   - either a card grid or a table (layout toggle persisted per bucket)
 *
 * Parent areas are no longer rendered as containers; their children are
 * flattened into a single card grid. Each card's `card-city` label shows
 * the parent area's name so the relationship stays visible.
 *
 * Bucket quirks:
 *   - Watching: no layout toggle, always cards, always uses the dashed
 *     `.watching-card` variant with the user's seasonal note.
 *   - Future Planning: cards render in 'historical' mode (no live weather,
 *     no 5-day mini, just name + parent + "tap to research" hint). Clicking
 *     still opens the detail modal in historical mode.
 *   - Active: classic live mode — full weather card.
 */
export function LocationBucket({ bucketKey, title, areas }) {
  const { openAddParent } = useLocationsStore()

  // Layout toggle — persist per-bucket. Watching bucket ignores this.
  const [layout, setLayout] = usePersistedState(
    `mygration.bucket.${bucketKey}.layout`,
    'card'
  )

  // Flatten parent→child into a list of child-with-parent-name so the
  // card/table loops don't have to nest.
  const flatChildren = []
  for (const area of areas || []) {
    for (const child of area.children || []) {
      flatChildren.push({ ...child, _parentName: area.name, _parentArea: area })
    }
  }

  const childCount = flatChildren.length
  const mode =
    bucketKey === 'watching'
      ? 'watching'
      : bucketKey === 'future_planning'
      ? 'historical'
      : 'live'
  const showToggle = bucketKey === 'active' || bucketKey === 'future_planning'

  const handleAdd = () => openAddParent(bucketKey)

  return (
    <section className={`bucket bucket-${bucketKey}`}>
      <div className="section-header">
        <div>
          <h2 className="section-title">{title}</h2>
          <span className="section-sub">
            {childCount} location{childCount === 1 ? '' : 's'} tracked
          </span>
        </div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          {showToggle && (
            <div className="toggle-group" role="tablist" aria-label="Layout">
              <button
                type="button"
                className={`toggle-btn ${layout === 'card' ? 'active' : ''}`}
                onClick={() => setLayout('card')}
              >
                ▥ Cards
              </button>
              <button
                type="button"
                className={`toggle-btn ${layout === 'table' ? 'active' : ''}`}
                onClick={() => setLayout('table')}
              >
                ≡ Table
              </button>
            </div>
          )}
          <button type="button" className="btn btn-primary" onClick={handleAdd}>
            + Add Location
          </button>
        </div>
      </div>

      {childCount === 0 ? (
        <div className="card" style={{ textAlign: 'center', color: '#64748b' }}>
          No locations here yet.{' '}
          <button
            type="button"
            className="btn btn-ghost"
            style={{ marginLeft: 8 }}
            onClick={handleAdd}
          >
            Add one
          </button>
        </div>
      ) : bucketKey === 'watching' ? (
        <div className="watching-grid">
          {flatChildren.map((child) => (
            <LocationCard
              key={child.id}
              child={child}
              parentName={child._parentName}
              mode="watching"
            />
          ))}
        </div>
      ) : layout === 'table' && showToggle ? (
        <BucketTable mode={mode} rows={flatChildren} />
      ) : (
        <div className="card-grid">
          {flatChildren.map((child) => (
            <LocationCard
              key={child.id}
              child={child}
              parentName={child._parentName}
              mode={mode}
            />
          ))}
        </div>
      )}
    </section>
  )
}

/**
 * Table layout for Active / Future Planning buckets. For live mode we fetch
 * each child's weather (same endpoint LocationCard uses) and render the
 * columns from the prototype. For historical mode we skip the weather fetch
 * and only show Location + a "historical mode" placeholder.
 */
function BucketTable({ mode, rows }) {
  return (
    <div className="table-wrapper">
      <table className="location-table">
        <thead>
          <tr>
            <th>Location</th>
            {mode === 'live' ? (
              <>
                <th>Comfort</th>
                <th>Temp/Feels</th>
                <th>Humidity</th>
                <th>Wind</th>
                <th>Bugs</th>
                <th>Alerts</th>
                <th>5-Day Highs</th>
              </>
            ) : (
              <th>Historical</th>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((child) => (
            <BucketTableRow key={child.id} child={child} mode={mode} />
          ))}
        </tbody>
      </table>
    </div>
  )
}

function BucketTableRow({ child, mode }) {
  const { setSelectedChild } = useSelectedChild()
  const [weather, setWeather] = useState(null)
  const [loading, setLoading] = useState(mode === 'live')
  const [error, setError] = useState(null)

  useEffect(() => {
    if (mode !== 'live') return
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
  }, [child.id, mode])

  const onClick = () =>
    setSelectedChild(child, mode === 'historical' ? 'historical' : 'live')

  if (mode === 'historical') {
    return (
      <tr className="table-row" onClick={onClick}>
        <td>
          <div className="cell-name">
            <div>{child.name}</div>
            <span className="cell-city">{child._parentName}</span>
          </div>
        </td>
        <td>
          <span style={{ color: '#64748b', fontStyle: 'italic' }}>
            Tap to research past conditions →
          </span>
        </td>
      </tr>
    )
  }

  const current = weather?.current
  const comfort = weather?.comfort
  const alerts = weather?.alerts || {}
  const bugRisk = weather?.bug_risk
  const forecast = weather?.forecast_days || []
  const tags = alertTagsFor(alerts, comfort?.composite)

  return (
    <tr className="table-row" onClick={onClick}>
      <td>
        <div className="cell-name">
          <div>{child.name}</div>
          <span className="cell-city">{child._parentName}</span>
        </div>
      </td>
      <td>
        {comfort?.composite != null && (
          <ComfortBadge score={comfort.composite} size={30} />
        )}
      </td>
      <td>
        {loading ? (
          <span style={{ color: '#64748b' }}>…</span>
        ) : error || !current ? (
          <span style={{ color: '#64748b' }}>—</span>
        ) : (
          <>
            <span className="temp-main">{Math.round(current.temp_f)}°</span>
            <span className="temp-sub"> / {Math.round(current.feels_like_f)}°</span>
          </>
        )}
      </td>
      <td>
        {current ? (
          <>
            {Math.round(current.humidity)}%
            <span className={`humidity-sub ${humidityClass(current.humidity)}`}>
              {humidityLabel(current.humidity)}
            </span>
          </>
        ) : (
          '—'
        )}
      </td>
      <td>{current ? `${Math.round(current.wind_mph)} mph` : '—'}</td>
      <td>
        {bugRisk ? (
          <span className={`bug-ind ${bugRisk}`}>
            🪲 {bugRisk.charAt(0).toUpperCase() + bugRisk.slice(1)}
          </span>
        ) : (
          '—'
        )}
      </td>
      <td>
        {tags.length > 0 ? (
          <div className="alert-tags">
            {tags.map((t, i) => (
              <span key={i} className={`alert-tag ${t.cls}`}>
                {t.label}
              </span>
            ))}
          </div>
        ) : (
          '—'
        )}
      </td>
      <td>
        {forecast.slice(0, 5).map((d, i) => (
          <span key={d.date || i} className="inline-day">
            {Math.round(d.high_f)}°
          </span>
        ))}
      </td>
    </tr>
  )
}
