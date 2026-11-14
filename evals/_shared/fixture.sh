# Sourced by each case's scaffold.sh (not a case: this folder has no prompt.md).
# Builds a learner project in the current, empty workspace: the shipped
# attention course, initialised with the plugin's own CLI, plus scripted learner
# state. Events written with no --now are stamped at the real time of the run,
# so their reviews fall due tomorrow; ago_hours stamps earlier events.
set -euo pipefail

# The case's scaffold.sh, wherever the harness runs it from (Git Bash on Windows
# passes a path with backslashes).
_case_script="${BASH_SOURCE[1]//\\//}"
CASE_DIR="$(cd "$(dirname "$_case_script")" && pwd)"
PLUGIN_DIR="$(cd "$CASE_DIR/../.." && pwd)"
EXAMPLE="$PLUGIN_DIR/examples/attention-is-all-you-need"
COURSE=".teachback/attention"
AT=""   # empty: stamp events now; otherwise an ISO time passed as --now

tb() {
  if [ -n "$AT" ]; then node "$PLUGIN_DIR/scripts/teachback.mjs" "$@" --now "$AT" >/dev/null
  else node "$PLUGIN_DIR/scripts/teachback.mjs" "$@" >/dev/null; fi
}

ago_hours() {
  node -e 'process.stdout.write(new Date(Date.now() - Number(process.argv[1]) * 3600e3).toISOString())' "$1"
}

init_attention() {
  node "$PLUGIN_DIR/scripts/teachback.mjs" init attention --from "$EXAMPLE" >/dev/null
}

# mcq or numeric answered, graded and recorded: answer_item <item> <answer> [confidence]
answer_item() { tb grade "$1" --answer "$2" --confidence "${3:-3}" --record; }

# short or teach-back judged by the tutor: judge_item <item> <result> [confidence]
judge_item() { tb record "$1" --result "$2" --confidence "${3:-3}" --note "scaffold"; }

# Pass an exercise with its reference solution, recording the run.
pass_exercise() {
  local ex="$1" starter="$2"
  node "$PLUGIN_DIR/scripts/teachback.mjs" run "$ex" >/dev/null   # creates work/<ex>/
  cp "$COURSE/exercises/$ex/.reference/$starter" "$COURSE/work/$ex/$starter"
  tb run "$ex"
}

# Softmax mastered and its exercise passed.
softmax_done() {
  answer_item softmax-weights 0.75
  answer_item softmax-scale B
  judge_item softmax-teachback correct
  pass_exercise 01-softmax softmax.py
}

# Attention (queries, keys, values) mastered.
qkv_done() {
  answer_item qkv-output B
  judge_item qkv-roles correct
  judge_item qkv-teachback correct
}
