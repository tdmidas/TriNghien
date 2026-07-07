import React, { useMemo, useState } from "react";
import { Badge, Icon, Spinner } from "./ui.jsx";

// Dropdown model selector with Free/Paid labels, search, and curated-first order.
export default function ModelPicker({ models, value, onChange, loading }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [tab, setTab] = useState("all"); // all | free | paid

  const selected = models.find((m) => m.id === value);

  const filtered = useMemo(() => {
    return models.filter((m) => {
      if (tab === "free" && !m.free) return false;
      if (tab === "paid" && m.free) return false;
      if (q && !m.id.toLowerCase().includes(q.toLowerCase())) return false;
      return true;
    });
  }, [models, q, tab]);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-2 rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm hover:border-gold-300"
      >
        <span className="flex items-center gap-2 truncate">
          {loading ? <Spinner /> : <Icon name="brain" className="h-4 w-4 text-gold-600" />}
          <span className="truncate font-medium text-neutral-800">
            {selected ? selected.id : "Chọn model reasoning…"}
          </span>
        </span>
        {selected && <Badge tone={selected.free ? "free" : "paid"}>{selected.free ? "Free" : "Paid"}</Badge>}
      </button>

      {open && (
        <div className="absolute z-30 mt-1 w-full rounded-xl border border-neutral-200 bg-white shadow-xl">
          <div className="border-b border-neutral-100 p-2">
            <div className="mb-2 flex gap-1">
              {["all", "free", "paid"].map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium capitalize ${
                    tab === t ? "bg-gold-600 text-white" : "bg-neutral-100 text-neutral-600"
                  }`}
                >
                  {t === "all" ? "Tất cả" : t}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2 rounded-md border border-neutral-200 px-2">
              <Icon name="search" className="h-3.5 w-3.5 text-neutral-400" />
              <input
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Tìm model (vd: claude, gpt-5, qwen)…"
                className="w-full py-1.5 text-sm outline-none"
              />
            </div>
          </div>
          <div className="max-h-72 overflow-y-auto p-1">
            {filtered.length === 0 && (
              <div className="p-3 text-center text-sm text-neutral-400">Không có model khớp</div>
            )}
            {filtered.slice(0, 120).map((m) => (
              <button
                key={m.id}
                onClick={() => {
                  onChange(m.id);
                  setOpen(false);
                }}
                className={`flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm hover:bg-gold-50 ${
                  m.id === value ? "bg-gold-50" : ""
                }`}
              >
                <span className="flex items-center gap-2 truncate">
                  {m.curated && <span className="text-gold-500">★</span>}
                  <span className="truncate font-mono text-[13px] text-neutral-700">{m.id}</span>
                </span>
                <Badge tone={m.free ? "free" : "paid"}>{m.free ? "Free" : "Paid"}</Badge>
              </button>
            ))}
          </div>
          <div className="border-t border-neutral-100 px-3 py-1.5 text-[11px] text-neutral-400">
            {models.length} model từ OpenRouter · ★ = đề xuất
          </div>
        </div>
      )}
    </div>
  );
}
