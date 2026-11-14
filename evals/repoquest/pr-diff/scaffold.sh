#!/usr/bin/env bash
# Journey C: a unified diff file and the checkout with the change. The tutor reads the diff through the CLI, names the changed method and its test, and runs nothing from the change.
source "$(dirname "${BASH_SOURCE[0]//\\//}")/../_shared/fixture.sh"
mkdir -p cache-lib
cp -R "$REVIEW/repo/." cache-lib/
cp "$REVIEW/change.patch" change.patch
