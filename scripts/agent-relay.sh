#!/usr/bin/env bash
# Agent relay helper — GitHub issue comments as shared Muse ↔ ChatGPT bus.
# Usage:
#   scripts/agent-relay.sh read [--limit N] [--repo owner/repo]
#   scripts/agent-relay.sh post --file MSG.md [--repo owner/repo] [--issue NUMBER]
#   scripts/agent-relay.sh find [--repo owner/repo]
set -euo pipefail

REPO="${RELAY_REPO:-Cozea/electron-app}"
TITLE_MATCH="Agent relay"

cmd="${1:-read}"; shift || true

find_issue() {
  local repo="$1"
  gh issue list --repo "$repo" --state all --search "$TITLE_MATCH in:title" \
    --json number,title,updatedAt --jq 'sort_by(.updatedAt) | last | .number // empty'
}

case "$cmd" in
  find)
    num="$(find_issue "$REPO")"
    if [ -z "$num" ]; then echo "no relay issue found in $REPO" >&2; exit 1; fi
    echo "$num"
    ;;
  read)
    limit=10
    issue=""
    while [ $# -gt 0 ]; do
      case "$1" in
        --limit) limit="$2"; shift 2;;
        --repo) REPO="$2"; shift 2;;
        --issue) issue="$2"; shift 2;;
        *) shift;;
      esac
    done
    if [ -z "$issue" ]; then
      issue="$(find_issue "$REPO")"
      if [ -z "$issue" ]; then echo "no relay issue found in $REPO. Create it first — see docs/agent-relay.md" >&2; exit 1; fi
    fi
    echo "== relay issue #$issue in $REPO =="
    gh issue view "$issue" --repo "$REPO" --comments --json title,body,comments \
      --jq '"# \(.title)\n\n\(.body)\n\n--- comments (last '"$limit"') ---\n" + ([.comments[] | "## #\(.id) @\(.author.login) \(.createdAt)\n\(.body)"] | .[-'"$limit"':] | join("\n\n---\n\n"))'
    ;;
  post)
    file=""
    issue=""
    while [ $# -gt 0 ]; do
      case "$1" in
        --file) file="$2"; shift 2;;
        --repo) REPO="$2"; shift 2;;
        --issue) issue="$2"; shift 2;;
        *) shift;;
      esac
    done
    if [ -z "$file" ]; then echo "usage: agent-relay.sh post --file MSG.md" >&2; exit 1; fi
    head -1 "$file" | grep -qE '^\[(MUSE → CHATGPT|CHATGPT → MUSE) / (HANDOFF|QUESTION|REVIEW|INSTRUCTION)\]' \
      || { echo "first line must be a valid relay header, see docs/agent-relay.md" >&2; exit 1; }
    if [ -z "$issue" ]; then
      issue="$(find_issue "$REPO")"
      if [ -z "$issue" ]; then echo "no relay issue found in $REPO. Create it first — see docs/agent-relay.md" >&2; exit 1; fi
    fi
    gh issue comment "$issue" --repo "$REPO" --body-file "$file"
    ;;
  *)
    echo "usage: agent-relay.sh {read|post|find}" >&2; exit 1;;
esac
