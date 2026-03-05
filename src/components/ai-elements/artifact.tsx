"use client";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { CopyIcon, DownloadIcon, XIcon, type LucideIcon } from "lucide-react";
import type { ComponentProps, HTMLAttributes, ReactNode } from "react";
import { memo } from "react";

export type ArtifactProps = HTMLAttributes<HTMLDivElement>;

/**
 * Container for displaying generated content like code, documents, or other outputs.
 * Provides a structured layout with header, actions, and content areas.
 *
 * @example
 * ```tsx
 * <Artifact>
 *   <ArtifactHeader>
 *     <ArtifactTitle>Generated Code</ArtifactTitle>
 *     <ArtifactDescription>TypeScript • 42 lines</ArtifactDescription>
 *     <ArtifactActions>
 *       <ArtifactAction icon={CopyIcon} tooltip="Copy" onClick={handleCopy} />
 *       <ArtifactAction icon={DownloadIcon} tooltip="Download" onClick={handleDownload} />
 *       <ArtifactClose onClick={handleClose} />
 *     </ArtifactActions>
 *   </ArtifactHeader>
 *   <ArtifactContent>
 *     <CodeBlock code={code} language="typescript" />
 *   </ArtifactContent>
 * </Artifact>
 * ```
 */
export const Artifact = memo(
  ({ className, children, ...props }: ArtifactProps) => (
    <div
      className={cn(
        "flex flex-col overflow-hidden rounded-lg border bg-card shadow-sm",
        className
      )}
      {...props}
    >
      {children}
    </div>
  )
);

Artifact.displayName = "Artifact";

export type ArtifactHeaderProps = HTMLAttributes<HTMLDivElement>;

/**
 * Header section containing title, description, and action buttons
 */
export const ArtifactHeader = memo(
  ({ className, children, ...props }: ArtifactHeaderProps) => (
    <div
      className={cn(
        "flex items-start justify-between gap-4 border-b p-4",
        className
      )}
      {...props}
    >
      <div className="flex-1 min-w-0 space-y-1">{children}</div>
    </div>
  )
);

ArtifactHeader.displayName = "ArtifactHeader";

export type ArtifactTitleProps = HTMLAttributes<HTMLHeadingElement>;

/**
 * Title text for the artifact
 */
export const ArtifactTitle = memo(
  ({ className, children, ...props }: ArtifactTitleProps) => (
    <h3 className={cn("font-medium text-sm truncate", className)} {...props}>
      {children}
    </h3>
  )
);

ArtifactTitle.displayName = "ArtifactTitle";

export type ArtifactDescriptionProps = HTMLAttributes<HTMLParagraphElement>;

/**
 * Description/metadata text for the artifact
 */
export const ArtifactDescription = memo(
  ({ className, children, ...props }: ArtifactDescriptionProps) => (
    <p
      className={cn("text-muted-foreground text-xs truncate", className)}
      {...props}
    >
      {children}
    </p>
  )
);

ArtifactDescription.displayName = "ArtifactDescription";

export type ArtifactActionsProps = HTMLAttributes<HTMLDivElement>;

/**
 * Container for action buttons
 */
export const ArtifactActions = memo(
  ({ className, children, ...props }: ArtifactActionsProps) => (
    <div
      className={cn("flex shrink-0 items-center gap-1", className)}
      {...props}
    >
      {children}
    </div>
  )
);

ArtifactActions.displayName = "ArtifactActions";

export type ArtifactActionProps = ComponentProps<typeof Button> & {
  /** Icon to display */
  icon?: LucideIcon;
  /** Tooltip text */
  tooltip?: string;
  /** Screen reader label */
  label?: string;
};

/**
 * Individual action button with optional tooltip
 */
export const ArtifactAction = memo(
  ({
    className,
    icon: Icon,
    tooltip,
    label,
    variant = "ghost",
    size = "icon",
    children,
    ...props
  }: ArtifactActionProps) => {
    const button = (
      <Button
        className={cn("size-8", className)}
        variant={variant}
        size={size}
        {...props}
      >
        {Icon && <Icon className="size-4" />}
        {children}
        {(label || tooltip) && (
          <span className="sr-only">{label || tooltip}</span>
        )}
      </Button>
    );

    if (!tooltip) {
      return button;
    }

    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>{button}</TooltipTrigger>
          <TooltipContent>
            <p>{tooltip}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }
);

ArtifactAction.displayName = "ArtifactAction";

export type ArtifactCloseProps = ComponentProps<typeof Button> & {
  /** Tooltip text */
  tooltip?: string;
};

/**
 * Close button for dismissing the artifact
 */
export const ArtifactClose = memo(
  ({
    className,
    tooltip = "Close",
    variant = "ghost",
    size = "icon",
    ...props
  }: ArtifactCloseProps) => (
    <ArtifactAction
      className={cn("size-8", className)}
      icon={XIcon}
      tooltip={tooltip}
      label="Close artifact"
      variant={variant}
      size={size}
      {...props}
    />
  )
);

ArtifactClose.displayName = "ArtifactClose";

export type ArtifactContentProps = HTMLAttributes<HTMLDivElement>;

/**
 * Main content area for the artifact
 */
export const ArtifactContent = memo(
  ({ className, children, ...props }: ArtifactContentProps) => (
    <div
      className={cn("app-scrollbar flex-1 overflow-auto", className)}
      {...props}
    >
      {children}
    </div>
  )
);

ArtifactContent.displayName = "ArtifactContent";

// Convenience pre-composed artifacts

export type CodeArtifactProps = {
  /** Artifact title */
  title: string;
  /** Language for display */
  language?: string;
  /** Line count */
  lineCount?: number;
  /** Content to display */
  children: ReactNode;
  /** Callback when copy is clicked */
  onCopy?: () => void;
  /** Callback when download is clicked */
  onDownload?: () => void;
  /** Callback when close is clicked */
  onClose?: () => void;
  /** Optional className */
  className?: string;
};

/**
 * Pre-composed artifact for code display
 */
export const CodeArtifact = memo(
  ({
    title,
    language,
    lineCount,
    children,
    onCopy,
    onDownload,
    onClose,
    className,
  }: CodeArtifactProps) => {
    const description = [
      language,
      lineCount && `${lineCount} line${lineCount !== 1 ? "s" : ""}`,
    ]
      .filter(Boolean)
      .join(" • ");

    return (
      <Artifact
        className={cn(
          "bg-[var(--tool-surface)] text-[var(--tool-surface-foreground)] border-0 shadow-none",
          className
        )}
      >
        <ArtifactHeader className="border-[color:var(--tool-border)]">
          <ArtifactTitle>{title}</ArtifactTitle>
          {description && (
            <ArtifactDescription>{description}</ArtifactDescription>
          )}
          <ArtifactActions>
            {onCopy && (
              <ArtifactAction
                icon={CopyIcon}
                tooltip="Copy code"
                onClick={onCopy}
              />
            )}
            {onDownload && (
              <ArtifactAction
                icon={DownloadIcon}
                tooltip="Download"
                onClick={onDownload}
              />
            )}
            {onClose && <ArtifactClose onClick={onClose} />}
          </ArtifactActions>
        </ArtifactHeader>
        <ArtifactContent>{children}</ArtifactContent>
      </Artifact>
    );
  }
);

CodeArtifact.displayName = "CodeArtifact";

export type DocumentArtifactProps = {
  /** Artifact title */
  title: string;
  /** Last updated text */
  updatedAt?: string;
  /** Content to display */
  children: ReactNode;
  /** Callback when copy is clicked */
  onCopy?: () => void;
  /** Callback when download is clicked */
  onDownload?: () => void;
  /** Callback when close is clicked */
  onClose?: () => void;
  /** Optional className */
  className?: string;
};

/**
 * Pre-composed artifact for document display
 */
export const DocumentArtifact = memo(
  ({
    title,
    updatedAt,
    children,
    onCopy,
    onDownload,
    onClose,
    className,
  }: DocumentArtifactProps) => (
    <Artifact className={className}>
      <ArtifactHeader>
        <ArtifactTitle>{title}</ArtifactTitle>
        {updatedAt && (
          <ArtifactDescription>Updated {updatedAt}</ArtifactDescription>
        )}
        <ArtifactActions>
          {onCopy && (
            <ArtifactAction icon={CopyIcon} tooltip="Copy" onClick={onCopy} />
          )}
          {onDownload && (
            <ArtifactAction
              icon={DownloadIcon}
              tooltip="Download"
              onClick={onDownload}
            />
          )}
          {onClose && <ArtifactClose onClick={onClose} />}
        </ArtifactActions>
      </ArtifactHeader>
      <ArtifactContent className="p-4">{children}</ArtifactContent>
    </Artifact>
  )
);

DocumentArtifact.displayName = "DocumentArtifact";
