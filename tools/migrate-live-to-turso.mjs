import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { openDb } from '../server/store.js';
import { importLegacySnapshot } from '../server/legacy-import.js';
import { TursoSnapshots } from '../server/turso-snapshots.js';

// Run only from a one-time GitHub Actions job with the TURSO_AUTH_TOKEN secret.
// Does not modify the live Render service. Refuses to overwrite a Turso snapshot.
const LIVE = 'https://sharif-gc4c.onrender.com';
const URL = 'libsql://sharif-prod-hemaatar.aws-ap-northeast-1.turso.io';
const token = process.env.TURSO_AUTH_TOKEN;
if (!token) throw new Error('Missing TURSO_AUTH_TOKEN GitHub Actions secret');
const sleep = n => new Promise(resolve => setTimeout(resolve, n));
async function get(route, binary = false) {
  let error;
  for (let i = 0; i < 4; i++) {
    try {
      const response = await fetch(LIVE + route, { signal: AbortSignal.timeout(50_000) });
      if (!response.ok) throw new Error('Live export failed HTTP ' + response.status + ' for ' + route);
      return binary ? Buffer.from(await response.arrayBuffer()) : await response.json();
    } catch (e) {
      error = e;
      if (i < 3) await sleep((i + 1) * 2500);
    }
  }
  throw error;
}
function addDays(iso, amount) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + amount);
  return d.toISOString().slice(0, 10);
}
function getStart(date, wd) {
  return addDays(date, -((new Date(date + 'T00:00:00Z').getUTCDay() - wd + 7) % 7));
}
function fingerprint(items) {
  return crypto.createHash('sha256').update(JSON.stringify(items)).digest('hex');
}
const origin = await Promise.all([
  get('/api/state'), get('/api/settings'), get('/api/channels'), get('/api/template'),
  get('/api/bank'), get('/api/history'),
]);
const [current, settings, channels, template, bank, history] = origin;
if (!current?.weekStart || !Array.isArray(current.entries) ||
    !Array.isArray(channels) || !Array.isArray(template) || !Array.isArray(bank)) {
  throw new Error('Live data export was incomplete');
}
const dates = new Set([current.weekStart, ...(history.weeks || []).map(w => w.week_start)]);
for (let d = getStart('2026-01-01', settings.weekStartDay); d < current.currentWeekStart; d = addDays(d, 7)) {
  dates.add(d);
}
const weeks = {};
for (const batch of [...dates].filter(d => d <= current.currentWeekStart).sort().reduce((groups, d, i) => {
  if (i % 5 === 0) groups.push([]);
  groups[groups.length - 1].push(d);
  return groups;
}, [])) {
  const group = await Promise.all(batch.map(async d => ({ d, value: d === current.weekStart ? current : await get('/api/state?week=' + d) })));
  for (const { d, value } of group) {
    if (!Array.isArray(value.entries)) throw new Error('Incomplete week ' + d);
    if (value.entries.length || d === current.weekStart) weeks[d] = value;
  }
}
const thumbs = {};
for (const url of new Set(Object.values(weeks).flatMap(w => w.entries || []).map(e => e.thumb_url).filter(Boolean))) {
  if (!/^\/thumbs\/[a-z0-9_.-]+\.(?:png|jpe?g|webp)$/i.test(url)) throw new Error('Invalid thumbnail URL');
  thumbs[url] = (await get(url, true)).toString('base64');
}
const expected = fingerprint(origin);
const originAfter = await Promise.all([
  get('/api/state'), get('/api/settings'), get('/api/channels'), get('/api/template'),
  get('/api/bank'), get('/api/history'),
]);
if (fingerprint(originAfter) !== expected) {
  throw new Error('Live data changed during export; migration aborted to prevent a stale snapshot');
}
const legacy = {
  format: 'Creator OS logical HTTP backup v1',
  capturedAt: new Date().toISOString(),
  current, settings, channels, template, bank, history, weeks, thumbnails: thumbs,
  limitations: ['Read-only API does not export VAPID private keys or push subscribers. Re-enable push notifications after cutover.'],
};
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sharif-turso-migration-'));
const restored = fs.mkdtempSync(path.join(os.tmpdir(), 'sharif-turso-verify-'));
let db;
let verifyDb;
try {
  db = openDb(path.join(dir, 'app.db'));
  const summary = importLegacySnapshot(db, dir, zlib.gzipSync(Buffer.from(JSON.stringify(legacy))).toString('base64'));
  // First read and independently validate the previous migrated snapshot.
  // Only refresh our own initial revision. Never overwrite a production snapshot
  // already modified by the live Turso-backed application.
  const previousDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sharif-turso-previous-'));
  let previous;
  try {
    previous = new TursoSnapshots({ url: URL, token, dataDir: previousDir });
    const oldState = await previous.init();
    if (!oldState.restored || oldState.version !== 1) {
      throw new Error('Remote Turso revision is not the expected initial migration; refusing overwrite');
    }
  } finally {
    fs.rmSync(previousDir, { recursive: true, force: true });
  }
  // The writer's version acts as a compare-and-swap guard. If another writer
  // updated Turso since our read, this operation refuses to overwrite it.
  const remote = new TursoSnapshots({ url: URL, token, dataDir: dir });
  remote.initialized = true;
  remote.version = 1;
  await remote.persistIfChanged(db);
  const verify = new TursoSnapshots({ url: URL, token, dataDir: restored });
  const result = await verify.init();
  if (!result.restored) throw new Error('Remote snapshot not found after migration');
  verifyDb = openDb(path.join(restored, 'app.db'));
  const totals = verifyDb.prepare('SELECT COUNT(*) AS entries, SUM(CASE WHEN length(trim(script))>0 THEN 1 ELSE 0 END) AS scripts FROM entries').get();
  if (totals.entries !== summary.entries || (totals.scripts || 0) !== summary.scripts) {
    throw new Error('Remote restoration did not match source data');
  }
  console.log('TURSO_MIGRATION_VERIFIED ' + JSON.stringify({
    capturedAt: legacy.capturedAt, ...summary, revision: result.version,
  }));
} finally {
  verifyDb?.close();
  db?.close();
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(restored, { recursive: true, force: true });
}
