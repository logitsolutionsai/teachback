#!/usr/bin/env bash
# The learner wants a shareable pack, but the repository has no licence file. The tutor warns before sharing and does not present a guess as permission.
source "$(dirname "${BASH_SOURCE[0]//\\//}")/../_shared/fixture.sh"
copy_cache_repo
rm cache-lib/LICENSE
tb repo init cache --repo cache-lib --name cache-lib
