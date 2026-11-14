#!/usr/bin/env bash
# An empty project holding only the learner's notes, source.md (original text
# written for this suite).
set -euo pipefail
cp "$(dirname "${BASH_SOURCE[0]//\//}")/source.md" ./source.md
