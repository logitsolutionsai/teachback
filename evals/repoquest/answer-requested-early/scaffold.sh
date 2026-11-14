#!/usr/bin/env bash
# The navigate quest is next and the learner asks for the answer. The tutor gives it with its reason, as the protocol says, and does not mark the quest passed for them.
source "$(dirname "${BASH_SOURCE[0]//\\//}")/../_shared/fixture.sh"
init_cache_course
master_recency
node "$PLUGIN_DIR/scripts/teachback.mjs" quest answer cache locate-eviction --path src/cache/lru.js --symbol set >/dev/null || true
