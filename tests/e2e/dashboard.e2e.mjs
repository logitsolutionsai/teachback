// End-to-end: render the dashboard for the simulated learner in a real
// (installed) Chrome with every network request blocked, compare the numbers
// on the page with `status --json`, check layout at desktop and phone widths,
// and save screenshots to tests/output/.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { cli, tempDir, rmDir, REPO } from '../helpers/cli.mjs';
import { simulate, DAYS } from '../helpers/simulate.mjs';
import { findChrome } from '../helpers/chrome.mjs';

const OUT = path.join(REPO, 'tests', 'output');
const VIEWPORTS = [
  { name: 'desktop', width: 1280, height: 800 },
  { name: 'phone', width: 390, height: 844 }
];

let browser;
const roots = [];

before(async () => {
  const executablePath = findChrome();
  if (!executablePath) throw new Error('No Chrome, Edge or Chromium found. Set TEACHBACK_CHROME to the browser executable.');
  fs.mkdirSync(OUT, { recursive: true });
  // One headless browser for the whole file; closed in after().
  browser = await chromium.launch({ executablePath, headless: true, args: ['--no-first-run', '--disable-extensions'] });
});

after(async () => {
  await browser?.close();
  for (const r of roots) rmDir(r);
});

async function buildScenario(days, extraSteps = 0) {
  const root = tempDir('teachback-e2e-');
  roots.push(root);
  await simulate(root, { days, extraSteps });
  const now = `${DAYS[days - 1]}T18:00:00.000Z`;
  const status = (await cli(['status', '--root', root, '--now', now, '--json'])).json;
  const file = path.join(root, 'dashboard.html');
  const r = await cli(['dashboard', '--root', root, '--now', now, '--out', file, '--json']);
  assert.equal(r.code, 0, r.err);
  return { status, html: fs.readFileSync(file, 'utf8') };
}

async function openPage({ html, viewport, colorScheme = 'light' }) {
  const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, colorScheme, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const requests = [];
  const problems = [];
  await page.route('**/*', (route) => {
    requests.push(route.request().url());
    return route.abort();
  });
  page.on('console', (msg) => {
    if (msg.type() === 'error' || msg.type() === 'warning') problems.push(`${msg.type()}: ${msg.text()}`);
  });
  page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));
  await page.setContent(html, { waitUntil: 'load' });
  await page.waitForSelector('#chart-calibration svg');
  return { context, page, requests, problems };
}

async function readNumbers(page) {
  return page.evaluate(() => {
    const stat = (k) => document.querySelector(`[data-stat="${k}"]`)?.textContent.trim();
    return {
      mastered: Number(stat('concepts-mastered')),
      total: Number(stat('concepts-total')),
      reviewsDue: Number(stat('reviews-due')),
      exercisesPassed: Number(stat('exercises-passed')),
      exercisesTotal: Number(stat('exercises-total')),
      meanMastery: Number(stat('mean-mastery')),
      calibration: stat('calibration'),
      rebuilt: Boolean(document.querySelector('[data-stat="rebuilt"]')),
      concepts: [...document.querySelectorAll('[data-concept]')].map((e) => [e.dataset.concept, Number(e.dataset.pl)]),
      exercises: [...document.querySelectorAll('[data-exercise]')].map((e) => [e.dataset.exercise, e.dataset.status]),
      nodes: document.querySelectorAll('a.node').length,
      charts: ['chart-progress', 'chart-reviews', 'chart-calibration'].map((id) => Boolean(document.querySelector(`#${id} svg`)))
    };
  });
}

async function layoutProblems(page) {
  return page.evaluate(() => {
    const out = [];
    const vw = document.documentElement.clientWidth;
    if (document.documentElement.scrollWidth > vw + 1) out.push(`page scrolls sideways: ${document.documentElement.scrollWidth} > ${vw}`);
    for (const el of document.querySelectorAll('.card, .tile, .ex, .crow, header h1')) {
      const r = el.getBoundingClientRect();
      if (r.right > vw + 1 || r.left < -1) out.push(`${el.className || el.tagName} spans ${Math.round(r.left)}-${Math.round(r.right)} in ${vw}`);
    }
    // Text must not spill out of its own box (the map scroller is allowed to scroll).
    for (const el of document.querySelectorAll('.tile-value, .tile-sub, .ex-title, .ex-meta, .crow-title, .status, .chip')) {
      if (el.scrollWidth > el.clientWidth + 1) out.push(`text overflows in ${el.className}: "${el.textContent.trim().slice(0, 40)}"`);
    }
    return out;
  });
}

function expectedNumbers(status) {
  return {
    mastered: status.concepts.mastered,
    total: status.concepts.total,
    reviewsDue: status.reviews.dueToday,
    exercisesPassed: status.exercises.passed,
    exercisesTotal: status.exercises.total,
    meanMastery: Math.round(status.concepts.meanMastery * 100),
    calibration: status.calibration.overall.label.charAt(0).toUpperCase() + status.calibration.overall.label.slice(1),
    rebuilt: status.rebuilt,
    concepts: status.conceptList.map((c) => [c.id, Math.round(c.pL * 100)]),
    exercises: status.exercises.list.map((e) => [e.id, e.status])
  };
}

// A synthetic course with 200 concepts and study days far apart: the map must stay
// readable (it scrolls instead of shrinking to a smear) and the date labels on the
// progress chart must not print on top of each other.
function bigCourse() {
  const root = tempDir('teachback-e2e-big-');
  roots.push(root);
  const dir = path.join(root, '.teachback', 'big');
  fs.mkdirSync(dir, { recursive: true });
  let seed = 7;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const concepts = [];
  const items = [];
  for (let i = 0; i < 200; i++) {
    const pre = i ? [...new Set(Array.from({ length: Math.floor(rnd() * 3) }, () => `c${Math.floor(rnd() * i)}`))] : [];
    concepts.push({ id: `c${i}`, name: `Concept number ${i} with a long name`, summary: 'S.', sources: [{ section: String(i) }], prerequisites: pre, misconceptions: [{ id: 'm', description: 'x' }] });
    items.push({ id: `c${i}-num`, concept: `c${i}`, type: 'numeric', prompt: 'N?', answer: 1 });
  }
  const w = (f, v) => fs.writeFileSync(path.join(dir, f), JSON.stringify(v));
  w('course.json', { schema: 'teachback/course@1', slug: 'big', title: 'Big', source: { title: 'Big', citation: 'none' }, licence: 'test', language: 'none', track: [] });
  w('map.json', { schema: 'teachback/map@1', concepts });
  w('items.json', { schema: 'teachback/items@1', items });
  // Study on 1 and 2 October, then again on 14 November.
  const events = [];
  const days = ['2026-10-01', '2026-10-02', '2026-11-14'];
  concepts.forEach((c, i) => events.push({ t: `${days[i % 3]}T09:${String(i % 60).padStart(2, '0')}:00.000Z`, type: 'answer', item: `${c.id}-num`, concept: c.id, result: i % 4 ? 'correct' : 'wrong', mode: 'learn' }));
  w('learner.json', { schema: 'teachback/learner@1', createdAt: '2026-10-01T09:00:00.000Z', settings: { utcOffsetMinutes: 0 }, events });
  return { root, file: path.join(root, 'big.html') };
}

test('dashboard (200 concepts): the map stays readable and chart labels do not collide', async () => {
  const { root, file } = bigCourse();
  const r = await cli(['dashboard', '--root', root, '--now', '2026-11-14T18:00:00Z', '--out', file, '--json']);
  assert.equal(r.code, 0, r.err);
  const html = fs.readFileSync(file, 'utf8');
  for (const viewport of VIEWPORTS) {
    const { context, page, requests, problems } = await openPage({ html, viewport });
    try {
      assert.deepEqual(requests, []);
      assert.deepEqual(problems, []);
      assert.deepEqual(await layoutProblems(page), [], `layout fits at ${viewport.width}px`);
      const nodeWidth = await page.evaluate(() => document.querySelector('a.node .node-box').getBoundingClientRect().width);
      assert.ok(nodeWidth >= 100, `map nodes are drawn at least 100 px wide (got ${Math.round(nodeWidth)})`);
      const overlaps = await page.evaluate(() => {
        const labels = [...document.querySelectorAll('#chart-progress svg text')].filter((t) => /^\d+ [A-Z][a-z]{2}$/.test(t.textContent.trim()));
        const boxes = labels.map((t) => t.getBoundingClientRect());
        const out = [];
        for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) if (boxes[i].right > boxes[j].left && boxes[j].right > boxes[i].left) out.push(`${labels[i].textContent} / ${labels[j].textContent}`);
        return { count: labels.length, out };
      });
      assert.ok(overlaps.count >= 2, 'the first and last study days are labelled');
      assert.deepEqual(overlaps.out, [], 'date labels do not overlap');
      await page.screenshot({ path: path.join(OUT, `dashboard-big-${viewport.name}.png`), clip: { x: 0, y: 0, width: viewport.width, height: 1400 } });
    } finally {
      await context.close();
    }
  }
});

for (const [label, days, extraSteps] of [
  ['midcourse', 2, 1],
  ['rebuilt', 3, 0]
]) {
  test(`dashboard (${label}): offline, numbers match status --json, fits desktop and phone`, async () => {
    const { status, html } = await buildScenario(days, extraSteps);
    if (label === 'rebuilt') assert.equal(status.rebuilt, true, 'the simulated learner should be Rebuilt after day 3');
    else assert.equal(status.rebuilt, false);
    for (const viewport of VIEWPORTS) {
      for (const colorScheme of ['light', 'dark']) {
        const { context, page, requests, problems } = await openPage({ html, viewport, colorScheme });
        try {
          assert.deepEqual(requests, [], `no network requests (saw ${requests.join(', ')})`);
          assert.deepEqual(problems, [], 'no console errors or warnings');
          const got = await readNumbers(page);
          const want = expectedNumbers(status);
          for (const k of Object.keys(want)) assert.deepEqual(got[k], want[k], `${k} on the page equals status --json`);
          assert.equal(got.nodes, status.concepts.total, 'one map node per concept');
          assert.deepEqual(got.charts, [true, true, true], 'all three charts drew');
          assert.deepEqual(await layoutProblems(page), [], `layout fits at ${viewport.width}x${viewport.height} (${colorScheme})`);
          const shot = path.join(OUT, `dashboard-${label}-${viewport.name}-${colorScheme}.png`);
          await page.screenshot({ path: shot, fullPage: true });
          assert.ok(fs.statSync(shot).size > 10000, 'screenshot written');
          // Shorter crops for the README: the top of the page.
          if (viewport.name === 'desktop') {
            const bottom = await page.evaluate(() => document.querySelector('.grid').getBoundingClientRect().top + window.scrollY - 8);
            await page.screenshot({ path: path.join(OUT, `readme-${label}-desktop-${colorScheme}.png`), fullPage: true, clip: { x: 0, y: 0, width: viewport.width, height: Math.round(bottom) } });
          } else {
            await page.screenshot({ path: path.join(OUT, `readme-${label}-phone-${colorScheme}.png`) });
          }
          // Keyboard: the first Tab reaches the skip link; map nodes are focusable and show their tooltip.
          await page.keyboard.press('Tab');
          assert.equal(await page.evaluate(() => document.activeElement?.className), 'skip');
          await page.focus('a.node');
          assert.equal(await page.evaluate(() => document.getElementById('tip').hidden), false, 'focusing a concept shows its details');
          await page.evaluate(() => document.activeElement.blur());
        } finally {
          await context.close();
        }
      }
    }
  });
}
