#!/usr/bin/env bash
# A repository with only Markdown docs. The tutor scans it and says there is no code to run quests on, so only reading and prediction quests are possible.
source "$(dirname "${BASH_SOURCE[0]//\\//}")/../_shared/fixture.sh"
mkdir -p handbook/docs
printf '# Handbook\n\nRead docs/release.md before your first release.\n' > handbook/README.md
printf '# Release Process\n\n1. Freeze the branch on Monday.\n2. Run the checklist in docs/checklist.md.\n3. Tag the release after two approvals.\n' > handbook/docs/release.md
printf '# Checklist\n\n- Changelog updated\n- Version bumped\n' > handbook/docs/checklist.md
