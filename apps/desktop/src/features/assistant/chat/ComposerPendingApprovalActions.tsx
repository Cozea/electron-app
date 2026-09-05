import { type ApprovalRequestId, type ProviderApprovalDecision } from "@cozea/assistant-contracts";
import { memo } from "react";
import { Button } from "../ui/button";

interface ComposerPendingApprovalActionsProps {
  options?: ReadonlyArray<{ decision: ProviderApprovalDecision; label: string; warning?: string }>;
  requestId: ApprovalRequestId;
  isResponding: boolean;
  onRespondToApproval: (
    requestId: ApprovalRequestId,
    decision: ProviderApprovalDecision,
  ) => Promise<void>;
}

export const ComposerPendingApprovalActions = memo(function ComposerPendingApprovalActions({
  options,
  requestId,
  isResponding,
  onRespondToApproval,
}: ComposerPendingApprovalActionsProps) {
  const choices = options ?? [
    { decision: "cancel" as const, label: "Cancel turn" },
    { decision: "decline" as const, label: "Decline" },
    { decision: "acceptForSession" as const, label: "Always allow this session" },
    { decision: "accept" as const, label: "Approve once" },
  ];
  return <div className="flex flex-wrap justify-end gap-2">
    {choices.map((option) => <div key={option.decision} className="max-w-64 space-y-1">
      {option.warning ? <p className="text-xs text-muted-foreground">{option.warning}</p> : null}
      <Button size="sm" variant={option.decision === "decline" ? "destructive-outline" : option.decision === "accept" ? "default" : "outline"} disabled={isResponding} onClick={() => void onRespondToApproval(requestId, option.decision)}>{option.label}</Button>
    </div>)}
  </div>;
});
