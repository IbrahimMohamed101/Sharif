import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { startTestServer } from '../test/helpers.js';

// Browser-level smoke test with an isolated in-memory database and a mocked AI result.
const browser = await chromium.launch({ headless: true });
try {
  for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
    const server = await startTestServer({ env: { GEMINI_API_KEY: 'browser-test-key' } });
    const context = await browser.newContext({ viewport, permissions: ['clipboard-read', 'clipboard-write'] });
    const page = await context.newPage();
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
      const copy = card.locator('button[data-act="copy-script"]');
      assert.equal(await copy.isEnabled(), true, 'Typing must immediately enable the copy button');
      await copy.click();
      assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'هزا سكريبت قبل التدقيق');

      const notesPanel = card.locator('details.script-notes');
      assert.equal(await notesPanel.getAttribute('open'), null);
      await notesPanel.locator('summary').click();
      await notesPanel.locator('textarea[data-field="notes"]').fill('مرجع: https://example.com/article');
      assert.equal(await notesPanel.locator('.links a').count(), 1, 'Notes should detect reference links');
      const shortcuts = card.locator('[data-note-shortcuts]');
      assert.equal(await shortcuts.locator('a').count(), 1, 'A quick-open link must appear as soon as a URL is typed');
      assert.equal(await shortcuts.locator('a').getAttribute('href'), 'https://example.com/article');
      await notesPanel.locator('summary').click();
      assert.equal(await notesPanel.getAttribute('open'), null, 'Accordion should close');
      assert.equal(await shortcuts.locator('a').isVisible(), true, 'Quick-open action remains visible without opening notes');
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
      await page.goto(server.base + '/#/today');
      const daily = page.locator('.day.today .task').first();
      await daily.locator('[data-act="toggle"]').click();
      assert.equal(await daily.locator('.t-body').count(), 1, 'Daily task must expand');
      const dailyNotes = daily.locator('details.script-notes');
      // The same task may have already been expanded in the Scripts tab.
      // Start from a known collapsed state so this checks opening, not closing.
      if (await dailyNotes.getAttribute('open') !== null) await dailyNotes.locator('summary').click();
      assert.equal(await dailyNotes.getAttribute('open'), null, 'Start daily notes collapsed');
      await dailyNotes.locator('summary').click();
      assert.equal(await daily.locator('.t-body').count(), 1, 'Opening nested notes must NOT close its parent task');
      assert.equal(await dailyNotes.getAttribute('open'), '', 'Notes should expand inside the daily task');
      const dailyNoteText = dailyNotes.locator('textarea[data-field="notes"]');
      await dailyNoteText.fill('مصدر جديد: https://example.org/test');
      const dailyQuick = daily.locator('[data-note-shortcuts] a');
      assert.equal(await dailyQuick.getAttribute('href'), 'https://example.org/test', 'Quick link should update immediately');
      await dailyNotes.locator('summary').click();
      assert.equal(await dailyNotes.getAttribute('open'), null, 'Nested notes should close without collapsing task');
      assert.equal(await daily.locator('.t-body').count(), 1, 'Parent task remains expanded after closing notes');
      assert.equal(await dailyQuick.isVisible(), true, 'Link must remain visible beside the collapsed notes label');
      const popupPromise = page.waitForEvent('popup');
      await dailyQuick.click();
      const popup = await popupPromise;
      assert.equal(await popup.opener(), page, 'Quick link opens a new tab');
      await popup.close();
      assert.equal(await daily.locator('.t-body').count(), 1, 'Opening quick link must not collapse the task');
      await page.goto(server.base + '/#/week');
      await page.locator('.task:not(.s-card) [data-act="toggle"]').first().click();
      assert.ok(await page.locator('.task.open details.script-notes').count(), 'Week view should include the notes accordion');
      console.log('PASS browser', viewport.width, 'x', viewport.height);
    } finally {
      await context.close();
      await server.close();
    }
  }
} finally {
  await browser.close();
}
