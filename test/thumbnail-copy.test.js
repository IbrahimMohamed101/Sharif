import test from 'node:test';
import assert from 'node:assert/strict';
import { composeThumbnailCopy } from '../public/thumbnail-copy.js';

test('uses the current channel image prompt and appends exactly the selected title + full script in order', () => {
  const script = [
    'بداية السكريبت: منتج جديد',
    ...Array.from({ length: 120 }, (_, i) => `السطر رقم ${i + 1}: معلومات مهمة لا يجب اختصارها.`),
    'نهاية السكريبت: الخاتمة الكاملة',
  ].join('\n');
  assert.ok(script.length > 3000);
  const entry = {
    channel: { image_prompt: 'Brand: #283444. Make 3 unique thumbnail variants.\nRTL Arabic typography.' },
    thumb_prompt: 'OLDER SAVED THUMBNAIL PROMPT',
    suggested_thumb_prompt: 'OLD SERVER PREVIEW ONLY',
    chosen_title: 'مفاجأة تقنية',
    title: 'عنوان المهمة العام',
    script,
  };
  const actual = composeThumbnailCopy(entry);
  assert.equal(actual,
    `Brand: #283444. Make 3 unique thumbnail variants.\nRTL Arabic typography.\n\nالعنوان المختار للفيديو:\nمفاجأة تقنية\n\nالسكريبت الكامل:\n${script}`);
  assert.ok(actual.endsWith(script), 'The entire script including its last line must appear at the very end');
  assert.ok(!actual.includes('OLDER SAVED THUMBNAIL PROMPT'));
  assert.ok(!actual.includes('OLD SERVER PREVIEW ONLY'));
});

test('does not invent a chosen title if user has not explicitly picked one', () => {
  const actual = composeThumbnailCopy({
    channel: { image_prompt: 'Use #1da8e1 as the core color.\nحط الاسكريبت هنا' },
    chosen_title: '',
    title: 'العنوان العام',
    script: 'نص كامل\nفي سطرين',
  });
  assert.equal(actual, 'Use #1da8e1 as the core color.\nحط الاسكريبت هنا\n\nالسكريبت الكامل:\nنص كامل\nفي سطرين');
  assert.ok(!actual.includes('العنوان المختار'));
  assert.ok(!actual.includes('العنوان العام'));
});

test('falls back to existing image prompt when the channel has no custom template', () => {
  assert.equal(composeThumbnailCopy({
    channel: { image_prompt: '' },
    thumb_prompt: 'برومبت المهمة',
    suggested_thumb_prompt: 'برومبت عام',
    script: '',
    chosen_title: '',
  }), 'برومبت المهمة');
  assert.equal(composeThumbnailCopy({
    channel: { image_prompt: '' },
    thumb_prompt: '',
    suggested_thumb_prompt: 'الوصف الافتراضي',
    script: 'المحتوى كامل',
  }), 'الوصف الافتراضي\n\nالسكريبت الكامل:\nالمحتوى كامل');
  assert.equal(composeThumbnailCopy(null), '');
});

test('works for all four channel identities without altering custom brand text', () => {
  for(const [channelName,identity] of [
    ['رائج', '#1da8e1'],
    ['القيادي', '#283444'],
    ['سائح', '#efb704 - #536eaf'],
    ['عرب جيمرز', '#b33a93 - #9284d9'],
  ]) {
    const brandPrompt = `إعدادات القناة ${channelName}: الألوان ${identity}. 3 صور مميزة.`;
    const actual = composeThumbnailCopy({
      channel: { name: channelName, image_prompt: brandPrompt },
      chosen_title: 'العنوان المختار',
      script: 'السكريبت الحقيقي',
    });
    assert.ok(actual.startsWith(brandPrompt));
    assert.ok(actual.endsWith('السكريبت الحقيقي'));
    assert.ok(actual.includes('العنوان المختار للفيديو:\nالعنوان المختار'));
  }
});
