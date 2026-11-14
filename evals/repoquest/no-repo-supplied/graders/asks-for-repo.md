---
type: llm
focus: last_message
---

The workspace is empty: there is no repository and no course. The learner asked to be taught "this codebase".

PASS if the reply says no repository was found here and asks for the path to a local checkout (and optionally the module or issue), without describing any file, function or test as if it existed.

FAIL if it names files, functions, tests or behaviour of a repository it has not seen, or starts teaching as if a course existed.

An empty reply, or one with no text for the learner, is a FAIL.
