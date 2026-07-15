import React from "react";

// Format a duration in seconds as "45s" / "2m 34s" / "1h 05m".
export function formatDuration(secs) {
  if (secs == null || secs < 0 || !isFinite(secs)) return "";
  const s = Math.floor(secs);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, "0")}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${String(m % 60).padStart(2, "0")}m`;
}

// Elapsed run time for a project (live if running). `nowSec` lets callers tick.
export function runElapsed(project, nowSec) {
  if (!project?.run_started_at) return null;
  const active = project.status === "running" || project.status === "waiting";
  const end = active ? (nowSec ?? Date.now() / 1000) : (project.run_ended_at || project.updated_at);
  return Math.max(0, end - project.run_started_at);
}

export function Logo({ className = "" }) {
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <div className="grid h-8 w-8 place-items-center rounded-lg bg-gold-600 text-white font-bold shadow-sm">
        AI
      </div>
      <div className="leading-none">
        <div className="font-semibold text-neutral-900">AI Researcher</div>
        <div className="text-[11px] text-neutral-400">AI Security Paper Assistant</div>
      </div>
    </div>
  );
}

export function Button({ children, variant = "primary", className = "", ...p }) {
  const base =
    "inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition disabled:opacity-40 disabled:cursor-not-allowed";
  const variants = {
    primary: "bg-gold-600 text-white hover:bg-gold-700 shadow-sm",
    soft: "bg-gold-50 text-gold-700 hover:bg-gold-100 border border-gold-200",
    ghost: "text-neutral-600 hover:bg-neutral-100",
    danger: "text-red-600 hover:bg-red-50 border border-red-200",
  };
  return (
    <button className={`${base} ${variants[variant]} ${className}`} {...p}>
      {children}
    </button>
  );
}

export function Badge({ children, tone = "neutral" }) {
  const tones = {
    free: "bg-emerald-50 text-emerald-700 border-emerald-200",
    paid: "bg-gold-50 text-gold-700 border-gold-200",
    neutral: "bg-neutral-100 text-neutral-600 border-neutral-200",
  };
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

export function Card({ children, className = "" }) {
  return (
    <div className={`rounded-xl border border-neutral-200 bg-white ${className}`}>{children}</div>
  );
}

export function Spinner({ className = "" }) {
  return (
    <span
      className={`inline-block h-4 w-4 animate-spin rounded-full border-2 border-gold-200 border-t-gold-600 ${className}`}
    />
  );
}

// Minimal inline icons (stroke, currentColor)
export function Icon({ name, className = "h-4 w-4" }) {
  const paths = {
    globe: "M12 2a10 10 0 100 20 10 10 0 000-20zM2 12h20M12 2a15 15 0 010 20M12 2a15 15 0 000 20",
    link: "M10 13a5 5 0 007 0l2-2a5 5 0 00-7-7l-1 1M14 11a5 5 0 00-7 0l-2 2a5 5 0 007 7l1-1",
    bug: "M8 6a4 4 0 018 0M6 10h12M9 20a3 3 0 006 0v-6a3 3 0 00-6 0zM4 12h2M18 12h2M5 7l2 2M19 7l-2 2",
    network: "M9 3h6v4H9zM4 17h6v4H4zM14 17h6v4h-6zM12 7v4M12 11l-5 6M12 11l5 6",
    mail: "M3 5h18v14H3zM3 5l9 7 9-7",
    shield: "M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z",
    brain: "M9 3a3 3 0 00-3 3 3 3 0 00-1 5 3 3 0 001 5 3 3 0 003 3M15 3a3 3 0 013 3 3 3 0 011 5 3 3 0 01-1 5 3 3 0 01-3 3M12 3v18",
    key: "M15 7a4 4 0 11-5 4L4 17v3h3l1-1h2v-2h2l1.5-1.5A4 4 0 0015 7z",
    file: "M6 2h8l4 4v16H6zM14 2v4h4",
    folder: "M3 6h6l2 2h10v11H3z",
    play: "M6 4l14 8-14 8z",
    check: "M4 12l5 5L20 6",
    search: "M11 4a7 7 0 100 14 7 7 0 000-14zM21 21l-4-4",
    upload: "M12 16V4M6 10l6-6 6 6M4 20h16",
    copy: "M8 8h12v12H8zM4 4h12v4M4 4v12h4",
    x: "M6 6l12 12M18 6L6 18",
    trash: "M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14",
  };
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={paths[name] || paths.file} />
    </svg>
  );
}

// Standalone citation-verifier UI (paste/upload a .bib, verify, export).
// Override with VITE_VERIFIER_URL when the service runs elsewhere.
export const VERIFIER_URL = import.meta.env.VITE_VERIFIER_URL || "http://localhost:3200";
