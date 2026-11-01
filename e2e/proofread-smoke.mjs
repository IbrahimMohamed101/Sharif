import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { startTestServer } from '../test/helpers.js';

// Browser-level smoke test with an isolated in-memory database and a mocked AI result.
const browser = await chromium.launch({ headless: true });
try {
  for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
    const server = await startTestServer({ env: { GEMINI_API_KEY: 'browser-test-key' } });
    const page = await browser.newPage({ viewport });
    try {
      await page.goto(server.base);
      await page.locator('a[href="#/scripts"]').click();
      const card = page.locator('.s-card').first();
      await card.waitFor();
      const editor = card.locator('textarea[data-field="script"]');
      const proofread = card.locator('button[data-act="proofread"]');
      assert.equal(await proofread.isDisabled(), true, 'Empty script should disable proofreading');
      await editor.fill('هزا سكريبت قبل التدقيق');
      assert.equal(await proofread.isEnabled(), true, 'Typing must enable proofreading without page navigation');

      const notesPanel = card.locator('details.script-notes');
      assert.equal(await notesPanel.getAttribute('open'), null);
      await notesPanel.locator('summary').click();
      await notesPanel.locator('textarea[data-field="notes"]').fill('مرجع: https://example.com/article');
      assert.equal(await notesPanel.locator('.links a').count(), 1, 'Notes should detect reference links');
      await notesPanel.locator('summary').click();
      assert.equal(await notesPanel.getAttribute('open'), null, 'Accordion should close');
      await notesPanel.locator('summary').click();

      await page.route('**/api/entries/*/proofread', async (route) => {
        const id = Number(route.request().url().match(/entries\/(\d+)\/proofread/)[1]);
        const state = (await server.get('/api/state')).json;
        const entry = state.entries.find((item) => item.id === id);
        const corrected = 'هذا سكريبت بعد التدقيق';
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ script: corrected, entry: { ...entry, script: corrected } }),
        });
      });
      await proofread.click();
      await page.waitForFunction(() => document.querySelector('.s-card textarea[data-field="script"]')?.value === 'هذا سكريبت بعد التدقيق');
      assert.equal(await page.locator('.s-card details.script-notes').first().getAttribute('open'), '');
      assert.equal(await page.locator('.s-card details.script-notes .links a').first().getAttribute('href'), 'https://example.com/article');
      await page.goto(server.base + '/#/week');
      await page.locator('.task:not(.s-card) [data-act="toggle"]').first().click();
      assert.ok(await page.locator('.task.open details.script-notes').count(), 'Week view should include the notes accordion');
      console.log('PASS browser', viewport.width, 'x', viewport.height);
    } finally {
      await page.close();
      await server.close();
    }
  }
} finally {
  await browser.close();
}
