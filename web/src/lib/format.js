export const shortHash = (h) => (h ? String(h).slice(0, 12) : "none");
export const pretty = (v) => JSON.stringify(v, null, 2);
export const clock = (iso) => (iso ? String(iso).replace("T", " ").replace(/\.\d+Z$/, "Z") : "");
export const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
export const safe = (fn, fallback) => { try { return fn(); } catch { return fallback; } };

// Names are read from the events themselves, never from anywhere else. An id with no name in the events shows as the id.
export function nameOf(timeline, id) {
  if (!id) return null;
  for (const e of timeline || []) {
    if (e.subject === id && e.subjectName) return e.subjectName;
    if (e.actor === id && e.actorName) return e.actorName;
    if (e.clientId === id && e.clientName) return e.clientName;
  }
  return null;
}
