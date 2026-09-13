# Agent relay — Muse (OpenCode) ↔ ChatGPT

Purpose: stop copy/pasting long outputs between OpenCode/Muse and this ChatGPT chat.
GitHub issue comments are the shared message bus. Both sides read/write the same issue.

- Source repo: `Cozea/electron-app`
- Relay issue title: `Agent relay — Muse ↔ ChatGPT (collaboration)`
- Relay issue: created on demand (see below). Discover via:
  `gh issue list --search "Agent relay — Muse" --json number,title`

## Message protocol (post as issue comments)

Use one of these exact headers as the first line:

- `[MUSE → CHATGPT / HANDOFF]` — Muse finished work, ready for ChatGPT review
- `[MUSE → CHATGPT / QUESTION]` — Muse blocked, needs ChatGPT/user decision
- `[CHATGPT → MUSE / REVIEW]` — ChatGPT review result
- `[CHATGPT → MUSE / INSTRUCTION]` — ChatGPT authorizes next work

Every MUSE message must include:

```text
[MUSE → CHATGPT / HANDOFF]
repo: Cozea/electron-app
branch: <branch>
head: <short sha>
phase: <roadmap phase or n/a>
checkpoint: <checkpoint or n/a>
status: ready-for-review | blocked | question

Changes:
- <files / what changed>

Tests:
- <what ran, result>

Findings:
- ...

Questions / needs decision:
- ...
```

Every CHATGPT message must include:

```text
[CHATGPT → MUSE / REVIEW]
verdict: approve | request-changes | blocked
next authorized work: ...
do not touch: ...
notes: ...
```

## OpenCode usage (Muse side)

Helper script (repo root):

```sh
# read latest relay messages (READ-only, safe anytime)
scripts/agent-relay.sh read --limit 10

# post a message (WRITE — explicit user request required per AGENTS.md)
scripts/agent-relay.sh post --file /tmp/relay-msg.md
```

Custom commands (OpenCode TUI):

- `/relay-check` — pull latest `[CHATGPT → MUSE]` instructions into context
- `/relay-handoff <summary>` — collect branch/HEAD/status/diff and publish HANDOFF
- `/relay-question <question>` — publish QUESTION

Rule: always run `/relay-check` before starting a checkpoint, and `/relay-handoff`
after finishing one.

## ChatGPT usage

ChatGPT has GitHub integration. Tell the user `check Muse`, then ChatGPT:

1. `gh issue list --search "Agent relay"` → find relay issue
2. Read latest `[MUSE → CHATGPT]` comments + repo HEAD
3. Reply with `[CHATGPT → MUSE / REVIEW]` or `/ INSTRUCTION` as an issue comment

No extra ChatGPT plan / MCP setup needed. This works today.

## Creating the relay issue (dry-run first)

Per `AGENTS.md`, remote WRITE needs explicit user request + dry-run first.
Dry-run:

```sh
gh issue create --repo Cozea/electron-app --title "Agent relay — Muse ↔ ChatGPT (collaboration)" --body-file docs/agent-relay-issue-body.md --dry-run 2>&1 || \
gh issue create --repo Cozea/electron-app --title "Agent relay — Muse ↔ ChatGPT (collaboration)" --body-file docs/agent-relay-issue-body.md --help
```

Actual create (only after user says so):

```sh
gh issue create --repo Cozea/electron-app \
  --title "Agent relay — Muse ↔ ChatGPT (collaboration)" \
  --body-file docs/agent-relay-issue-body.md
```

## Later: MCP relay

Keep the same 4 message types and HANDOFF fields. Replace `scripts/agent-relay.sh`
backend from `gh issue comment` to Convex `channels/messages` service. No protocol change.
