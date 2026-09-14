---
description: Ask ChatGPT a question via shared relay
---
Publish a [MUSE → CHATGPT / QUESTION] message to the shared GitHub relay issue.

Question from user: $ARGUMENTS

Steps:
1. Collect branch + HEAD via git.
2. Write /tmp/relay-question.md with first line exactly:
   [MUSE → CHATGPT / QUESTION]
   plus repo/branch/head context and the question.
3. Publish via the relay MCP `relay_post` tool, or fallback:
   scripts/agent-relay.sh post --file /tmp/relay-question.md
4. Optionally monitor for the answer with relay MCP `relay_wait` (from chatgpt).
5. Report back. Tell the user to say "check Muse" in ChatGPT.
