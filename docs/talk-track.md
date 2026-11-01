# Talk track (about 8 minutes)

Say first: "Everything on screen is a simulation with seeded fake people. The 7-day retention is something we saw in a demo environment; we have not verified it against product documentation, so treat it as a teaching device."

1. **The question.** "Who did what through which agent?" Show the six sources. Each has its own shape and none agrees on field names.
2. **`normal-purchase`.** Join the trace. Read the sentence aloud: human, sign-in, agent acting on their behalf, policy, gateway, tool. Point at the `session-inferred` badge on the sign-in: it carries no trace id, so the link is an inference and the screen says so.
3. **`denied-scope`.** A denied call is a complete record. No tool result follows, and that is correct, so no gap is raised.
4. **`paused-approved`.** Two humans: the one the agent acts for and the approver. The sentence names both.
5. **`two-hop-delegation`.** The nested `act` claim is the delegation chain: human, orchestrator, sub-agent. Remove an exchange in your head: the chain says two hops, the record shows one, so it would show a gap.
6. **`killed-mid-run`.** The kill switch event has a session but no trace. It attaches by session and time window, labelled inferred. Then the next call is denied.
7. **`orphaned-event`.** No traceparent, no session. It is orphaned: nothing is guessed, and a hidden zero-width character is shown as `[U+200B]`.
8. **The trap.** Ask for 30 days. The raw upstream answers zero events with no error. The audit tool clamps to 7 days and says so. "Zero" must never be read as "nothing happened".
9. **The tool list.** Three read-only tools. Try to find a write tool: there is none, because the surface exposes exactly what is implemented.
10. **Tamper.** Run the tamper demo: edit, edit-timestamp, edit-and-rehash, delete, truncate. Verify fails and names the first bad entry. Truncation needs the external head checkpoint.

Close: "To answer the question you need correlation ids on every hop, a way to see gaps, and a store you can verify."
Reset: the header Reset button, `npm run reset`, or `POST /api/reset` rebuild the seeded store and hash chain; the header button also restores the diagram box positions.
