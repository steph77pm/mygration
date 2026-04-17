import { useMemo, useState } from 'react'
import { api } from '../api.js'
import { useLocationsStore } from '../hooks/useLocationsStore.jsx'
import { useTripsStore } from '../hooks/useTripsStore.jsx'
import { LocationPicker } from './LocationFormModal.jsx'

/**
 * Unified form modal for the Trip Planner.
 *
 * Modes:
 *   - add-trip:   new TripPlan (name + color)
 *   - edit-trip:  same fields, pre-filled
 *   - add-stop:   new TripStop under a given trip (name + lat/lng + dates + notes
 *                 + optional library link)
 *   - edit-stop:  same fields, pre-filled
 *
 * Stop form mirrors the LocationFormModal UX: the LocationPicker (WeatherAPI
 * search) is the easy path, but the user can also pick from their library or
 * type coordinates directly.
 */

// Prototype's two tracks use blue + purple; offer those plus a couple of
// readable alternates. Free text input is also allowed for custom hex.
const TRACK_COLOR_PRESETS = [
  { value: '#3b82f6', label: 'Blue' },
  { value: '#8b5cf6', label: 'Purple' },
  { value: '#10b981', label: 'Green' },
  { value: '#f59e0b', label: 'Amber' },
  { value: '#ef4444', label: 'Red' },
  { value: '#06b6d4', label: 'Cyan' },
]

export function TripFormModal() {
  const { modalState, closeModal, refresh } = useTripsStore()
  if (!modalState) return null
  const { mode } = modalState
  const isTrip = mode === 'add-trip' || mode === 'edit-trip'

  return (
    <div className="detail-overlay" onClick={closeModal}>
      <div
        className="form-modal"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <Header mode={mode} tripName={modalState.tripName} onClose={closeModal} />
        {isTrip ? (
          <TripFormBody modalState={modalState} onClose={closeModal} onSaved={refresh} />
        ) : (
          <StopFormBody modalState={modalState} onClose={closeModal} onSaved={refresh} />
        )}
      </div>
    </div>
  )
}

function Header({ mode, tripName, onClose }) {
  const title = {
    'add-trip': 'New track',
    'edit-trip': 'Edit track',
    'add-stop': `New stop${tripName ? ` on ${tripName}` : ''}`,
    'edit-stop': 'Edit stop',
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

function TripFormBody({ modalState, onClose, onSaved }) {
  const { mode } = modalState
  const isEdit = mode === 'edit-trip'

  const seed = isEdit
    ? {
        name: modalState.trip.name || '',
        color: modalState.trip.color || TRACK_COLOR_PRESETS[0].value,
      }
    : { name: '', color: TRACK_COLOR_PRESETS[0].value }

  const [form, setForm] = useState(seed)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })

  const submit = async (e) => {
    e.preventDefault()
    setError(null)
    const name = (form.name || '').trim()
    if (!name) return setError('Name is required.')
    setSubmitting(true)
    try {
      if (isEdit) {
        await api.updateTrip(modalState.trip.id, { name, color: form.color })
      } else {
        await api.createTrip({ name, color: form.color })
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
      <label className="form-field">
        <span className="form-label">Track name</span>
        <input
          type="text"
          value={form.name}
          onChange={set('name')}
          placeholder="e.g., Florida → Vermont"
          required
          autoFocus={!isEdit}
        />
      </label>

      <div className="form-field">
        <span className="form-label">Color</span>
        <div className="color-swatches">
          {TRACK_COLOR_PRESETS.map((c) => (
            <button
              type="button"
              key={c.value}
              onClick={() => setForm((f) => ({ ...f, color: c.value }))}
              className={`color-swatch ${form.color === c.value ? 'active' : ''}`}
              style={{ background: c.value }}
              aria-label={c.label}
              title={c.label}
            />
          ))}
          <input
            type="text"
            value={form.color}
            onChange={set('color')}
            placeholder="#rrggbb"
            className="color-input"
          />
        </div>
      </div>

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

function StopFormBody({ modalState, onClose, onSaved }) {
  const { mode } = modalState
  const isEdit = mode === 'edit-stop'
  const { locations } = useLocationsStore()

  // Seed: edit mirrors the stop; add starts empty.
  const seed = isEdit
    ? {
        name: modalState.stop.name || '',
        lat: modalState.stop.lat ?? '',
        lng: modalState.stop.lng ?? '',
        start_date: modalState.stop.start_date || '',
        end_date: modalState.stop.end_date || '',
        planning_notes: modalState.stop.planning_notes || '',
        child_location_id: modalState.stop.child_location_id ?? '',
      }
    : {
        name: '',
        lat: '',
        lng: '',
        start_date: '',
        end_date: '',
        planning_notes: '',
        child_location_id: '',
      }

  const [form, setForm] = useState(seed)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })

  // Flat list of (parent, child) pairs for the "pick from your library" dropdown.
  const libraryOptions = useMemo(() => {
    if (!locations) return []
    const out = []
    for (const bucket of ['active', 'watching', 'future_planning']) {
      for (const area of locations[bucket] || []) {
        for (const child of area.children || []) {
          out.push({
            id: child.id,
            label: `${child.name} (${area.name})`,
            name: child.name,
            parentName: area.name,
            lat: child.lat,
            lng: child.lng,
          })
        }
      }
    }
    return out
  }, [locations])

  const pickFromLibrary = (e) => {
    const id = e.target.value
    if (!id) {
      setForm((prev) => ({ ...prev, child_location_id: '' }))
      return
    }
    const opt = libraryOptions.find((o) => String(o.id) === String(id))
    if (!opt) return
    setForm((prev) => ({
      ...prev,
      child_location_id: opt.id,
      // Overwrite name+coords so picking an existing location is one-click.
      name: `${opt.name}, ${opt.parentName}`,
      lat: opt.lat,
      lng: opt.lng,
    }))
  }

  // Called by the LocationPicker (free-form search) — picking here unlinks
  // from any library child so we don't send a stale FK.
  const applyPick = (pick) => {
    setForm((prev) => ({
      ...prev,
      name: pick.name || prev.name,
      lat: pick.lat,
      lng: pick.lon,
      child_location_id: '',
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
    if (lat == null || Number.isNaN(lat)) return setError('Latitude is required.')
    if (lng == null || Number.isNaN(lng)) return setError('Longitude is required.')
    if (lat < -90 || lat > 90) return setError('Latitude must be between -90 and 90.')
    if (lng < -180 || lng > 180) return setError('Longitude must be between -180 and 180.')

    // Date sanity: if both present, end must be >= start.
    if (form.start_date && form.end_date && form.end_date < form.start_date) {
      return setError('End date must be on or after start date.')
    }

    setSubmitting(true)
    const payload = {
      name,
      lat,
      lng,
      start_date: form.start_date || null,
      end_date: form.end_date || null,
      planning_notes: form.planning_notes || null,
      child_location_id: form.child_location_id ? Number(form.child_location_id) : null,
    }
    try {
      if (isEdit) {
        await api.updateStop(modalState.stop.id, payload)
      } else {
        await api.createStop(modalState.tripId, payload)
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
      <LocationPicker onPick={applyPick} />

      {libraryOptions.length > 0 && (
        <label className="form-field">
          <span className="form-label">
            Or pick from your library{' '}
            <span className="form-hint">(links this stop to a location you already track)</span>
          </span>
          <select value={form.child_location_id || ''} onChange={pickFromLibrary}>
            <option value="">— None —</option>
            {libraryOptions.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      )}

      <label className="form-field">
        <span className="form-label">Name</span>
        <input
          type="text"
          value={form.name}
          onChange={set('name')}
          placeholder="e.g., Savannah, GA"
          required
          autoFocus={!isEdit}
        />
      </label>

      <div className="form-row">
        <label className="form-field">
          <span className="form-label">Latitude</span>
          <input
            type="number"
            step="any"
            inputMode="decimal"
            value={form.lat}
            onChange={set('lat')}
            placeholder="32.0809"
            required
          />
        </label>
        <label className="form-field">
          <span className="form-label">Longitude</span>
          <input
            type="number"
            step="any"
            inputMode="decimal"
            value={form.lng}
            onChange={set('lng')}
            placeholder="-81.0912"
            required
          />
        </label>
      </div>

      <div className="form-row">
        <label className="form-field">
          <span className="form-label">
            Start date <span className="form-hint">(optional)</span>
          </span>
          <input type="date" value={form.start_date || ''} onChange={set('start_date')} />
        </label>
        <label className="form-field">
          <span className="form-label">
            End date <span className="form-hint">(optional)</span>
          </span>
          <input type="date" value={form.end_date || ''} onChange={set('end_date')} />
        </label>
      </div>

      <label className="form-field">
        <span className="form-label">
          Notes <span className="form-hint">(optional)</span>
        </span>
        <textarea
          value={form.planning_notes}
          onChange={set('planning_notes')}
          rows={3}
          placeholder="e.g., Stopping to catch warbler migration peak."
        />
      </label>

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
