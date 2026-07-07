"""Project export: assemble deliverables (report.md, tables.tex, references.bib,
paper.tex) into the workspace, compile a PDF if a LaTeX toolchain is present,
and zip the whole project for download.
"""
import asyncio
import io
import re
import shutil
import zipfile
from pathlib import Path

_SKIP_DIRS = {".venv", "__pycache__", ".git", "node_modules"}


def write_deliverables(workspace: Path, project: dict) -> dict:
    """Write report.md / tables.tex / references.bib / paper.tex into the workspace.
    Returns the relative paths written."""
    written = {}
    docs = workspace / "paper"
    docs.mkdir(parents=True, exist_ok=True)

    if project.get("report_md"):
        (docs / "report.md").write_text(project["report_md"], encoding="utf-8")
        written["report_md"] = "paper/report.md"
    if project.get("report_latex"):
        (docs / "tables.tex").write_text(project["report_latex"], encoding="utf-8")
        written["tables_tex"] = "paper/tables.tex"
    if project.get("bibtex"):
        (docs / "references.bib").write_text(project["bibtex"], encoding="utf-8")
        written["references_bib"] = "paper/references.bib"

    tex = build_paper_tex(project)
    (docs / "paper.tex").write_text(tex, encoding="utf-8")
    written["paper_tex"] = "paper/paper.tex"
    return written


_LATEX_SPECIALS = {"&": r"\&", "%": r"\%", "#": r"\#", "_": r"\_", "$": r"\$"}


def _escape_inline(s: str) -> str:
    return "".join(_LATEX_SPECIALS.get(c, c) for c in s)


def _md_to_latex_body(md: str) -> str:
    """Very small Markdown->LaTeX conversion for the report body.
    Handles headings, bold/italic, inline code, lists, and leaves LaTeX tables
    (already emitted as \\begin{table}) untouched."""
    lines = md.splitlines()
    out = []
    in_list = False
    in_table = False
    for ln in lines:
        if "\\begin{table}" in ln:
            in_table = True
        if in_table:
            out.append(ln)
            if "\\end{table}" in ln:
                in_table = False
            continue
        s = ln.rstrip()
        # skip the top-level title (handled by \maketitle) and the raw MD table lines
        if re.match(r"^\|.*\|$", s):
            continue
        h = re.match(r"^(#{1,6})\s+(.*)$", s)
        if h:
            if in_list:
                out.append(r"\end{itemize}")
                in_list = False
            level = len(h.group(1))
            title = _inline(h.group(2))
            cmd = {1: "section", 2: "section", 3: "subsection", 4: "subsubsection"}.get(level, "paragraph")
            if level == 1:
                continue  # title comes from metadata
            out.append(f"\\{cmd}{{{title}}}")
            continue
        li = re.match(r"^[-*]\s+(.*)$", s)
        if li:
            if not in_list:
                out.append(r"\begin{itemize}")
                in_list = True
            out.append(r"\item " + _inline(li.group(1)))
            continue
        if in_list and not s:
            out.append(r"\end{itemize}")
            in_list = False
        out.append(_inline(s))
    if in_list:
        out.append(r"\end{itemize}")
    return "\n".join(out)


def _inline(s: str) -> str:
    # protect existing latex commands minimally; escape specials then re-apply md
    s = _escape_inline(s)
    s = re.sub(r"\*\*(.+?)\*\*", r"\\textbf{\1}", s)
    s = re.sub(r"(?<!\*)\*(?!\*)(.+?)\*", r"\\emph{\1}", s)
    s = re.sub(r"`(.+?)`", r"\\texttt{\1}", s)
    # [n] citation markers left as-is
    return s


def build_paper_tex(project: dict) -> str:
    title = _escape_inline(project.get("title") or "Untitled")
    body_md = project.get("report_md") or "_(No report generated yet — run the pipeline to the end.)_"
    body = _md_to_latex_body(body_md)
    has_bib = bool(project.get("bibtex"))
    bib_block = (r"\bibliographystyle{plain}" + "\n" + r"\bibliography{references}" if has_bib else "")
    return rf"""\documentclass[10pt,twocolumn]{{article}}
\usepackage[margin=0.9in]{{geometry}}
\usepackage{{booktabs}}
\usepackage{{graphicx}}
\usepackage{{hyperref}}
\usepackage{{amsmath}}
\title{{{title}}}
\author{{AI Researcher (student draft)}}
\date{{\today}}
\begin{{document}}
\maketitle
\begin{{abstract}}
Automatically generated experimental draft. All reported numbers come from the
executed experiments; see the repository for reproduction.
\end{{abstract}}

{body}

{bib_block}
\end{{document}}
"""


async def compile_pdf(workspace: Path) -> dict:
    """Compile paper/paper.tex to PDF if a LaTeX engine is available.
    Returns {ok, pdf (rel path) or error}."""
    docs = workspace / "paper"
    tex = docs / "paper.tex"
    if not tex.exists():
        return {"ok": False, "error": "paper.tex not found"}
    engine = shutil.which("pdflatex") or shutil.which("tectonic")
    if not engine:
        return {"ok": False, "error": "no LaTeX engine (pdflatex/tectonic) installed"}

    async def run(cmd):
        proc = await asyncio.create_subprocess_exec(
            *cmd, cwd=str(docs),
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT)
        try:
            out, _ = await asyncio.wait_for(proc.communicate(), timeout=120)
        except asyncio.TimeoutError:
            proc.kill()
            return 1, b"timeout"
        return proc.returncode, out

    if engine.endswith("tectonic") or "tectonic" in engine:
        rc, out = await run([engine, "paper.tex"])
    else:
        # pdflatex twice (+ bibtex if references exist) to resolve refs
        await run(["pdflatex", "-interaction=nonstopmode", "-halt-on-error", "paper.tex"])
        if (docs / "references.bib").exists():
            await run(["bibtex", "paper"])
        await run(["pdflatex", "-interaction=nonstopmode", "-halt-on-error", "paper.tex"])
        rc, out = await run(["pdflatex", "-interaction=nonstopmode", "-halt-on-error", "paper.tex"])

    pdf = docs / "paper.pdf"
    if pdf.exists():
        return {"ok": True, "pdf": "paper/paper.pdf"}
    return {"ok": False, "error": (out or b"").decode(errors="replace")[-1500:]}


def zip_project(workspace: Path) -> bytes:
    """Zip the whole project repo (minus venv/cache) into memory."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for p in workspace.rglob("*"):
            if any(part in _SKIP_DIRS for part in p.relative_to(workspace).parts):
                continue
            if p.is_file():
                try:
                    z.write(p, p.relative_to(workspace).as_posix())
                except (OSError, ValueError):
                    pass
    buf.seek(0)
    return buf.read()
