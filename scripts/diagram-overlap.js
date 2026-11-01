// Diagram label overlap detector. Evaluate this in a page that shows a ReactFlow diagram, after the diagram has rendered:
//   page.evaluate(open('scripts/diagram-overlap.js').read())     (Playwright, Python)
// It returns { labels, overlaps, duplicates, nodeHits } measured in screen pixels. Zero overlaps and zero duplicates is the pass.
// Edge labels are found by the ReactFlow classes (SVG text wrapper or HTML label renderer). Node boxes are .react-flow__node.
(() => {
  const textOf = (el) => (el.textContent || '').replace(/\s+/g, ' ').trim();
  const rectOf = (el) => {
    const r = el.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height, r: r.right, b: r.bottom };
  };
  const visible = (r) => r.w > 1 && r.h > 1;

  const labelSelector = [
    '.react-flow__edge-textwrapper',   // SVG label group (rect plus text)
    '.react-flow__edge-label',         // HTML label renderer
    '.react-flow__edgelabel-renderer > *',
  ].join(',');
  const raw = Array.from(document.querySelectorAll(labelSelector));
  // Keep the outermost element per label so a wrapper and its child are not counted twice.
  const labels = raw
    .filter((el) => !raw.some((o) => o !== el && o.contains(el)))
    .map((el, i) => ({ i, text: textOf(el), box: rectOf(el), el }))
    .filter((l) => l.text && visible(l.box));

  const overlapArea = (a, b) => {
    const w = Math.min(a.r, b.r) - Math.max(a.x, b.x);
    const h = Math.min(a.b, b.b) - Math.max(a.y, b.y);
    return w > 0 && h > 0 ? w * h : 0;
  };
  const overlaps = [];
  for (let a = 0; a < labels.length; a++) {
    for (let b = a + 1; b < labels.length; b++) {
      const area = overlapArea(labels[a].box, labels[b].box);
      const smaller = Math.min(labels[a].box.w * labels[a].box.h, labels[b].box.w * labels[b].box.h) || 1;
      // Count it when more than 8% of the smaller label is covered (ignores one-pixel border contact).
      if (area / smaller > 0.08) overlaps.push({ a: labels[a].text, b: labels[b].text, coveredPct: Math.round((area / smaller) * 100) });
    }
  }

  // Duplicate text: the same label shown twice within 120px of each other, or the same words repeated inside one label.
  const duplicates = [];
  for (let a = 0; a < labels.length; a++) {
    const words = labels[a].text.toLowerCase().split(' ');
    for (let n = 1; n <= Math.floor(words.length / 2); n++) {
      for (let s = 0; s + 2 * n <= words.length; s++) {
        if (words.slice(s, s + n).join(' ') === words.slice(s + n, s + 2 * n).join(' ')) {
          duplicates.push({ text: labels[a].text, kind: 'repeated words inside one label' });
          s = words.length; n = words.length;
        }
      }
    }
    for (let b = a + 1; b < labels.length; b++) {
      if (labels[a].text.toLowerCase() !== labels[b].text.toLowerCase()) continue;
      const dx = Math.abs(labels[a].box.x - labels[b].box.x), dy = Math.abs(labels[a].box.y - labels[b].box.y);
      if (dx < 120 && dy < 120) duplicates.push({ text: labels[a].text, kind: 'same label twice nearby' });
    }
  }

  // A label sitting on top of a node box (not the node's own label).
  const nodes = Array.from(document.querySelectorAll('.react-flow__node')).map((el) => ({ text: textOf(el).slice(0, 40), box: rectOf(el) })).filter((n) => visible(n.box));
  const nodeHits = [];
  for (const l of labels) {
    for (const n of nodes) {
      const area = overlapArea(l.box, n.box);
      if (area / (l.box.w * l.box.h || 1) > 0.25) nodeHits.push({ label: l.text, node: n.text, coveredPct: Math.round((area / (l.box.w * l.box.h || 1)) * 100) });
    }
  }

  // Labels that the viewport clips (cut off at the canvas edge).
  const canvas = document.querySelector('.react-flow');
  const cb = canvas ? canvas.getBoundingClientRect() : null;
  const clipped = cb ? labels.filter((l) => l.box.x < cb.left - 1 || l.box.r > cb.right + 1 || l.box.y < cb.top - 1 || l.box.b > cb.bottom + 1).map((l) => l.text) : [];

  return {
    labels: labels.length,
    overlaps,
    duplicates,
    nodeHits,
    clipped,
    pass: overlaps.length === 0 && duplicates.length === 0 && nodeHits.length === 0,
  };
})()
