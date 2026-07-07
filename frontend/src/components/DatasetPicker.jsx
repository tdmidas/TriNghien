import React, { useRef, useState } from "react";
import { api } from "../api.js";
import { Badge, Button, Icon, Spinner } from "./ui.jsx";

// Dataset attach: HuggingFace search/preview OR local file upload.
// Requires a projectId (dataset is stored against a created project).
export default function DatasetPicker({ projectId, dataset, onAttached }) {
  const [mode, setMode] = useState("hf"); // hf | upload
  const [q, setQ] = useState("");
  const [results, setResults] = useState([]);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(null);
  const [err, setErr] = useState("");
  const fileRef = useRef();

  async function search() {
    if (!q.trim()) return;
    setBusy(true);
    setErr("");
    try {
      const r = await api.searchDatasets(q.trim());
      setResults(r.results);
    } catch (e) {
      setErr(String(e.message));
    } finally {
      setBusy(false);
    }
  }

  async function attach(id) {
    setBusy(true);
    setErr("");
    try {
      const p = await api.previewDataset(id);
      setPreview(p);
      const r = await api.attachHF({ project_id: projectId, dataset_id: id });
      onAttached(r.dataset);
    } catch (e) {
      setErr(String(e.message));
    } finally {
      setBusy(false);
    }
  }

  async function upload(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    setBusy(true);
    setErr("");
    try {
      const r = await api.uploadDataset(projectId, f);
      setPreview(r.preview);
      onAttached(r.dataset);
    } catch (e) {
      setErr(String(e.message));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="mb-3 flex gap-1">
        <button
          onClick={() => setMode("hf")}
          className={`rounded-md px-3 py-1 text-xs font-medium ${
            mode === "hf" ? "bg-gold-600 text-white" : "bg-neutral-100 text-neutral-600"
          }`}
        >
          HuggingFace
        </button>
        <button
          onClick={() => setMode("upload")}
          className={`rounded-md px-3 py-1 text-xs font-medium ${
            mode === "upload" ? "bg-gold-600 text-white" : "bg-neutral-100 text-neutral-600"
          }`}
        >
          Upload file
        </button>
      </div>

      {mode === "hf" ? (
        <div>
          <div className="flex gap-2">
            <div className="flex flex-1 items-center gap-2 rounded-lg border border-neutral-200 px-2">
              <Icon name="search" className="h-4 w-4 text-neutral-400" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && search()}
                placeholder="Tìm dataset (vd: phishing, malware, sql injection)…"
                className="w-full py-2 text-sm outline-none"
              />
            </div>
            <Button variant="soft" onClick={search} disabled={busy}>
              {busy ? <Spinner /> : "Tìm"}
            </Button>
          </div>
          <div className="mt-2 max-h-56 space-y-1 overflow-y-auto">
            {results.map((d) => (
              <div
                key={d.id}
                className="flex items-center justify-between gap-2 rounded-lg border border-neutral-100 px-3 py-2 hover:border-gold-200"
              >
                <div className="min-w-0">
                  <div className="truncate font-mono text-[13px] text-neutral-800">{d.id}</div>
                  <div className="text-[11px] text-neutral-400">
                    ↓ {d.downloads?.toLocaleString?.() || d.downloads} · ♥ {d.likes}
                  </div>
                </div>
                <Button variant="soft" onClick={() => attach(d.id)} disabled={busy}>
                  Chọn
                </Button>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div
          onClick={() => fileRef.current?.click()}
          className="cursor-pointer rounded-xl border-2 border-dashed border-gold-200 bg-gold-50/40 p-6 text-center hover:bg-gold-50"
        >
          <Icon name="upload" className="mx-auto h-6 w-6 text-gold-500" />
          <div className="mt-2 text-sm font-medium text-neutral-700">
            Nhấn để chọn file CSV / JSON / JSONL / TSV
          </div>
          <div className="text-[11px] text-neutral-400">File sẽ nằm trong ./data của repo thực nghiệm</div>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,.tsv,.json,.jsonl,.ndjson,.parquet,.txt"
            className="hidden"
            onChange={upload}
          />
        </div>
      )}

      {err && <div className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{err}</div>}

      {dataset && (
        <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm">
          <div className="flex items-center gap-2 font-medium text-emerald-800">
            <Icon name="check" className="h-4 w-4" />
            Đã gắn dataset
            <Badge tone="free">{dataset.source === "huggingface" ? "HF" : "Local"}</Badge>
          </div>
          <div className="mt-1 font-mono text-[12px] text-emerald-700">
            {dataset.source === "huggingface"
              ? dataset.id
              : (dataset.files || []).map((f) => f.name).join(", ")}
          </div>
          {dataset.features?.length > 0 && (
            <div className="mt-1 text-[11px] text-emerald-600">
              Cột: {dataset.features.slice(0, 12).join(", ")}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
