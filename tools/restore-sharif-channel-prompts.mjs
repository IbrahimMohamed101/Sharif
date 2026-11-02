import fs from 'node:fs';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { buildTitlesPrompt, buildThumbnailPrompt } from '../server/ai.js';

const BASE = 'https://sharif-gc4c.onrender.com';
const source = JSON.parse(fs.readFileSync(new URL('../ops/sharif-channel-prompts-2026-11-03.json', import.meta.url), 'utf8'));
const nameToColor = new Map([
  ['القيادي', '#4c7cff'],
  ['رائج', '#ff3d68'],
  ['عرب جيمرز', '#a855f7'],
  ['سائح', '#14c8b0'],
]);
const fingerprint = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const delay = ms => new Promise(r => setTimeout(r, ms));

async function api(path, { method = 'GET', body, retries = 3 } = {}) {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const response = await fetch(BASE + path, {
        method,
        headers: body ? { 'content-type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(60_000),
      });
      if (!response.ok) throw new Error(method + ' ' + path + ': HTTP ' + response.status + ' ' + (await response.text()).slice(0, 180));
      return await response.json();
    } catch (error) {
      // We must not retry a PATCH blindly: it may already have committed.
      if (method !== 'GET' || attempt === retries - 1) throw error;
      await delay(2000 * (attempt + 1));
    }
  }
}
const before = await api('/api/channels');
const presetNames = new Set(source.presets.map(p => p.name));
assert.equal(source.presets.length, 4, 'Expect exactly four channel presets');
assert.equal(presetNames.size, 4, 'Duplicate preset names are not allowed');

const channels = new Map(before.filter(c => presetNames.has(c.name)).map(c => [c.name, c]));
assert.equal(channels.size, 4, 'All four known channels must exist before touching any');
for (const p of source.presets) {
  const c = channels.get(p.name);
  assert.ok(c && Number.isInteger(c.id), 'Cannot identify channel: ' + p.name);
  assert.equal(c.color.toLowerCase(), nameToColor.get(p.name), 'Channel identity color changed: ' + p.name + '. Stop instead of applying a mismatched prompt.');
  for (const key of ['title_prompt', 'image_prompt']) {
    assert.ok(typeof p[key] === 'string' && p[key].length > 150 && p[key].length < 5000, 'Bad prompt length');
  }
  const combined = buildThumbnailPrompt({ channel: { ...c, image_prompt: p.image_prompt }, title: 'عنوان قصير', script: 'موضوع الفيديو' });
  assert.ok(combined.includes(nameToColor.get(p.name).toUpperCase()), 'Image generation prompt missing color: ' + p.name);
  const title = buildTitlesPrompt({ channel: { ...c, title_prompt: p.title_prompt }, entry: { title: 'عنوان', script: 'نص' }, count: 5 });
  assert.ok(title.includes(p.title_prompt) && title.includes('JSON'), 'Title prompt missing or malformed: ' + p.name);
}

// Backup ONLY the four channel rows before the first write. Actions uploads this
// private artifact even if a later write fails. All user content is otherwise untouched.
fs.writeFileSync('sharif-channel-prompts-before.json', JSON.stringify({
  capturedAt: new Date().toISOString(),
  channels: [...channels.values()],
}, null, 2));
const beforeState = await api('/api/state');
const beforeTemplate = await api('/api/template');
const beforeBank = await api('/api/bank');
const ids = beforeState.entries.map(e => [e.id, e.script, e.notes, e.titles, e.thumb_prompt, e.thumb_url, e.done]);
const beforeSignature = {
  entries: fingerprint(ids),
  template: fingerprint(beforeTemplate),
  bank: fingerprint(beforeBank),
};
console.log('PREFLIGHT_OK ' + JSON.stringify({
  channels: [...channels.keys()],
  original: [...channels.values()].map(c => ({ name: c.name, imagePromptChars: c.image_prompt?.length || 0, titlePromptChars: c.title_prompt?.length || 0 })),
  currentWeekEntries: ids.length,
}));

for (const preset of source.presets) {
  const channel = channels.get(preset.name);
  const patch = { title_prompt: preset.title_prompt, image_prompt: preset.image_prompt };
  // The channel PATCH endpoint supports updating only these two fields.
  let updated;
  try {
    updated = await api('/api/channels/' + channel.id, { method: 'PATCH', body: patch });
  } catch (error) {
    // If the connection failed after commit, a fresh read can prove success.
    const check = (await api('/api/channels')).find(c => c.id === channel.id);
    if (check?.title_prompt !== patch.title_prompt || check?.image_prompt !== patch.image_prompt) throw error;
    updated = check;
  }
  assert.equal(updated.title_prompt, patch.title_prompt);
  assert.equal(updated.image_prompt, patch.image_prompt);
  assert.equal(updated.color, channel.color);
  assert.equal(updated.style, channel.style);
  console.log('SAVED ' + preset.name + ': ' + patch.title_prompt.length + ' title chars, ' + patch.image_prompt.length + ' image chars');
}

const after = await api('/api/channels');
for (const p of source.presets) {
  const updated = after.find(c => c.name === p.name);
  assert.ok(updated, 'Channel disappeared: ' + p.name);
  assert.equal(updated.title_prompt, p.title_prompt, 'Title prompt not persisted: ' + p.name);
  assert.equal(updated.image_prompt, p.image_prompt, 'Image prompt not persisted: ' + p.name);
  const original = channels.get(p.name);
  for (const field of ['id', 'name', 'color', 'icon', 'style', 'position']) {
    assert.deepEqual(updated[field], original[field], 'Changed unexpected channel field ' + field + ': ' + p.name);
  }
}
const afterState = await api('/api/state');
const afterTemplate = await api('/api/template');
const afterBank = await api('/api/bank');
const afterSignature = {
  entries: fingerprint(afterState.entries.map(e => [e.id, e.script, e.notes, e.titles, e.thumb_prompt, e.thumb_url, e.done])),
  template: fingerprint(afterTemplate),
  bank: fingerprint(afterBank),
};
assert.deepEqual(afterSignature, beforeSignature, 'Unrelated scripts, tasks or bank content changed during update');
console.log('CHANNEL_PROMPTS_RESTORED_AND_VERIFIED ' + JSON.stringify({
  count: source.presets.length,
  names: source.presets.map(p => p.name),
  scriptsAndTasksUnchanged: true,
  savedToDurableTurso: true,
}));
