# AI Researcher — Pipeline Design

Pipeline hỗ trợ sinh viên viết paper AI Security: từ prompt ý tưởng → research questions → code thực nghiệm → chạy → bảng kết quả (Markdown + LaTeX), theo dõi realtime trên web UI.

Thiết kế tổng hợp từ 5 repo tham khảo (đã clone trong [papers/](papers/)):

| Repo | Cơ chế được kế thừa |
|---|---|
| **SakanaAI/AI-Scientist** | Execution contract `python experiment.py --out_dir=run_i` + `final_info.json`; repair loop "error-as-next-prompt" có giới hạn (`MAX_ITERS`); rubric JSON cho idea (Interestingness/Feasibility/Novelty); timeout + truncate stderr + xoá run hỏng; anti-hallucination rules khi viết report (số liệu chỉ lấy từ log thực nghiệm) |
| **HKUDS/AI-Researcher** | Scaffold repo cố định (`data/ src/ experiments/ run.py`); quy tắc **cấm placeholder code** (`pass`/`...`/`NotImplementedError`); chiến lược 2 pha "smoke run trước, full run sau (chỉ được đổi epochs/sample size)"; Judge agent trả `{"fully_correct": bool}` để đóng vòng lặp sửa code; metaprompt pack theo từng chủ đề (TASK/DATASET/BASELINE/EVALUATION) |
| **GAIR-NLP/OpenResearcher** | Query decomposition thành sub-queries độc lập khi tìm related work; trích xuất snippet liên quan trước khi tổng hợp; self-critique → refine trước output cuối; streaming từng bước trung gian lên UI |
| **karpathy/autoresearch** | Ngân sách thời gian cố định mỗi run; log kết quả dạng bảng (`results.tsv` → ở đây là events + `final_info.json`); nguyên tắc keep/discard theo metric; "crash thì fix nhanh hoặc bỏ qua, không kẹt" |
| **HKUDS/Auto-Deep-Research** | Provider layer một chuỗi model-id (OpenRouter); retry/backoff cho completion; phân trang output dài để không tràn context; kiến trúc handoff agent dễ mở rộng |

## Các stage (hiển thị trên timeline UI)

```
[1] Intake      → refine ý tưởng theo topic đã chọn (sinh 3 framing, chọn 1 — generate-then-select)
[2] Literature  → arXiv search (query decomposition) → related-work notes + citations
[3] Dataset     → upload (CSV/JSON/JSONL) hoặc search & chọn từ HuggingFace (preview rows)
[4] RQs         → sinh N research questions (mặc định 3), mỗi RQ: hypothesis, sub-experiments,
                  metrics, rubric score (novelty/feasibility/interest)
[5] Plan        → 1 kế hoạch thực nghiệm THỐNG NHẤT: preprocessing dùng chung, các experiment
                  script per-RQ (không chạy lại 3 lần pipeline — mỗi RQ có thể nhiều experiment con)
[6] Codegen     → sinh repo hoàn chỉnh vào workspace/<project>/: 
                  data/, src/common.py, experiments/experiment_rq{k}.py, requirements.txt, README.md
                  Contract: chạy `python experiments/experiment_rqK.py --out_dir=results/rqK_runX`
                  và PHẢI ghi results/<...>/final_info.json {metric_name: value}
[7] Validate    → py_compile syntax check + LLM self-review checklist (no placeholder, đúng contract,
                  đúng cột dataset) → sửa nếu fail
[8] Execute     → mỗi experiment: SMOKE run (subset nhỏ, SMOKE_TEST=1) → nếu ok → FULL run
                  Crash/timeout → repair loop: stderr tail → LLM sửa code → chạy lại (≤ MAX_REPAIR_ATTEMPTS)
[9] Results     → gom final_info.json → bảng per-RQ: Markdown + LaTeX (booktabs)
[10] Report     → report.md kiểu paper (Abstract, RQs, Setup, Results, Discussion, Limitations)
                  + report.tex tables; luật anti-hallucination: số liệu chỉ từ final_info.json
```

Mọi stage đều publish event (`stage_start/stage_update/stage_done/stage_error/log/file_written`) vào SQLite + SSE → UI hiển thị tracking chi tiết, live logs, và cây file của repo sinh ra.

## Bổ sung so với các repo gốc (lý do)

1. **Smoke run bắt buộc trước full run** — repo gốc (AI-Scientist) chạy full 2h ngay; với sinh viên + free model, fail sớm sau 60s rẻ hơn nhiều.
2. **Topic pack cho AI Security** — như metaprompt pack của HKUDS nhưng dành riêng security, chỉ gồm chủ đề dataset-driven (không cần sandbox phức tạp): Web Security, Blockchain Security, Static Malware, Network IDS, Phishing/Spam, Adversarial ML, LLM Security (dataset-based), Password/Auth.
3. **Venv cách ly per-project + timeout + không chạy lệnh shell tùy ý** — AI-Scientist không có sandbox (README của họ tự cảnh báo); ở đây code sinh ra chỉ được chạy qua runner với contract cố định, venv riêng, wall-clock timeout. (Nâng cấp sau: Docker như HKUDS.)
4. **Resume theo stage** — trạng thái từng stage lưu DB, refresh trang không mất tiến trình; chạy lại từ stage bất kỳ.
5. **Model picker Free/Paid từ catalog OpenRouter live** — tên model luôn đúng vì lấy từ `/api/v1/models`, không hardcode.

## Kiến trúc

```
backend/  FastAPI + SQLite(aiosqlite) + SSE
  app/config.py llm.py db.py events.py topics.py datasets.py
  app/recipes.py    domain recipe registry (plugin layer)
  app/runners.py    execution-backend abstraction (local / isolated)
  app/pipeline/{prompts,stages,orchestrator,runner,tables}.py
  app/main.py (REST + SSE + file browser API)
frontend/ React + Vite + Tailwind — theme trắng chủ đạo + vàng đậm (amber)
workspace/<project_id>/  repo thực nghiệm do AI sinh (browse được trên UI)
```

## Lớp mở rộng theo domain (plugin: recipe + runner)

Lõi pipeline (idea→RQ→code→run→tables) là domain-agnostic. Chỗ phân hóa dữ dội
giữa các đề tài là **bước run**: mức cô lập, egress mạng, compute, tool ngoài, và
"chạy xong nghĩa là ra cái gì". Hai lớp trừu tượng hóa điều đó nên thêm một loại
đề tài mới = viết một *recipe* (+ có thể một runner image), không sửa lõi:

1. **`recipes.py` — domain recipe** (khai báo): mỗi topic map tới một recipe gồm
   `runner`, `network` (datasets-only / api / none), `resources` (GPU/RAM/disk),
   `external_tools`, `enabled`, `success_criteria`, `codegen_guidance`,
   `safety_note`. `domain_constraints(recipe)` được **inject vào prompt** của
   Intake/RQ/Plan/Codegen để mọi bước thiết kế nằm trong khả năng của runner.
2. **`runners.py` — execution backend** (`interface Runner`): `local` (venv+
   subprocess, luôn có) và `isolated` (container/VM cô lập mạng, **chưa provision**
   — bật bằng `ISOLATED_RUNNER=1` sau khi wire backend thật). `resolve(recipe)`
   chọn runner và **gate an toàn**: domain `enabled=False` hoặc cần runner chưa có
   → **bị từ chối ở bước Execute** (không bao giờ fallback chạy code cô-lập bằng
   local runner).

**Domain mở rộng shipped-disabled** (chọn được để lộ bề mặt mở rộng, khóa ở Execute
cho tới khi có isolated runner + phê duyệt của trường): `malware-dynamic`
(Cuckoo/YARA, egress off) và `multi-agent-pentest` (target lab Metasploitable/DVWA
trong subnet cô lập). Đây đúng với lập trường an toàn của dự án: malware/pentest
chỉ chạy trong lab cô lập mạng — hoặc không chạy.

Chiến lược: build chắc 2 lớp abstraction trên domain "dễ" (dataset + API) trước,
rồi mới cắm malware/pentest bằng cách provision một isolated runner và flip recipe
`enabled=True` — lõi pipeline không đổi.
