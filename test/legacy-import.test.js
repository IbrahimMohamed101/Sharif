import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { openDb, getSettings, listEntries, listBank } from '../server/store.js';
import { importLegacySnapshot } from '../server/legacy-import.js';

function exported() {
  const e = {
    id: 42, week_start: '2026-10-30', template_id: 15, channel_id: 7,
    title: 'Original video task', day: 1, is_video: true, position: 0,
    done: true, done_at: '2026-11-01T11:00:00.000Z',
    uploaded_at: null, upload_platforms: ['TikTok'],
    script: 'سكريبت المستخدم محفوظ', script_ready: true,
    notes: 'رابط https://example.com/source', titles: ['عنوان'],
    chosen_title: 'عنوان', thumb_prompt: 'example prompt', thumb_url: '/thumbs/42-123.png',
  };
  const state = { entries: [e], progress: { target: 18 } };
  return {
    format: 'Creator OS logical HTTP backup v1', capturedAt: '2026-11-02T00:00:00.000Z',
    current: { demo: false }, settings: { weekStartDay: 5, weeklyTarget: 18 },
    channels: [{ id: 7, name: 'القناة', color: '#123456', icon: '🎬', style: 'x',
      title_prompt: '', image_prompt: '', position: 1 }],
    template: [{ id: 15, channel_id: 7, title: 'Original video task', day: 1, is_video: true, position: 0 }],
    bank: [{ id: 12, title: 'الهوك', body: 'نص في المخزن', created_at: '2026-10-31T10:00:00.000Z' }],
    history: { weeks: [{ week_start: '2026-10-30', target: 18 }], resets: [] },
    weeks: { '2026-10-30': state },
    thumbnails: { '/thumbs/42-123.png': Buffer.from('mock-thumbnail-image').toString('base64') },
  };
}
const encode = snapshot => zlib.gzipSync(Buffer.from(JSON.stringify(snapshot))).toString('base64');

test('import from live logical backup preserves actual scripts, notes, task IDs, media, settings and bank', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sharif-legacy-'));
  const db = openDb(':memory:');
  try {
    const report = importLegacySnapshot(db, dir, encode(exported()));
    assert.deepEqual(report, { channels: 1, templates: 1, weeks: 1, entries: 1, scripts: 1, media: 1, bank: 1 });
    const [e] = listEntries(db, '2026-10-30');
    assert.equal(e.id, 42);
    assert.equal(e.script, 'سكريبت المستخدم محفوظ');
    assert.equal(e.script_ready, true);
    assert.equal(e.notes, 'رابط https://example.com/source');
    assert.deepEqual(e.titles, ['عنوان']);
    assert.equal(e.thumb_url, '/thumbs/42-123.png');
    assert.equal(listBank(db)[0].body, 'نص في المخزن');
    assert.equal(getSettings(db).weekStartDay, 5);
    assert.equal(fs.readFileSync(path.join(dir, 'thumbnails/42-123.png'), 'utf8'), 'mock-thumbnail-image');
    assert.throws(() => importLegacySnapshot(db, dir, encode(exported())), /non-empty/);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM entries').get().n, 1);
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('rejects backup with missing media and rolls back all SQL writes', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sharif-invalid-legacy-'));
  const db = openDb(':memory:');
  try {
    const old = exported();
    old.thumbnails = {};
    assert.throws(() => importLegacySnapshot(db, dir, encode(old)), /Missing referenced thumbnail/);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM entries').get().n, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM channels').get().n, 0);
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
