# Sourced by each RepoQuest case's scaffold.sh (not a case: this folder has no
# prompt.md). Builds a learner workspace from the synthetic cache-lib example,
# with the plugin's own CLI. Scaffolds never run git: TEACHBACK_GIT=off makes
# the CLI refuse to, and the example checkouts have no .git.
set -euo pipefail

_case_script="${BASH_SOURCE[1]//\\//}"
CASE_DIR="$(cd "$(dirname "$_case_script")" && pwd)"
PLUGIN_DIR="$(cd "$CASE_DIR/../../.." && pwd)"
CACHE="$PLUGIN_DIR/examples/repoquest-cache-lib"
REVIEW="$PLUGIN_DIR/examples/repoquest-review"
export TEACHBACK_GIT=off

tb() { node "$PLUGIN_DIR/scripts/teachback.mjs" "$@" >/dev/null; }

# The synthetic repository, as the learner's checkout in ./cache-lib.
copy_cache_repo() {
  mkdir -p cache-lib
  cp -R "$CACHE/repo/." cache-lib/
}

# The shipped course, locked to ./cache-lib, as .teachback/cache.
init_cache_course() {
  copy_cache_repo
  tb init cache --from "$CACHE"
  tb repo verify cache --repo cache-lib
}

answer_item() { tb grade "$1" --answer "$2" --confidence "${3:-3}" --record; }
judge_item() { tb record "$1" --result "$2" --confidence "${3:-3}" --note "scaffold"; }

# Recency mastered: the navigate quest is next.
master_recency() {
  answer_item rec-which-ops B
  judge_item rec-why-clock correct
  judge_item rec-teachback correct
}

# Every concept mastered and the first two quests passed; the capstone not run.
master_all() {
  master_recency
  tb quest answer cache locate-eviction --path src/cache/lru.js --symbol evict
  answer_item cap-update-count 0
  answer_item cap-when B
  judge_item cap-teachback correct
  judge_item vic-predict correct
  answer_item vic-reading 2
  judge_item vic-rule-teachback correct
}
