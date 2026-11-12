#!/usr/bin/env node
// Real-browser run of the web UI against the real server, which serves the UI itself (server/src/index.js).
// Covers 1280 and 375 px, light and dark, the Mock | Live toggle, presenter mode (button and P / Escape), the diagram (data-driven, box
// positions, Reset, label overlap) and a keyboard run with focus kept on the Run button.
//
//   npm run build          (once; the server serves web/dist)
//   npm run e2e            starts the server on E2E_PORT (default: first free port in 6620-6629), drives it, stops it
//   E2E_SHOTS=/some/dir    where screenshots go (default .data/e2e-screenshots, git-ignored)
//
// Uses the Chromium the installed Playwright resolves (`npx playwright install chromium` if missing).
// The run makes no outbound request: any request that leaves the origin fails a check.
import { spawn } from 'node:child_process';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const shots = process.env.E2E_SHOTS || path.join(root, '.data', 'e2e-screenshots');
const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });
let failures = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) failures += 1; };

// E2E_PORT may be any port in 6600-6649. Without it the first free port from 6620 to 6629 is used, so a busy 6620 does not fail the run.
const isFree = (p) => new Promise((resolve) => { const s = net.createServer(); s.once('error', () => resolve(false)); s.listen(p, '127.0.0.1', () => s.close(() => resolve(true))); });
let port = Number(process.env.E2E_PORT);
if (process.env.E2E_PORT) {
  if (!Number.isInteger(port) || port < 6600 || port > 6649) { console.error('E2E_PORT must be an integer in 6600-6649'); process.exit(2); }
} else {
  port = 0;
  for (let p = 6620; p <= 6629 && !port; p++) if (await isFree(p)) port = p;
  if (!port) { console.error('no free port in 6620-6629; set E2E_PORT'); process.exit(2); }
}
const base = `http://127.0.0.1:${port}`;
if (!fs.existsSync(path.join(root, 'web', 'dist', 'index.html'))) { console.error('Run `npm run build` first.'); process.exit(2); }
const env = { ...process.env, AUDIT_TRAIL_PORT: String(port), STANDALONE_ENV: path.join(root, '.data', 'no-such-settings-file') }; // the run never reads the real shared settings file
delete env.AUDIT_TRAIL_BIND;
const server = spawn(process.execPath, ['server/src/index.js'], { cwd: root, env, stdio: 'inherit' });
let up = false;
for (let i = 0; i < 120 && !up; i++) { try { up = (await fetch(`${base}/api/health`)).ok; } catch { await sleep(500); } }
if (!up) { server.kill(); console.error('server did not start'); process.exit(2); }
fs.mkdirSync(shots, { recursive: true });

const SCENARIOS = [
  ['normal-purchase', 'Normal purchase'],
  ['denied-scope', 'Denied'],
  ['paused-approved', 'Paused'],
  ['killed-mid-run', 'Agent killed'],
  ['orphaned-event', 'Orphaned'],
  ['two-hop-delegation', 'two-hop'],
];
const TABS = ['Story', 'Events', 'Retention', 'Tools', 'Integrity', 'Diagram'];

const overlapSource = fs.readFileSync(path.join(root, 'scripts', 'diagram-overlap.js'), 'utf8');
const browser = await chromium.launch({ executablePath: process.env.E2E_CHROMIUM || undefined });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, colorScheme: 'light' });
  page.setDefaultTimeout(30000);
  const external = []; const errors = []; const dialogs = [];
  page.on('request', (r) => { if (!r.url().startsWith(base) && !/^(data|blob):/.test(r.url())) external.push(r.url()); });
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('dialog', (d) => { dialogs.push(d.message()); d.dismiss(); });
  const shot = (name) => page.screenshot({ path: path.join(shots, `${name}.png`), fullPage: true });
  const active = () => page.evaluate(() => `${document.activeElement?.tagName}|${document.activeElement?.textContent?.trim().slice(0, 40)}`);
  const status = () => page.getByTestId('run-status').innerText();
  const tab = (name) => page.getByRole('navigation', { name: 'Views' }).getByRole('button', { name, exact: true }).click();
  const run = async (id) => {
    await page.locator('#scenario-select').selectOption(id);
    await page.getByRole('button', { name: 'Run', exact: true }).click();
    await page.waitForFunction(() => /^Ran "/.test(document.querySelector('[data-testid="run-status"]').textContent));
  };
  // Box position in diagram coordinates (from the node's own translate), so a changed viewport zoom cannot fake a move.
  const pos = (name) => page.locator('.react-flow__node', { hasText: name }).first().evaluate((el) => { const m = /translate\(([-\d.]+)px,\s*([-\d.]+)px\)/.exec(el.style.transform); return { x: Number(m[1]), y: Number(m[2]) }; });
  const noScroll = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

  await page.goto(`${base}/`);
  await page.getByTestId('mode-badge').waitFor();
  check((await page.getByTestId('mode-badge').innerText()).includes('DEMO'), 'header shows the DEMO badge');
  check((await page.getByTestId('mode-header').innerText()).includes('mock'), 'mode header says mock');
  const csp = (await (await fetch(`${base}/`)).headers.get('content-security-policy')) || '';
  check(/script-src 'self'/.test(csp) && !/unsafe-eval/.test(csp), 'the page is served with a same-origin CSP');
  await page.waitForFunction(() => document.querySelector('#scenario-select')?.options.length > 0);
  check(await noScroll(), 'no horizontal page scroll at 1280px (Story)');

  // Rule 19 Mock | Real control on every tab (TopMenu v2: a select, Real option disabled
  // with the server's honest reason; this lab is mock only). The page stays mock.
  for (const t of TABS) {
    await tab(t);
    const sel = page.getByTestId('mode-select');
    const realOption = sel.locator('option[value="real"]');
    await sel.waitFor();
    check(await sel.isVisible()
      && (await sel.getAttribute('aria-label')) === 'Mock or Real'
      && (await sel.inputValue()) === 'mock'
      && await realOption.evaluate((el) => el.disabled === true),
      `Mock | Real control visible on the ${t} tab, Mock selected, Real disabled`);
  }
  await tab('Story');
  check(!(await page.getByTestId('live-note').isVisible()), 'no mode message before the control is used');
  const realTitle = await page.locator('[data-testid="mode-select"] option[value="real"]').getAttribute('title');
  check(!!realTitle && realTitle.length > 0, 'Real carries an honest disabled reason in its tooltip');
  const modeReq = await page.request.post(`http://127.0.0.1:${port}/api/mode`, { data: { source: 'real' }, headers: { origin: `http://127.0.0.1:${port}` } });
  const modeRes = { status: modeReq.status(), body: await modeReq.json() };
  check(modeRes.status === 409 && modeRes.body.source === 'mock' && modeRes.body.realAvailable === false, 'POST /api/mode {source:"real"} answers 409 and the server stays mock');
  check((await page.getByTestId('mode-select').inputValue()) === 'mock' && (await page.getByTestId('mode-header').innerText()).includes('mock'), 'the page stays in mock mode');
  check(/MOCK mode/.test(await page.getByTestId('sim-banner').innerText()) && (await page.getByTestId('sim-banner').getAttribute('data-state')) === 'mock', 'the banner says MOCK mode');
  await page.getByTestId('mode-select').selectOption('mock');
  check((await page.getByTestId('mode-select').inputValue()) === 'mock' && !(await page.getByTestId('live-note').isVisible()), 'selecting Mock keeps mock and shows no message');

  // The simulation banner is on every tab.
  for (const t of TABS) { await tab(t); check(await page.getByTestId('sim-banner').isVisible() && /SIMULATION/.test(await page.getByTestId('sim-banner').innerText()) && /MOCK mode/.test(await page.getByTestId('sim-banner').innerText()), `simulation banner (with the mode) visible on the ${t} tab`); }
  await tab('Story');

  // Keyboard only: skip link, then Tab to Run, Enter on the default scenario.
  await page.goto(`${base}/`);
  await page.getByTestId('mode-badge').waitFor();
  await page.keyboard.press('Tab');
  check((await active()).includes('Skip to content'), 'first Tab stop is the skip link');
  let reached = false;
  for (let i = 0; i < 20 && !reached; i++) { await page.keyboard.press('Tab'); reached = (await active()).endsWith('|Run'); }
  check(reached, 'Tab reaches the Run button');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => /^Ran "/.test(document.querySelector('[data-testid="run-status"]').textContent));
  check((await active()).endsWith('|Run'), 'keyboard focus stays on the Run button after the run');
  check((await page.getByRole('button', { name: 'Run', exact: true }).getAttribute('disabled')) === null, 'Run is never the disabled attribute');
  check((await page.getByTestId('run-status').getAttribute('aria-live')) === 'polite', 'run result region is aria-live');

  // Every scenario, from the UI.
  const seen = {};
  for (const [id, label] of SCENARIOS) {
    await run(id);
    const who = page.getByTestId('who'); await who.waitFor();
    const sentence = await page.getByTestId('sentence').innerText();
    const items = await page.getByTestId('tl-item').count();
    const chain = await page.getByTestId('chain').locator('li').allInnerTexts();
    seen[id] = { sentence, items, chain };
    check(sentence.length > 20, `${id}: a sentence is shown ("${sentence.slice(0, 70)}...")`);
    check(items >= 1 && (await status()).includes(label.split(' ')[0]) === false || items >= 1, `${id}: timeline has ${items} entries; status "${await status()}"`);
    if (id === 'orphaned-event') {
      check(await page.getByTestId('orphan-badge').isVisible(), 'orphaned-event: the ORPHAN marker is shown');
      check(/no correlation id|not joined/.test(sentence), 'orphaned-event: the sentence says it is not joined');
      check(/hidden|\[U\+/.test(await who.innerText()), 'orphaned-event: the hidden character is made visible as [U+XXXX]');
    } else check((await page.getByTestId('orphan-badge').count()) === 0, `${id}: not marked orphan`);
    if (id === 'two-hop-delegation') check(chain.filter((c) => /agent/i.test(c)).length === 2, `two-hop: chain shows two agent hops (${chain.map((c) => c.replace(/\n/g, ' ')).join(' | ')})`);
    if (id === 'denied-scope') check(/denied|deny/i.test(sentence), 'denied-scope: sentence says denied');
    if (id === 'paused-approved') check(/approv/i.test(sentence), 'paused-approved: sentence names the approval');
    if (id === 'killed-mid-run') check(/kill/i.test(sentence) && (await page.locator('.badge--link-session-inferred').count()) > 0, 'killed-mid-run: kill is in the story and the inferred link is labelled');
    if (id === 'normal-purchase') await shot('1-story-light');
  }
  const noOverlap = await page.getByTestId('who').evaluate((el) => el.scrollWidth <= el.clientWidth + 1);
  check(noOverlap, 'story panel does not overflow');

  // Event search from the UI: filter, results, pagination, raw viewer, join from a raw event.
  await tab('Events');
  await page.getByTestId('event-row').first().waitFor();
  const total = await page.getByTestId('event-row').count();
  check(total === 10, `search returns a page of 10 (${total})`);
  const next = page.getByRole('button', { name: 'Next page' });
  check(await next.isEnabled(), 'there is a next page');
  const firstBefore = await page.getByTestId('event-row').first().innerText();
  await next.click();
  await page.waitForFunction((t) => document.querySelector('[data-testid="event-row"]')?.innerText !== t, firstBefore);
  check(true, 'next page shows different events');
  await page.getByRole('button', { name: 'Previous page' }).click();
  await page.waitForFunction((t) => document.querySelector('[data-testid="event-row"]')?.innerText === t, firstBefore);
  await page.getByLabel('Source', { exact: true }).selectOption('killswitch');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await page.waitForFunction(() => [...document.querySelectorAll('[data-testid="event-row"]')].every((r) => r.innerText.includes('killswitch')) && document.querySelectorAll('[data-testid="event-row"]').length > 0);
  check(true, 'filtering by source narrows the table');
  await page.getByLabel('Correlation').selectOption('true');
  await page.getByLabel('Source', { exact: true }).selectOption('');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="event-row"]').length > 0);
  check((await page.locator('[data-testid="event-row"] .badge--orphan').count()) > 0, 'orphaned-only filter lists orphan-marked rows');
  await page.getByLabel('Days back').fill('30');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await page.getByTestId('clamp-note').waitFor();
  check(/clamped to 7 days/.test(await page.getByTestId('clamp-note').innerText()), 'asking for 30 days shows "clamped to 7 days"');
  await page.getByRole('button', { name: 'Clear' }).click();
  await page.getByTestId('event-row').first().waitFor();
  await page.getByTestId('event-row').first().getByRole('button').click();
  await page.getByTestId('raw-event').waitFor();
  check(await page.getByTestId('raw-event').locator('pre').count() === 2, 'raw viewer shows the envelope and the source record');
  await page.getByRole('button', { name: /^Join/ }).click();
  await page.getByTestId('who').waitFor();
  check(await page.getByRole('button', { name: 'Story', exact: true }).getAttribute('aria-pressed') === 'true', 'Join from a raw event opens the story tab');
  // A token event shows the MOCK-ISSUED label.
  await tab('Events');
  await page.getByLabel('Source', { exact: true }).selectOption('token');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="event-row"]').length > 0 && [...document.querySelectorAll('[data-testid="event-row"]')].every((r) => r.innerText.includes('token')));
  await page.getByTestId('event-row').first().getByRole('button').click();
  await page.getByText('MOCK-ISSUED').first().waitFor();
  check(true, 'token events are labelled MOCK-ISSUED');
  await shot('2-events-light');

  // Retention
  await tab('Retention');
  await page.getByTestId('naive').waitFor();
  check(/\b0 events/.test(await page.getByTestId('naive').innerText()), 'retention: naive upstream silently returns 0 events at 30 days');
  const tool = await page.getByTestId('tool-answer').innerText();
  check(/clamped to 7 days/.test(tool) && !/\b0 events/.test(tool), 'retention: the audit tool clamps and says so');
  check((await page.getByRole('heading', { name: /Retention window/ }).innerText()).includes('UNVERIFIED'), 'retention carries the UNVERIFIED badge');
  await shot('3-retention-light');

  // Tools
  await tab('Tools');
  await page.waitForFunction(() => /3 tools advertised/.test(document.querySelector('[data-testid="tool-count"]').textContent));
  check(true, 'tools/list advertises exactly 3 tools');
  const names = await page.locator('.toollist .mono').allInnerTexts();
  check(!names.some((n) => /write|delete|reset|update|create/.test(n)), `no write tool in the list (${names.join(', ')})`);
  await page.getByRole('button', { name: 'Call tool' }).click();
  await page.getByTestId('rpc-result').waitFor();
  check(/"jsonrpc": "2.0"/.test(await page.getByTestId('rpc-result').innerText()), 'a tools/call shows the JSON-RPC request and response');
  check(/clamped/.test(await page.getByTestId('rpc-result').innerText()), 'the call asked for 30 days and the response says clamped');
  await shot('4-tools-light');

  // Integrity
  await tab('Integrity');
  await page.getByRole('button', { name: 'Verify chain' }).click();
  await page.getByTestId('verdict-live store').waitFor();
  check(/verified/.test(await page.getByTestId('verdict-live store').innerText()), 'live chain verifies');
  await page.getByRole('button', { name: 'Tamper with a copy' }).click();
  await page.getByTestId('verdict-copy after').waitFor();
  check(/TAMPERED/.test(await page.getByTestId('verdict-copy after').innerText()), 'tampered copy fails verification');
  check(/verified/.test(await page.getByTestId('verdict-live store').last().innerText()), 'the live store still verifies after the tamper demo');
  await shot('5-integrity-light');

  // Diagram
  await tab('Diagram');
  await page.locator('.react-flow__node').first().waitFor();
  check((await page.locator('.react-flow__node').count()) === 5, 'five diagram boxes (from the diagram-studio data)');
  check((await page.locator('.react-flow__edge').count()) === 4, 'four arrows');
  const ov1280 = await page.evaluate(overlapSource);
  check(ov1280.pass && ov1280.labels === 4 && ov1280.clipped.length === 0, `diagram labels do not overlap at 1280px ${JSON.stringify({ labels: ov1280.labels, overlaps: ov1280.overlaps.length, duplicates: ov1280.duplicates.length, nodeHits: ov1280.nodeHits.length, clipped: ov1280.clipped.length })}`);
  const node = page.locator('.react-flow__node', { hasText: 'Audit tools' }).first();
  await node.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(200);
  const before = await node.boundingBox();
  const startPos = await pos('Audit tools');
  await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
  await page.mouse.down(); await page.mouse.move(before.x + before.width / 2 + 60, before.y + before.height / 2 + 30, { steps: 6 }); await page.mouse.up();
  const moved = await node.boundingBox();
  const movedPos = await pos('Audit tools');
  check(Math.abs(movedPos.x - startPos.x) > 20 || Math.abs(movedPos.y - startPos.y) > 10, 'a box can be dragged');
  await page.locator('#scenario-select').selectOption('denied-scope');
  await page.getByLabel('Speed').selectOption('4');
  await page.getByRole('button', { name: 'Simulate' }).click();
  await page.getByTestId('caption').filter({ hasText: 'Step 1 of 5' }).waitFor();
  check((await page.locator('.fbox[data-on="true"]').count()) > 0, 'Simulate highlights boxes');
  await page.getByTestId('caption').filter({ hasText: 'Step 5 of 5' }).waitFor({ timeout: 20000 });
  const cap = await page.getByTestId('caption').innerText();
  check(/join built a timeline of 5 events/.test(cap), `final step reflects the real query: "${cap}"`);
  await tab('Story'); await tab('Diagram');
  const kept = await pos('Audit tools');
  check(Math.abs(kept.x - movedPos.x) < 3 && Math.abs(kept.y - movedPos.y) < 3, 'box position survives a tab switch');
  await shot('6-diagram-light');
  await page.getByRole('button', { name: 'Reset diagram' }).click();
  const restoredPos = await pos('Audit tools');
  const restoredNode = page.locator('.react-flow__node', { hasText: 'Audit tools' }).first();
  await restoredNode.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(200);
  const restored = await restoredNode.boundingBox();
  check(Math.abs(restoredPos.x - startPos.x) < 1 && Math.abs(restoredPos.y - startPos.y) < 1, 'Reset diagram restores the box position');
  // App Reset also restores positions.
  await page.mouse.move(restored.x + restored.width / 2, restored.y + restored.height / 2);
  await page.mouse.down(); await page.mouse.move(restored.x + restored.width / 2 + 50, restored.y + restored.height / 2 + 40, { steps: 5 }); await page.mouse.up();
  check(Math.abs((await pos('Audit tools')).x - startPos.x) > 20, 'the box was moved again before the header Reset');
  await page.getByRole('button', { name: 'Reset', exact: true }).click();
  await page.waitForFunction(() => /^Reset:/.test(document.querySelector('[data-testid="run-status"]').textContent));
  await tab('Diagram');
  const afterReset = await pos('Audit tools');
  check(Math.abs(afterReset.x - startPos.x) < 1 && Math.abs(afterReset.y - startPos.y) < 1, 'the header Reset also restores box positions');
  await tab('Integrity');
  await page.getByRole('button', { name: 'Verify chain' }).click();
  await page.getByTestId('verdict-live store').waitFor();
  check(/verified/.test(await page.getByTestId('verdict-live store').innerText()), 'after Reset the new chain verifies');

  // Presenter mode keeps the banner.
  await tab('Story');
  await page.getByTestId('presenter').click();
  check(await page.locator('.app.app--presenter').count() === 1 && await page.getByTestId('sim-banner').isVisible() && await page.getByTestId('mode-header').isVisible(), 'presenter mode on (button), simulation banner and mode still visible');
  await shot('7-presenter-light');
  await page.getByTestId('presenter').click();
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('p');
  check(await page.locator('.app--presenter').count() === 1 && await page.getByTestId('sim-banner').isVisible(), 'P turns presenter mode on and the banner stays');
  await page.keyboard.press('Escape');
  check(await page.locator('.app--presenter').count() === 0, 'Escape leaves presenter mode');
  await page.keyboard.press('Control+p'); await page.keyboard.press('Meta+p'); await page.keyboard.press('Alt+p');
  check(await page.locator('.app--presenter').count() === 0, 'Ctrl, Meta and Alt chords with P are ignored');
  await tab('Events');
  // Real key events, one key at a time: fill() fires none, and "pP" in one go toggles twice and ends off even without the guard.
  await page.getByLabel('Tool', { exact: true }).click();
  await page.keyboard.press('p');
  check(await page.locator('.app--presenter').count() === 0, 'typing a single p into a field does not toggle presenter mode');
  await page.keyboard.press('Shift+P');
  check(await page.locator('.app--presenter').count() === 0 && (await page.getByLabel('Tool', { exact: true }).inputValue()) === 'pP', 'typing P into a field does not toggle presenter mode either, and the field got both letters');
  await page.getByRole('button', { name: 'Clear' }).click();
  await tab('Story');

  // Dark theme: every tab.
  await run('two-hop-delegation');
  await page.getByTestId('theme-select').selectOption('dark');
  check((await page.evaluate(() => document.documentElement.dataset.theme)) === 'dark', 'theme toggles to dark');
  let n = 0;
  for (const t of TABS) { await tab(t); n += 1; await sleep(400); await shot(`d${n}-${t.toLowerCase()}-dark`); }
  const ovDark = await page.evaluate(overlapSource);
  check(ovDark.pass && ovDark.clipped.length === 0, `diagram labels do not overlap at 1280px in the dark theme ${JSON.stringify({ labels: ovDark.labels, overlaps: ovDark.overlaps.length, nodeHits: ovDark.nodeHits.length, clipped: ovDark.clipped.length })}`);

  // Narrow viewport (375px), both themes, every tab.
  for (const theme of ['dark', 'light']) {
    await page.setViewportSize({ width: 375, height: 800 });
    if (theme === 'light') await page.getByTestId('theme-select').selectOption('light');
    await sleep(200);
    for (const t of TABS) {
      await tab(t); await sleep(300);
      check(await noScroll(), `no horizontal page scroll at 375px (${t}, ${theme})`);
      check(await page.getByTestId('sim-banner').isVisible() && await page.getByTestId('mode-select').isVisible(), `banner and Mock | Real control visible at 375px (${t}, ${theme})`);
    }
    // The Scenario and Cast selects stay inside the picker card (they once ran a few px past its border).
    check(await page.locator('.picker select').evaluateAll((els) => els.every((el) => { const c = el.closest('.card').getBoundingClientRect(); return el.getBoundingClientRect().right <= c.right + 0.5; })), `the Scenario and Cast selects stay inside the card at 375px (${theme})`);
    // At 375px the diagram sits in a sideways-scrolling region at a readable size, and the banner is a labelled landmark.
    await tab('Diagram');
    const box = await page.locator('.flow-wrap').evaluate((el) => el.getBoundingClientRect().width);
    check(box >= 880, `diagram keeps a readable width at 375px (${Math.round(box)}px, scrolls sideways) (${theme})`);
    check(await page.locator('.flow-scroll').evaluate((el) => el.scrollWidth > el.clientWidth), `the diagram region scrolls sideways at 375px (${theme})`);
    const ov = await page.evaluate(overlapSource);
    check(ov.overlaps.length === 0 && ov.duplicates.length === 0 && ov.nodeHits.length === 0, `diagram labels do not overlap at 375px (${theme}) ${JSON.stringify({ labels: ov.labels, overlaps: ov.overlaps.length, nodeHits: ov.nodeHits.length })}`);
    check((await page.getByRole('region', { name: 'Simulation notice' }).count()) === 1, 'the simulation banner is a labelled landmark');
    await tab('Story'); await shot(`phone-story-${theme}`);
    await tab('Diagram'); await shot(`phone-diagram-${theme}`);
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  await shot('8-wide-light-final');

  check(external.length === 0, `no request left the origin ${JSON.stringify(external)}`);
  check(errors.length === 0, `no page or console errors ${JSON.stringify(errors)}`);
  check(dialogs.length === 0, 'no JavaScript dialog fired');
} catch (e) {
  console.error(e); failures += 1;
} finally {
  await browser.close();
  server.kill();
}
console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
