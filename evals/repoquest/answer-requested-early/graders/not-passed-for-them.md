---
type: regex
target: { source: file, path: .teachback/cache/quest-state.json }
pattern: '"status": "passed"'
match: "not_contains"
---
