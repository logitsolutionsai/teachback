# Maintainer Guide: Publishing A Contributor Quest Pack

A Contributor Quest Pack turns "read the codebase and good luck" into a pinned path: a few concepts, a failing test, a patch and a teach-back. This guide covers building one, keeping it true, and accepting packs from others.

## 1. Choose The Scope

Pick one module that new contributors touch first, and one real or synthetic issue in it. Lock only that module: `repo init <slug> --repo . --scope src/cache`. Licence files at the repository root are included automatically. A scope that hits the file or byte cap is refused; narrow it with `--scope` and `--include`.

## 2. Pin The Commit

Lock a clean checkout: `repo init` refuses uncommitted changes unless `--allow-dirty`, which marks the lock `dirtySource: true`. Pass `--public-url https://github.com/<owner>/<repo>` if the repository is public; it is never read from your git remote. A lock without it is treated as private, and export then requires `--allow-private-pack`.

## 3. Write Meaningful Acceptance

- **Navigate quests** name a file id and a symbol id from `repo-map.json`. Choose a symbol whose certainty is `lexically_detected`; a learner then has to name the symbol or a line inside it.
- **Predict and review quests** point at a short or teach-back item with a rubric of required ideas and named misconceptions.
- **Patch quests** state `allowedPaths` (where the fix belongs, not the tests), an argv command, a timeout under 30 s, the expected exit code, and a teach-back item asked after the pass. Keep a reference fix in `quests/<quest>/.reference/`; packs never include it.
- The starter must fail and the reference must pass: run `quest start`, `quest run --trust-local` (fails), copy the reference into the workspace, and run again (passes).

## 4. Vet The Runner

Use the smallest command that proves the fix, such as `["node", "--test", "test/lru.test.js"]` or `["python", "-m", "unittest", "tests.test_cache"]`. No shells, package installs, scripts that download, or wrapper scripts you would not run yourself. Ship an example allowlist (`trusted-commands.example.json`) and tell contributors to read the command before they copy it into `.teachback/trusted-commands.json`.

## 5. Review The Citations

Run `repo verify` and `check --skip-exercises` until both are clean. Then read every concept summary next to its cited lines: verification proves the quoted text is there, not that your explanation of it is right. Mark a teaching inference with `"evidenceKind": "inferred"`. Keep needles short (identifiers or a few words); export refuses source lines copied word for word into course text.

## 6. Licence Posture

The detected licence is a keyword guess and is never marked as verified. A pack contains no source code, so contributors obtain the source from you under your licence. Do not quote more than a short needle from code under a licence that does not allow it.

## 7. Update After A Refactor

`repo rebase <slug> --to HEAD --dry-run --out proposal.json` lists, for every citation, whether it is unchanged, moved, relocated, ambiguous (`needs_review`), broken or deleted. Fix the ambiguous and broken ones by hand, apply with `--apply proposal.json --confirm`, read the items listed in `source-review.json`, and export a new pack. Contributors who import it with `--force` keep their progress and are told which concepts changed.

## 8. Accept Community Packs Safely

Run `pack check` first: it runs nothing and lists every command a quest would run and the files it may change. Read those commands and the files they execute. Import with `pack import --repo <your checkout>`; a pack whose lock does not match your source is reported `source_stale`, and citations are never updated silently. Never add a pack's command to your allowlist without reading it.

## Templates

### Adding A New Open-Source Course

1. Scope one module and one issue; `repo init` with `--public-url`.
2. Write 3 to 8 concepts with `sourceRefs`, 3 or more items of 2 types each (one teach-back), and navigate, predict and patch quests.
3. `repo verify`, `check`, and the starter-fails, reference-passes run.
4. In the pull request: the scope, the commit, the licence, the quest command, and the verify output.

### Adding A Language To The Scanner

1. Add the extension to `LANG_BY_EXT` and a `<lang>Symbols(lines)` function in `src/repo/symbols.mjs` that returns `{ name, kind, startLine, endLine, exported }`, with `endLine: null` whenever the end cannot be found (certainty `unknown`).
2. Add import extraction and resolution only for imports that name a file in the scan.
3. Add tests in `tests/repo-scan.test.mjs` with a declaration, a nested declaration, a string or comment that looks like code, and an unclosed body.

### Supplying A Counterexample Fixture

Add a small synthetic repository under `tests/fixtures/` (or a test that writes one to a temp folder) that shows the scanner, verifier or runner getting something wrong, with the assertion it should pass. Never include real credentials; use obviously fake values.
