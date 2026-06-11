

import { HugeiconsIcon } from '@hugeicons/react'
import { AlertCircleIcon as __CircleAlertIconHugeIcon } from '@hugeicons/core-free-icons'

import { PROVIDER_DISPLAY_NAMES, type ServerProvider } from "@cozea/assistant-contracts";
import { memo } from "react";

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

  return (
    <div className="flex max-w-sm flex-col items-center justify-center gap-4 text-center">
      <div className={`flex h-12 w-12 items-center justify-center rounded-full ${isError ? 'bg-destructive/10 text-destructive' : 'bg-amber-500/10 text-amber-600 dark:text-amber-500'}`}>
        <HugeiconsIcon icon={__CircleAlertIconHugeIcon} className="h-6 w-6" />
      </div>
      <div className="space-y-1">
        <h3 className="text-sm font-medium">{title}</h3>
        <p className="text-sm text-muted-foreground">
          {status.message ?? defaultMessage}
        </p>
      </div>
    </div>
  );
});
