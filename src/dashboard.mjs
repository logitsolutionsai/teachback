// Renders one standalone, offline HTML dashboard from the status object.
// No external requests: styles, script and data are inline. The concept map is
// drawn here as static SVG; the three small charts are drawn by an inline
// script at the width of their container, and every number also appears in
// static HTML (stat tiles, lists and table views) so nothing depends on script.
import { escapeHtml as h, masteryPercent } from './util.mjs';
import { layoutDag, edgePath } from './graph.mjs';
import { STATE_LABEL } from './status.mjs';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function fmtDay(day) {
  if (!day) return '';
  const [y, m, d] = day.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

function shortDay(day) {
  const [, m, d] = day.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]}`;
}

const pctOf = (x) => Math.round((x ?? 0) * 100);

// Greedy word wrap by character budget; at most `maxLines` lines.
export function wrapText(text, maxChars, maxLines = 2) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let cur = '';
  for (const w of words) {
    if (!cur) cur = w;
    else if ((cur + ' ' + w).length <= maxChars) cur += ` ${w}`;
    else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    kept[maxLines - 1] = `${kept[maxLines - 1].slice(0, maxChars - 1)}…`;
    return kept;
  }
  return lines;
}

const ICON = {
  check: '<svg class="ico" viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  cross: '<svg class="ico" viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 4.5l7 7M11.5 4.5l-7 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  clock: '<svg class="ico" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M8 5v3.2l2 1.3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  circle: '<svg class="ico" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>'
};

function conceptMap(s) {
  const concepts = s.conceptList.map((c) => ({ id: c.id, prerequisites: c.prerequisites }));
  const NODE_W = 172;
  const NODE_H = 64;
  const PAD = 18;
  const TAG = 20; // room above the top row for the "Next" tag
  const L = layoutDag(concepts, { nodeW: NODE_W, nodeH: NODE_H, gapX: 18, gapY: 54, dummyW: 14 });
  const W = Math.ceil(L.width + PAD * 2);
  const H = Math.ceil(L.height + PAD * 2 + TAG);
  const byId = new Map(s.conceptList.map((c) => [c.id, c]));
  const nextId = s.next.kind === 'learn' ? s.next.concept : null;
  const ox = PAD;
  const oy = PAD + TAG;
  const edges = L.edges
    .map((e) => {
      const pts = e.points.map((p) => ({ x: p.x + ox, y: p.y + oy }));
      const last = pts[pts.length - 1];
      pts[pts.length - 1] = { x: last.x, y: last.y - 4 }; // leave room for the arrowhead
      const strong = byId.get(e.from)?.mastered;
      return `<path class="edge${strong ? ' edge-strong' : ''}" d="${edgePath(pts)}" marker-end="url(#${strong ? 'arrow-strong' : 'arrow'})"/>`;
    })
    .join('');
  const nodes = L.nodes
    .map((n) => {
      const c = byId.get(n.id);
      const x = n.x + ox;
      const y = n.y + oy;
      const lines = wrapText(c.name, 21, 2);
      const isNext = c.id === nextId;
      const shown = masteryPercent(c.pL, c.mastered, s.masteryThreshold);
      const label = `${c.name}: ${STATE_LABEL[c.state]}, mastery estimate ${shown}%${isNext ? '. Next up' : ''}`;
      const tip = `${c.name}|${STATE_LABEL[c.state]} · ${shown}%|${c.attempts} answer${c.attempts === 1 ? '' : 's'} (${c.correct} correct)${c.prerequisites.length ? `|After: ${c.prerequisites.map((p) => byId.get(p)?.name ?? p).join(', ')}` : ''}`;
      const textY = lines.length === 1 ? y + 26 : y + 20;
      const nameSvg = lines.map((ln, i) => `<tspan x="${x + 12}" y="${textY + i * 15}">${h(ln)}</tspan>`).join('');
      const pctText = `${c.mastered ? '✓ ' : ''}${shown}%`;
      return `<a class="node st-${c.state}${isNext ? ' is-next' : ''}" href="#c-${h(c.id)}" aria-label="${h(label)}" data-tip="${h(tip)}">
<rect class="node-ring" x="${x - 4}" y="${y - 4}" width="${NODE_W + 8}" height="${NODE_H + 8}" rx="13"/>
<rect class="node-box" x="${x}" y="${y}" width="${NODE_W}" height="${NODE_H}" rx="10"/>
<text class="node-name">${nameSvg}</text>
<text class="node-pct" x="${x + NODE_W - 12}" y="${y + NODE_H - 9}" text-anchor="end">${pctText}</text>
${isNext ? `<g class="next-tag"><rect x="${x + 10}" y="${y - 19}" width="40" height="17" rx="8.5"/><text x="${x + 30}" y="${y - 6.5}" text-anchor="middle">Next</text></g>` : ''}
</a>`;
    })
    .join('\n');
  // Never shrink the map below 60% (labels stay readable); a wider map scrolls sideways.
  const minW = Math.min(W, Math.max(560, Math.round(W * 0.6)));
  return `<svg class="map-svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" style="max-width:${W}px;min-width:${minW}px" role="group" aria-label="Concept map: ${s.conceptList.length} concepts in ${L.layers} layers. Arrows run from a prerequisite to the concept that builds on it.">
<defs>
<marker id="arrow" viewBox="0 0 8 8" refX="6" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0.8 L7,4 L0,7.2 z" class="arrow-head"/></marker>
<marker id="arrow-strong" viewBox="0 0 8 8" refX="6" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0.8 L7,4 L0,7.2 z" class="arrow-head-strong"/></marker>
</defs>
<g class="edges">${edges}</g>
<g class="nodes">${nodes}</g>
</svg>`;
}

function masteryBar(s) {
  const total = s.concepts.total || 1;
  const counts = {
    mastered: s.conceptList.filter((c) => c.state === 'mastered').length,
    almost: s.conceptList.filter((c) => c.state === 'almost').length,
    learning: s.conceptList.filter((c) => c.state === 'learning').length,
    'not-started': s.conceptList.filter((c) => c.state === 'not-started').length
  };
  const segs = Object.entries(counts)
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `<span class="seg st-${k}" style="flex-grow:${n}" title="${STATE_LABEL[k]}: ${n}"></span>`)
    .join('');
  const legend = Object.entries(counts)
    .map(([k, n]) => `<li><span class="key st-${k}" aria-hidden="true"></span>${STATE_LABEL[k]} <b>${n}</b></li>`)
    .join('');
  return `<div class="segbar" role="img" aria-label="${counts.mastered} mastered, ${counts.almost} almost there, ${counts.learning} learning, ${counts['not-started']} not started, of ${total}">${segs}</div><ul class="legend">${legend}</ul>`;
}

function nextCard(s) {
  const n = s.next;
  let title;
  if (n.kind === 'review') title = `Review ${s.reviews.dueToday} item${s.reviews.dueToday === 1 ? '' : 's'}, starting with ${n.conceptName ?? n.concept}`;
  else if (n.kind === 'learn') title = `${n.activity === 'teachback' ? 'Teach back' : n.activity === 'exercise' ? 'Rebuild in code' : 'Learn'}: ${n.conceptName}`;
  else if (n.kind === 'exercise') title = `Rebuild: exercise ${n.exercise}`;
  else title = n.kind === 'rebuilt' ? 'Rebuilt' : 'Complete';
  return `<section class="card next" aria-labelledby="next-h"><p class="eyebrow">Next session</p><h2 id="next-h">${h(title)}</h2><p class="muted">${h(n.reason)}</p><p class="cmd"><code>teachback next</code></p></section>`;
}

function tiles(s) {
  const o = s.calibration.overall;
  const calText = o.n ? `Claimed ${pctOf(o.meanConfidence)}%, right ${pctOf(o.accuracy)}%, ${o.n} rated answer${o.n === 1 ? '' : 's'}` : 'Rate confidence 1-4 when answering to see this';
  const capstone = s.exercises.list.find((e) => e.capstone);
  return `<div class="tiles">
<div class="tile"><p class="tile-label">Reviews due today</p><p class="tile-value" data-stat="reviews-due">${s.reviews.dueToday}</p><p class="tile-sub">${s.reviews.nextReviewDay ? `Next after today: ${h(fmtDay(s.reviews.nextReviewDay))}` : 'Nothing scheduled after today'}</p></div>
<div class="tile"><p class="tile-label">Exercises passed</p><p class="tile-value"><span data-stat="exercises-passed">${s.exercises.passed}</span><span class="of"> / <span data-stat="exercises-total">${s.exercises.total}</span></span></p><p class="tile-sub">${capstone ? `Capstone ${capstone.status === 'passed' ? 'passes' : 'not passed yet'}` : 'No capstone in this course'}</p></div>
<div class="tile"><p class="tile-label">Mean mastery estimate</p><p class="tile-value"><span data-stat="mean-mastery">${pctOf(s.concepts.meanMastery)}</span><span class="of">%</span></p><p class="tile-sub">Across all ${s.concepts.total} concepts</p></div>
<div class="tile"><p class="tile-label">Calibration</p><p class="tile-value tile-word" data-stat="calibration">${h(o.label.charAt(0).toUpperCase() + o.label.slice(1))}</p><p class="tile-sub">${h(calText)}</p></div>
</div>`;
}

function exerciseBoard(s) {
  if (!s.exercises.list.length) return '<p class="muted">This course has no rebuild track.</p>';
  const rows = s.exercises.list
    .map((e, i) => {
      const st = {
        passed: ['good', ICON.check, 'Passed'],
        failing: ['serious', ICON.cross, 'Failing'],
        timeout: ['serious', ICON.clock, 'Timed out'],
        'not-started': ['idle', ICON.circle, 'Not started']
      }[e.status];
      const tests = e.runs ? `${e.lastPassed}/${e.lastTotal} tests on the last run, ${e.runs} run${e.runs === 1 ? '' : 's'}` : 'No runs yet';
      return `<li class="ex ex-${e.status}${e.capstone ? ' ex-capstone' : ''}" data-exercise="${h(e.id)}" data-status="${e.status}">
<span class="ex-num" aria-hidden="true">${i + 1}</span>
<div class="ex-body"><p class="ex-title">${h(e.title)}${e.capstone ? ' <span class="tag">Capstone</span>' : ''}</p><p class="ex-meta">${h(e.id)} · ${h(tests)}</p></div>
<span class="status status-${st[0]}">${st[1]}${st[2]}</span>
</li>`;
    })
    .join('');
  return `<ol class="board">${rows}</ol>`;
}

function dueList(s) {
  if (!s.reviews.due.length) return '<p class="muted small">Nothing is due today.</p>';
  const names = new Map(s.conceptList.map((c) => [c.id, c.name]));
  const items = s.reviews.due
    .slice(0, 6)
    .map((d) => `<li><code>${h(d.item)}</code> <span class="muted">${h(names.get(d.concept) ?? d.concept)}${d.overdueDays > 0 ? ` · ${d.overdueDays} day${d.overdueDays === 1 ? '' : 's'} overdue` : ''}</span></li>`)
    .join('');
  const more = s.reviews.dueToday > 6 ? `<li class="muted">and ${s.reviews.dueToday - 6} more</li>` : '';
  return `<ul class="due">${items}${more}</ul>`;
}

function conceptRows(s) {
  return s.conceptList
    .map((c) => {
      const cal = c.calibration && c.calibration.n >= 3 && c.calibration.label !== 'calibrated' ? `<span class="flag">${h(c.calibration.label)}</span>` : '';
      const shown = masteryPercent(c.pL, c.mastered, s.masteryThreshold);
      return `<li class="crow" id="c-${h(c.id)}" data-concept="${h(c.id)}" data-pl="${pctOf(c.pL)}" tabindex="-1">
<div class="crow-name"><p class="crow-title">${h(c.name)}</p><p class="crow-meta">Section ${h(c.sources.join(', ')) || 'n/a'}${c.prerequisites.length ? ` · after ${c.prerequisites.length} concept${c.prerequisites.length === 1 ? '' : 's'}` : ''}</p></div>
<span class="chip st-${c.state}">${STATE_LABEL[c.state]}</span>
<div class="meter" role="img" aria-label="Mastery estimate ${shown}%"><span class="meter-fill" style="width:${pctOf(c.pL)}%"></span><span class="meter-mark" aria-hidden="true" style="left:${pctOf(s.masteryThreshold)}%"></span></div>
<span class="crow-pct">${shown}%</span>
<p class="crow-ev">${c.attempts ? `${c.attempts} answer${c.attempts === 1 ? '' : 's'}: ${c.correct} right, ${c.partial} partly, ${c.wrong} wrong` : 'No answers yet'}${c.teachbackPassed ? ' · taught back' : ''}${cal ? ` ${cal}` : ''}</p>
</li>`;
    })
    .join('');
}

function tables(s) {
  const hist = s.history.length
    ? s.history.map((r) => `<tr><td>${h(fmtDay(r.day))}</td><td>${r.mastered}</td><td>${pctOf(r.meanMastery)}%</td></tr>`).join('')
    : '<tr><td colspan="3">No study days yet</td></tr>';
  const up = [...s.reviews.upcoming.map((u) => `<tr><td>${h(fmtDay(u.day))}</td><td>${u.count}</td></tr>`)].join('');
  const cal = s.calibration.byLevel.map((l) => `<tr><td>${l.level} ${h(l.label)}</td><td>${pctOf(l.expected)}%</td><td>${l.accuracy == null ? 'n/a' : `${pctOf(l.accuracy)}%`}</td><td>${l.n}</td></tr>`).join('');
  return {
    hist: `<details class="tv"><summary>Table view</summary><div class="tv-scroll"><table><thead><tr><th>Day</th><th>Mastered</th><th>Mean estimate</th></tr></thead><tbody>${hist}</tbody></table></div></details>`,
    up: `<details class="tv"><summary>Table view</summary><div class="tv-scroll"><table><thead><tr><th>Day</th><th>Reviews due</th></tr></thead><tbody>${up}</tbody></table></div></details>`,
    cal: `<details class="tv"><summary>Table view</summary><div class="tv-scroll"><table><thead><tr><th>Confidence</th><th>Claims</th><th>Right</th><th>Answers</th></tr></thead><tbody>${cal}</tbody></table></div></details>`
  };
}

function calibrationFlags(s) {
  const flagged = s.conceptList.filter((c) => c.calibration && c.calibration.n >= 3 && c.calibration.label !== 'calibrated');
  if (!flagged.length) return '<p class="muted small">No concept shows a confidence gap yet (needs 3 or more rated answers per concept).</p>';
  return `<ul class="flags">${flagged
    .map((c) => `<li><span class="flag">${h(c.calibration.label)}</span> ${h(c.name)} <span class="muted">(${pctOf(c.calibration.meanConfidence)}% claimed, ${pctOf(c.calibration.accuracy)}% right)</span></li>`)
    .join('')}</ul>`;
}

const CSS = String.raw`
:root{
  color-scheme:light;
  --page:#f9f9f7;--surface:#fcfcfb;--ink:#0b0b0b;--ink-2:#52514e;--muted:#6f6e69;--axis:#898781;
  --grid:#e1e0d9;--base:#c3c2b7;--border:rgba(11,11,11,.10);
  --series:#2a78d6;--series-wash:rgba(42,120,214,.10);
  --m-learning:#86b6ef;--m-learning-ink:#0b0b0b;
  --m-almost:#2a78d6;--m-almost-ink:#ffffff;
  --m-mastered:#104281;--m-mastered-ink:#ffffff;
  --m-none:#fcfcfb;--m-none-ink:#0b0b0b;--m-none-line:#c3c2b7;
  --edge:#cfcec7;--edge-strong:#7d8ea6;
  --good:#0ca30c;--good-ink:#006300;--serious:#ec835a;--serious-ink:#a3401a;
  --focus:#2a78d6;--tip-bg:#0b0b0b;--tip-ink:#f9f9f7;
}
@media (prefers-color-scheme:dark){
  :root{
    color-scheme:dark;
    --page:#0d0d0d;--surface:#1a1a19;--ink:#f0efec;--ink-2:#c3c2b7;--muted:#a3a29b;--axis:#898781;
    --grid:#2c2c2a;--base:#383835;--border:rgba(255,255,255,.10);
    --series:#3987e5;--series-wash:rgba(57,135,229,.12);
    --m-learning:#184f95;--m-learning-ink:#ffffff;
    --m-almost:#2a78d6;--m-almost-ink:#ffffff;
    --m-mastered:#86b6ef;--m-mastered-ink:#0b0b0b;
    --m-none:#1a1a19;--m-none-ink:#f0efec;--m-none-line:#4a4a46;
    --edge:#3c3c39;--edge-strong:#6c7f9c;
    --good:#0ca30c;--good-ink:#0ca30c;--serious:#ec835a;--serious-ink:#ec835a;
    --focus:#86b6ef;--tip-bg:#f0efec;--tip-ink:#0b0b0b;
  }
}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--page);color:var(--ink);font:14px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif}
a{color:inherit}
code{font:12.5px/1.4 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
.wrap{max-width:1120px;margin:0 auto;padding-inline:16px}
.skip{position:absolute;left:-999px;top:8px;background:var(--surface);padding:8px 12px;border-radius:8px;border:1px solid var(--border);z-index:5}
.skip:focus{left:16px}
:focus-visible{outline:2px solid var(--focus);outline-offset:2px}
.masthead{padding-block:28px 8px}
.brand{margin:0 0 10px;font-size:12.5px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);font-weight:600}
h1{margin:0;font-size:clamp(22px,4.2vw,30px);line-height:1.2;font-weight:650;letter-spacing:-.01em;text-wrap:balance}
.cite{margin:6px 0 0;color:var(--ink-2);max-width:72ch}
.cite a{color:var(--ink-2);text-underline-offset:2px}
.meta{margin:4px 0 0;color:var(--muted);font-size:13px}
main{padding-block:12px 40px;display:grid;gap:16px}
.card{background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:20px;min-width:0}
.card h2{margin:0;font-size:15.5px;font-weight:650;letter-spacing:-.005em}
.card-head{display:flex;flex-wrap:wrap;gap:4px 16px;align-items:baseline;justify-content:space-between;margin-bottom:12px}
.card-sub{margin:2px 0 0;color:var(--muted);font-size:13px}
.eyebrow{margin:0 0 4px;font-size:12px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;color:var(--muted)}
.muted{color:var(--muted)}
.small{font-size:13px}
.summary{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.6fr);gap:24px;align-items:start}
.hero-figure{margin:0;font-size:56px;line-height:1;font-weight:650;letter-spacing:-.02em}
.hero-figure .of{font-size:22px;font-weight:500;color:var(--ink-2);letter-spacing:0;margin-left:6px}
.hero-label{margin:6px 0 14px;color:var(--ink-2)}
.segbar{display:flex;gap:2px;height:10px;border-radius:5px;overflow:hidden;background:var(--grid)}
.seg{display:block;min-width:4px}
.seg.st-not-started{background:var(--grid)}
.legend{list-style:none;margin:10px 0 0;padding:0;display:flex;flex-wrap:wrap;gap:4px 14px;font-size:12.5px;color:var(--ink-2)}
.legend li{display:flex;align-items:center;gap:6px}
.legend b{font-weight:600;color:var(--ink)}
.key{display:inline-block;width:12px;height:12px;border-radius:3px}
.st-mastered.key,.st-mastered.seg{background:var(--m-mastered)}
.st-almost.key,.st-almost.seg{background:var(--m-almost)}
.st-learning.key,.st-learning.seg{background:var(--m-learning)}
.st-not-started.key{background:var(--m-none);box-shadow:inset 0 0 0 1.5px var(--m-none-line)}
.rebuilt{display:inline-flex;align-items:center;gap:8px;margin-top:16px;padding:6px 12px 6px 8px;border-radius:999px;background:color-mix(in srgb,var(--good) 12%,transparent);color:var(--good-ink);font-weight:650}
.rebuilt .ico{width:18px;height:18px;padding:2px;border-radius:50%;background:var(--good);color:#fff}
.tiles{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
.tile{border:1px solid var(--border);border-radius:12px;padding:12px 14px;min-width:0}
.tile-label{margin:0;color:var(--ink-2);font-size:13px}
.tile-value{margin:2px 0 0;font-size:28px;line-height:1.15;font-weight:650}
.tile-value .of{font-size:16px;color:var(--ink-2);font-weight:500}
.tile-word{font-size:20px;line-height:1.4}
.tile-sub{margin:2px 0 0;color:var(--muted);font-size:12.5px}
.next h2{font-size:17px;margin-top:2px}
.next p{margin:6px 0 0}
.cmd code{background:color-mix(in srgb,var(--ink) 6%,transparent);padding:2px 6px;border-radius:6px}
.map-scroll{overflow-x:auto;margin-inline:-4px;padding:4px;border-radius:8px}
.map-hint{display:none;margin:0 0 6px;font-size:12.5px;color:var(--muted)}
.map-svg{display:block;width:100%;height:auto;margin-inline:auto}
.edge{fill:none;stroke:var(--edge);stroke-width:1.5}
.edge-strong{stroke:var(--edge-strong)}
.arrow-head{fill:var(--edge)}
.arrow-head-strong{fill:var(--edge-strong)}
.node{cursor:pointer;text-decoration:none}
.node-box{stroke:transparent;stroke-width:1.5}
.node-ring{fill:none;stroke:transparent;stroke-width:2}
.node:focus{outline:none}
.node:focus-visible .node-ring,.node:hover .node-ring{stroke:var(--focus)}
.node.is-next .node-ring{stroke:var(--ink)}
.node-name{font-size:12.5px;font-weight:600}
.node-pct{font-size:12px;font-variant-numeric:tabular-nums}
.st-not-started .node-box{fill:var(--m-none);stroke:var(--m-none-line)}
.st-not-started text{fill:var(--m-none-ink)}
.st-not-started .node-pct{fill:var(--muted)}
.st-learning .node-box{fill:var(--m-learning)}
.st-learning text{fill:var(--m-learning-ink)}
.st-almost .node-box{fill:var(--m-almost)}
.st-almost text{fill:var(--m-almost-ink)}
.st-mastered .node-box{fill:var(--m-mastered)}
.st-mastered text{fill:var(--m-mastered-ink)}
.next-tag rect{fill:var(--ink)}
.next-tag text{fill:var(--surface);font-size:11px;font-weight:650}
.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}
.chart{position:relative;width:100%;min-height:200px}
.chart svg{display:block;overflow:visible}
.chart text{font-size:11.5px;fill:var(--axis);font-variant-numeric:tabular-nums}
.chart .lbl{fill:var(--ink-2);font-weight:600}
.chart .gridline{stroke:var(--grid);stroke-width:1}
.chart .baseline{stroke:var(--base);stroke-width:1}
.chart .line{fill:none;stroke:var(--series);stroke-width:2;stroke-linejoin:round;stroke-linecap:round}
.chart .area{fill:var(--series-wash)}
.chart .dot{fill:var(--series);stroke:var(--surface);stroke-width:2}
.chart .bar{fill:var(--series)}
.chart .claim{stroke:var(--ink);stroke-width:2;stroke-linecap:round}
.chart .hit{fill:transparent}
.chart .hit:focus{outline:none}
.chart .hit:focus-visible{stroke:var(--focus);stroke-width:2}
.chart .cross{stroke:var(--base);stroke-width:1}
.chart-legend{list-style:none;margin:8px 0 0;padding:0;display:flex;flex-wrap:wrap;gap:4px 16px;font-size:12.5px;color:var(--ink-2)}
.chart-legend li{display:flex;align-items:center;gap:6px}
.sw-bar{width:10px;height:12px;border-radius:3px 3px 0 0;background:var(--series)}
.sw-claim{width:14px;height:2px;border-radius:1px;background:var(--ink)}
.tv{margin-top:10px;font-size:13px}
.tv summary{cursor:pointer;color:var(--ink-2);width:max-content}
.tv-scroll{overflow-x:auto}
.tv table{border-collapse:collapse;margin-top:8px;font-variant-numeric:tabular-nums}
.tv th,.tv td{text-align:left;padding:4px 14px 4px 0;border-bottom:1px solid var(--grid)}
.tv th{font-weight:600;color:var(--ink-2)}
.due,.flags{list-style:none;margin:10px 0 0;padding:0;display:grid;gap:4px;font-size:13px}
.due code{font-size:12px}
.flag{display:inline-block;font-size:11.5px;font-weight:600;padding:1px 8px;border-radius:999px;border:1px solid var(--base);color:var(--ink-2)}
.board{list-style:none;margin:0;padding:0;display:grid;gap:8px}
.ex{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:12px;align-items:center;border:1px solid var(--border);border-radius:12px;padding:10px 12px}
.ex-capstone{border-color:color-mix(in srgb,var(--ink) 30%,transparent)}
.ex-num{width:26px;height:26px;border-radius:50%;display:grid;place-items:center;font-size:12.5px;font-weight:650;background:color-mix(in srgb,var(--ink) 7%,transparent)}
.ex-passed .ex-num{background:var(--good);color:#fff}
.ex-title{margin:0;font-weight:600}
.ex-meta{margin:0;color:var(--muted);font-size:12.5px;overflow-wrap:anywhere}
.tag{display:inline-block;margin-left:6px;font-size:11px;font-weight:650;padding:0 7px;border-radius:999px;border:1px solid var(--ink);vertical-align:1px}
.status{display:inline-flex;align-items:center;gap:5px;font-size:12.5px;font-weight:600;white-space:nowrap}
.ico{width:16px;height:16px;flex:none}
.status-good{color:var(--good-ink)}
.status-serious{color:var(--serious-ink)}
.status-idle{color:var(--muted)}
.clist{list-style:none;margin:0;padding:0}
.crow{display:grid;grid-template-columns:minmax(0,1.25fr) 112px minmax(120px,1fr) 44px;grid-template-areas:"name chip meter pct" "name ev ev ev";gap:2px 14px;align-items:center;padding:12px 0;border-top:1px solid var(--grid)}
.crow:first-child{border-top:0}
.crow:target{background:color-mix(in srgb,var(--series) 8%,transparent);border-radius:8px}
.crow-name{grid-area:name}
.crow-title{margin:0;font-weight:600}
.crow-meta{margin:0;color:var(--muted);font-size:12.5px}
.chip{grid-area:chip;justify-self:start;font-size:12px;font-weight:600;padding:2px 9px;border-radius:999px}
.chip.st-mastered{background:var(--m-mastered);color:var(--m-mastered-ink)}
.chip.st-almost{background:var(--m-almost);color:var(--m-almost-ink)}
.chip.st-learning{background:var(--m-learning);color:var(--m-learning-ink)}
.chip.st-not-started{box-shadow:inset 0 0 0 1px var(--m-none-line);color:var(--ink-2)}
.meter{grid-area:meter;position:relative;height:8px;border-radius:4px;background:color-mix(in srgb,var(--series) 16%,transparent)}
.meter-fill{position:absolute;inset:0 auto 0 0;border-radius:4px;background:var(--series)}
.meter-mark{position:absolute;top:-3px;bottom:-3px;left:95%;width:2px;border-radius:1px;background:var(--ink-2)}
.crow-pct{grid-area:pct;text-align:right;font-variant-numeric:tabular-nums;font-weight:600}
.crow-ev{grid-area:ev;margin:0;color:var(--muted);font-size:12.5px}
footer{color:var(--muted);font-size:12.5px;padding-block:4px 24px}
footer p{margin:4px 0}
#tip{position:fixed;z-index:10;pointer-events:none;max-width:260px;background:var(--tip-bg);color:var(--tip-ink);padding:7px 10px;border-radius:8px;font-size:12.5px;line-height:1.4;box-shadow:0 4px 16px rgba(0,0,0,.18)}
#tip b{display:block;font-weight:650}
@media (max-width:860px){
  .summary{grid-template-columns:1fr}
  .grid{grid-template-columns:1fr}
}
@media (max-width:560px){
  .card{padding:16px}
  .hero-figure{font-size:48px}
  .tiles{gap:8px}
  .tile{padding:10px 12px}
  .tile-value{font-size:24px}
  .tile-word{font-size:17px}
  .map-hint{display:block}
  .crow{grid-template-columns:minmax(0,1fr) 40px;grid-template-areas:"name name" "chip chip" "meter pct" "ev ev";gap:6px 10px}
}
@media (prefers-reduced-motion:no-preference){.crow:target{transition:background .3s}}
`;

// Inline chart script. Reads the embedded data and draws at container width.
const SCRIPT = String.raw`
(function(){
  var data = JSON.parse(document.getElementById('tb-data').textContent);
  var NS = 'http://www.w3.org/2000/svg';
  var MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  function sd(day){var p=day.split('-');return (+p[2])+' '+MONTHS[+p[1]-1];}
  function el(name, attrs, parent){var e=document.createElementNS(NS,name);for(var k in attrs)e.setAttribute(k,attrs[k]);if(parent)parent.appendChild(e);return e;}
  function txt(parent, x, y, s, attrs){var t=el('text',Object.assign({x:x,y:y},attrs||{}),parent);t.textContent=s;return t;}
  var tip=document.getElementById('tip');
  function showTip(target, html, evt){
    tip.innerHTML=html;tip.hidden=false;
    var r=target.getBoundingClientRect();
    var x=evt&&evt.clientX!=null?evt.clientX:r.left+r.width/2;
    var y=evt&&evt.clientY!=null?evt.clientY:r.top;
    var w=tip.offsetWidth,hh=tip.offsetHeight;
    var left=Math.min(window.innerWidth-w-8,Math.max(8,x-w/2));
    var top=y-hh-12; if(top<8) top=y+16;
    tip.style.left=left+'px';tip.style.top=top+'px';
  }
  function hideTip(){tip.hidden=true;}
  function esc(s){return String(s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];});}
  function bindTip(node, html){
    node.addEventListener('mouseenter',function(e){showTip(node,html,e);});
    node.addEventListener('mousemove',function(e){showTip(node,html,e);});
    node.addEventListener('mouseleave',hideTip);
    node.addEventListener('focus',function(){showTip(node,html);});
    node.addEventListener('blur',hideTip);
  }
  // Concept map nodes carry their tooltip text in data-tip ("title|line|line").
  Array.prototype.forEach.call(document.querySelectorAll('[data-tip]'),function(n){
    var parts=n.getAttribute('data-tip').split('|');
    bindTip(n,'<b>'+esc(parts[0])+'</b>'+parts.slice(1).map(esc).join('<br>'));
  });
  function niceMax(v){ if(v<=4) return 4; var step=Math.pow(10,Math.floor(Math.log10(v))); var m=Math.ceil(v/step)*step; if(m/step>5 && step>=1){ m=Math.ceil(v/(step/2))*(step/2);} return m; }
  function frame(host, height){ host.innerHTML=''; var w=Math.max(260,host.clientWidth); var svg=el('svg',{width:w,height:height,viewBox:'0 0 '+w+' '+height,role:'img'},host); return {svg:svg,w:w,h:height}; }

  function progress(){
    var host=document.getElementById('chart-progress'); if(!host) return;
    var hist=data.history, total=data.total;
    var f=frame(host,210), m={l:30,r:56,t:14,b:28}, iw=f.w-m.l-m.r, ih=f.h-m.t-m.b;
    f.svg.setAttribute('aria-label','Mastered concepts by study day; see the table view for values');
    var g=el('g',{transform:'translate('+m.l+','+m.t+')'},f.svg);
    var ymax=Math.max(1,total), ticks=[0,Math.round(ymax/2),ymax];
    function y(v){return ih-(v/ymax)*ih;}
    ticks.forEach(function(t){ el('line',{x1:0,x2:iw,y1:y(t),y2:y(t),'class':t===0?'baseline':'gridline'},g); txt(g,-8,y(t)+4,String(t),{'text-anchor':'end'}); });
    if(!hist.length){ txt(g,iw/2,ih/2,'No study days yet',{'text-anchor':'middle'}); return; }
    var t0=Date.parse(hist[0].day), t1=Date.parse(hist[hist.length-1].day), span=Math.max(1,t1-t0);
    function x(d){ return hist.length===1? iw/2 : ((Date.parse(d)-t0)/span)*iw; }
    var pts=hist.map(function(r){return [x(r.day),y(r.mastered)];});
    if(pts.length>1){
      var a='M'+pts[0][0]+','+ih+' '+pts.map(function(p){return 'L'+p[0]+','+p[1];}).join(' ')+' L'+pts[pts.length-1][0]+','+ih+'Z';
      el('path',{d:a,'class':'area'},g);
      el('path',{d:'M'+pts.map(function(p){return p[0]+','+p[1];}).join(' L'),'class':'line'},g);
    }
    var show=[0,hist.length-1]; if(hist.length>2) show.splice(1,0,Math.floor((hist.length-1)/2));
    // Days are placed by date, so two study days in a row sit close together: skip a
    // label that would overlap one already drawn (the first and last always show).
    var placed=[];
    show.filter(function(v,i,a){return a.indexOf(v)===i;}).sort(function(a,b){return (a===0||a===hist.length-1?0:1)-(b===0||b===hist.length-1?0:1);}).forEach(function(i){ if(placed.some(function(px){return Math.abs(px-pts[i][0])<64;})) return; placed.push(pts[i][0]); var anchor=hist.length===1?'middle':(i===0?'start':(i===hist.length-1?'end':'middle')); txt(g,pts[i][0],ih+18,sd(hist[i].day),{'text-anchor':anchor}); });
    var last=pts[pts.length-1], lr=hist[hist.length-1];
    el('circle',{cx:last[0],cy:last[1],r:4.5,'class':'dot'},g);
    txt(g,last[0]+10,last[1]+4,lr.mastered+' of '+total,{'class':'lbl'});
    var cross=el('line',{x1:0,x2:0,y1:0,y2:ih,'class':'cross',visibility:'hidden'},g);
    var marker=el('circle',{r:4.5,'class':'dot',visibility:'hidden'},g);
    var hit=el('rect',{x:-8,y:0,width:iw+16,height:ih,'class':'hit',tabindex:0,'aria-label':'Progress chart: use left and right arrows to read each day'},g);
    var cur=hist.length-1;
    function pick(i,evt){ cur=i; var p=pts[i],r=hist[i]; cross.setAttribute('x1',p[0]);cross.setAttribute('x2',p[0]);cross.setAttribute('visibility','visible'); marker.setAttribute('cx',p[0]);marker.setAttribute('cy',p[1]);marker.setAttribute('visibility','visible'); showTip(hit,'<b>'+sd(r.day)+'</b>'+r.mastered+' of '+total+' mastered<br>Mean estimate '+Math.round(r.meanMastery*100)+'%',evt||{clientX:hit.getBoundingClientRect().left+p[0]+8,clientY:hit.getBoundingClientRect().top+p[1]}); }
    function clear(){ cross.setAttribute('visibility','hidden'); marker.setAttribute('visibility','hidden'); hideTip(); }
    hit.addEventListener('mousemove',function(e){ var bx=hit.getBoundingClientRect().left+8; var px=e.clientX-bx; var best=0,bd=1e9; pts.forEach(function(p,i){var d=Math.abs(p[0]-px); if(d<bd){bd=d;best=i;}}); pick(best,e); });
    hit.addEventListener('mouseleave',clear); hit.addEventListener('blur',clear);
    hit.addEventListener('focus',function(){pick(cur);});
    hit.addEventListener('keydown',function(e){ if(e.key==='ArrowLeft'){pick(Math.max(0,cur-1));e.preventDefault();} if(e.key==='ArrowRight'){pick(Math.min(hist.length-1,cur+1));e.preventDefault();} });
  }

  function columns(host, cols, opts){
    var f=frame(host,opts.height||190), m={l:30,r:8,t:18,b:28}, iw=f.w-m.l-m.r, ih=f.h-m.t-m.b;
    f.svg.setAttribute('aria-label',opts.label);
    var g=el('g',{transform:'translate('+m.l+','+m.t+')'},f.svg);
    var vmax=niceMax(Math.max.apply(null,cols.map(function(c){return c.v;}).concat([1])));
    function y(v){return ih-(v/vmax)*ih;}
    [0,vmax/2,vmax].forEach(function(t){ el('line',{x1:0,x2:iw,y1:y(t),y2:y(t),'class':t===0?'baseline':'gridline'},g); txt(g,-8,y(t)+4,String(Math.round(t*10)/10),{'text-anchor':'end'}); });
    var band=iw/cols.length, bw=Math.min(24,band*0.62);
    var maxV=Math.max.apply(null,cols.map(function(c){return c.v;}));
    cols.forEach(function(c,i){
      var cx=band*i+band/2;
      if(c.v>0){ var top=y(c.v), hgt=ih-top, r=Math.min(4,hgt);
        el('path',{d:'M'+(cx-bw/2)+','+ih+' V'+(top+r)+' Q'+(cx-bw/2)+','+top+' '+(cx-bw/2+r)+','+top+' H'+(cx+bw/2-r)+' Q'+(cx+bw/2)+','+top+' '+(cx+bw/2)+','+(top+r)+' V'+ih+' Z','class':'bar'},g);
        if(c.v===maxV) txt(g,cx,top-6,String(c.v),{'text-anchor':'middle','class':'lbl'});
      }
      if(c.tick) txt(g,c.anchor==='start'?cx-bw/2:cx,ih+18,c.tick,{'text-anchor':c.anchor||'middle'});
      var hit=el('rect',{x:cx-band/2,y:0,width:band,height:ih+4,'class':'hit',tabindex:0,'aria-label':c.aria},g);
      bindTip(hit,c.tip);
    });
  }

  function reviews(){
    var host=document.getElementById('chart-reviews'); if(!host) return;
    var n=data.upcoming.length, every=host.clientWidth<420?4:2;
    var cols=data.upcoming.map(function(u,i){ var lab=sd(u.day); var tick=(i===0)?lab:((i%every===0 && i<n-2)?lab.split(' ')[0]:''); return {v:u.count,tick:tick,anchor:i===0?'start':'middle',tip:'<b>'+lab+'</b>'+u.count+' due',aria:lab+': '+u.count+' reviews due'}; });
    columns(host,cols,{label:'Reviews scheduled for each of the next 14 days; see the table view for values'});
  }

  function calibration(){
    var host=document.getElementById('chart-calibration'); if(!host) return;
    var lv=data.byLevel;
    var f=frame(host,210), m={l:36,r:8,t:12,b:40}, iw=f.w-m.l-m.r, ih=f.h-m.t-m.b;
    f.svg.setAttribute('aria-label','For each confidence level, how often answers were right compared with what that level claims; see the table view for values');
    var g=el('g',{transform:'translate('+m.l+','+m.t+')'},f.svg);
    function y(v){return ih-v*ih;}
    [0,0.5,1].forEach(function(t){ el('line',{x1:0,x2:iw,y1:y(t),y2:y(t),'class':t===0?'baseline':'gridline'},g); txt(g,-8,y(t)+4,Math.round(t*100)+'%',{'text-anchor':'end'}); });
    var band=iw/lv.length, bw=Math.min(24,band*0.4);
    lv.forEach(function(l,i){
      var cx=band*i+band/2;
      if(l.n>0 && l.accuracy>0){ var top=y(l.accuracy), hgt=ih-top, r=Math.min(4,hgt);
        el('path',{d:'M'+(cx-bw/2)+','+ih+' V'+(top+r)+' Q'+(cx-bw/2)+','+top+' '+(cx-bw/2+r)+','+top+' H'+(cx+bw/2-r)+' Q'+(cx+bw/2)+','+top+' '+(cx+bw/2)+','+(top+r)+' V'+ih+' Z','class':'bar'},g); }
      el('line',{x1:cx-bw/2-6,x2:cx+bw/2+6,y1:y(l.expected),y2:y(l.expected),'class':'claim'},g);
      txt(g,cx,ih+16,l.label,{'text-anchor':'middle','class':'lbl'});
      txt(g,cx,ih+31,l.n+' answer'+(l.n===1?'':'s'),{'text-anchor':'middle'});
      var acc=l.accuracy==null?'no answers yet':Math.round(l.accuracy*100)+'% right';
      var hit=el('rect',{x:cx-band/2,y:0,width:band,height:ih+34,'class':'hit',tabindex:0,'aria-label':l.label+': claims '+Math.round(l.expected*100)+'%, '+acc+', '+l.n+' answers'},g);
      bindTip(hit,'<b>'+esc(l.label)+'</b>Claims '+Math.round(l.expected*100)+'%<br>'+acc+' ('+l.n+')');
    });
  }

  function drawAll(){ progress(); reviews(); calibration(); }
  // On narrow screens the map scrolls sideways: start with the next concept in view.
  (function(){ var sc=document.querySelector('.map-scroll'), n=document.querySelector('a.node.is-next')||document.querySelector('a.node:not(.st-mastered)'); if(!sc||!n||sc.scrollWidth<=sc.clientWidth) return; var r=n.getBoundingClientRect(), sr=sc.getBoundingClientRect(); sc.scrollLeft=Math.max(0,sc.scrollLeft+(r.left+r.width/2)-(sr.left+sr.width/2)); })();
  drawAll();
  var last=window.innerWidth;
  window.addEventListener('resize',function(){ if(Math.abs(window.innerWidth-last)>4){ last=window.innerWidth; hideTip(); drawAll(); } });
  if(window.matchMedia){ var mq=window.matchMedia('(prefers-color-scheme: dark)'); if(mq.addEventListener) mq.addEventListener('change',drawAll); }
  document.addEventListener('keydown',function(e){ if(e.key==='Escape') hideTip(); });
})();
`;

export function renderDashboard(courseData, s) {
  const src = s.course.source ?? {};
  const who = src.authors?.length ? `${src.authors[0].split(' ').slice(-1)[0]}${src.authors.length > 1 ? ' et al.' : ''}${src.year ? ` (${src.year})` : ''}` : null;
  const cite = who ? [who, src.venue].filter(Boolean).join(' · ') : (src.citation ?? '');
  const link = src.url ? ` <a href="${h(src.url)}" rel="noreferrer">${h(src.url.replace(/^https?:\/\//, ''))}</a>` : '';
  const t = tables(s);
  const embedded = {
    total: s.concepts.total,
    history: s.history,
    dueToday: s.reviews.dueToday,
    upcoming: s.reviews.upcoming,
    byLevel: s.calibration.byLevel
  };
  const json = JSON.stringify(embedded).replace(/</g, '\\u003c');
  const statusJson = JSON.stringify({
    mastered: s.concepts.mastered,
    total: s.concepts.total,
    meanMastery: s.concepts.meanMastery,
    reviewsDue: s.reviews.dueToday,
    exercisesPassed: s.exercises.passed,
    exercisesTotal: s.exercises.total,
    calibration: s.calibration.overall.label,
    rebuilt: s.rebuilt,
    generatedAt: s.generatedAt
  }).replace(/</g, '\\u003c');
  const badge = s.rebuilt
    ? `<p class="rebuilt" data-stat="rebuilt">${ICON.check}Rebuilt on ${h(fmtDay(s.rebuiltAt.slice(0, 10)))}</p>`
    : s.complete
      ? `<p class="rebuilt" data-stat="rebuilt">${ICON.check}Every concept mastered</p>`
      : '';
  const capstoneNote = s.capstone ? 'The course is Rebuilt when every concept is mastered and the capstone passes.' : 'This course has no capstone; it is complete when every concept is mastered.';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:">
<meta name="generator" content="teachback 0.1.0">
<title>${h(s.course.title)} · teachback</title>
<style>${CSS}</style>
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<header class="masthead"><div class="wrap">
<p class="brand">teachback · study dashboard</p>
<h1>${h(s.course.title)}</h1>
${cite || link ? `<p class="cite">${h(cite)}${cite && link ? ' ·' : ''}${link}</p>` : ''}
<p class="meta">Updated ${h(fmtDay(s.today))} · ${s.activity.daysActive} study day${s.activity.daysActive === 1 ? '' : 's'} · ${s.activity.answers} answer${s.activity.answers === 1 ? '' : 's'} · ${s.activity.runs} exercise run${s.activity.runs === 1 ? '' : 's'}</p>
</div></header>
<main id="main" class="wrap">
<section class="card summary" aria-label="Summary">
<div>
<p class="hero-figure"><span data-stat="concepts-mastered">${s.concepts.mastered}</span><span class="of">of <span data-stat="concepts-total">${s.concepts.total}</span></span></p>
<p class="hero-label">concepts mastered</p>
${masteryBar(s)}
${badge}
</div>
${tiles(s)}
</section>
${nextCard(s)}
<section class="card" aria-labelledby="map-h">
<div class="card-head"><div><h2 id="map-h">Concept map</h2><p class="card-sub">Arrows run from a prerequisite to the concept that builds on it. Colour shows the mastery estimate; select a concept for details.</p></div></div>
<p class="map-hint">Scroll sideways to see the whole map.</p>
<div class="map-scroll" tabindex="0" aria-label="Concept map, scrolls sideways on small screens">${conceptMap(s)}</div>
</section>
<div class="grid">
<section class="card" aria-labelledby="prog-h">
<div class="card-head"><div><h2 id="prog-h">Mastered concepts over time</h2><p class="card-sub">Count at the end of each study day</p></div></div>
<div class="chart" id="chart-progress"></div>
${t.hist}
</section>
<section class="card" aria-labelledby="rev-h">
<div class="card-head"><div><h2 id="rev-h">Upcoming reviews</h2><p class="card-sub">Scheduled for each of the next 14 days. Due today: <b>${s.reviews.dueToday}</b></p></div></div>
<div class="chart" id="chart-reviews"></div>
${t.up}
${dueList(s)}
</section>
<section class="card" aria-labelledby="cal-h">
<div class="card-head"><div><h2 id="cal-h">Confidence calibration</h2><p class="card-sub">How often you were right at each confidence level</p></div></div>
<div class="chart" id="chart-calibration"></div>
<ul class="chart-legend"><li><span class="sw-bar" aria-hidden="true"></span>Right</li><li><span class="sw-claim" aria-hidden="true"></span>What the level claims</li></ul>
${t.cal}
${calibrationFlags(s)}
</section>
<section class="card" aria-labelledby="track-h">
<div class="card-head"><div><h2 id="track-h">Rebuild track</h2><p class="card-sub">${h(capstoneNote)}</p></div></div>
${exerciseBoard(s)}
</section>
</div>
<section class="card" aria-labelledby="con-h">
<div class="card-head"><div><h2 id="con-h">Concepts</h2><p class="card-sub">In prerequisite order. The mark on each bar is the mastery threshold (${pctOf(s.masteryThreshold)}%).</p></div></div>
<ol class="clist">${conceptRows(s)}</ol>
</section>
<footer>
<p>Mastery is a model estimate (Bayesian Knowledge Tracing), not a grade. Short answers are judged by your tutor; the rubric is evidence.</p>
<p>This page makes no network requests. Your learning data stays in <code>${h(courseData.dir.split(/[\\/]/).slice(-2).join('/'))}/learner.json</code>.</p>
</footer>
</main>
<div id="tip" role="tooltip" hidden></div>
<script type="application/json" id="tb-data">${json}</script>
<script type="application/json" id="tb-status">${statusJson}</script>
<script>${SCRIPT}</script>
</body>
</html>
`;
}
