# Mygration — Project Guide

> **Purpose of this document:** Everything needed to understand, run, and rebuild this project from scratch. This is the single source of truth — kept updated as the project evolves.

---

## Overview

**Mygration** is a hosted web application for planning van-life travel across the United States based on weather conditions. The name is a play on "migration" — both the van-life travel lifestyle and the bird migration patterns Stephanie photographs. The user (Stephanie) travels full-time in a van, making spontaneous travel decisions heavily influenced by weather, humidity, bugs, and comfort. This app replaces a basic Google Sheets + Apps Script temperature monitor with a comprehensive weather planning and logging tool.

**The core problem:** Existing weather apps show one location at a time and rely on misleading averages. Mygration lets you compare many locations simultaneously, see realistic temperature distributions instead of averages, plan multi-stop routes with weather context, and build a personal knowledge base of conditions over time.

### Key decisions

- **Hosted on Railway** — accessible from any device, anywhere with cell service
- **Offline capable** — cached data available without signal, syncs when reconnected
- **Two-mode design** — laptop for planning, phone for current conditions + logging
- **No SMS alerts** — email only
- **No Google Sheets dependency** — fully self-contained
- **Git-managed** — all code versioned on GitHub, managed by Claude

---

## Tech Stack

| Layer | Technology | Why |
|-------|-----------|-----|
| Backend | Python (Flask) | Simple, good library ecosystem |
| Database | PostgreSQL (Railway) | Hosted-friendly, robust for multi-user access |
| Frontend | React (Vite) | Fast dev experience, modern UI, PWA-capable for offline |
| Charts | Recharts | Integrates naturally with React |
| Weather API | WeatherAPI.com | Already in use, solid free tier |
| Alerts | Email (SMTP) | Simple, reliable |
| Hosting | Railway | Affordable, easy deploy from GitHub |
| Version Control | GitHub | Code versioning, auto-deploy to Railway |

> **Note:** Tech stack may evolve as we build. Any changes will be documented here.

---

## Folder Structure

```
[SMW] Weather Tracker/
├── PROJECT-GUIDE.md          ← You are here (the rebuild bible)
├── server/                   ← Python backend (API + scheduler)
│   ├── app.py                ← Main Flask application
│   ├── config.py             ← API keys, settings
│   ├── models.py             ← Database models
│   ├── scheduler.py          ← Automated weather data fetching
│   ├── weather_service.py    ← WeatherAPI integration
│   ├── comfort_service.py    ← Comfort index calculations
│   ├── alert_service.py      ← Email alert logic
│   └── requirements.txt      ← Python dependencies
├── client/                   ← React frontend
│   ├── public/               ← Static assets, PWA manifest
│   └── src/
│       ├── components/       ← Reusable UI components
│       ├── pages/            ← Full page views
│       └── styles/           ← CSS / styling
├── data/                     ← Local development database
└── docs/                     ← Additional documentation
```

---

## User Context

Stephanie travels full-time in a van across the US. Key facts that shape every design decision:

- **Travel is spontaneous** — no fixed itinerary, decisions made on the fly
- **Often comparing 3+ completely different routes** at the same time (e.g., Houston vs. Vermont vs. South Dakota)
- **Each route has multiple stops** — weather matters at each stop along the way
- **Outdoors constantly** — photographer, so exposed to conditions all day
- **Sleeps in the van** — nighttime temperatures below 40°F are not tolerable for extended periods
- **Humidity and bugs are dealbreakers** — can override temperature comfort entirely
- **Weather apps lie** — averages hide reality (a "72°F average" can mean mostly 80s with a few cold days)
- **Micro-location matters** — coast vs. 1 mile inland can be significantly different
- **Returns to locations** — goes back to the same spots in different seasons/years

---

## Feature Spec

### 1. Location Library

A personal, persistent collection of places, organized into three collapsible buckets: **Active Locations**, **Watching**, and **Future Planning**. Think of it like a contacts list for locations, structured by how relevant each place is to current travel decisions.

#### Organizational Structure — Parent Areas & Child Locations

Locations are organized in a two-level hierarchy:

- **Parent Area** — a geographic region or town (e.g., "Titusville, FL", "Christmas, FL", "St. Augustine, FL")
- **Child Locations** — specific spots within that area, each with its own name (e.g., under "Titusville, FL": "Coast Spot", "Inland Parking", "Merritt Island")

**Examples:**
- Parent: **Christmas, FL** → Child: "Orlando Wetlands Park"
- Parent: **Titusville, FL** → Children: "Coast Spot", "Inland Parking", "Merritt Island"
- Parent: **Vero Beach, FL** → Children: "Stick Marsh", "Blue Cypress Lake"

**Why nested structure instead of flat list or tags:** Most travel decisions are area-level ("should I go to the Titusville area this week?"), but weather conditions vary meaningfully within an area (coast vs. inland). Nesting keeps the planning view scannable at the area level while preserving micro-location precision where it matters. Parent areas can also display an aggregated/summary weather view, with child spots expandable for detail.

**Parent Area data:**
- Name (user-defined, e.g., "Titusville, FL")
- Central coordinates (used for aggregate weather if no child is selected)
- Bucket assignment (Active / Watching / Future Planning)
- Rollup summary of children's comfort/bug/alerts

**Child Location data:**
- Name (user-defined short label, e.g., "Coast Spot")
- Precise coordinates / address
- Inherits bucket from parent (children can't be in a different bucket than their parent)
- Personal notes and logs
- Personal comfort ratings over time
- Parking/camping entries
- Nearby amenities
- Star rating
- Birding/nature tags

**Solo locations:** If a location doesn't have siblings, it can be added as a parent area with no children (or a single implicit child). The UI should not force unnecessary nesting.

#### Bucket Definitions

**Active Locations**
- Your primary focus — places you're at or heading to imminently
- Full live weather data pulled on schedule
- Featured prominently on the dashboard and available for the trip planner
- Full comfort index, bug risk, forecasts, alerts

**Watching**
- Nearby backup or alternate options while you're in a region
- Example: while in the Titusville area, you might watch St. Augustine, Sebastian Inlet/Melbourne, or Pinellas Park — places you could reasonably pivot to on short notice
- Live weather data is still pulled (because you might actually go there this week), but with a lighter visual treatment than Active
- Available in the trip planner for quick comparison

**Future Planning**
- Long-horizon trip ideas (e.g., "St. John's, Newfoundland")
- Formerly called "Inactive" in earlier drafts — renamed to reframe positively
- No live weather data pulled (too far out to be meaningful)
- Viewable on desktop for seasonal/historical research — shows patterns from WeatherAPI history, past personal notes if you've been there before
- All data preserved — any location can be promoted back to Watching or Active at any time with full history intact
- Also serves as the archive for places you've stopped tracking — no destructive delete

#### Collapse / Expand Behavior

All three buckets are collapsible. Default states:

| View | Active Locations | Watching | Future Planning |
|------|------------------|----------|-----------------|
| **Desktop** | Expanded | Expanded | Collapsed |
| **Mobile** | Expanded | Collapsed | Collapsed |

- User-toggled state is remembered per device in local storage
- Each parent area within a bucket is also independently collapsible (children hidden until expanded)
- Parent collapse state is remembered

**Behaviors:**
- Add as many locations as needed — no limit on parents or children
- Move locations between buckets freely (drag-and-drop on desktop, menu option on mobile)
- Promote a Future Planning location to Watching or Active when a trip becomes real
- Demote an Active location back to Watching when you leave the area
- All history preserved across bucket changes — nothing is destructive
- Possible map view for adding locations (TBD — may integrate with Google Maps or use a built-in map)

### 2. Dashboard (Laptop — Primary Planning View)

The main screen when doing trip planning on a computer. Shows all locations organized into the three collapsible buckets (Active Locations, Watching, Future Planning). Active and Watching are expanded by default on desktop; Future Planning is collapsed. Within each bucket, locations are grouped by parent area with expandable child spots.

**For each location, show at a glance:**
- Current temperature + "feels like" (Active + Watching only; Future Planning shows seasonal/historical context instead)
- Current humidity
- Comfort Index score (1-10) with color coding
- Bug risk indicator
- Severe weather alerts / seasonal risk flags
- Extended cold warning (nighttime temps below 40°F for 3+ days)
- Extended heat warning (daytime temps above 80°F for 3+ days)

**Parent area rollup:** When a parent area is collapsed, show a summary row (e.g., "Titusville, FL — 3 spots, avg comfort 7.2, highest bug risk: moderate"). Expanding shows individual child spots underneath.

**Expandable detail per location:**
- Hourly breakdown (next 24-48 hours)
- Weekly forecast (7-10 days)
- Monthly projection — NOT simple averages, but:
  - Temperature distribution (e.g., "70% of days historically 76-82°F, 20% are 68-74°F, 10% below 65°F")
  - Based on last 3 years of actual data for that time period
  - Humidity distribution in the same style
  - Precipitation frequency and patterns
  - Historical bug activity (from personal logs over time)
- Charts and graphs for all of the above

**Layout TBD** — will prototype both card view (detailed, fewer locations visible) and table view (compact, scannable, more locations at once). Likely both with a toggle.

### 3. Trip Planner View (Laptop)

For comparing entire routes to decide which direction to go. This is a **near-term planning tool** — used when making real decisions about where to head next.

**Two distinct planning modes:**

#### Near-Term: Track Comparison (Trip Planner)
- A **track** is a planned route: an ordered list of stops with optional date ranges
- Example Track A: Titusville → Jacksonville → Savannah → Outer Banks → Vermont
- Example Track B: Titusville → New Orleans → Houston
- Compare 1, 2, or 3 tracks side by side (sometimes just one track being mapped out)
- Each stop shows the comfort summary for the expected time window
- Uses real forecast data where available (next 10-14 days) + historical projections beyond that

**Per stop in a track:**
- Expected date range (flexible — can be "sometime in May" or "May 12-18")
- Weather/comfort projection for that date range at that location
- Warnings and flags (hurricane season, extended cold/heat, etc.)
- Ability to reorder stops, add/remove, adjust dates

#### Far-Future: Watching (Location Library)
- For trips months out (like "Newfoundland this summer"), these are NOT tracks — they're locations with **Watching** status in the location library
- Viewable on desktop only — shows historical patterns, seasonal data, past personal notes
- No forecast data (too far out to be meaningful)
- Completely separate from the trip planner — doesn't clutter active route decisions
- When a "watching" trip gets closer and becomes real planning, promote it to a track

**Prototype will test multiple trip planner layouts:**
- Timeline view (horizontal, weather stacked under each stop)
- List view (vertical, reorderable)
- Possibly others — will decide based on what feels right in practice

### 4. Comfort Index

A quick-scan score (1-10) that combines multiple factors, plus standalone callouts for dealbreakers.

**Factors included in the 1-10 score (weighted):**
- Humidity (heaviest weight)
- Temperature comfort range
- Rain frequency / days of rain
- Wind speed

**Standalone callouts (NOT averaged into the score — shown separately):**
- Extended nighttime cold: below 40°F for 3+ consecutive days
- Extended daytime heat: above 80°F for 3+ consecutive days
- Bug risk level: low / moderate / high / severe
- Severe weather risk: hurricane season, tornado frequency, etc.

**These thresholds are user-configurable** — 40°F and 80°F are starting defaults.

### 5. Bug Risk Indicator

**Data sources:**
- Algorithmic estimate based on temperature + humidity + recent rainfall (conditions that breed mosquitoes/noseeums)
- **Personal logs** — the most accurate source over time. "Last April in Titusville, bugs were terrible starting week 2."

**Display:**
- Simple severity level: Low / Moderate / High / Severe
- When personal log data exists for that location + time of year, prioritize it over the algorithm
- Expandable to see personal notes ("noseeums and mosquitoes unbearable, started mid-April 2026")

### 6. Realistic Predictions (Anti-Average System)

The biggest differentiator from standard weather apps.

**For monthly/seasonal projections, show:**
- Temperature distribution, NOT averages (e.g., histogram or range chart)
- "Most likely" range (the mode, not the mean)
- Based on actual daily data from the last 3 years for that time window
- Separate daytime high and nighttime low distributions
- Humidity distribution in the same style

**Correction factors:**
- Over time, as the user logs actual conditions vs. forecast, the app builds per-location correction data
- Example: "Titusville forecasts tend to run 4-5°F low in spring" — shown as a note or applied to projections

### 7. Severe Weather Awareness

Not real-time storm tracking, but awareness of seasonal risk patterns.

**Show for each location:**
- Hurricane season window (if applicable) with historical frequency
- Tornado season / frequency
- Flood risk season
- Any other regionally relevant severe weather patterns
- Source: historical NOAA data + seasonal calendars

**Display:** Subtle flag/banner on location cards during relevant months. Not alarmist, just informational.

### 8. Personal Logging

Build a personal weather knowledge base over time.

**Quick log (phone-optimized):**
- Thumbs up / thumbs down per factor (temp, humidity, bugs, overall comfort)
- "Actual vs. forecast" comparison (was it hotter/cooler/more humid than predicted?)
- Free-text notes field for anything ("noseeums came out this week", "wind made it miserable", "perfect birding weather")

**How logs are used:**
- Build correction factors per location (forecast vs. reality)
- Inform bug risk predictions for future visits
- Show past ratings when you revisit or reactivate a location ("Last time you were here in January: 8/10 comfort, low bugs, ran warmer than forecast")
- Personal log entries visible in location detail view, sorted by date

### 9. Mobile View (Phone — "What's Happening Now")

Stripped-down interface focused on the current location. Uses the same three-bucket structure as desktop, but with tighter defaults: only **Active Locations** is expanded on initial load; Watching and Future Planning start collapsed to keep the above-the-fold view focused on what matters right now.

**Shows:**
- Current conditions at your active location(s)
- Today's hourly breakdown
- Comfort index for today
- Bug risk for today
- Any active weather alerts

**Actions:**
- Quick-log today's conditions (thumbs up/down + notes)
- View upcoming 3-5 day forecast
- Toggle which location you're "at" currently

**Does NOT need on mobile:**
- Full trip planner
- Multi-track route comparison
- Historical analysis and charts
- Location library management

### 10. Offline Support

**Cached for offline access:**
- All previously loaded forecast data
- Location library and personal logs
- Last-fetched dashboard state
- Any trip plans in progress

**Requires connection:**
- Fetching new/updated weather data
- Adding new locations
- Syncing new log entries (queued and synced when back online)

**Implementation:** Progressive Web App (PWA) with service worker caching.

### 11. Email Alerts

Retained from the old system but simplified.

- Configurable per location
- Alert when comfort index drops below a threshold
- Alert for severe weather warnings
- Alert for extended cold/heat periods
- Daily or twice-daily summary option (configurable schedule)

### 12. Location Dossier — Van Life Logistics

Each location is more than just weather — it's a full trip planning hub. Every location card acts as a mini travel dossier containing:

#### Planning Notes
- Free-text "why I'm going" field when adding a location (birding targets, campsite scouting, seasonal goals, etc.)
- Stays visible on the location card as context for why it's being tracked
- Editable at any time

#### Parking / Camping Planner
- Each location gets a list of parking/camping options (Cracker Barrel, Walmart, campgrounds, boondocking spots, etc.)
- Each parking entry has its own notes field ("super noisy at night", "no longer viable as of March 2026", "great cell signal")
- Can add new spots over time and update existing ones
- Replaces cross-referencing iOverlander separately
- Intended to reduce dependency on external parking apps

#### Nearby Amenities Auto-Check
- When adding a location, the app automatically searches for nearby:
  - Planet Fitness
  - Panera Bread
  - 24-hour laundromats
- Results shown as quick-reference on the location card
- These are nice-to-know, not dealbreakers — just useful context for on-the-fly planning

#### Star Rating
- Personal 1-5 star rating left after visiting a location
- 1 = "this place sucked" → 5 = "seriously go back"
- Visible on the location card for instant future planning decisions

#### General Post-Visit Notes
- Free-text journal area for post-visit thoughts
- Separate from planning notes (pre-trip) and parking notes (logistics)
- Running log of impressions, tips, and lessons learned per location

### 13. Location Association — "Places I've Been" Database

Import from existing data (photography folder structure on hard drive) to build a personal travel history database.

**One-time import:**
- Point the app at a folder on the hard drive (e.g., bird photography archive)
- App reads folder names to extract dates and location names
- Builds a "places I've been" database with visit dates

**Auto-association:**
- When adding or viewing a weather location, the app fuzzy-matches against the travel history
- Association is based on geographic proximity (anything within X miles)
- Example: viewing "Vero Beach" shows a tag "Stick Marsh — visited Mar 2024, Jan 2025"
- Tags show on the location card with visit dates

**Folder structure parsing:** Will need to determine Stephanie's actual folder naming convention to build the parser (e.g., `2024-03-15 Stick Marsh` vs. `March 2024/Stick Marsh`).

### 14. Birding & Nature Tags

A dual-source tag system for seasonal wildlife and nature events at each location.

**Auto-generated tags:**
- Migration peaks (e.g., "warbler migration peak" in Shenandoah in late April)
- Seasonal wildlife patterns (nesting seasons, puffin viewing windows, etc.)
- Data source: public databases like eBird, seasonal calendars
- Shown as colored tags on location cards during relevant time periods

**User-added custom tags:**
- Personal observations that persist as knowledge base entries
- Examples: "good for roseate spoonbills in January", "shorebird migration starts mid-March"
- Personal tags carry more weight than auto-generated since they're ground truth

### 15. Data Safety & Backups

All user data (locations, logs, notes, parking spots, ratings, tags, trip plans) is treated as irreplaceable. The app is built with zero-data-loss as a hard requirement.

**Automatic backups:**
- Database snapshots on a set cadence (daily by default, configurable)
- Full export of all user data to a downloadable file (stored in Dropbox or similar)
- Backup runs silently in the background — no user action needed

**Manual backup trigger:**
- "Back up now" button accessible from settings
- Produces the same full export as the automatic backup
- For peace of mind before making big changes, or just whenever

**No destructive deletes:**
- Deactivating or "deleting" a location hides it from view but preserves all data in the database
- All history, logs, notes, and ratings are retained permanently
- Any location can be restored at any time with full history intact

**Offline data safety:**
- Log entries and notes created without signal are saved locally on the device
- Queued entries sync automatically when connection returns — nothing is lost in the gap

**Data export:**
- Full data export available at any time (manual or automatic)
- Format TBD (likely JSON or CSV) — must be human-readable and re-importable
- Acts as an independent safety net: even if the hosting provider disappears, your data lives on your hard drive

---

## Phases

### Phase 0: Proof of Concept / Prototype
- Clickable prototype with mock data
- Test dashboard layout (card vs. table vs. hybrid)
- Test trip planner layout options
- Test mobile view
- Refine UX before building real functionality
- **No backend, no API calls — pure frontend with dummy data**

### Phase 1: Core App
- Location library (add, edit, activate/deactivate)
- Dashboard with live weather data
- Comfort index calculation
- Basic hourly/weekly/monthly views
- PostgreSQL database on Railway
- Deploy to Railway

### Phase 2: Smart Features
- Realistic predictions (historical distribution analysis)
- Trip planner with multi-track comparison
- Bug risk algorithm
- Severe weather awareness flags
- Correction factor tracking

### Phase 3: Personal Knowledge Base
- Personal logging system
- Historical log display per location
- Forecast vs. actual tracking
- "Last time you were here" feature
- Offline support (PWA)

### Phase 4: Polish & Iterate
- Email alerts
- Map view for locations
- Ongoing UX refinement based on field use
- Performance optimization

### Future Considerations (Not In Scope for V1)

Ideas to revisit once the core app is stable and field-tested.

**Photography Location Scouting**
- Save photography locations discovered on the road (tips from other photographers, spots seen while driving, online recommendations)
- Could tie into the existing location library and "places I've been" database
- Potential fields: location name, GPS pin, type of photography (birds, landscape, astro, etc.), best time of day/year, access notes, sample photos
- Natural extension of the birding/nature tags and personal knowledge base
- Deferred because it expands scope beyond weather-driven planning — revisit after Phases 1-3 are solid

---

## How to Run (will be filled in during development)

```bash
# Development — Backend
cd server
pip install -r requirements.txt
python app.py

# Development — Frontend
cd client
npm install
npm run dev
```

**Production:** Auto-deploys from GitHub to Railway on push to main branch.

---

## Configuration (will be detailed during development)

- WeatherAPI key: `d60818a7048d44e4bb0164748262101`
- Email: stephanie.warner77@gmail.com
- Railway project settings
- GitHub repository settings

---

## Rebuild Instructions

> If you ever need to recreate this project from scratch, follow these steps:

*(Will be written as we build — every setup step, dependency, and config choice will be documented here so the project can be fully reproduced.)*

---

## Change Log

| Date | What changed |
|------|-------------|
| 2026-04-16 | Project initialized. Full feature spec written based on use case discussions. Architecture decided: hosted on Railway, React + Flask, PWA for offline. |
| 2026-04-17 | Prototype updated: month navigation on temp distribution, clickable comfort breakdown, 10-day forecast, mobile forecast extended. New feature specs added: Location Dossier (parking, amenities, star rating, notes), Places I've Been import, Birding & Nature Tags. |
| 2026-04-17 | App named **Mygration**. Location Library restructured: three collapsible buckets (Active Locations, Watching, Future Planning — the last replacing "Inactive") and two-level parent-area/child-location hierarchy (e.g., Titusville → Coast Spot / Inland Parking / Merritt Island). Default collapse states defined per device. Ready to begin Phase 1 build. |
