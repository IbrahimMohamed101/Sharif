import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../server/store.js';
import { createApp } from '../server/app.js';
import webpush from 'web-push';
import { TursoSnapshots } from '../server/turso-snapshots.js';

const URL = 'libsql://sharif-prod-hemaatar.aws-ap-northeast-1.turso.io';
const str = val => ({ type: 'text', value: val });
const num = val => ({ type: 'integer', value: String(val) });
const blob = val => ({ type: 'blob', base64: val.toString('base64') });

function fakeRemote() {
  let saved = null;
  let fail = false;
  const requests = [];
  const remoteFetch = async (url, init) => {
    const payload = JSON.parse(init.body);
    const stmt = payload.requests[0].stmt;
    requests.push({ url, sql: stmt.sql });
    assert.equal(init.headers.authorization, 'Bearer test-token');
    let rows = [];
    if (fail && stmt.sql.includes('INSERT INTO sharif_snapshots')) {
      return { ok: false, status: 503 };
    }
    if (stmt.sql.includes('SELECT version, payload, checksum')) {
      if (saved) rows = [[num(saved.version), blob(saved.payload), str(saved.checksum)]];
    } else if (stmt.sql.includes('SELECT version, checksum')) {
      if (saved) rows = [[num(saved.version), str(saved.checksum)]];
    } else if (stmt.sql.includes('INSERT INTO sharif_snapshots')) {
      const expected = Number(stmt.args[3].value);
      if ((!saved && expected === 0) || (saved && expected === saved.version)) {
        saved = { version: (saved?.version || 0) + 1, payload: Buffer.from(stmt.args[0].base64, 'base64'), checksum: stmt.args[1].value };
        rows = [[num(saved.version)]];
      }
    }
    return { ok: true, status: 200, json: async () => ({ results: [
      { type: 'ok', response: { type: 'execute', result: { rows } } },
      { type: 'ok', response: { type: 'close' } },
    ] }) };
  };
  return { remoteFetch, requests, get stored() { return saved; }, set fail(v) { fail = v; } };
}

async function start(db, dataDir, snapshots) {
  const { app } = createApp({ db, dataDir, snapshots, env: { RESET_PASSWORD: 'local-test' } });
  const server = await new Promise(resolve => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  const base = 'http://127.0.0.1:' + server.address().port;
  return {
    async patch(url, body) {
      const res = await fetch(base + url, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      return { status: res.status, json: await res.json() };
    },
    close: () => new Promise(resolve => server.close(resolve)),
  };
}

test('Turso snapshot: durable SQLite content and image/VAPID survive fresh filesystem', async () => {
  const a = fs.mkdtempSync(path.join(os.tmpdir(), 'sharif-turso-a-'));
  const b = fs.mkdtempSync(path.join(os.tmpdir(), 'sharif-turso-b-'));
  const remote = fakeRemote();
  try {
    const first = new TursoSnapshots({ url: URL, token: 'test-token', dataDir: a, fetchImpl: remote.remoteFetch });
    assert.deepEqual(await first.init(), { restored: false, version: 0 });
    const db = openDb(path.join(a, 'app.db'));
    const chan = db.prepare('INSERT INTO channels(name,color) VALUES(?,?)').run('My Channel', '#13579b');
    const fileName = '4-123.png';
    fs.mkdirSync(path.join(a, 'thumbnails'), { recursive: true });
    fs.writeFileSync(path.join(a, 'thumbnails', fileName), Buffer.from('mock image', 'utf8'));
    fs.writeFileSync(path.join(a, 'vapid.json'), JSON.stringify(webpush.generateVAPIDKeys()));
    const entry = db.prepare('INSERT INTO entries(week_start,title,script,notes,thumb_file) VALUES(?,?,?,?,?)')
      .run('2026-11-01', 'My video', 'سكريبت أصلي', 'مرجع https://example.com', fileName);
    await first.persistIfChanged(db);
    assert.ok(remote.stored?.payload?.length);
    const api = await start(db, a, first);
    const edited = await api.patch('/api/entries/' + entry.lastInsertRowid, { script: 'سكريبت محفوظ في Turso' });
    assert.equal(edited.status, 200);
    assert.equal(edited.json.script, 'سكريبت محفوظ في Turso');
    await api.close();
    db.close();

    const second = new TursoSnapshots({ url: URL, token: 'test-token', dataDir: b, fetchImpl: remote.remoteFetch });
    assert.deepEqual(await second.init(), { restored: true, version: 2 });
    const restored = openDb(path.join(b, 'app.db'));
    const row = restored.prepare('SELECT script,notes,thumb_file FROM entries WHERE id=?').get(entry.lastInsertRowid);
    assert.equal(row.script, 'سكريبت محفوظ في Turso');
    assert.match(row.notes, /example.com/);
    assert.equal(row.thumb_file, fileName);
    assert.equal(restored.prepare('SELECT name FROM channels WHERE id=?').get(chan.lastInsertRowid).name, 'My Channel');
    assert.equal(fs.readFileSync(path.join(b, 'thumbnails', fileName), 'utf8'), 'mock image');
    assert.match(fs.readFileSync(path.join(b, 'vapid.json'), 'utf8'), /privateKey/);
    restored.close();
  } finally {
    fs.rmSync(a, { recursive: true, force: true });
    fs.rmSync(b, { recursive: true, force: true });
  }
});

test('Turso rejects bad config and does not falsely acknowledge writes on remote failure', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sharif-turso-failure-'));
  const remote = fakeRemote();
  try {
    assert.throws(() => new TursoSnapshots({ url: 'http://fake', token: 'x', dataDir: dir }), /TURSO_DATABASE_URL/);
    assert.throws(() => new TursoSnapshots({ url: URL, token: '', dataDir: dir }), /TURSO_AUTH_TOKEN/);
    const db = openDb(path.join(dir, 'app.db'));
    const store = new TursoSnapshots({ url: URL, token: 'test-token', dataDir: dir, fetchImpl: remote.remoteFetch });
    await store.init();
    await store.persistIfChanged(db);
    const app = await start(db, dir, store);
    const entry = db.prepare('INSERT INTO entries(week_start,title,script) VALUES(?,?,?)').run('2026-11-01', 'Demo', '');
    remote.fail = true;
    const response = await app.patch('/api/entries/' + entry.lastInsertRowid, { script: 'new draft' });
    assert.equal(response.status, 503, 'API must return an error if a durable commit fails');
    assert.match(response.json.error, /الحفظ الدائم/);
    await app.close();
    db.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
