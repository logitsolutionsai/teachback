// Rubric coverage: normalisation, stemming, key-term windows, clause scope,
// negation and polarity, and the paraphrase table (tests/fixtures/paraphrases.mjs)
// run against the real rubrics of the shipped courses.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { rubricCoverage, normalise, stem, tokenise } from '../src/grade.mjs';
import { IDEA_ROWS, MISCONCEPTION_ROWS, LIMIT_ROWS } from './fixtures/paraphrases.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const ITEMS = new Map(
  ['attention-is-all-you-need', 'bloom-filters']
    .flatMap((c) => JSON.parse(fs.readFileSync(path.join(ROOT, 'examples', c, 'items.json'), 'utf8')).items)
    .map((i) => [i.id, i])
);
const ideaOf = (item, id) => ITEMS.get(item).rubric.required.find((r) => r.id === id);
const credited = (r) => r.covered && !r.negated;

test('normalisation: case, accents, punctuation, symbols, Greek letters and number words', () => {
  assert.deepEqual(normalise('Café, NAÏVE!'), normalise('cafe naive'));
  assert.deepEqual(normalise('ε_ls = 0.1 and σ²'), ['epsilon', 'ls', '0.1', 'and', 'sigma', '2']);
  assert.deepEqual(normalise('back to one'), normalise('back to 1'));
  assert.deepEqual(normalise('twenty heads, sixty-four dims'), ['20', 'head', '60', '4', 'dim']);
  assert.deepEqual(normalise('4,000 steps at 0.75'), ['4', '000', 'step', 'at', '0.75'], 'a comma inside a number does not end the clause');
  assert.deepEqual(normalise('x ≤ y ≥ z'), ['x', 'at', 'most', 'y', 'at', 'least', 'z']);
  assert.deepEqual(normalise('each one, the one, back to one'), ['each', 'one', 'the', 'one', 'back', 'to', '1'], '"one" after a determiner is a pronoun');
});

test('hyphenated compounds meet their joined and spaced forms', () => {
  const rubric = { required: [{ id: 'h', idea: 'one-hot', synonyms: ['one-hot'] }] };
  for (const a of ['nearly one-hot', 'nearly one hot', 'nearly onehot', 'Nearly ONE-HOT.']) assert.equal(rubricCoverage(rubric, a).covered, 1, a);
  const spaced = { required: [{ id: 'h', idea: 'self attention', synonyms: ['self attention'] }] };
  assert.equal(rubricCoverage(spaced, 'it uses self-attention').covered, 1);
});

test('stemming maps variants of a word to one stem', () => {
  const same = [
    ['saturate', 'saturates', 'saturated', 'saturating', 'saturation'],
    ['gradient', 'gradients'],
    ['query', 'queries'],
    ['large', 'larger', 'largest'],
    ['big', 'bigger', 'biggest'],
    ['normalise', 'normalize', 'normalised', 'normalization', 'normalisation'],
    ['match', 'matches', 'matched', 'matching'],
    ['add', 'added', 'adding', 'adds'],
    ['run', 'running', 'runs'],
    ['bias', 'biases', 'biased'],
    ['similar', 'similarity'],
    ['embedding', 'embeddings', 'embedded', 'embed']
  ];
  for (const group of same) {
    const stems = new Set(group.map(stem));
    assert.equal(stems.size, 1, `${group.join(', ')} -> ${[...stems].join(', ')}`);
  }
  for (const short of ['is', 'dk', 'key', '0.1', 'as']) assert.equal(stem(short), short);
  assert.notEqual(stem('value'), stem('valve'));
});

test('a required idea matches when its key words sit close together, in any order', () => {
  const rubric = { required: [{ id: 'k', idea: 'Keys are compared with the query', synonyms: ['compared with the query'] }] };
  for (const a of ['Each key is compared against the query.', 'The query and each key are compared.', 'keys compared to queries']) {
    const cv = rubricCoverage(rubric, a);
    assert.equal(cv.covered, 1, a);
  }
  const far = rubricCoverage(rubric, 'The query, a learned projection of the token embedding with its own weights and bias, is later compared.');
  assert.equal(far.covered, 0, 'key words in different clauses do not match');
  const cv = rubricCoverage(rubric, 'Each key is compared against the query.');
  assert.equal(cv.required[0].evidence, 'compared against the query', 'evidence quotes the words that matched');
});

test('a phrase made mostly of stopwords keeps them as key words', () => {
  const rubric = { required: [{ id: 'g', idea: 'Scores grow', synonyms: ['get large'] }] };
  assert.equal(rubricCoverage(rubric, 'The scores get large.').covered, 1);
  assert.equal(rubricCoverage(rubric, 'The model is large.').covered, 0, 'one content word alone is not the phrase');
});

test('misconceptions match as phrases, so a right answer sharing their words does not trigger them', () => {
  const rubric = { required: [], misconceptions: [{ id: 'dk', description: 'Divides by d_k', synonyms: ['divide by dk'] }] };
  assert.equal(rubricCoverage(rubric, 'Dividing by √d_k keeps unit variance.').misconceptions[0].present, false);
  assert.equal(rubricCoverage(rubric, 'You divide by d_k.').misconceptions[0].present, true);
});

test('negation: "not" and "never" reach three words ahead and through the match; "without" and "no" reach two', () => {
  const rubric = { required: [{ id: 'g', idea: 'Scores grow large', synonyms: ['grow large'] }] };
  assert.equal(credited(rubricCoverage(rubric, 'Without scaling, the scores grow large.').required[0]), true, '"without" negates "scaling", not the growth');
  assert.equal(credited(rubricCoverage(rubric, 'Without scaling the scores grow large.').required[0]), true);
  assert.equal(rubricCoverage(rubric, 'The scores no longer grow large.').required[0].negated, true);
  assert.equal(rubricCoverage(rubric, 'They do not grow large.').required[0].negated, true);
  assert.equal(rubricCoverage(rubric, 'Large? They never grow that large.').required[0].negated, true, 'a negator inside the match counts');
  const masking = { required: [{ id: 'm', idea: 'Masking', synonyms: ['masking'] }] };
  assert.equal(rubricCoverage(masking, 'It works without masking.').required[0].negated, true);
});

test('a negator written in the synonym is part of the match, not a negation of it', () => {
  const rubric = { required: [{ id: 'n', idea: 'No false negatives', synonyms: ['never a false negative'] }] };
  for (const a of ['It can never give a false negative.', 'There is no false negative.', 'False negatives cannot happen.']) {
    assert.equal(credited(rubricCoverage(rubric, a).required[0]), true, a);
  }
});

test('polarity "negative": a negation next to the match is expected, not flagged', () => {
  const idea = { id: 'f', idea: 'Position i must not see later positions', synonyms: ['future', 'later positions'] };
  const answer = 'The decoder must not peek at future tokens.';
  const plain = rubricCoverage({ required: [idea] }, answer).required[0];
  assert.equal(plain.negated, true, 'the default flags it');
  const negative = rubricCoverage({ required: [{ ...idea, polarity: 'negative' }] }, answer).required[0];
  assert.equal(credited(negative), true);
  assert.equal(negative.polarity, 'negative');
  assert.equal(rubricCoverage({ required: [{ ...idea, polarity: 'positive' }] }, answer).required[0].negated, true, '"positive" is the default');
  const mc = { required: [], misconceptions: [{ id: 'x', description: 'FFN mixes positions', polarity: 'negative', synonyms: ['ignores order'] }] };
  assert.equal(rubricCoverage(mc, 'It does not ignore order.').misconceptions[0].negated, false, 'misconceptions accept polarity too');
});

test('the shipped courses mark their negative-by-nature ideas', () => {
  for (const r of IDEA_ROWS.filter((x) => x.negative)) assert.equal(ideaOf(r.item, r.idea).polarity, 'negative', `${r.item}/${r.idea}`);
});

for (const kind of ['paraphrase', 'near-miss', 'negation']) {
  test(`paraphrase table: every ${kind} row`, () => {
    for (const r of IDEA_ROWS.filter((x) => x.kind === kind)) {
      const got = rubricCoverage({ required: [ideaOf(r.item, r.idea)] }, r.answer).required[0];
      assert.equal(credited(got), r.match, `${r.item}/${r.idea}: "${r.answer}" (matched ${got.matched ?? 'nothing'}${got.negated ? ', negated' : ''})`);
    }
  });
}

test('paraphrase table: misconception rows', () => {
  for (const r of MISCONCEPTION_ROWS) {
    const mc = ITEMS.get(r.item).rubric.misconceptions.find((m) => m.id === r.misconception);
    const got = rubricCoverage({ required: [], misconceptions: [mc] }, r.answer).misconceptions[0];
    assert.equal(got.present && !got.negated, r.present, `${r.item}/${r.misconception}: "${r.answer}"`);
  }
});

test('known limits stay known: answers that are wrong but share the key words are still credited', () => {
  for (const r of LIMIT_ROWS) {
    const got = rubricCoverage({ required: [ideaOf(r.item, r.idea)] }, r.answer).required[0];
    assert.equal(credited(got), true, `${r.item}/${r.idea}: "${r.answer}" is no longer credited; move it to the near-miss rows`);
  }
});

test('tokenise keeps clauses apart and remembers the words as written', () => {
  const s = tokenise('Keys match; values mix, then\nout');
  assert.deepEqual(s.map((t) => t.map((x) => x.surface)), [['keys', 'match'], ['values', 'mix'], ['then'], ['out']]);
  assert.equal(s[0][0].term, 'key');
});

test('old rubrics keep working: an exact synonym still matches and the suggestion logic is unchanged', () => {
  const rubric = {
    required: [
      { id: 'a', idea: 'A', synonyms: ['weighted sum of the values'] },
      { id: 'b', idea: 'B', synonyms: ['compared with the query'] }
    ],
    misconceptions: [{ id: 'm', description: 'M', synonyms: ['values are the weights'] }],
    minRequired: 1
  };
  assert.equal(rubricCoverage(rubric, 'a weighted sum of the values').suggestion, 'correct');
  assert.equal(rubricCoverage(rubric, 'the values are the weights').suggestion, 'wrong');
  assert.equal(rubricCoverage(rubric, 'the values are the weights, a weighted sum of the values').suggestion, 'partial');
  assert.equal(rubricCoverage({ required: [{ id: 'x', idea: 'Uses softmax' }] }, 'it uses a softmax').covered, 1, 'an idea with no synonyms matches on its own words');
});
