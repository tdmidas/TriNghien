"""Experiment execution: per-project virtualenv + subprocess runner with
live log streaming, wall-clock timeout, and stderr-tail capture for repair.

Execution contract (adopted from AI-Scientist): every experiment is run as
    python experiment_<rq>.py --out_dir=<run_dir>
and MUST write <run_dir>/final_info.json with its metrics. This decouples
generated code from the runner and makes result tables deterministic.
"""
import asyncio
import os
import sys
from pathlib import Path

from ..config import RUN_TIMEOUT_SECONDS
from ..events import publish
from .. import runtime as _runtime
from .. import sandbox as _sandbox

MAX_STDERR_TAIL = 3000       # chars of stderr fed back to the LLM for repair
LOG_EVERY_LINES = 1          # publish every line; UI batches rendering


async def ensure_venv(workspace: Path, project_id: str) -> Path:
    """Create the project venv (once) and install requirements.txt into it."""
    venv_dir = workspace / ".venv"
    py = venv_dir / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
    if not py.exists():
        await publish(project_id, "log", {"stream": "system", "line": "Creating virtual environment..."})
        proc = await asyncio.create_subprocess_exec(
            sys.executable, "-m", "venv", str(venv_dir),
            stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.PIPE,
        )
        _, err = await proc.communicate()
        if proc.returncode != 0:
            raise RuntimeError(f"venv creation failed: {err.decode(errors='replace')[:500]}")
    # Python 3.12+ venvs ship without setuptools, so `pkg_resources` is missing and
    # any source-build package fails. setuptools>=81 dropped pkg_resources entirely,
    # so pin <81. Run once per venv (marker) so existing broken venvs self-heal too.
    marker = venv_dir / ".bootstrapped"
    if not marker.exists():
        await publish(project_id, "log", {"stream": "system", "line": "Bootstrapping pip/setuptools/wheel..."})
        await _pip_install(project_id, py, workspace, ["--upgrade", "pip", "setuptools<81", "wheel"])
        try:
            marker.write_text("ok", encoding="utf-8")
        except OSError:
            pass
    req = workspace / "requirements.txt"
    if req.exists():
        await publish(project_id, "log", {"stream": "system", "line": "Installing requirements (pip)..."})
        # Strip version pins: pinned old versions often lack Python 3.12 wheels and
        # fail to build. Bare names let pip pick a wheel-available version.
        pkgs = _parse_requirements(req)
        ok = await _pip_install(project_id, py, workspace, pkgs) if pkgs else True
        if not ok:
            # One bad/unbuildable package must not kill the run: install the rest
            # individually and let per-script import errors drive the repair loop.
            await publish(project_id, "log", {"stream": "system",
                          "line": "Bulk install failed; retrying packages individually..."})
            for pkg in pkgs:
                good = await _pip_install(project_id, py, workspace, [pkg])
                if not good:
                    await publish(project_id, "log", {"stream": "stderr",
                                  "line": f"skipped un-installable package: {pkg}"})
    return py


def _parse_requirements(req) -> list[str]:
    """Read requirements.txt, drop comments/fences, and strip version specifiers."""
    import re
    out = []
    for ln in req.read_text(encoding="utf-8", errors="replace").splitlines():
        s = ln.strip()
        if not s or s.startswith(("#", "`", "-")):
            continue
        # keep the bare package name (drop ==, >=, <=, ~=, !=, extras markers)
        name = re.split(r"[<>=!~;\[ ]", s, 1)[0].strip()
        if name:
            out.append(name)
    return out


async def _pip_install(project_id, py, workspace, args: list[str]) -> bool:
    proc = await asyncio.create_subprocess_exec(
        str(py), "-m", "pip", "install", "-q", "--disable-pip-version-check", *args,
        cwd=str(workspace),
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT,
    )
    assert proc.stdout is not None
    async for raw in proc.stdout:
        line = raw.decode(errors="replace").rstrip()
        if line:
            await publish(project_id, "log", {"stream": "pip", "line": line})
    await proc.wait()
    return proc.returncode == 0


async def run_script(
    project_id: str,
    workspace: Path,
    script: str,
    args: list[str],
    *,
    label: str,
    timeout: int = RUN_TIMEOUT_SECONDS,
) -> dict:
    """Run one experiment script, streaming stdout/stderr as log events.

    Returns {ok, returncode, stderr_tail, timeout}.
    """
    py = await ensure_venv(workspace, project_id)
    cmd = [str(py), "-u", script, *args]
    await publish(project_id, "log", {"stream": "system", "line": f"$ python {script} {' '.join(args)}"})
    proc = await asyncio.create_subprocess_exec(
        *cmd,
        cwd=str(workspace),
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        # workspace on PYTHONPATH so `from src.common import ...` resolves when a
        # script is launched by path from experiments/.
        env={**os.environ, "PYTHONIOENCODING": "utf-8", "MPLBACKEND": "Agg",
             "PYTHONPATH": str(workspace), **_runtime.cuda_env()},
        preexec_fn=_sandbox.preexec(),   # POSIX rlimits (no-op on Windows)
    )
    from .. import gates
    gates.register_proc(project_id, proc)
    stderr_tail: list[str] = []

    async def pump(stream, name: str):
        assert stream is not None
        async for raw in stream:
            line = raw.decode(errors="replace").rstrip()
            if name == "stderr":
                stderr_tail.append(line)
                if len(stderr_tail) > 120:
                    del stderr_tail[:40]
            if line:
                await publish(project_id, "log", {"stream": name, "label": label, "line": line})

    timed_out = False
    try:
        await asyncio.wait_for(
            asyncio.gather(pump(proc.stdout, "stdout"), pump(proc.stderr, "stderr"), proc.wait()),
            timeout=timeout,
        )
    except asyncio.TimeoutError:
        timed_out = True
        proc.kill()
        await proc.wait()
        await publish(project_id, "log", {"stream": "system", "line": f"⏱ killed after {timeout}s timeout"})
    except asyncio.CancelledError:
        # Stop button: kill the experiment and propagate cancellation.
        proc.kill()
        await proc.wait()
        gates.unregister_proc(project_id, proc)
        raise
    finally:
        gates.unregister_proc(project_id, proc)

    tail = "\n".join(stderr_tail)[-MAX_STDERR_TAIL:]
    return {
        "ok": (not timed_out) and proc.returncode == 0,
        "returncode": proc.returncode,
        "stderr_tail": tail,
        "timeout": timed_out,
    }
