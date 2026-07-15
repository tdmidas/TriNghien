# BibTeX Reference Verifier

Web app that verifies AI-generated `references.bib` entries against free academic APIs
(DOI.org, Crossref, OpenAlex, Semantic Scholar, arXiv, DBLP) and flags hallucinated
citations. Each entry gets a verdict — `VERIFIED` / `MISMATCH` / `NOT_FOUND` /
`UNVERIFIABLE` — with evidence links, a Vietnamese AI explanation, and (when a
near-match exists) a suggested corrected BibTeX entry reviewable via per-correction
checkboxes before export.

**Scope: localhost demo only.** The politeness rate limiters and the connector-response
cache use module-level process state, which is only valid in a single long-lived
`npm run dev` process. Deploying to Vercel/serverless is explicit future work and
additionally requires per-IP rate limiting and a daily LLM budget.

## Requirements

- Node.js **20.9+** (Next.js 16)
- This is a **standalone app**: it has its own `package.json`, `node_modules`, and
  committed `package-lock.json`. It coexists with `apps/tringhien/` (ports 3100/8100)
  and binds **port 3200**.

## Setup

```bash
cd apps/reference-verifier
npm install
cp .env.example .env.local   # then fill in CUSTOM_API_KEY (optional)
npm run dev                  # serves http://localhost:3200
```

`predev` copies the repo-root `references.bib` to `public/demo-references.bib`
(`sync:demo` uses `cp`; on Windows substitute `copy`).

### Environment (`.env.local`, never committed)

| Variable | Default | Purpose |
| --- | --- | --- |
| `CUSTOM_API_KEY` | *(empty)* | Key for the OpenAI-compatible LLM proxy. Leave blank to run without AI explanations (verdicts still work). |
| `CUSTOM_API_BASE_URL` | `https://riyckji.abc-tunnel.us/v1` | LLM proxy base URL. |
| `CUSTOM_API_MODEL` | `cx/gpt-5.5` | Model id for explanations. |
| `VERIFIER_CONTACT_EMAIL` | `demo@example.com` | Crossref/OpenAlex polite-pool contact. |

The key is read exclusively server-side (`src/lib/env.ts` → `src/lib/llm-client.ts`)
and never reaches the client bundle.

## Using the demo

1. Open `http://localhost:3200`, click **Load demo** (fills the textarea with the
   root `references.bib`, 40 entries), then **Verify**.
2. Expected results (live-baseline 2026-07-14: 38 VERIFIED / 2 NOT_FOUND): the 2
   planted fakes (`nguyen2026llmfuzzx`, `pham2025vulagent`) → red **NOT_FOUND**;
   every control (`maml`, `icarl`, `ewc`, `fomaml`, …) → green **VERIFIED**.
3. Expand a row for the evidence trail (API calls, matched record, field diffs,
   venue & URL checks) and the Vietnamese AI explanation.
4. Entries with a suggested correction have a checkbox (default **checked**).
   **Export corrected .bib** downloads `references-corrected.bib` applying only the
   checked corrections; unchecked entries keep their original fields.

For headless/API use: the backend is a single route — `POST /api/verify-entry`
with one bare ParsedEntry JSON (`{key, type, title, authors[], year, venue, doi,
arxivId, url}`) per call, returning `{verdict, evidence, explanation,
correctedEntry?}`. Parsing `.bib` text into entries happens client-side only.

## Tests

```bash
npm run test            # mocked suite — zero real network (MSW errors on any unmocked request)
```

The opt-in real-LLM smoke test is skipped unless a key is present:

```bash
CUSTOM_API_KEY=sk-... npx vitest run src/lib/llm/__tests__/real-llm-smoke.test.ts
```

Coverage thresholds apply to the pure domain core (`src/lib/verification/**`,
`src/lib/bibtex/**`).

## Optional: Scimago journal data

Journal legitimacy primarily comes from venue agreement with the canonical record and
Crossref `/journals/{issn}`. Optionally, download the Scimago Journal Rank table for
quartile display (file is gitignored; the app degrades cleanly without it):

```bash
curl -L 'https://www.scimagojr.com/journalrank.php?out=xls' -o /tmp/scimago.xlsx
soffice --headless --convert-to csv /tmp/scimago.xlsx --outdir src/data/
mv src/data/scimago.csv src/data/scimago-journal-rank.csv
```

## Out of scope (future work)

SSE streaming, shared cache/limiters for serverless (Redis), per-IP rate limiting and
LLM budget caps for a public deploy, claim verification.
