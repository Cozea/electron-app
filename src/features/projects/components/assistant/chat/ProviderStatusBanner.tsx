

import { HugeiconsIcon } from '@hugeicons/react'
import { AlertCircleIcon as __CircleAlertIconHugeIcon } from '@hugeicons/core-free-icons'

import { PROVIDER_DISPLAY_NAMES, type ServerProvider } from "@cozea/assistant-contracts";
import { memo } from "react";

import { DevAppIcon } from "@/features/devapps/components/DevAppIcon";
import { getDevAppForAssistantProvider } from "@/features/devapps/registry";
import { ProviderRemediationAction } from "@/features/projects/components/assistant/chat/ProviderRemediationAction";

export const ProviderStatusBanner = memo(function ProviderStatusBanner({
  status,
}: {
  status: ServerProvider | null;
}) {
  if (!status || status.status === "ready" || status.status === "disabled") {
    return null;
  }

  const providerLabel = PROVIDER_DISPLAY_NAMES[status.provider] ?? status.provider;
  const defaultMessage =
    status.status === "error"
      ? `${providerLabel} provider is unavailable.`
      : `${providerLabel} provider has limited availability.`;
  const title = `${providerLabel} provider status`;
  const isError = status.status === "error";
  const devApp = getDevAppForAssistantProvider(status.provider);
  const badgeClass = isError ? "bg-destructive text-white" : "bg-amber-500 text-white";

  return (
    <div className="flex max-w-sm flex-col items-center justify-center gap-4 text-center">
      <div className="relative">
        {devApp ? (
          <span className="block size-12 overflow-hidden rounded-[11px]">
            <DevAppIcon app={devApp} />
          </span>
        ) : (
          <div className={`flex h-12 w-12 items-center justify-center rounded-full ${isError ? 'bg-destructive/10 text-destructive' : 'bg-amber-500/10 text-amber-600 dark:text-amber-500'}`}>
            <HugeiconsIcon icon={__CircleAlertIconHugeIcon} className="h-6 w-6" />
          </div>
        )}
        {devApp ? (
          <span
            className={`absolute -bottom-1.5 -right-1.5 flex size-5 items-center justify-center rounded-full ring-2 ring-content-surface ${badgeClass}`}
            aria-hidden
          >
            <HugeiconsIcon icon={__CircleAlertIconHugeIcon} className="size-3.5" />
          </span>
        ) : null}
      </div>
      <div className="space-y-1">
        <h3 className="text-sm font-medium">{title}</h3>
        <p className="text-sm text-muted-foreground">
          {status.message ?? defaultMessage}
        </p>
      </div>
      <ProviderRemediationAction
        provider={status.provider}
        message={status.message ?? defaultMessage}
      />
    </div>
  );
});
