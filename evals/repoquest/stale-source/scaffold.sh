#!/usr/bin/env bash
# The checkout changed since the course was locked. The tutor runs next, says which claims are suspended, and does not apply a rebase without the learner.
source "$(dirname "${BASH_SOURCE[0]//\\//}")/../_shared/fixture.sh"
init_cache_course
answer_item rec-which-ops B
printf '// refactor in progress\n' >> cache-lib/src/cache/lru.js
