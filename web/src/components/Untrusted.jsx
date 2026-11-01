import React from "react";
import { reveal } from "../lib/reveal.js";

// Every event field is data, never markup: only ever rendered as React text. Hidden characters become visible
// [U+XXXX] chips (the server already did this; this is the second line).
const CHIP = /(\[U\+[0-9A-F]{4,6}\])/;
export const chips = (text) =>
  text.split(CHIP).map((p, i) =>
    i % 2 ? <span key={i} className="chip-hidden" title="Hidden character, shown instead of hidden">{p}</span> : <React.Fragment key={i}>{p}</React.Fragment>);

export function Untrusted({ text, block = false }) {
  const Tag = block ? "pre" : "span";
  return <Tag className={`untrusted${block ? " untrusted--block" : ""}`} data-testid="untrusted">{chips(reveal(text))}</Tag>;
}
