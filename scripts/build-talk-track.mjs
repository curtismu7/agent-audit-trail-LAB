// Writes docs/talk-track.md from the talk-track data (content/talk-track.json), so the doc cannot drift from it.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderTalkTrackMarkdown } from '../server/src/talkTrack.js';

const read = (rel) => fs.readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
export const TALK = JSON.parse(read('../content/talk-track.json'));
export const render = () => renderTalkTrackMarkdown(TALK);

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  fs.writeFileSync(fileURLToPath(new URL('../docs/talk-track.md', import.meta.url)), render());
  console.log('wrote docs/talk-track.md');
}
