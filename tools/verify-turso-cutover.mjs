import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { openDb, listEntries, listChannels, listTemplate, listBank, getSettings } from '../server/store.js';
import { TursoSnapshots } from '../server/turso-snapshots.js';

const token = process.env.TURSO_AUTH_TOKEN;
if (!token) throw new Error('Missing private TURSO_AUTH_TOKEN secret');
const base = 'https://sharif-gc4c.onrender.com';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sharif-preflight-'));
let db;
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
async function get(path) {
  for(let i = 0;i < 4;i++){
    try {
      const response = await fetch(base + path, { signal: AbortSignal.timeout(60000) });
      if (!response.ok) throw new Error('Live HTTP ' + response.status + ' ' + path);
      return await response.json();
    } catch (err) {
      if (i === 3) throw err;
      await new Promise(resolve => setTimeout(resolve, 2500 * (i + 1)));
    }
  }
}
const key = e => ({
  id:e.id, week_start:e.week_start, template_id:e.template_id,
  channel_id:e.channel_id, title:e.title, day:e.day, is_video:e.is_video,
  position:e.position, done:e.done, done_at:e.done_at,
  uploaded_at:e.uploaded_at, upload_platforms:e.upload_platforms,
  script:e.script, script_ready:e.script_ready, notes:e.notes,
  titles:e.titles, chosen_title:e.chosen_title, thumb_prompt:e.thumb_prompt,
  thumb_url:e.thumb_url,
});
function compare(label, local, remote) {
  if (hash(local) !== hash(remote)) throw new Error(label + ' changed in live Render after Turso migration — refusing cutover');
}
try {
  const storage = new TursoSnapshots({
    url:'libsql://sharif-prod-hemaatar.aws-ap-northeast-1.turso.io',
    token,dataDir:dir,
  });
  const result = await storage.init();
  if (!result.restored) throw new Error('Missing migrated Turso snapshot');
  db = openDb(path.join(dir,'app.db'));
  const live = await get('/api/state');
  const liveBank = await get('/api/bank');
  const liveChannels = await get('/api/channels');
  const liveTemplate = await get('/api/template');
  const liveSettings = await get('/api/settings');
  compare('Current week entries',
    listEntries(db,live.weekStart).map(key).sort((a,b)=>a.id-b.id),
    live.entries.map(key).sort((a,b)=>a.id-b.id));
  compare('Channels',listChannels(db),liveChannels);
  compare('Template',listTemplate(db),liveTemplate);
  compare('Bank',listBank(db),liveBank);
  compare('Settings',getSettings(db),liveSettings);
  const totals=db.prepare("SELECT COUNT(*) AS entries, SUM(CASE WHEN trim(script)!='' THEN 1 ELSE 0 END) AS scripts FROM entries").get();
  console.log('TURSO_CUTOVER_PREFLIGHT_VERIFIED ' + JSON.stringify({
    revision:result.version,currentWeek:live.weekStart,entries:totals.entries,
    scripts:totals.scripts||0,channels:liveChannels.length,bank:liveBank.length,
  }));
} finally {
  db?.close();
  fs.rmSync(dir,{recursive:true,force:true});
}
