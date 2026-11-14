// End-to-end in a real (installed) Chrome, every network request blocked: the
// Quest Certificate and the dashboard's "Source and quests" card for the
// finished synthetic cache-lib course, in light and dark, at desktop and phone
// widths. Press feedback on the certificate's rows starts on pointer-down.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { cli, rmDir, REPO } from '../helpers/cli.mjs';
import { guardGit, cacheCourse, finishCacheCourse } from '../helpers/repoquest.mjs';
import { findChrome } from '../helpers/chrome.mjs';

guardGit();
const OUT = path.join(REPO, 'tests', 'output');
let browser;
const roots = [];
let cert;
let dash;

before(async () => {
  const executablePath = findChrome();
  if (!executablePath) throw new Error('No Chrome, Edge or Chromium found. Set TEACHBACK_CHROME to the browser executable.');
  fs.mkdirSync(OUT, { recursive: true });
  browser = await chromium.launch({ executablePath, headless: true, args: ['--no-first-run', '--disable-extensions'] });
  const c = await cacheCourse((d) => (roots.push(d), d));
  await finishCacheCourse(c);
  const r = await cli(['quest', 'certificate', 'cache', ...c.base]);
  cert = fs.readFileSync(r.json.path, 'utf8');
  const d = await cli(['dashboard', ...c.base]);
  dash = fs.readFileSync(d.json.path, 'utf8');
});

after(async () => {
  await browser?.close();
  for (const r of roots) rmDir(r);
});

async function open(html, { width, height, colorScheme }) {
  const context = await browser.newContext({ viewport: { width, height }, colorScheme, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const requests = [];
  const problems = [];
  await page.route('**/*', (route) => {
    requests.push(route.request().url());
    return route.abort();
  });
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') problems.push(`${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  await page.setContent(html, { waitUntil: 'load' });
  return { context, page, requests, problems };
}

test('certificate: every status is shown, the disclaimer is visible, no request is made, and it fits a phone', async () => {
  for (const [vp, scheme] of [[{ width: 1280, height: 800 }, 'light'], [{ width: 390, height: 844 }, 'dark']]) {
    const { context, page, requests, problems } = await open(cert, { ...vp, colorScheme: scheme });
    try {
      const rows = await page.evaluate(() => [...document.querySelectorAll('[data-status]')].map((r) => [r.dataset.status, r.dataset.value]));
      assert.deepEqual(rows.map((r) => r[0]), ['source_verified', 'concepts_mastered_by_local_model', 'tests_passed', 'teachback_recorded', 'rehearsal_complete', 'reviewed_by_maintainer']);
      assert.deepEqual(rows.map((r) => r[1]), ['true', 'true', 'true', 'true', 'true', 'false']);
      const disclaimer = await page.locator('[data-disclaimer]').textContent();
      assert.equal(disclaimer, 'Self-reported/local test evidence; not a credential or a merged contribution.');
      assert.ok(await page.locator('[data-disclaimer]').isVisible());
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      assert.ok(overflow <= 0, `no sideways scroll (${overflow}px)`);
      assert.deepEqual(requests, []);
      assert.deepEqual(problems, []);
      await page.screenshot({ path: path.join(OUT, `certificate-${vp.width < 600 ? 'phone' : 'desktop'}-${scheme}.png`), fullPage: true });
    } finally {
      await context.close();
    }
  }
});

test('certificate: a pointerdown on a status row applies a transform within 50 ms', async () => {
  const { context, page, problems } = await open(cert, { width: 1280, height: 800, colorScheme: 'light' });
  try {
    const box = await page.locator('summary').first().boundingBox();
    await page.evaluate(() => {
      const s = document.querySelector('summary');
      window.__press = { t0: 0, t1: 0 };
      s.addEventListener('pointerdown', () => {
        window.__press.t0 = performance.now();
        (function poll() {
          if (s.style.transform && s.style.transform !== 'none') window.__press.t1 = performance.now();
          else requestAnimationFrame(poll);
        })();
      }, { capture: true });
    });
    await page.mouse.move(box.x + 20, box.y + box.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(120);
    const press = await page.evaluate(() => window.__press);
    assert.ok(press.t1 > 0 && press.t1 - press.t0 < 50, `transform ${Math.round(press.t1 - press.t0)} ms after pointerdown`);
    await page.mouse.up();
    assert.deepEqual(problems, []);
  } finally {
    await context.close();
  }
});

test('dashboard: the "Source and quests" card lists every quest with its status and the source state', async () => {
  for (const [vp, scheme] of [[{ width: 1280, height: 800 }, 'light'], [{ width: 390, height: 844 }, 'dark']]) {
    const { context, page, requests, problems } = await open(dash, { ...vp, colorScheme: scheme });
    try {
      await page.waitForSelector('[data-repoquest]');
      const quests = await page.evaluate(() => [...document.querySelectorAll('[data-quest]')].map((q) => [q.dataset.quest, q.dataset.status]));
      assert.deepEqual(quests, [['locate-eviction', 'passed'], ['predict-eviction', 'passed'], ['fix-eviction', 'passed']]);
      assert.equal(await page.locator('[data-source]').getAttribute('data-source'), 'current');
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      assert.ok(overflow <= 0, `no sideways scroll (${overflow}px)`);
      assert.deepEqual(requests, []);
      assert.deepEqual(problems, []);
      await page.locator('[data-repoquest]').screenshot({ path: path.join(OUT, `dashboard-repoquest-${vp.width < 600 ? 'phone' : 'desktop'}-${scheme}.png`) });
    } finally {
      await context.close();
    }
  }
});
