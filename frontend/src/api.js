// Thin fetch wrapper around the backend REST API.
const J = { "Content-Type": "application/json" };

async function req(path, opts = {}) {
  const r = await fetch(`/api${path}`, opts);
  if (!r.ok) {
    let msg = `HTTP ${r.status}`;
    try {
      const b = await r.json();
      msg = b.detail || msg;
    } catch {}
    throw new Error(msg);
  }
  return r.json();
}

export const api = {
  topics: () => req("/topics"),
  models: (force = false) => req(`/models${force ? "?force=true" : ""}`),

  createProject: (body) =>
    req("/projects", { method: "POST", headers: J, body: JSON.stringify(body) }),
  listProjects: () => req("/projects"),
  getProject: (id) => req(`/projects/${id}`),
  deleteProject: (id) => req(`/projects/${id}`, { method: "DELETE" }),
  runProject: (id, body) =>
    req(`/projects/${id}/run`, { method: "POST", headers: J, body: JSON.stringify(body) }),
  gate: (id, body) =>
    req(`/projects/${id}/gate`, { method: "POST", headers: J, body: JSON.stringify(body) }),
  stop: (id) => req(`/projects/${id}/stop`, { method: "POST" }),
  system: () => req("/system"),
  getRuntime: () => req("/runtime"),
  setRuntime: (device) =>
    req("/runtime", { method: "POST", headers: J, body: JSON.stringify({ device }) }),
  restartRuntime: (id) => req(`/projects/${id}/restart-runtime`, { method: "POST" }),
  exportProject: (id) => req(`/projects/${id}/export`, { method: "POST" }),
  downloadUrl: (id, artifact) =>
    artifact === "zip" ? `/api/projects/${id}/download/zip` : `/api/projects/${id}/download/${artifact}`,
  events: (id, afterId = 0) => req(`/projects/${id}/events?after_id=${afterId}`),

  files: (id) => req(`/projects/${id}/files`),
  file: (id, path) => req(`/projects/${id}/file?path=${encodeURIComponent(path)}`),

  searchDatasets: (q) => req(`/datasets/search?q=${encodeURIComponent(q)}`),
  previewDataset: (id) => req(`/datasets/preview?id=${encodeURIComponent(id)}`),
  attachHF: (body) =>
    req("/datasets/attach_hf", { method: "POST", headers: J, body: JSON.stringify(body) }),
  uploadDataset: (projectId, file) => {
    const fd = new FormData();
    fd.append("project_id", projectId);
    fd.append("file", file);
    return req("/datasets/upload", { method: "POST", body: fd });
  },
};

// SSE subscription; returns an unsubscribe fn.
export function streamEvents(projectId, afterId, onEvent) {
  const es = new EventSource(`/api/projects/${projectId}/stream?after_id=${afterId}`);
  es.onmessage = (e) => {
    try {
      onEvent(JSON.parse(e.data));
    } catch {}
  };
  es.onerror = () => {};
  return () => es.close();
}
