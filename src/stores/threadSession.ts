import type {
  OrchestrationReadModel,
  OrchestrationSessionStatus,
  ProviderKind,
} from "@cozea/assistant-contracts";

import type { ThreadSession } from "./types";

function normalizeThreadSessionProvider(
  providerName: string | null | undefined,
): ProviderKind {
  if (providerName === "codex" || providerName === "claudeAgent") {
    return providerName;
  }

  return "codex";
}

function deriveThreadSessionStatus(
  status: OrchestrationSessionStatus,
): ThreadSession["status"] {
  switch (status) {
    case "starting":
      return "connecting";
    case "running":
      return "running";
    case "error":
      return "error";
    case "ready":
    case "interrupted":
      return "ready";
    case "idle":
    case "stopped":
      return "closed";
  }
}

export function normalizeThreadSession(
  session: OrchestrationReadModel["threads"][number]["session"],
): ThreadSession | null {
  if (!session) {
    return null;
  }

  return {
    provider: normalizeThreadSessionProvider(session.providerName),
    status: deriveThreadSessionStatus(session.status),
    orchestrationStatus: session.status,
    activeTurnId: session.activeTurnId ?? undefined,
    createdAt: session.updatedAt,
    updatedAt: session.updatedAt,
    ...(session.lastError ? { lastError: session.lastError } : {}),
  };
}
