"""Token + cost accounting for OpenRouter calls.

A contextvar carries the current (project, stage) so llm.chat() can attribute
each call without threading params through every stage function. Totals are
accumulated per project and surfaced live via events + persisted on the project.
"""
import contextvars

# {"pid": str, "stage": str} for the currently-running stage
current = contextvars.ContextVar("usage_ctx", default=None)

# pid -> {"prompt_tokens", "completion_tokens", "total_tokens", "cost", "calls",
#         "by_stage": {stage: {...}}}
_totals: dict[str, dict] = {}


def _blank() -> dict:
    return {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0,
            "cost": 0.0, "calls": 0, "by_stage": {}}


def set_context(pid: str | None, stage: str | None) -> None:
    current.set({"pid": pid, "stage": stage} if pid else None)


def record(prompt_tokens: int, completion_tokens: int, cost: float) -> dict | None:
    """Add one call's usage to the current project's totals. Returns the updated
    per-project total (or None if no project context is active)."""
    ctx = current.get()
    if not ctx or not ctx.get("pid"):
        return None
    pid, stage = ctx["pid"], ctx.get("stage") or "misc"
    t = _totals.setdefault(pid, _blank())
    t["prompt_tokens"] += prompt_tokens
    t["completion_tokens"] += completion_tokens
    t["total_tokens"] += prompt_tokens + completion_tokens
    t["cost"] += cost
    t["calls"] += 1
    s = t["by_stage"].setdefault(stage, {"prompt_tokens": 0, "completion_tokens": 0,
                                         "cost": 0.0, "calls": 0})
    s["prompt_tokens"] += prompt_tokens
    s["completion_tokens"] += completion_tokens
    s["cost"] += cost
    s["calls"] += 1
    return t


def get_total(pid: str) -> dict:
    return _totals.get(pid, _blank())


def seed(pid: str, total: dict | None) -> None:
    """Restore a previously-persisted total (used when resuming a run)."""
    if total and isinstance(total, dict) and total.get("calls"):
        _totals[pid] = {**_blank(), **total}


def reset(pid: str) -> None:
    _totals.pop(pid, None)
