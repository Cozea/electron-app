"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  AlertCircleIcon,
  CheckCircle2Icon,
  XCircleIcon,
  ShieldAlertIcon,
} from "lucide-react";
import type { ComponentProps, HTMLAttributes, ReactNode } from "react";
import { createContext, memo, useContext } from "react";

/**
 * Confirmation state for tool approval workflow
 */
export type ConfirmationState =
  | "pending"
  | "approved"
  | "rejected"
  | "expired";

type ConfirmationContextValue = {
  state: ConfirmationState;
  toolName?: string;
  toolCallId?: string;
};

const ConfirmationContext = createContext<ConfirmationContextValue | null>(
  null
);

export const useConfirmation = () => {
  const context = useContext(ConfirmationContext);
  if (!context) {
    throw new Error(
      "Confirmation components must be used within Confirmation"
    );
  }
  return context;
};

export type ConfirmationProps = HTMLAttributes<HTMLDivElement> & {
  /** Current approval state */
  state: ConfirmationState;
  /** Name of the tool requesting approval */
  toolName?: string;
  /** Tool call ID for the approval response */
  toolCallId?: string;
};

/**
 * Container for tool approval confirmation UI.
 * Provides context for child components to access approval state.
 *
 * @example
 * ```tsx
 * <Confirmation state="pending" toolName="deleteFile" toolCallId="abc123">
 *   <ConfirmationRequest>
 *     <p>Delete file.txt?</p>
 *   </ConfirmationRequest>
 *   <ConfirmationActions>
 *     <ConfirmationAction onClick={handleApprove}>Approve</ConfirmationAction>
 *     <ConfirmationAction onClick={handleReject} variant="destructive">
 *       Reject
 *     </ConfirmationAction>
 *   </ConfirmationActions>
 * </Confirmation>
 * ```
 */
export const Confirmation = memo(
  ({
    className,
    state,
    toolName,
    toolCallId,
    children,
    ...props
  }: ConfirmationProps) => (
    <ConfirmationContext.Provider value={{ state, toolName, toolCallId }}>
      <div
        className={cn(
          "rounded-lg border p-4",
          state === "pending" && "border-yellow-500/50 bg-yellow-500/5",
          state === "approved" && "border-green-500/50 bg-green-500/5",
          state === "rejected" && "border-red-500/50 bg-red-500/5",
          state === "expired" && "border-muted bg-muted/50",
          className
        )}
        {...props}
      >
        {children}
      </div>
    </ConfirmationContext.Provider>
  )
);

Confirmation.displayName = "Confirmation";

export type ConfirmationRequestProps = HTMLAttributes<HTMLDivElement>;

/**
 * Content shown when approval is pending (state="pending")
 */
export const ConfirmationRequest = memo(
  ({ className, children, ...props }: ConfirmationRequestProps) => {
    const { state, toolName } = useConfirmation();

    if (state !== "pending") return null;

    return (
      <div className={cn("space-y-3", className)} {...props}>
        <div className="flex items-center gap-2 text-yellow-600">
          <ShieldAlertIcon className="size-5" />
          <span className="font-medium text-sm">
            {toolName ? `"${toolName}" requires approval` : "Approval Required"}
          </span>
        </div>
        <div className="text-sm text-muted-foreground">{children}</div>
      </div>
    );
  }
);

ConfirmationRequest.displayName = "ConfirmationRequest";

export type ConfirmationAcceptedProps = HTMLAttributes<HTMLDivElement>;

/**
 * Content shown when approval was granted (state="approved")
 */
export const ConfirmationAccepted = memo(
  ({ className, children, ...props }: ConfirmationAcceptedProps) => {
    const { state, toolName } = useConfirmation();

    if (state !== "approved") return null;

    return (
      <div className={cn("space-y-2", className)} {...props}>
        <div className="flex items-center gap-2 text-green-600">
          <CheckCircle2Icon className="size-5" />
          <span className="font-medium text-sm">
            {toolName ? `"${toolName}" approved` : "Approved"}
          </span>
        </div>
        {children && (
          <div className="text-sm text-muted-foreground">{children}</div>
        )}
      </div>
    );
  }
);

ConfirmationAccepted.displayName = "ConfirmationAccepted";

export type ConfirmationRejectedProps = HTMLAttributes<HTMLDivElement>;

/**
 * Content shown when approval was denied (state="rejected")
 */
export const ConfirmationRejected = memo(
  ({ className, children, ...props }: ConfirmationRejectedProps) => {
    const { state, toolName } = useConfirmation();

    if (state !== "rejected") return null;

    return (
      <div className={cn("space-y-2", className)} {...props}>
        <div className="flex items-center gap-2 text-red-600">
          <XCircleIcon className="size-5" />
          <span className="font-medium text-sm">
            {toolName ? `"${toolName}" rejected` : "Rejected"}
          </span>
        </div>
        {children && (
          <div className="text-sm text-muted-foreground">{children}</div>
        )}
      </div>
    );
  }
);

ConfirmationRejected.displayName = "ConfirmationRejected";

export type ConfirmationExpiredProps = HTMLAttributes<HTMLDivElement>;

/**
 * Content shown when approval request expired (state="expired")
 */
export const ConfirmationExpired = memo(
  ({ className, children, ...props }: ConfirmationExpiredProps) => {
    const { state, toolName } = useConfirmation();

    if (state !== "expired") return null;

    return (
      <div className={cn("space-y-2", className)} {...props}>
        <div className="flex items-center gap-2 text-muted-foreground">
          <AlertCircleIcon className="size-5" />
          <span className="font-medium text-sm">
            {toolName ? `"${toolName}" request expired` : "Request Expired"}
          </span>
        </div>
        {children && (
          <div className="text-sm text-muted-foreground">{children}</div>
        )}
      </div>
    );
  }
);

ConfirmationExpired.displayName = "ConfirmationExpired";

export type ConfirmationActionsProps = HTMLAttributes<HTMLDivElement>;

/**
 * Container for approval action buttons
 */
export const ConfirmationActions = memo(
  ({ className, children, ...props }: ConfirmationActionsProps) => {
    const { state } = useConfirmation();

    // Only show actions when pending
    if (state !== "pending") return null;

    return (
      <div
        className={cn("mt-4 flex items-center gap-2", className)}
        {...props}
      >
        {children}
      </div>
    );
  }
);

ConfirmationActions.displayName = "ConfirmationActions";

export type ConfirmationActionProps = ComponentProps<typeof Button> & {
  /** Icon to display before the label */
  icon?: ReactNode;
};

/**
 * Individual action button for approval/rejection
 */
export const ConfirmationAction = memo(
  ({
    className,
    children,
    icon,
    size = "sm",
    ...props
  }: ConfirmationActionProps) => (
    <Button className={cn("gap-1.5", className)} size={size} {...props}>
      {icon}
      {children}
    </Button>
  )
);

ConfirmationAction.displayName = "ConfirmationAction";

// Convenience component showing full confirmation flow
export type ConfirmationDialogProps = {
  state: ConfirmationState;
  toolName: string;
  toolCallId: string;
  description?: ReactNode;
  onApprove: () => void;
  onReject: () => void;
  approveLabel?: string;
  rejectLabel?: string;
  className?: string;
};

/**
 * Pre-composed confirmation dialog with all states handled
 */
export const ConfirmationDialog = memo(
  ({
    state,
    toolName,
    toolCallId,
    description,
    onApprove,
    onReject,
    approveLabel = "Approve",
    rejectLabel = "Reject",
    className,
  }: ConfirmationDialogProps) => (
    <Confirmation
      state={state}
      toolName={toolName}
      toolCallId={toolCallId}
      className={className}
    >
      <ConfirmationRequest>{description}</ConfirmationRequest>
      <ConfirmationAccepted>Tool execution completed.</ConfirmationAccepted>
      <ConfirmationRejected>Tool execution was blocked.</ConfirmationRejected>
      <ConfirmationExpired>
        This approval request has expired.
      </ConfirmationExpired>
      <ConfirmationActions>
        <ConfirmationAction
          onClick={onApprove}
          icon={<CheckCircle2Icon className="size-4" />}
        >
          {approveLabel}
        </ConfirmationAction>
        <ConfirmationAction
          onClick={onReject}
          variant="outline"
          icon={<XCircleIcon className="size-4" />}
        >
          {rejectLabel}
        </ConfirmationAction>
      </ConfirmationActions>
    </Confirmation>
  )
);

ConfirmationDialog.displayName = "ConfirmationDialog";
