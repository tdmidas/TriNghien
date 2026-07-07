"""Human-in-the-loop control for the pipeline: pause gates, the running task
registry, and the live subprocess registry (so Stop can kill experiments).

A "gate" is a point where the orchestrator blocks waiting for a user decision
(approve research questions, confirm experiments, advance a manual step). The
orchestrator awaits an asyncio.Event; a REST call resolves it with a decision.
"""
import asyncio

_events: dict[str, asyncio.Event] = {}
_decisions: dict[str, dict] = {}
_tasks: dict[str, asyncio.Task] = {}
_procs: dict[str, set] = {}


# ---- gates ----
async def wait_gate(pid: str) -> dict:
    """Block until the user resolves the current gate; returns the decision."""
    ev = asyncio.Event()
    _events[pid] = ev
    try:
        await ev.wait()
    finally:
        _events.pop(pid, None)
    return _decisions.pop(pid, {})


def resolve_gate(pid: str, decision: dict) -> bool:
    """Resolve a pending gate. Returns True if a gate was actually waiting."""
    _decisions[pid] = decision
    ev = _events.get(pid)
    if ev:
        ev.set()
        return True
    return False


def has_gate(pid: str) -> bool:
    return pid in _events


# ---- task registry (for Stop / cancel) ----
def register_task(pid: str, task: asyncio.Task) -> None:
    _tasks[pid] = task


def get_task(pid: str):
    return _tasks.get(pid)


def clear_task(pid: str) -> None:
    _tasks.pop(pid, None)


# ---- subprocess registry (so Stop kills the running experiment) ----
def register_proc(pid: str, proc) -> None:
    _procs.setdefault(pid, set()).add(proc)


def unregister_proc(pid: str, proc) -> None:
    _procs.get(pid, set()).discard(proc)


def kill_procs(pid: str) -> int:
    n = 0
    for p in list(_procs.get(pid, set())):
        try:
            p.kill()
            n += 1
        except ProcessLookupError:
            pass
    _procs.pop(pid, None)
    return n
