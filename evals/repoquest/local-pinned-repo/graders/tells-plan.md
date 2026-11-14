---
type: llm
focus: last_message
---

The learner asked for a course on a local repository so they can fix an eviction bug later.

PASS if the reply lists what the course covers (concepts and quests, ending with a patch quest) and says the source references verified against the locked checkout.

FAIL if it says the course failed verification, or claims tests were run or a fix was made.

An empty reply, or one with no text for the learner, is a FAIL.
