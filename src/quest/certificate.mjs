// The Quest Certificate: an offline HTML card and a JSON file that state, one
// by one, what local evidence exists. Each status is separate and plain:
//   source_verified                   every source ref verifies against the lock now
//   concepts_mastered_by_local_model  the local learner model estimates every concept mastered
//   tests_passed                      the capstone's allowlisted tests passed on this lock
//   teachback_recorded                a teach-back of the patch was recorded after the pass
//   rehearsal_complete                all of the above, and every quest passed
//   reviewed_by_maintainer            only when the local user asserts it with --confirm
// It shows no name, answers, grades or confidence unless asked (--label,
// --include-details), and it is not a credential or a merged contribution.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { TeachbackError, escapeHtml as h, resolveNow, writeJsonAtomic } from '../util.mjs';
import { resolveCourseDir, loadCourseStrict } from '../course.mjs';
import { loadLearner, replay } from '../model/learner.mjs';
import { verifyCourse } from '../repo/verify.mjs';
import { questContext, questSummary, loadQuestState, teachbackDone } from './state.mjs';

export const DISCLAIMER = 'Self-reported/local test evidence; not a credential or a merged contribution.';
const FLUID = fs.readFileSync(new URL('../fluid.js', import.meta.url), 'utf8');

export const STATUS_TEXT = {
  source_verified: ['Source verified', 'Every file and line the course cites matches the locked source on this machine now.'],
  concepts_mastered_by_local_model: ['Concepts mastered (local model)', "teachback's own learner model estimates every concept mastered. It is an estimate from answers recorded on this machine."],
  tests_passed: ['Capstone tests passed', 'The capstone quest command, allowlisted on this machine, exited as expected on the locked source. Passing tests do not prove the absence of regressions.'],
  teachback_recorded: ['Teach-back recorded', 'A teach-back of the patch was judged and recorded after the tests passed.'],
  rehearsal_complete: ['Rehearsal complete', 'All of the above, and every quest in the course passed.'],
  reviewed_by_maintainer: ['Reviewed by a maintainer', 'Shown only when the local user asserts a maintainer review and confirms it. teachback cannot check this.']
};

export function certificateData(courseData, { repo, label, includeDetails = false, maintainer = null, now }) {
  const learner = loadLearner(courseData, now);
  const derived = replay(courseData, learner);
  const ctx = questContext(courseData);
  if (!ctx) throw new TeachbackError('E680', `${courseData.slug} is not a repo course with quests.`, 'Certificates are for RepoQuest courses; paper courses have the dashboard.', 2);
  let verified = false;
  try {
    verified = verifyCourse(courseData.dir, { repo }).status === 'verified';
  } catch {
    verified = false;
  }
  const quests = questSummary(ctx, derived);
  const capstone = ctx.quests.find((q) => q.capstone) ?? null;
  const state = loadQuestState(courseData.dir).quests[capstone?.id] ?? null;
  const testsPassed = Boolean(capstone && state?.record?.status === 'passed' && state.record.sourceManifestDigest === ctx.source.lock?.manifestDigest);
  const tbDone = Boolean(capstone && testsPassed && teachbackDone(capstone, derived, state.record.at));
  const concepts = courseData.concepts.map((c) => ({ id: c.id, name: c.name, mastered: Boolean(derived.mastery[c.id]?.mastered), pL: derived.mastery[c.id]?.pL }));
  const allMastered = concepts.length > 0 && concepts.every((c) => c.mastered);
  const allQuests = quests.length > 0 && quests.every((q) => q.status === 'passed');
  const statuses = {
    source_verified: verified,
    concepts_mastered_by_local_model: allMastered,
    tests_passed: testsPassed,
    teachback_recorded: tbDone,
    rehearsal_complete: verified && allMastered && testsPassed && tbDone && allQuests,
    reviewed_by_maintainer: Boolean(maintainer)
  };
  const pseudonym = `learner-${crypto.createHash('sha256').update(`${courseData.slug}|${learner.createdAt}`).digest('hex').slice(0, 8)}`;
  const lock = ctx.source.lock;
  return {
    schemaVersion: 1,
    kind: 'teachback-quest-certificate',
    course: { slug: courseData.slug, title: courseData.course.title },
    learner: label ?? pseudonym,
    source: { name: lock?.repo.name ?? null, publicUrl: lock?.repo.publicUrl ?? null, ref: lock?.repo.ref ?? null, scope: lock?.repo.scope ?? null, manifestDigest: lock?.manifestDigest ?? null },
    statuses,
    progress: { concepts: { mastered: concepts.filter((c) => c.mastered).length, total: concepts.length }, quests: { passed: quests.filter((q) => q.status === 'passed').length, total: quests.length } },
    ...(capstone && testsPassed ? { capstone: { quest: capstone.id, title: capstone.title, commandDigest: state.record.checks[0]?.commandDigest, stdoutDigest: state.record.checks[0]?.stdoutDigest, ranAt: state.record.at, environment: state.record.environment } } : {}),
    ...(maintainer ? { maintainerReview: { name: maintainer, assertedBy: 'the local user, with --confirm', checkedByTeachback: false } } : {}),
    ...(includeDetails ? { details: { concepts: concepts.map((c) => ({ id: c.id, name: c.name, mastered: c.mastered, masteryEstimate: Math.round((c.pL ?? 0) * 100) / 100 })), quests: quests.map((q) => ({ id: q.id, kind: q.kind, status: q.status })) } } : {}),
    generatedAt: now.toISOString(),
    disclaimer: DISCLAIMER
  };
}

const CHECK = '<svg class="ico" viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

export function renderCertificate(d) {
  const rows = Object.entries(STATUS_TEXT)
    .map(([key, [title, meaning]]) => {
      const yes = d.statuses[key];
      const strong = key === 'rehearsal_complete' && yes;
      const chip = strong ? `<span class="chip lv3">${CHECK}Yes</span>` : yes ? `<span class="pass">${CHECK}Yes</span>` : '<span class="chip lv0">Not yet</span>';
      return `<li class="row" data-status="${key}" data-value="${yes ? 'true' : 'false'}"><details><summary><span class="name">${h(title)}</span>${chip}</summary><p class="meaning">${h(meaning)}</p></details></li>`;
    })
    .join('');
  const ref = d.source.ref ? (d.source.ref.kind === 'git' ? `commit ${d.source.ref.sha.slice(0, 12)}` : `content digest ${d.source.ref.digest.slice(7, 19)}`) : 'unknown';
  const details = d.details
    ? `<section class="block"><h2>Details (Shown By Choice)</h2><ul class="plain">${d.details.concepts.map((c) => `<li>${h(c.name)}: model estimate ${Math.round(c.masteryEstimate * 100)}%${c.mastered ? ', mastered' : ''}</li>`).join('')}${d.details.quests.map((q) => `<li>Quest ${h(q.id)} (${h(q.kind)}): ${h(q.status)}</li>`).join('')}</ul></section>`
    : '';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Quest Certificate: ${h(d.course.title)}</title>
<style>
:root{color-scheme:light;--bg:#f7f7f5;--surface:#ffffff;--surface-2:#f0f0ed;--line:#e3e3df;--line-strong:#c9c9c3;--ink:#111110;--ink-2:#3a3a37;--muted:#6f6f69;--faint:#a3a39c;--accent:#0065FD;--accent-press:#0654c8}
@media (prefers-color-scheme:dark){:root{color-scheme:dark;--bg:#0e0e0d;--surface:#171716;--surface-2:#1f1f1d;--line:#2b2b29;--line-strong:#3d3d3a;--ink:#f4f4f2;--ink-2:#d6d6d2;--muted:#9a9a94;--faint:#6a6a65;--accent:#5b9cff;--accent-press:#3f86ff}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif}
.wrap{max-width:720px;margin:0 auto;padding-inline:16px;padding-block:32px}
:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.card{background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:24px}
h1{font-size:22px;line-height:1.25;margin:0 0 4px;font-weight:650}
h2{font-size:13px;margin:0 0 8px;color:var(--ink-2);font-weight:600}
.sub{margin:0;color:var(--ink-2)}
.meta{margin:16px 0 0;color:var(--muted);font-size:12.5px;font-variant-numeric:tabular-nums}
.meta code{font:12px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:var(--ink-2)}
.block{margin-top:24px;padding-top:16px;border-top:1px solid var(--line)}
.rows{list-style:none;margin:0;padding:0}
.row{border-bottom:1px solid var(--line)}
.row:last-child{border-bottom:0}
summary{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 0;cursor:pointer;list-style:none;border-radius:6px;-webkit-tap-highlight-color:transparent}
summary::-webkit-details-marker{display:none}
.name{font-weight:600}
.meaning{margin:0 0 12px;color:var(--ink-2);max-width:60ch}
.chip{display:inline-flex;align-items:center;gap:4px;font-size:12px;font-weight:600;line-height:18px;padding:1px 8px;border:1px solid transparent;border-radius:999px;white-space:nowrap}
.lv3{background:var(--ink);color:var(--bg)}
.lv0{border:1px dashed var(--line-strong);color:var(--muted)}
.pass{display:inline-flex;align-items:center;gap:4px;color:var(--muted);font-size:12px;font-weight:600}
.ico{width:14px;height:14px}
.progress{display:flex;flex-wrap:wrap;gap:8px 24px;margin:0;font-variant-numeric:tabular-nums;color:var(--ink-2)}
.progress b{color:var(--ink);font-weight:650}
.disclaimer{margin:24px 0 0;padding:12px;border-radius:6px;background:var(--surface-2);color:var(--ink);font-weight:600}
.plain{margin:0;padding-left:18px;color:var(--ink-2)}
</style>
</head>
<body>
<main class="wrap">
<article class="card" data-rehearsed="${d.statuses.rehearsal_complete ? 'true' : 'false'}">
<h1>${h(d.course.title)}</h1>
<p class="sub">Quest certificate for ${h(d.learner)}</p>
<p class="meta">Source: ${h(d.source.name ?? 'unknown')}${d.source.publicUrl ? ` (${h(d.source.publicUrl)})` : ''}, ${!d.source.scope || d.source.scope === '.' ? 'whole repository' : `scope <code>${h(d.source.scope)}</code>`}, ${h(ref)}<br>Generated ${h(d.generatedAt.slice(0, 10))}</p>
<section class="block"><h2>Evidence</h2><ul class="rows">${rows}</ul></section>
<section class="block"><h2>Progress</h2><p class="progress"><span><b>${d.progress.concepts.mastered} of ${d.progress.concepts.total}</b> concepts mastered</span><span><b>${d.progress.quests.passed} of ${d.progress.quests.total}</b> quests passed</span></p></section>
${details}
<p class="disclaimer" data-disclaimer>${h(DISCLAIMER)}</p>
</article>
</main>
<script>${FLUID}</script>
<script>
Array.prototype.forEach.call(document.querySelectorAll('summary'), function (s) { Fluid.pressable(s, { scale: 0.98 }); });
</script>
</body>
</html>
`;
}

export function registerCertificateCommand(SUB) {
  SUB['quest certificate'] = async (argv, { parse, out }) => {
    const args = parse(argv, { out: { type: 'string', short: 'o' }, repo: { type: 'string' }, label: { type: 'string' }, 'include-details': { type: 'boolean' }, 'maintainer-review': { type: 'string' }, confirm: { type: 'boolean' } });
    const dir = resolveCourseDir(args.course ?? args._[0], { root: args.root });
    const courseData = loadCourseStrict(dir);
    if (args['maintainer-review'] && !args.confirm) throw new TeachbackError('E681', 'A maintainer review is shown only when you confirm it.', `Run again with --confirm if ${args['maintainer-review']} really reviewed this work. teachback cannot check it, and the card says so.`, 2);
    const now = resolveNow(args.now);
    const d = certificateData(courseData, { repo: args.repo, label: args.label, includeDetails: args['include-details'], maintainer: args['maintainer-review'] ?? null, now });
    const file = path.resolve(args.out ?? path.join(dir, 'certificate.html'));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, renderCertificate(d));
    const jsonFile = file.replace(/\.html?$/i, '') + '.json';
    writeJsonAtomic(jsonFile, d);
    out(args, { path: file, json: jsonFile, ...d }, () =>
      [
        `Certificate written to ${file} (and ${jsonFile})`,
        ...Object.entries(d.statuses).map(([k, v]) => `  ${v ? '[x]' : '[ ]'} ${STATUS_TEXT[k][0]}`),
        `  ${DISCLAIMER}`
      ].join('\n')
    );
  };
}
