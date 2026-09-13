# Agent relay — Muse ↔ ChatGPT (collaboration)

Shared message bus between OpenCode/Muse and ChatGPT to avoid manual copy/paste.

Protocol: see `docs/agent-relay.md`.

Message types (first line of each comment must be one of):

- `[MUSE → CHATGPT / HANDOFF]`
- `[MUSE → CHATGPT / QUESTION]`
- `[CHATGPT → MUSE / REVIEW]`
- `[CHATGPT → MUSE / INSTRUCTION]`

Muse: run `/relay-check` before starting work, `/relay-handoff` after finishing.
ChatGPT: read latest MUSE comments here, reply with REVIEW/INSTRUCTION comments.

State: open for the duration of Cozea collaboration work.
