import React from "react";

export const UnverifiedBadge = ({ children = "UNVERIFIED" }) => (
  <span className="badge badge--unv" title="As observed in the demo environment, UNVERIFIED against product documentation. This app makes no claim about real retention, field names or latency.">{children}</span>
);
export const ModelBadge = () => (
  <span className="badge badge--model" title="The shape of this data is a model built for teaching, not a copy of a product format.">MODEL</span>
);
export const MockTokenBadge = () => (
  <span className="badge badge--mock" title="Claims issued by the mock token service in this app. Not a real credential.">MOCK-ISSUED</span>
);
export const Decision = ({ value }) => {
  if (!value) return null;
  const v = String(value);
  const kind = /allow|permit|approved/.test(v) ? "ok" : /deny|killed/.test(v) ? "deny" : /pause|obligation/.test(v) ? "hold" : "mute";
  const glyph = kind === "ok" ? "✓" : kind === "deny" ? "✕" : kind === "hold" ? "⏸" : "·";
  return <span className={`status status--${kind}`} data-decision={v}><span aria-hidden="true">{glyph}</span> {v}</span>;
};
