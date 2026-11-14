// Lightweight lexical symbol extraction for JavaScript/TypeScript, Python, Go
// and Rust. This reads lines with conservative patterns; it is not a parser and
// it never builds a call graph. Every symbol says how sure it is:
//   lexically_detected  the declaration line matched and its end was found
//                       (brace balance or indentation)
//   unknown             the declaration matched but its end could not be found,
//                       so only the start line is reported
// Imports are read the same way and only resolved to files that exist in the scan.

const JS_KEYWORDS = new Set(['if', 'for', 'while', 'switch', 'catch', 'function', 'return', 'with', 'else', 'do', 'try', 'new', 'typeof', 'await', 'yield']);

// Remove string contents and comments from one line, so braces inside them do
// not count. Block comments and template literals spanning lines are tracked
// with `state`; when they make a line ambiguous, `ambiguous` is set.
function stripLine(line, state, { hashComments = false } = {}) {
  let out = '';
  let i = 0;
  let ambiguous = false;
  while (i < line.length) {
    if (state.block) {
      const end = line.indexOf('*/', i);
      if (end < 0) return { text: out, ambiguous };
      state.block = false;
      i = end + 2;
      continue;
    }
    if (state.template) {
      ambiguous = true;
      const end = line.indexOf('`', i);
      if (end < 0) return { text: out, ambiguous };
      state.template = false;
      i = end + 1;
      continue;
    }
    const ch = line[i];
    const two = line.slice(i, i + 2);
    if (two === '//' && !hashComments) break;
    if (ch === '#' && hashComments) break;
    if (two === '/*' && !hashComments) {
      state.block = true;
      i += 2;
      continue;
    }
    if (ch === '`') {
      state.template = true;
      i += 1;
      continue;
    }
    if (ch === '"' || ch === "'") {
      let j = i + 1;
      while (j < line.length && line[j] !== ch) j += line[j] === '\\' ? 2 : 1;
      out += ch + ch;
      i = j + 1;
      continue;
    }
    out += ch;
    i += 1;
  }
  return { text: out, ambiguous };
}

// From the declaration line, the line where its braces close (1-based), or null.
function braceEnd(lines, start, opts) {
  const state = { block: false, template: false };
  let depth = 0;
  let opened = false;
  for (let n = start; n < lines.length && n < start + 5000; n++) {
    const { text } = stripLine(lines[n], state, opts);
    for (const ch of text) {
      if (ch === '{') {
        depth += 1;
        opened = true;
      } else if (ch === '}') depth -= 1;
      if (opened && depth === 0) return n + 1;
    }
    if (!opened && n > start + 3) return null; // no body: a declaration only
  }
  return null;
}

function indentOf(line) {
  return line.match(/^[ \t]*/)[0].replace(/\t/g, '    ').length;
}

function pythonEnd(lines, start) {
  const base = indentOf(lines[start]);
  let last = start;
  let n = start + 1;
  // A signature may span lines until the colon.
  while (n < lines.length && !/:\s*(#.*)?$/.test(lines[n - 1]) && n < start + 20) n += 1;
  for (; n < lines.length; n++) {
    const l = lines[n];
    if (!l.trim()) continue;
    if (indentOf(l) <= base) break;
    last = n;
  }
  return last + 1;
}

function push(out, sym) {
  out.push({ certainty: sym.endLine ? 'lexically_detected' : 'unknown', ...sym });
}

function jsSymbols(lines) {
  const out = [];
  const classes = []; // { name, end }
  for (let n = 0; n < lines.length; n++) {
    const line = lines[n];
    while (classes.length && n + 1 > classes.at(-1).end) classes.pop();
    let m;
    if ((m = line.match(/^\s*(export\s+)?(default\s+)?(?:declare\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/))) {
      const end = braceEnd(lines, n);
      push(out, { name: m[3], kind: 'class', startLine: n + 1, endLine: end, exported: Boolean(m[1]) });
      if (end) classes.push({ name: m[3], end });
      continue;
    }
    if ((m = line.match(/^\s*(export\s+)?(default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)\s*[(<]/))) {
      push(out, { name: m[3], kind: 'function', startLine: n + 1, endLine: braceEnd(lines, n), exported: Boolean(m[1]) });
      continue;
    }
    if ((m = line.match(/^\s*(export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s+)?(?:function\b|\([^)]*\)\s*(?::[^=]+)?=>|[A-Za-z_$][\w$]*\s*=>)/))) {
      const end = /\{\s*$|\{[^}]*$/.test(line) ? braceEnd(lines, n) : n + 1;
      push(out, { name: m[2], kind: 'function', startLine: n + 1, endLine: end, exported: Boolean(m[1]) });
      continue;
    }
    if ((m = line.match(/^\s*(export\s+)?(?:declare\s+)?(interface|enum)\s+([A-Za-z_$][\w$]*)/))) {
      push(out, { name: m[3], kind: m[2], startLine: n + 1, endLine: braceEnd(lines, n), exported: Boolean(m[1]) });
      continue;
    }
    if ((m = line.match(/^\s*(export\s+)?type\s+([A-Za-z_$][\w$]*)\s*(?:<[^>]*>)?\s*=/))) {
      push(out, { name: m[2], kind: 'type', startLine: n + 1, endLine: n + 1, exported: Boolean(m[1]) });
      continue;
    }
    if ((m = line.match(/^\s*(?:module\.)?exports\.([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?(?:function\b|\()/))) {
      push(out, { name: m[1], kind: 'function', startLine: n + 1, endLine: braceEnd(lines, n), exported: true });
      continue;
    }
    if (classes.length && (m = line.match(/^\s+(?:(?:public|private|protected|static|async|readonly|override|get|set)\s+)*(#?[A-Za-z_$][\w$]*)\s*\([^)]*\)?\s*(?::[^{]+)?\{\s*$/)) && !JS_KEYWORDS.has(m[1])) {
      push(out, { name: `${classes.at(-1).name}.${m[1]}`, kind: 'method', startLine: n + 1, endLine: braceEnd(lines, n), exported: false });
    }
  }
  return out;
}

function pySymbols(lines) {
  const out = [];
  const stack = []; // { name, indent }
  for (let n = 0; n < lines.length; n++) {
    const line = lines[n];
    if (!line.trim()) continue;
    const ind = indentOf(line);
    while (stack.length && ind <= stack.at(-1).indent) stack.pop();
    let m;
    if ((m = line.match(/^(\s*)class\s+([A-Za-z_]\w*)\s*[(:]/))) {
      push(out, { name: stack.length ? `${stack.at(-1).name}.${m[2]}` : m[2], kind: 'class', startLine: n + 1, endLine: pythonEnd(lines, n), exported: !m[2].startsWith('_') });
      stack.push({ name: m[2], indent: ind });
    } else if ((m = line.match(/^(\s*)(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(/))) {
      const inClass = stack.length > 0;
      push(out, { name: inClass ? `${stack.at(-1).name}.${m[2]}` : m[2], kind: inClass ? 'method' : 'function', startLine: n + 1, endLine: pythonEnd(lines, n), exported: !m[2].startsWith('_') });
    }
  }
  return out;
}

function goSymbols(lines) {
  const out = [];
  for (let n = 0; n < lines.length; n++) {
    const line = lines[n];
    let m;
    if ((m = line.match(/^func\s+\(\s*\w*\s*\*?\s*([A-Za-z_]\w*)(?:\[[^\]]*\])?\s*\)\s*([A-Za-z_]\w*)\s*[[(]/))) {
      push(out, { name: `${m[1]}.${m[2]}`, kind: 'method', startLine: n + 1, endLine: braceEnd(lines, n), exported: /^[A-Z]/.test(m[2]) });
    } else if ((m = line.match(/^func\s+([A-Za-z_]\w*)\s*[[(]/))) {
      push(out, { name: m[1], kind: 'function', startLine: n + 1, endLine: braceEnd(lines, n), exported: /^[A-Z]/.test(m[1]) });
    } else if ((m = line.match(/^type\s+([A-Za-z_]\w*)(?:\[[^\]]*\])?\s+(struct|interface)\b/))) {
      push(out, { name: m[1], kind: m[2], startLine: n + 1, endLine: braceEnd(lines, n), exported: /^[A-Z]/.test(m[1]) });
    }
  }
  return out;
}

function rustSymbols(lines) {
  const out = [];
  const impls = []; // { name, end }
  for (let n = 0; n < lines.length; n++) {
    const line = lines[n];
    while (impls.length && n + 1 > impls.at(-1).end) impls.pop();
    let m;
    if ((m = line.match(/^\s*impl(?:<[^>]*>)?\s+(?:[\w:]+(?:<[^>]*>)?\s+for\s+)?([A-Za-z_]\w*)/))) {
      const end = braceEnd(lines, n);
      if (end) impls.push({ name: m[1], end });
      continue;
    }
    if ((m = line.match(/^\s*(pub(?:\([^)]*\))?\s+)?(?:const\s+)?(?:async\s+)?(?:unsafe\s+)?(?:extern\s+"[^"]*"\s+)?fn\s+([A-Za-z_]\w*)/))) {
      const inImpl = impls.length > 0;
      push(out, { name: inImpl ? `${impls.at(-1).name}.${m[2]}` : m[2], kind: inImpl ? 'method' : 'function', startLine: n + 1, endLine: braceEnd(lines, n), exported: Boolean(m[1]) });
      continue;
    }
    if ((m = line.match(/^\s*(pub(?:\([^)]*\))?\s+)?(struct|enum|trait|mod)\s+([A-Za-z_]\w*)/))) {
      const end = /;\s*$/.test(line) ? n + 1 : braceEnd(lines, n);
      push(out, { name: m[3], kind: m[2], startLine: n + 1, endLine: end, exported: Boolean(m[1]) });
    }
  }
  return out;
}

export function extractSymbols(language, text) {
  const lines = text.split('\n');
  if (language === 'javascript' || language === 'typescript') return jsSymbols(lines);
  if (language === 'python') return pySymbols(lines);
  if (language === 'go') return goSymbols(lines);
  if (language === 'rust') return rustSymbols(lines);
  return [];
}

// Import specifiers as written in the file, with their line numbers.
export function extractImports(language, text) {
  const out = [];
  text.split('\n').forEach((line, i) => {
    let m;
    const at = i + 1;
    if (language === 'javascript' || language === 'typescript') {
      const re = /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)(['"])([^'"]+)\1/g;
      while ((m = re.exec(line))) out.push({ spec: m[2], line: at });
    } else if (language === 'python') {
      if ((m = line.match(/^\s*from\s+([.\w]+)\s+import\b/))) out.push({ spec: m[1], line: at });
      else if ((m = line.match(/^\s*import\s+([\w.]+)/))) out.push({ spec: m[1], line: at });
    } else if (language === 'go') {
      if ((m = line.match(/^\s*(?:import\s+)?(?:\w+\s+)?"([^"]+)"\s*$/))) out.push({ spec: m[1], line: at });
    } else if (language === 'rust') {
      if ((m = line.match(/^\s*(?:pub\s+)?mod\s+([A-Za-z_]\w*)\s*;/))) out.push({ spec: `mod:${m[1]}`, line: at });
      else if ((m = line.match(/^\s*use\s+crate::([\w:]+)/))) out.push({ spec: `crate:${m[1]}`, line: at });
    }
  });
  return out;
}
