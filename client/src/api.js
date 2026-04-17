// API service layer for Mygration.
// Falls back to a local mock if the backend is unreachable, so the UI can be
// developed independently of the server during Phase 1.
//
// In dev, Vite proxies /api/* to localhost:5000, so the default '/api' works.
// In production (Railway two-service deploy), set VITE_API_URL at build time
// to the backend URL, e.g. VITE_API_URL=https://<backend>.up.railway.app

// Accept either the backend root (e.g. https://foo.up.railway.app) or a value
// already including /api — append /api if missing so it's idiot-proof.
const RAW_API = (import.meta.env.VITE_API_URL || '/api').replace(/\/$/, '')
const API_BASE = RAW_API.endsWith('/api') ? RAW_API : `${RAW_API}/api`

async function request(path, { method = 'GET', body } = {}) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } }
  if (body !== undefined) opts.body = JSON.stringify(body)
  const res = await fetch(`${API_BASE}${path}`, opts)
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`${method} ${path} → ${res.status}: ${text}`)
  }
  if (res.status === 204) return null
  return res.json()
}

export const api = {
  listLocations: () => request('/locations'),
  createParent: (data) => request('/locations', { method: 'POST', body: data }),
  updateParent: (id, data) => request(`/locations/${id}`, { method: 'PATCH', body: data }),
  deleteParent: (id) => request(`/locations/${id}`, { method: 'DELETE' }),
  createChild: (parentId, data) =>
    request(`/locations/${parentId}/children`, { method: 'POST', body: data }),
  updateChild: (id, data) => request(`/children/${id}`, { method: 'PATCH', body: data }),
  deleteChild: (id) => request(`/children/${id}`, { method: 'DELETE' }),
  getChildWeather: (id) => request(`/children/${id}/weather`),
  getChildWeatherDetail: (id) => request(`/children/${id}/weather/detail`),
  getChildHistorical: (id, month) =>
    request(`/children/${id}/weather/historical?month=${encodeURIComponent(month)}`),
  searchPlaces: (q) => request(`/geocode/search?q=${encodeURIComponent(q)}`),
}

// Mock data — used when the backend isn't running yet. Matches the API
// response shape so swapping back to the real server is a one-line change.
export const MOCK_LOCATIONS = {
  active: [
    {
      id: 1,
      name: 'Titusville, FL',
      bucket: 'active',
      planning_notes: 'Currently parked here. Space Coast birding, rocket launches.',
      children: [
        { id: 1, name: 'Coast Spot', lat: 28.5152, lng: -80.5683 },
        { id: 2, name: 'Inland Parking', lat: 28.6122, lng: -80.8076 },
        { id: 3, name: 'Merritt Island NWR', lat: 28.6408, lng: -80.7306 },
      ],
    },
    {
      id: 2,
      name: 'Christmas, FL',
      bucket: 'active',
      planning_notes: 'Orlando Wetlands has been incredible in past Aprils.',
      children: [{ id: 4, name: 'Orlando Wetlands Park', lat: 28.5717, lng: -80.9948 }],
    },
  ],
  watching: [
    {
      id: 3,
      name: 'St. Augustine, FL',
      bucket: 'watching',
      planning_notes: 'Backup option if Titusville gets buggy.',
      children: [{ id: 5, name: 'Anastasia State Park', lat: 29.8741, lng: -81.2714 }],
    },
    {
      id: 4,
      name: 'Sebastian Inlet / Melbourne, FL',
      bucket: 'watching',
      planning_notes: 'Good coastal alternate — shorebirds, beach access.',
      children: [{ id: 6, name: 'Sebastian Inlet SP', lat: 27.86, lng: -80.4453 }],
    },
    {
      id: 5,
      name: 'Pinellas Park, FL',
      bucket: 'watching',
      planning_notes: 'Gulf side option — Fort De Soto nearby.',
      children: [{ id: 7, name: 'Fort De Soto', lat: 27.612, lng: -82.737 }],
    },
  ],
  future_planning: [
    {
      id: 6,
      name: "St. John's, Newfoundland",
      bucket: 'future_planning',
      planning_notes: 'Puffins, icebergs, dramatic coastline — summer 2026 or 2027.',
      children: [{ id: 8, name: 'Cape Spear', lat: 47.5236, lng: -52.6195 }],
    },
  ],
}

/** Load locations with graceful fallback to mock data. */
export async function loadLocations() {
  try {
    return await api.listLocations()
  } catch (e) {
    console.warn('Backend unavailable, using mock data:', e.message)
    return MOCK_LOCATIONS
  }
}
