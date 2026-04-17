"""WeatherAPI.com integration.

Handles:
  - fetching current conditions + forecast for a lat/lng
  - fetching historical daily weather (for distribution building in Phase 2)
  - caching payloads in the WeatherCache table so we don't hammer the API

Kept deliberately thin in Phase 1 — just enough to populate the dashboard.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta, timezone
from typing import Optional

import requests

from config import Config
from models import ChildLocation, WeatherCache, db

log = logging.getLogger(__name__)


# How long a cached response is considered fresh
CURRENT_TTL = timedelta(minutes=15)
FORECAST_TTL = timedelta(hours=1)
HISTORY_TTL = timedelta(days=30)  # history is basically immutable


class WeatherAPIError(Exception):
    """Raised when WeatherAPI.com returns an error or we fail to reach it."""


def _get_cached(child_id: int, data_type: str, ttl: timedelta) -> Optional[dict]:
    """Return cached payload if still within TTL, else None."""
    row = WeatherCache.query.filter_by(
        child_location_id=child_id, data_type=data_type
    ).first()
    if row is None:
        return None
    fetched = row.fetched_at
    if fetched.tzinfo is None:
        # SQLite stores naive datetimes; treat as UTC.
        fetched = fetched.replace(tzinfo=timezone.utc)
    if datetime.now(timezone.utc) - fetched > ttl:
        return None
    try:
        return json.loads(row.payload_json)
    except json.JSONDecodeError:
        log.warning("Corrupt cache row id=%s; ignoring.", row.id)
        return None


def _store_cached(child_id: int, data_type: str, payload: dict) -> None:
    """Upsert a cached payload."""
    row = WeatherCache.query.filter_by(
        child_location_id=child_id, data_type=data_type
    ).first()
    payload_json = json.dumps(payload)
    if row is None:
        row = WeatherCache(
            child_location_id=child_id,
            data_type=data_type,
            payload_json=payload_json,
        )
        db.session.add(row)
    else:
        row.payload_json = payload_json
        row.fetched_at = datetime.now(timezone.utc)
    db.session.commit()


def _call(endpoint: str, params: dict) -> dict:
    """Low-level WeatherAPI call with auth + error handling."""
    if not Config.WEATHER_API_KEY:
        raise WeatherAPIError("WEATHER_API_KEY not configured — see .env.example")
    params = {**params, "key": Config.WEATHER_API_KEY}
    url = f"{Config.WEATHER_API_BASE}/{endpoint}"
    try:
        resp = requests.get(url, params=params, timeout=15)
    except requests.RequestException as e:
        raise WeatherAPIError(f"Network error calling WeatherAPI: {e}") from e
    if resp.status_code != 200:
        raise WeatherAPIError(
            f"WeatherAPI {endpoint} returned {resp.status_code}: {resp.text[:200]}"
        )
    return resp.json()


def fetch_current_and_forecast(child: ChildLocation, days: int = 10) -> dict:
    """Get current conditions + multi-day forecast for a child location.

    Returns the WeatherAPI `forecast.json` payload (dict). Cached in WeatherCache.
    """
    cache_type = f"forecast:{days}d"
    cached = _get_cached(child.id, cache_type, FORECAST_TTL)
    if cached is not None:
        return cached
    data = _call(
        "forecast.json",
        {"q": f"{child.lat},{child.lng}", "days": days, "aqi": "no", "alerts": "yes"},
    )
    _store_cached(child.id, cache_type, data)
    return data


def fetch_history(child: ChildLocation, date_str: str) -> dict:
    """Get a single historical day's weather (YYYY-MM-DD).

    Used for building the realistic-predictions temperature/humidity
    distributions in Phase 2.
    """
    cache_type = f"history:{date_str}"
    cached = _get_cached(child.id, cache_type, HISTORY_TTL)
    if cached is not None:
        return cached
    data = _call(
        "history.json",
        {"q": f"{child.lat},{child.lng}", "dt": date_str},
    )
    _store_cached(child.id, cache_type, data)
    return data


def extract_summary(forecast_payload: dict) -> dict:
    """Pull the handful of fields the dashboard card needs from a forecast payload.

    Keeps the API response small and stable even if WeatherAPI's format shifts.
    """
    try:
        current = forecast_payload.get("current", {})
        forecast_days = forecast_payload.get("forecast", {}).get("forecastday", [])
        today = forecast_days[0] if forecast_days else {}
        today_day = today.get("day", {})
        return {
            "current": {
                "temp_f": current.get("temp_f"),
                "feels_like_f": current.get("feelslike_f"),
                "humidity": current.get("humidity"),
                "wind_mph": current.get("wind_mph"),
                "condition": (current.get("condition") or {}).get("text"),
                "condition_icon": (current.get("condition") or {}).get("icon"),
                "last_updated": current.get("last_updated"),
            },
            "today": {
                "high_f": today_day.get("maxtemp_f"),
                "low_f": today_day.get("mintemp_f"),
                "rain_chance_pct": today_day.get("daily_chance_of_rain"),
                "total_precip_in": today_day.get("totalprecip_in"),
                "avg_humidity": today_day.get("avghumidity"),
            },
            "forecast_days": [
                {
                    "date": d.get("date"),
                    "high_f": (d.get("day") or {}).get("maxtemp_f"),
                    "low_f": (d.get("day") or {}).get("mintemp_f"),
                    "rain_chance_pct": (d.get("day") or {}).get("daily_chance_of_rain"),
                    "avg_humidity": (d.get("day") or {}).get("avghumidity"),
                    "condition": ((d.get("day") or {}).get("condition") or {}).get("text"),
                }
                for d in forecast_days
            ],
        }
    except Exception as e:  # defensive — never let a parsing bug kill the dashboard
        log.exception("Failed to extract weather summary: %s", e)
        return {"current": None, "today": None, "forecast_days": []}
