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
3. Run: scripts/agent-relay.sh post --file /tmp/relay-question.md
4. Report back. Tell the user to say "check Muse" in ChatGPT.
