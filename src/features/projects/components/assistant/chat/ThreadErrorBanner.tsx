// @ts-nocheck
import { memo } from "react";
import { Alert, AlertAction, AlertDescription } from "../ui/alert";
import { ExclamationCircleIcon as CircleAlertIcon, XMarkIcon as XIcon } from "@heroicons/react/24/outline"

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
        <CircleAlertIcon />
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
              <XIcon className="size-3.5" />
            </button>
          </AlertAction>
        )}
      </Alert>
    </div>
  );
});
