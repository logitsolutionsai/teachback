// teachback reporter for `node --test`: prints one JSON line, prefixed with a
// marker, describing every test outcome.
const MARK = '@@TEACHBACK_RESULT@@';

function message(err) {
  const e = err?.cause ?? err;
  if (!e) return undefined;
  const text = e.message ?? String(e);
  return text.split('\n').filter((l) => l.trim()).slice(0, 8).join('\n');
}

export default async function* reporter(source) {
  const tests = [];
  for await (const event of source) {
    if (event.type !== 'test:pass' && event.type !== 'test:fail') continue;
    const d = event.data;
    if (d.details?.type === 'suite') continue;
    let status = event.type === 'test:pass' ? 'pass' : 'fail';
    if (d.skip || d.todo) status = 'skip';
    const rec = { name: d.name, status };
    if (status === 'fail') {
      rec.message = message(d.details?.error);
      const code = d.details?.error?.code;
      if (code && code !== 'ERR_TEST_FAILURE') rec.status = 'error';
      if (d.details?.error?.failureType && d.details.error.failureType !== 'testCodeFailure') rec.status = 'error';
    }
    tests.push(rec);
  }
  yield `\n${MARK}${JSON.stringify({ tests })}\n`;
}
