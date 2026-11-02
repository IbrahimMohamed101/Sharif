// Assemble the copy-to-Flow text using the channel's current thumbnail template.
// Keep the whole script intact; the short preview returned by the API is only a
// hint for the in-app image generator, not a source of complete script context.
export function composeThumbnailCopy(entry) {
  if (!entry) return '';
  const channelTemplate = typeof entry.channel?.image_prompt === 'string'
    ? entry.channel.image_prompt.trim()
    : '';
  const fallback = String(entry.thumb_prompt || entry.suggested_thumb_prompt || '').trim();
  const base = channelTemplate || fallback;
  const chosenTitle = String(entry.chosen_title || '').trim();
  const script = String(entry.script ?? '');

  return [
    base,
    chosenTitle ? `العنوان المختار للفيديو:\n${chosenTitle}` : '',
    script.trim() ? `السكريبت الكامل:\n${script}` : '',
  ].filter(Boolean).join('\n\n');
}
