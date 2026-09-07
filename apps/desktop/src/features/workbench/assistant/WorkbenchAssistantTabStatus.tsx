import { memo } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { AlertCircleIcon as __AlertCircleHugeIcon } from "@hugeicons/core-free-icons";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useSubstrateChatTransport } from "@/substrate/useSubstrateChatTransport";
import { useT3CutoverActive } from "@/substrate/t3CutoverStore";
import {
  useT3ConnectionStatus,
  t3ThreadConnectionKey,
  t3ShellConnectionKey,
} from "@/substrate/t3ConnectionStatus";
import { useAssistantRuntimeStatus } from "@/features/workbench/useAssistantRuntimeStatus";
import type { WorkbenchAssistantChatTile as WorkbenchAssistantChatTileRecord } from "@/lib/workbenchStore";
import { useThreadDetailStore } from "@/features/assistant/model/threadDetailStore";

export interface WorkbenchAssistantTabStatusProps {
  tile: WorkbenchAssistantChatTileRecord;
}

export const WorkbenchAssistantTabStatus = memo(function WorkbenchAssistantTabStatus({
  tile,
}: WorkbenchAssistantTabStatusProps) {
  const substrateTransport = useSubstrateChatTransport();
  const t3CutoverActive = useT3CutoverActive();
  const transportBaseUrl = substrateTransport.active
    ? (substrateTransport.shadowBaseUrl ?? null)
    : null;
  const mediaBaseUrl = t3CutoverActive ? transportBaseUrl : null;

  const detailConnection = useT3ConnectionStatus(
    mediaBaseUrl && tile.threadId
      ? t3ThreadConnectionKey(mediaBaseUrl, tile.threadId)
      : null,
  );
  const shellConnection = useT3ConnectionStatus(
    transportBaseUrl ? t3ShellConnectionKey(transportBaseUrl) : null,
  );
  const connectionStatus =
    detailConnection && detailConnection.phase !== "connected" ? detailConnection : shellConnection;

  const assistantRuntime = useAssistantRuntimeStatus();
  const runtimeError =
    assistantRuntime.phase === "error"
      ? assistantRuntime.lastError?.trim() || "Local chat runtime is unavailable."
      : null;

  const threadDetail = useThreadDetailStore((state) =>
    tile.threadId ? (state.byThreadId[tile.threadId] ?? null) : null,
  );
  const threadError = threadDetail?.error ?? null;

  const isReconnecting = connectionStatus?.phase === "reconnecting";
  const isConnectionError = connectionStatus?.phase === "error";
  const hasIssue =
    isReconnecting || isConnectionError || Boolean(runtimeError) || Boolean(threadError);

  // Transient/healthy connecting and connected states do not display an indicator.
  // Only actual problem states render an attention icon.
  if (!hasIssue) return null;

  const tooltipMessage = isReconnecting
    ? "Connection interrupted. Reconnecting… Saved content may be out of date."
    : isConnectionError
      ? connectionStatus?.error || "Subscription disconnected"
      : runtimeError || threadError;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          title=""
          data-slot="assistant-tab-attention"
          className="inline-flex shrink-0 items-center justify-center text-amber-500 hover:text-amber-600 dark:text-amber-400 dark:hover:text-amber-300 transition-colors cursor-help"
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          aria-label={tooltipMessage ?? "Connection issue"}
        >
          <HugeiconsIcon icon={__AlertCircleHugeIcon} className="size-3" />
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-xs text-xs">
        {tooltipMessage}
      </TooltipContent>
    </Tooltip>
  );
});
