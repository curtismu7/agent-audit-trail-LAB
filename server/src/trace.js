// W3C Trace Context `traceparent`: version-traceid-parentid-flags, all lowercase hex.
// https://www.w3.org/TR/trace-context/  Strict: anything else is "no trace id" (and is flagged by the normalizer).
const TP = /^([0-9a-f]{2})-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/;
export const TRACE_ID_RE = /^[0-9a-f]{32}$/;
export const SPAN_ID_RE = /^[0-9a-f]{16}$/;
const allZero = (s) => /^0+$/.test(s);

export function parseTraceparent(value) {
  if (typeof value !== 'string') return null;
  const m = TP.exec(value);
  if (!m || m[1] === 'ff' || allZero(m[2]) || allZero(m[3])) return null;
  return { traceId: m[2], spanId: m[3], flags: m[4] };
}
export const validTraceId = (v) => typeof v === 'string' && TRACE_ID_RE.test(v) && !allZero(v);
export const validSpanId = (v) => typeof v === 'string' && SPAN_ID_RE.test(v) && !allZero(v);
export const makeTraceparent = (traceId, spanId) => `00-${traceId}-${spanId}-01`;
