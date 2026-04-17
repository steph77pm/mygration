"""Seed the database with Stephanie's starter locations.

Idempotent — safe to run multiple times. Skips areas/children that already
exist by name. Use this to bootstrap a fresh dev or Railway database.

    python seed.py
"""

from app import create_app
from models import Bucket, ChildLocation, ParentArea, db


# Starter data pulled from PROJECT-GUIDE.md examples + prototype.
# Coordinates are approximate — Stephanie can refine inside the app.
SEED_DATA = [
    # --- Active ---
    {
        "name": "Titusville, FL",
        "bucket": Bucket.ACTIVE,
        "central_lat": 28.6122,
        "central_lng": -80.8076,
        "planning_notes": "Currently parked here. Space Coast birding, rocket launches.",
        "children": [
            {"name": "Coast Spot", "lat": 28.5152, "lng": -80.5683},
            {"name": "Inland Parking", "lat": 28.6122, "lng": -80.8076},
            {"name": "Merritt Island NWR", "lat": 28.6408, "lng": -80.7306},
        ],
    },
    {
        "name": "Christmas, FL",
        "bucket": Bucket.ACTIVE,
        "central_lat": 28.5372,
        "central_lng": -81.0281,
        "planning_notes": "Orlando Wetlands has been incredible in past Aprils.",
        "children": [
            {"name": "Orlando Wetlands Park", "lat": 28.5717, "lng": -80.9948},
        ],
    },
    # --- Watching ---
    {
        "name": "St. Augustine, FL",
        "bucket": Bucket.WATCHING,
        "central_lat": 29.9012,
        "central_lng": -81.3124,
        "planning_notes": "Backup option if Titusville gets buggy.",
        "children": [
            {"name": "Anastasia State Park", "lat": 29.8741, "lng": -81.2714},
        ],
    },
    {
        "name": "Sebastian Inlet / Melbourne, FL",
        "bucket": Bucket.WATCHING,
        "central_lat": 27.8600,
        "central_lng": -80.4453,
        "planning_notes": "Good coastal alternate — shorebirds, beach access.",
        "children": [
            {"name": "Sebastian Inlet SP", "lat": 27.8600, "lng": -80.4453},
        ],
    },
    {
        "name": "Pinellas Park, FL",
        "bucket": Bucket.WATCHING,
        "central_lat": 27.8428,
        "central_lng": -82.6995,
        "planning_notes": "Gulf side option — Fort De Soto nearby.",
        "children": [
            {"name": "Fort De Soto", "lat": 27.6120, "lng": -82.7370},
        ],
    },
    # --- Future Planning ---
    {
        "name": "St. John's, Newfoundland",
        "bucket": Bucket.FUTURE_PLANNING,
        "central_lat": 47.5615,
        "central_lng": -52.7126,
        "planning_notes": "Puffins, icebergs, dramatic coastline — summer 2026 or 2027.",
        "children": [
            {"name": "Cape Spear", "lat": 47.5236, "lng": -52.6195},
        ],
    },
]


def run() -> None:
    app = create_app()
    with app.app_context():
        db.create_all()
        for area_spec in SEED_DATA:
            existing = ParentArea.query.filter_by(name=area_spec["name"]).first()
            if existing:
                print(f"  skip: {area_spec['name']} (already exists)")
                continue
            area = ParentArea(
                name=area_spec["name"],
                bucket=area_spec["bucket"],
                central_lat=area_spec["central_lat"],
                central_lng=area_spec["central_lng"],
                planning_notes=area_spec.get("planning_notes"),
            )
            db.session.add(area)
            db.session.flush()  # get area.id
            for i, child_spec in enumerate(area_spec["children"]):
                child = ChildLocation(
                    parent_area_id=area.id,
                    name=child_spec["name"],
                    lat=child_spec["lat"],
                    lng=child_spec["lng"],
                    sort_order=i,
                )
                db.session.add(child)
            print(f"  added: {area.name} ({len(area_spec['children'])} children)")
        db.session.commit()
        total = ParentArea.query.count()
        print(f"Seed complete. Total parent areas: {total}")


if __name__ == "__main__":
    run()
