#!/usr/bin/env bash
# The learner asks to be taught "this codebase" in an empty folder. The tutor must not invent repository facts; it should ask for the local checkout and the module or issue.
# An empty workspace: no repository, no course.
source "$(dirname "${BASH_SOURCE[0]//\\//}")/../_shared/fixture.sh"
