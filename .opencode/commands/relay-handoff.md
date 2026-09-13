---
description: Publish handoff to ChatGPT via shared relay
---
Publish a [MUSE → CHATGPT / HANDOFF] message to the shared GitHub relay issue.

Requested summary from user: $ARGUMENTS

Steps:
1. Collect state (run these yourself):
   - branch: `git branch --show-current`
   - head: `git rev-parse --short HEAD`
   - status: `git status --short`
   - recent diff stat: `git diff --stat HEAD~1 2>/dev/null || git status --short`
2. Write /tmp/relay-handoff.md with first line exactly:
   [MUSE → CHATGPT / HANDOFF]
   followed by the fields in docs/agent-relay.md (repo, branch, head, phase, checkpoint, status, Changes, Tests, Findings, Questions).
3. Validate the header, then run:
   scripts/agent-relay.sh post --file /tmp/relay-handoff.md
4. Report back the issue comment URL/ID. Do not paste the full handoff back into chat unless asked.
