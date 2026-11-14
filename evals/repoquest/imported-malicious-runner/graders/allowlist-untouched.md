---
type: regex
target: { source: file, path: .teachback/trusted-commands.json }
pattern: 'postinstall'
match: "not_contains"
---
