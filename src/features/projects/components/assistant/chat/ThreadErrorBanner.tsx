

import { HugeiconsIcon } from '@hugeicons/react'
import { AlertCircleIcon as __CircleAlertIconHugeIcon, Cancel01Icon as __XIconHugeIcon } from '@hugeicons/core-free-icons'

// @ts-nocheck
import { memo } from "react";
import { Alert, AlertAction, AlertDescription } from "../ui/alert";

export const ThreadErrorBanner = memo(function ThreadErrorBanner({
  error,
  onDismiss,
}: {
  error: string | null;
  onDismiss?: () => void;
}) {
  if (!error) return null;
  return (
    <div className="mx-auto w-full max-w-3xl px-3 pt-3 sm:px-5">
      <Alert variant="error">
        <HugeiconsIcon icon={__CircleAlertIconHugeIcon} />
        <AlertDescription title={error}>
          <span className="line-clamp-2 block min-w-0">{error}</span>
        </AlertDescription>
        {onDismiss && (
          <AlertAction>
            <button
              type="button"
              aria-label="Dismiss error"
              className="inline-flex size-6 items-center justify-center rounded-md text-destructive/60 transition-colors hover:text-destructive"
              onClick={onDismiss}
            >
              <HugeiconsIcon icon={__XIconHugeIcon} className="size-3.5" />
            </button>
          </AlertAction>
        )}
      </Alert>
    </div>
  );
});
