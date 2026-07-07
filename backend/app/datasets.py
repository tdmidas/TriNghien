"""Dataset layer: local uploads + HuggingFace Hub search/preview.

HF search/preview use the public REST APIs (no token needed for public
datasets). The actual download happens inside the generated experiment code
via `datasets.load_dataset(...)`, so the backend stays lightweight.
"""
import csv
import io
import json
from pathlib import Path

import httpx

HF_API = "https://huggingface.co/api"
HF_ROWS_API = "https://datasets-server.huggingface.co"


async def search_hf(query: str, limit: int = 12) -> list[dict]:
    params = {
        "search": query,
        "limit": limit,
        "sort": "downloads",
        "direction": "-1",
        "full": "false",
    }
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.get(f"{HF_API}/datasets", params=params)
        r.raise_for_status()
        items = r.json()
    return [
        {
            "id": d.get("id"),
            "downloads": d.get("downloads", 0),
            "likes": d.get("likes", 0),
            "tags": [t for t in d.get("tags", []) if ":" not in t][:6],
            "updated": d.get("lastModified"),
        }
        for d in items
    ]


async def preview_hf(dataset_id: str) -> dict:
    """First rows + split/config info from the HF datasets-server."""
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.get(f"{HF_ROWS_API}/splits", params={"dataset": dataset_id})
        if r.status_code != 200:
            return {"id": dataset_id, "error": f"datasets-server: HTTP {r.status_code}", "rows": []}
        splits = r.json().get("splits", [])
        if not splits:
            return {"id": dataset_id, "error": "no splits found", "rows": []}
        first = splits[0]
        rr = await client.get(
            f"{HF_ROWS_API}/first-rows",
            params={"dataset": dataset_id, "config": first["config"], "split": first["split"]},
        )
        if rr.status_code != 200:
            return {"id": dataset_id, "splits": splits, "error": "preview unavailable", "rows": []}
        body = rr.json()
    return {
        "id": dataset_id,
        "config": first["config"],
        "split": first["split"],
        "splits": [{"config": s["config"], "split": s["split"]} for s in splits[:10]],
        "features": [f["name"] for f in body.get("features", [])],
        "rows": [r["row"] for r in body.get("rows", [])[:8]],
    }


def preview_local(path: Path, max_rows: int = 8) -> dict:
    """Lightweight preview of an uploaded CSV/TSV/JSON/JSONL file."""
    info: dict = {"path": str(path), "name": path.name, "size": path.stat().st_size, "rows": [], "features": []}
    suffix = path.suffix.lower()
    try:
        if suffix in (".csv", ".tsv"):
            delim = "\t" if suffix == ".tsv" else ","
            with path.open("r", encoding="utf-8", errors="replace", newline="") as f:
                reader = csv.DictReader(f, delimiter=delim)
                info["features"] = reader.fieldnames or []
                for i, row in enumerate(reader):
                    if i >= max_rows:
                        break
                    info["rows"].append(row)
        elif suffix in (".jsonl", ".ndjson"):
            with path.open("r", encoding="utf-8", errors="replace") as f:
                for i, line in enumerate(f):
                    if i >= max_rows:
                        break
                    info["rows"].append(json.loads(line))
            if info["rows"]:
                info["features"] = list(info["rows"][0].keys())
        elif suffix == ".json":
            data = json.loads(path.read_text(encoding="utf-8", errors="replace"))
            if isinstance(data, list):
                info["rows"] = data[:max_rows]
                if info["rows"] and isinstance(info["rows"][0], dict):
                    info["features"] = list(info["rows"][0].keys())
            elif isinstance(data, dict):
                info["features"] = list(data.keys())
                info["rows"] = [{k: str(v)[:200] for k, v in list(data.items())[:max_rows]}]
        else:
            info["note"] = "binary or unsupported preview format; the generated code will load it directly"
    except Exception as e:  # preview must never break the pipeline
        info["error"] = f"preview failed: {e}"
    return info


def describe_for_prompt(dataset: dict | None) -> str:
    """Render dataset info as compact text for LLM prompts."""
    if not dataset:
        return "No dataset attached yet. Propose suitable public HuggingFace datasets in your plan."
    if dataset.get("source") == "huggingface":
        lines = [
            f"HuggingFace dataset: {dataset.get('id')}",
            f"Load with: datasets.load_dataset({dataset.get('id')!r}"
            + (f", {dataset.get('config')!r})" if dataset.get("config") else ")"),
            f"Columns: {', '.join(dataset.get('features') or [])}",
        ]
    else:
        lines = [
            f"Local uploaded file(s): {', '.join(f['name'] for f in dataset.get('files', []))}",
            "The files are available inside the experiment repo under ./data/ — load them with pandas.",
            f"Columns: {', '.join(dataset.get('features') or [])}",
        ]
    rows = dataset.get("rows") or []
    if rows:
        sample = json.dumps(rows[:3], ensure_ascii=False, default=str)
        lines.append(f"Sample rows: {sample[:1500]}")
    return "\n".join(lines)
