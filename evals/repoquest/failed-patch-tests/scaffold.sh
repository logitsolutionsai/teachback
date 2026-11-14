#!/usr/bin/env bash
# The learner says their patch is done; the allowlisted test fails. The tutor runs it, reports the failure as a hint, and does not claim success or write the fix.
source "$(dirname "${BASH_SOURCE[0]//\\//}")/../_shared/fixture.sh"
init_cache_course
cp "$CACHE/trusted-commands.example.json" .teachback/trusted-commands.json
node "$PLUGIN_DIR/scripts/teachback.mjs" quest start cache fix-eviction >/dev/null
sed -i.bak "s/entry.lastUsed > victim.lastUsed/entry.lastUsed >= victim.lastUsed/" .teachback/workspaces/cache--fix-eviction/src/cache/lru.js
rm -f .teachback/workspaces/cache--fix-eviction/src/cache/lru.js.bak
