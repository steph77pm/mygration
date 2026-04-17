import { useEffect, useRef, useState } from 'react'
import { api } from '../api.js'
import { useLocationsStore } from '../hooks/useLocationsStore.jsx'

/**
 * Unified form modal for CRUD on parent areas and child locations.
 *
 * Modes:
 *   - add-parent:    new ParentArea (name + bucket + notes + optional central coords)
 *   - edit-parent:   same fields, pre-filled from existing area
 *   - add-child:     new ChildLocation under a given parent (name + lat/lng + notes)
 *   - edit-child:    same fields, pre-filled
 *
 * Location picker: search-as-you-type via /api/geocode/search, which proxies
 * WeatherAPI's search.json. Pick a result to auto-fill coordinates (+ name
 * if blank). Manual lat/lng entry still works for offline use or exact GPS.
 */
export function LocationFormModal() {
  const {
    modalState,
    closeModal,
    refresh,
  } = useLocationsStore()

  if (!modalState) return null

  const { mode } = modalState

  // Single implementation; mode determines fields and submit target.
  return (
    <div className="detail-overlay" onClick={closeModal}>
      <div
        className="form-modal"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <Header mode={mode} parentName={modalState.parentName} onClose={closeModal} />
        <FormBody modalState={modalState} onClose={closeModal} onSaved={refresh} />
      </div>
    </div>
  )
}

function Header({ mode, parentName, onClose }) {
  const title = {
    'add-parent': 'New area',
    'edit-parent': 'Edit area',
    'add-child': `New spot${parentName ? ` in ${parentName}` : ''}`,
    'edit-child': 'Edit spot',
  }[mode]
  return (
    <header className="detail-header">
      <div>
        <h2 className="detail-title">{title}</h2>
      </div>
      <button type="button" className="detail-close" onClick={onClose} aria-label="Close form">
        ×
      </button>
    </header>
  )
}

function FormBody({ modalState, onClose, onSaved }) {
  const { mode } = modalState
  const isParent = mode === 'add-parent' || mode === 'edit-parent'
  const isEdit = mode === 'edit-parent' || mode === 'edit-child'

  // Seed form state from the item we're editing, if any.
  const seed = (() => {
    if (mode === 'edit-parent') {
      return {
        name: modalState.area.name || '',
        bucket: modalState.area.bucket || 'active',
        planning_notes: modalState.area.planning_notes || '',
        lat: modalState.area.central_lat ?? '',
        lng: modalState.area.central_lng ?? '',
      }
    }
    if (mode === 'edit-child') {
      return {
        name: modalState.child.name || '',
        planning_notes: modalState.child.planning_notes || '',
        lat: modalState.child.lat ?? '',
        lng: modalState.child.lng ?? '',
      }
    }
    if (mode === 'add-parent') {
      return { name: '', bucket: modalState.bucket || 'active', planning_notes: '', lat: '', lng: '' }
    }
    return { name: '', planning_notes: '', lat: '', lng: '' }
  })()

  const [form, setForm] = useState(seed)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })

  // Called by the LocationPicker when user selects a search result.
  const applyPick = (pick) => {
    setForm((prev) => ({
      ...prev,
      name: prev.name || pick.name,
      lat: pick.lat,
      lng: pick.lon,
    }))
  }

  const submit = async (e) => {
    e.preventDefault()
    setError(null)
    const name = (form.name || '').trim()
    if (!name) return setError('Name is required.')

    const toNum = (v) => (v === '' || v == null ? null : Number(v))
    const lat = toNum(form.lat)
    const lng = toNum(form.lng)

    if (!isParent) {
      // Children require coordinates.
      if (lat == null || Number.isNaN(lat)) return setError('Latitude is required for a spot.')
      if (lng == null || Number.isNaN(lng)) return setError('Longitude is required for a spot.')
    } else if ((lat != null || lng != null) && (lat == null || lng == null)) {
      return setError('Provide both latitude and longitude, or leave both blank.')
    }
    if (lat != null && (lat < -90 || lat > 90)) return setError('Latitude must be between -90 and 90.')
    if (lng != null && (lng < -180 || lng > 180)) return setError('Longitude must be between -180 and 180.')

    setSubmitting(true)
    try {
      if (mode === 'add-parent') {
        await api.createParent({
          name,
          bucket: form.bucket,
          planning_notes: form.planning_notes || null,
          central_lat: lat,
          central_lng: lng,
        })
      } else if (mode === 'edit-parent') {
        await api.updateParent(modalState.area.id, {
          name,
          bucket: form.bucket,
          planning_notes: form.planning_notes || null,
          central_lat: lat,
          central_lng: lng,
        })
      } else if (mode === 'add-child') {
        await api.createChild(modalState.parentId, {
          name,
          lat,
          lng,
          planning_notes: form.planning_notes || null,
        })
      } else if (mode === 'edit-child') {
        await api.updateChild(modalState.child.id, {
          name,
          lat,
          lng,
          planning_notes: form.planning_notes || null,
        })
      }
      await onSaved()
      onClose()
    } catch (err) {
      setError(err.message || 'Save failed.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form className="form-body" onSubmit={submit}>
      {/* Search is the "easy path" — pick and we fill name+lat+lng for you. */}
      <LocationPicker onPick={applyPick} />

      <label className="form-field">
        <span className="form-label">Name</span>
        <input
          type="text"
          value={form.name}
          onChange={set('name')}
          placeholder={isParent ? 'e.g., Titusville, FL' : 'e.g., Coast Spot'}
          required
          autoFocus={!isEdit}
        />
      </label>

      {isParent && (
        <label className="form-field">
          <span className="form-label">Bucket</span>
          <select value={form.bucket} onChange={set('bucket')}>
            <option value="active">Active</option>
            <option value="watching">Watching</option>
            <option value="future_planning">Future Planning</option>
          </select>
        </label>
      )}

      <div className="form-row">
        <label className="form-field">
          <span className="form-label">Latitude{isParent ? ' (optional)' : ''}</span>
          <input
            type="number"
            step="any"
            inputMode="decimal"
            value={form.lat}
            onChange={set('lat')}
            placeholder="28.5152"
          />
        </label>
        <label className="form-field">
          <span className="form-label">Longitude{isParent ? ' (optional)' : ''}</span>
          <input
            type="number"
            step="any"
            inputMode="decimal"
            value={form.lng}
            onChange={set('lng')}
            placeholder="-80.5683"
          />
        </label>
      </div>

      <label className="form-field">
        <span className="form-label">
          {isParent ? 'Planning notes' : 'Notes'} <span className="form-hint">(optional)</span>
        </span>
        <textarea
          value={form.planning_notes}
          onChange={set('planning_notes')}
          rows={3}
          placeholder={
            isParent
              ? 'Why are you tracking this area? (e.g., "Space Coast birding, rocket launches")'
              : 'Anything worth remembering about this specific spot.'
          }
        />
      </label>
      {/* TODO: Watching-bucket seasonal_note field — prototype shows a
          seasonal note on .watching-card, e.g. "Summer (Jul-Aug): Highs 60-70°F,
          cool and foggy. Best birding mid-July for puffins." We render
          child.seasonal_note || planning_notes || fallback in LocationCard,
          but the form doesn't yet expose a dedicated seasonal_note textarea.
          Add one (conditional on the parent's bucket === 'watching') once the
          backend/schema gains the field. */}

      {error && <div className="form-error">{error}</div>}

      <div className="form-actions">
        <button type="button" className="btn btn-ghost" onClick={onClose} disabled={submitting}>
          Cancel
        </button>
        <button type="submit" className="btn btn-primary" disabled={submitting}>
          {submitting ? 'Saving…' : isEdit ? 'Save changes' : 'Create'}
        </button>
      </div>
    </form>
  )
}

/**
 * Debounced search-as-you-type. Hits /api/geocode/search (WeatherAPI proxy).
 * On pick: passes { name, lat, lon } back to the form.
 */
function LocationPicker({ onPick }) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const debounceRef = useRef(null)

  useEffect(() => {
    if (q.trim().length < 2) {
      setResults([])
      return
    }
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(async () => {
      setLoading(true)
      try {
        const data = await api.searchPlaces(q)
        setResults(Array.isArray(data) ? data : [])
        setOpen(true)
      } catch {
        setResults([])
      } finally {
        setLoading(false)
      }
    }, 250)
    return () => clearTimeout(debounceRef.current)
  }, [q])

  const pick = (r) => {
    onPick({
      name: [r.name, r.region].filter(Boolean).join(', ') || r.name,
      lat: r.lat,
      lon: r.lon,
    })
    setQ('')
    setResults([])
    setOpen(false)
  }

  return (
    <div className="location-picker">
      <label className="form-field">
        <span className="form-label">
          Search a place <span className="form-hint">(optional — fills name + coordinates)</span>
        </span>
        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => results.length && setOpen(true)}
          placeholder="e.g., Titusville"
        />
      </label>
      {open && (loading || results.length > 0) && (
        <ul className="picker-results">
          {loading && <li className="picker-loading">Searching…</li>}
          {!loading &&
            results.map((r) => (
              <li key={r.id}>
                <button type="button" className="picker-result" onClick={() => pick(r)}>
                  <span className="picker-name">
                    {r.name}
                    {r.region ? `, ${r.region}` : ''}
                  </span>
                  <span className="picker-country">{r.country}</span>
                </button>
              </li>
            ))}
        </ul>
      )}
    </div>
  )
}
