// What the Help dialog says. Plain, and as hedged as the rest of the lab (rule 2): what was measured, what is simulated, what is UNVERIFIED.
export const HELP_SECTIONS = [
  {
    heading: "What this lab is",
    body: [
      "Agent Audit Trail answers one question: who did what through which agent? Six mock sources disagree on field names and shapes; this lab joins them into one timeline, shows the gaps, and proves the store is tamper-evident.",
      "The banner says it plainly: SIMULATION, MOCK mode. Every event is synthetic and seeded. No tenant, no network, no credentials. Tokens shown are mock-issued claims."
    ]
  },
  {
    heading: "What was measured, and what was not",
    body: [
      "The ~7-day retention figure comes from a demo environment observation. It is UNVERIFIED against product documentation — the badge next to the banner says so, and so should you.",
      "Everything else (the join logic, the hash chain, the tamper detection) is this lab's own working code, not a claim about any product."
    ]
  },
  {
    heading: "How to use the page",
    body: [
      "Tabs across the top: Story, Events, Retention, Tools, Integrity, Diagram.",
      "1. In \"Run a scenario\", pick a Scenario (try normal-purchase, denied-scope, paused-approved, two-hop-delegation, killed-mid-run, orphaned-event) and a Cast (vertical), then press Run.",
      "2. Story and Events tabs show the joined timeline and raw events. Click an event to open its Raw view and follow the trace.",
      "3. Retention: ask for 30 days and watch the raw upstream answer zero with no error while the audit tool clamps to 7 and says so. Zero is not \"nothing happened\".",
      "4. Tools: three read-only tools, no write tools — the surface exposes exactly what is implemented.",
      "5. Integrity: run the tamper demo (edit, edit-timestamp, edit-and-rehash, delete, truncate) and verify fails naming the first bad entry.",
      "6. Diagram: press Run and watch the boxes; drag to rearrange."
    ]
  },
  {
    heading: "Mode honesty",
    body: [
      "This lab is mock-only. Live mode is refused in the header mode menu: there is no live audit source to connect to. The header badge always names the mode the server answered with."
    ]
  },
  {
    heading: "The sign-in link is an inference",
    body: [
      "Sign-in events carry no trace id, so the human link is labelled session-inferred on screen. Killed-mid-run attaches by session and time window, also labelled inferred. Orphaned events (no traceparent, no session) are never guessed at — including a hidden zero-width character shown as [U+200B]."
    ]
  },
  {
    heading: "Reset",
    body: [
      "The header Reset button (or npm run reset) rebuilds the seeded store and a new hash chain, and puts the diagram boxes back where they started."
    ]
  }
];
