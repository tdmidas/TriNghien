"""Domain recipe registry — the plugin layer that makes the pipeline extensible
across security-research domains.

The core pipeline (idea → RQ → code → run → tables) is domain-agnostic. What
differs violently between domains is the EXECUTION step: how isolated it must
be, what network egress is allowed, what compute it needs, which external tools
must exist, and what "a finished run" actually looks like. A *recipe* captures
exactly that as declarative metadata, so onboarding a new domain is writing a
recipe (+ maybe a runner image) rather than editing the pipeline core.

Every topic in topics.py maps to a recipe. Pure dataset-analysis topics share
the default DATASET_RECIPE (local venv runner, datasets-only egress). Domains
that need real isolation (dynamic malware, live pentest labs) declare a stronger
runner and `enabled=False`; if the host cannot provide that runner the pipeline
refuses to execute rather than silently running dangerous code unsandboxed.
This mirrors the project's safety stance: malware/pentest execution stays boxed
in a network-isolated lab with egress off by default, or it does not run.

Runner kinds (see runners.py for the implementations):
  "local"    — per-project virtualenv + subprocess (offline dataset analysis).
  "isolated" — container/VM with a strict egress policy (dynamic/interactive
               domains). Not available on a plain dev host.

Network egress policies (enforced by the runner as far as the host allows):
  "datasets-only" — HuggingFace / pip / arXiv only (dataset pipelines).  [default]
  "api"           — additionally allow the configured LLM API host.
  "none"          — no egress at all; only an "isolated" runner can honour this.
"""
from copy import deepcopy

# The baseline recipe every dataset-driven topic inherits. A topic's recipe is
# this dict with domain-specific overrides merged on top.
DATASET_RECIPE = {
    "runner": "local",
    "network": "datasets-only",
    "resources": {"gpu": "optional", "min_ram_mb": 4096},
    "external_tools": [],          # names of binaries the runner image must ship
    "enabled": True,               # False => selectable but blocked at Execute
    "success_criteria": (
        "Each RQ script writes a flat final_info.json (or per-model "
        "<name>_final_info.json) of {metric_name: number} into its out_dir; a "
        "run counts as finished only when at least one non-zero metric row is "
        "collected."
    ),
    "codegen_guidance": "",        # extra domain rules appended during codegen
    "safety_note": (
        "Offline analysis of public datasets only — no live exploitation, no "
        "sample execution, no external targets."
    ),
}

# Per-topic overrides. Keys must match topic ids in topics.py; any topic without
# an entry falls back to DATASET_RECIPE unchanged.
_OVERRIDES: dict[str, dict] = {
    "adversarial-ml": {
        # Attack/defense loops (FGSM/PGD, adversarial training) lean on a GPU.
        "resources": {"gpu": "recommended", "min_ram_mb": 8192},
        "codegen_guidance": (
            "Adversarial-ML specifics: implement attacks (e.g. FGSM/PGD) and "
            "defenses in-process; report clean accuracy, robust accuracy under "
            "each attack budget (epsilon), and attack success rate. If torch is "
            "used it must be optional (wrap imports; skip the run if absent)."
        ),
    },
    "malware-analysis": {
        "codegen_guidance": (
            "Static malware detection: operate ONLY on pre-extracted feature "
            "datasets (PE headers, permissions, opcode/API n-grams). NEVER "
            "execute, unpack, or download a sample binary."
        ),
        "safety_note": (
            "Static features only — the runner must never execute a malware "
            "sample. Dynamic analysis lives under the isolated 'malware-dynamic' "
            "recipe, which is disabled until an isolated runner is provisioned."
        ),
    },
    "llm-security": {
        # Classifier baselines may call the chosen OpenRouter model, so the API
        # host must be reachable.
        "network": "api",
        "codegen_guidance": (
            "If an experiment uses an OpenRouter model as a zero-shot classifier, "
            "read OPENROUTER_API_KEY from the environment, cap the number of API "
            "calls in SMOKE_TEST mode, and cache responses so a re-run is cheap."
        ),
    },
    # ---- Extension domains: the framework's whole point. Declarative recipes
    # that need a stronger runner. Shipped disabled so they are visible as the
    # extension surface without being runnable on an un-isolated host. ----
    "malware-dynamic": {
        "runner": "isolated",
        "network": "none",
        "resources": {"gpu": "optional", "min_ram_mb": 8192, "disk_gb": 40},
        "external_tools": ["cuckoo", "yara"],
        "enabled": False,
        "success_criteria": (
            "Behavioural report per sample (API-call trace, dropped files, "
            "network attempts) reduced to a feature table + detection metrics."
        ),
        "codegen_guidance": (
            "Dynamic analysis: detonate samples ONLY inside the provided "
            "network-isolated sandbox VM. Never open egress. Collect behaviour "
            "from the sandbox report; do not exfiltrate samples."
        ),
        "safety_note": (
            "Executes live malware — REQUIRES a network-isolated runner (egress "
            "denied) and institutional approval. Disabled until such a runner "
            "is configured."
        ),
    },
    "multi-agent-pentest": {
        "runner": "isolated",
        "network": "none",
        "resources": {"gpu": "optional", "min_ram_mb": 8192, "disk_gb": 30},
        "external_tools": ["nmap", "metasploit"],
        "enabled": False,
        "success_criteria": (
            "Per-target results table: services discovered, vulnerabilities "
            "confirmed, exploitation success rate, mean steps/tokens per agent."
        ),
        "codegen_guidance": (
            "Multi-agent pentest: agents may act ONLY against the intentionally "
            "vulnerable lab targets provisioned inside the isolated network "
            "(e.g. Metasploitable/DVWA). Never target an address outside the "
            "lab subnet. Enforce a per-agent token/step budget."
        ),
        "safety_note": (
            "Runs offensive tooling — REQUIRES an isolated lab network with no "
            "route to the internet, targets you own, and institutional approval. "
            "Disabled until an isolated runner is configured."
        ),
    },
}


def _build() -> dict[str, dict]:
    recipes: dict[str, dict] = {}
    # Every known topic id gets a concrete recipe (default + overrides).
    from .topics import TOPICS
    ids = {t["id"] for t in TOPICS} | set(_OVERRIDES)
    for tid in ids:
        recipe = deepcopy(DATASET_RECIPE)
        ov = _OVERRIDES.get(tid, {})
        for k, v in ov.items():
            if isinstance(v, dict) and isinstance(recipe.get(k), dict):
                recipe[k] = {**recipe[k], **v}
            else:
                recipe[k] = v
        recipe["id"] = tid
        recipes[tid] = recipe
    return recipes


RECIPES = _build()


def get_recipe(topic_id: str) -> dict:
    """Return the recipe for a topic id, or a fresh default for unknown ids."""
    r = RECIPES.get(topic_id)
    if r is not None:
        return r
    fallback = deepcopy(DATASET_RECIPE)
    fallback["id"] = topic_id or "general"
    return fallback


def domain_constraints(recipe: dict) -> str:
    """Render the recipe's execution constraints as a prompt fragment so every
    stage (idea → RQ → codegen) stays aware of what the runner can actually do."""
    net = {
        "datasets-only": "dataset/pip downloads only (no other network access)",
        "api": "dataset downloads plus the configured LLM API host",
        "none": "NO network egress at all",
    }.get(recipe.get("network", "datasets-only"), recipe.get("network", ""))
    gpu = recipe.get("resources", {}).get("gpu", "optional")
    lines = [
        f"Execution environment: '{recipe.get('runner', 'local')}' runner, "
        f"network policy = {net}, GPU {gpu}.",
        f"Definition of a finished run: {recipe.get('success_criteria', '')}",
    ]
    if recipe.get("external_tools"):
        lines.append("Available external tools: " + ", ".join(recipe["external_tools"]) + ".")
    if recipe.get("codegen_guidance"):
        lines.append(recipe["codegen_guidance"])
    return "\n".join(lines)


def public_view(recipe: dict) -> dict:
    """Trim a recipe to the fields the frontend needs for badges/gating."""
    return {
        "id": recipe.get("id"),
        "runner": recipe.get("runner"),
        "network": recipe.get("network"),
        "resources": recipe.get("resources", {}),
        "external_tools": recipe.get("external_tools", []),
        "enabled": recipe.get("enabled", True),
        "safety_note": recipe.get("safety_note", ""),
        "success_criteria": recipe.get("success_criteria", ""),
    }
