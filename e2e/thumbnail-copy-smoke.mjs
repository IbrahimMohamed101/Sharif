import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { startTestServer } from '../test/helpers.js';

const browser = await chromium.launch({ headless: true });
try {
  for(const viewport of [{width:1280,height:900},{width:390,height:844}]) {
    const server = await startTestServer();
    const context = await browser.newContext({ viewport, permissions: ['clipboard-read','clipboard-write'] });
    const page = await context.newPage();
    try {
      const initial = (await server.get('/api/state')).json;
      const selected = initial.entries.find(e => e.day === initial.todayWeekday);
      assert.ok(selected, 'Need a task from the current day');
      const template = 'Thumbnail DNA #283444\nاصنع 3 نسخ احترافية من هذا الموضوع.\nحط الاسكريبت هنا';
      const script = `سطر المقدمة عن التقنية\n${'شرح مليء بالتفاصيل لا يجوز اقتصاصه.\n'.repeat(130)}سطر النهاية الذي يجب نسخه بالكامل`;
      assert.ok(script.length > 3000);
      const picked = 'عنوان تم اختياره';
      const patchChannel = await server.patch('/api/channels/' + selected.channel_id, { image_prompt: template });
      assert.equal(patchChannel.status, 200);
      assert.equal((await server.patch('/api/entries/' + selected.id, { script })).status, 200);
      server.db.prepare('UPDATE entries SET titles = ? WHERE id = ?').run(JSON.stringify([picked, 'عنوان آخر']), selected.id);

      await page.goto(server.base + '/#/today');
      const card = page.locator('.day.today .task').first();
      await card.locator('[data-act="toggle"]').click();
      // Avoid network access to external Google Flow while testing the copy action.
      await page.evaluate(() => { window.open = () => ({ opener: null }); });
      await card.locator('[data-act="pick-title"]').first().click();
      await page.waitForFunction(() => !!document.querySelector('.day.today .task .title-opt.picked'));
      await card.locator('[data-act="flow"]').click();
      const expected = `${template}\n\nالعنوان المختار للفيديو:\n${picked}\n\nالسكريبت الكامل:\n${script}`;
      await page.waitForFunction(async value => (await navigator.clipboard.readText()) === value, expected);
      const text = await page.evaluate(() => navigator.clipboard.readText());
      assert.equal(text, expected, 'Flow copy must preserve full script and exact picked title');
      assert.ok(text.endsWith('سطر النهاية الذي يجب نسخه بالكامل'));

      await card.locator('[data-act="pick-title"]').first().click();
      await page.waitForFunction(() => !document.querySelector('.day.today .task .title-opt.picked'));
      await card.locator('[data-act="flow"]').click();
      const noPicked = `${template}\n\nالسكريبت الكامل:\n${script}`;
      await page.waitForFunction(async value => (await navigator.clipboard.readText()) === value, noPicked);
      assert.ok(!(await page.evaluate(() => navigator.clipboard.readText())).includes('العنوان المختار للفيديو'));

      const editedTemplate = 'Channel rebranding updated at runtime #1da8e1';
      assert.equal((await server.patch('/api/channels/' + selected.channel_id, { image_prompt: editedTemplate })).status, 200);
      await page.reload();
      await card.locator('[data-act="toggle"]').click();
      await page.evaluate(() => { window.open = () => ({ opener: null }); });
      await card.locator('[data-act="flow"]').click();
      await page.waitForFunction(async value => (await navigator.clipboard.readText()) === value,
        `${editedTemplate}\n\nالسكريبت الكامل:\n${script}`);
      console.log('PASS thumbnail copy', viewport.width + 'x' + viewport.height);
    } finally {
      await context.close();
      await server.close();
    }
  }
} finally {
  await browser.close();
}
