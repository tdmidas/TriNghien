"""SQLite persistence (aiosqlite). Projects, pipeline events, and datasets.

Schema is intentionally simple: rich per-stage artifacts (research questions,
plans, results) live as JSON columns on the project row; the append-only
`events` table drives the tracking timeline and survives page reloads.
"""
import json
import uuid
from typing import Any

import aiosqlite

from .config import DB_PATH

_SCHEMA = """
CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL DEFAULT '',
    idea_prompt TEXT NOT NULL,
    topic TEXT NOT NULL,
    model TEXT NOT NULL,
    mode TEXT NOT NULL DEFAULT 'auto',           -- auto|manual|plan
    status TEXT NOT NULL DEFAULT 'created',      -- created|running|waiting|stopped|failed|done
    current_stage TEXT NOT NULL DEFAULT '',
    pending_action JSON,                          -- the gate currently awaiting the user
    dataset JSON,                                 -- {source, id/path, preview, ...}
    literature JSON,                              -- related-work notes
    research_questions JSON,                      -- [{id,title,hypothesis,experiments:[...]}]
    plan JSON,                                    -- experiment plan
    results JSON,                                 -- collected metrics per RQ/experiment
    report_md TEXT,                               -- final report (markdown)
    report_latex TEXT,                            -- results tables (latex)
    bibtex TEXT,                                  -- references.bib content
    usage JSON,                                   -- token/cost totals
    workspace_dir TEXT,
    run_started_at REAL,                          -- when the current/last run began
    run_ended_at REAL,                            -- when it finished (done/failed/stopped)
    created_at REAL NOT NULL,
    updated_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id TEXT NOT NULL,
    ts REAL NOT NULL,
    kind TEXT NOT NULL,
    data JSON NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_project ON events(project_id, id);
"""

_db: aiosqlite.Connection | None = None


async def init() -> None:
    global _db
    _db = await aiosqlite.connect(DB_PATH)
    _db.row_factory = aiosqlite.Row
    await _db.executescript(_SCHEMA)
    # Migrate older DBs that predate the mode/pending_action columns.
    cur = await _db.execute("PRAGMA table_info(projects)")
    cols = {r["name"] for r in await cur.fetchall()}
    if "mode" not in cols:
        await _db.execute("ALTER TABLE projects ADD COLUMN mode TEXT NOT NULL DEFAULT 'auto'")
    if "pending_action" not in cols:
        await _db.execute("ALTER TABLE projects ADD COLUMN pending_action JSON")
    if "usage" not in cols:
        await _db.execute("ALTER TABLE projects ADD COLUMN usage JSON")
    if "bibtex" not in cols:
        await _db.execute("ALTER TABLE projects ADD COLUMN bibtex TEXT")
    if "run_started_at" not in cols:
        await _db.execute("ALTER TABLE projects ADD COLUMN run_started_at REAL")
    if "run_ended_at" not in cols:
        await _db.execute("ALTER TABLE projects ADD COLUMN run_ended_at REAL")
    await _db.commit()


async def close() -> None:
    if _db:
        await _db.close()


def _conn() -> aiosqlite.Connection:
    assert _db is not None, "db.init() not called"
    return _db


JSON_FIELDS = {"dataset", "literature", "research_questions", "plan", "results", "pending_action", "usage"}


def _sanitize(obj):
    """Replace non-JSON-compliant floats (NaN/Inf) with None recursively.
    Experiment metrics can be NaN (e.g. divide-by-zero precision) and would
    otherwise break FastAPI's strict JSON serialization."""
    import math
    if isinstance(obj, float):
        return obj if math.isfinite(obj) else None
    if isinstance(obj, dict):
        return {k: _sanitize(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_sanitize(v) for v in obj]
    return obj


def _row_to_project(row: aiosqlite.Row) -> dict[str, Any]:
    p = dict(row)
    for f in JSON_FIELDS:
        if p.get(f):
            try:
                p[f] = _sanitize(json.loads(p[f]))
            except (TypeError, json.JSONDecodeError):
                pass
    return p


async def create_project(idea_prompt: str, topic: str, model: str, title: str, now: float,
                         mode: str = "auto") -> dict:
    pid = uuid.uuid4().hex[:12]
    await _conn().execute(
        "INSERT INTO projects (id, title, idea_prompt, topic, model, mode, created_at, updated_at)"
        " VALUES (?,?,?,?,?,?,?,?)",
        (pid, title, idea_prompt, topic, model, mode, now, now),
    )
    await _conn().commit()
    return await get_project(pid)


async def get_project(pid: str) -> dict | None:
    cur = await _conn().execute("SELECT * FROM projects WHERE id=?", (pid,))
    row = await cur.fetchone()
    return _row_to_project(row) if row else None


async def list_projects() -> list[dict]:
    cur = await _conn().execute(
        "SELECT id, title, idea_prompt, topic, model, mode, status, current_stage,"
        " run_started_at, run_ended_at, created_at, updated_at"
        " FROM projects ORDER BY created_at DESC"
    )
    return [dict(r) for r in await cur.fetchall()]


async def update_project(pid: str, now: float, **fields: Any) -> None:
    sets, vals = [], []
    for k, v in fields.items():
        if k in JSON_FIELDS and v is not None and not isinstance(v, str):
            v = json.dumps(v, ensure_ascii=False)
        sets.append(f"{k}=?")
        vals.append(v)
    sets.append("updated_at=?")
    vals.extend([now, pid])
    await _conn().execute(f"UPDATE projects SET {', '.join(sets)} WHERE id=?", vals)
    await _conn().commit()


async def delete_project(pid: str) -> None:
    await _conn().execute("DELETE FROM projects WHERE id=?", (pid,))
    await _conn().execute("DELETE FROM events WHERE project_id=?", (pid,))
    await _conn().commit()


async def insert_event(project_id: str, ts: float, kind: str, data_json: str) -> int:
    cur = await _conn().execute(
        "INSERT INTO events (project_id, ts, kind, data) VALUES (?,?,?,?)",
        (project_id, ts, kind, data_json),
    )
    await _conn().commit()
    return cur.lastrowid


async def list_events(project_id: str, after_id: int = 0, limit: int = 5000) -> list[dict]:
    cur = await _conn().execute(
        "SELECT id, ts, kind, data FROM events WHERE project_id=? AND id>? ORDER BY id LIMIT ?",
        (project_id, after_id, limit),
    )
    out = []
    for r in await cur.fetchall():
        out.append({"id": r["id"], "ts": r["ts"], "kind": r["kind"],
                    "data": _sanitize(json.loads(r["data"]))})
    return out
