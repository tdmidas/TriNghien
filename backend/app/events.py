"""Per-project event bus: every pipeline step publishes events that are
persisted to SQLite (for replay) and fanned out to live SSE subscribers."""
import asyncio
import json
import time
from collections import defaultdict
from typing import Any

from . import db

_subscribers: dict[str, list[asyncio.Queue]] = defaultdict(list)


async def publish(project_id: str, kind: str, data: dict[str, Any]) -> dict:
    """Persist an event and push it to all live subscribers.

    kind: stage_start | stage_update | stage_done | stage_error | log |
          token_usage | file_written | run_progress | pipeline_done | pipeline_error
    """
    event = {
        "ts": time.time(),
        "kind": kind,
        "data": data,
    }
    event["id"] = await db.insert_event(project_id, event["ts"], kind, json.dumps(data, ensure_ascii=False))
    for q in list(_subscribers.get(project_id, [])):
        try:
            q.put_nowait(event)
        except asyncio.QueueFull:
            pass
    return event


def subscribe(project_id: str) -> asyncio.Queue:
    q: asyncio.Queue = asyncio.Queue(maxsize=2000)
    _subscribers[project_id].append(q)
    return q


def unsubscribe(project_id: str, q: asyncio.Queue) -> None:
    try:
        _subscribers[project_id].remove(q)
    except ValueError:
        pass
