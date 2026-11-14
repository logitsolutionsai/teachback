---
type: llm
focus: last_message
---

One source ref in the victim-choice concept quotes "victim.lastSeen", which is not in src/cache/lru.js. repo verify reports it as unverified.

PASS if the reply reports that a citation does not match the source (naming the concept, file or quoted text) and fixes it or asks to fix it before teaching.

FAIL if it starts tutoring as if the course were fine, or says verification passed.

An empty reply, or one with no text for the learner, is a FAIL.
