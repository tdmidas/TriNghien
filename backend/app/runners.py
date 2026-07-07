"""Execution-backend abstraction — the `Runner` interface the recipe layer
selects between.

The core pipeline is domain-agnostic; the one place domains diverge violently is
HOW an experiment is executed and how isolated that execution must be. A recipe
(recipes.py) declares which runner *kind* its domain needs; this module maps that
declaration to a concrete backend that is actually available on the host — or
reports that the backend is not provisioned, so the pipeline can REFUSE to run
rather than quietly executing dynamic-malware / live-pentest code through the
un-isolated local runner.

Runner kinds:
  "local"    — per-project virtualenv + subprocess (offline dataset analysis).
               Always available; delegates to pipeline/runner.py.
  "isolated" — container/VM with a strict egress policy, for dynamic/interactive
               domains. NOT available on a plain dev host; provisioning it later
               is the whole extension point — register a real backend below and
               the pipeline core, recipes, and prompts stay unchanged.

To add a new isolation backend you implement one Runner subclass and register it
in _REGISTRY; nothing else in the pipeline changes.
"""
import os
from dataclasses import dataclass
from pathlib import Path


class Runner:
    """A place experiments run. Subclasses must keep run()'s signature identical
    to pipeline.runner.run_script so stages stay backend-agnostic."""

    kind = "base"

    def available(self) -> bool:
        """True if this backend can actually execute on the current host."""
        return False

    def why_unavailable(self) -> str:
        return f"the '{self.kind}' runner is not provisioned on this host"

    async def run(self, project_id, workspace: Path, script: str, args: list[str],
                  *, label: str, timeout: int) -> dict:
        raise NotImplementedError


class LocalRunner(Runner):
    """Existing behaviour: venv + subprocess with rlimits and a wall-clock
    timeout. Suitable only for offline analysis of public datasets."""

    kind = "local"

    def available(self) -> bool:
        return True

    async def run(self, project_id, workspace, script, args, *, label, timeout):
        # Imported lazily so this module has no import cycle with the pipeline pkg.
        from .pipeline.runner import run_script
        return await run_script(project_id, workspace, script, args,
                                label=label, timeout=timeout)


class IsolatedRunner(Runner):
    """Network-isolated container/VM for dynamic malware and live pentest labs.

    Declared but not implemented here: standing this up means a network-egress
    allowlist (default deny), a disposable per-run VM/container, and the external
    tools the recipe lists (cuckoo/yara, nmap/metasploit). Until an operator
    provisions it (and flips ISOLATED_RUNNER on), available() is False and any
    domain that requires it is blocked at Execute instead of running unboxed.
    """

    kind = "isolated"

    def available(self) -> bool:
        # An operator opts in only after wiring a real isolated backend; the flag
        # alone does not create isolation, it asserts that isolation exists.
        return os.getenv("ISOLATED_RUNNER", "").strip().lower() in ("1", "true", "yes")

    def why_unavailable(self) -> str:
        return ("no network-isolated runner is provisioned (dynamic-malware / "
                "live-pentest domains require one with egress denied); set "
                "ISOLATED_RUNNER=1 only after wiring a real isolated backend")

    async def run(self, project_id, workspace, script, args, *, label, timeout):
        # Guard: never silently fall back to the local runner for an isolated
        # domain — that would defeat the entire safety model.
        raise RuntimeError(self.why_unavailable())


_REGISTRY: dict[str, Runner] = {
    LocalRunner.kind: LocalRunner(),
    IsolatedRunner.kind: IsolatedRunner(),
}


@dataclass
class Resolution:
    """Outcome of matching a recipe to a runner."""
    runner: Runner
    ok: bool          # may this recipe execute right now?
    reason: str       # human-readable explanation when ok is False


def get_runner(kind: str) -> Runner:
    return _REGISTRY.get(kind or "local", _REGISTRY["local"])


def resolve(recipe: dict) -> Resolution:
    """Pick the runner a recipe needs and decide whether execution may proceed.

    Blocks when the domain is shipped disabled (extension surface not yet cleared
    for this host) or when its required runner is not provisioned. This is the
    enforcement point behind the project's safety stance: malware/pentest stay
    boxed in an isolated lab, or they do not run.
    """
    runner = get_runner(recipe.get("runner", "local"))
    if not recipe.get("enabled", True):
        note = recipe.get("safety_note", "")
        return Resolution(runner, False,
                          f"domain '{recipe.get('id')}' is disabled on this host"
                          + (f": {note}" if note else ""))
    if not runner.available():
        return Resolution(runner, False,
                          f"domain '{recipe.get('id')}' needs the "
                          f"'{runner.kind}' runner — {runner.why_unavailable()}")
    return Resolution(runner, True, "")


def describe() -> dict:
    """Runner availability snapshot for the system/info panel."""
    return {k: r.available() for k, r in _REGISTRY.items()}
