import type {
  SecurityScanBackendOption,
  SecurityScanRun,
} from "@shared/securityScanTypes"

/**
 * A representative in-progress run used to render the dashboard before the main-process
 * runner is wired. It is shaped exactly like a live run, so the UI it drives is the real
 * UI. Replaced by live state once the runner streams over IPC.
 */
const now = Date.now()

export const SAMPLE_SCAN_RUN: SecurityScanRun = {
  id: "sample-run",
  name: "Dev server scan",
  status: "running",
  target: {
    kind: "devServer",
    value: "http://127.0.0.1:5173",
    label: "Dev server · :5173",
  },
  backend: {
    kind: "apiKey",
    model: "anthropic/claude-sonnet-4.6",
    label: "Anthropic (Cozea key)",
  },
  startedAt: now - 4 * 60 * 1000,
  finishedAt: null,
  progress: 62,
  agents: [
    {
      id: "agent-orch",
      name: "Orchestrator",
      role: "orchestrator",
      status: "running",
      currentAction: "Coordinating recon and exploitation across 3 routes",
      startedAt: now - 4 * 60 * 1000,
      updatedAt: now - 5 * 1000,
      findingCount: 0,
      activityLog: [
        { at: now - 4 * 60 * 1000, text: "Planned scan across 12 discovered routes" },
        { at: now - 90 * 1000, text: "Dispatched exploitation agent to /api/users" },
      ],
    },
    {
      id: "agent-recon",
      name: "Recon",
      role: "recon",
      status: "done",
      currentAction: "Mapped 12 routes and 4 API endpoints",
      startedAt: now - 4 * 60 * 1000,
      updatedAt: now - 2 * 60 * 1000,
      findingCount: 1,
      activityLog: [
        { at: now - 4 * 60 * 1000, text: "Crawling http://127.0.0.1:5173" },
        { at: now - 3 * 60 * 1000, text: "Found login form at /login" },
        { at: now - 2 * 60 * 1000, text: "Flagged verbose error on /api/debug" },
      ],
    },
    {
      id: "agent-exploit",
      name: "Exploitation",
      role: "exploit",
      status: "running",
      currentAction: "Testing IDOR on /api/users/:id",
      startedAt: now - 2 * 60 * 1000,
      updatedAt: now - 3 * 1000,
      findingCount: 2,
      activityLog: [
        { at: now - 2 * 60 * 1000, text: "Fuzzing object ids on /api/users/:id" },
        { at: now - 40 * 1000, text: "Retrieved another user's record with a swapped id" },
        { at: now - 3 * 1000, text: "Building proof-of-concept request" },
      ],
    },
    {
      id: "agent-validate",
      name: "Validation",
      role: "validation",
      status: "waiting",
      currentAction: "Waiting for exploitation to confirm the IDOR",
      startedAt: null,
      updatedAt: now - 10 * 1000,
      findingCount: 0,
      activityLog: [],
    },
  ],
  findings: [
    {
      id: "f-idor",
      title: "IDOR exposes other users' records",
      severity: "critical",
      category: "A01: Broken Access Control",
      cwe: "CWE-639",
      cvss: 8.6,
      status: "confirmed",
      location: "GET /api/users/:id",
      description:
        "The endpoint returns any user's record when the id is changed, with no ownership check.",
      evidence: "Request with id=1002 returned the profile of a different account.",
      remediation:
        "Enforce an ownership or role check on the record before returning it.",
      discoveredByAgentId: "agent-exploit",
      createdAt: now - 40 * 1000,
    },
    {
      id: "f-xss",
      title: "Reflected XSS in search parameter",
      severity: "high",
      category: "A03: Injection",
      cwe: "CWE-79",
      cvss: 6.9,
      status: "open",
      location: "GET /search?q=",
      description: "The q parameter is reflected into the page without encoding.",
      evidence: "Payload in q executed in the rendered response.",
      remediation: "Encode user input on output, or render it as text rather than HTML.",
      discoveredByAgentId: "agent-exploit",
      createdAt: now - 70 * 1000,
    },
    {
      id: "f-debug",
      title: "Verbose error leaks stack traces",
      severity: "medium",
      category: "A05: Security Misconfiguration",
      cwe: "CWE-209",
      status: "open",
      location: "GET /api/debug",
      description: "Unhandled errors return full stack traces and framework versions.",
      remediation: "Return a generic error in production and log details server-side.",
      discoveredByAgentId: "agent-recon",
      createdAt: now - 2 * 60 * 1000,
    },
  ],
  reports: [],
}

/** Backend options mirror what the picker shows: API keys and local models, no subscriptions. */
export const SAMPLE_BACKEND_OPTIONS: readonly SecurityScanBackendOption[] = [
  {
    id: "anthropic-key",
    kind: "apiKey",
    label: "Anthropic (Cozea key)",
    model: "anthropic/claude-sonnet-4.6",
    eligible: true,
  },
  {
    id: "openrouter-key",
    kind: "apiKey",
    label: "OpenRouter (Cozea key)",
    model: "openrouter/z-ai/glm-5.3",
    eligible: true,
  },
  {
    id: "ollama-local",
    kind: "localModel",
    label: "Ollama (local)",
    model: "ollama/llama3.1",
    baseUrl: "http://127.0.0.1:11434",
    eligible: true,
  },
  {
    id: "claude-sub",
    kind: "apiKey",
    label: "Claude Code (subscription)",
    model: "anthropic/claude-sonnet-4.6",
    eligible: false,
    ineligibleReason: "Subscription logins cannot back a scan. Use an API key or local model.",
  },
]
