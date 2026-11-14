// Export the question bank as an Anki-importable CSV (Front, Back, Tags).
import { escapeHtml } from './util.mjs';

function csvField(s) {
  const v = String(s ?? '');
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

function tagOf(s) {
  return String(s).replace(/[^A-Za-z0-9_-]+/g, '_');
}

export function backFor(item) {
  const parts = [];
  if (item.type === 'mcq') {
    const o = item.options[item.answer];
    parts.push(`<b>${String.fromCharCode(65 + item.answer)}. ${escapeHtml(o.text)}</b>`, escapeHtml(o.rationale));
  } else if (item.type === 'numeric') {
    parts.push(`<b>${escapeHtml(item.answer)}${item.unit ? ` ${escapeHtml(item.unit)}` : ''}</b>`);
    if (item.explanation) parts.push(escapeHtml(item.explanation));
  } else {
    if (item.modelAnswer) parts.push(escapeHtml(item.modelAnswer));
    const ideas = item.rubric?.required ?? [];
    if (ideas.length) parts.push(`<i>Key ideas:</i> ${ideas.map((r) => escapeHtml(r.idea)).join('; ')}`);
  }
  if (item.source) parts.push(`<small>Source: section ${escapeHtml(item.source)}</small>`);
  return parts.join('<br>');
}

export function frontFor(item) {
  let front = escapeHtml(item.prompt);
  if (item.type === 'mcq') front += `<br>${item.options.map((o, i) => `${String.fromCharCode(65 + i)}. ${escapeHtml(o.text)}`).join('<br>')}`;
  return front;
}

export function exportAnki(courseData) {
  const rows = ['#separator:comma', '#html:true', '#columns:Front,Back,Tags', `#deck:${csvField(`teachback::${courseData.course.title ?? courseData.slug}`)}`];
  let count = 0;
  let skipped = 0;
  for (const item of courseData.itemList) {
    if (item.type === 'code') {
      skipped += 1;
      continue;
    }
    const tags = [`teachback`, tagOf(courseData.slug), tagOf(item.concept), item.type].join(' ');
    rows.push([frontFor(item), backFor(item), tags].map(csvField).join(','));
    count += 1;
  }
  return { csv: `${rows.join('\n')}\n`, count, skipped };
}
