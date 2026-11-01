import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { SETTINGS_KEYS, applySharedSettings, readSharedSettings, settingsPath } from '../src/settings.js';

const withFile = (t, text) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aat-settings-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, '.env');
  fs.writeFileSync(file, text, { mode: 0o600 });
  return file;
};

test('the shared settings file is the only source: STANDALONE_ENV overrides the default path, and only this app\'s own key is taken', (t) => {
  assert.deepEqual(SETTINGS_KEYS, ['AAT_LAB_MODE']);
  assert.equal(settingsPath({ STANDALONE_ENV: '/x/y.env' }), '/x/y.env');
  assert.equal(settingsPath({}), path.join(os.homedir(), 'Development', '.env'));
  const file = withFile(t, 'AAT_LAB_MODE=mock\nMODE=live\nPINGONE_CLIENT_SECRET=do-not-read\nPORT=1\n');
  assert.deepEqual(readSharedSettings(file), { AAT_LAB_MODE: 'mock' });
  const env = {};
  applySharedSettings(env, file);
  assert.deepEqual(env, { AAT_LAB_MODE: 'mock' }, 'no other key from the shared file enters the environment');
});

test('real environment variables win over the file, and a missing or unreadable file gives the defaults', (t) => {
  const file = withFile(t, 'AAT_LAB_MODE=live\n');
  const env = { AAT_LAB_MODE: 'mock' };
  applySharedSettings(env, file);
  assert.equal(env.AAT_LAB_MODE, 'mock');
  assert.deepEqual(readSharedSettings('/no/such/file'), {});
  assert.deepEqual(readSharedSettings(path.dirname(file)), {});
});

test('the app reads no per-app .env file', () => {
  const root = path.resolve(import.meta.dirname, '../..');
  const files = ['server/src/index.js', 'server/src/app.js', 'server/src/config.js', 'scripts/doctor.mjs', 'scripts/reset.mjs'].map((f) => fs.readFileSync(path.join(root, f), 'utf8')).join('\n');
  assert.doesNotMatch(files, /loadEnvFile/);
});
