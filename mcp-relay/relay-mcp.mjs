#!/usr/bin/env node
// Agent relay MCP server — zero dependencies (node: stdlib only).
//
// Exposes the shared Muse <-> ChatGPT message bus (GitHub issue comments)
// as MCP tools so an OpenCode agent can call, monitor, and get messages back:
//
//   read   — fetch recent relay messages (READ-only)
//   status — cheap monitor ping: issue state, counts, latest headers (READ-only)
//   post   — publish a relay message (WRITE — needs explicit user request)
//   wait   — poll until a new message arrives, then return it (READ-only)
//
// Backend is the `gh` CLI (inherits existing auth). No new secrets.
//
// Env:
//   RELAY_REPO         default "Cozea/electron-app"
//   RELAY_ISSUE        relay issue number (default: auto-find by title)
//   RELAY_TITLE_MATCH  title search for auto-find (default "Agent relay")
//
// Protocol: MCP over stdio, newline-delimited JSON-RPC (initialize,
// notifications/initialized, ping, tools/list, tools/call).

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import readline from "node:readline";

const execFileAsync = promisify(execFile);

const REPO = process.env.RELAY_REPO || "Cozea/electron-app";
const TITLE_MATCH = process.env.RELAY_TITLE_MATCH || "Agent relay";
const PINNED_ISSUE = process.env.RELAY_ISSUE || "";
const HEADER_RE =
  /^\[(MUSE → CHATGPT|CHATGPT → MUSE) \/ (HANDOFF|QUESTION|REVIEW|INSTRUCTION)\]/;
const MAX_BODY = 6000;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function gh(args) {
  const { stdout } = await execFileAsync("gh", args, {
    maxBuffer: 16 * 1024 * 1024,
  });
  return stdout;
}

async function findIssue() {
  if (PINNED_ISSUE) return PINNED_ISSUE;
  const out = await gh([
    "issue",
    "list",
    "--repo",
    REPO,
    "--state",
    "all",
    "--search",
    `${TITLE_MATCH} in:title`,
    "--json",
    "number,title,updatedAt",
    "--jq",
    "sort_by(.updatedAt) | last | .number // empty",
  ]);
  const n = out.trim();
  if (!n) throw new Error(`no relay issue found in ${REPO}`);
  return n;
}

async function getIssue(issue) {
  const out = await gh([
    "issue",
    "view",
    String(issue),
    "--repo",
    REPO,
    "--comments",
    "--json",
    "number,title,url,state,comments",
  ]);
  return JSON.parse(out);
}

function headerOf(body) {
  const first = String(body || "").split("\n")[0];
  return HEADER_RE.test(first) ? first : "(no relay header)";
}

function trunc(s) {
  s = String(s || "");
  return s.length > MAX_BODY
    ? s.slice(0, MAX_BODY) + `\n…[truncated ${s.length - MAX_BODY} chars]`
    : s;
}

function fmtComment(c) {
  return {
    id: c.id,
    author: c.author && c.author.login,
    createdAt: c.createdAt,
    header: headerOf(c.body),
    body: trunc(c.body),
  };
}

function matchFrom(c, from) {
  const first = String(c.body || "").split("\n")[0];
  if (from === "chatgpt") return first.startsWith("[CHATGPT");
  if (from === "muse") return first.startsWith("[MUSE");
  return HEADER_RE.test(first); // "any"
}

const TOOLS = [
  {
    name: "status",
    description:
      "Relay monitor ping (READ-only). Returns repo, relay issue number/title/url/state, total comment count, and the headers of the 3 latest messages. Use for cheap polling.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "read",
    description:
      "Fetch recent relay messages (READ-only). Returns newest-first message objects {id, author, createdAt, header, body}. Filter with `from`: chatgpt (default), muse, or any.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "integer", default: 10, minimum: 1, maximum: 50 },
        from: {
          type: "string",
          enum: ["chatgpt", "muse", "any"],
          default: "any",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "post",
    description:
      "Publish a relay message (WRITE — only call with explicit user authorization per AGENTS.md). `header` must be one of the 4 protocol headers; `body` is the rest of the comment (fields per docs/agent-relay.md). Returns the comment URL.",
    inputSchema: {
      type: "object",
      properties: {
        header: {
          type: "string",
          enum: [
            "[MUSE → CHATGPT / HANDOFF]",
            "[MUSE → CHATGPT / QUESTION]",
            "[CHATGPT → MUSE / REVIEW]",
            "[CHATGPT → MUSE / INSTRUCTION]",
          ],
        },
        body: { type: "string" },
      },
      required: ["header", "body"],
      additionalProperties: false,
    },
  },
  {
    name: "wait",
    description:
      "Monitor the relay until a new message arrives, then return it (READ-only, long-poll). Baselines current comments on entry and returns the first new comment matching `from`. `after` optionally names the last message id already processed. Returns {timed_out: true, latest} if nothing arrives within timeout_secs.",
    inputSchema: {
      type: "object",
      properties: {
        after: {
          type: "string",
          default: "",
          description: "Last processed comment id; only newer messages match.",
        },
        from: {
          type: "string",
          enum: ["chatgpt", "muse", "any"],
          default: "chatgpt",
        },
        timeout_secs: { type: "integer", default: 120, minimum: 10, maximum: 600 },
        poll_secs: { type: "integer", default: 15, minimum: 5, maximum: 120 },
      },
      additionalProperties: false,
    },
  },
];

function textResult(obj) {
  return { content: [{ type: "text", text: JSON.stringify(obj, null, 2) }] };
}

function errResult(message) {
  return {
    content: [{ type: "text", text: `error: ${message}` }],
    isError: true,
  };
}

async function callTool(name, args = {}) {
  const issue = await findIssue();
  switch (name) {
    case "status": {
      const data = await getIssue(issue);
      return textResult({
        repo: REPO,
        issue: data.number,
        title: data.title,
        url: data.url,
        state: data.state,
        comment_count: data.comments.length,
        latest: data.comments.slice(-3).map((c) => ({
          id: c.id,
          author: c.author && c.author.login,
          createdAt: c.createdAt,
          header: headerOf(c.body),
        })),
      });
    }
    case "read": {
      const limit = Math.min(Math.max(args.limit || 10, 1), 50);
      const from = args.from || "any";
      const data = await getIssue(issue);
      const msgs = data.comments
        .filter((c) => (from === "any" ? true : matchFrom(c, from)))
        .slice(-limit)
        .reverse()
        .map(fmtComment);
      return textResult({ repo: REPO, issue: data.number, url: data.url, messages: msgs });
    }
    case "post": {
      const { header, body } = args;
      if (!header || !HEADER_RE.test(header))
        return errResult(
          "header must be one of the 4 protocol headers, see docs/agent-relay.md"
        );
      if (!body || !String(body).trim()) return errResult("body must be non-empty");
      const full = `${header}\n${body}`;
      const { stdout } = await execFileAsync(
        "gh",
        ["issue", "comment", String(issue), "--repo", REPO, "--body-file", "-"],
        { input: full, maxBuffer: 4 * 1024 * 1024 }
      );
      return textResult({ posted: true, issue, url: stdout.trim() });
    }
    case "wait": {
      const from = args.from || "chatgpt";
      const timeout = Math.min(Math.max(args.timeout_secs || 120, 10), 600) * 1000;
      const poll = Math.min(Math.max(args.poll_secs || 15, 5), 120) * 1000;
      const baseline = await getIssue(issue);
      const seen = new Set(baseline.comments.map((c) => c.id));
      if (args.after) seen.add(args.after);
      const deadline = Date.now() + timeout;
      for (;;) {
        await sleep(poll);
        const cur = await getIssue(issue);
        for (const c of cur.comments) {
          if (!seen.has(c.id)) {
            seen.add(c.id);
            if (matchFrom(c, from))
              return textResult({
                timed_out: false,
                repo: REPO,
                issue: cur.number,
                url: cur.url,
                message: fmtComment(c),
              });
          }
        }
        if (Date.now() >= deadline) {
          const latest = cur.comments[cur.comments.length - 1];
          return textResult({
            timed_out: true,
            repo: REPO,
            issue: cur.number,
            url: cur.url,
            latest: latest ? fmtComment(latest) : null,
          });
        }
      }
    }
    default:
      return errResult(`unknown tool: ${name}`);
  }
}

const rl = readline.createInterface({ input: process.stdin, terminal: false });

rl.on("line", (line) => {
  handle(line).catch(() => {});
});

async function handle(line) {
  if (!line.trim()) return;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  const { id, method, params } = msg;
  const respond = (result) =>
    process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`);
  const fail = (code, message) => {
    if (id === undefined) return; // notification: no response
    process.stdout.write(
      `${JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } })}\n`
    );
  };
  try {
    switch (method) {
      case "initialize":
        respond({
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "agent-relay", version: "0.1.0" },
        });
        break;
      case "notifications/initialized":
      case "notifications/cancelled":
        break;
      case "ping":
        respond({});
        break;
      case "tools/list":
        respond({ tools: TOOLS });
        break;
      case "tools/call":
        respond(await callTool(params && params.name, (params && params.arguments) || {}));
        break;
      default:
        fail(-32601, `unknown method: ${method}`);
    }
  } catch (e) {
    fail(-32603, (e && e.message) || String(e));
  }
}
