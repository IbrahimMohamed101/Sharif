import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { DEFAULT_SETTINGS, tx } from './store.js';

// Import the logical, read-only API export captured before Render cutover.
// The env value is a base64-encoded, gzipped JSON document, never a public URL.
// Import is only allowed on an empty database and is atomic for all SQL rows.
export function importLegacySnapshot(db, dataDir, encoded) {
  const packed = Buffer.from(encoded || '', 'base64');
  if (!packed.length || packed.length > 8 * 1024 * 1024) throw new Error('Invalid legacy backup size');
  const raw = zlib.gunzipSync(packed, { maxOutputLength: 30 * 1024 * 1024 });
  const old = JSON.parse(raw.toString('utf8'));
  if (old.format !== 'Creator OS logical HTTP backup v1' ||
      !Array.isArray(old.channels) || !Array.isArray(old.template) ||
      !Array.isArray(old.bank) || !old.weeks || typeof old.weeks !== 'object' ||
      !old.settings || !old.history) {
    throw new Error('Incomplete/invalid legacy backup');
  }
  const allWeeks = Object.entries(old.weeks);
  if (allWeeks.length < 1) throw new Error('Legacy backup has no weeks');
  const entries = allWeeks.flatMap(([key, state]) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key) || !Array.isArray(state.entries)) {
      throw new Error('Invalid week in legacy backup');
    }
    return state.entries;
  });
  if (old.channels.length === 0 || old.template.length === 0 || entries.length === 0) {
    throw new Error('Legacy backup unexpectedly contains no working data');
  }
  const images = Object.entries(old.thumbnails || {}).map(([url, base64]) => {
    if (!/^\/thumbs\/[a-z0-9_.-]+\.(?:png|jpe?g|webp)$/i.test(url)) {
      throw new Error('Invalid media path in legacy backup');
    }
    const bytes = Buffer.from(base64, 'base64');
    if (bytes.length > 8 * 1024 * 1024) throw new Error('Legacy image exceeds size limit');
    return [url.slice('/thumbs/'.length), bytes];
  });

  const flag = value => value ? 1 : 0;
  tx(db, () => {
    const row = db.prepare('SELECT (SELECT COUNT(*) FROM entries) AS e, (SELECT COUNT(*) FROM channels) AS c').get();
    if (row.e || row.c) throw new Error('Refusing to import backup into a non-empty database');
    const putSetting = db.prepare('INSERT INTO settings (key,value) VALUES (?,?)');
    for (const key of Object.keys(DEFAULT_SETTINGS)) {
      if (Object.hasOwn(old.settings, key)) putSetting.run(key, JSON.stringify(old.settings[key]));
    }
    putSetting.run('meta:seeded', 'true');
    if (old.current?.demo) putSetting.run('meta:demo', 'true');
    const channels = db.prepare('INSERT INTO channels (id,name,color,icon,style,title_prompt,image_prompt,position) VALUES (?,?,?,?,?,?,?,?)');
    for (const c of old.channels) channels.run(c.id, c.name, c.color, c.icon || '', c.style || '',
      c.title_prompt || '', c.image_prompt || '', c.position || 0);
    const template = db.prepare('INSERT INTO template_tasks (id,channel_id,title,day,is_video,position) VALUES (?,?,?,?,?,?)');
    for (const t of old.template) template.run(t.id, t.channel_id ?? null, t.title, t.day ?? null, flag(t.is_video), t.position || 0);
    const weeks = db.prepare('INSERT INTO weeks (week_start,target,created_at) VALUES (?,?,?)');
    const insert = db.prepare('INSERT INTO entries (id,week_start,template_id,channel_id,title,day,is_video,position,done,done_at,uploaded_at,upload_platforms,script,script_ready,notes,titles,chosen_title,thumb_prompt,thumb_file) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
    const history = new Map((old.history.weeks || []).map(w => [w.week_start, w]));
    const seen = new Set();
    for (const [weekStart, state] of allWeeks) {
      weeks.run(weekStart, history.get(weekStart)?.target || state.progress?.target || old.settings.weeklyTarget || 18,
        old.capturedAt || new Date().toISOString());
      for (const e of state.entries) {
        if (seen.has(e.id) || e.week_start !== weekStart) throw new Error('Duplicate ID or inconsistent week in legacy backup');
        seen.add(e.id);
        const thumb = e.thumb_url && /^\/thumbs\/[a-z0-9_.-]+\.(?:png|jpe?g|webp)$/i.test(e.thumb_url)
          ? e.thumb_url.slice('/thumbs/'.length) : '';
        if (thumb && !images.some(([name]) => name === thumb)) throw new Error('Missing referenced thumbnail');
        insert.run(e.id, weekStart, e.template_id ?? null, e.channel_id ?? null, e.title, e.day ?? null,
          flag(e.is_video), e.position || 0, flag(e.done), e.done_at ?? null, e.uploaded_at ?? null,
          JSON.stringify(e.upload_platforms || []), e.script || '', flag(e.script_ready), e.notes || '',
          JSON.stringify(e.titles || []), e.chosen_title || '', e.thumb_prompt || '', thumb);
      }
    }
    const bank = db.prepare('INSERT INTO script_bank (id,title,body,created_at) VALUES (?,?,?,?)');
    for (const b of old.bank) bank.run(b.id, b.title, b.body, b.created_at);
    const resets = db.prepare('INSERT INTO reset_log (week_start,done,target,at) VALUES (?,?,?,?)');
    for (const r of old.history.resets || []) resets.run(r.week_start, r.done, r.target, r.at);
  });
  const dir = path.join(dataDir, 'thumbnails');
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, bytes] of images) fs.writeFileSync(path.join(dir, name), bytes, { mode: 0o600 });
  return {
    channels: old.channels.length, templates: old.template.length,
    weeks: allWeeks.length, entries: entries.length, scripts: entries.filter(e => e.script?.trim()).length,
    media: images.length, bank: old.bank.length,
  };
}
