"""Configuration for Mygration backend.

Reads environment variables (via python-dotenv in development, Railway-injected
in production) and exposes them as module constants. Do not commit real secrets
— see .env.example for the template and README.md for Railway setup.
"""

import os
from pathlib import Path

from dotenv import load_dotenv

# Load .env file if present (development only — Railway injects env vars natively)
BASE_DIR = Path(__file__).resolve().parent
load_dotenv(BASE_DIR / ".env")


class Config:
    # --- Flask ---
    SECRET_KEY = os.environ.get("SECRET_KEY", "dev-secret-change-in-production")
    DEBUG = os.environ.get("FLASK_DEBUG", "false").lower() == "true"

    # --- Database ---
    # Railway injects DATABASE_URL for the Postgres plugin. Local dev falls back
    # to SQLite so the scaffold runs without a Postgres install.
    _db_url = os.environ.get("DATABASE_URL", f"sqlite:///{BASE_DIR / 'data' / 'mygration.db'}")
    # Railway sometimes gives postgres:// (legacy) — SQLAlchemy 2.x wants postgresql://
    if _db_url.startswith("postgres://"):
        _db_url = _db_url.replace("postgres://", "postgresql://", 1)
    SQLALCHEMY_DATABASE_URI = _db_url
    SQLALCHEMY_TRACK_MODIFICATIONS = False

    # --- WeatherAPI.com ---
    WEATHER_API_KEY = os.environ.get("WEATHER_API_KEY", "")
    WEATHER_API_BASE = "https://api.weatherapi.com/v1"

    # --- Email alerts (Phase 4) ---
    SMTP_HOST = os.environ.get("SMTP_HOST", "")
    SMTP_PORT = int(os.environ.get("SMTP_PORT", "587"))
    SMTP_USER = os.environ.get("SMTP_USER", "")
    SMTP_PASSWORD = os.environ.get("SMTP_PASSWORD", "")
    ALERT_FROM_EMAIL = os.environ.get("ALERT_FROM_EMAIL", "stephanie.warner77@gmail.com")
    ALERT_TO_EMAIL = os.environ.get("ALERT_TO_EMAIL", "stephanie.warner77@gmail.com")

    # --- App defaults (user-configurable later) ---
    COLD_THRESHOLD_F = float(os.environ.get("COLD_THRESHOLD_F", "40"))
    HEAT_THRESHOLD_F = float(os.environ.get("HEAT_THRESHOLD_F", "80"))
    EXTENDED_DAYS_THRESHOLD = int(os.environ.get("EXTENDED_DAYS_THRESHOLD", "3"))

    # --- CORS ---
    # Frontend origins allowed to hit the API. Update for production domain.
    CORS_ORIGINS = os.environ.get(
        "CORS_ORIGINS",
        "http://localhost:5173,http://127.0.0.1:5173",
    ).split(",")
