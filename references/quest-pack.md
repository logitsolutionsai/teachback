# Quest Pack Reference

A Contributor Quest Pack is a ZIP file (`<slug>.teachback-pack.zip`) that lets anyone take a repo course on their own checkout. It carries course definitions and source pointers, never source code or learner data. See [repoquest.md](repoquest.md) for the course files themselves.

## Contents

```
quest-pack.json            manifest: files with sha256 and size, source lock digest, licence guess, packDigest
course/course.json
course/map.json
course/items.json
course/quests.json
course/source-lock.json    relative paths and hashes only
course/repo-map.json
course/diff-summary.json   review courses only (paths, lines, symbols; no code)
course/exercises/<id>/...  starters, tests and TASK.md of any track exercises (never .reference/)
```

Never included: `learner.json`, `quest-state.json`, `.local-source.json`, `.teachback/trusted-commands.json`, workspaces, `work/`, `draft-pr.md`, dashboards, certificates, `authoring-plan.md`, any `.reference/` solution, any `.patch`, and every repository file.

## Export

`TB pack export [course] --out <file> [--allow-private-pack] [--reviewed-copies]`

1. The course must pass `repo verify` (exit 1 or 2 otherwise): a pack never ships an unverified or stale citation.
2. A lock without a `publicUrl` is treated as a private repository. Export refuses (exit 3) and lists exactly what the pack would contain, unless `--allow-private-pack`. A public URL is only ever one the maintainer supplied with `repo init --public-url https://github.com/<owner>/<repo>`; it is never read from a git remote.
3. Any absolute machine path or anything shaped like a credential refuses the export (exit 2).
4. A source line of 40 or more characters copied word for word into course text refuses the export (exit 2) unless `--reviewed-copies`. Quote short needles; write everything else in your own words.

The ZIP is deterministic: entries stored uncompressed in a fixed order with one fixed timestamp, so the same course gives the same bytes on every machine.

## Check

`TB pack check <file> --json` runs nothing. It refuses: absolute, `..`, backslash or drive-letter names; duplicate names (also by case); symlink and special entries; encryption; methods other than stored and deflate; ZIP64; more than 1,000 entries; an entry over 2 MiB; more than 16 MiB in total; a compression ratio over 100; and any CRC or size mismatch. It then checks the manifest digest, every listed hash, unlisted or forbidden files, duplicate JSON keys, absolute paths, credential shapes, a claimed human licence verification, every quest command (statically), and the course itself (`check` without exercises and the quest rules). It lists every command a quest would run and the files it may change.

## Import

`TB pack import <file> --repo <your checkout> [--slug S] [--force]`

The pack is checked first; nothing is written if the check fails. The course is written to `.teachback/<slug>/`, `.local-source.json` records your checkout as `untrusted` with `origin: import`, and the course is verified against your checkout. If your source differs from the pack's lock, the import reports `source_stale` (exit 2) and lists the changed files; citations are never updated silently. Use `repo rebase --dry-run` to review a migration. `--force` updates an existing course from a newer pack and keeps `learner.json` and `quest-state.json`, reporting concepts added, removed and changed.

Imported quest commands still run only after you add them to your own `trusted-commands.json` and pass `--trust-local`.

## Licence Posture

The detected licence is a keyword guess, recorded with `verifiedByHuman: false`, and is not legal permission. A pack contains no source code; each contributor obtains the source from its owner under its own licence.
