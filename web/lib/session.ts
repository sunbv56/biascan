const KEY = "biascan_session_id";
let memoryId: string | null = null;

function newId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function getSessionId(): string {
  try {
    const existing = window.sessionStorage.getItem(KEY);
    if (existing) return existing;
    const id = newId();
    window.sessionStorage.setItem(KEY, id);
    return id;
  } catch {
    memoryId ??= newId();
    return memoryId;
  }
}

export function resetSessionId(): string {
  const id = newId();
  memoryId = id;
  try {
    window.sessionStorage.setItem(KEY, id);
  } catch {}
  return id;
}
