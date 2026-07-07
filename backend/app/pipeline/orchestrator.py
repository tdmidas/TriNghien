"""Top-level pipeline orchestrator: chains stages, persists artifacts after each
stage, emits stage/agent events for the UI, and enforces the run MODE:

- auto   : run every stage without stopping.
- manual : pause before each stage (advance gate) + rich RQ gate + experiment gate.
- plan   : run planning stages automatically, but pause at the RQ gate and the
           experiment gate (like Claude Code plan mode).

Human-in-the-loop gates block on an asyncio.Event resolved via a REST call
(see gates.py). Stop cancels the task and kills the running experiment.
"""
import time
import traceback
from pathlib import Path

from .. import db, gates, usage
from ..config import MAX_REPAIR_ATTEMPTS, WORKSPACE_DIR
from ..events import publish
from . import stages, tables

STAGES = [
    ("intake", "Refine Idea"),
    ("literature", "Literature Review"),
    ("research_questions", "Research Questions"),
    ("plan", "Experiment Plan"),
    ("codegen", "Generate Code"),
    ("validate", "Validate Code"),
    ("execute", "Run Experiments"),
    ("report", "Results & Report"),
]

# Which named agent drives each stage (shown in the live "Agents" panel).
AGENTS = {
    "intake": "Idea Agent",
    "literature": "Literature Agent",
    "research_questions": "Research Question Agent",
    "plan": "Planner Agent",
    "codegen": "Coding Agent",
    "validate": "Reviewer Agent",
    "execute": "Experiment Runner Agent",
    "report": "Analysis & Writing Agent",
}

_running: set[str] = set()


def is_running(pid: str) -> bool:
    return pid in _running


class Stopped(Exception):
    """Raised to abort the pipeline cleanly on a user cancel decision."""


async def run_pipeline(pid: str, n_rqs: int = 3, start_from: str | None = None,
                       mode: str = "auto") -> None:
    if pid in _running:
        return
    _running.add(pid)
    try:
        await _run(pid, n_rqs, start_from, mode)
    finally:
        _running.discard(pid)
        gates.clear_task(pid)


async def _gate(pid: str, gate_type: str, data: dict) -> dict:
    """Pause the pipeline and wait for a user decision at a gate."""
    action = {"type": gate_type, **data}
    await db.update_project(pid, time.time(), status="waiting", pending_action=action)
    await publish(pid, "gate", action)
    decision = await gates.wait_gate(pid)
    await db.update_project(pid, time.time(), status="running", pending_action=None)
    await publish(pid, "gate_resolved", {"type": gate_type, "decision": decision})
    return decision


async def _stage_start(pid, key, label):
    usage.set_context(pid, key)
    await publish(pid, "stage_start", {"stage": key, "label": label, "agent": AGENTS.get(key)})
    await publish(pid, "agent_start", {"agent": AGENTS.get(key), "stage": key})
    await db.update_project(pid, time.time(), status="running", current_stage=key)


async def _stage_done(pid, key, label):
    await publish(pid, "agent_stop", {"agent": AGENTS.get(key), "stage": key})
    await publish(pid, "stage_done", {"stage": key, "label": label})
    # persist the running token/cost total after each stage
    await db.update_project(pid, time.time(), usage=usage.get_total(pid))


async def _run(pid: str, n_rqs: int, start_from: str | None, mode: str) -> None:
    project = await db.get_project(pid)
    if not project:
        return
    mode = mode or project.get("mode") or "auto"
    workspace = Path(project["workspace_dir"] or (WORKSPACE_DIR / pid))
    workspace.mkdir(parents=True, exist_ok=True)
    now = time.time()
    # Mark the run start (fresh run resets the clock; resume keeps the original start).
    start_ts = project.get("run_started_at") if start_from else None
    await db.update_project(pid, now, workspace_dir=str(workspace), mode=mode,
                            run_started_at=start_ts or now, run_ended_at=None)

    stage_keys = [s[0] for s in STAGES]
    skip_until = stage_keys.index(start_from) if start_from in stage_keys else 0

    # Token/cost accounting: reset on a fresh run, resume the count otherwise.
    if start_from:
        usage.seed(pid, project.get("usage"))
    else:
        usage.reset(pid)

    art: dict = {
        "intake": {"title": project.get("title", ""),
                   "refined_idea": (project.get("literature") or {}).get("_refined_idea", "")},
        "literature": project.get("literature") or {},
        "rqs": {"research_questions": project.get("research_questions") or []},
        "plan": project.get("plan") or {},
        "results": project.get("results") or {},
    }

    try:
        for idx, (key, label) in enumerate(STAGES):
            if idx < skip_until:
                continue

            # ---- BEFORE-stage gates ----
            if key == "execute" and mode in ("manual", "plan"):
                d = await _gate(pid, "experiments", {
                    "plan": art["plan"], "rqs": art["rqs"]["research_questions"],
                    "message": "Xác nhận chạy thực nghiệm với kế hoạch này?"})
                if d.get("action") == "cancel":
                    raise Stopped()
            elif mode == "manual":
                d = await _gate(pid, "stage_advance", {"stage": key, "label": label,
                                "message": f"Chạy bước: {label}?"})
                if d.get("action") == "cancel":
                    raise Stopped()

            await _stage_start(pid, key, label)

            # ---- run the stage ----
            if key == "intake":
                res = await stages.stage_intake(project)
                art["intake"] = res
                await db.update_project(pid, time.time(), title=res["title"],
                                        literature={"_refined_idea": res["refined_idea"]})
            elif key == "literature":
                res = await stages.stage_literature(project, art["intake"])
                art["literature"] = res
                res["_refined_idea"] = art["intake"]["refined_idea"]
                await db.update_project(pid, time.time(), literature=res,
                                        bibtex=res.get("bibtex", ""))
            elif key == "research_questions":
                res = await stages.stage_research_questions(project, art["intake"], art["literature"], n_rqs)
                art["rqs"] = res
                await db.update_project(pid, time.time(), research_questions=res["research_questions"])
            elif key == "plan":
                res = await stages.stage_plan(project, art["intake"], art["rqs"])
                art["plan"] = res
                await db.update_project(pid, time.time(), plan=res)
            elif key == "codegen":
                await stages.stage_codegen(project, art["intake"], art["plan"], workspace)
            elif key == "validate":
                await stages.stage_validate(project, art["plan"], workspace)
            elif key == "execute":
                res = await stages.stage_execute(project, art["plan"], art["rqs"],
                                                 workspace, MAX_REPAIR_ATTEMPTS)
                art["results"] = res
                await db.update_project(pid, time.time(), results=res)
            elif key == "report":
                md_tables, tex_tables = tables.render_all(art["results"])
                rep = await stages.stage_report(project, art["intake"], art["literature"],
                                                art["rqs"], art["plan"], art["results"], md_tables)
                full_md = rep["report_md"] + "\n\n## Result Tables\n\n" + md_tables
                await db.update_project(pid, time.time(), report_md=full_md, report_latex=tex_tables)
                await publish(pid, "stage_update", {"stage": "report", "report_md": full_md,
                                                    "report_latex": tex_tables})

            await _stage_done(pid, key, label)

            # ---- AFTER-stage gates ----
            if key == "research_questions" and mode in ("manual", "plan"):
                await _rq_gate(pid, project, art, n_rqs)

            project = await db.get_project(pid)

        await db.update_project(pid, time.time(), status="done", current_stage="done",
                                run_ended_at=time.time())
        await publish(pid, "pipeline_done", {})
    except Stopped:
        await db.update_project(pid, time.time(), status="stopped", pending_action=None,
                                run_ended_at=time.time())
        await publish(pid, "pipeline_stopped", {})
    except Exception as e:
        tb = traceback.format_exc()
        await db.update_project(pid, time.time(), status="failed", pending_action=None,
                                run_ended_at=time.time())
        await publish(pid, "pipeline_error", {"error": str(e), "traceback": tb[-2000:]})


async def _rq_gate(pid, project, art, n_rqs):
    """RQ approval gate: approve / edit (user supplies own) / regenerate (LLM, with feedback)."""
    while True:
        d = await _gate(pid, "rqs", {
            "research_questions": art["rqs"]["research_questions"],
            "message": "Bạn đồng ý với các Research Question này?"})
        action = d.get("action", "approve")
        if action == "cancel":
            raise Stopped()
        if action == "approve":
            return
        if action == "edit":
            rqs = d.get("research_questions") or art["rqs"]["research_questions"]
            art["rqs"] = {"research_questions": rqs}
            await db.update_project(pid, time.time(), research_questions=rqs)
            return
        if action == "regenerate":
            await _stage_start(pid, "research_questions", "Research Questions")
            res = await stages.stage_research_questions(
                project, art["intake"], art["literature"], n_rqs, feedback=d.get("feedback", ""))
            art["rqs"] = res
            await db.update_project(pid, time.time(), research_questions=res["research_questions"])
            await _stage_done(pid, "research_questions", "Research Questions")
            # loop back to re-ask approval
