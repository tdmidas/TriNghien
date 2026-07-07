"""Application configuration loaded from environment / .env."""
import os
from pathlib import Path

from dotenv import load_dotenv

BACKEND_DIR = Path(__file__).resolve().parent.parent
PROJECT_ROOT = BACKEND_DIR.parent

load_dotenv(BACKEND_DIR / ".env")

OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY", "")
OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"
APP_URL = os.getenv("APP_URL", "http://localhost:8000")
APP_NAME = os.getenv("APP_NAME", "AI Researcher")

_ws = os.getenv("WORKSPACE_DIR", "../workspace")
WORKSPACE_DIR = (BACKEND_DIR / _ws).resolve() if not Path(_ws).is_absolute() else Path(_ws)
WORKSPACE_DIR.mkdir(parents=True, exist_ok=True)

DB_PATH = BACKEND_DIR / "data" / "app.db"
DB_PATH.parent.mkdir(parents=True, exist_ok=True)

UPLOAD_DIR = BACKEND_DIR / "data" / "uploads"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

RUN_TIMEOUT_SECONDS = int(os.getenv("RUN_TIMEOUT_SECONDS", "1800"))
# Smoke runs must finish fast; a hang here should fail early, not after 30 min.
SMOKE_TIMEOUT_SECONDS = int(os.getenv("SMOKE_TIMEOUT_SECONDS", "240"))
# Hard cap on a single repair LLM call so a stuck connection can't freeze a run.
REPAIR_LLM_TIMEOUT_SECONDS = int(os.getenv("REPAIR_LLM_TIMEOUT_SECONDS", "180"))
# Hard wall-clock budget for one RQ's whole execute+repair cycle.
RQ_BUDGET_SECONDS = int(os.getenv("RQ_BUDGET_SECONDS", "2400"))
MAX_REPAIR_ATTEMPTS = int(os.getenv("MAX_REPAIR_ATTEMPTS", "4"))

# --- experiment sandboxing (POSIX rlimits applied per experiment subprocess) ---
SANDBOX_ENABLED = os.getenv("SANDBOX_ENABLED", "1") not in ("0", "false", "False")
SANDBOX_MEM_MB = int(os.getenv("SANDBOX_MEM_MB", "6144"))       # per-experiment RAM cap
SANDBOX_CPU_SECONDS = int(os.getenv("SANDBOX_CPU_SECONDS", "1800"))
SANDBOX_MAX_PROCS = int(os.getenv("SANDBOX_MAX_PROCS", "256"))

# Default model used when the client does not specify one.
DEFAULT_MODEL = os.getenv("DEFAULT_MODEL", "qwen/qwen3-coder:free")
