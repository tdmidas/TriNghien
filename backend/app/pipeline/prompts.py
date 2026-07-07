"""Prompt templates for every pipeline stage.

Design notes (from the reference systems):
- AI-Scientist: numeric rubric on ideas, strict JSON outputs, error-as-next-prompt repair.
- HKUDS/AI-Researcher: fixed repo scaffold, "no placeholder code" rules, judge JSON.
- OpenResearcher: decompose into independent sub-queries for literature search.
"""

SYSTEM = (
    "You are an expert AI-security researcher and research mentor helping a student "
    "produce a rigorous, dataset-driven experimental paper. Be precise and honest: "
    "never invent numbers, never cite papers you are not given, and always follow the "
    "requested output format exactly."
)

REFINE_IDEA = """The student proposed this paper idea (topic area: {topic_name}):

\"\"\"{idea_prompt}\"\"\"

Topic context:
{topic_context}

Dataset context:
{dataset_context}

Generate 3 alternative framings of this idea as concrete, feasible experimental studies, then select the best one.
Each framing must be executable purely as offline experiments on a dataset (no live attacks, no complex sandbox).

Respond with ONLY a JSON object:
{{
  "candidates": [
    {{"title": "...", "angle": "one sentence on what makes this framing distinct",
      "feasibility": 1-10, "novelty": 1-10, "interestingness": 1-10}}
  ],
  "selected": {{
    "title": "concise paper title",
    "refined_idea": "4-6 sentence description of the study: goal, data, methods compared, evaluation",
    "keywords": ["...", "..."],
    "why_selected": "one sentence"
  }}
}}"""

LITERATURE_QUERIES = """Research idea: {title}
{refined_idea}

Decompose the related-work search into 3 independent arXiv search queries (no pronouns, each self-contained, each covering a distinct facet: the security problem, the ML methods, the evaluation/benchmarks).

Respond with ONLY a JSON array of 3 short query strings."""

LITERATURE_NOTES = """Research idea: {title}
{refined_idea}

Below are papers found on arXiv. Write related-work notes for the student.

{papers}

Respond with ONLY a JSON object:
{{
  "notes": "2-3 paragraphs (markdown) summarizing how prior work relates to this idea and what gap this study fills. Cite papers inline as [n] matching the numbering above. Only cite papers from the list.",
  "relevant_ids": [list of the numbers n that are actually relevant]
}}"""

RESEARCH_QUESTIONS = """Research idea: {title}
{refined_idea}

Topic context:
{topic_context}

Dataset context:
{dataset_context}

Related work notes:
{literature_notes}

Formulate exactly {n_rqs} research questions (RQs) for this paper. Each RQ is a main experimental scenario, and may contain several sub-experiments (e.g. multiple models, ablations, robustness checks). Sub-experiments across RQs should REUSE the same preprocessing so the whole study runs as one codebase — do not design {n_rqs} disconnected pipelines.

Requirements:
- Every experiment must be runnable offline on the dataset above with scikit-learn / PyTorch / transformers-class tooling on CPU (or small GPU), within ~20 minutes each.
- Metrics must be standard and computable (accuracy, precision, recall, F1, AUC, FPR, etc.).

Respond with ONLY a JSON object:
{{
  "research_questions": [
    {{
      "id": "RQ1",
      "question": "...",
      "hypothesis": "...",
      "sub_experiments": [
        {{"name": "short_snake_case_name", "description": "...", "metrics": ["f1", "auc"]}}
      ],
      "expected_table": "one sentence describing the result table for this RQ",
      "novelty": 1-10, "feasibility": 1-10
    }}
  ]
}}"""

NOVELTY_CHECK = """Assess the novelty of each research question against the related work below (be a fair but critical reviewer, like AI-Scientist's novelty check).

Research questions (JSON):
{rqs_json}

Related work found on arXiv:
{papers}

For each RQ, judge whether it is sufficiently novel/interesting for a student paper given the prior work, or whether it largely duplicates existing work.

Respond with ONLY a JSON object:
{{
  "assessments": [
    {{"id": "RQ1", "novel": true/false, "novelty_note": "one sentence: what's new, or what prior work it overlaps",
      "closest_work": "title of the most similar paper above, or 'none'"}}
  ]
}}"""

EXPERIMENT_PLAN = """Paper: {title}
{refined_idea}

Dataset context:
{dataset_context}

Research questions (JSON):
{rqs_json}

Write ONE unified implementation plan for a single small codebase that answers all RQs.

Respond with ONLY a JSON object:
{{
  "shared": {{
    "data_loading": "how data is loaded (exact HF dataset id or local ./data/ file names) and preprocessed",
    "splits": "train/test split strategy, seed",
    "dependencies": ["pandas", "scikit-learn", "..."]
  }},
  "experiments": [
    {{
      "rq_id": "RQ1",
      "script": "experiment_rq1.py",
      "runs": [
        {{"run_name": "rq1_baseline", "description": "what this run computes", "metrics": ["f1"]}}
      ]
    }}
  ],
  "smoke_test": "what SMOKE_TEST=1 mode does (e.g. subsample to 2000 rows, 1 epoch) so every script finishes in <60s"
}}"""

CODEGEN_RULES = """STRICT RULES for the generated code:
1. NO placeholder code: never use `pass`, `...`, `NotImplementedError`, `TODO`, or fake/random results. Every function must be fully implemented and the script must run end-to-end.
2. Execution contract: each experiment script accepts `--out_dir=<path>` and runs ALL of its sub-experiments in that one invocation. It MUST write results as JSON into out_dir in ONE of these forms: (a) a flat `final_info.json` = {metric: number} if there is a single model, OR (b) one `<model_name>_final_info.json` per model (each a flat {metric: number}), OR (c) a single `final_info.json` mapping model_name -> {metric: number}. Metric values must be plain numbers. Also write a `config.json` describing the setup. The runner reads every `*final_info.json` in out_dir, so use consistent metric keys across models.
3. Smoke mode: if the environment variable SMOKE_TEST=1, aggressively subsample the data / reduce epochs so the script finishes in under 60 seconds, but keep the exact same code path.
4. Only read data from the dataset described (local ./data/ files or the exact HuggingFace dataset id given). Never fabricate synthetic data as a stand-in for the real dataset.
5. Determinism: set random seeds (42) everywhere.
6. Dependencies: prefer scikit-learn ONLY (with pandas, numpy, datasets). Do NOT use fasttext, gensim, spaCy, xgboost, lightgbm, or any package that needs a C/C++ compiler to install. Avoid torch/transformers unless the experiment genuinely requires deep learning — if you do use them, they must be optional (wrap imports in try/except and skip that run gracefully if unavailable). No GPU-only packages.
7. Print a short progress line for each major step (loading, training X, evaluating X) so live logs are informative.
8. Offline analysis ONLY: no network calls except `datasets.load_dataset` for the specified dataset; no subprocess, no file writes outside out_dir and ./data cache."""

CODEGEN_FILE = """Paper: {title}

Unified plan (JSON):
{plan_json}

Dataset context:
{dataset_context}

{rules}

Files already generated in this repo:
{existing_files}

Now write the COMPLETE content of the file `{filename}`.
Purpose of this file: {file_purpose}

Respond with ONLY the file content inside a single ```{lang} code block. No commentary."""

SELF_REVIEW = """You are reviewing a generated experiment repo before execution. Check the file below against the rules.

{rules}

Plan (JSON):
{plan_json}

Dataset context:
{dataset_context}

File `{filename}`:
```python
{code}
```

Respond with ONLY a JSON object:
{{"fully_correct": true/false, "problems": ["..."], "must_fix": true/false}}
Set fully_correct=false only for real violations (placeholders, wrong dataset columns, missing final_info.json write, contract violations, network calls) — not for style."""

ADVISOR_DIAGNOSE = """You are the ADVISOR agent in a code review-and-repair loop (like a senior researcher reviewing a student's failing experiment). A generated experiment script crashed. Diagnose the ROOT CAUSE before any code is changed.

Script: `{filename}`   (SMOKE_TEST={smoke})
Exit code: {returncode}   Timed out: {timeout}

stderr tail:
```
{stderr}
```

Current code:
```python
{code}
```

Dataset context:
{dataset_context}

Respond with ONLY a JSON object:
{{
  "root_cause": "one or two sentences naming the actual cause (not just the surface error)",
  "fix_strategy": "concrete, minimal change that will fix it",
  "risk": "any dataset/column/dependency assumption to double-check",
  "confidence": 1-10
}}"""

REPAIR = """The experiment script `{filename}` crashed (or timed out) when executed.

Command: python {filename} --out_dir={out_dir}  (SMOKE_TEST={smoke})
Exit code: {returncode}   Timed out: {timeout}

stderr tail:
```
{stderr}
```

Current content of `{filename}`:
```python
{code}
```

Dataset context:
{dataset_context}

The Advisor agent diagnosed this:
{advisor}

{rules}

You are the CODING agent. Apply the Advisor's fix strategy to the root cause. If the error is a missing/renamed dataset column, re-check the dataset context above. Respond with ONLY the complete corrected content of `{filename}` in a single ```python code block."""

ANALYZE_RESULTS = """Paper: {title}

Research questions (JSON):
{rqs_json}

All experiment results (from final_info.json files — these are the ONLY real numbers):
{results_json}

For each RQ, analyze what the numbers show. Be honest about negative/inconclusive results.

Respond with ONLY a JSON object:
{{
  "per_rq": [
    {{"rq_id": "RQ1", "answer": "2-4 sentences answering the RQ using only the numbers above",
      "key_finding": "one sentence"}}
  ],
  "overall": "one paragraph of overall discussion",
  "limitations": ["...", "..."]
}}"""

REPORT = """Write the experimental report (markdown) for this student paper.

Title: {title}
Refined idea: {refined_idea}
Topic: {topic_name}
Related work notes:
{literature_notes}

Research questions (JSON):
{rqs_json}

Experiment plan summary (JSON):
{plan_json}

REAL results (the only numbers you may use):
{results_json}

Analysis (already validated):
{analysis_json}

Result tables (markdown, insert where appropriate — do not alter the numbers):
{tables_md}

Rules: every number must come from the results above; if something was not measured, say so. Cite related work as [n] only from the notes. Structure: # Title, ## Abstract, ## 1. Introduction, ## 2. Related Work, ## 3. Research Questions, ## 4. Experimental Setup (dataset, preprocessing, models, metrics, reproducibility: how to run the repo), ## 5. Results (one subsection per RQ with its table), ## 6. Discussion, ## 7. Limitations & Future Work, ## References.

Respond with ONLY the markdown document."""
