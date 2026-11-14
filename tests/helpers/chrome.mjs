// Finds an installed Chrome, Edge or Chromium. TEACHBACK_CHROME overrides.
// Never downloads a browser.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export function findChrome() {
  const env = process.env.TEACHBACK_CHROME;
  if (env) return fs.existsSync(env) ? env : null;
  const candidates = [];
  if (process.platform === 'win32') {
    const roots = [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA, 'C:\\Program Files', 'C:\\Program Files (x86)'].filter(Boolean);
    for (const r of roots) {
      candidates.push(
        path.join(r, 'Google', 'Chrome', 'Application', 'chrome.exe'),
        path.join(r, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
        path.join(r, 'Chromium', 'Application', 'chrome.exe')
      );
    }
  } else if (process.platform === 'darwin') {
    candidates.push(
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'
    );
  } else {
    for (const name of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge', 'microsoft-edge-stable']) {
      const r = spawnSync('which', [name], { encoding: 'utf8' });
      if (r.status === 0 && r.stdout.trim()) candidates.push(r.stdout.trim());
    }
  }
  return candidates.find((p) => fs.existsSync(p)) ?? null;
}
