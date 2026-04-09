// @ts-nocheck
import { PROVIDER_DISPLAY_NAMES, type ServerProvider } from "@cozea/assistant-contracts";
import { memo } from "react";
import { Alert, AlertDescription, AlertTitle } from "../ui/alert";
import { ExclamationCircleIcon as CircleAlertIcon } from "@heroicons/react/24/outline"

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

  return (
    <div className="mx-auto w-full max-w-3xl px-3 pt-3 sm:px-5">
      <Alert variant={status.status === "error" ? "error" : "warning"}>
        <CircleAlertIcon />
        <AlertTitle className="line-clamp-1">{title}</AlertTitle>
        <AlertDescription title={status.message ?? defaultMessage}>
          <span className="line-clamp-2 block min-w-0">
            {status.message ?? defaultMessage}
          </span>
        </AlertDescription>
      </Alert>
    </div>
  );
});
