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


# --- Historical research digest (Future Planning bucket) -----------------

# 4 sample dates per month — roughly one per week, avoiding month edges.
_HISTORY_SAMPLE_DAYS = (4, 11, 18, 25)


def _most_recent_past_year_for_month(target_month: int, today: Optional[datetime] = None) -> int:
    """Return the most recent calendar year whose `target_month` is fully in the past.

    Example: today is April 2026 →
      - July   → 2025 (this year's July hasn't happened yet)
      - March  → 2026 (this year's March is fully in the past)
      - April  → 2025 (this year's April is in progress)
    """
    if today is None:
        today = datetime.now(timezone.utc)
    if target_month < today.month:
        return today.year
    return today.year - 1


def fetch_historical_month_digest(child: ChildLocation, target_month: int) -> dict:
    """Pull 4 sample days from a past month and aggregate into a planning digest.

    Picks days 4/11/18/25 of `target_month` in the most recent past year, fetches
    each via history.json (cached forever — history is immutable), and rolls up
    an "expect roughly this" summary: avg high/low/humidity/rain/wind + a
    typical-condition string.

    Returns a dict shaped for direct JSON encoding:
        {
          "target_month": 7,
          "sampled_year": 2025,
          "samples": [ { "date", "high_f", "low_f", "humidity", ... }, ... ],
          "aggregate": { "avg_high_f", ..., "typical_condition" },
          "errors": [ "2025-07-25: ..." ]   # per-sample failures, non-fatal
        }
    """
    if not (1 <= target_month <= 12):
        raise ValueError(f"target_month must be 1..12, got {target_month!r}")

    year = _most_recent_past_year_for_month(target_month)
    samples = []
    errors: list[str] = []
    for day in _HISTORY_SAMPLE_DAYS:
        date_str = f"{year:04d}-{target_month:02d}-{day:02d}"
        try:
            raw = fetch_history(child, date_str)
        except WeatherAPIError as e:
            # Free plan doesn't have history — surface gracefully rather than 500.
            errors.append(f"{date_str}: {e}")
            continue
        try:
            forecast_days = raw.get("forecast", {}).get("forecastday", []) or []
            if not forecast_days:
                errors.append(f"{date_str}: empty forecastday array")
                continue
            day_data = (forecast_days[0] or {}).get("day", {}) or {}
            samples.append({
                "date": date_str,
                "high_f": day_data.get("maxtemp_f"),
                "low_f": day_data.get("mintemp_f"),
                "avg_humidity": day_data.get("avghumidity"),
                "total_precip_in": day_data.get("totalprecip_in"),
                "max_wind_mph": day_data.get("maxwind_mph"),
                "condition": (day_data.get("condition") or {}).get("text"),
                "condition_code": (day_data.get("condition") or {}).get("code"),
                "daily_chance_of_rain": day_data.get("daily_chance_of_rain"),
            })
        except Exception as e:  # noqa: BLE001 — defensive
            errors.append(f"{date_str}: parse error: {e}")

    aggregate = _aggregate_samples(samples)
    return {
        "target_month": target_month,
        "sampled_year": year,
        "samples": samples,
        "aggregate": aggregate,
        "errors": errors,
    }


def _aggregate_samples(samples: list[dict]) -> dict:
    """Mean the numeric fields and take the modal condition string."""
    if not samples:
        return {
            "avg_high_f": None, "avg_low_f": None, "avg_humidity": None,
            "avg_precip_in": None, "avg_max_wind_mph": None,
            "avg_rain_chance_pct": None, "typical_condition": None,
            "sample_count": 0,
        }

    def _mean(key: str) -> Optional[float]:
        vals = [s[key] for s in samples if s.get(key) is not None]
        if not vals:
            return None
        return round(sum(vals) / len(vals), 1)

    # Typical condition = the condition text that appears most often across samples;
    # ties broken by first-seen.
    counts: dict[str, int] = {}
    for s in samples:
        c = s.get("condition")
        if c:
            counts[c] = counts.get(c, 0) + 1
    typical = max(counts, key=counts.get) if counts else None

    return {
        "avg_high_f": _mean("high_f"),
        "avg_low_f": _mean("low_f"),
        "avg_humidity": _mean("avg_humidity"),
        "avg_precip_in": _mean("total_precip_in"),
        "avg_max_wind_mph": _mean("max_wind_mph"),
        "avg_rain_chance_pct": _mean("daily_chance_of_rain"),
        "typical_condition": typical,
        "sample_count": len(samples),
    }


def extract_detail(forecast_payload: dict) -> dict:
    """Pull the detailed fields the drill-in view needs from a forecast payload.

    Goes beyond extract_summary: returns hourly breakdown for the next 48h
    (today + tomorrow), astro info (sunrise/sunset/moon), and current wind
    direction. Frontend slices to whatever window it wants to display.
    """
    try:
        current = forecast_payload.get("current", {}) or {}
        location = forecast_payload.get("location", {}) or {}
        forecast_days = forecast_payload.get("forecast", {}).get("forecastday", []) or []
        today = forecast_days[0] if forecast_days else {}
        today_day = today.get("day", {}) or {}
        today_astro = today.get("astro", {}) or {}

        hourly = []
        for day_data in forecast_days[:2]:  # today + tomorrow = 48 hours
            for hour in day_data.get("hour", []) or []:
                condition = hour.get("condition") or {}
                hourly.append({
                    "time": hour.get("time"),                # "2026-04-17 14:00" local
                    "time_epoch": hour.get("time_epoch"),
                    "temp_f": hour.get("temp_f"),
                    "feels_like_f": hour.get("feelslike_f"),
                    "humidity": hour.get("humidity"),
                    "wind_mph": hour.get("wind_mph"),
                    "wind_dir": hour.get("wind_dir"),        # compass, e.g. "NNE"
                    "chance_of_rain": hour.get("chance_of_rain"),
                    "precip_in": hour.get("precip_in"),
                    "condition": condition.get("text"),
                    "condition_code": condition.get("code"),
                    "is_day": hour.get("is_day"),
                })

        return {
            "current": {
                "temp_f": current.get("temp_f"),
                "feels_like_f": current.get("feelslike_f"),
                "humidity": current.get("humidity"),
                "wind_mph": current.get("wind_mph"),
                "wind_dir": current.get("wind_dir"),
                "wind_degree": current.get("wind_degree"),
                "condition": (current.get("condition") or {}).get("text"),
                "condition_code": (current.get("condition") or {}).get("code"),
                "is_day": current.get("is_day"),
                "last_updated": current.get("last_updated"),
                "last_updated_epoch": current.get("last_updated_epoch"),
            },
            "today": {
                "high_f": today_day.get("maxtemp_f"),
                "low_f": today_day.get("mintemp_f"),
                "rain_chance_pct": today_day.get("daily_chance_of_rain"),
                "total_precip_in": today_day.get("totalprecip_in"),
                "avg_humidity": today_day.get("avghumidity"),
                "condition": (today_day.get("condition") or {}).get("text"),
                "max_wind_mph": today_day.get("maxwind_mph"),
            },
            "astro": {
                "sunrise": today_astro.get("sunrise"),       # "06:23 AM"
                "sunset": today_astro.get("sunset"),         # "07:48 PM"
                "moonrise": today_astro.get("moonrise"),
                "moonset": today_astro.get("moonset"),
                "moon_phase": today_astro.get("moon_phase"),
            },
            "location_tz": location.get("tz_id"),
            "location_localtime": location.get("localtime"),
            "location_localtime_epoch": location.get("localtime_epoch"),
            "hourly": hourly,
        }
    except Exception as e:  # defensive — never let a parsing bug kill the detail view
        log.exception("Failed to extract weather detail: %s", e)
        return {
            "current": None, "today": None, "astro": None,
            "location_tz": None, "location_localtime": None, "hourly": [],
        }


def extract_summary(forecast_payload: dict) -> dict:
    """Pull the handful of fields the dashboard card needs from a forecast payload.

    Keeps the API response small and stable even if WeatherAPI's format shifts.
    Includes derived alert flags (extended heat / extended cold) computed from
    the forecast window, plus native WeatherAPI alerts if any.
    """
    try:
        current = forecast_payload.get("current", {})
        forecast_days = forecast_payload.get("forecast", {}).get("forecastday", [])
        today = forecast_days[0] if forecast_days else {}
        today_day = today.get("day", {})

        # Map each forecast day once for reuse.
        forecast_summary = [
            {
                "date": d.get("date"),
                "high_f": (d.get("day") or {}).get("maxtemp_f"),
                "low_f": (d.get("day") or {}).get("mintemp_f"),
                "rain_chance_pct": (d.get("day") or {}).get("daily_chance_of_rain"),
                "avg_humidity": (d.get("day") or {}).get("avghumidity"),
                "condition": ((d.get("day") or {}).get("condition") or {}).get("text"),
            }
            for d in forecast_days
        ]

        # Derived "extended heat" / "extended cold" flags. Match prototype shape:
        # if 3+ upcoming days have highs ≥85°F → heat alert; if 3+ have lows ≤35°F → cold alert.
        heat_days = sum(1 for d in forecast_summary if (d["high_f"] or 0) >= 85)
        cold_days = sum(1 for d in forecast_summary if (d["low_f"] is not None and d["low_f"] <= 35))

        # Native WeatherAPI alerts (heat advisory, storm warnings, etc.)
        native_alerts_raw = (forecast_payload.get("alerts") or {}).get("alert") or []
        native_alerts = [
            {
                "headline": a.get("headline") or a.get("event"),
                "severity": a.get("severity"),
                "event": a.get("event"),
            }
            for a in native_alerts_raw
        ]

        alerts = {
            "extended_heat": heat_days >= 3,
            "extended_heat_days": heat_days,
            "extended_cold": cold_days >= 3,
            "extended_cold_days": cold_days,
            "native": native_alerts,
        }

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
            "forecast_days": forecast_summary,
            "alerts": alerts,
        }
    except Exception as e:  # defensive — never let a parsing bug kill the dashboard
        log.exception("Failed to extract weather summary: %s", e)
        return {"current": None, "today": None, "forecast_days": [], "alerts": None}
