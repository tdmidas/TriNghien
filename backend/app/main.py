"""FastAPI application: REST endpoints, SSE tracking stream, dataset endpoints,
and a read-only file browser over each project's generated repo.
"""
import asyncio
import json
import shutil
import time
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from . import datasets as ds
from . import db, events, gates, runtime
from . import export as export_mod
from . import system as sysinfo
from .config import DEFAULT_MODEL, UPLOAD_DIR, WORKSPACE_DIR
from .llm import list_models
from .pipeline import orchestrator
from .topics import TOPICS, TOPIC_IDS

app = FastAPI(title="AI Researcher API")
app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"],
)


@app.on_event("startup")
async def _startup():
    await db.init()
    # Warm the model/price cache so cost computation has prices immediately.
    try:
        await list_models()
    except Exception:
        pass


@app.on_event("shutdown")
async def _shutdown():
    await db.close()


# ------------------------------------------------------------------- meta
@app.get("/api/health")
async def health():
    return {"ok": True}


@app.get("/api/topics")
async def get_topics():
    # Attach each topic's execution recipe (runner, network policy, GPU need,
    # enabled/disabled, safety note) so the UI can badge topics and disable the
    # Run button for domains that need an isolated runner not present here.
    from .recipes import get_recipe, public_view
    out = []
    for t in TOPICS:
        out.append({**t, "recipe": public_view(get_recipe(t["id"]))})
    return {"topics": out}


@app.get("/api/recipes")
async def get_recipes():
    """Full recipe registry + which runners are actually available on this host,
    for a settings/extension panel."""
    from . import recipes as recipes_mod
    from . import runners
    return {
        "recipes": [recipes_mod.public_view(r) for r in recipes_mod.RECIPES.values()],
        "runners": runners.describe(),
    }


@app.get("/api/models")
async def get_models(force: bool = False):
    try:
        models = await list_models(force=force)
    except Exception as e:
        raise HTTPException(502, f"OpenRouter model list failed: {e}")
    return {"models": models, "default": DEFAULT_MODEL}


# --------------------------------------------------------------- datasets
@app.get("/api/datasets/search")
async def datasets_search(q: str, limit: int = 12):
    try:
        return {"results": await ds.search_hf(q, limit)}
    except Exception as e:
        raise HTTPException(502, f"HuggingFace search failed: {e}")


@app.get("/api/datasets/preview")
async def datasets_preview(id: str):
    return await ds.preview_hf(id)


class AttachHF(BaseModel):
    project_id: str
    dataset_id: str
    config: str | None = None
    split: str | None = None


@app.post("/api/datasets/attach_hf")
async def attach_hf(body: AttachHF):
    project = await db.get_project(body.project_id)
    if not project:
        raise HTTPException(404, "project not found")
    preview = await ds.preview_hf(body.dataset_id)
    dataset = {
        "source": "huggingface",
        "id": body.dataset_id,
        "config": body.config or preview.get("config"),
        "split": body.split or preview.get("split"),
        "features": preview.get("features", []),
        "rows": preview.get("rows", []),
    }
    await db.update_project(body.project_id, time.time(), dataset=dataset)
    return {"dataset": dataset}


@app.post("/api/datasets/upload")
async def upload_dataset(project_id: str = Form(...), file: UploadFile = File(...)):
    project = await db.get_project(project_id)
    if not project:
        raise HTTPException(404, "project not found")
    # save into the project's workspace ./data and preview
    workspace = Path(project["workspace_dir"] or (WORKSPACE_DIR / project_id))
    data_dir = workspace / "data"
    data_dir.mkdir(parents=True, exist_ok=True)
    dest = data_dir / Path(file.filename).name
    content = await file.read()
    dest.write_bytes(content)
    preview = ds.preview_local(dest)
    existing = project.get("dataset") or {}
    files = existing.get("files", []) if existing.get("source") == "local" else []
    files.append({"name": dest.name, "size": len(content)})
    dataset = {
        "source": "local",
        "files": files,
        "features": preview.get("features", []),
        "rows": preview.get("rows", []),
    }
    await db.update_project(project_id, time.time(), dataset=dataset, workspace_dir=str(workspace))
    return {"dataset": dataset, "preview": preview}


# ---------------------------------------------------------------- projects
class CreateProject(BaseModel):
    idea_prompt: str
    topic: str
    model: str = DEFAULT_MODEL
    title: str = ""
    mode: str = "auto"


@app.post("/api/projects")
async def create_project(body: CreateProject):
    if body.topic not in TOPIC_IDS:
        raise HTTPException(400, f"unknown topic: {body.topic}")
    if not body.idea_prompt.strip():
        raise HTTPException(400, "idea_prompt is required")
    mode = body.mode if body.mode in ("auto", "manual", "plan") else "auto"
    project = await db.create_project(
        body.idea_prompt.strip(), body.topic, body.model,
        body.title.strip() or body.idea_prompt.strip()[:60], time.time(), mode=mode)
    ws = WORKSPACE_DIR / project["id"]
    ws.mkdir(parents=True, exist_ok=True)
    await db.update_project(project["id"], time.time(), workspace_dir=str(ws))
    return await db.get_project(project["id"])


@app.get("/api/projects")
async def get_projects():
    return {"projects": await db.list_projects()}


@app.get("/api/projects/{pid}")
async def get_project(pid: str):
    project = await db.get_project(pid)
    if not project:
        raise HTTPException(404, "not found")
    project["running"] = orchestrator.is_running(pid)
    return project


@app.delete("/api/projects/{pid}")
async def delete_project(pid: str):
    await db.delete_project(pid)
    return {"ok": True}


class RunBody(BaseModel):
    n_rqs: int = 3
    start_from: str | None = None
    mode: str | None = None


@app.post("/api/projects/{pid}/run")
async def run_project(pid: str, body: RunBody):
    project = await db.get_project(pid)
    if not project:
        raise HTTPException(404, "not found")
    if orchestrator.is_running(pid):
        raise HTTPException(409, "pipeline already running")
    n_rqs = max(1, min(5, body.n_rqs))
    mode = body.mode or project.get("mode") or "auto"
    task = asyncio.create_task(orchestrator.run_pipeline(pid, n_rqs, body.start_from, mode))
    gates.register_task(pid, task)
    return {"ok": True, "started": True, "mode": mode}


class GateBody(BaseModel):
    action: str                       # approve|edit|regenerate|cancel|continue
    feedback: str | None = None
    research_questions: list | None = None


@app.post("/api/projects/{pid}/gate")
async def resolve_gate(pid: str, body: GateBody):
    decision = {"action": body.action}
    if body.feedback:
        decision["feedback"] = body.feedback
    if body.research_questions is not None:
        decision["research_questions"] = body.research_questions
    if not gates.resolve_gate(pid, decision):
        raise HTTPException(409, "no gate is currently waiting for this project")
    return {"ok": True}


@app.post("/api/projects/{pid}/stop")
async def stop_project(pid: str):
    killed = gates.kill_procs(pid)
    # Unblock any pending gate so the coroutine can observe the cancel.
    gates.resolve_gate(pid, {"action": "cancel"})
    task = gates.get_task(pid)
    if task and not task.done():
        task.cancel()
    await db.update_project(pid, time.time(), status="stopped", pending_action=None,
                            run_ended_at=time.time())
    await events.publish(pid, "pipeline_stopped", {"reason": "user_stop", "killed_procs": killed})
    return {"ok": True, "killed": killed}


@app.get("/api/system")
async def get_system():
    return sysinfo.system_info()


# ---------------------------------------------------------------- export
def _ws(project: dict, pid: str) -> Path:
    return Path(project["workspace_dir"] or (WORKSPACE_DIR / pid))


@app.post("/api/projects/{pid}/export")
async def export_project(pid: str):
    """Write deliverables into the repo and (if LaTeX is available) compile a PDF."""
    project = await db.get_project(pid)
    if not project:
        raise HTTPException(404, "not found")
    ws = _ws(project, pid)
    ws.mkdir(parents=True, exist_ok=True)
    written = export_mod.write_deliverables(ws, project)
    pdf = await export_mod.compile_pdf(ws)
    return {"written": written, "pdf": pdf}


@app.get("/api/projects/{pid}/download/zip")
async def download_zip(pid: str):
    project = await db.get_project(pid)
    if not project:
        raise HTTPException(404, "not found")
    ws = _ws(project, pid)
    export_mod.write_deliverables(ws, project)  # ensure latest deliverables included
    data = export_mod.zip_project(ws)
    from fastapi.responses import Response
    return Response(data, media_type="application/zip",
                    headers={"Content-Disposition": f'attachment; filename="{pid}_project.zip"'})


@app.get("/api/projects/{pid}/download/{artifact}")
async def download_artifact(pid: str, artifact: str):
    """artifact in: report.md | tables.tex | references.bib | paper.tex | paper.pdf"""
    project = await db.get_project(pid)
    if not project:
        raise HTTPException(404, "not found")
    from fastapi.responses import Response
    ws = _ws(project, pid)
    export_mod.write_deliverables(ws, project)
    mapping = {
        "report.md": ("paper/report.md", "text/markdown"),
        "tables.tex": ("paper/tables.tex", "text/plain"),
        "references.bib": ("paper/references.bib", "text/plain"),
        "paper.tex": ("paper/paper.tex", "text/plain"),
        "paper.pdf": ("paper/paper.pdf", "application/pdf"),
    }
    if artifact not in mapping:
        raise HTTPException(404, "unknown artifact")
    rel, mime = mapping[artifact]
    f = ws / rel
    if not f.exists():
        raise HTTPException(404, f"{artifact} not generated yet")
    return Response(f.read_bytes(), media_type=mime,
                    headers={"Content-Disposition": f'attachment; filename="{artifact}"'})


@app.get("/api/runtime")
async def get_runtime():
    return {"selected_device": runtime.get_device(), "gpus": sysinfo._gpu_info()}


class RuntimeBody(BaseModel):
    device: str


@app.post("/api/runtime")
async def set_runtime(body: RuntimeBody):
    runtime.set_device(body.device)
    return {"ok": True, "selected_device": runtime.get_device()}


@app.post("/api/projects/{pid}/restart-runtime")
async def restart_runtime(pid: str):
    """Colab-style 'restart runtime': delete the project's virtualenv so the next
    run recreates a clean environment (reinstalls dependencies)."""
    project = await db.get_project(pid)
    if not project:
        raise HTTPException(404, "not found")
    if orchestrator.is_running(pid):
        raise HTTPException(409, "stop the pipeline before restarting the runtime")
    workspace = Path(project["workspace_dir"] or (WORKSPACE_DIR / pid))
    venv = workspace / ".venv"
    removed = False
    if venv.exists():
        shutil.rmtree(venv, ignore_errors=True)
        removed = True
    await events.publish(pid, "log", {"stream": "system",
                          "line": f"♻ Runtime restarted{' (venv cleared)' if removed else ''}"})
    return {"ok": True, "venv_removed": removed}


@app.get("/api/projects/{pid}/events")
async def get_events(pid: str, after_id: int = 0):
    return {"events": await db.list_events(pid, after_id)}


# ------------------------------------------------------------------ SSE
@app.get("/api/projects/{pid}/stream")
async def stream(pid: str, request: Request, after_id: int = 0):
    async def gen():
        # replay history first so late subscribers catch up
        for ev in await db.list_events(pid, after_id):
            yield f"data: {json.dumps(ev, ensure_ascii=False)}\n\n"
        q = events.subscribe(pid)
        try:
            while True:
                if await request.is_disconnected():
                    break
                try:
                    ev = await asyncio.wait_for(q.get(), timeout=15)
                    yield f"data: {json.dumps(ev, ensure_ascii=False)}\n\n"
                except asyncio.TimeoutError:
                    yield ": keepalive\n\n"
        finally:
            events.unsubscribe(pid, q)

    return StreamingResponse(gen(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


# ----------------------------------------------------- repo file browser
def _project_workspace(pid: str, project: dict) -> Path:
    return Path(project["workspace_dir"] or (WORKSPACE_DIR / pid)).resolve()


@app.get("/api/projects/{pid}/files")
async def list_files(pid: str):
    project = await db.get_project(pid)
    if not project:
        raise HTTPException(404, "not found")
    root = _project_workspace(pid, project)
    if not root.exists():
        return {"tree": []}
    tree = []
    for p in sorted(root.rglob("*")):
        if any(part in (".venv", "__pycache__", ".git") for part in p.relative_to(root).parts):
            continue
        rel = p.relative_to(root).as_posix()
        tree.append({"path": rel, "dir": p.is_dir(),
                     "size": p.stat().st_size if p.is_file() else 0})
    return {"tree": tree}


@app.get("/api/projects/{pid}/file")
async def read_file(pid: str, path: str):
    project = await db.get_project(pid)
    if not project:
        raise HTTPException(404, "not found")
    root = _project_workspace(pid, project)
    target = (root / path).resolve()
    if not str(target).startswith(str(root)) or not target.is_file():
        raise HTTPException(400, "invalid path")
    if target.stat().st_size > 2_000_000:
        raise HTTPException(413, "file too large to preview")
    try:
        return {"path": path, "content": target.read_text(encoding="utf-8", errors="replace")}
    except Exception as e:
        raise HTTPException(500, f"read failed: {e}")
