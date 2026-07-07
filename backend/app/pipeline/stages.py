"""Individual pipeline stages. Each stage is an async function that takes the
live project state, calls the LLM / runner, publishes events, and returns the
artifact it produced. The orchestrator chains them and persists state.
"""
import asyncio
import json
from pathlib import Path

import httpx

from .. import datasets as ds
from .. import runners
from ..events import publish
from ..llm import chat, extract_code, extract_json
from ..recipes import domain_constraints, get_recipe, public_view
from ..topics import get_topic
from . import prompts


async def _ask_json(model: str, user: str, temperature: float = 0.6):
    reply = await chat(model, [
        {"role": "system", "content": prompts.SYSTEM},
        {"role": "user", "content": user},
    ], temperature=temperature)
    return extract_json(reply), reply


def _domain_block(project: dict) -> str:
    """Render the topic's recipe execution constraints as a prompt suffix so
    every design stage (idea → RQ → plan → codegen) stays within what the
    selected runner can actually do, and knows the domain's success criteria
    and codegen rules. Empty for a topic with no distinguishing constraints."""
    text = domain_constraints(get_recipe(project.get("topic")))
    return f"\n\n---\nDomain execution constraints (design within these):\n{text}" if text else ""


# ---------------------------------------------------------------- stage 1: intake
async def stage_intake(project: dict) -> dict:
    topic = get_topic(project["topic"])
    dataset_ctx = ds.describe_for_prompt(project.get("dataset"))
    user = prompts.REFINE_IDEA.format(
        topic_name=topic["name"],
        idea_prompt=project["idea_prompt"],
        topic_context=topic["prompt_context"],
        dataset_context=dataset_ctx,
    ) + _domain_block(project)
    data, _ = await _ask_json(project["model"], user)
    sel = data.get("selected", {})
    await publish(project["id"], "stage_update", {
        "stage": "intake",
        "candidates": data.get("candidates", []),
        "selected": sel,
    })
    return {
        "title": sel.get("title") or project["idea_prompt"][:80],
        "refined_idea": sel.get("refined_idea", ""),
        "keywords": sel.get("keywords", []),
        "candidates": data.get("candidates", []),
    }


# ------------------------------------------------------------ stage 2: literature
async def _arxiv_search(query: str, max_results: int = 5) -> list[dict]:
    url = "http://export.arxiv.org/api/query"
    params = {"search_query": f"all:{query}", "start": 0, "max_results": max_results,
              "sortBy": "relevance"}
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            r = await client.get(url, params=params)
            r.raise_for_status()
            text = r.text
    except httpx.HTTPError:
        return []
    import re
    entries = re.findall(r"<entry>(.*?)</entry>", text, re.DOTALL)
    out = []
    for e in entries:
        def grab(tag):
            m = re.search(rf"<{tag}>(.*?)</{tag}>", e, re.DOTALL)
            return re.sub(r"\s+", " ", m.group(1)).strip() if m else ""
        idm = re.search(r"<id>(.*?)</id>", e, re.DOTALL)
        url = idm.group(1).strip() if idm else ""
        authors = re.findall(r"<author>\s*<name>(.*?)</name>", e, re.DOTALL)
        published = grab("published")  # e.g. 2023-05-01T...
        year = published[:4] if published[:4].isdigit() else ""
        arxiv_id = ""
        m = re.search(r"arxiv\.org/abs/([^v\s]+)", url)
        if m:
            arxiv_id = m.group(1)
        out.append({
            "title": grab("title"),
            "summary": grab("summary")[:400],
            "url": url,
            "authors": [a.strip() for a in authors],
            "year": year,
            "arxiv_id": arxiv_id,
        })
    return out


def _bibtex_key(paper: dict, i: int) -> str:
    first_author = (paper.get("authors") or ["anon"])[0].split()[-1] if paper.get("authors") else "anon"
    key = "".join(c for c in first_author.lower() if c.isalnum()) or "ref"
    return f"{key}{paper.get('year', '')}{i}"


def build_bibtex(papers: list[dict]) -> str:
    """Generate a references.bib from the retrieved arXiv papers."""
    entries = []
    for i, p in enumerate(papers, 1):
        if not p.get("title"):
            continue
        key = _bibtex_key(p, i)
        authors = " and ".join(p.get("authors") or []) or "Unknown"
        fields = [
            f"  title = {{{p['title']}}}",
            f"  author = {{{authors}}}",
        ]
        if p.get("year"):
            fields.append(f"  year = {{{p['year']}}}")
        if p.get("arxiv_id"):
            fields.append(f"  eprint = {{{p['arxiv_id']}}}")
            fields.append("  archivePrefix = {arXiv}")
        if p.get("url"):
            fields.append(f"  url = {{{p['url']}}}")
        fields.append("  journal = {arXiv preprint}")
        entries.append(f"@article{{{key},\n" + ",\n".join(fields) + "\n}")
    return "\n\n".join(entries) + ("\n" if entries else "")


async def stage_literature(project: dict, intake: dict) -> dict:
    pid = project["id"]
    queries, _ = await _ask_json(project["model"], prompts.LITERATURE_QUERIES.format(
        title=intake["title"], refined_idea=intake["refined_idea"]))
    if isinstance(queries, dict):
        queries = queries.get("queries") or next(iter(queries.values()), [])
    queries = [q for q in (queries or []) if isinstance(q, str)][:3] or [intake["title"]]
    await publish(pid, "stage_update", {"stage": "literature", "queries": queries})

    papers: list[dict] = []
    for q in queries:
        for p in await _arxiv_search(q):
            if p["url"] and not any(p["url"] == e["url"] for e in papers):
                papers.append(p)
    papers = papers[:12]

    papers_txt = "\n".join(
        f"[{i+1}] {p['title']}\n    {p['summary']}\n    {p['url']}"
        for i, p in enumerate(papers)
    ) or "(no papers found)"

    notes_data, _ = await _ask_json(project["model"], prompts.LITERATURE_NOTES.format(
        title=intake["title"], refined_idea=intake["refined_idea"], papers=papers_txt))
    # attach a stable bibtex key to each paper for citations
    for i, p in enumerate(papers, 1):
        p["bib_key"] = _bibtex_key(p, i)
    result = {
        "queries": queries,
        "papers": papers,
        "notes": notes_data.get("notes", ""),
        "relevant_ids": notes_data.get("relevant_ids", []),
        "bibtex": build_bibtex(papers),
    }
    await publish(pid, "stage_update", {"stage": "literature", "papers": papers,
                                        "notes": result["notes"]})
    return result


# --------------------------------------------------------- stage 3: research Qs
async def stage_research_questions(project: dict, intake: dict, literature: dict, n_rqs: int,
                                   feedback: str = "") -> dict:
    topic = get_topic(project["topic"])
    user = prompts.RESEARCH_QUESTIONS.format(
        title=intake["title"], refined_idea=intake["refined_idea"],
        topic_context=topic["prompt_context"],
        dataset_context=ds.describe_for_prompt(project.get("dataset")),
        literature_notes=literature.get("notes", ""),
        n_rqs=n_rqs,
    ) + _domain_block(project)
    if feedback:
        user += (f"\n\nThe student was not satisfied with the previous research questions. "
                 f"Their feedback: \"{feedback}\". Generate a DIFFERENT set addressing this.")
    data, _ = await _ask_json(project["model"], user)
    rqs = data.get("research_questions", [])
    # Enforce the requested count: models often ignore "exactly N" and emit 3.
    if n_rqs and len(rqs) > n_rqs:
        rqs = rqs[:n_rqs]

    # Novelty check against the retrieved literature (AI-Scientist-style).
    papers = literature.get("papers", [])
    if rqs and papers:
        papers_txt = "\n".join(f"- {p.get('title', '')}" for p in papers[:12])
        try:
            nov, _ = await _ask_json(project["model"], prompts.NOVELTY_CHECK.format(
                rqs_json=json.dumps(rqs, ensure_ascii=False), papers=papers_txt), temperature=0.3)
            by_id = {a.get("id"): a for a in nov.get("assessments", [])}
            for rq in rqs:
                a = by_id.get(rq.get("id"))
                if a:
                    rq["novelty_check"] = {
                        "novel": a.get("novel"),
                        "note": a.get("novelty_note", ""),
                        "closest_work": a.get("closest_work", ""),
                    }
        except Exception as e:
            await publish(project["id"], "log", {"stream": "system", "line": f"novelty check skipped: {e}"})

    await publish(project["id"], "stage_update", {"stage": "research_questions", "rqs": rqs})
    return {"research_questions": rqs}


# --------------------------------------------------------------- stage 4: plan
async def stage_plan(project: dict, intake: dict, rqs: dict) -> dict:
    user = prompts.EXPERIMENT_PLAN.format(
        title=intake["title"], refined_idea=intake["refined_idea"],
        dataset_context=ds.describe_for_prompt(project.get("dataset")),
        rqs_json=json.dumps(rqs["research_questions"], ensure_ascii=False, indent=2),
    ) + _domain_block(project)
    data, _ = await _ask_json(project["model"], user)
    await publish(project["id"], "stage_update", {"stage": "plan", "plan": data})
    return data


# ------------------------------------------------------------- stage 5: codegen
def _scaffold_files(plan: dict) -> list[tuple[str, str, str]]:
    """Return (filename, purpose, lang) for each file to generate, in order."""
    files = [
        ("requirements.txt", "pip requirements, one BARE package name per line (e.g. `pandas`, `numpy`, "
         "`scikit-learn`, `datasets`). CRITICAL: do NOT pin versions (no `==`, `<=`, `>=`) — pinned old "
         "versions have no wheels for Python 3.12 and fail to build. List only packages the experiments "
         "actually import; add torch/transformers only if genuinely used.", "text"),
        ("src/common.py", "shared data loading + preprocessing used by every experiment script, "
         "implementing the plan's 'shared' section. Expose load_data(smoke: bool) and any shared "
         "featurization/splitting helpers.", "python"),
    ]
    for exp in plan.get("experiments", []):
        script = exp.get("script", f"experiment_{exp.get('rq_id','rq').lower()}.py")
        files.append((
            f"experiments/{script}",
            f"experiment script for {exp.get('rq_id')} implementing these runs: "
            f"{json.dumps(exp.get('runs', []))}. It imports from src.common, parses --out_dir, "
            f"runs every listed run, and writes final_info.json per run into out_dir.",
            "python",
        ))
    files.append(("README.md", "setup + run instructions for a student: how to create venv, install "
                  "requirements, and run each experiment script with --out_dir. Keep it short.", "text"))
    return files


async def stage_codegen(project: dict, intake: dict, plan: dict, workspace: Path) -> dict:
    pid = project["id"]
    (workspace / "src").mkdir(parents=True, exist_ok=True)
    (workspace / "experiments").mkdir(parents=True, exist_ok=True)
    (workspace / "results").mkdir(parents=True, exist_ok=True)
    (workspace / "src" / "__init__.py").write_text("", encoding="utf-8")

    dataset_ctx = ds.describe_for_prompt(project.get("dataset"))
    plan_json = json.dumps(plan, ensure_ascii=False, indent=2)
    # Fold the domain's codegen guidance + success criteria into the rule block so
    # the coding agent honours them (e.g. "static features only, never execute a
    # sample"); harmless for plain dataset topics whose block is empty.
    rules = prompts.CODEGEN_RULES + _domain_block(project)
    generated: list[str] = []
    for filename, purpose, lang in _scaffold_files(plan):
        await publish(pid, "stage_update", {"stage": "codegen", "file": filename, "status": "generating"})
        reply = await chat(project["model"], [
            {"role": "system", "content": prompts.SYSTEM},
            {"role": "user", "content": prompts.CODEGEN_FILE.format(
                title=intake["title"], plan_json=plan_json, dataset_context=dataset_ctx,
                rules=rules, existing_files=", ".join(generated) or "(none yet)",
                filename=filename, file_purpose=purpose, lang=lang,
            )},
        ], temperature=0.3, max_tokens=12000)
        content = extract_code(reply, lang if lang != "text" else "")
        target = workspace / filename
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding="utf-8")
        generated.append(filename)
        await publish(pid, "file_written", {"path": filename, "size": len(content)})
    return {"files": generated}


# ------------------------------------------------------------ stage 6: validate
async def stage_validate(project: dict, plan: dict, workspace: Path) -> dict:
    pid = project["id"]
    dataset_ctx = ds.describe_for_prompt(project.get("dataset"))
    plan_json = json.dumps(plan, ensure_ascii=False, indent=2)
    problems: dict[str, list] = {}
    _SKIP = {".venv", "__pycache__", ".git", "node_modules", "data", "results"}
    for py_file in sorted(workspace.glob("**/*.py")):
        rel = py_file.relative_to(workspace).as_posix()
        if any(part in _SKIP for part in py_file.relative_to(workspace).parts):
            continue
        if rel.endswith("__init__.py"):
            continue
        code = py_file.read_text(encoding="utf-8", errors="replace")
        # cheap syntax gate
        try:
            compile(code, rel, "exec")
        except SyntaxError as e:
            problems[rel] = [f"SyntaxError: {e}"]
        # LLM self-review
        data, _ = await _ask_json(project["model"], prompts.SELF_REVIEW.format(
            rules=prompts.CODEGEN_RULES, plan_json=plan_json, dataset_context=dataset_ctx,
            filename=rel, code=code[:12000]), temperature=0.2)
        if not data.get("fully_correct", True) and data.get("must_fix"):
            problems.setdefault(rel, []).extend(data.get("problems", []))
        await publish(pid, "stage_update", {"stage": "validate", "file": rel,
                                            "ok": rel not in problems, "problems": problems.get(rel, [])})
    return {"problems": problems}


# ------------------------------------------------------------- stage 7: execute
async def _repair(project, workspace, rel_script, out_dir, run_res, dataset_ctx, smoke) -> bool:
    """Two-agent revise loop (Advisor diagnoses root cause → Coding agent fixes),
    modeled on the review/repair loops in the reference papers. Returns True if
    the file was rewritten. Bounded by REPAIR_LLM_TIMEOUT_SECONDS per call so a
    stuck connection can't hang the run."""
    from ..config import REPAIR_LLM_TIMEOUT_SECONDS
    pid = project["id"]
    path = workspace / rel_script
    code = path.read_text(encoding="utf-8", errors="replace")

    # --- Advisor agent: diagnose ---
    advisor_text = "(diagnosis unavailable)"
    await publish(pid, "agent_start", {"agent": "Advisor Agent", "role": "diagnose", "file": rel_script})
    try:
        diag_reply = await asyncio.wait_for(chat(project["model"], [
            {"role": "system", "content": prompts.SYSTEM},
            {"role": "user", "content": prompts.ADVISOR_DIAGNOSE.format(
                filename=rel_script, smoke=int(smoke), returncode=run_res["returncode"],
                timeout=run_res["timeout"], stderr=run_res["stderr_tail"], code=code[:12000],
                dataset_context=dataset_ctx)},
        ], temperature=0.2, max_tokens=2000), timeout=REPAIR_LLM_TIMEOUT_SECONDS)
        diag = extract_json(diag_reply)
        advisor_text = json.dumps(diag, ensure_ascii=False)
        await publish(pid, "stage_update", {"stage": "execute", "advisor": diag, "file": rel_script})
    except Exception as e:
        await publish(pid, "log", {"stream": "system", "line": f"advisor skipped: {e}"})
    finally:
        await publish(pid, "agent_stop", {"agent": "Advisor Agent"})

    # --- Coding agent: fix ---
    await publish(pid, "agent_start", {"agent": "Coding Agent", "role": "repair", "file": rel_script})
    try:
        reply = await asyncio.wait_for(chat(project["model"], [
            {"role": "system", "content": prompts.SYSTEM},
            {"role": "user", "content": prompts.REPAIR.format(
                filename=rel_script, out_dir=out_dir, smoke=int(smoke),
                returncode=run_res["returncode"], timeout=run_res["timeout"],
                stderr=run_res["stderr_tail"], code=code[:12000],
                dataset_context=dataset_ctx, advisor=advisor_text, rules=prompts.CODEGEN_RULES)},
        ], temperature=0.2, max_tokens=12000), timeout=REPAIR_LLM_TIMEOUT_SECONDS)
    except Exception as e:
        await publish(pid, "log", {"stream": "system", "line": f"repair skipped: {e}"})
        await publish(pid, "agent_stop", {"agent": "Coding Agent"})
        return False
    await publish(pid, "agent_stop", {"agent": "Coding Agent"})

    new_code = extract_code(reply, "python")
    if new_code.strip() and new_code.strip() != code.strip():
        path.write_text(new_code, encoding="utf-8")
        await publish(pid, "file_written", {"path": rel_script, "size": len(new_code), "repair": True})
        return True
    return False


def _is_metric_map(d: dict) -> bool:
    """True if d looks like a flat {metric_name: number|str} row."""
    return bool(d) and all(isinstance(v, (int, float, str, bool)) for v in d.values())


def collect_run_metrics(out_dir: Path) -> list[dict]:
    """Collect result rows from a run directory, tolerant of how models write
    them: a flat final_info.json, per-model <name>_final_info.json, or a nested
    {model_name: {metrics}} map (final_info.json / summary_results.json)."""
    rows: dict[str, dict] = {}
    if not out_dir.exists():
        return []
    # Prefer an explicit summary if the script wrote one.
    candidates = sorted(out_dir.glob("*final_info.json")) + sorted(out_dir.glob("summary_results.json"))
    for f in candidates:
        try:
            data = json.loads(f.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            continue
        if not isinstance(data, dict):
            continue
        if _is_metric_map(data):
            name = f.stem.replace("_final_info", "").replace("final_info", "") or out_dir.name
            rows[name] = {k: _clean_num(v) for k, v in data.items() if isinstance(v, (int, float, str, bool))}
        else:
            # nested {model: {metrics}}
            for model, metrics in data.items():
                if isinstance(metrics, dict) and _is_metric_map(metrics):
                    rows[model] = {k: _clean_num(v) for k, v in metrics.items()
                                   if isinstance(v, (int, float, str, bool))}
    # Drop all-zero rows (e.g. a gracefully-skipped optional model).
    return [{"run_name": n, "metrics": m}
            for n, m in rows.items()
            if any(isinstance(v, (int, float)) and v not in (0, None) for v in m.values())]


def _clean_num(v):
    """NaN/Inf metrics -> None (JSON-safe; a divide-by-zero AUC shouldn't crash the API)."""
    import math
    if isinstance(v, float) and not math.isfinite(v):
        return None
    return v


async def _execute_one_rq(project, rq_id, rel_script, out_dir, workspace, dataset_ctx, max_repair, runner) -> None:
    """Run one RQ script: smoke then full, bounded repair loop. Timeouts are
    per-phase; the whole call is additionally wrapped in a wall-clock budget.
    `runner` is the recipe-selected execution backend (local / isolated)."""
    import os
    from ..config import RUN_TIMEOUT_SECONDS, SMOKE_TIMEOUT_SECONDS
    pid = project["id"]
    success = False
    for phase, smoke in (("smoke", True), ("full", False)):
        os.environ["SMOKE_TEST"] = "1" if smoke else "0"
        timeout = SMOKE_TIMEOUT_SECONDS if smoke else RUN_TIMEOUT_SECONDS
        await publish(pid, "stage_update", {"stage": "execute", "rq_id": rq_id, "run": rq_id, "status": phase})
        attempt = 0
        while attempt <= max_repair:
            res = await runner.run(pid, workspace, rel_script,
                                   [f"--out_dir={out_dir}"], label=f"{rq_id}/{phase}", timeout=timeout)
            if res["ok"] and collect_run_metrics(workspace / out_dir):
                success = True
                break
            attempt += 1
            await publish(pid, "stage_update", {"stage": "execute", "rq_id": rq_id,
                          "run": rq_id, "status": "repairing", "attempt": attempt, "phase": phase})
            if attempt > max_repair:
                break
            if not await _repair(project, workspace, rel_script, out_dir, res, dataset_ctx, smoke):
                break
        if not success:
            break
    os.environ["SMOKE_TEST"] = "0"


async def stage_execute(project, plan, rqs, workspace: Path, max_repair: int) -> dict:
    from ..config import RQ_BUDGET_SECONDS
    pid = project["id"]

    # Safety gate: the recipe decides whether this domain may execute here and on
    # which runner. A disabled domain (e.g. dynamic malware, live pentest) or one
    # whose isolated runner is not provisioned is REFUSED — we never fall back to
    # running boxed-off code through the local runner.
    recipe = get_recipe(project.get("topic"))
    res = runners.resolve(recipe)
    if not res.ok:
        await publish(pid, "stage_update", {"stage": "execute", "status": "blocked",
                      "reason": res.reason, "recipe": public_view(recipe)})
        await publish(pid, "log", {"stream": "system", "line": f"⛔ Execution blocked: {res.reason}"})
        return {"rqs": [], "blocked": True, "reason": res.reason,
                "recipe": public_view(recipe)}
    runner = res.runner
    await publish(pid, "log", {"stream": "system",
                  "line": f"Runner: {runner.kind} · network policy: {recipe.get('network')}"})

    dataset_ctx = ds.describe_for_prompt(project.get("dataset"))
    rq_by_id = {rq["id"]: rq for rq in rqs["research_questions"]}
    results_rqs = []

    for exp in plan.get("experiments", []):
        rq_id = exp.get("rq_id", "RQ")
        script = exp.get("script", "")
        rel_script = f"experiments/{script}" if not script.startswith("experiments/") else script
        if not (workspace / rel_script).exists():
            continue
        out_dir = f"results/{rq_id.lower()}"
        (workspace / out_dir).mkdir(parents=True, exist_ok=True)

        # Hard wall-clock budget per RQ: a stuck run/repair can never freeze the pipeline.
        try:
            await asyncio.wait_for(
                _execute_one_rq(project, rq_id, rel_script, out_dir, workspace, dataset_ctx, max_repair, runner),
                timeout=RQ_BUDGET_SECONDS)
        except asyncio.TimeoutError:
            await publish(pid, "stage_update", {"stage": "execute", "rq_id": rq_id,
                          "run": rq_id, "status": "budget_exceeded"})
            await publish(pid, "log", {"stream": "system",
                          "line": f"⏱ {rq_id} exceeded {RQ_BUDGET_SECONDS}s budget; moving on with whatever it produced"})

        rq_runs = collect_run_metrics(workspace / out_dir)
        for r in rq_runs:
            r["ok"] = True
            await publish(pid, "run_progress", {"rq_id": rq_id, "run": r["run_name"],
                                                "ok": True, "metrics": r["metrics"]})
        if not rq_runs:
            await publish(pid, "run_progress", {"rq_id": rq_id, "run": rq_id, "ok": False, "metrics": {}})
        results_rqs.append({"rq_id": rq_id, "question": rq_by_id.get(rq_id, {}).get("question", ""),
                            "runs": rq_runs})
    return {"rqs": results_rqs}


# ----------------------------------------------------- stage 8: analyze + report
async def stage_report(project, intake, literature, rqs, plan, results, tables_md) -> dict:
    pid = project["id"]
    results_json = json.dumps(results, ensure_ascii=False, indent=2)
    rqs_json = json.dumps(rqs["research_questions"], ensure_ascii=False, indent=2)

    analysis, _ = await _ask_json(project["model"], prompts.ANALYZE_RESULTS.format(
        title=intake["title"], rqs_json=rqs_json, results_json=results_json))
    await publish(pid, "stage_update", {"stage": "report", "analysis": analysis})

    topic = get_topic(project["topic"])
    report_md = await chat(project["model"], [
        {"role": "system", "content": prompts.SYSTEM},
        {"role": "user", "content": prompts.REPORT.format(
            title=intake["title"], refined_idea=intake["refined_idea"], topic_name=topic["name"],
            literature_notes=literature.get("notes", ""), rqs_json=rqs_json,
            plan_json=json.dumps(plan.get("shared", {}), ensure_ascii=False),
            results_json=results_json, analysis_json=json.dumps(analysis, ensure_ascii=False),
            tables_md=tables_md)},
    ], temperature=0.4, max_tokens=12000)
    return {"analysis": analysis, "report_md": report_md.strip()}
