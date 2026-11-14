// The paraphrase table for rubric coverage. Every row uses a real rubric idea
// from a shipped course. `match` says whether the idea must be credited.
// Rows marked negative use an idea that declares "polarity": "negative".
//   paraphrase: right in substance, other words or word order; must match
//   near-miss:  shares words with the idea but does not state it; must not match
//   negation:   states the opposite; must not match
export const IDEA_ROWS = [
  // Paraphrases: stemming, number words, compounds, word order, gaps between key terms.
  { kind: 'paraphrase', item: 'sdpa-teachback', idea: 'variance-dk', answer: 'Its variance becomes d_k.', match: true },
  { kind: 'paraphrase', item: 'sdpa-teachback', idea: 'variance-dk', answer: 'Adding up d_k such products gives a bigger spread.', match: true },
  { kind: 'paraphrase', item: 'sdpa-teachback', idea: 'variance-dk', answer: 'The variances of the 64 products add together.', match: true },
  { kind: 'paraphrase', item: 'sdpa-teachback', idea: 'rescale', answer: 'Dividing by √d_k brings the variance back down to one.', match: true },
  { kind: 'paraphrase', item: 'sdpa-teachback', idea: 'softmax-gradients', answer: 'Softmax saturation makes learning stall.', match: true },
  { kind: 'paraphrase', item: 'sdpa-teachback', idea: 'softmax-gradients', answer: 'The softmax output ends up nearly onehot.', match: true },
  { kind: 'paraphrase', item: 'sdpa-teachback', idea: 'softmax-gradients', answer: 'Then the gradients get really small.', match: true },
  { kind: 'paraphrase', item: 'sdpa-why-scale', idea: 'grow-large', answer: 'The dot products grow very large when d_k is big.', match: true },
  { kind: 'paraphrase', item: 'qkv-roles', idea: 'keys-match', answer: 'Each key is compared against the query.', match: true },
  { kind: 'paraphrase', item: 'qkv-roles', idea: 'keys-match', answer: 'The query is matched with every key.', match: true },
  { kind: 'paraphrase', item: 'qkv-roles', idea: 'keys-match', answer: 'The keys decide how much weight each position gets.', match: true },
  { kind: 'paraphrase', item: 'qkv-roles', idea: 'keys-match', answer: 'Keys measure how similar each position is to the query.', match: true },
  { kind: 'paraphrase', item: 'qkv-roles', idea: 'values-content', answer: 'The output blends the values using those weights.', match: true },
  { kind: 'paraphrase', item: 'qkv-roles', idea: 'values-content', answer: 'We take a weighted average over the values.', match: true },
  { kind: 'paraphrase', item: 'qkv-roles', idea: 'values-content', answer: 'Attention combines the values.', match: true },
  { kind: 'paraphrase', item: 'iq-teachback', idea: 'insert', answer: 'Inserting hashes the item and the k positions get set to one.', match: true },
  { kind: 'paraphrase', item: 'iq-teachback', idea: 'query', answer: 'A query checks whether those k bits are all 1.', match: true },
  { kind: 'paraphrase', item: 'mask-teachback', idea: 'no-future', answer: 'The decoder must not peek at future tokens.', match: true, negative: true },
  { kind: 'paraphrase', item: 'pe-teachback', idea: 'order-blind', answer: 'Attention does not know the order of the tokens.', match: true, negative: true },
  { kind: 'paraphrase', item: 'ffn-teachback', idea: 'attention-mixes', answer: 'The FFN does not mix information between positions; attention does that.', match: true, negative: true },

  // Near-misses: some of the words, not the idea.
  { kind: 'near-miss', item: 'sdpa-teachback', idea: 'variance-dk', answer: 'Each component of q and k has variance 1.', match: false },
  { kind: 'near-miss', item: 'sdpa-teachback', idea: 'softmax-gradients', answer: 'The gradient is fine. Small scores come out of the softmax.', match: false },
  { kind: 'near-miss', item: 'sdpa-why-scale', idea: 'grow-large', answer: 'The variance stays the same as the model grows.', match: false },
  { kind: 'near-miss', item: 'qkv-roles', idea: 'keys-match', answer: 'The keys are stored, and the query goes through its own linear layer.', match: false },
  { kind: 'near-miss', item: 'qkv-roles', idea: 'values-content', answer: 'The weights are averaged and then multiplied by the keys.', match: false },
  { kind: 'near-miss', item: 'iq-teachback', idea: 'query', answer: 'Bits are cheap. Each query is hashed once.', match: false },
  { kind: 'near-miss', item: 'mask-teachback', idea: 'no-future', answer: 'Every position attends to every other position.', match: false, negative: true },
  { kind: 'near-miss', item: 'qkv-roles', idea: 'values-content', answer: 'The keys are mixed, the values are ignored.', match: false },

  // Negations: the opposite claim.
  { kind: 'negation', item: 'sdpa-teachback', idea: 'variance-dk', answer: 'The variance does not grow with d_k.', match: false },
  { kind: 'negation', item: 'sdpa-teachback', idea: 'softmax-gradients', answer: 'The softmax never saturates here.', match: false },
  { kind: 'negation', item: 'sdpa-why-scale', idea: 'grow-large', answer: 'With scaling, the scores no longer grow large.', match: false },
  { kind: 'negation', item: 'qkv-roles', idea: 'keys-match', answer: 'Keys are not compared with the query at all.', match: false },
  { kind: 'negation', item: 'qkv-roles', idea: 'values-content', answer: 'The values are never mixed into the output.', match: false }
];

// Misconceptions match as phrases: a right answer that shares their words must not trigger them.
export const MISCONCEPTION_ROWS = [
  { kind: 'near-miss', item: 'sdpa-why-scale', misconception: 'scale-by-dk', answer: 'Dividing by √d_k keeps the scores at unit variance.', present: false },
  { kind: 'near-miss', item: 'mask-teachback', misconception: 'mask-zero-score', answer: 'Set the masked scores to minus infinity, so their weight is 0.', present: false },
  { kind: 'negation', item: 'sdpa-why-scale', misconception: 'scale-for-speed', answer: 'It is not there for speed.', present: false },
  { kind: 'paraphrase', item: 'qkv-roles', misconception: 'values-are-weights', answer: 'I think the values are the weights.', present: true }
];

// Known limits, pinned so a change is noticed. Each answer is wrong, but the
// grader credits the idea: the key words sit together in a clause that says
// something else. Co-occurrence is not meaning, which is why the tutor reads
// the answer and the rubric is only evidence. `old` is what the phrase-only
// grader before 0.1.0 did (true: it was fooled too).
export const LIMIT_ROWS = [
  { item: 'sdpa-why-scale', idea: 'grow-large', answer: 'The variance stays the same as d_k grows.', old: false },
  { item: 'sdpa-teachback', idea: 'softmax-gradients', answer: 'Small changes in the gradient do not matter much.', old: false },
  { item: 'sdpa-teachback', idea: 'rescale', answer: 'Dividing by d_k makes the variance 1/d_k.', old: true },
  { item: 'qkv-roles', idea: 'keys-match', answer: 'The values are compared with the query.', old: true },
  { item: 'iq-teachback', idea: 'insert', answer: 'Insert checks the bits; query sets the bits.', old: true }
];
