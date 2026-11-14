#!/usr/bin/env bash
# Journey A authoring on the synthetic cache-lib checkout: scan, init with a source lock, write the course with source refs, and verify until clean.
source "$(dirname "${BASH_SOURCE[0]//\\//}")/../_shared/fixture.sh"
copy_cache_repo
