import React, { useEffect, useMemo, useRef, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import hljs from "highlight.js";           // full build: 190+ languages
import { solidity } from "highlightjs-solidity";
import "highlight.js/styles/github-dark.css";

// Solidity isn't in highlight.js core — register it (for Blockchain Security .sol files).
if (!hljs.getLanguage("solidity")) hljs.registerLanguage("solidity", solidity);
import { api, streamEvents } from "../api.js";
import { Badge, Button, Card, Icon, Logo, Spinner, formatDuration, runElapsed } from "./ui.jsx";

const STAGES = [
  ["intake", "Refine Idea"],
  ["literature", "Literature Review"],
  ["verify_citations", "Verify Citations"],
  ["research_questions", "Research Questions"],
  ["plan", "Experiment Plan"],
  ["codegen", "Generate Code"],
  ["validate", "Validate Code"],
  ["execute", "Run Experiments"],
  ["report", "Results & Report"],
];

export default function Workspace({ projectId, onHome }) {
  const [project, setProject] = useState(null);
  const [events, setEvents] = useState([]);
  const [sys, setSys] = useState(null);
  const [tab, setTab] = useState("tracking"); // tracking | code | results | report
  const lastId = useRef(0);

  useEffect(() => {
    let unsub = () => {};
    api.getProject(projectId).then(setProject);
    unsub = streamEvents(projectId, 0, (ev) => {
      lastId.current = Math.max(lastId.current, ev.id || 0);
      setEvents((prev) => (prev.some((e) => e.id === ev.id) ? prev : [...prev, ev]));
      if (["pipeline_done", "pipeline_error", "stage_done", "gate", "gate_resolved", "pipeline_stopped"].includes(ev.kind)) {
        api.getProject(projectId).then(setProject);
      }
    });
    return () => unsub();
  }, [projectId]);

  // Poll system resources every 3s.
  useEffect(() => {
    let alive = true;
    const tick = () => api.system().then((s) => alive && setSys(s)).catch(() => {});
    tick();
    const t = setInterval(tick, 3000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  const [nowSec, setNowSec] = useState(Date.now() / 1000);
  const stageState = useMemo(() => computeStageState(events, project), [events, project]);
  const activeAgents = useMemo(() => computeActiveAgents(events), [events]);
  const usage = useMemo(() => computeUsage(events, project), [events, project]);
  const running = project?.status === "running";
  const waiting = project?.status === "waiting";
  const elapsed = runElapsed(project, nowSec);

  // Tick the elapsed clock every second while the run is active.
  useEffect(() => {
    if (!running && !waiting) return;
    const t = setInterval(() => setNowSec(Date.now() / 1000), 1000);
    return () => clearInterval(t);
  }, [running, waiting]);

  async function rerun(startFrom) {
    await api.runProject(projectId, {
      n_rqs: (project?.research_questions?.length) || 3, start_from: startFrom, mode: project?.mode });
    api.getProject(projectId).then(setProject);
  }

  async function stop() {
    await api.stop(projectId);
    api.getProject(projectId).then(setProject);
  }

  async function resolveGate(body) {
    await api.gate(projectId, body);
    api.getProject(projectId).then(setProject);
  }

  return (
    <div className="flex h-screen flex-col bg-neutral-50">
      {/* Top bar */}
      <header className="flex items-center justify-between border-b border-neutral-200 bg-white px-4 py-2.5">
        <div className="flex items-center gap-4">
          <button onClick={onHome}>
            <Logo />
          </button>
          <div className="hidden sm:block">
            <div className="max-w-md truncate text-sm font-semibold text-neutral-800">
              {project?.title || "…"}
            </div>
            <div className="text-[11px] text-neutral-400">
              {project?.topic} · <span className="font-mono">{project?.model}</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {project?.mode && <ModeBadge mode={project.mode} />}
          {elapsed != null && (
            <span className="flex items-center gap-1 rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-medium text-neutral-600" title="Thời gian chạy">
              ⏱ {formatDuration(elapsed)}
            </span>
          )}
          <StatusBadge status={project?.status} running={running} />
          {(running || waiting) && (
            <Button variant="danger" onClick={stop}>
              <Icon name="x" className="h-4 w-4" /> Dừng
            </Button>
          )}
          {project && !running && !waiting && (
            <Button variant="soft" onClick={() => rerun(null)}>
              <Icon name="play" className="h-4 w-4" /> Chạy lại
            </Button>
          )}
        </div>
      </header>

      {/* Resource + agents strip */}
      <ResourceBar sys={sys} agents={activeAgents} projectId={projectId} canRestart={!running && !waiting} usage={usage} />

      {/* Gate / approval panel */}
      {waiting && project?.pending_action && (
        <GatePanel action={project.pending_action} onResolve={resolveGate} />
      )}

      {/* Hallucinated-citation alert (NOT_FOUND papers from Verify Citations) */}
      <CitationAlertBanner events={events} />

      {/* Tabs */}
      <nav className="flex gap-1 border-b border-neutral-200 bg-white px-4">
        {[
          ["tracking", "Tracking", "network"],
          ["code", "Code / Repo", "folder"],
          ["results", "Kết quả", "check"],
          ["report", "Báo cáo", "file"],
        ].map(([id, label, icon]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition ${
              tab === id
                ? "border-gold-600 text-gold-700"
                : "border-transparent text-neutral-500 hover:text-neutral-800"
            }`}
          >
            <Icon name={icon} className="h-4 w-4" /> {label}
          </button>
        ))}
      </nav>

      <div className="min-h-0 flex-1 overflow-hidden">
        {tab === "tracking" && (
          <Tracking events={events} stageState={stageState} onRerunFrom={rerun} running={running} />
        )}
        {tab === "code" && <CodeBrowser projectId={projectId} events={events} />}
        {tab === "results" && <Results project={project} events={events} />}
        {tab === "report" && <Report project={project} />}
      </div>
    </div>
  );
}

// ---- derive per-stage status from the event stream ----
function computeStageState(events, project) {
  const st = {};
  STAGES.forEach(([k]) => (st[k] = "pending"));
  for (const ev of events) {
    const s = ev.data?.stage;
    if (ev.kind === "stage_start" && s) st[s] = "running";
    if (ev.kind === "stage_done" && s) st[s] = "done";
    if (ev.kind === "stage_error" && s) st[s] = "error";
  }
  if (project?.status === "failed" && project.current_stage) {
    if (st[project.current_stage] === "running") st[project.current_stage] = "error";
  }
  return st;
}

function StatusBadge({ status, running }) {
  if (running) return <span className="flex items-center gap-1.5 text-sm text-gold-700"><Spinner /> Đang chạy…</span>;
  if (status === "waiting")
    return <span className="flex items-center gap-1.5 text-sm text-amber-700">⏸ Chờ bạn duyệt</span>;
  const map = { done: ["free", "Hoàn tất"], failed: ["neutral", "Lỗi"], stopped: ["neutral", "Đã dừng"], created: ["neutral", "Chưa chạy"] };
  const [tone, label] = map[status] || map.created;
  return <Badge tone={tone}>{label}</Badge>;
}

function ModeBadge({ mode }) {
  const map = { auto: "Auto", plan: "Plan", manual: "Manual" };
  return <span className="rounded-full border border-neutral-200 bg-neutral-50 px-2 py-0.5 text-[11px] font-medium text-neutral-600">Mode: {map[mode] || mode}</span>;
}

// Active agents = agent_start events without a later matching agent_stop.
function computeActiveAgents(events) {
  const active = new Map();
  for (const ev of events) {
    if (ev.kind === "agent_start" && ev.data?.agent) active.set(ev.data.agent, ev.data);
    if (ev.kind === "agent_stop" && ev.data?.agent) active.delete(ev.data.agent);
  }
  return [...active.values()];
}

// Latest token/cost total: prefer the newest token_usage event, else project.usage.
function computeUsage(events, project) {
  let last = null;
  for (const ev of events) if (ev.kind === "token_usage" && ev.data?.total) last = ev.data.total;
  return last || project?.usage || null;
}

function ResourceBar({ sys, agents, projectId, canRestart, usage }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-neutral-200 bg-neutral-50 px-4 py-1.5 text-[11px] text-neutral-500">
      <span className="font-medium text-neutral-600">Môi trường:</span>
      {sys ? (
        <>
          <Stat label="Python" value={sys.python_version} />
          <Stat label="OS" value={sys.platform} />
          <Stat label="CPU" value={`${sys.cpu_count ?? "?"} core · ${sys.cpu_percent ?? "?"}%`} />
          <Stat
            label="RAM"
            value={sys.ram_total_mb ? `${(sys.ram_used_mb / 1000).toFixed(1)}/${(sys.ram_total_mb / 1000).toFixed(1)} GB · ${sys.ram_percent}%` : "n/a"}
          />
          {sys.process_ram_mb != null && <Stat label="Backend" value={`${(sys.process_ram_mb / 1000).toFixed(2)} GB`} />}
          <Stat
            label="GPU"
            value={
              sys.gpus && sys.gpus.length
                ? sys.gpus.map((g) => `${g.name} (${(g.vram_used_mb / 1024).toFixed(1)}/${(g.vram_total_mb / 1024).toFixed(1)} GB · ${g.util_percent}%)`).join(", ")
                : "chưa bật passthrough"
            }
          />
          {sys.sandbox && (
            <Stat
              label="Sandbox"
              value={sys.sandbox.enabled ? `bật · RAM≤${(sys.sandbox.mem_mb / 1024).toFixed(0)}GB · CPU≤${sys.sandbox.cpu_seconds}s` : "tắt (Windows dev)"}
            />
          )}
          {usage && (
            <Stat
              label="Token/Chi phí"
              value={`${(usage.total_tokens || 0).toLocaleString()} tok · $${(usage.cost || 0).toFixed(4)} · ${usage.calls || 0} call`}
            />
          )}
        </>
      ) : (
        <span>đang tải…</span>
      )}
      <RuntimeControl sys={sys} projectId={projectId} canRestart={canRestart} />
      <span className="ml-auto flex items-center gap-2">
        <span className="font-medium text-neutral-600">Agent đang chạy:</span>
        {agents.length ? (
          agents.map((a) => (
            <span key={a.agent} className="inline-flex items-center gap-1 rounded-full bg-gold-100 px-2 py-0.5 text-[11px] font-medium text-gold-700">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-gold-600" /> {a.agent}
            </span>
          ))
        ) : (
          <span className="text-neutral-400">— (nhàn rỗi)</span>
        )}
      </span>
    </div>
  );
}

function RuntimeControl({ sys, projectId, canRestart }) {
  const [device, setDevice] = useState("auto");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [check, setCheck] = useState(null); // {ok, text} transient GPU-check toast
  const gpus = sys?.gpus || [];

  useEffect(() => {
    api.getRuntime().then((r) => setDevice(r.selected_device || "auto")).catch(() => {});
  }, []);

  async function change(d) {
    const prev = device;
    setDevice(d);
    await api.setRuntime(d).catch(() => {});
    // When switching toward GPU, verify the GPU is actually visible & responsive.
    const wantsGpu = d === "auto" ? gpus.length > 0 : d !== "cpu";
    if (wantsGpu && (prev === "cpu" || prev === "auto" || prev !== d)) {
      try {
        const s = await api.system();
        const list = s.gpus || [];
        if (list.length === 0) {
          setCheck({ ok: false, text: "⚠ Không thấy GPU — cần chạy với docker-compose.gpu.yml (passthrough)" });
        } else {
          const idx = d === "auto" ? 0 : Number(d);
          const g = list[idx] || list[0];
          setCheck({ ok: true, text: `✓ GPU hoạt động: ${g.name} · VRAM ${(g.vram_used_mb / 1024).toFixed(1)}/${(g.vram_total_mb / 1024).toFixed(1)} GB` });
        }
      } catch {
        setCheck({ ok: false, text: "⚠ Không kiểm tra được GPU" });
      }
    } else if (d === "cpu") {
      setCheck({ ok: true, text: "Đã chuyển sang CPU (ẩn GPU khỏi thực nghiệm)" });
    }
    setTimeout(() => setCheck(null), 4500);
  }
  async function restart() {
    setBusy(true);
    setMsg("");
    try {
      const r = await api.restartRuntime(projectId);
      setMsg(r.venv_removed ? "đã xoá venv" : "đã reset");
      setTimeout(() => setMsg(""), 2500);
    } catch (e) {
      setMsg(String(e.message));
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="flex items-center gap-1.5">
      <span className="text-neutral-400">Runtime:</span>
      <select
        value={device}
        onChange={(e) => change(e.target.value)}
        className="rounded border border-neutral-300 bg-white px-1.5 py-0.5 text-[11px] outline-none"
        title="Thiết bị chạy thực nghiệm (CUDA_VISIBLE_DEVICES)"
      >
        <option value="auto">Auto</option>
        <option value="cpu">CPU only</option>
        {gpus.map((g, i) => (
          <option key={i} value={String(i)}>GPU {i}: {g.name}</option>
        ))}
        {gpus.length === 0 && <option value="0" disabled>GPU (chưa passthrough)</option>}
      </select>
      <button
        onClick={restart}
        disabled={busy || !canRestart}
        title={canRestart ? "Xoá venv & tạo lại môi trường (giống Restart runtime của Colab)" : "Dừng pipeline trước khi restart runtime"}
        className="rounded border border-neutral-300 bg-white px-1.5 py-0.5 text-[11px] text-neutral-600 hover:bg-neutral-100 disabled:opacity-40"
      >
        ♻ Restart runtime
      </button>
      {msg && <span className="text-emerald-600">{msg}</span>}
      {check && (
        <span className={`rounded px-1.5 py-0.5 ${check.ok ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
          {check.text}
        </span>
      )}
    </span>
  );
}

function Stat({ label, value }) {
  return (
    <span>
      <span className="text-neutral-400">{label}:</span> <span className="font-medium text-neutral-600">{value}</span>
    </span>
  );
}

function GatePanel({ action, onResolve }) {
  const [feedback, setFeedback] = useState("");
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState("");

  const type = action.type;

  if (type === "rqs") {
    const rqs = action.research_questions || [];
    return (
      <div className="border-b-2 border-gold-300 bg-gold-50 px-4 py-3">
        <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-gold-800">
          ⏸ {action.message || "Duyệt Research Questions"}
        </div>
        {!editing ? (
          <>
            <div className="max-h-52 space-y-2 overflow-y-auto">
              {rqs.map((rq, i) => (
                <div key={i} className="rounded-lg border border-gold-200 bg-white p-2 text-sm">
                  <div className="font-medium text-neutral-800">{rq.id}: {rq.question}</div>
                  {rq.hypothesis && <div className="text-[12px] text-neutral-500">Giả thuyết: {rq.hypothesis}</div>}
                  {rq.sub_experiments && (
                    <div className="text-[11px] text-neutral-400">
                      {rq.sub_experiments.length} thực nghiệm con: {rq.sub_experiments.map((s) => s.name).join(", ")}
                    </div>
                  )}
                  {rq.novelty_check && (
                    <div className={`mt-1 text-[11px] ${rq.novelty_check.novel ? "text-emerald-600" : "text-amber-600"}`}>
                      {rq.novelty_check.novel ? "✓ Novel" : "⚠ Có thể trùng"}: {rq.novelty_check.note}
                      {rq.novelty_check.closest_work && rq.novelty_check.closest_work !== "none" && (
                        <span className="text-neutral-400"> · gần nhất: {rq.novelty_check.closest_work}</span>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button onClick={() => onResolve({ action: "approve" })}>
                <Icon name="check" className="h-4 w-4" /> Đồng ý
              </Button>
              <div className="flex items-center gap-1">
                <input
                  value={feedback}
                  onChange={(e) => setFeedback(e.target.value)}
                  placeholder="góp ý để LLM sinh RQ khác…"
                  className="w-64 rounded-lg border border-gold-200 px-2 py-1.5 text-sm outline-none"
                />
                <Button variant="soft" onClick={() => onResolve({ action: "regenerate", feedback })}>
                  LLM sinh lại
                </Button>
              </div>
              <Button variant="soft" onClick={() => { setEditing(true); setEditText(JSON.stringify(rqs, null, 2)); }}>
                Tự nhập RQ
              </Button>
              <Button variant="danger" onClick={() => onResolve({ action: "cancel" })}>Huỷ</Button>
            </div>
          </>
        ) : (
          <>
            <textarea
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              rows={10}
              className="w-full rounded-lg border border-gold-200 p-2 font-mono text-[12px] outline-none"
            />
            <div className="mt-2 flex gap-2">
              <Button
                onClick={() => {
                  try {
                    const rq = JSON.parse(editText);
                    onResolve({ action: "edit", research_questions: rq });
                  } catch {
                    alert("JSON không hợp lệ");
                  }
                }}
              >
                Dùng RQ này
              </Button>
              <Button variant="ghost" onClick={() => setEditing(false)}>Quay lại</Button>
            </div>
          </>
        )}
      </div>
    );
  }

  if (type === "experiments") {
    return (
      <div className="border-b-2 border-gold-300 bg-gold-50 px-4 py-3">
        <div className="mb-1 text-sm font-semibold text-gold-800">⏸ {action.message || "Xác nhận chạy thực nghiệm?"}</div>
        <div className="mb-2 text-[12px] text-neutral-500">
          {(action.rqs || []).length} RQ · {(action.plan?.experiments || []).length} experiment script sẽ được chạy (smoke → full, có vòng tự sửa lỗi).
        </div>
        <div className="flex gap-2">
          <Button onClick={() => onResolve({ action: "approve" })}>
            <Icon name="play" className="h-4 w-4" /> Chạy thực nghiệm
          </Button>
          <Button variant="danger" onClick={() => onResolve({ action: "cancel" })}>Huỷ</Button>
        </div>
      </div>
    );
  }

  // stage_advance
  return (
    <div className="border-b-2 border-gold-300 bg-gold-50 px-4 py-3">
      <div className="mb-2 text-sm font-semibold text-gold-800">⏸ {action.message || `Chạy bước: ${action.label}?`}</div>
      <div className="flex gap-2">
        <Button onClick={() => onResolve({ action: "continue" })}>
          <Icon name="check" className="h-4 w-4" /> Tiếp tục
        </Button>
        <Button variant="danger" onClick={() => onResolve({ action: "cancel" })}>Dừng</Button>
      </div>
    </div>
  );
}

/* ====================== CITATION ALERT (NOT_FOUND) ====================== */
// Prominent red banner listing papers the Verify Citations stage flagged as
// likely hallucinated. Derived from the latest citation_alert event; a fresh
// verify run (stage_start) supersedes older alerts. Dismissible per alert.
function CitationAlertBanner({ events }) {
  const [dismissedId, setDismissedId] = useState(0);
  const alert = useMemo(() => {
    let latest = null;
    for (const ev of events) {
      if (ev.kind === "citation_alert") latest = ev;
      // a re-run of the stage invalidates the previous alert
      if (ev.kind === "stage_start" && ev.data?.stage === "verify_citations" && latest) latest = null;
    }
    return latest;
  }, [events]);
  if (!alert || alert.id === dismissedId) return null;
  const papers = alert.data?.papers || [];
  return (
    <div className="border-b-2 border-red-300 bg-red-50 px-4 py-3">
      <div className="mb-1 flex items-center justify-between">
        <div className="text-sm font-semibold text-red-700">
          ⚠ {alert.data?.count || papers.length} trích dẫn nghi là ảo giác (NOT_FOUND) — kiểm tra trước khi dùng trong paper
        </div>
        <button onClick={() => setDismissedId(alert.id)}
                className="text-xs text-red-400 hover:text-red-700">đóng</button>
      </div>
      <ul className="space-y-1">
        {papers.map((p) => (
          <li key={p.bib_key} className="text-xs text-red-800">
            <span className="font-mono font-semibold">[{p.bib_key}]</span> {p.title}
            {p.explanation && <span className="text-red-600"> — {p.explanation}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ============================== TRACKING ============================== */
function Tracking({ events, stageState, onRerunFrom, running }) {
  return (
    <div className="grid h-full grid-cols-1 gap-0 lg:grid-cols-[340px_1fr]">
      {/* Timeline */}
      <div className="overflow-y-auto border-r border-neutral-200 bg-white p-4">
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-neutral-400">Tiến trình</h3>
        <ol className="relative space-y-1">
          {STAGES.map(([key, label], i) => {
            const s = stageState[key];
            return (
              <li key={key} className="flex items-start gap-3">
                <div className="flex flex-col items-center">
                  <StageDot state={s} />
                  {i < STAGES.length - 1 && <div className="my-0.5 h-6 w-px bg-neutral-200" />}
                </div>
                <div className="pt-0.5">
                  <div
                    className={`text-sm font-medium ${
                      s === "done"
                        ? "text-neutral-800"
                        : s === "running"
                        ? "text-gold-700"
                        : s === "error"
                        ? "text-red-600"
                        : "text-neutral-400"
                    }`}
                  >
                    {label}
                  </div>
                  {!running && (s === "done" || s === "error") && (
                    <button
                      onClick={() => onRerunFrom(key)}
                      className="text-[11px] text-neutral-400 hover:text-gold-600"
                    >
                      chạy lại từ đây
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      </div>

      {/* Live logs */}
      <LogConsole events={events} />
    </div>
  );
}

function StageDot({ state }) {
  if (state === "done")
    return (
      <span className="grid h-6 w-6 place-items-center rounded-full bg-gold-600 text-white">
        <Icon name="check" className="h-3.5 w-3.5" />
      </span>
    );
  if (state === "running")
    return <span className="h-6 w-6 rounded-full border-2 border-gold-500 bg-gold-50 animate-pulse-ring" />;
  if (state === "error")
    return (
      <span className="grid h-6 w-6 place-items-center rounded-full bg-red-500 text-white">
        <Icon name="x" className="h-3.5 w-3.5" />
      </span>
    );
  return <span className="h-6 w-6 rounded-full border-2 border-neutral-200 bg-white" />;
}

function LogConsole({ events }) {
  const ref = useRef();
  const [filter, setFilter] = useState("");
  const logs = events.filter((e) => ["log", "stage_start", "stage_done", "stage_update", "run_progress", "file_written", "pipeline_error", "pipeline_done", "agent_start", "agent_stop", "gate", "gate_resolved", "pipeline_stopped", "token_usage", "citation_alert"].includes(e.kind));
  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight });
  }, [logs.length]);

  return (
    <div className="flex min-h-0 flex-col bg-neutral-900">
      <div className="flex items-center justify-between border-b border-neutral-700 px-3 py-1.5">
        <span className="text-xs font-medium text-neutral-300">Live log</span>
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="lọc…"
          className="rounded bg-neutral-800 px-2 py-0.5 text-xs text-neutral-200 outline-none placeholder:text-neutral-500"
        />
      </div>
      <div ref={ref} className="min-h-0 flex-1 overflow-y-auto p-3 font-mono text-[12px] leading-relaxed">
        {logs
          .filter((e) => !filter || JSON.stringify(e.data).toLowerCase().includes(filter.toLowerCase()))
          .map((e) => (
            <LogLine key={e.id} ev={e} />
          ))}
        {logs.length === 0 && <div className="text-neutral-500">Chưa có log. Pipeline sẽ stream ở đây…</div>}
      </div>
    </div>
  );
}

function LogLine({ ev }) {
  const t = new Date(ev.ts * 1000).toLocaleTimeString();
  if (ev.kind === "log") {
    const stream = ev.data.stream;
    const color =
      stream === "stderr" ? "text-red-400" : stream === "system" || stream === "pip" ? "text-gold-300" : "text-neutral-300";
    return (
      <div className={color}>
        <span className="text-neutral-600">{t} </span>
        {ev.data.label && <span className="text-neutral-500">[{ev.data.label}] </span>}
        {ev.data.line}
      </div>
    );
  }
  if (ev.kind === "stage_start")
    return <div className="mt-1 text-gold-400">{t} ▶ STAGE: {ev.data.label}</div>;
  if (ev.kind === "stage_done")
    return <div className="text-emerald-400">{t} ✓ done: {ev.data.label}</div>;
  if (ev.kind === "file_written")
    return <div className="text-sky-300">{t} 📄 {ev.data.repair ? "repaired" : "wrote"} {ev.data.path}</div>;
  if (ev.kind === "run_progress")
    return (
      <div className={ev.data.ok ? "text-emerald-400" : "text-red-400"}>
        {t} {ev.data.ok ? "✓" : "✗"} run {ev.data.rq_id}/{ev.data.run} {ev.data.metrics ? JSON.stringify(ev.data.metrics) : ""}
      </div>
    );
  if (ev.kind === "agent_start")
    return <div className="text-gold-300">{t} 🤖 {ev.data.agent} bắt đầu{ev.data.role ? ` (${ev.data.role})` : ""}</div>;
  if (ev.kind === "agent_stop")
    return <div className="text-neutral-500">{t} 🤖 {ev.data.agent} xong</div>;
  if (ev.kind === "gate")
    return <div className="mt-1 text-amber-300">{t} ⏸ CHỜ DUYỆT: {ev.data.message || ev.data.type}</div>;
  if (ev.kind === "gate_resolved")
    return <div className="text-amber-200">{t} ▶ quyết định: {ev.data.decision?.action}</div>;
  if (ev.kind === "token_usage")
    return (
      <div className="text-neutral-500">
        {t} 🪙 {ev.data.stage}: +{(ev.data.call?.prompt_tokens || 0) + (ev.data.call?.completion_tokens || 0)} tok
        {" "}(tổng {(ev.data.total?.total_tokens || 0).toLocaleString()} tok · ${(ev.data.total?.cost || 0).toFixed(4)})
      </div>
    );
  if (ev.kind === "pipeline_stopped")
    return <div className="mt-1 text-red-300">{t} ⏹ ĐÃ DỪNG{ev.data.killed_procs ? ` (kill ${ev.data.killed_procs} tiến trình)` : ""}</div>;
  if (ev.kind === "pipeline_error")
    return <div className="mt-1 text-red-400">{t} ✗ PIPELINE ERROR: {ev.data.error}</div>;
  if (ev.kind === "pipeline_done")
    return <div className="mt-1 text-emerald-400">{t} ✅ PIPELINE HOÀN TẤT</div>;
  if (ev.kind === "stage_update" && ev.data.stage === "verify_citations" && ev.data.result) {
    const r = ev.data.result;
    const color = r.verdict === "VERIFIED" ? "text-emerald-400"
      : r.verdict === "NOT_FOUND" ? "text-red-400"
      : r.verdict === "MISMATCH" ? "text-amber-300" : "text-neutral-400";
    return (
      <div className={color}>
        {t} 🔎 [{ev.data.done}/{ev.data.total}] {r.bib_key}: {r.verdict}
        {r.matched_source ? ` (via ${r.matched_source})` : ""}
      </div>
    );
  }
  if (ev.kind === "citation_alert")
    return <div className="mt-1 text-red-400">{t} ⚠ CITATION ALERT: {ev.data.message}</div>;
  if (ev.kind === "stage_update" && ev.data.status)
    return <div className="text-neutral-400">{t} · {ev.data.stage}: {ev.data.status} {ev.data.file || ev.data.run || ""}</div>;
  return null;
}

/* ============================== CODE BROWSER ============================== */
// map file extension -> highlight.js language
const EXT_LANG = {
  py: "python", pyw: "python", ipynb: "json",
  js: "javascript", jsx: "javascript", mjs: "javascript", cjs: "javascript",
  ts: "typescript", tsx: "typescript",
  c: "c", h: "c", cpp: "cpp", cc: "cpp", cxx: "cpp", hpp: "cpp", hxx: "cpp",
  sol: "solidity", cs: "csharp", java: "java", go: "go", rs: "rust",
  rb: "ruby", php: "php", swift: "swift", kt: "kotlin", scala: "scala",
  css: "css", scss: "scss", less: "less", html: "xml", htm: "xml", xml: "xml", svg: "xml",
  json: "json", yaml: "yaml", yml: "yaml", toml: "ini", ini: "ini", cfg: "ini",
  sh: "bash", bash: "bash", zsh: "bash", ps1: "powershell",
  md: "markdown", markdown: "markdown", sql: "sql", r: "r", lua: "lua",
  dockerfile: "dockerfile", txt: "plaintext", log: "plaintext", csv: "plaintext", tsv: "plaintext",
  tex: "latex", bib: "latex", make: "makefile",
};

function extOf(path) {
  const base = path.split("/").pop() || "";
  if (base.toLowerCase() === "dockerfile") return "dockerfile";
  if (base.toLowerCase() === "requirements.txt") return "txt";
  const dot = base.lastIndexOf(".");
  return dot >= 0 ? base.slice(dot + 1).toLowerCase() : "";
}

function langOf(path) {
  return EXT_LANG[extOf(path)] || "plaintext";
}

// Build a nested tree from the flat [{path, dir, size}] list.
function buildTree(flat) {
  const root = { name: "", path: "", dir: true, children: {} };
  for (const node of flat) {
    const parts = node.path.split("/");
    let cur = root;
    parts.forEach((part, i) => {
      const isLast = i === parts.length - 1;
      const path = parts.slice(0, i + 1).join("/");
      if (!cur.children[part]) {
        cur.children[part] = {
          name: part, path,
          dir: isLast ? node.dir : true,
          size: isLast ? node.size : 0,
          children: {},
        };
      }
      cur = cur.children[part];
    });
  }
  const sortNode = (n) => {
    const kids = Object.values(n.children).sort((a, b) =>
      a.dir !== b.dir ? (a.dir ? -1 : 1) : a.name.localeCompare(b.name));
    kids.forEach(sortNode);
    n.sorted = kids;
    return n;
  };
  return sortNode(root);
}

function fileIconColor(path) {
  const l = langOf(path);
  return { python: "text-blue-400", javascript: "text-yellow-400", typescript: "text-blue-300",
    cpp: "text-pink-400", c: "text-sky-400", solidity: "text-purple-300", css: "text-sky-300",
    xml: "text-orange-300", json: "text-amber-300", markdown: "text-neutral-300",
    latex: "text-emerald-300" }[l] || "text-neutral-400";
}

function TreeNode({ node, depth, sel, onOpen, openDirs, toggle }) {
  if (node.dir) {
    const expanded = openDirs[node.path] ?? depth < 2; // top levels open by default
    return (
      <div>
        {node.path !== "" && (
          <button
            onClick={() => toggle(node.path, !expanded)}
            className="flex w-full items-center gap-1 rounded px-1 py-0.5 text-left text-[13px] text-neutral-700 hover:bg-gold-50"
            style={{ paddingLeft: depth * 12 + 4 }}
          >
            <span className="text-[9px] text-neutral-400">{expanded ? "▾" : "▸"}</span>
            <Icon name="folder" className="h-3.5 w-3.5 shrink-0 text-gold-500" />
            <span className="truncate font-mono">{node.name}</span>
          </button>
        )}
        {expanded &&
          node.sorted.map((c) => (
            <TreeNode key={c.path} node={c} depth={node.path === "" ? 0 : depth + 1}
                      sel={sel} onOpen={onOpen} openDirs={openDirs} toggle={toggle} />
          ))}
      </div>
    );
  }
  return (
    <button
      onClick={() => onOpen(node.path)}
      className={`flex w-full items-center gap-1.5 rounded px-1 py-0.5 text-left text-[13px] hover:bg-gold-50 ${
        sel === node.path ? "bg-gold-100 text-gold-800" : "text-neutral-700"
      }`}
      style={{ paddingLeft: depth * 12 + 16 }}
    >
      <Icon name="file" className={`h-3.5 w-3.5 shrink-0 ${fileIconColor(node.path)}`} />
      <span className="truncate font-mono">{node.name}</span>
    </button>
  );
}

function CodeBrowser({ projectId, events }) {
  const [flat, setFlat] = useState([]);
  const [sel, setSel] = useState(null);
  const [content, setContent] = useState("");
  const [openDirs, setOpenDirs] = useState({});
  const fileEventCount = events.filter((e) => e.kind === "file_written").length;

  useEffect(() => {
    api.files(projectId).then((r) => setFlat(r.tree));
  }, [projectId, fileEventCount]);

  async function open(path) {
    setSel(path);
    const r = await api.file(projectId, path);
    setContent(r.content);
  }

  const tree = useMemo(() => buildTree(flat), [flat]);
  const highlighted = useMemo(() => {
    if (!sel) return "";
    const lang = langOf(sel);
    try {
      if (lang !== "plaintext" && hljs.getLanguage(lang))
        return hljs.highlight(content, { language: lang }).value;
    } catch {}
    return hljs.highlightAuto(content).value;
  }, [sel, content]);

  const lineCount = content ? content.split("\n").length : 0;

  return (
    <div className="grid h-full grid-cols-[280px_1fr]">
      <div className="overflow-y-auto border-r border-neutral-200 bg-white p-2">
        <div className="px-2 py-1 text-xs font-semibold uppercase text-neutral-400">Repo thực nghiệm</div>
        {flat.length === 0 ? (
          <div className="p-3 text-xs text-neutral-400">Chưa có file. Code sẽ xuất hiện khi tới stage Generate Code.</div>
        ) : (
          <TreeNode node={tree} depth={0} sel={sel} onOpen={open} openDirs={openDirs}
                    toggle={(p, v) => setOpenDirs((o) => ({ ...o, [p]: v }))} />
        )}
      </div>
      <div className="flex min-h-0 flex-col bg-[#0d1117]">
        {sel ? (
          <>
            <div className="sticky top-0 flex items-center justify-between border-b border-neutral-700 bg-neutral-800 px-3 py-1.5">
              <span className="flex items-center gap-2 font-mono text-xs text-neutral-300">
                <Icon name="file" className={`h-3.5 w-3.5 ${fileIconColor(sel)}`} />
                {sel}
                <span className="rounded bg-neutral-700 px-1.5 py-0.5 text-[10px] uppercase text-neutral-300">{langOf(sel)}</span>
                <span className="text-neutral-500">{lineCount} dòng</span>
              </span>
              <CopyButton text={content} />
            </div>
            <div className="min-h-0 flex-1 overflow-auto">
              <div className="flex min-w-full font-mono text-[12.5px] leading-[1.55]">
                {/* line-number gutter (aligned by identical line-height, no wrapping) */}
                <pre className="select-none border-r border-neutral-800 px-3 py-3 text-right text-neutral-600" aria-hidden>
                  {Array.from({ length: lineCount }, (_, i) => i + 1).join("\n")}
                </pre>
                {/* highlighted code as one block so multi-line tokens stay intact */}
                <pre className="hljs !bg-transparent flex-1 overflow-x-auto px-3 py-3">
                  <code dangerouslySetInnerHTML={{ __html: highlighted }} />
                </pre>
              </div>
            </div>
          </>
        ) : (
          <div className="grid h-full place-items-center text-sm text-neutral-500">Chọn một file để xem (có tô màu cú pháp)</div>
        )}
      </div>
    </div>
  );
}

/* ============================== RESULTS ============================== */
function Results({ project, events }) {
  const [sub, setSub] = useState("md"); // md | latex
  const md = project?.report_md || "";
  const latex = project?.report_latex || "";
  // Extract just the "Result Tables" markdown section for the rendered view.
  const tablesMd = useMemo(() => {
    const idx = md.indexOf("## Result Tables");
    return idx >= 0 ? md.slice(idx) : md;
  }, [md]);

  const runEvents = events.filter((e) => e.kind === "run_progress");

  if (!latex && runEvents.length === 0)
    return (
      <div className="grid h-full place-items-center text-sm text-neutral-400">
        Chưa có kết quả. Bảng sẽ xuất hiện sau khi chạy thực nghiệm.
      </div>
    );

  return (
    <div className="h-full overflow-y-auto bg-white p-6">
      <div className="mx-auto max-w-4xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-neutral-800">Bảng kết quả thực nghiệm</h2>
          <div className="flex gap-1">
            <button
              onClick={() => setSub("md")}
              className={`rounded-md px-3 py-1 text-xs font-medium ${sub === "md" ? "bg-gold-600 text-white" : "bg-neutral-100 text-neutral-600"}`}
            >
              Markdown
            </button>
            <button
              onClick={() => setSub("latex")}
              className={`rounded-md px-3 py-1 text-xs font-medium ${sub === "latex" ? "bg-gold-600 text-white" : "bg-neutral-100 text-neutral-600"}`}
            >
              LaTeX style
            </button>
          </div>
        </div>

        {sub === "md" ? (
          <>
            <div className="mb-2 flex justify-end">
              <CopyButton text={tablesMd} label="Copy .md" />
            </div>
            <div className="prose-report max-w-none">
              <Markdown remarkPlugins={[remarkGfm]}>{tablesMd || "_Chưa có bảng._"}</Markdown>
            </div>
          </>
        ) : (
          <>
            {/* rendered like a paper (booktabs) */}
            <div className="prose-report paper-tables max-w-none">
              <Markdown remarkPlugins={[remarkGfm]}>{tablesMd || "_Chưa có bảng._"}</Markdown>
            </div>
            {/* the actual LaTeX source, for copying into the paper */}
            <div className="mt-4">
              <HlBlock code={latex || "% Chưa có bảng"} lang="latex" filename="report_tables.tex (booktabs)" />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ============================== REPORT ============================== */
function Report({ project }) {
  const [sub, setSub] = useState("rendered"); // rendered | md
  const md = project?.report_md || "";
  if (!md)
    return (
      <div className="grid h-full place-items-center text-sm text-neutral-400">
        Báo cáo sẽ xuất hiện sau khi pipeline hoàn tất stage cuối.
      </div>
    );
  return (
    <div className="h-full overflow-y-auto bg-white p-6">
      <div className="mx-auto max-w-4xl">
        <ExportBar project={project} />
        <div className="mb-4 flex items-center justify-end gap-1">
          <button
            onClick={() => setSub("rendered")}
            className={`rounded-md px-3 py-1 text-xs font-medium ${sub === "rendered" ? "bg-gold-600 text-white" : "bg-neutral-100 text-neutral-600"}`}
          >
            Đọc
          </button>
          <button
            onClick={() => setSub("md")}
            className={`rounded-md px-3 py-1 text-xs font-medium ${sub === "md" ? "bg-gold-600 text-white" : "bg-neutral-100 text-neutral-600"}`}
          >
            Markdown
          </button>
          <CopyButton text={md} label="Copy .md" />
        </div>
        {sub === "rendered" ? (
          <div className="prose-report paper-tables max-w-none">
            <Markdown remarkPlugins={[remarkGfm]}>{md}</Markdown>
          </div>
        ) : (
          <pre className="overflow-x-auto rounded-lg bg-neutral-900 p-4 font-mono text-[12.5px] text-neutral-100">
            <code>{md}</code>
          </pre>
        )}
      </div>
    </div>
  );
}

function ExportBar({ project }) {
  const [busy, setBusy] = useState(false);
  const [pdf, setPdf] = useState(null); // {ok, error}
  const id = project?.id;
  const dl = (artifact) => window.open(api.downloadUrl(id, artifact), "_blank");

  async function generate() {
    setBusy(true);
    setPdf(null);
    try {
      const r = await api.exportProject(id);
      setPdf(r.pdf);
    } catch (e) {
      setPdf({ ok: false, error: String(e.message) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mb-4 rounded-xl border border-gold-200 bg-gold-50/50 p-3">
      <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-gold-800">
        <Icon name="file" className="h-4 w-4" /> Xuất sản phẩm
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => dl("zip")} className="rounded-lg bg-gold-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-gold-700">
          ⬇ Toàn bộ project (.zip)
        </button>
        <DlBtn onClick={() => dl("report.md")}>report.md</DlBtn>
        <DlBtn onClick={() => dl("tables.tex")}>tables.tex</DlBtn>
        <DlBtn onClick={() => dl("references.bib")}>references.bib</DlBtn>
        <DlBtn onClick={() => dl("paper.tex")}>paper.tex</DlBtn>
        <span className="mx-1 h-4 w-px bg-gold-200" />
        <button onClick={generate} disabled={busy} className="rounded-lg border border-gold-300 bg-white px-3 py-1.5 text-xs font-medium text-gold-700 hover:bg-gold-100 disabled:opacity-40">
          {busy ? "Đang biên dịch…" : "⚙ Tạo PDF paper"}
        </button>
        {pdf?.ok && <DlBtn onClick={() => dl("paper.pdf")}>⬇ paper.pdf</DlBtn>}
        {pdf && !pdf.ok && (
          <span className="text-[11px] text-red-500" title={pdf.error}>PDF lỗi (xem paper.tex; cần LaTeX trong container)</span>
        )}
      </div>
    </div>
  );
}

function DlBtn({ onClick, children }) {
  return (
    <button onClick={onClick} className="rounded-lg border border-gold-200 bg-white px-2.5 py-1.5 text-xs font-medium text-neutral-700 hover:bg-gold-50">
      {children}
    </button>
  );
}

// Dark, syntax-highlighted code block with a header + copy button.
// (Does NOT use <Card>, whose bg-white would override a dark background.)
function HlBlock({ code, lang, filename }) {
  const html = useMemo(() => {
    const src = code || "";
    try {
      if (lang && hljs.getLanguage(lang)) return hljs.highlight(src, { language: lang }).value;
    } catch {}
    try {
      return hljs.highlightAuto(src).value;
    } catch {
      return src.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
    }
  }, [code, lang]);
  return (
    <div className="overflow-hidden rounded-xl border border-neutral-700 bg-[#0d1117]">
      <div className="flex items-center justify-between border-b border-neutral-700 bg-neutral-800 px-3 py-1.5">
        <span className="font-mono text-xs text-neutral-300">{filename}</span>
        <CopyButton text={code} />
      </div>
      <pre className="hljs !bg-transparent overflow-x-auto p-4 text-[12.5px] leading-relaxed">
        <code dangerouslySetInnerHTML={{ __html: html }} />
      </pre>
    </div>
  );
}

function CopyButton({ text, label = "Copy" }) {
  const [ok, setOk] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(text || "");
        setOk(true);
        setTimeout(() => setOk(false), 1200);
      }}
      className="flex items-center gap-1 rounded bg-neutral-700 px-2 py-1 text-[11px] text-neutral-200 hover:bg-neutral-600"
    >
      <Icon name={ok ? "check" : "copy"} className="h-3 w-3" /> {ok ? "Đã copy" : label}
    </button>
  );
}
