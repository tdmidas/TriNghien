# AI Researcher — AI Security Paper Assistant

Trợ lý giúp sinh viên viết paper **AI Security** nhanh hơn: mô tả ý tưởng → hệ thống sinh
**research questions**, viết **code thực nghiệm** trên dataset của bạn (upload hoặc HuggingFace),
**chạy thực nghiệm**, và trả về **bảng kết quả** (Markdown + LaTeX) cùng một bản báo cáo dạng paper —
theo dõi toàn bộ quá trình trực tiếp trên web UI.

Pipeline được tổng hợp từ 5 hệ thống tham khảo (xem [PIPELINE.md](PIPELINE.md) và thư mục [papers/](papers/)):
SakanaAI/AI-Scientist, HKUDS/AI-Researcher, GAIR-NLP/OpenResearcher, karpathy/autoresearch,
HKUDS/Auto-Deep-Research.

## Kiến trúc

```
backend/    FastAPI + SQLite (aiosqlite) + SSE tracking + OpenRouter client
frontend/   React + Vite + Tailwind (theme trắng chủ đạo + vàng đậm)
workspace/  repo thực nghiệm do AI sinh cho từng project (xem/tải trên UI)
papers/     5 repo tham khảo đã clone
PIPELINE.md thiết kế pipeline chi tiết
```

Pipeline 8 stage: **Refine Idea → Literature Review → Research Questions → Experiment Plan →
Generate Code → Validate Code → Run Experiments → Results & Report**. Mỗi stage stream event
realtime lên UI (timeline, live log, cây file repo, bảng kết quả).

## Cách nhanh nhất: Docker (khuyến nghị)

Chỉ cần Docker Desktop. Không phải lo Python/Node/venv:

```powershell
cd C:\INSECLAB\AI-researcher
# đảm bảo backend/.env có OPENROUTER_API_KEY của bạn
docker compose up -d --build
```

Mở **http://localhost:5173**. Xong.

- Frontend (nginx) ở `:5173`, tự proxy `/api` sang backend (kể cả SSE tracking stream).
- Backend (FastAPI, Python 3.12 trong container) ở `:8000`.
- Repo thực nghiệm + SQLite được lưu ở Docker volume (`workspace`, `backend_data`) nên không mất khi restart.
- Xem log: `docker compose logs -f backend` · Dừng: `docker compose down` · Dừng & xoá dữ liệu: `docker compose down -v`.

> Dùng Docker tránh được luôn vụ Python 3.14 thiếu wheel và lỗi cổng trên Windows — container đã cố định Python 3.12.

### Bật GPU (NVIDIA, ví dụ RTX 5050)

Mặc định container **không thấy GPU** của máy (nên `/api/system` báo 0 GPU). Để dùng GPU:

1. Cần: driver NVIDIA mới trên Windows + Docker Desktop (WSL2) đã bật **NVIDIA Container Toolkit / GPU support**. Kiểm tra nhanh:
   ```powershell
   docker run --rm --gpus all ai-researcher-backend nvidia-smi
   ```
   Nếu lệnh này in ra tên GPU là máy bạn đã sẵn sàng.
2. Chạy stack kèm file override GPU:
   ```powershell
   docker compose -f docker-compose.yml -f docker-compose.gpu.yml up -d --build
   ```
   Lúc này thanh **Môi trường** trên UI sẽ hiện GPU + VRAM, và ô **Runtime** cho chọn `GPU 0`.

### 3 chế độ chạy (giống Claude Code)

Chọn ở màn hình đầu:
- **Auto** — tự động chạy hết, không dừng hỏi.
- **Plan** — dừng cho bạn **duyệt Research Questions** (Đồng ý / để LLM sinh lại kèm góp ý / tự nhập RQ) và **xác nhận trước khi chạy thực nghiệm**.
- **Manual** — hỏi ở **từng bước**.

### Điều khiển khi đang chạy (trong Workspace)

- **Thanh Môi trường**: Python, OS, CPU, RAM, GPU/VRAM cập nhật realtime, và danh sách **agent đang chạy**.
- **Runtime (giống Colab)**: chọn thiết bị `Auto / CPU only / GPU 0…` (đặt `CUDA_VISIBLE_DEVICES`) và nút **♻ Restart runtime** (xoá venv của project, tạo lại môi trường sạch).
- **Nút Dừng**: kill tiến trình thực nghiệm đang chạy ngay lập tức.
- **Vòng tự sửa lỗi (revisor)**: khi code thực nghiệm crash, **Advisor Agent** chẩn đoán nguyên nhân gốc → **Coding Agent** sửa → chạy lại (tối đa `MAX_REPAIR_ATTEMPTS` lần), tham khảo loop Code Agent ↔ Advisor của HKUDS/AI-Researcher.

### Các agent trong pipeline

8 agent theo stage: **Idea Agent → Literature Agent → Research Question Agent → Planner Agent → Coding Agent → Reviewer Agent → Experiment Runner Agent → Analysis & Writing Agent**, cộng **Advisor Agent** (chẩn đoán lỗi) trong vòng sửa code. Agent nào đang chạy hiển thị live trên thanh Môi trường và trong Live log.

---

## Cách 2: chạy trực tiếp (không Docker)

### Yêu cầu

- **Windows** (đã test trên Win 11). Trên máy này có nhiều bản Python — **phải dùng Python thật của Windows**
  qua `py` launcher, KHÔNG dùng bản MSYS2/mingw (`C:\msys64\...`) vì nó tạo venv hỏng.
- Python 3.11–3.13 khuyến nghị (3.14 rất mới, một số wheel ML có thể chưa có).
- Node.js 18+ và npm.
- Một **OpenRouter API key** (đặt trong `backend/.env`).

### Cài đặt & chạy

### 1. Backend

```powershell
# từ thư mục gốc dự án
./start-backend.ps1
```

Script tự tạo venv (bằng `py -3`), cài `backend/requirements.txt`, rồi chạy FastAPI trên
`http://127.0.0.1:8000`. Nếu muốn làm thủ công:

```powershell
py -3 -m venv backend\.venv
backend\.venv\Scripts\python.exe -m pip install -r backend\requirements.txt
cd backend
..\backend\.venv\Scripts\python.exe -m uvicorn app.main:app --port 8000 --reload
```

### 2. Frontend

```powershell
./start-frontend.ps1
```

Mở `http://localhost:5173`. Vite proxy `/api` sang backend `:8000`.

### 3. API key

`backend/.env` đã có sẵn key mẫu. Đổi bằng key của bạn:

```
OPENROUTER_API_KEY=sk-or-v1-...
```

## Cách dùng

1. Nhập **mô tả ý tưởng paper** vào thanh prompt.
2. Chọn **chủ đề bảo mật** (Web Security, Blockchain Security, Static Malware, Network IDS,
   Phishing/Spam, Adversarial ML, LLM Security, Password/Auth) — tất cả đều là chủ đề
   *dataset-driven*, không cần dựng sandbox phức tạp.
3. Chọn **model reasoning** từ OpenRouter (có nhãn **Free**/**Paid**, ★ = đề xuất).
4. (Tuỳ chọn) **Upload dataset** (CSV/JSON/JSONL) hoặc **tìm dataset HuggingFace**.
5. Chọn số **Research Questions** (1–5) rồi bấm **Bắt đầu nghiên cứu**.
6. Xem tiến trình ở tab **Tracking** (timeline + live log), code ở tab **Code/Repo**,
   bảng số liệu ở tab **Kết quả** (Markdown render + LaTeX booktabs), và báo cáo ở tab **Báo cáo**.

## Cơ chế đáng chú ý (an toàn & tin cậy)

- **Execution contract**: mỗi experiment chạy `python experiments/experiment_rqK.py --out_dir=...`
  và bắt buộc ghi `final_info.json` → bảng kết quả dựng **deterministic**, LLM không tự bịa số.
- **Smoke run → Full run**: chạy thử nhanh (`SMOKE_TEST=1`, <60s) trước khi chạy đầy đủ.
- **Repair loop có giới hạn**: code crash → đưa stderr cho LLM sửa → chạy lại (tối đa `MAX_REPAIR_ATTEMPTS`).
- **Resilient install**: một package hỏng/không build được (vd fasttext trên Windows) sẽ được bỏ qua,
  lỗi import còn lại do repair loop xử lý — không làm chết cả run.
- **Venv cách ly per-project + wall-clock timeout**; code sinh ra chỉ chạy qua runner theo contract.
- **Chống hallucination**: số liệu trong báo cáo chỉ lấy từ `final_info.json`; citation chỉ từ danh sách
  paper arXiv thực sự tìm được.
- **Resume theo stage**: trạng thái lưu SQLite; refresh trang không mất tiến trình, chạy lại từ stage bất kỳ.

## Cấu hình (`backend/.env`)

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `OPENROUTER_API_KEY` | — | Key OpenRouter |
| `RUN_TIMEOUT_SECONDS` | 1800 | Timeout mỗi experiment |
| `MAX_REPAIR_ATTEMPTS` | 4 | Số lần sửa code tự động tối đa |
| `WORKSPACE_DIR` | `../workspace` | Nơi chứa repo thực nghiệm |
| `DEFAULT_MODEL` | `qwen/qwen3-coder:free` | Model mặc định |

## Lưu ý về model

- Model **Free** của OpenRouter thường bị *rate-limit* mạnh (HTTP 429). Nếu pipeline lỗi ở stage đầu
  vì 429, đổi sang model khác hoặc dùng model Paid rẻ (vd `deepseek/deepseek-chat-v3.1`,
  `openai/gpt-5-mini`) cho ổn định.
- Danh sách model lấy **trực tiếp** từ `https://openrouter.ai/api/v1/models` nên tên luôn đúng,
  tránh lỗi resolve khi gọi API.
