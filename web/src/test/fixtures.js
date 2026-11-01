import diagram from "../../../server/diagrams/audit-flow.json";
const ev = (o) => ({ id: "ev-1", source: "gateway", type: "gateway.decision", recordedAt: "2026-10-21T12:00:00.000Z", traceId: "a".repeat(32), sessionId: null, subject: "user-x", subjectName: null, actor: null, actorName: null, clientId: null, clientName: null, tool: null, decision: null, summary: "s", flags: [], hop: "gateway", link: "trace", offsetMs: 0, ...o });
export const joinFixture = (over = {}) => ({
  found: true, traceId: "a".repeat(32), orphan: false, ambiguous: false, gaps: [],
  hops: [{ hop: "identity", present: true, eventIds: ["ev-1"] }, { hop: "policy", present: false, eventIds: [] }],
  delegation: { subject: "user-x", chain: ["agent-a", "agent-b"], text: "user-x -> agent-a -> agent-b" },
  sentence: "user-x acted through agent-a and agent-b.", facts: [{ text: "user-x signed in", evidence: ["ev-1"] }, { text: "no tool result is recorded", evidence: [], negative: true }],
  notes: [], possiblyRelated: [],
  timeline: [ev({ id: "ev-1", subject: "user-x", subjectName: "Xavier Example", tool: "t.call" }), ev({ id: "ev-2", link: "session-inferred", actor: "agent-a", actorName: "Agent A", summary: "has [U+200B] inside" })],
  ...over,
});

export const diagramFixture = () => structuredClone(diagram);
