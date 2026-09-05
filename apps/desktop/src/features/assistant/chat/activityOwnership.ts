import type { OrchestrationThreadActivity } from "@cozea/assistant-contracts";

/** Native agentId is the owning task; bypassed activity is not parent narrative. */
export function isInternalActivity(activity: Pick<OrchestrationThreadActivity, "payload">): boolean {
  const payload = activity.payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
  const data = payload as Record<string, unknown>;
  return (
    data.timelineBypass === true ||
    (typeof data.agentId === "string" && data.agentId.trim().length > 0)
  );
}
