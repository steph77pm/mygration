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

In production on Railway, gunicorn serves this via the Procfile.
"""

from __future__ import annotations

import logging
import os
from pathlib import Path

from flask import Flask, jsonify, request
from flask_cors import CORS
from flask_migrate import Migrate

from comfort_service import compute_comfort, estimate_bug_risk
from config import Config
from models import Bucket, ChildLocation, ParentArea, db
from weather_service import WeatherAPIError, extract_summary, fetch_current_and_forecast

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("mygration")


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

    return app


app = create_app()


if __name__ == "__main__":
    # Local dev entry point. Railway uses gunicorn via Procfile.
    app.run(host="0.0.0.0", port=5000, debug=app.config["DEBUG"])
