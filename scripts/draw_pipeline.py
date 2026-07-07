"""Render the end-to-end pipeline diagram as a PNG.
Sharp-cornered blocks + straight arrows, engineering-diagram style (not rounded).
"""
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import Rectangle, FancyArrow, Polygon, FancyArrowPatch
from matplotlib.lines import Line2D

# palette
GOLD = "#bd7811"
GOLD_FILL = "#faf0cf"
GOLD_LINE = "#d9a441"
INK = "#1f2937"
GRAY = "#6b7280"
WHITE = "#ffffff"
RED = "#b02a2a"
GREEN = "#2f7d4f"

W, H = 24.0, 11.5
fig, ax = plt.subplots(figsize=(W, H), dpi=130)
ax.set_xlim(0, 100)
ax.set_ylim(0, 48)
ax.axis("off")
fig.patch.set_facecolor(WHITE)
ax.set_facecolor(WHITE)

BW, BH = 15.5, 6.4  # block size


def block(cx, cy, title, agent=None, fill=GOLD_FILL, edge=GOLD, tcol=INK, lw=1.6):
    x, y = cx - BW / 2, cy - BH / 2
    ax.add_patch(Rectangle((x, y), BW, BH, facecolor=fill, edgecolor=edge, linewidth=lw, zorder=3))
    ax.text(cx, cy + (0.9 if agent else 0), title, ha="center", va="center",
            fontsize=11.5, fontweight="bold", color=tcol, zorder=4)
    if agent:
        ax.text(cx, cy - 1.7, agent, ha="center", va="center",
                fontsize=9, color=GOLD, style="italic", zorder=4)


def arrow(x1, y1, x2, y2, color=GOLD, lw=2.0, ls="-"):
    ax.add_patch(FancyArrowPatch((x1, y1), (x2, y2), arrowstyle="-|>", mutation_scale=18,
                                 color=color, lw=lw, linestyle=ls, zorder=2,
                                 shrinkA=0, shrinkB=0))


def gate(cx, cy, label):
    # small sharp diamond = human approval gate
    d = 2.3
    pts = [(cx, cy + d), (cx + d, cy), (cx, cy - d), (cx - d, cy)]
    ax.add_patch(Polygon(pts, closed=True, facecolor="#fff", edgecolor=RED, linewidth=1.6, zorder=5))
    ax.text(cx, cy, "?", ha="center", va="center", fontsize=10, fontweight="bold", color=RED, zorder=6)
    ax.text(cx, cy - 3.6, label, ha="center", va="center", fontsize=8, color=RED, zorder=6)


# ---- title ----
ax.text(2, 46.5, "AI Researcher — End-to-End Pipeline", ha="left", va="center",
        fontsize=16, fontweight="bold", color=INK)
ax.text(2, 44.0, "AI Security paper assistant:  prompt idea  →  research questions  →  experiment code  →  run  →  result tables (Markdown + LaTeX) + report",
        ha="left", va="center", fontsize=10, color=GRAY)

# ---- Row 1 (left -> right), y = 37 ----
y1 = 37
block(11, y1, "Student Input", "prompt · topic · model")
block(31, y1, "Refine Idea", "Idea Agent")
block(51, y1, "Literature Review", "Literature Agent")
block(71, y1, "Research Questions", "Research Question Agent")
block(91, y1, "Experiment Plan", "Planner Agent")

# extra input note
ax.text(11, y1 - 4.6, "dataset: upload / HuggingFace", ha="center", va="center",
        fontsize=8, color=GRAY, zorder=4)

arrow(11 + BW / 2, y1, 31 - BW / 2, y1)
arrow(31 + BW / 2, y1, 51 - BW / 2, y1)
arrow(51 + BW / 2, y1, 71 - BW / 2, y1)
# RQ gate on the arrow between Research Questions and Experiment Plan
arrow(71 + BW / 2, y1, 81.2, y1)
gate(83.5, y1, "RQ gate (Plan/Manual)")
arrow(85.8, y1, 91 - BW / 2, y1)

# ---- connector down (right side) ----
arrow(91, y1 - BH / 2, 91, 25.5, color=GOLD)

# ---- Row 2 (right -> left), y = 16 ----
y2 = 16
block(91, y2, "Generate Code", "Coding Agent")
block(71, y2, "Validate Code", "Reviewer Agent")
block(48, y2, "Run Experiments", "Experiment Runner Agent")
block(22, y2, "Results & Report", "Analysis & Writing Agent")

ax.text(91, y2 - 4.6, "repo: data/ · src/ · experiments/", ha="center", va="center",
        fontsize=8, color=GRAY, zorder=4)
ax.text(48, y2 - 4.6, "smoke run → full run", ha="center", va="center",
        fontsize=8, color=GRAY, zorder=4)

arrow(91 - BW / 2, y2, 71 + BW / 2, y2)
# experiment gate between Validate and Run Experiments
arrow(71 - BW / 2, y2, 62.5, y2)
gate(60, y2, "Experiment gate")
arrow(57.5, y2, 48 + BW / 2, y2)
arrow(48 - BW / 2, y2, 22 + BW / 2, y2)

# ---- repair loop on Run Experiments ----
loop = FancyArrowPatch((44, y2 + BH / 2), (52, y2 + BH / 2),
                       connectionstyle="arc3,rad=1.15", arrowstyle="-|>",
                       mutation_scale=16, color=RED, lw=1.8, zorder=2)
ax.add_patch(loop)
ax.text(48, y2 + BH / 2 + 3.0, "crash / timeout  →  Advisor Agent diagnoses  →  Coding Agent fixes  →  rerun  (≤ MAX_REPAIR_ATTEMPTS)",
        ha="center", va="center", fontsize=8.5, color=RED, zorder=6)

# ---- outputs from Results & Report ----
out_x = 22
oy = y2 - BH / 2
for i, (txt, col) in enumerate([
    ("Markdown result tables", GREEN),
    ("LaTeX tables (booktabs)", GREEN),
    ("Paper-style report (.md)", GREEN),
    ("Live tracking · logs · code browser", GRAY),
]):
    ypos = 9.0 - i * 1.9
    ax.text(out_x, ypos, "•  " + txt, ha="center", va="center", fontsize=8.5, color=col, zorder=4)

# ---- legend ----
leg = [
    Line2D([0], [0], color=GOLD, lw=2.4, label="pipeline flow"),
    Line2D([0], [0], color=RED, lw=2.0, label="repair loop (Advisor ↔ Coding)"),
    Line2D([0], [0], marker="D", color="w", markerfacecolor="w", markeredgecolor=RED,
           markersize=10, label="human approval gate (Plan / Manual mode)"),
]
ax.legend(handles=leg, loc="lower right", fontsize=8.5, frameon=True, framealpha=0.95,
          edgecolor="#dddddd", bbox_to_anchor=(0.995, 0.01))

plt.tight_layout(pad=0.4)
out = r"c:\INSECLAB\AI-researcher\docs\pipeline.png"
import os
os.makedirs(os.path.dirname(out), exist_ok=True)
fig.savefig(out, facecolor=WHITE, bbox_inches="tight")
print("saved", out)
