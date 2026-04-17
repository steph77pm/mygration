"""Comfort index calculation.

The comfort index is a 1-10 score that combines the factors Stephanie cares
about, weighted by how much they actually affect her day-to-day decisions:

    humidity           (heaviest weight)
    temperature        (comfortable range: 55-78F)
    rain frequency     (penalty modulated by humidity — dry rain is fine,
                        muggy rain is miserable)
    wind speed

Standalone callouts (NOT averaged into the score — surfaced separately by
the API layer):

    extended_cold:  nighttime lows below COLD_THRESHOLD_F for EXTENDED_DAYS+ in a row
    extended_heat:  daytime highs above HEAT_THRESHOLD_F for EXTENDED_DAYS+ in a row
    bug_risk:       low/moderate/high/severe — from algorithm + personal logs
    severe_weather: hurricane/tornado/flood season flags

Thresholds live in config.py and are user-configurable.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable

from config import Config


# Weights sum to 1.0
WEIGHTS = {
    "humidity": 0.40,
    "temperature": 0.30,
    "rain": 0.15,
    "wind": 0.15,
}

# Temperature comfort range (Fahrenheit)
TEMP_COMFORT_MIN = 55.0
TEMP_COMFORT_MAX = 78.0

# Wind penalty starts above this speed (mph)
WIND_COMFORT_MAX = 15.0
WIND_PUNISHING = 30.0


@dataclass
class ComfortBreakdown:
    """Per-factor subscores and final composite, for transparent display."""

    humidity: float  # 0-10
    temperature: float  # 0-10
    rain: float  # 0-10
    wind: float  # 0-10
    composite: float  # 0-10

    def to_dict(self) -> dict:
        return {
            "humidity": round(self.humidity, 1),
            "temperature": round(self.temperature, 1),
            "rain": round(self.rain, 1),
            "wind": round(self.wind, 1),
            "composite": round(self.composite, 1),
        }


def _humidity_score(humidity_pct: float) -> float:
    """Lower humidity = higher comfort. Sweet spot 30-50%."""
    if humidity_pct <= 50:
        return 10.0
    if humidity_pct >= 95:
        return 0.0
    # Linear decay from 50% → 10 to 95% → 0
    return 10.0 - ((humidity_pct - 50) / 45) * 10.0


def _temperature_score(temp_f: float) -> float:
    """Peak score inside the comfort range, linear falloff outside."""
    if TEMP_COMFORT_MIN <= temp_f <= TEMP_COMFORT_MAX:
        return 10.0
    if temp_f < TEMP_COMFORT_MIN:
        # Below 20F = 0, linear between
        delta = TEMP_COMFORT_MIN - temp_f
        return max(0.0, 10.0 - (delta / (TEMP_COMFORT_MIN - 20)) * 10.0)
    # Above comfort — above 100F = 0
    delta = temp_f - TEMP_COMFORT_MAX
    return max(0.0, 10.0 - (delta / (100 - TEMP_COMFORT_MAX)) * 10.0)


def _rain_score(rain_chance_pct: float, humidity_pct: float) -> float:
    """Rain's comfort penalty scales with humidity.

    Stephanie's insight (Phase 1 field test): "Heavy rain doesn't inherently
    make me uncomfortable. Rain + humidity does though." Rain in dry air dries
    off, the van ventilates, and it's fine. Rain in muggy air is where things
    stay wet, smell musty, and comfort tanks.

    So we keep a linear base penalty from rain chance, but multiply it by a
    humidity modulator:

        humidity <= 30%RH   → modulator 0.0  (rain barely penalizes)
        humidity >= 75%RH   → modulator 1.0  (full penalty — muggy + wet)
        30-75%RH            → linear ramp

    Example: 80% rain chance at 35%RH scores ~9.1 (rain almost free),
             80% rain chance at 80%RH scores 2.0 (full hit).
    """
    if humidity_pct <= 30:
        modulator = 0.0
    elif humidity_pct >= 75:
        modulator = 1.0
    else:
        modulator = (humidity_pct - 30) / (75 - 30)

    base_penalty = rain_chance_pct / 10.0  # 0-10 penalty before modulation
    effective_penalty = base_penalty * modulator
    return max(0.0, 10.0 - effective_penalty)


def _wind_score(wind_mph: float) -> float:
    """Moderate breeze is fine; strong wind tanks comfort."""
    if wind_mph <= WIND_COMFORT_MAX:
        return 10.0
    if wind_mph >= WIND_PUNISHING:
        return 0.0
    return 10.0 - ((wind_mph - WIND_COMFORT_MAX) / (WIND_PUNISHING - WIND_COMFORT_MAX)) * 10.0


def compute_comfort(
    *,
    temp_f: float,
    humidity_pct: float,
    rain_chance_pct: float,
    wind_mph: float,
) -> ComfortBreakdown:
    """Compute the comfort index and per-factor breakdown for a single data point."""
    subs = {
        "humidity": _humidity_score(humidity_pct),
        "temperature": _temperature_score(temp_f),
        "rain": _rain_score(rain_chance_pct, humidity_pct),
        "wind": _wind_score(wind_mph),
    }
    composite = sum(subs[k] * WEIGHTS[k] for k in WEIGHTS)
    return ComfortBreakdown(
        humidity=subs["humidity"],
        temperature=subs["temperature"],
        rain=subs["rain"],
        wind=subs["wind"],
        composite=composite,
    )


# --- Standalone callouts -----------------------------------------------------


def detect_extended_cold(nightly_lows_f: Iterable[float]) -> bool:
    """True if `EXTENDED_DAYS_THRESHOLD`+ consecutive nights below threshold."""
    run = 0
    for low in nightly_lows_f:
        if low < Config.COLD_THRESHOLD_F:
            run += 1
            if run >= Config.EXTENDED_DAYS_THRESHOLD:
                return True
        else:
            run = 0
    return False


def detect_extended_heat(daily_highs_f: Iterable[float]) -> bool:
    """True if `EXTENDED_DAYS_THRESHOLD`+ consecutive days above threshold."""
    run = 0
    for high in daily_highs_f:
        if high > Config.HEAT_THRESHOLD_F:
            run += 1
            if run >= Config.EXTENDED_DAYS_THRESHOLD:
                return True
        else:
            run = 0
    return False


def estimate_bug_risk(
    *,
    temp_f: float,
    humidity_pct: float,
    recent_rain_inches: float,
) -> str:
    """Algorithmic bug risk estimate. Personal logs override this in the API layer.

    Mosquitoes and noseeums thrive with warm temps, high humidity, standing water.
    Returns one of: 'low', 'moderate', 'high', 'severe'.
    """
    score = 0
    if temp_f >= 70:
        score += 1
    if temp_f >= 80:
        score += 1
    if humidity_pct >= 65:
        score += 1
    if humidity_pct >= 80:
        score += 1
    if recent_rain_inches >= 0.25:
        score += 1
    if recent_rain_inches >= 1.0:
        score += 1
    if score >= 5:
        return "severe"
    if score >= 3:
        return "high"
    if score >= 1:
        return "moderate"
    return "low"
