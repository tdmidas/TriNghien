"""Deterministic result-table rendering: final_info.json runs → Markdown + LaTeX.

Numbers are rendered directly from the collected metrics; the LLM never
rewrites them (anti-hallucination rule from AI-Scientist's writeup checks).
"""
from typing import Any

_LATEX_SPECIALS = {
    "&": r"\&", "%": r"\%", "$": r"\$", "#": r"\#",
    "_": r"\_", "{": r"\{", "}": r"\}", "~": r"\textasciitilde{}", "^": r"\^{}",
}


def _tex_escape(s: str) -> str:
    return "".join(_LATEX_SPECIALS.get(c, c) for c in str(s))


def _fmt(v: Any) -> str:
    if v is None:
        return "—"
    if isinstance(v, bool):
        return str(v)
    if isinstance(v, float):
        if v != v or v in (float("inf"), float("-inf")):  # NaN / Inf
            return "—"
        return f"{v:.4f}".rstrip("0").rstrip(".") if abs(v) < 1000 else f"{v:.2f}"
    return str(v)


def _columns(runs: list[dict]) -> list[str]:
    """Union of metric keys across runs, keeping first-seen order,
    string-valued keys (identifiers like 'model') first."""
    seen: dict[str, bool] = {}
    for r in runs:
        for k, v in r.get("metrics", {}).items():
            if k not in seen:
                seen[k] = isinstance(v, str)
    ids = [k for k, is_str in seen.items() if is_str]
    nums = [k for k, is_str in seen.items() if not is_str]
    return ids + nums


def rq_table_markdown(rq_id: str, runs: list[dict]) -> str:
    if not runs:
        return f"_No completed runs for {rq_id}._"
    cols = _columns(runs)
    header = "| Run | " + " | ".join(cols) + " |"
    sep = "|" + "---|" * (len(cols) + 1)
    lines = [header, sep]
    for r in runs:
        m = r.get("metrics", {})
        lines.append("| " + r.get("run_name", "?") + " | "
                     + " | ".join(_fmt(m.get(c, "—")) for c in cols) + " |")
    return "\n".join(lines)


def rq_table_latex(rq_id: str, rq_question: str, runs: list[dict]) -> str:
    if not runs:
        return f"% No completed runs for {rq_id}"
    cols = _columns(runs)
    colspec = "l" + "c" * len(cols)
    head = "Run & " + " & ".join(_tex_escape(c) for c in cols) + r" \\"
    body = []
    for r in runs:
        m = r.get("metrics", {})
        body.append(_tex_escape(r.get("run_name", "?")) + " & "
                    + " & ".join(_tex_escape(_fmt(m.get(c, "—"))) for c in cols) + r" \\")
    caption = _tex_escape(f"Results for {rq_id}: {rq_question}")
    return "\n".join([
        r"\begin{table}[ht]",
        r"\centering",
        rf"\caption{{{caption}}}",
        rf"\label{{tab:{rq_id.lower()}}}",
        rf"\begin{{tabular}}{{{colspec}}}",
        r"\toprule",
        head,
        r"\midrule",
        *body,
        r"\bottomrule",
        r"\end{tabular}",
        r"\end{table}",
    ])


def render_all(results: dict) -> tuple[str, str]:
    """results = {"rqs": [{"rq_id", "question", "runs": [{"run_name","metrics",...}]}]}
    Returns (markdown, latex) for all RQ tables."""
    md_parts, tex_parts = [], []
    for rq in results.get("rqs", []):
        ok_runs = [r for r in rq.get("runs", []) if r.get("metrics")]
        md_parts.append(f"### {rq['rq_id']}: {rq.get('question', '')}\n\n"
                        + rq_table_markdown(rq["rq_id"], ok_runs))
        tex_parts.append(rq_table_latex(rq["rq_id"], rq.get("question", ""), ok_runs))
    tex_doc = "% Requires \\usepackage{booktabs}\n\n" + "\n\n".join(tex_parts)
    return "\n\n".join(md_parts), tex_doc
