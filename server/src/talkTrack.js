// The talk track is data (content/talk-track.json). docs/talk-track.md is generated from it by `npm run talk-track`,
// and a test fails when the file drifts from the data.
export function renderTalkTrackMarkdown(t) {
  const lines = [`# ${t.title}`, '', `Say first: "${t.sayFirst}"`, ''];
  t.steps.forEach((s, i) => lines.push(`${i + 1}. **${s.title}** ${s.say}`));
  lines.push('', `Close: "${t.close}"`, t.reset, '');
  return lines.join('\n');
}
