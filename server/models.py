"""Database models for Mygration.

Two-level location hierarchy: ParentArea (e.g., "Titusville, FL") contains one
or more ChildLocations ("Coast Spot", "Inland Parking", "Merritt Island").
Each ParentArea is assigned to exactly one bucket: active / watching /
future_planning.

Phase 1 scope: locations + weather cache. Logs, parking, amenities, tags,
trip plans, and correction factors get added in later phases — their tables
are sketched here as comments but not yet implemented.
"""

from datetime import datetime, timezone
from enum import Enum

from flask_sqlalchemy import SQLAlchemy
from sqlalchemy import Enum as SAEnum

db = SQLAlchemy()


def utcnow() -> datetime:
    """Timezone-aware UTC now, for DB defaults."""
    return datetime.now(timezone.utc)


class Bucket(str, Enum):
    """Where a location lives in the library.

    - active: primary focus, live data pulled, featured prominently
    - watching: nearby backup option, live data pulled (lighter treatment)
    - future_planning: long-horizon ideas, no live data pull, historical only
    """

    ACTIVE = "active"
    WATCHING = "watching"
    FUTURE_PLANNING = "future_planning"


class ParentArea(db.Model):
    """A named geographic region (e.g., 'Titusville, FL', 'Christmas, FL').

    Holds the bucket assignment for the whole area. Weather for the area is
    either fetched at the parent's central_lat/lng (if no children exist) or
    aggregated from the children.
    """

    __tablename__ = "parent_areas"

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(255), nullable=False, unique=True)
    central_lat = db.Column(db.Float, nullable=True)
    central_lng = db.Column(db.Float, nullable=True)
    bucket = db.Column(
        SAEnum(Bucket, values_callable=lambda x: [e.value for e in x]),
        nullable=False,
        default=Bucket.ACTIVE,
    )
    # Free-text "why I'm tracking this area" notes.
    planning_notes = db.Column(db.Text, nullable=True)
    # Display order within the bucket (user-draggable in UI later).
    sort_order = db.Column(db.Integer, nullable=False, default=0)

    created_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utcnow)
    updated_at = db.Column(
        db.DateTime(timezone=True), nullable=False, default=utcnow, onupdate=utcnow
    )

    children = db.relationship(
        "ChildLocation",
        back_populates="parent_area",
        cascade="all, delete-orphan",
        order_by="ChildLocation.sort_order",
    )

    def to_dict(self, include_children: bool = True) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "central_lat": self.central_lat,
            "central_lng": self.central_lng,
            "bucket": self.bucket.value if isinstance(self.bucket, Bucket) else self.bucket,
            "planning_notes": self.planning_notes,
            "sort_order": self.sort_order,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
            "children": (
                [c.to_dict() for c in self.children] if include_children else None
            ),
        }


class ChildLocation(db.Model):
    """A specific spot within a ParentArea (e.g., 'Coast Spot' in Titusville).

    Precise coordinates live here — this is what gets passed to the weather
    API. Inherits bucket from its ParentArea (no separate column).
    """

    __tablename__ = "child_locations"

    id = db.Column(db.Integer, primary_key=True)
    parent_area_id = db.Column(
        db.Integer,
        db.ForeignKey("parent_areas.id", ondelete="CASCADE"),
        nullable=False,
    )
    name = db.Column(db.String(255), nullable=False)
    lat = db.Column(db.Float, nullable=False)
    lng = db.Column(db.Float, nullable=False)
    address = db.Column(db.String(500), nullable=True)
    star_rating = db.Column(db.Integer, nullable=True)  # 1-5, nullable = not yet rated
    planning_notes = db.Column(db.Text, nullable=True)
    post_visit_notes = db.Column(db.Text, nullable=True)
    # Displayed on Watching cards ("Summer (Jul-Aug): Highs 60-70°F, best mid-July
    # for puffins"). Only surfaced in the form when the parent is in the Watching
    # bucket, but the column lives on every child for schema simplicity.
    seasonal_note = db.Column(db.Text, nullable=True)
    sort_order = db.Column(db.Integer, nullable=False, default=0)

    created_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utcnow)
    updated_at = db.Column(
        db.DateTime(timezone=True), nullable=False, default=utcnow, onupdate=utcnow
    )

    parent_area = db.relationship("ParentArea", back_populates="children")

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "parent_area_id": self.parent_area_id,
            "name": self.name,
            "lat": self.lat,
            "lng": self.lng,
            "address": self.address,
            "star_rating": self.star_rating,
            "planning_notes": self.planning_notes,
            "post_visit_notes": self.post_visit_notes,
            "seasonal_note": self.seasonal_note,
            "sort_order": self.sort_order,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }


class WeatherCache(db.Model):
    """Cached weather payloads from WeatherAPI.com.

    Keyed by (child_location_id, data_type). `data_type` values:
    - 'current': current conditions
    - 'forecast': 10-day forecast
    - 'history:YYYY-MM-DD': a single historical day (for distribution building)

    Payload stored as JSON text (SQLite-compatible). Postgres JSONB can be
    used once fully on Railway — keep as Text for portability for now.
    """

    __tablename__ = "weather_cache"

    id = db.Column(db.Integer, primary_key=True)
    child_location_id = db.Column(
        db.Integer,
        db.ForeignKey("child_locations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    data_type = db.Column(db.String(64), nullable=False, index=True)
    fetched_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utcnow)
    expires_at = db.Column(db.DateTime(timezone=True), nullable=True)
    payload_json = db.Column(db.Text, nullable=False)

    __table_args__ = (
        db.UniqueConstraint(
            "child_location_id", "data_type", name="uq_weather_cache_loc_type"
        ),
    )


# --- Phase 2+ models sketched out for future migrations ----------------------
#
# class ComfortLog(db.Model): ...
# class ParkingSpot(db.Model): ...
# class NearbyAmenity(db.Model): ...
# class NatureTag(db.Model): ...
# class CorrectionFactor(db.Model): ...
# class TripPlan(db.Model): ...
# class TripStop(db.Model): ...
#
# Schemas for these live in the PROJECT-GUIDE.md feature spec. They will be
# added in their own migrations as each phase comes online.
