import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { backup } from 'node:sqlite';

// Durable, single-instance snapshots: keep the app's synchronous node:sqlite
// storage, but commit a consistent SQLite+asset snapshot to Turso before 2xx.
// This stores a BLOB in Turso; it does NOT expose normalized SQL tables there.
const FORMAT = 'sharif-snapshot-v1';
const LIMIT = 8 * 1024 * 1024;
const assetPattern = /^thumbnails\/[a-z0-9_.-]+\.(png|jpe?g|webp)$/i;
const checksum = data => crypto.createHash('sha256').update(data).digest('hex');
const toValue = item => item?.type === 'blob' ? Buffer.from(item.base64, 'base64')
  : item?.type === 'integer' ? Number(item.value)
  : item?.type === 'text' ? item.value : null;
const toArg = item => Buffer.isBuffer(item) ? { type: 'blob', base64: item.toString('base64') }
  : typeof item === 'number' ? { type: 'integer', value: String(item) }
  : { type: 'text', value: String(item) };

function endpoint(url) {
  if (!/^libsql:\/\/[a-z0-9.-]+\.turso\.io\/?$/i.test(url || '')) {
    throw new Error('Invalid TURSO_DATABASE_URL (expected libsql://*.turso.io)');
  }
  return 'https://' + url.slice(9).replace(/\/$/, '') + '/v3/pipeline';
}

function collectAssets(dataDir) {
  const files = {};
  const vapid = path.join(dataDir, 'vapid.json');
  if (fs.existsSync(vapid)) files['vapid.json'] = fs.readFileSync(vapid).toString('base64');
  const folder = path.join(dataDir, 'thumbnails');
  if (fs.existsSync(folder)) {
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
      const name = 'thumbnails/' + entry.name;
      if (!entry.isFile() || !assetPattern.test(name)) continue;
      const bytes = fs.readFileSync(path.join(folder, entry.name));
      if (bytes.length > LIMIT) throw new Error('Image too large for Turso snapshot');
      files[name] = bytes.toString('base64');
    }
  }
  return files;
}

function restore(dataDir, bytes) {
  const state = JSON.parse(zlib.gunzipSync(bytes).toString('utf8'));
  if (state.format !== FORMAT || typeof state.db !== 'string' || !state.files) {
    throw new Error('Invalid Turso backup snapshot');
  }
  const raw = Buffer.from(state.db, 'base64');
  if (raw.subarray(0, 16).toString('binary') !== 'SQLite format 3\x00') {
    throw new Error('Turso snapshot contains an invalid SQLite database');
  }
  // Validate all assets BEFORE replacing the local database.
  const files = Object.entries(state.files).map(([name, data]) => {
    if (name !== 'vapid.json' && !assetPattern.test(name)) throw new Error('Unsafe asset in snapshot');
    const payload = Buffer.from(data, 'base64');
    if (payload.length > LIMIT) throw new Error('Invalid oversized asset');
    return [name, payload];
  });
  fs.mkdirSync(dataDir, { recursive: true });
  const dbPath = path.join(dataDir, 'app.db');
  fs.writeFileSync(dbPath + '.restore', raw, { mode: 0o600 });
  // The old WAL must not be replayed onto the freshly restored main database.
  for (const name of ['app.db-wal', 'app.db-shm']) fs.rmSync(path.join(dataDir, name), { force: true });
  fs.renameSync(dbPath + '.restore', dbPath);
  for (const [name, payload] of files) {
    const target = path.join(dataDir, name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, payload, { mode: 0o600 });
  }
  const thumbDir = path.join(dataDir, 'thumbnails');
  if (fs.existsSync(thumbDir)) {
    for (const name of fs.readdirSync(thumbDir)) {
      if (!Object.hasOwn(state.files, 'thumbnails/' + name)) {
        fs.rmSync(path.join(thumbDir, name), { force: true });
      }
    }
  }
}

export class TursoSnapshots {
  constructor({ url, token, dataDir, fetchImpl = fetch }) {
    this.endpoint = endpoint(url);
    if (!token) throw new Error('TURSO_AUTH_TOKEN is missing; cannot enable durable storage');
    this.token = token;
    this.dataDir = dataDir;
    this.fetchImpl = fetchImpl;
    this.version = 0;
    this.savedChanges = -1;
    this.queue = Promise.resolve();
    this.initialized = false;
  }

  async sql(sql, args = []) {
    const res = await this.fetchImpl(this.endpoint, {
      method: 'POST',
      headers: { authorization: 'Bearer ' + this.token, 'content-type': 'application/json' },
      signal: AbortSignal.timeout(45000),
      body: JSON.stringify({ baton: null, requests: [
        { type: 'execute', stmt: { sql, args: args.map(toArg), want_rows: true } },
        { type: 'close' },
      ] }),
    });
    if (!res.ok) throw new Error('Turso HTTP ' + res.status);
    const data = await res.json();
    const first = data.results?.[0];
    if (first?.type !== 'ok' || first.response?.type !== 'execute') {
      throw new Error('Turso SQL error: ' + (first?.error?.message || 'invalid result'));
    }
    return (first.response.result.rows || []).map(row => row.map(toValue));
  }

  async init() {
    await this.sql('CREATE TABLE IF NOT EXISTS sharif_snapshots (id INTEGER PRIMARY KEY CHECK(id=1), version INTEGER NOT NULL, payload BLOB NOT NULL, checksum TEXT NOT NULL, saved_at TEXT NOT NULL)');
    const rows = await this.sql('SELECT version, payload, checksum FROM sharif_snapshots WHERE id=1');
    if (rows.length) {
      const [version, payload, hash] = rows[0];
      if (!Buffer.isBuffer(payload) || checksum(payload) !== hash) {
        throw new Error('Turso backup checksum mismatch. Startup stopped to protect data.');
      }
      restore(this.dataDir, payload);
      this.version = version;
    }
    this.initialized = true;
    return { restored: rows.length > 0, version: this.version };
  }

  async capture(db) {
    const temp = path.join(os.tmpdir(), 'sharif-' + crypto.randomUUID() + '.sqlite');
    try {
      await backup(db, temp);
      const data = {
        format: FORMAT,
        db: fs.readFileSync(temp).toString('base64'),
        files: collectAssets(this.dataDir),
      };
      const bytes = zlib.gzipSync(Buffer.from(JSON.stringify(data)), { level: 6 });
      if (bytes.length > LIMIT) throw new Error('Database and assets exceed maximum snapshot size');
      return bytes;
    } finally {
      fs.rmSync(temp, { force: true });
    }
  }

  async persist(db) {
    const changes = Number(db.prepare('SELECT total_changes() AS n').get().n);
    if (changes === this.savedChanges) return;
    const payload = await this.capture(db);
    const hash = checksum(payload);
    const statement = 'INSERT INTO sharif_snapshots (id,version,payload,checksum,saved_at) VALUES(1,1,?,?,?) '
      + 'ON CONFLICT(id) DO UPDATE SET version=version+1,payload=excluded.payload,'
      + 'checksum=excluded.checksum,saved_at=excluded.saved_at '
      + 'WHERE version=? RETURNING version';
    let rows;
    try {
      rows = await this.sql(statement, [payload, hash, new Date().toISOString(), this.version]);
    } catch (error) {
      // A timeout can happen after the remote commit; detect that safely.
      const check = await this.sql('SELECT version, checksum FROM sharif_snapshots WHERE id=1');
      if (check[0]?.[0] !== this.version + 1 || check[0]?.[1] !== hash) throw error;
      rows = [[check[0][0]]];
    }
    if (!rows.length) throw new Error('Remote snapshot version conflict; refusing to overwrite newer data');
    this.version = rows[0][0];
    this.savedChanges = changes;
  }

  persistIfChanged(db) {
    if (!this.initialized) return Promise.reject(new Error('Turso not initialized'));
    const current = this.queue.catch(() => {}).then(() => this.persist(db));
    this.queue = current;
    return current;
  }
}

export function tursoResponseBarrier(store, db) {
  if (!store) return (req, res, next) => next();
  return (req, res, next) => {
    const send = res.json.bind(res);
    res.json = (body) => {
      if (res.statusCode >= 400 || res.headersSent) return send(body);
      store.persistIfChanged(db).then(() => {
        if (!res.headersSent) send(body);
      }).catch(error => {
        console.error('[turso] Durable save failed:', error.message);
        if (!res.headersSent) res.status(503).json({ error: 'الحفظ الدائم تعذر؛ حاول مرة أخرى بعد التأكد من الاتصال' });
      });
      return res;
    };
    next();
  };
}
