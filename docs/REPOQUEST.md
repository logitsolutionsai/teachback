# RepoQuest

RepoQuest extends teachback from "learn a paper until you can rebuild it" to "learn an unfamiliar repository until you can make and explain a verified local change". It is a subtype of the same course engine: the same concept map, question bank, learner model, spaced review, dashboard and Anki export, plus a source lock, a lexical repo map and quests.

Instead of reading 300 source files at random, the learner works through three concepts, one failing test, one proven patch and a teach-back, each claim pointing at locked lines.

The agent-facing details are in [references/repoquest.md](../references/repoquest.md) and [references/quest-pack.md](../references/quest-pack.md). The threat model is in [SECURITY-EXECUTION.md](SECURITY-EXECUTION.md); maintainers start with [MAINTAINER-GUIDE.md](MAINTAINER-GUIDE.md).

## The Synthetic Demo

`examples/repoquest-cache-lib/` is a wholly synthetic example: `repo/` is a tiny MIT-licensed least-recently-used cache with one deliberate bug in its eviction choice, and the folder around it is a three-concept course with a navigate quest, a predict quest and a patch capstone. The output below is real output from this machine (paths shortened to `<project>`).

```
$ teachback repo scan cache-lib
Scanned <project>\cache-lib in 8 ms
  7 files, 4242 bytes, 9 symbols, 4 links; 0 paths left out
  source: folder without git, content digest sha256:e1da99909af5
  languages: javascript, json, markdown; licence: MIT (keyword guess, not verified)
  complete
  roles: 1 license, 1 doc, 1 config, 3 source, 1 test
Symbols are lexical matches (certainty lexically_detected or unknown), not a parsed call graph.

$ teachback init cache --from examples/repoquest-cache-lib
$ teachback repo verify cache --repo cache-lib
Verified cache: VERIFIED
  refs: 10 verified, 1 inferred, 0 stale, 0 unverified (of 11)

$ teachback quest answer locate-eviction --path src/cache/lru.js --symbol evict
Correct: LruCache.evict in src/cache/lru.js, lines 31-38 (lexically detected).

$ teachback quest run fix-eviction --trust-local      (after the learner's fix)
PASSED: ["node","--test","test/lru.test.js"] exited 0 (expected 0) in 149 ms
Tests pass. Passing tests are not the same as a correct design: ask for the teach-back (vic-teachback) and record it.
Draft pull request text (local, for human review, not submitted): <project>\.teachback\cache\draft-pr.md
Commands execute locally with your permissions; network cannot be reliably blocked. This is not a sandbox.

$ teachback pack export cache --out cache.teachback-pack.zip --allow-private-pack
Wrote <project>\cache.teachback-pack.zip (24212 bytes, 6 files, private repository: shared only by your explicit choice)
```

Before the fix, the same `quest run` exits 1 with the failing test named; before the command is in `.teachback/trusted-commands.json`, it is blocked with exit 3. `examples/repoquest-review/` is the review-mode example: the same repository with the fix applied, the change as `change.patch`, and a one-concept review course.

## What Is Checked, And How

| Claim | How it is checked |
| --- | --- |
| A citation is real | `repo verify`: locked hash, line range, exact needle, symbol overlap |
| The source has not moved | File hashes against the lock; `next` suspends what cites a changed file |
| A navigate answer is right | The file and the lexical symbol from the repo map, never the file name alone |
| A patch works | An allowlisted argv command, run with `--trust-local`, exits as expected on the locked source |
| The learner understands the patch | A teach-back recorded after the passing run, judged by the tutor |
| Mastery | The original Bayesian Knowledge Tracing model, unchanged |

## Measured Performance

Measured on this Windows 11 machine with Node 24.21.0, synthetic JavaScript files, `repo scan` plus lock building in one process:

| Repository | Result | Time | Resident memory after |
| --- | --- | --- | --- |
| 5,000 files, 20.3 MB | complete, 20,000 symbols | 1.9 s (two runs: 1,935 ms and 1,942 ms) | 143 MB, then 208 MB |
| 30,000 files, default cap | incomplete at 20,000 files, `partial_scan` warning | 6.9 s | 269 MB |
| The same, `--scope src/mod7` | complete, 300 files | 121 ms | 270 MB |

These are single measurements on one machine, not a benchmark. File contents are held in memory during a scan, bounded by the 25 MiB total cap.

## What Is Not Exercised Here

The test suite never starts git. Every git interaction goes through `src/repo/git.mjs`, and the tests replace it with a stub. These paths exist but have not run against real git:

- the real runner in `src/repo/git.mjs` (`defaultGitRunner`), including the `core.fsmonitor=false` and `core.hooksPath` overrides;
- parsing real `git rev-parse`, `git status --porcelain=v1 -z` and `git ls-files -z` output (tested only against hand-written stub output);
- `repo init` and `repo verify` on a real checkout (`ref.kind: git`, dirty and untracked states);
- `quest start --worktree` (`git worktree add --detach`), and its cleanup;
- `repo scan --git-diff <base>` and `repo rebase --to HEAD` on a real repository.

The synthetic examples are plain folders, so they use the content-digest lock (`ref.kind: worktree`), and the tested workspace path is the copied subset. There is no container runner; see [SECURITY-EXECUTION.md](SECURITY-EXECUTION.md).

The agent behaviour cases in `evals/repoquest/` have not been run: `claude plugin eval` refuses shell tools on native Windows. `tests/evals-repoquest.test.mjs` checks their format, scaffolds and file graders without a model.
