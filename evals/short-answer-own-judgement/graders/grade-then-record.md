---
type: tool_order
before: { tool: Bash, input_match: 'teachback\S*\s+grade\s+qkv-roles\b' }
after: { tool: Bash, input_match: 'teachback\S*\s+record\s+qkv-roles\b' }
arm: with-only
---
