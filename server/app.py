"""Mygration — Flask application entry point.

Exposes a JSON API consumed by the React frontend:

    GET    /api/health                    — simple health check
    GET    /api/locations                 — all parent areas grouped by bucket
    POST   /api/locations                 — create a new parent area
    GET    /api/locations/<id>            — one parent area with children
    PATCH  /api/locations/<id>            — update parent (name, bucket, notes)
    DELETE /api/locations/<id>            — delete parent + children
    POST   /api/locations/<id>/children   — add a child location
    PATCH  /api/children/<id>             — update a child location
    DELETE /api/children/<id>             — delete a child location
    GET    /api/children/<id>/weather     — live weather summary for a child
    GET    /api/children/<id>/weather/detail
                                          — hourly forecast + astro + wind for drill-in view
    GET    /api/children/<id>/weather/historical?month=1-12
                                          — historical digest for Future Planning research
    GET    /api/children/<id>/weather/distribution
                                          — recent ~30-day temperature histogram
    GET    /api/children/<id>/logs        — list user weather logs for a child
    POST   /api/children/<id>/logs        — record a weather log + snapshot
    DELETE /api/logs/<id>                 — delete a weather log
    GET    /api/geocode/search?q=<query>  — Nominatim (OSM) + WeatherAPI fallback

    GET    /api/trips                     — list all trip plans with their stops
    POST   /api/trips                     — create a new trip plan
    GET    /api/trips/<id>                — one trip plan with stops
    PATCH  /api/trips/<id>                — rename, recolor, or resort
    DELETE /api/trips/<id>                — delete a trip plan (cascades to stops)
    GET    /api/trips/<id>/weather        — per-stop weather projection + trip summary
    POST   /api/trips/<id>/stops          — add a stop to a trip plan
    PATCH  /api/stops/<id>                — update a stop
    DELETE /api/stops/<id>                — delete a stop
    POST   /api/stops/<id>/move           — reorder a stop up or down within its trip
    GET    /api/stops/<id>/weather        — live weather summary for a stop (Dashboard plan buckets)

In production on Railway, gunicorn serves this via the Procfile.
"""

from __future__ import annotations

import logging
import os
from pathlib import Path

import requests
from flask import Flask, jsonify, request
from flask_cors import CORS
from flask_migrate import Migrate

from comfort_service import compute_comfort, estimate_bug_risk
from config import Config
from models import Bucket, ChildLocation, ParentArea, TripPlan, TripStop, WeatherLog, db
from weather_service import (
    WeatherAPIError,
    extract_detail,
    extract_summary,
    fetch_current_and_forecast,
    fetch_historical_month_digest,
    fetch_temperature_distribution,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("mygration")


def _ensure_column(table: str, column: str, ddl_type: str) -> None:
    """Add a column to an existing table if it doesn't exist yet.

    Handles both Postgres (production) and SQLite (local dev). Postgres
    understands `ADD COLUMN IF NOT EXISTS`; SQLite doesn't, but the inspector
    introspection we use works there too.

    Cheap + idempotent — safe to call on every boot.
    """
    from sqlalchemy import inspect  # local import to avoid polluting the top
    try:
        insp = inspect(db.engine)
        existing = {c["name"] for c in insp.get_columns(table)}
        if column in existing:
            return
        with db.engine.begin() as conn:
            conn.exec_driver_sql(f'ALTER TABLE {table} ADD COLUMN {column} {ddl_type}')
        log.info("Added column %s.%s (%s)", table, column, ddl_type)
    except Exception as e:  # noqa: BLE001
        log.warning("_ensure_column(%s, %s) failed: %s", table, column, e)


def _init_schema_and_seed(app: Flask) -> None:
    """Ensure tables exist, and optionally seed starter data on a fresh DB.

    Runs inside an app context at startup. `db.create_all()` is idempotent —
    safe to call on every boot, and cheap once tables exist.

    If the environment variable SEED_ON_STARTUP is truthy AND the DB has no
    parent areas yet, import and run the seeder. This lets us bootstrap a
    fresh Railway Postgres database without needing shell access.
    """
    with app.app_context():
        try:
            db.create_all()
            log.info("Schema check complete (db.create_all)")
        except Exception as e:  # noqa: BLE001 — log and continue; gunicorn will restart
            log.error("db.create_all failed: %s", e)
            return

        # Lightweight additive migrations. `db.create_all()` does not add columns
        # to existing tables, so we apply new-column ALTERs idempotently here.
        # Keep this list tiny — for anything schema-shaped (FKs, constraints,
        # data backfills) use a proper Alembic migration instead.
        _ensure_column(
            table="child_locations",
            column="seasonal_note",
            ddl_type="TEXT",
        )

        if os.getenv("SEED_ON_STARTUP", "").lower() in ("1", "true", "yes"):
            try:
                count = ParentArea.query.count()
            except Exception as e:  # noqa: BLE001
                log.error("Could not check ParentArea count: %s", e)
                return
            if count == 0:
                log.info("SEED_ON_STARTUP set and DB is empty — running seeder")
                # Import lazily so seed.py isn't required for normal requests.
                import seed as seeder  # type: ignore
                try:
                    # Call the inner body directly so we don't construct a new app.
                    for area_spec in seeder.SEED_DATA:
                        existing = ParentArea.query.filter_by(name=area_spec["name"]).first()
                        if existing:
                            continue
                        area = ParentArea(
                            name=area_spec["name"],
                            bucket=area_spec["bucket"],
                            central_lat=area_spec["central_lat"],
                            central_lng=area_spec["central_lng"],
                            planning_notes=area_spec.get("planning_notes"),
                        )
                        db.session.add(area)
                        db.session.flush()
                        for i, child_spec in enumerate(area_spec["children"]):
                            child = ChildLocation(
                                parent_area_id=area.id,
                                name=child_spec["name"],
                                lat=child_spec["lat"],
                                lng=child_spec["lng"],
                                sort_order=i,
                            )
                            db.session.add(child)
                    db.session.commit()
                    log.info("Seed complete: %d parent areas", ParentArea.query.count())
                except Exception as e:  # noqa: BLE001
                    db.session.rollback()
                    log.error("Seeding failed: %s", e)
            else:
                log.info("SEED_ON_STARTUP set but DB already has %d parent areas — skipping", count)


def create_app(config: type = Config) -> Flask:
    app = Flask(__name__)
    app.config.from_object(config)

    # Ensure SQLite data directory exists for local dev. Railway Postgres doesn't need this.
    if app.config["SQLALCHEMY_DATABASE_URI"].startswith("sqlite:///"):
        Path(__file__).parent.joinpath("data").mkdir(exist_ok=True)

    db.init_app(app)
    Migrate(app, db)
    CORS(app, origins=app.config["CORS_ORIGINS"], supports_credentials=True)

    _init_schema_and_seed(app)

    # --- Routes ---

    @app.route("/api/health")
    def health():
        return {"status": "ok", "app": "mygration"}

    @app.route("/api/locations", methods=["GET"])
    def list_locations():
        """Return all parent areas grouped into the three buckets.

        Response shape matches what the frontend dashboard expects:
            { "active": [...], "watching": [...], "future_planning": [...] }
        """
        areas = ParentArea.query.order_by(ParentArea.sort_order, ParentArea.name).all()
        grouped: dict[str, list] = {b.value: [] for b in Bucket}
        for area in areas:
            bucket_key = area.bucket.value if hasattr(area.bucket, "value") else area.bucket
            grouped[bucket_key].append(area.to_dict())
        return jsonify(grouped)

    @app.route("/api/locations", methods=["POST"])
    def create_parent():
        data = request.get_json(force=True, silent=True) or {}
        name = (data.get("name") or "").strip()
        if not name:
            return {"error": "name is required"}, 400
        bucket_raw = data.get("bucket", Bucket.ACTIVE.value)
        try:
            bucket = Bucket(bucket_raw)
        except ValueError:
            return {"error": f"invalid bucket: {bucket_raw}"}, 400
        area = ParentArea(
            name=name,
            bucket=bucket,
            central_lat=data.get("central_lat"),
            central_lng=data.get("central_lng"),
            planning_notes=data.get("planning_notes"),
        )
        db.session.add(area)
        db.session.commit()
        return jsonify(area.to_dict()), 201

    @app.route("/api/locations/<int:area_id>", methods=["GET"])
    def get_parent(area_id: int):
        area = ParentArea.query.get_or_404(area_id)
        return jsonify(area.to_dict())

    @app.route("/api/locations/<int:area_id>", methods=["PATCH"])
    def update_parent(area_id: int):
        area = ParentArea.query.get_or_404(area_id)
        data = request.get_json(force=True, silent=True) or {}
        if "name" in data:
            area.name = data["name"]
        if "bucket" in data:
            try:
                area.bucket = Bucket(data["bucket"])
            except ValueError:
                return {"error": f"invalid bucket: {data['bucket']}"}, 400
        if "central_lat" in data:
            area.central_lat = data["central_lat"]
        if "central_lng" in data:
            area.central_lng = data["central_lng"]
        if "planning_notes" in data:
            area.planning_notes = data["planning_notes"]
        if "sort_order" in data:
            area.sort_order = data["sort_order"]
        db.session.commit()
        return jsonify(area.to_dict())

    @app.route("/api/locations/<int:area_id>", methods=["DELETE"])
    def delete_parent(area_id: int):
        area = ParentArea.query.get_or_404(area_id)
        db.session.delete(area)
        db.session.commit()
        return "", 204

    @app.route("/api/locations/<int:area_id>/children", methods=["POST"])
    def create_child(area_id: int):
        area = ParentArea.query.get_or_404(area_id)
        data = request.get_json(force=True, silent=True) or {}
        name = (data.get("name") or "").strip()
        if not name:
            return {"error": "name is required"}, 400
        if data.get("lat") is None or data.get("lng") is None:
            return {"error": "lat and lng are required"}, 400
        child = ChildLocation(
            parent_area_id=area.id,
            name=name,
            lat=float(data["lat"]),
            lng=float(data["lng"]),
            address=data.get("address"),
            planning_notes=data.get("planning_notes"),
            seasonal_note=data.get("seasonal_note"),
        )
        db.session.add(child)
        db.session.commit()
        return jsonify(child.to_dict()), 201

    @app.route("/api/children/<int:child_id>", methods=["PATCH"])
    def update_child(child_id: int):
        child = ChildLocation.query.get_or_404(child_id)
        data = request.get_json(force=True, silent=True) or {}
        for field in (
            "name",
            "lat",
            "lng",
            "address",
            "star_rating",
            "planning_notes",
            "post_visit_notes",
            "seasonal_note",
            "sort_order",
        ):
            if field in data:
                setattr(child, field, data[field])
        db.session.commit()
        return jsonify(child.to_dict())

    @app.route("/api/children/<int:child_id>", methods=["DELETE"])
    def delete_child(child_id: int):
        child = ChildLocation.query.get_or_404(child_id)
        db.session.delete(child)
        db.session.commit()
        return "", 204

    @app.route("/api/children/<int:child_id>/weather", methods=["GET"])
    def child_weather(child_id: int):
        """Live weather summary + comfort index for a child location.

        Only Active and Watching locations should actually be called here — the
        frontend is responsible for that policy (Future Planning skips live data).
        """
        child = ChildLocation.query.get_or_404(child_id)
        try:
            raw = fetch_current_and_forecast(child)
        except WeatherAPIError as e:
            log.warning("Weather fetch failed for child %s: %s", child_id, e)
            return {"error": str(e)}, 502
        summary = extract_summary(raw)
        current = summary.get("current") or {}
        today = summary.get("today") or {}
        if (
            current.get("temp_f") is not None
            and current.get("humidity") is not None
        ):
            comfort = compute_comfort(
                temp_f=current["temp_f"],
                humidity_pct=current["humidity"],
                rain_chance_pct=today.get("rain_chance_pct") or 0,
                wind_mph=current.get("wind_mph") or 0,
            )
            summary["comfort"] = comfort.to_dict()
            summary["bug_risk"] = estimate_bug_risk(
                temp_f=current["temp_f"],
                humidity_pct=current["humidity"],
                recent_rain_inches=today.get("total_precip_in") or 0,
            )
        return jsonify(summary)

    @app.route("/api/geocode/search", methods=["GET"])
    def geocode_search():
        """Location search autocomplete for the 'add location' form.

        Primary: Nominatim (OpenStreetMap). It matches not just cities but
        parks, nature reserves, campgrounds, points of interest — which is
        what Stephanie actually uses this for ("Orlando Wetlands Park",
        "Fort De Soto", etc). City-only search was missing most of them.

        Fallback: WeatherAPI.com's search.json, which has fewer POIs but is
        still a useful safety net if Nominatim is slow/down.

        Returns a normalized shape:
          [{id, name, region, country, lat, lon, source}]
        where source is "osm" or "weatherapi". Frontend doesn't need to care.
        """
        q = (request.args.get("q") or "").strip()
        if len(q) < 2:
            return jsonify([])

        results: list[dict] = []

        # --- Primary: Nominatim (OSM) ---
        # Nominatim's usage policy requires a descriptive User-Agent with
        # contact info. We identify as Mygration so their ops team can reach
        # us if there's ever a problem with our traffic pattern.
        try:
            osm_resp = requests.get(
                "https://nominatim.openstreetmap.org/search",
                params={
                    "q": q,
                    "format": "jsonv2",
                    "limit": 10,
                    "addressdetails": 1,
                },
                headers={
                    "User-Agent": "Mygration/1.0 (stephanie.warner77@gmail.com)",
                    "Accept-Language": "en",
                },
                timeout=8,
            )
            if osm_resp.status_code == 200:
                raw_items = osm_resp.json() or []
                for i, item in enumerate(raw_items):
                    try:
                        lat = float(item.get("lat"))
                        lon = float(item.get("lon"))
                    except (TypeError, ValueError):
                        continue
                    # Nominatim's display_name is long and comma-separated —
                    # split it into a short name + "region, country" region
                    # string so the UI can show e.g. "Orlando Wetlands Park"
                    # as the headline and the rest as supporting text.
                    display = item.get("display_name") or ""
                    parts = [p.strip() for p in display.split(",") if p.strip()]
                    name = item.get("name") or (parts[0] if parts else q)
                    addr = item.get("address") or {}
                    country = addr.get("country") or (parts[-1] if parts else "")
                    region = (
                        addr.get("state")
                        or addr.get("county")
                        or addr.get("city")
                        or (parts[1] if len(parts) >= 2 else "")
                    )
                    results.append({
                        "id": f"osm:{item.get('place_id', i)}",
                        "name": name,
                        "region": region,
                        "country": country,
                        "lat": lat,
                        "lon": lon,
                        "source": "osm",
                    })
        except requests.RequestException as e:
            log.warning("Nominatim geocode failed: %s", e)

        if results:
            return jsonify(results)

        # --- Fallback: WeatherAPI search ---
        if not Config.WEATHER_API_KEY:
            return jsonify([])
        try:
            resp = requests.get(
                f"{Config.WEATHER_API_BASE}/search.json",
                params={"key": Config.WEATHER_API_KEY, "q": q},
                timeout=8,
            )
        except requests.RequestException as e:
            log.warning("Geocode search fallback failed: %s", e)
            return jsonify([])
        if resp.status_code != 200:
            return jsonify([])
        for item in resp.json() or []:
            results.append({
                "id": f"wapi:{item.get('id')}",
                "name": item.get("name") or "",
                "region": item.get("region") or "",
                "country": item.get("country") or "",
                "lat": item.get("lat"),
                "lon": item.get("lon"),
                "source": "weatherapi",
            })
        return jsonify(results)

    @app.route("/api/children/<int:child_id>/weather/historical", methods=["GET"])
    def child_weather_historical(child_id: int):
        """Historical research digest for a Future Planning spot.

        Query params:
            month: 1-12 (required) — the calendar month to research

        Samples 4 days from the most recent past year's same month, returns
        a rollup + the individual sample days so Stephanie can see the shape
        of the weather, not just an average.
        """
        child = ChildLocation.query.get_or_404(child_id)
        month_raw = request.args.get("month", "").strip()
        try:
            month = int(month_raw)
            if not (1 <= month <= 12):
                raise ValueError
        except ValueError:
            return {"error": "month query param required, 1-12"}, 400
        try:
            digest = fetch_historical_month_digest(child, month)
        except WeatherAPIError as e:
            log.warning("Historical digest failed for child %s: %s", child_id, e)
            return {"error": str(e)}, 502
        digest["child"] = child.to_dict()
        return jsonify(digest)

    @app.route("/api/children/<int:child_id>/weather/distribution", methods=["GET"])
    def child_weather_distribution(child_id: int):
        """Histogram of daily high temps over the last ~30 days.

        Powers the "Temperature Distribution" card in the detail view — gives
        a sense of the *shape* of the weather, not just averages. e.g. "70%
        of recent days were 80–89°F" tells Stephanie what to actually pack
        and plan for, rather than the average hiding the variance.
        """
        child = ChildLocation.query.get_or_404(child_id)
        try:
            dist = fetch_temperature_distribution(child)
        except WeatherAPIError as e:
            log.warning("Distribution fetch failed for child %s: %s", child_id, e)
            return {"error": str(e)}, 502
        return jsonify(dist)

    # -------------------------- Weather Logs ----------------------------------
    #
    # User-submitted "what was today actually like" entries. Stored alongside
    # an optional snapshot of the live weather at submit time, so we can later
    # learn how Stephanie's lived experience diverges from the comfort score.

    @app.route("/api/children/<int:child_id>/logs", methods=["GET"])
    def list_child_logs(child_id: int):
        """All weather logs for a child, newest first."""
        child = ChildLocation.query.get_or_404(child_id)
        logs = (
            WeatherLog.query.filter_by(child_location_id=child.id)
            .order_by(WeatherLog.logged_at.desc())
            .all()
        )
        return jsonify([log_row.to_dict() for log_row in logs])

    @app.route("/api/children/<int:child_id>/logs", methods=["POST"])
    def create_child_log(child_id: int):
        """Record a weather log for today.

        Body:
          { temp_rating, humidity_rating, bug_rating, note }
          ratings are one of "up" | "neutral" | "down" (or omitted/null).

        Optionally captures a snapshot of the live forecast/comfort numbers
        at submit time so we can correlate Stephanie's ratings against what
        the model predicted. If WeatherAPI is unavailable the log still saves
        — the snapshot is best-effort.
        """
        import json as _json

        child = ChildLocation.query.get_or_404(child_id)
        data = request.get_json(force=True, silent=True) or {}

        def _norm_rating(v):
            if v is None or v == "":
                return None
            v = str(v).strip().lower()
            return v if v in WeatherLog.RATING_VALUES else None

        # Best-effort snapshot. Don't block the save if it fails.
        snapshot = None
        try:
            raw = fetch_current_and_forecast(child)
            summary = extract_summary(raw)
            current = summary.get("current") or {}
            today = summary.get("today") or {}
            comfort_dict = None
            bug = None
            if (
                current.get("temp_f") is not None
                and current.get("humidity") is not None
            ):
                comfort_dict = compute_comfort(
                    temp_f=current["temp_f"],
                    humidity_pct=current["humidity"],
                    rain_chance_pct=today.get("rain_chance_pct") or 0,
                    wind_mph=current.get("wind_mph") or 0,
                ).to_dict()
                bug = estimate_bug_risk(
                    temp_f=current["temp_f"],
                    humidity_pct=current["humidity"],
                    recent_rain_inches=today.get("total_precip_in") or 0,
                )
            snapshot = {
                "temp_f": current.get("temp_f"),
                "humidity": current.get("humidity"),
                "wind_mph": current.get("wind_mph"),
                "condition": current.get("condition"),
                "rain_chance_pct": today.get("rain_chance_pct"),
                "comfort": comfort_dict,
                "bug_risk": bug,
            }
        except Exception as e:  # noqa: BLE001 — snapshot is optional
            log.info("Snapshot capture failed for log on child %s: %s", child_id, e)

        entry = WeatherLog(
            child_location_id=child.id,
            temp_rating=_norm_rating(data.get("temp_rating")),
            humidity_rating=_norm_rating(data.get("humidity_rating")),
            bug_rating=_norm_rating(data.get("bug_rating")),
            note=(data.get("note") or "").strip() or None,
            weather_snapshot_json=_json.dumps(snapshot) if snapshot else None,
        )
        db.session.add(entry)
        db.session.commit()
        return jsonify(entry.to_dict()), 201

    @app.route("/api/logs/<int:log_id>", methods=["DELETE"])
    def delete_log(log_id: int):
        entry = WeatherLog.query.get_or_404(log_id)
        db.session.delete(entry)
        db.session.commit()
        return "", 204

    # -------------------------- Trip Planner ----------------------------------
    #
    # Phase 2 feature. Backend scope for this commit: CRUD over TripPlan + TripStop
    # with a tiny up/down reorder endpoint. No weather yet — the companion
    # /api/trips/<id>/weather endpoint is the next commit.

    def _parse_iso_date(value):
        """'2026-05-12' → date, '' / None → None. Raises ValueError on garbage."""
        if value is None or value == "":
            return None
        from datetime import date

        if isinstance(value, date):
            return value
        from datetime import datetime as dt

        return dt.fromisoformat(str(value)).date()

    @app.route("/api/trips", methods=["GET"])
    def list_trips():
        """All trip plans, ordered, with their stops nested."""
        trips = TripPlan.query.order_by(TripPlan.sort_order, TripPlan.created_at).all()
        return jsonify([t.to_dict() for t in trips])

    @app.route("/api/trips", methods=["POST"])
    def create_trip():
        data = request.get_json(force=True, silent=True) or {}
        name = (data.get("name") or "").strip()
        if not name:
            return {"error": "name is required"}, 400
        # Default sort_order = end of current list so new trips append.
        last = TripPlan.query.order_by(TripPlan.sort_order.desc()).first()
        next_order = (last.sort_order + 1) if last else 0
        trip = TripPlan(
            name=name,
            color=(data.get("color") or "#3b82f6")[:32],
            sort_order=data.get("sort_order", next_order),
        )
        db.session.add(trip)
        db.session.commit()
        return jsonify(trip.to_dict()), 201

    @app.route("/api/trips/<int:trip_id>", methods=["GET"])
    def get_trip(trip_id: int):
        trip = TripPlan.query.get_or_404(trip_id)
        return jsonify(trip.to_dict())

    @app.route("/api/trips/<int:trip_id>", methods=["PATCH"])
    def update_trip(trip_id: int):
        trip = TripPlan.query.get_or_404(trip_id)
        data = request.get_json(force=True, silent=True) or {}
        if "name" in data:
            name = (data["name"] or "").strip()
            if not name:
                return {"error": "name cannot be empty"}, 400
            trip.name = name
        if "color" in data and data["color"]:
            trip.color = str(data["color"])[:32]
        if "sort_order" in data:
            trip.sort_order = int(data["sort_order"])
        db.session.commit()
        return jsonify(trip.to_dict())

    @app.route("/api/trips/<int:trip_id>", methods=["DELETE"])
    def delete_trip(trip_id: int):
        trip = TripPlan.query.get_or_404(trip_id)
        db.session.delete(trip)
        db.session.commit()
        return "", 204

    @app.route("/api/trips/<int:trip_id>/stops", methods=["POST"])
    def create_stop(trip_id: int):
        trip = TripPlan.query.get_or_404(trip_id)
        data = request.get_json(force=True, silent=True) or {}
        name = (data.get("name") or "").strip()
        if not name:
            return {"error": "name is required"}, 400
        if data.get("lat") is None or data.get("lng") is None:
            return {"error": "lat and lng are required"}, 400
        try:
            start_date = _parse_iso_date(data.get("start_date"))
            end_date = _parse_iso_date(data.get("end_date"))
        except ValueError:
            return {"error": "start_date / end_date must be YYYY-MM-DD"}, 400

        child_loc_id = data.get("child_location_id")
        if child_loc_id is not None:
            # Validate the link points to a real row so we don't accumulate ghosts.
            if ChildLocation.query.get(child_loc_id) is None:
                return {"error": "child_location_id does not exist"}, 400

        # Append to end of stop list by default.
        last = (
            TripStop.query.filter_by(trip_plan_id=trip.id)
            .order_by(TripStop.sort_order.desc())
            .first()
        )
        next_order = (last.sort_order + 1) if last else 0

        stop = TripStop(
            trip_plan_id=trip.id,
            child_location_id=child_loc_id,
            name=name,
            lat=float(data["lat"]),
            lng=float(data["lng"]),
            start_date=start_date,
            end_date=end_date,
            planning_notes=data.get("planning_notes"),
            sort_order=data.get("sort_order", next_order),
        )
        db.session.add(stop)
        db.session.commit()
        return jsonify(stop.to_dict()), 201

    @app.route("/api/stops/<int:stop_id>", methods=["PATCH"])
    def update_stop(stop_id: int):
        stop = TripStop.query.get_or_404(stop_id)
        data = request.get_json(force=True, silent=True) or {}

        if "name" in data:
            name = (data["name"] or "").strip()
            if not name:
                return {"error": "name cannot be empty"}, 400
            stop.name = name
        for field in ("lat", "lng"):
            if field in data and data[field] is not None:
                setattr(stop, field, float(data[field]))
        for field in ("start_date", "end_date"):
            if field in data:
                try:
                    setattr(stop, field, _parse_iso_date(data[field]))
                except ValueError:
                    return {"error": f"{field} must be YYYY-MM-DD"}, 400
        if "planning_notes" in data:
            stop.planning_notes = data["planning_notes"]
        if "child_location_id" in data:
            cid = data["child_location_id"]
            if cid is not None and ChildLocation.query.get(cid) is None:
                return {"error": "child_location_id does not exist"}, 400
            stop.child_location_id = cid
        if "sort_order" in data:
            stop.sort_order = int(data["sort_order"])
        db.session.commit()
        return jsonify(stop.to_dict())

    @app.route("/api/stops/<int:stop_id>", methods=["DELETE"])
    def delete_stop(stop_id: int):
        stop = TripStop.query.get_or_404(stop_id)
        db.session.delete(stop)
        db.session.commit()
        return "", 204

    @app.route("/api/stops/<int:stop_id>/move", methods=["POST"])
    def move_stop(stop_id: int):
        """Swap sort_order with the stop above or below this one.

        Body: {"direction": "up" | "down"}. No-op at the ends of the list.
        Swap (not re-number) keeps DB writes small and avoids drift when
        multiple stops are moved in a session.
        """
        stop = TripStop.query.get_or_404(stop_id)
        data = request.get_json(force=True, silent=True) or {}
        direction = (data.get("direction") or "").strip().lower()
        if direction not in ("up", "down"):
            return {"error": "direction must be 'up' or 'down'"}, 400

        # Find the neighbor to swap with (strict ordering on sort_order).
        q = TripStop.query.filter_by(trip_plan_id=stop.trip_plan_id)
        if direction == "up":
            neighbor = (
                q.filter(TripStop.sort_order < stop.sort_order)
                .order_by(TripStop.sort_order.desc())
                .first()
            )
        else:
            neighbor = (
                q.filter(TripStop.sort_order > stop.sort_order)
                .order_by(TripStop.sort_order.asc())
                .first()
            )
        if neighbor is None:
            # Already at the edge; return current state rather than erroring.
            return jsonify(stop.to_dict())

        stop.sort_order, neighbor.sort_order = neighbor.sort_order, stop.sort_order
        db.session.commit()
        return jsonify(stop.to_dict())

    @app.route("/api/stops/<int:stop_id>/weather", methods=["GET"])
    def stop_weather(stop_id: int):
        """Live weather summary + comfort index for a trip stop.

        Mirrors /api/children/<id>/weather but keyed on a TripStop's lat/lng.
        Used by the Dashboard's plan buckets: each stop renders as a card with
        today's conditions + 10-day forecast. Intentionally *ignores*
        stop.start_date — Stephanie iterates dates too much for a date-keyed
        forecast to be useful outside the Trip Planner itself. The Trip Planner
        views (Timeline/List/Calendar) keep their date-aware projection via
        /api/trips/<id>/weather.
        """
        stop = TripStop.query.get_or_404(stop_id)

        # Reuse the same shim trick /api/trips/<id>/weather uses so we share
        # the forecast cache (same coords → same hit), with a negative id that
        # can't collide with real child_location cache rows.
        class _StopShim:
            id = -stop.id
            lat = stop.lat
            lng = stop.lng

        try:
            raw = fetch_current_and_forecast(_StopShim())  # type: ignore[arg-type]
        except WeatherAPIError as e:
            log.warning("Weather fetch failed for stop %s: %s", stop_id, e)
            return {"error": str(e)}, 502
        summary = extract_summary(raw)
        current = summary.get("current") or {}
        today = summary.get("today") or {}
        if (
            current.get("temp_f") is not None
            and current.get("humidity") is not None
        ):
            comfort = compute_comfort(
                temp_f=current["temp_f"],
                humidity_pct=current["humidity"],
                rain_chance_pct=today.get("rain_chance_pct") or 0,
                wind_mph=current.get("wind_mph") or 0,
            )
            summary["comfort"] = comfort.to_dict()
            summary["bug_risk"] = estimate_bug_risk(
                temp_f=current["temp_f"],
                humidity_pct=current["humidity"],
                recent_rain_inches=today.get("total_precip_in") or 0,
            )
        return jsonify(summary)

    @app.route("/api/children/<int:child_id>/weather/detail", methods=["GET"])
    def child_weather_detail(child_id: int):
        """Full weather detail for the drill-in view.

        Returns the union of the dashboard summary (comfort, bug risk, alerts,
        10-day forecast) and the detail fields (hourly + astro + wind). Same
        upstream cache as the summary endpoint, so clicking into a spot doesn't
        cost a second WeatherAPI call.

        The drill-in needs comfort/alerts/forecast to render the header badge,
        alerts list, 10-day table, and comfort-breakdown modal — all of which
        were missing when `detail` was hourly-only.
        """
        child = ChildLocation.query.get_or_404(child_id)
        try:
            raw = fetch_current_and_forecast(child)
        except WeatherAPIError as e:
            log.warning("Weather detail fetch failed for child %s: %s", child_id, e)
            return {"error": str(e)}, 502

        detail = extract_detail(raw)
        summary = extract_summary(raw)

        # Pull the useful summary bits into the detail response so the frontend
        # only has to hit one endpoint. Don't overwrite detail.current — it's
        # richer (has wind_dir, wind_degree, condition_code etc.).
        detail["forecast_days"] = summary.get("forecast_days") or []
        detail["alerts"] = summary.get("alerts")

        # Compute comfort + bug risk from the detail's current data (same shape
        # as child_weather does).
        current = detail.get("current") or {}
        today = detail.get("today") or {}
        if current.get("temp_f") is not None and current.get("humidity") is not None:
            comfort = compute_comfort(
                temp_f=current["temp_f"],
                humidity_pct=current["humidity"],
                rain_chance_pct=today.get("rain_chance_pct") or 0,
                wind_mph=current.get("wind_mph") or 0,
            )
            detail["comfort"] = comfort.to_dict()
            detail["bug_risk"] = estimate_bug_risk(
                temp_f=current["temp_f"],
                humidity_pct=current["humidity"],
                recent_rain_inches=today.get("total_precip_in") or 0,
            )

        detail["child"] = child.to_dict()
        return jsonify(detail)

    @app.route("/api/trips/<int:trip_id>/weather", methods=["GET"])
    def trip_weather(trip_id: int):
        """Per-stop weather projection for a trip plan.

        For each stop:
          - Fetch forecast + current (cached for ~1h). Shared cache with the
            dashboard so a stop that matches a tracked child is effectively free.
          - If the stop has a start_date within the forecast window (~10 days),
            use that specific forecast day's numbers. Otherwise fall back to
            "current conditions" at that lat/lng — a reasonable preview even if
            the trip is farther out. WeatherAPI free plan = 3 days; paid = 14.
          - Compute comfort score and bug risk from the numbers we end up with.
          - Surface the same alerts the dashboard uses.

        Stops that fail to fetch (invalid coords, API down) return mode='error'
        so the UI can render a "—" without a hard failure.

        Response shape:
            {
              "trip_id": 1,
              "stops": [ { stop_id, mode, temp_f, humidity, comfort, ... }, ... ],
              "summary": { avg_comfort, worst_bug, has_warnings }
            }
        """
        trip = TripPlan.query.get_or_404(trip_id)

        from datetime import date, timedelta as _td

        today = date.today()
        forecast_window_end = today + _td(days=9)  # inclusive: today + next 9 = 10 days

        bug_rank = {"low": 0, "moderate": 1, "high": 2, "severe": 3}
        out_stops: list[dict] = []

        # Use a temporary ChildLocation-shaped object so we can reuse
        # fetch_current_and_forecast/extract_summary. The shim only needs
        # .id, .lat, .lng (id is used as the cache key).
        class _StopShim:
            def __init__(self, stop: TripStop):
                # Use a negative id so we don't collide with real child_location
                # cache rows. Same coords → same cache entry across runs.
                self.id = -(stop.id)
                self.lat = stop.lat
                self.lng = stop.lng

        for stop in sorted(trip.stops, key=lambda s: (s.sort_order, s.id)):
            entry: dict = {
                "stop_id": stop.id,
                "mode": "unknown",
                "temp_f": None,
                "humidity": None,
                "condition": None,
                "bug_risk": None,
                "comfort": None,
                "alerts": None,
                "error": None,
            }
            try:
                shim = _StopShim(stop)
                raw = fetch_current_and_forecast(shim)  # type: ignore[arg-type]
                summary = extract_summary(raw)
            except WeatherAPIError as e:
                entry["mode"] = "error"
                entry["error"] = str(e)
                out_stops.append(entry)
                continue

            forecast_days = summary.get("forecast_days") or []
            current = summary.get("current") or {}
            today_dict = summary.get("today") or {}
            alerts = summary.get("alerts") or {}

            # Prefer a specific forecast day if the stop's start_date falls
            # inside the forecast window we have.
            target_day = None
            mode = "current"
            if stop.start_date and today <= stop.start_date <= forecast_window_end:
                iso = stop.start_date.isoformat()
                for d in forecast_days:
                    if d.get("date") == iso:
                        target_day = d
                        mode = "forecast"
                        break

            if target_day is not None:
                entry["mode"] = "forecast"
                entry["temp_f"] = target_day.get("high_f")
                entry["low_f"] = target_day.get("low_f")
                entry["humidity"] = target_day.get("avg_humidity")
                entry["condition"] = target_day.get("condition")
                entry["rain_chance_pct"] = target_day.get("rain_chance_pct")
                # Comfort for a future day: use its high temp + avg humidity
                # + rain chance. Wind unknown at this level of detail so pass
                # a neutral value (falls into the "comfortable" bucket).
                if (
                    entry["temp_f"] is not None
                    and entry["humidity"] is not None
                ):
                    c = compute_comfort(
                        temp_f=entry["temp_f"],
                        humidity_pct=entry["humidity"],
                        rain_chance_pct=entry.get("rain_chance_pct") or 0,
                        wind_mph=0,  # not in forecast_days payload
                    )
                    entry["comfort"] = c.to_dict()
                    entry["bug_risk"] = estimate_bug_risk(
                        temp_f=entry["temp_f"],
                        humidity_pct=entry["humidity"],
                        recent_rain_inches=0,
                    )
            else:
                # "current" mode — use right-now conditions.
                entry["mode"] = mode
                entry["temp_f"] = current.get("temp_f")
                entry["humidity"] = current.get("humidity")
                entry["condition"] = current.get("condition")
                if (
                    current.get("temp_f") is not None
                    and current.get("humidity") is not None
                ):
                    c = compute_comfort(
                        temp_f=current["temp_f"],
                        humidity_pct=current["humidity"],
                        rain_chance_pct=today_dict.get("rain_chance_pct") or 0,
                        wind_mph=current.get("wind_mph") or 0,
                    )
                    entry["comfort"] = c.to_dict()
                    entry["bug_risk"] = estimate_bug_risk(
                        temp_f=current["temp_f"],
                        humidity_pct=current["humidity"],
                        recent_rain_inches=today_dict.get("total_precip_in") or 0,
                    )

            # Alert tags: extended heat/cold from forecast_days, plus native.
            entry["alerts"] = {
                "extended_heat": bool(alerts.get("extended_heat")),
                "extended_heat_days": alerts.get("extended_heat_days") or 0,
                "extended_cold": bool(alerts.get("extended_cold")),
                "extended_cold_days": alerts.get("extended_cold_days") or 0,
                "native": alerts.get("native") or [],
            }

            # Per-day breakdown for dated stops: one dict per day in the
            # stop's [start_date, end_date] range that also falls inside the
            # forecast window. Used by Calendar (show temp per cell) and List
            # (range summary for multi-day stops). Days outside the forecast
            # horizon are simply not included — frontend shows nothing for
            # those cells.
            days_in_range: list[dict] = []
            if stop.start_date:
                fd_by_iso = {d.get("date"): d for d in forecast_days if d.get("date")}
                span_start = max(stop.start_date, today)
                span_end = min(stop.end_date or stop.start_date, forecast_window_end)
                cursor_d = span_start
                while cursor_d <= span_end:
                    d_raw = fd_by_iso.get(cursor_d.isoformat())
                    if d_raw is not None:
                        d_high = d_raw.get("high_f")
                        d_low = d_raw.get("low_f")
                        d_humidity = d_raw.get("avg_humidity")
                        d_rain = d_raw.get("rain_chance_pct") or 0
                        d_comfort = None
                        d_bug = None
                        if d_high is not None and d_humidity is not None:
                            _c = compute_comfort(
                                temp_f=d_high,
                                humidity_pct=d_humidity,
                                rain_chance_pct=d_rain,
                                wind_mph=0,
                            )
                            d_comfort = _c.to_dict()
                            d_bug = estimate_bug_risk(
                                temp_f=d_high,
                                humidity_pct=d_humidity,
                                recent_rain_inches=0,
                            )
                        days_in_range.append({
                            "date": cursor_d.isoformat(),
                            "temp_f_high": d_high,
                            "temp_f_low": d_low,
                            "humidity": d_humidity,
                            "rain_chance_pct": d_rain,
                            "condition": d_raw.get("condition"),
                            "comfort": d_comfort,
                            "bug_risk": d_bug,
                        })
                    cursor_d = cursor_d + _td(days=1)
            entry["days"] = days_in_range

            out_stops.append(entry)

        # Trip-level summary: avg comfort, worst bug, any warnings flag.
        comfort_scores = [
            s["comfort"]["composite"]
            for s in out_stops
            if s.get("comfort") and s["comfort"].get("composite") is not None
        ]
        worst_bug = None
        for s in out_stops:
            b = s.get("bug_risk")
            if b and (worst_bug is None or bug_rank.get(b, -1) > bug_rank.get(worst_bug, -1)):
                worst_bug = b

        has_warnings = any(
            (s.get("alerts") or {}).get("extended_heat")
            or (s.get("alerts") or {}).get("extended_cold")
            or ((s.get("alerts") or {}).get("native") or [])
            for s in out_stops
        )

        trip_summary = {
            "avg_comfort": (
                round(sum(comfort_scores) / len(comfort_scores), 1)
                if comfort_scores
                else None
            ),
            "worst_bug": worst_bug,
            "has_warnings": has_warnings,
            "stop_count": len(out_stops),
        }

        return jsonify({
            "trip_id": trip.id,
            "stops": out_stops,
            "summary": trip_summary,
        })

    return app


app = create_app()


if __name__ == "__main__":
    # Local dev entry point. Railway uses gunicorn via Procfile.
    app.run(host="0.0.0.0", port=5000, debug=app.config["DEBUG"])
