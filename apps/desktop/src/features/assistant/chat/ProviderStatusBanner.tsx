

import { HugeiconsIcon } from '@hugeicons/react'
import { AlertCircleIcon as __CircleAlertIconHugeIcon } from '@hugeicons/core-free-icons'

import {
  PROVIDER_DISPLAY_NAMES,
  type ProviderDriverKind,
  type ServerProvider,
} from "@cozea/assistant-contracts";
import { memo, useState } from "react";

import { DevAppIcon } from "@/features/devapps/components/DevAppIcon";
import { getDevAppForAssistantProvider } from "@/features/devapps/registry";
import { ProviderRemediationAction } from "@/features/projects/components/assistant/chat/ProviderRemediationAction";
import { Button } from "@/components/ui/button";
import { updateAssistantProvider } from "@/features/projects/components/workbench/assistant/assistantRuntimeMetadataStore";

export const ProviderStatusBanner = memo(function ProviderStatusBanner({
  status,
}: {
  status: ServerProvider | null;
}) {
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [updateResult, setUpdateResult] = useState<
    NonNullable<ServerProvider["updateState"]> | null
  >(null);
  const [isUpdating, setIsUpdating] = useState(false);
  const updateAvailable = status?.versionAdvisory?.status === "behind_latest";

  if (!status || ((!updateAvailable && status.status === "ready") || status.status === "disabled")) {
    return null;
  }

  const provider = (status.provider ?? status.driver) as keyof typeof PROVIDER_DISPLAY_NAMES;
  const providerLabel = PROVIDER_DISPLAY_NAMES[provider] ?? status.displayName ?? status.driver;
  const defaultMessage = updateAvailable
    ? `${providerLabel} ${status.versionAdvisory?.currentVersion ?? status.version ?? ""} is behind ${status.versionAdvisory?.latestVersion ?? "the latest release"}. Update it to load the newest models.`
    : status.status === "error"
      ? `${providerLabel} provider is unavailable.`
      : `${providerLabel} provider has limited availability.`;
  const title = updateAvailable ? `${providerLabel} update available` : `${providerLabel} provider status`;
  const isError = status.status === "error";
  const devApp = getDevAppForAssistantProvider(provider);
  const badgeClass = isError ? "bg-destructive text-white" : "bg-amber-500 text-white";
  const updateState = updateResult ?? status.updateState ?? null;
  const updateFeedback =
    updateState?.status === "failed" || updateState?.status === "unchanged" ? updateState : null;

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
        provider={provider}
        message={status.message ?? defaultMessage}
        authenticationRequired={status.auth.status === "unauthenticated"}
      />
      {updateAvailable && status.versionAdvisory?.canUpdate ? (
        <Button
          size="sm"
          disabled={isUpdating}
          onClick={() => {
            setIsUpdating(true);
            setUpdateError(null);
            setUpdateResult(null);
            void updateAssistantProvider(
              status.driver ?? (provider as ProviderDriverKind),
              status.instanceId,
            )
              .then((result) => setUpdateResult(result))
              .catch((error: unknown) => {
                setUpdateError(error instanceof Error ? error.message : "Provider update failed.");
              })
              .finally(() => setIsUpdating(false));
          }}
        >
          {isUpdating ? <div className="loader mr-1.5" /> : null}
          {isUpdating ? `Updating ${providerLabel}…` : `Update ${providerLabel}`}
        </Button>
      ) : null}
      {updateError ? <p className="text-xs text-destructive">{updateError}</p> : null}
      {updateFeedback ? (
        <div className="w-full space-y-2 text-left" role="status" aria-live="polite">
          <p
            className={`text-xs ${updateFeedback.status === "failed" ? "text-destructive" : "text-muted-foreground"}`}
          >
            {updateFeedback.message ?? "The provider version did not change."}
          </p>
          {updateFeedback.output ? (
            <details className="text-xs text-muted-foreground">
              <summary className="cursor-pointer select-none">Update details</summary>
              <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap rounded-md bg-muted/50 p-2 font-mono text-[11px]">
                {updateFeedback.output}
              </pre>
            </details>
          ) : null}
        </div>
      ) : null}
    </div>
  );
});
