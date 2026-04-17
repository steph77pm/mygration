# Mygration

Weather planning for van life — built for Stephanie to compare many locations at once, see realistic temperature distributions (not misleading averages), plan multi-stop routes, and build a personal knowledge base of conditions over time.

The canonical project spec is **[PROJECT-GUIDE.md](./PROJECT-GUIDE.md)**. This README covers only setup, running, and deployment.

## Phase 1 scope

- Three-bucket location library: **Active Locations**, **Watching**, **Future Planning**
- Parent-area / child-location hierarchy (e.g., Titusville → Coast Spot / Inland Parking / Merritt Island)
- Live weather via WeatherAPI.com (current + 10-day forecast)
- Comfort index (1-10) + bug risk indicator per location
- Collapsible UI: desktop expands Active + Watching by default; mobile expands only Active
- Flask + Postgres backend, React + Vite frontend, deployable to Railway

## Folder layout

```
[SMW] Weather Tracker/
├── PROJECT-GUIDE.md     ← the source-of-truth spec
├── README.md            ← you are here
├── prototype/           ← Phase 0 clickable HTML prototype (mock data)
├── server/              ← Flask backend (API, weather, comfort, DB models)
├── client/              ← React + Vite frontend (dashboard, buckets, PWA)
├── data/                ← local dev SQLite (gitignored)
└── docs/                ← additional docs
```

## Running locally

Two terminals required — one for backend, one for frontend.

### Backend

```bash
cd server
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env            # then edit .env with your WeatherAPI key
python seed.py                  # seeds Titusville, Christmas, St. Augustine, etc.
python app.py                   # http://localhost:5000
```

The backend auto-creates a local SQLite database at `server/data/mygration.db` for development — no Postgres required until deployment.

### Frontend

```bash
cd client
npm install
npm run dev                     # http://localhost:5173
```

Vite proxies `/api/*` to the backend at localhost:5000. If the backend isn't running, the UI falls back to mock data so you can still poke at layout work.

## Deploying to Railway

Railway auto-deploys from GitHub on push to `main`.

**One-time setup (requires Stephanie's action):**

1. Create a GitHub repo at https://github.com/new named `mygration` (private recommended). Give Claude the HTTPS URL so it can push.
2. Create a Railway project at https://railway.app/new from the GitHub repo.
3. Add a Postgres plugin in the Railway project — Railway will inject `DATABASE_URL` automatically.
4. Add an environment variable `WEATHER_API_KEY` in the Railway project Variables tab.
5. Add `SECRET_KEY` (any random string) and `CORS_ORIGINS` (set to the deployed frontend URL) in the Variables tab.
6. Railway reads `server/Procfile` to start the API via gunicorn. The frontend deploys separately — either as a second Railway service building from `client/` with `npm run build` + a static server, or we can consolidate behind one Flask server in a later phase.

**After the initial deploy:**

- Pushing to `main` redeploys automatically.
- DB migrations run via `flask db upgrade` (Alembic). The first migration will be generated once this scaffold is pushed.
- `python seed.py` can be run once from Railway's shell to bootstrap the starter locations.

## Environment variables

See [`server/.env.example`](./server/.env.example) for the full list. The critical ones:

| Variable | Required | Purpose |
|----------|----------|---------|
| `WEATHER_API_KEY` | yes | WeatherAPI.com key (Stephanie already has one) |
| `DATABASE_URL` | auto (Railway) | Postgres connection string |
| `SECRET_KEY` | yes (prod) | Flask session signing |
| `CORS_ORIGINS` | yes (prod) | Comma-separated allowed frontend origins |
| `COLD_THRESHOLD_F` | no | Extended-cold alert threshold (default 40) |
| `HEAT_THRESHOLD_F` | no | Extended-heat alert threshold (default 80) |

## Next up (beyond Phase 1)

See the **Phases** section of PROJECT-GUIDE.md. Phase 2 adds realistic temperature distributions, the trip planner, and the correction-factor system.
