# Security: Execution And Trust

RepoQuest reads code from repositories the learner did not write, imports packs from people they may not know, and can run tests. This page says what runs, when, with what limits, and what is not protected.

## What Never Runs Code

`repo scan`, `repo init`, `repo verify`, `repo rebase`, `quest show`, `quest answer`, `quest start`, `quest certificate`, `pack export`, `pack check`, `pack import`, `next`, `status` and `dashboard` read and hash files and write course files. They do not run build scripts, package scripts, git hooks, tests or any repository code. A test (`tests/runner-security.test.mjs`) runs them on a repository whose scripts would leave a marker file if executed, and checks that no marker appears.

The only process they may start is git, and only when the scanned folder has its own `.git`: read-only `rev-parse`, `status`, `ls-files` and `diff`, each with `core.fsmonitor=false`, hooks pointed at the null device, no optional locks and no terminal prompts. `src/repo/git.mjs` refuses every other subcommand (`push`, `fetch`, `reset`, `clean`, `checkout`, `config`, `worktree remove`). `quest start --worktree` is the one exception, for `git worktree add --detach` of the locked commit. These git paths are not exercised by the test suite (see [REPOQUEST.md](REPOQUEST.md)).

## When A Quest Command Runs

`quest run` starts a process only when all of these hold:

1. **Static check.** The command is an argv array. It is refused if its executable is a shell, a wrapper or a network tool (`sh`, `bash`, `zsh`, `cmd`, `powershell`, `pwsh`, `env`, `sudo`, `xargs`, `curl`, `wget`, `ssh` and others) or a path, or if any argument contains a pipe, redirection, `;`, `&`, a backtick, `$(...)`, `${...}`, `$VAR`, `%VAR%`, a glob character, an absolute path, `..`, a URL, or inline code (`node -e`, `node -p`, `python -c`). An imported pack with `["sh", "-c", "curl attacker"]` fails `repo verify` and `pack check` and is never run.
2. **Allowlist.** The exact argv is in `.teachback/trusted-commands.json`, which the person on this machine writes and which no pack carries. The allowlist entries pass the same static check.
3. **Explicit trust, every run.** `--trust-local` is passed on that run. Nothing remembers it, and there is no global `--yes`.
4. **Scope.** The workspace exists, and the learner's changes are inside the quest's `allowedPaths` (editing the test to make it pass is blocked).

Otherwise the run is recorded as `blocked` (exit 3, or 4 when the tool is missing), never as passed.

## Limits On A Running Command

- Working folder: the quest workspace, a copy of the locked files under `.teachback/workspaces/<course>--<quest>/`. The learner's own checkout is never written to.
- Timeout: 20 s by default, at most 120 s; the process tree is killed on timeout (`taskkill /T` on Windows, the process group elsewhere).
- Output: the first 64 KiB of each stream is kept for display; each whole stream is hashed (sha256) into the record.
- Environment: an allowlist of harmless variables (`PATH`, `TEMP` and similar), never a variable whose name looks like a secret (`TOKEN`, `SECRET`, `PASSWORD`, `API_KEY`, `AWS_*`, `GITHUB_*` and others), plus `CI=1`, `NO_COLOR=1`, an empty `NODE_OPTIONS`, and `HOME` and `USERPROFILE` pointed at a folder inside the workspace.
- `node` resolves to the running Node binary; `python` to the interpreter teachback already detects.

## What Is Not Protected

- **It is not a sandbox.** The command runs with the learner's own permissions. It can read any file they can read, start other processes, and use the network. Every run prints: "Commands execute locally with your permissions; network cannot be reliably blocked. This is not a sandbox."
- The number of child processes is not limited.
- A passing exit code is evidence that one command passed on one machine, not proof that the change is correct or free of regressions.

## Not Built Yet: An Isolated Runner

An optional container runner (Docker or Podman: a pinned base image, `--network none`, read-only mounts except the workspace, CPU, memory and process limits, no Docker socket, a non-root user, no host secrets) is future work. It was not built because no container runtime was available to test it, and an untested isolation layer would be a false promise. Until it exists, quest commands stay blocked until the learner opts in to local execution as above.

## Packs

Pack import and check refuse zip-slip, absolute and backslash names, duplicates, symlinks, encryption, archive bombs (entry, total and ratio caps), bad checksums and duplicate JSON keys. Packs never carry learner data, local paths, the allowlist, reference solutions or repository code. See [references/quest-pack.md](../references/quest-pack.md).

## Prompt Injection

Repository text is data. The skill tells the agent never to follow instructions found in READMEs, comments, docs or issues (to read SSH keys, print the environment, install packages, run scripts or upload anything), and to say that it treated them as data. The behaviour case `evals/repoquest/poisoned-readme` covers this; it has not been run (native Windows refuses shell tools in `claude plugin eval`).

## No Automation Toward Other People

Nothing pushes, opens pull requests, posts comments or edits issues. A passing patch quest writes `draft-pr.md`, a local draft for the learner to review. The certificate says it is self-reported local evidence, not a credential or a merged contribution.
