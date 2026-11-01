import React from "react";

// What each step proves. Every claim is something the server does (see docs/architecture.md).
export const STORY = [
  { title: "1. Emit", proves: "Six sources each log in their own shape. None of them knows about the others." },
  { title: "2. Normalize", proves: "One envelope, with the W3C trace id parsed strictly. A bad traceparent is flagged, never trusted." },
  { title: "3. Store", proves: "Appended to a hash chain. Edit, delete, insert or reorder and verify fails." },
  { title: "4. Query", proves: "Three read-only tools. A window past retention is clamped and said so, never silently emptied." },
  { title: "5. Join", proves: "Correlation ids stitch the timeline. Orphans and gaps are shown, not guessed." },
];

export default function Story({ active = -1 }) {
  return (
    <section className="story" aria-label="What each step proves">
      <ol>
        {STORY.map((s, i) => (
          <li key={s.title} className={i === active ? "now" : ""} aria-current={i === active ? "step" : undefined}>
            <strong>{s.title}</strong>
            <span>{s.proves}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
