import React, { useEffect, useState } from "react";
import { api } from "../api.js";
import { Badge, Button, Card, Icon, Logo, Spinner, formatDuration, runElapsed } from "./ui.jsx";
import ModelPicker from "./ModelPicker.jsx";
import DatasetPicker from "./DatasetPicker.jsx";

export default function Home({ onOpen }) {
  const [topics, setTopics] = useState([]);
  const [models, setModels] = useState([]);
  const [modelsLoading, setModelsLoading] = useState(true);
  const [projects, setProjects] = useState([]);

  const [idea, setIdea] = useState("");
  const [topic, setTopic] = useState("");
  const [model, setModel] = useState("");
  const [nRqs, setNRqs] = useState(3);
  const [mode, setMode] = useState("auto");

  const [project, setProject] = useState(null); // created but not yet run
  const [dataset, setDataset] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    api.topics().then((r) => setTopics(r.topics));
    api
      .models()
      .then((r) => {
        setModels(r.models);
        setModel(r.default);
      })
      .finally(() => setModelsLoading(false));
    api.listProjects().then((r) => setProjects(r.projects));
  }, []);

  // Create the project as soon as we have idea+topic+model, so a dataset can attach to it.
  async function ensureProject() {
    if (project) return project;
    const p = await api.createProject({ idea_prompt: idea.trim(), topic, model, mode });
    setProject(p);
    return p;
  }

  async function prepareForDataset() {
    setErr("");
    if (!idea.trim()) return setErr("Nhập mô tả ý tưởng paper trước.");
    if (!topic) return setErr("Chọn một chủ đề bảo mật.");
    if (!model) return setErr("Chọn model reasoning.");
    setBusy(true);
    try {
      await ensureProject();
    } catch (e) {
      setErr(String(e.message));
    } finally {
      setBusy(false);
    }
  }

  async function launch() {
    setErr("");
    if (!idea.trim()) return setErr("Nhập mô tả ý tưởng paper trước.");
    if (!topic) return setErr("Chọn một chủ đề bảo mật.");
    if (!model) return setErr("Chọn model reasoning.");
    setBusy(true);
    try {
      const p = await ensureProject();
      await api.runProject(p.id, { n_rqs: nRqs, mode });
      onOpen(p.id);
    } catch (e) {
      setErr(String(e.message));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-full bg-gradient-to-b from-gold-50/50 to-white">
      <header className="mx-auto flex max-w-5xl items-center justify-between px-6 py-5">
        <Logo />
        <a
          href="https://openrouter.ai/models"
          target="_blank"
          rel="noreferrer"
          className="text-xs text-neutral-400 hover:text-gold-600"
        >
          Powered by OpenRouter
        </a>
      </header>

      <main className="mx-auto max-w-3xl px-6 pb-24">
        <div className="mt-6 text-center">
          <h1 className="text-3xl font-bold tracking-tight text-neutral-900">
            Viết paper <span className="text-gold-600">AI Security</span> nhanh hơn
          </h1>
          <p className="mx-auto mt-2 max-w-xl text-sm text-neutral-500">
            Mô tả ý tưởng → hệ thống sinh research questions, viết code thực nghiệm trên dataset của bạn,
            chạy và trả về bảng kết quả (Markdown + LaTeX) — theo dõi toàn bộ quá trình trực tiếp.
          </p>
        </div>

        {/* Prompt bar */}
        <Card className="mt-8 p-4 shadow-sm">
          <textarea
            value={idea}
            onChange={(e) => setIdea(e.target.value)}
            rows={4}
            placeholder="Ví dụ: So sánh hiệu quả của TF-IDF + Logistic Regression với embedding transformer trong việc phát hiện email phishing, đánh giá theo F1 và AUC trên tập dữ liệu công khai."
            className="w-full resize-none rounded-lg border border-neutral-200 p-3 text-sm outline-none focus:border-gold-400"
          />

          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {/* Topic */}
            <div>
              <label className="mb-1 block text-xs font-medium text-neutral-500">Chủ đề bảo mật</label>
              <div className="grid max-h-44 grid-cols-1 gap-1 overflow-y-auto pr-1">
                {topics.map((t) => {
                  const locked = t.recipe && t.recipe.enabled === false;
                  const isolated = t.recipe && t.recipe.runner === "isolated";
                  return (
                  <button
                    key={t.id}
                    onClick={() => setTopic(t.id)}
                    title={locked ? (t.recipe.safety_note || t.description) : t.description}
                    className={`flex items-start justify-between gap-2 rounded-lg border px-2.5 py-1.5 text-left text-sm transition ${
                      topic === t.id
                        ? "border-gold-400 bg-gold-50"
                        : "border-neutral-200 hover:border-gold-200"
                    }`}
                  >
                    <span className="flex items-start gap-2">
                      <Icon name={t.icon} className="mt-0.5 h-4 w-4 shrink-0 text-gold-600" />
                      <span className="font-medium text-neutral-800">{t.name}</span>
                    </span>
                    {(locked || isolated) && (
                      <span className="mt-0.5 shrink-0 rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] font-medium text-neutral-500">
                        🔒 lab
                      </span>
                    )}
                  </button>
                  );
                })}
              </div>
            </div>

            {/* Model + RQs */}
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-neutral-500">
                  Model reasoning (OpenRouter)
                </label>
                <ModelPicker models={models} value={model} onChange={setModel} loading={modelsLoading} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-neutral-500">
                  Số Research Questions: <span className="font-semibold text-gold-700">{nRqs}</span>
                </label>
                <input
                  type="range"
                  min={1}
                  max={5}
                  value={nRqs}
                  onChange={(e) => setNRqs(Number(e.target.value))}
                  className="w-full accent-gold-600"
                />
                <div className="text-[11px] text-neutral-400">
                  Mỗi RQ là một kịch bản thực nghiệm chính (có thể gồm nhiều thực nghiệm con).
                </div>
              </div>
            </div>
          </div>

          {/* Mode selector */}
          <div className="mt-4">
            <label className="mb-1 block text-xs font-medium text-neutral-500">Chế độ chạy</label>
            <div className="grid grid-cols-3 gap-2">
              {[
                ["auto", "Auto", "Tự động chạy toàn bộ, không dừng hỏi."],
                ["plan", "Plan", "Duyệt Research Questions & xác nhận trước khi chạy thực nghiệm."],
                ["manual", "Manual", "Hỏi bạn ở từng bước (giống Claude Code)."],
              ].map(([id, label, desc]) => (
                <button
                  key={id}
                  onClick={() => setMode(id)}
                  title={desc}
                  className={`rounded-lg border px-3 py-2 text-left transition ${
                    mode === id ? "border-gold-400 bg-gold-50" : "border-neutral-200 hover:border-gold-200"
                  }`}
                >
                  <div className="text-sm font-semibold text-neutral-800">{label}</div>
                  <div className="text-[11px] leading-tight text-neutral-400">{desc}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Dataset */}
          <div className="mt-4 rounded-lg border border-neutral-100 bg-neutral-50/60 p-3">
            <div className="mb-2 flex items-center justify-between">
              <label className="text-xs font-medium text-neutral-500">
                Dataset {project ? "" : "(gắn sau khi tạo project)"}
              </label>
              {!project && (
                <Button variant="ghost" onClick={prepareForDataset} disabled={busy} className="!py-1 text-xs">
                  {busy ? <Spinner /> : "Chuẩn bị gắn dataset"}
                </Button>
              )}
            </div>
            {project ? (
              <DatasetPicker projectId={project.id} dataset={dataset} onAttached={setDataset} />
            ) : (
              <div className="text-[11px] text-neutral-400">
                Bạn có thể upload CSV/JSON hoặc tìm dataset HuggingFace. Không bắt buộc — nếu bỏ trống,
                hệ thống sẽ tự đề xuất dataset công khai phù hợp trong kế hoạch.
              </div>
            )}
          </div>

          {err && <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{err}</div>}

          <div className="mt-4 flex items-center justify-between">
            <div className="text-[11px] text-neutral-400">
              {project ? `Project #${project.id} đã tạo` : "Chưa tạo project"}
            </div>
            <Button onClick={launch} disabled={busy}>
              {busy ? <Spinner className="border-white/40 border-t-white" /> : <Icon name="play" />}
              Bắt đầu nghiên cứu
            </Button>
          </div>
        </Card>

        {/* Recent projects */}
        {projects.length > 0 && (
          <div className="mt-10">
            <h2 className="mb-2 text-sm font-semibold text-neutral-700">Project gần đây</h2>
            <div className="space-y-2">
              {projects.slice(0, 8).map((p) => (
                <button
                  key={p.id}
                  onClick={() => onOpen(p.id)}
                  className="flex w-full items-center justify-between gap-3 rounded-lg border border-neutral-200 bg-white px-3 py-2 text-left hover:border-gold-300"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-neutral-800">{p.title}</div>
                    <div className="text-[11px] text-neutral-400">
                      {p.topic} · {p.model}
                      {runElapsed(p) != null && (
                        <span className="ml-2 text-gold-600">
                          ⏱ {formatDuration(runElapsed(p))}
                          {(p.status === "running" || p.status === "waiting") ? " (đang chạy)" : ""}
                        </span>
                      )}
                    </div>
                  </div>
                  <StatusPill status={p.status} />
                </button>
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

function StatusPill({ status }) {
  const map = {
    done: ["free", "Hoàn tất"],
    running: ["paid", "Đang chạy"],
    failed: ["neutral", "Lỗi"],
    created: ["neutral", "Mới tạo"],
  };
  const [tone, label] = map[status] || map.created;
  return <Badge tone={tone}>{label}</Badge>;
}
