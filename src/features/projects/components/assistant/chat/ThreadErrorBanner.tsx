

import { HugeiconsIcon } from '@hugeicons/react'
import { AlertCircleIcon as __CircleAlertIconHugeIcon } from '@hugeicons/core-free-icons'

import { memo } from "react";
import { Button } from "@/components/ui/button";

export const ThreadErrorBanner = memo(function ThreadErrorBanner({
  error,
  onDismiss,
}: {
  error: string | null;
  onDismiss?: () => void;
}) {
  if (!error) return null;
  return (
    <div className="flex max-w-sm flex-col items-center justify-center gap-4 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
        <HugeiconsIcon icon={__CircleAlertIconHugeIcon} className="h-6 w-6" />
      </div>
      <div className="space-y-1">
        <h3 className="text-sm font-medium">An error occurred</h3>
        <p className="text-sm text-muted-foreground">
          {error}
        </p>
      </div>
      {onDismiss && (
        <Button variant="outline" size="sm" onClick={onDismiss}>
          Dismiss
        </Button>
      )}
    </div>
  );
});
