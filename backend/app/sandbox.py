"""Per-experiment sandboxing.

Each experiment already runs as a separate subprocess (so a crash can't take the
backend down). This adds POSIX resource limits via setrlimit applied in the
child before exec: memory cap, CPU-time cap, max processes (anti fork-bomb),
and max file size. On non-POSIX (Windows dev) it degrades to a no-op.

Stronger isolation (a dedicated container per run + network egress allowlist for
HuggingFace/pip only) is the documented next step; resource limits are the
highest-value protection and work inside the existing container.
"""
import os

from .config import (SANDBOX_CPU_SECONDS, SANDBOX_ENABLED, SANDBOX_MAX_PROCS,
                     SANDBOX_MEM_MB)

try:
    import resource  # POSIX only
except ImportError:
    resource = None


def available() -> bool:
    return SANDBOX_ENABLED and resource is not None and os.name != "nt"


def preexec():
    """Return a preexec_fn that applies rlimits in the child, or None if the
    platform doesn't support it."""
    if not available():
        return None

    def _limits():
        # Address space (virtual memory) cap.
        mem = SANDBOX_MEM_MB * 1024 * 1024
        try:
            resource.setrlimit(resource.RLIMIT_AS, (mem, mem))
        except (ValueError, OSError):
            pass
        # CPU seconds (wall-clock is handled separately by the runner timeout).
        try:
            resource.setrlimit(resource.RLIMIT_CPU, (SANDBOX_CPU_SECONDS, SANDBOX_CPU_SECONDS + 5))
        except (ValueError, OSError):
            pass
        # Max user processes (anti fork-bomb).
        try:
            resource.setrlimit(resource.RLIMIT_NPROC, (SANDBOX_MAX_PROCS, SANDBOX_MAX_PROCS))
        except (ValueError, OSError):
            pass
        # Max single-file size (2 GB) to stop runaway disk writes.
        try:
            two_gb = 2 * 1024 * 1024 * 1024
            resource.setrlimit(resource.RLIMIT_FSIZE, (two_gb, two_gb))
        except (ValueError, OSError):
            pass
        # New session so the whole experiment process tree can be killed together.
        try:
            os.setsid()
        except OSError:
            pass

    return _limits


def describe() -> dict:
    return {
        "enabled": available(),
        "mem_mb": SANDBOX_MEM_MB,
        "cpu_seconds": SANDBOX_CPU_SECONDS,
        "max_procs": SANDBOX_MAX_PROCS,
        "note": None if available() else "resource limits unavailable on this platform (Windows dev); active inside the Linux container",
    }
