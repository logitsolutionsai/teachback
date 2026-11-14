# Course Format

A course is a folder. Learner courses live in `.teachback/<slug>/` under the folder you work in; the shipped examples live in `examples/`. JSON Schemas for every file are in `schema/`, and `teachback check` validates against them before it checks anything else.

```
.teachback/
  .current                      slug of the default course (written by init and use)
  attention/
    course.json                 what the course is about and where the source lives
    map.json                    concepts and prerequisites (a DAG)
    items.json                  the question bank
    exercises/
      01-softmax/
        exercise.json           manifest
        TASK.md                 what to build, for the learner
        softmax.py              starter: the learner's file, work left undone
        test_softmax.py         tests
        .reference/softmax.py   working solution, shown only on request
    learner.json                the learner record (written by the CLI)
    work/01-softmax/softmax.py  the learner's working copy (created by run)
    dashboard.html              written by teachback dashboard
```

Authored content (`course.json`, `map.json`, `items.json`, `exercises/`) is separate from learner state (`learner.json`, `work/`, `dashboard.html`), so a course can be shared, copied with `teachback init <slug> --from <folder>`, or edited without touching anyone's progress.

## Course File: `course.json`

| Field | Required | Meaning |
| --- | --- | --- |
| `schema` | yes | `"teachback/course@1"` |
| `slug` | yes | Lowercase id, letters, digits and hyphens |
| `title` | yes | Shown on the dashboard |
| `source` | yes | `title`, `authors`, `year`, `venue`, and at least one of `url` or `citation` |
| `licence` | yes | How the source may be used, and a statement that the course cites sections instead of copying text |
| `language` | no | `python`, `javascript` or `none`: the language of the rebuild track |
| `track` | no | Exercise ids in the order to rebuild them; the capstone goes last |
| `model` | no | Overrides for the learner model: `{ "bkt": {...}, "schedule": {...} }` |
| `kind` | no | `paper` (the default when absent), `repo-quest` or `review`. Repo courses add `source-lock.json`, `repo-map.json` and `quests.json`, and concepts, misconceptions and items may carry `sourceRefs`; see [repoquest.md](repoquest.md). |

Never put the source text in the course. Summaries and questions are your own writing and cite sections, tables, figures or equations.

## Concept Map: `map.json`

```json
{
  "schema": "teachback/map@1",
  "concepts": [
    {
      "id": "scaled-dot-product",
      "name": "Scaled dot-product attention",
      "summary": "One paragraph in your own words.",
      "sources": [{ "section": "3.2.1", "label": "Scaled Dot-Product Attention" }],
      "prerequisites": ["qkv-attention"],
      "difficulty": 3,
      "misconceptions": [{ "id": "scale-by-dk", "description": "Divides by d_k instead of its square root." }]
    }
  ]
}
```

| Field | Required | Meaning |
| --- | --- | --- |
| `id` | yes | Unique, lowercase with hyphens |
| `name` | yes | Short: it appears on the concept map (about 40 characters at most) |
| `summary` | yes | One paragraph, under 160 words, in your own words |
| `sources` | yes, at least one | `section` (such as `"3.2.1"`, `"Table 1"`, `"Figure 1"`), optional `label` and `page` |
| `prerequisites` | yes | Concept ids that must be mastered first; the map must be a DAG |
| `difficulty` | no | 1 (easy) to 5 (hard) |
| `pInit` | no | Prior chance the learner already knows it (default 0.2) |
| `misconceptions` | no, but warned | Mistakes learners commonly make: `id`, `description` |

## Question Bank: `items.json`

Every item practises one concept. Each concept needs at least 3 items of at least 2 types, and should have a teach-back item.

Common fields: `id`, `concept`, `type`, `prompt`, optional `difficulty` (1-5, default 3) and `source` (section).

### Multiple Choice (`mcq`)

```json
{
  "id": "sdpa-formula", "concept": "scaled-dot-product", "type": "mcq", "difficulty": 2,
  "prompt": "Which expression is the paper's scaled dot-product attention?",
  "options": [
    { "text": "softmax(QKᵀ) V / √d_k", "rationale": "The scaling goes inside the softmax." },
    { "text": "softmax(QKᵀ / √d_k) V", "rationale": "Correct. Equation 1." }
  ],
  "answer": 1
}
```

`answer` is the 0-based index of the correct option. Every option needs a `rationale`, which the tutor reads back after the learner answers. Learners answer with a letter (`B`), a 1-based number (`2`) or the option text.

### Numeric (`numeric`)

`answer` (a number) and `tolerance` (absolute, default 0), optional `unit` and `explanation`. Learners can answer `0.125`, `1/8`, `2^-3`, `12.5%`, `4,000` or `1e-3`.

### Short Answer And Teach-Back (`short`, `teachback`)

```json
"rubric": {
  "required": [
    { "id": "grow-large", "idea": "Dot products grow with d_k", "synonyms": ["grow large", "variance dk", "get bigger"] }
  ],
  "misconceptions": [
    { "id": "scale-for-speed", "description": "Thinks the scaling is for speed", "synonyms": ["faster", "for speed"] }
  ],
  "minRequired": 2
},
"modelAnswer": "A good answer in plain words."
```

`synonyms` are short phrases whose presence shows the idea (or the misconception). `minRequired` defaults to all required ideas. A required idea may set `"polarity": "negative"` (see below); the default is `"positive"`. Misconceptions accept `polarity` too.

#### How Rubric Matching Works

`grade` reports which ideas an answer covers. It is deterministic, has no dependencies, and is evidence for the tutor, never the verdict. The answer and every synonym go through the same steps, so a synonym is written once, in its plain form.

1. **Normalise.** Unicode is folded (accents dropped, `²` to `2`), text is lowercased, symbols become words (`√` sqrt, `∞` infinity, `×` x, `÷` divided by, `≈` approximately, `→` to, `≤` at most, `≥` at least), Greek letters become their names (`ε` epsilon, `σ` sigma), apostrophes and underscores inside a word join it (`don't` dont, `d_k` dk), and number words become digits (`one` 1, `sixty` 60), except a pronoun "one" ("each one", "the one").
2. **Split.** The text is cut into clauses at `.` `,` `;` `!` `?` and line breaks (not at a decimal point or a thousands comma), then into words. A hyphenated compound matches joined, spaced or hyphenated: `one-hot`, `one hot` and `onehot` all meet.
3. **Negators.** `not`, `never`, `cannot`, `don't` and the other contractions, `no`, `without`, `nor`, `neither`, `none` and `nothing` all count as the one word "not", so "cannot see the future" and "must not see the future" share their key words.
4. **Stem.** Each word is reduced by a light rule set, one rule per step:

   | Step | Rule | Examples |
   | --- | --- | --- |
   | Plurals | `-sses` to `-ss`, `-ies` to `-y`, `-xes` `-ches` `-shes` to the stem, a final `-s` dropped (not after `s`, `u` or `i`) | classes, queries, matches, weights |
   | One inflection | `-ingly` `-edly` `-ing` `-ied` `-ed` `-est` `-er` `-ly` dropped if at least three letters with a vowel remain; a doubled final consonant is undoubled | saturating, running, bigger, largest |
   | Derivations | `-ational` to `-ate`, `-isation` `-ization` to `-ise`, `-ation` to `-ate`, `-iveness` `-fulness` `-ousness` shortened, `-ness`, `-ment`, `-ity` dropped | saturation, normalisation, similarity |
   | Spelling | `-ize` as `-ise`, a final consonant-y as `i`, a final `e` dropped | normalize, query, scale |

   Words of three letters or fewer, numbers, and a short list of words that only look inflected (`bias`, `this`, `embed`, `series`, ...) are kept as they are. The stems need not be words: `saturates`, `saturated`, `saturating` and `saturation` all become `saturat`.
5. **Match a required idea by key words.** A synonym's key words are its words without stopwords (`the`, `of`, `is`, `can`, `get`, ...), unless that would leave fewer than two, in which case every word counts ("get large" keeps "get"). The idea is covered when all key words of one synonym appear in one clause of the answer, in any order, within a window of the number of key words plus four words. "compared with the query" matches "each key is compared against the query" and "the query and each key are compared".
6. **Match a misconception by phrase.** Misconception synonyms must appear as a phrase, in order, after the same normalising and stemming. A false alarm accuses a learner of a mistake they did not make, so misconceptions trade recall for precision: "divide by dk" does not fire on "dividing by √d_k".
7. **Negation.** A match is flagged as negated, and not counted, when a "not"-type word sits up to three words before it or inside it; `without`, `no`, `nor`, `neither`, `none` and `nothing` reach only two words ahead ("without scaling, the scores grow large" still counts "grow large"). A negator written in the synonym itself is part of the match, not a negation of it. A plain match of any synonym wins over a negated one.
8. **Polarity.** For an idea with `"polarity": "negative"` (an idea that is itself a negative statement, such as "position i must not see later positions"), negation is expected: matches next to a negator are counted, never flagged. Write such an idea's synonyms so they carry its sense ("future", "later positions", "peek"); the tutor reads the sentence.

The result lists, for each idea, the synonym that matched (`matched`), the learner's own words that matched it (`evidence`), and whether it was negated. Co-occurrence is not meaning: a wrong sentence that uses the right words in one clause ("the variance stays the same as d_k grows") is credited. `tests/fixtures/paraphrases.mjs` keeps the table of paraphrases that must match, near-misses and negations that must not, and these known limits.

`teachback` items are prompts such as "Explain to a friend why...". They differ from `short` items in purpose, not format: a teach-back asks for the whole idea in the learner's own words, and a correct teach-back is strong evidence.

### Code (`code`)

`exercise` names an exercise id. A code item is answered by passing the exercise; the first passing run counts as one correct answer for every code item that points at it.

## Exercise Manifest: `exercises/<id>/exercise.json`

```json
{
  "id": "02-scaled-dot-product",
  "title": "Scaled dot-product attention",
  "language": "python",
  "concepts": ["scaled-dot-product"],
  "starter": "attention.py",
  "tests": "test_attention.py",
  "support": ["linalg.py"],
  "capstone": false,
  "timeoutMs": 15000
}
```

| Field | Meaning |
| --- | --- |
| `language` | `python` (tests are `unittest` modules) or `javascript` (tests are `node:test` files) |
| `starter` | The file the learner edits. It must import cleanly and fail the tests (raise `NotImplementedError` or throw) |
| `tests` | One test file or a list |
| `support` | Helper files the starter or tests import, copied next to them for every run |
| `.reference/<starter>` | A working solution. `check` requires it to pass every test |
| `capstone` | The final exercise. The course is Rebuilt when it passes and every concept is mastered |
| `timeoutMs` | Per run, default 20000 |

Keep shipped exercises standard-library only and the tests hand-checkable: small matrices, numbers a learner can work out on paper.

## Learner Record: `learner.json`

Written only by the CLI. The `events` array is the source of truth; every other section is recomputed from it on each write, so it can be read directly without running the model. Commands that write it hold `learner.json.lock` for the moment of the write, so two at once cannot lose an event. An event without a valid `t` is skipped with a warning (and kept in the file).

```json
{
  "schema": "teachback/learner@1",
  "course": "attention",
  "createdAt": "2026-03-02T09:00:00.000Z",
  "updatedAt": "2026-03-06T10:12:00.000Z",
  "settings": { "utcOffsetMinutes": 0 },
  "mastery": { "softmax": { "pL": 0.99, "mastered": true, "attempts": 8, "correct": 6, "partial": 0, "wrong": 2, "lastSeen": "...", "firstMasteredAt": "...", "teachbackPassed": true } },
  "reviews": { "softmax-weights": { "attempts": 3, "lastResult": "correct", "reps": 1, "ease": 2.4, "interval": 1, "lapses": 1, "dueDay": "2026-03-07", "lastDay": "2026-03-06" } },
  "exercises": { "01-softmax": { "runs": 1, "passed": true, "lastStatus": "passed", "lastPassed": 9, "lastTotal": 9, "firstPassedAt": "..." } },
  "history": [{ "day": "2026-03-02", "mastered": 5, "meanMastery": 0.52 }],
  "rebuiltAt": "2026-03-06T10:11:00.000Z",
  "events": [
    { "t": "2026-03-02T09:01:00.000Z", "type": "answer", "item": "softmax-weights", "concept": "softmax", "result": "correct", "mode": "learn", "confidence": 3, "answer": "0.75" },
    { "t": "2026-03-02T09:20:00.000Z", "type": "run", "exercise": "01-softmax", "status": "passed", "passed": 9, "failed": 0, "total": 9, "file": "work/01-softmax/softmax.py" }
  ]
}
```

| Event field | Meaning |
| --- | --- |
| `t` | ISO timestamp (from the clock, or `--now` / `TEACHBACK_NOW`). If the system clock is behind the last event, the last event's time is used and the command prints a warning, so the log stays in order |
| `type` | `answer` or `run` |
| `result` | `correct`, `partial` or `wrong` (answers) |
| `mode` | `learn`, `review` (the item was due) or `pretest` |
| `confidence` | 1 guessing, 2 unsure, 3 fairly sure, 4 certain |
| `note`, `answer` | Optional free text: the tutor's note, the learner's answer |
| `status` | `passed`, `failed`, `timeout` or `error` (runs) |

`settings.utcOffsetMinutes` fixes how timestamps map to calendar days for reviews. It is set from the machine when the record is created (or from `TEACHBACK_UTC_OFFSET`, in minutes east of UTC: `330` for UTC+05:30) and never changes on its own, so a review due "tomorrow" stays due tomorrow when you travel.
