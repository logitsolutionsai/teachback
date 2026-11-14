// Grading. mcq and numeric are graded deterministically. short and teachback
// answers get a rubric coverage report: evidence for the tutor's judgement,
// never the verdict.
import { TeachbackError } from './util.mjs';

// ---------- mcq ----------
// Accepts a letter (B, b, "(B)", "option B"), a 1-based number, or the option text.
export function parseMcqAnswer(item, raw) {
  const s = String(raw ?? '').trim();
  const n = item.options.length;
  const letter = s.match(/^(?:option\s*)?\(?([A-Za-z])\)?[.):]?$/i);
  if (letter) {
    const idx = letter[1].toUpperCase().charCodeAt(0) - 65;
    if (idx >= 0 && idx < n) return idx;
  }
  if (/^\d+$/.test(s)) {
    const idx = Number(s) - 1;
    if (idx >= 0 && idx < n) return idx;
  }
  const norm = (t) => normalise(t).join(' ');
  const byText = item.options.findIndex((o) => norm(o.text) === norm(s));
  if (byText >= 0) return byText;
  throw new TeachbackError(
    'E101',
    `Could not read "${s}" as one of the ${n} options.`,
    `Answer with a letter A-${String.fromCharCode(64 + n)}, a number 1-${n}, or the option text.`
  );
}

export function gradeMcq(item, raw) {
  const chosen = parseMcqAnswer(item, raw);
  const correct = chosen === item.answer;
  return {
    type: 'mcq',
    deterministic: true,
    result: correct ? 'correct' : 'wrong',
    chosen: String.fromCharCode(65 + chosen),
    correctOption: String.fromCharCode(65 + item.answer),
    rationale: item.options[chosen].rationale,
    correctRationale: correct ? undefined : item.options[item.answer].rationale
  };
}

// ---------- numeric ----------
export function parseNumber(raw) {
  const value = readNumber(raw);
  if (!Number.isFinite(value)) {
    throw new TeachbackError('E102', `"${raw}" is not a finite number.`, 'Give a finite number, such as 0.125, 1/8 or 2^-3.');
  }
  return value;
}

function readNumber(raw) {
  let s = String(raw ?? '').trim().replace(/\s+/g, '');
  if (s.includes(',')) {
    // Commas may only group thousands (4,000). "0,75" is a decimal comma: reading
    // it as 75 would grade a right answer wrong, so ask for a dot instead.
    if (!/^[-+]?\d{1,3}(,\d{3})+(\.\d+)?%?$/.test(s)) {
      throw new TeachbackError('E102', `Could not read "${raw}" as a number.`, 'Use a dot for decimals (0.75). Commas may only group thousands (4,000).');
    }
    s = s.replace(/,/g, '');
  }
  let scale = 1;
  if (s.endsWith('%')) {
    scale = 0.01;
    s = s.slice(0, -1);
  }
  const frac = s.match(/^([-+]?\d*\.?\d+(?:e[-+]?\d+)?)\/([-+]?\d*\.?\d+(?:e[-+]?\d+)?)$/i);
  if (frac) return (Number(frac[1]) / Number(frac[2])) * scale;
  const pow = s.match(/^([-+]?\d*\.?\d+)\^([-+]?\d*\.?\d+)$/);
  if (pow) return Number(pow[1]) ** Number(pow[2]) * scale;
  if (/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(s)) return Number(s) * scale;
  throw new TeachbackError('E102', `Could not read "${raw}" as a number.`, 'Use a plain number (0.125), a fraction (1/8), a power (2^-3) or a percentage (12.5%).');
}

export function gradeNumeric(item, raw) {
  const value = parseNumber(raw);
  const tol = item.tolerance ?? 0;
  const err = Math.abs(value - item.answer);
  const correct = err <= tol + 1e-12;
  return {
    type: 'numeric',
    deterministic: true,
    result: correct ? 'correct' : 'wrong',
    value,
    expected: item.answer,
    tolerance: tol,
    explanation: item.explanation
  };
}

// ---------- rubric coverage ----------
// Deterministic and dependency-free. Answer and synonyms go through the same
// normalisation and stemming, so an author writes a synonym once in its plain
// form. Required ideas match by key terms near each other (any order, one
// clause); misconceptions match as phrases, because a false alarm accuses a
// learner of a mistake they did not make. references/format.md documents the rules.

const SYMBOLS = [
  [/√/g, ' sqrt '],
  [/∞/g, ' infinity '],
  [/×/g, ' x '],
  [/÷/g, ' divided by '],
  [/≈/g, ' approximately '],
  [/→/g, ' to '],
  [/≤/g, ' at most '],
  [/≥/g, ' at least '],
  [/≠/g, ' unequal '],
  [/[−–—]/g, ' '], // minus sign and dashes separate words; an ASCII hyphen inside a word joins a compound
  [/[‘’]/g, "'"]
];

const GREEK = { α: 'alpha', β: 'beta', γ: 'gamma', δ: 'delta', ε: 'epsilon', θ: 'theta', λ: 'lambda', μ: 'mu', π: 'pi', σ: 'sigma', τ: 'tau', φ: 'phi', ω: 'omega', Σ: 'sum', Δ: 'delta' };

const NUMBER_WORDS = {
  zero: '0', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9', ten: '10',
  eleven: '11', twelve: '12', thirteen: '13', fourteen: '14', fifteen: '15', sixteen: '16', seventeen: '17', eighteen: '18', nineteen: '19',
  twenty: '20', thirty: '30', forty: '40', fifty: '50', sixty: '60', seventy: '70', eighty: '80', ninety: '90',
  hundred: '100', thousand: '1000', million: '1000000'
};

// Every negator matches as the one word "not", so "cannot see" and "must not
// see" are the same key terms. "without", "no", "nor", "neither", "none" and
// "nothing" negate only the next two words ("without scaling, the scores grow"
// does not negate "grow"); the others reach three words ahead and through the match.
const WIDE_NEGATORS = new Set(['not', 'never', 'cannot', 'cant', 'dont', 'doesnt', 'didnt', 'isnt', 'arent', 'wasnt', 'werent', 'wont', 'wouldnt', 'shouldnt', 'couldnt', 'mustnt', 'hasnt', 'havent', 'hadnt', 'neednt']);
const NARROW_NEGATORS = new Set(['no', 'without', 'nor', 'neither', 'none', 'nothing']);

// Words left out of a synonym's key terms (they still count toward its length).
const STOPWORDS = new Set([
  'a', 'an', 'the', 'of', 'to', 'in', 'on', 'at', 'by', 'for', 'with', 'from', 'as', 'into', 'onto', 'than', 'then', 'that', 'this', 'these', 'those',
  'it', 'its', 'they', 'them', 'their', 'there', 'which', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'and', 'or', 'so', 'also', 'just', 'very',
  'can', 'could', 'may', 'might', 'must', 'shall', 'should', 'will', 'would', 'do', 'does', 'did', 'has', 'have', 'had', 'get', 'gets', 'got', 'getting'
]);

// Words kept as they are: they end in s, -ed or -er without being plurals or inflections.
const KEEP = new Set([
  'bias', 'gas', 'alias', 'atlas', 'lens', 'canvas', 'yes', 'thus', 'this', 'plus', 'minus', 'versus', 'always', 'perhaps', 'news', 'series', 'species',
  'less', 'unless', 'chaos', 'does', 'corpus', 'focus', 'bonus', 'status', 'radius', 'consensus', 'embed', 'shred', 'hundred', 'sacred', 'naked'
]);

const VOWEL = /[aeiouy]/;
const INFLECTIONS = ['ingly', 'edly', 'ing', 'ied', 'ed', 'est', 'er', 'ly'];
const DERIVATIONS = [
  ['ational', 'ate', 3],
  ['isation', 'ise', 3],
  ['ization', 'ise', 3],
  ['ation', 'ate', 3],
  ['iveness', 'ive', 3],
  ['fulness', 'ful', 3],
  ['ousness', 'ous', 3],
  ['ness', '', 3],
  ['ment', '', 4],
  ['ity', '', 4]
];

// Light English stemming, one documented rule per step (format.md lists them).
// It only has to map variants of a word to the same stem on both sides; the
// stems need not be words. saturates, saturated, saturating, saturation -> saturat.
export function stem(word) {
  let w = word;
  if (w.length <= 3 || /\d/.test(w) || KEEP.has(w)) return w;
  // 1. Plurals: classes -> class, queries -> query, matches -> match, weights -> weight.
  if (w.endsWith('sses')) w = w.slice(0, -2);
  else if (w.endsWith('ies') && w.length > 4) w = `${w.slice(0, -3)}y`;
  else if (/(x|ch|sh|zz)es$/.test(w)) w = w.slice(0, -2);
  else if (w.endsWith('s') && !/(ss|us|is)$/.test(w)) w = w.slice(0, -1);
  if (KEEP.has(w)) return w;
  // 2. One inflection: -ing, -ed, -er, -est, -ly, if at least three letters with a vowel remain.
  for (const suf of INFLECTIONS) {
    if (!w.endsWith(suf) || (suf === 'ed' && w.endsWith('eed'))) continue;
    const base = w.slice(0, -suf.length);
    if (base.length < 3 || !VOWEL.test(base)) continue;
    w = suf === 'ied' ? `${base}y` : base;
    // running -> run, bigger -> big (but add stays add, small stays small).
    if (/([^aeioulsz])\1$/.test(w) && w.length > 3) w = w.slice(0, -1);
    break;
  }
  // 3. Derivations: saturation -> saturate, normalisation -> normalise, similarity -> similar.
  for (const [suf, rep, min] of DERIVATIONS) {
    if (w.endsWith(suf) && w.length - suf.length >= min) {
      w = w.slice(0, -suf.length) + rep;
      break;
    }
  }
  // 4. Spelling: -ize as -ise, a final consonant-y as i, no final e.
  if (w.length > 5) w = w.replace(/iz(e?)$/, 'is$1');
  if (w.length > 3 && /[^aeiou]y$/.test(w)) w = `${w.slice(0, -1)}i`;
  if (w.length > 3 && w.endsWith('e')) w = w.slice(0, -1);
  return w;
}

// "one" after one of these is a pronoun ("each one", "the one"), not the number.
const PRONOUN_ONE = new Set(['each', 'every', 'the', 'this', 'that', 'which', 'any', 'some', 'another', 'no', 'other']);

function makeToken(word, prev) {
  const narrow = NARROW_NEGATORS.has(word);
  const neg = WIDE_NEGATORS.has(word) ? 'wide' : narrow ? 'narrow' : null;
  const number = word === 'one' && PRONOUN_ONE.has(prev?.surface) ? undefined : NUMBER_WORDS[word];
  const term = neg ? 'not' : number ?? stem(word);
  return { term, surface: word, neg, stop: STOPWORDS.has(word), alt: null, pieces: 1 };
}

// Text -> clauses of tokens. A token has its stem (`term`), the word as
// written (`surface`), whether it negates, whether it is a stopword, and for
// the first part of a hyphenated compound the stem of the joined word (`alt`),
// so "one-hot", "one hot" and "onehot" all meet.
export function tokenise(text) {
  let s = String(text ?? '').normalize('NFKD').replace(/\p{M}+/gu, '');
  for (const [re, rep] of SYMBOLS) s = s.replace(re, rep);
  s = s.replace(/[αβγδεθλμπστφωΣΔ]/g, (c) => ` ${GREEK[c]} `).toLowerCase();
  // Apostrophes and underscores inside a word join it: don't -> dont, d_k -> dk.
  s = s.replace(/([a-z0-9])['_]([a-z0-9])/g, '$1$2');
  const sentences = [];
  // Matching stays inside one clause: it ends at . , ! ? ; or a line break. A dot
  // or comma before a digit belongs to a number (0.75, 4,000).
  for (const part of s.split(/[!?;\n\r]+|[.,](?!\d)/)) {
    const tokens = [];
    for (const raw of part.split(/[^a-z0-9.\-]+/)) {
      const word = raw.replace(/^[.\-]+|[.\-]+$/g, '');
      if (!word) continue;
      const pieces = word.split(/-+/).filter(Boolean);
      if (pieces.length > 1) {
        const first = makeToken(pieces[0], tokens.at(-1));
        first.alt = stem(pieces.join(''));
        first.pieces = pieces.length;
        tokens.push(first);
        for (const piece of pieces.slice(1)) tokens.push(makeToken(piece, tokens.at(-1)));
      } else tokens.push(makeToken(word, tokens.at(-1)));
    }
    if (tokens.length) sentences.push(tokens);
  }
  return sentences;
}

// The stems of a text, in order: what matching compares.
export function normalise(text) {
  return tokenise(text).flat().map((t) => t.term);
}

// A synonym as one or two term sequences: as written, and with each
// hyphenated compound joined ("one-hot" -> [1, hot] and [onehot]).
function compilePhrase(phrase) {
  const tokens = tokenise(phrase).flat();
  const split = tokens.map((t) => ({ term: t.term, stop: t.stop }));
  const variants = [split];
  if (tokens.some((t) => t.alt)) {
    const joined = [];
    for (let i = 0; i < tokens.length; i += tokens[i].pieces) joined.push(tokens[i].alt ? { term: tokens[i].alt, stop: false } : split[i]);
    variants.push(joined);
  }
  return variants.map((v) => {
    const terms = v.map((t) => t.term);
    // Stopwords are left out only while two or more content words remain:
    // "get large" keeps "get", or every "large" in the answer would match.
    const content = v.filter((t) => !t.stop).map((t) => t.term);
    const key = [...new Set(content.length >= 2 ? content : terms)];
    return { terms, key, window: Math.max(key.length + 4, terms.length) };
  });
}

const has = (tok, term) => tok.term === term || tok.alt === term;

// Is the match at tokens[a..b] negated? Positions inside the match that the
// synonym itself accounts for (its key terms) never count.
function negatedAt(tokens, a, b, own) {
  for (let j = Math.max(0, a - 3); j <= b; j++) {
    if (own.has(j)) continue;
    const t = tokens[j];
    if (t.neg === 'wide') return true;
    if (t.neg === 'narrow' && j < a && a - j <= 2) return true;
  }
  return false;
}

// Key terms within a window, any order, one clause. Yields every minimal span.
function* windowMatches(tokens, v) {
  const hits = [];
  tokens.forEach((tok, i) => {
    for (const k of v.key) if (has(tok, k)) hits.push({ i, k });
  });
  for (let s = 0; s < hits.length; s++) {
    const seen = new Map();
    for (let e = s; e < hits.length && hits[e].i - hits[s].i < v.window; e++) {
      if (!seen.has(hits[e].k)) seen.set(hits[e].k, hits[e].i);
      if (seen.size === v.key.length) {
        yield { a: hits[s].i, b: hits[e].i, own: new Set(seen.values()) };
        break;
      }
    }
  }
}

// The terms in order, contiguous. Yields every occurrence.
function* phraseMatches(tokens, v) {
  outer: for (let i = 0; i + v.terms.length <= tokens.length; i++) {
    const own = new Set();
    for (let j = 0; j < v.terms.length; j++) {
      if (!has(tokens[i + j], v.terms[j])) continue outer;
      own.add(i + j);
    }
    yield { a: i, b: i + v.terms.length - 1, own };
  }
}

// The first plain match of any synonym; failing that, the first negated one.
// One synonym near a "not" must not hide another synonym used plainly.
function matchAny(sentences, phrases, { mode, polarity }) {
  let negatedMatch = null;
  for (const p of phrases) {
    for (const v of compilePhrase(p)) {
      if (!v.terms.length) continue;
      for (const tokens of sentences) {
        for (const m of mode === 'window' ? windowMatches(tokens, v) : phraseMatches(tokens, v)) {
          const evidence = tokens.slice(m.a, m.b + 1).map((t) => t.surface).join(' ');
          const negated = polarity !== 'negative' && negatedAt(tokens, m.a, m.b, m.own);
          if (!negated) return { phrase: p, negated: false, evidence };
          negatedMatch ??= { phrase: p, negated: true, evidence };
        }
      }
    }
  }
  return negatedMatch;
}

export function rubricCoverage(rubric, answer) {
  const sentences = tokenise(answer);
  const required = (rubric?.required ?? []).map((idea) => {
    const phrases = idea.synonyms?.length ? idea.synonyms : [idea.idea];
    const m = matchAny(sentences, phrases, { mode: 'window', polarity: idea.polarity });
    return { id: idea.id, idea: idea.idea, covered: Boolean(m), matched: m?.phrase ?? null, evidence: m?.evidence ?? null, negated: m?.negated ?? false, ...(idea.polarity ? { polarity: idea.polarity } : {}) };
  });
  const misconceptions = (rubric?.misconceptions ?? []).map((mc) => {
    const m = matchAny(sentences, mc.synonyms ?? [], { mode: 'phrase', polarity: mc.polarity });
    return { id: mc.id, description: mc.description, present: Boolean(m), matched: m?.phrase ?? null, evidence: m?.evidence ?? null, negated: m?.negated ?? false };
  });
  const covered = required.filter((r) => r.covered && !r.negated).length;
  const total = required.length;
  const minRequired = rubric?.minRequired ?? total;
  const flagged = misconceptions.filter((m) => m.present && !m.negated);
  let suggestion;
  if (flagged.length) suggestion = covered >= minRequired ? 'partial' : 'wrong';
  else if (covered >= minRequired) suggestion = 'correct';
  else if (covered > 0) suggestion = 'partial';
  else suggestion = 'wrong';
  return {
    covered,
    total,
    minRequired,
    required,
    misconceptions,
    suggestion,
    words: sentences.reduce((n, s) => n + s.length, 0),
    caution: [
      'Rubric coverage is evidence, not a verdict. It finds key words near each other, so it misses paraphrases in other words and can be fooled by a list of keywords.',
      ...(required.some((r) => r.negated) || misconceptions.some((m) => m.negated)
        ? ['Some matches sit next to a negation ("not", "never"); read those sentences before deciding.']
        : [])
    ]
  };
}

export function gradeItem(item, raw) {
  switch (item.type) {
    case 'mcq':
      return gradeMcq(item, raw);
    case 'numeric':
      return gradeNumeric(item, raw);
    case 'short':
    case 'teachback':
      return { type: item.type, deterministic: false, coverage: rubricCoverage(item.rubric, raw), modelAnswer: item.modelAnswer };
    case 'code':
      throw new TeachbackError('E103', `Item "${item.id}" is a code item.`, `Run the exercise instead: teachback run ${item.exercise}`);
    default:
      throw new TeachbackError('E104', `Item "${item.id}" has unknown type "${item.type}".`, 'Use mcq, numeric, short, teachback or code.');
  }
}
