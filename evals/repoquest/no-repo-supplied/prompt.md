---
description: '(r1) The learner asks to be taught "this codebase" in an empty folder. The tutor must not invent repository facts; it should ask for the local checkout and the module or issue.'
tags: [repoquest, tutor]
max_turns: 16
timeout_seconds: 420
allowed_tools: [Read, Glob, Grep, Skill, Bash]
---

Teach me this codebase, I want to fix the cache eviction bug.
