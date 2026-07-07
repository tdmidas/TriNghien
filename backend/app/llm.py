"""OpenRouter LLM client: chat completions with retry, JSON extraction,
and a cached model catalog labelled Free / Paid."""
import asyncio
import json
import re
import time
from typing import Any

import httpx

from .config import APP_NAME, APP_URL, OPENROUTER_API_KEY, OPENROUTER_BASE_URL

_HEADERS = {
    "Authorization": f"Bearer {OPENROUTER_API_KEY}",
    "HTTP-Referer": APP_URL,
    "X-Title": APP_NAME,
    "Content-Type": "application/json",
}

# Curated shortlist shown at the top of the model picker. IDs verified against
# the live OpenRouter catalog; the /models endpoint re-verifies at runtime and
# drops any that disappear.
CURATED_MODELS = [
    "qwen/qwen3-coder:free",
    "openai/gpt-oss-120b:free",
    "meta-llama/llama-3.3-70b-instruct:free",
    "nvidia/nemotron-3-super-120b-a12b:free",
    "qwen/qwen3-next-80b-a3b-instruct:free",
    "google/gemma-4-31b-it:free",
    "anthropic/claude-sonnet-4.5",
    "anthropic/claude-opus-4.5",
    "openai/gpt-5-mini",
    "openai/gpt-5",
    "google/gemini-2.5-pro",
    "google/gemini-2.5-flash",
    "deepseek/deepseek-chat-v3.1",
    "deepseek/deepseek-r1-0528",
    "qwen/qwen3-coder",
    "moonshotai/kimi-k2",
]

_model_cache: dict[str, Any] = {"ts": 0.0, "models": []}
_price_map: dict[str, tuple] = {}   # model id -> (prompt_price, completion_price) per token
_CACHE_TTL = 600  # seconds


def get_price(model: str) -> tuple:
    return _price_map.get(model, (0.0, 0.0))


async def list_models(force: bool = False) -> list[dict]:
    """Fetch the OpenRouter catalog, normalized to what the UI needs."""
    now = time.time()
    if not force and _model_cache["models"] and now - _model_cache["ts"] < _CACHE_TTL:
        return _model_cache["models"]
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.get(f"{OPENROUTER_BASE_URL}/models", headers=_HEADERS)
        r.raise_for_status()
        data = r.json()["data"]
    curated_rank = {mid: i for i, mid in enumerate(CURATED_MODELS)}
    models = []
    for m in data:
        mid = m.get("id", "")
        if mid.startswith("~"):  # meta-aliases, not directly callable
            continue
        pricing = m.get("pricing", {})
        prompt_price = float(pricing.get("prompt") or 0)
        completion_price = float(pricing.get("completion") or 0)
        is_free = mid.endswith(":free") or (prompt_price == 0 and completion_price == 0)
        models.append({
            "id": mid,
            "name": m.get("name", mid),
            "free": is_free,
            "curated": mid in curated_rank,
            "curated_rank": curated_rank.get(mid, 10_000),
            "context_length": m.get("context_length"),
            "prompt_price": prompt_price,
            "completion_price": completion_price,
        })
    models.sort(key=lambda m: (not m["curated"], m["curated_rank"], not m["free"], m["id"]))
    _model_cache.update(ts=now, models=models)
    _price_map.clear()
    for m in models:
        _price_map[m["id"]] = (m["prompt_price"], m["completion_price"])
    return models


class LLMError(Exception):
    pass


async def chat(
    model: str,
    messages: list[dict],
    *,
    temperature: float = 0.7,
    max_tokens: int = 8192,
    retries: int = 3,
) -> str:
    """One chat completion against OpenRouter, with exponential-backoff retry."""
    payload = {
        "model": model,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
        "usage": {"include": True},   # ask OpenRouter to return token counts + cost
    }
    last_err: Exception | None = None
    for attempt in range(retries + 1):
        try:
            async with httpx.AsyncClient(timeout=300) as client:
                r = await client.post(
                    f"{OPENROUTER_BASE_URL}/chat/completions",
                    headers=_HEADERS, json=payload,
                )
            if r.status_code == 429 or r.status_code >= 500:
                raise LLMError(f"HTTP {r.status_code}: {r.text[:300]}")
            r.raise_for_status()
            body = r.json()
            if "error" in body:
                raise LLMError(str(body["error"])[:300])
            content = body["choices"][0]["message"]["content"]
            if not content or not content.strip():
                raise LLMError("empty completion")
            _record_usage(model, body.get("usage") or {})
            return content
        except (httpx.HTTPError, LLMError, KeyError, json.JSONDecodeError) as e:
            last_err = e
            if attempt < retries:
                await asyncio.sleep(2 ** attempt * 2)
    raise LLMError(f"LLM call failed after {retries + 1} attempts: {last_err}")


def _record_usage(model: str, usage_obj: dict) -> None:
    """Record token usage for the active project context and emit a live event."""
    if not usage_obj:
        return
    pt = int(usage_obj.get("prompt_tokens") or 0)
    ct = int(usage_obj.get("completion_tokens") or 0)
    # Prefer OpenRouter's reported cost; fall back to price map.
    cost = usage_obj.get("cost")
    if cost is None:
        pp, cp = get_price(model)
        cost = pt * pp + ct * cp
    from . import usage as _usage
    total = _usage.record(pt, ct, float(cost))
    ctx = _usage.current.get()
    if total and ctx and ctx.get("pid"):
        # Local import avoids a circular import at module load.
        import asyncio

        from .events import publish
        try:
            asyncio.get_running_loop().create_task(
                publish(ctx["pid"], "token_usage", {
                    "stage": ctx.get("stage"), "model": model,
                    "call": {"prompt_tokens": pt, "completion_tokens": ct, "cost": float(cost)},
                    "total": {"prompt_tokens": total["prompt_tokens"],
                              "completion_tokens": total["completion_tokens"],
                              "total_tokens": total["total_tokens"],
                              "cost": total["cost"], "calls": total["calls"],
                              "by_stage": total["by_stage"]},
                }))
        except RuntimeError:
            pass


def extract_json(text: str) -> Any:
    """Extract a JSON object/array from an LLM reply (handles ```json fences,
    leading prose, and trailing commentary)."""
    fence = re.search(r"```(?:json)?\s*(.*?)```", text, re.DOTALL)
    if fence:
        text = fence.group(1)
    text = text.strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    # fall back: first balanced {...} or [...]
    for opener, closer in (("{", "}"), ("[", "]")):
        start = text.find(opener)
        if start == -1:
            continue
        depth = 0
        in_str = False
        esc = False
        for i in range(start, len(text)):
            c = text[i]
            if esc:
                esc = False
                continue
            if c == "\\":
                esc = True
            elif c == '"' and not esc:
                in_str = not in_str
            elif not in_str:
                if c == opener:
                    depth += 1
                elif c == closer:
                    depth -= 1
                    if depth == 0:
                        try:
                            return json.loads(text[start:i + 1])
                        except json.JSONDecodeError:
                            break
    raise LLMError(f"no valid JSON found in LLM reply: {text[:200]}")


def extract_code(text: str, lang: str = "") -> str:
    """Extract the largest fenced code block from an LLM reply. Strips any
    language tag on the opening fence (```python, ```text, ``` all handled)."""
    blocks = re.findall(r"```[^\n`]*\n(.*?)```", text, re.DOTALL)
    if blocks:
        return max(blocks, key=len).strip() + "\n"
    # no fence: strip a stray leading/trailing ``` if present
    return text.strip().strip("`").strip() + "\n"
