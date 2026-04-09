import {
  type ReactNode,
} from "react";

import type { Id } from "../../../convex/_generated/dataModel";
import { LayoutToggles, SidebarInsetToggle } from "@/components/layouts/LayoutToggles";
import { cn } from "@/lib/utils";
import { useWindowChrome } from "@/hooks/useWindowChrome";
import { useWindowsCaptionControlsWidth } from "@/hooks/useWindowsCaptionControlsWidth";
import { HeaderInboxButton } from "./unified-header/HeaderInboxButton";
import { HeaderProjectChangesButton } from "./unified-header/HeaderProjectChangesButton";
import { HeaderProjectShareButton } from "./unified-header/HeaderProjectShareButton";

interface UnifiedHeaderProps {
  header?: ReactNode;
  centerAddon?: ReactNode;
  preSearchAddon?: ReactNode;
  rightAddon?: ReactNode;
  className?: string;
  layoutMode?: "fixed" | "inset";
  leftWindowControlsInset?: boolean;
  contentInsetLeft?: number;
  contentInsetRight?: number;
  compactHeaderActions?: boolean;
  hideInbox?: boolean;
  projectInviteContext?: {
    projectId: Id<"projects"> | null;
    projectName?: string | null;
  } | null;
}

export function UnifiedHeader({
  header,
  centerAddon,
  preSearchAddon,
  rightAddon,
  className,
  layoutMode = "fixed",
  leftWindowControlsInset = false,
  contentInsetLeft = 0,
  contentInsetRight = 0,
  compactHeaderActions = true,
  hideInbox = false,
  projectInviteContext = null,
}: UnifiedHeaderProps) {
  const windowChrome = useWindowChrome();
  const shouldShowWindowsCaptionSpacer = windowChrome.isWindows;
  const windowsCaptionSpacerWidth = useWindowsCaptionControlsWidth();
  const shouldApplyLeftWindowControlsInset = leftWindowControlsInset && windowChrome.isMac;
  const headerSurfaceClassName = "border-b border-border/60 bg-background";
  const headerLayoutClassName =
    layoutMode === "inset" ? "relative z-10 w-full shrink-0" : "fixed top-0 left-0 right-0 z-40";
  const macHeaderControlsBuffer = shouldApplyLeftWindowControlsInset ? 16 : 0;

  const windowControlsInsetPadding = shouldApplyLeftWindowControlsInset
    ? windowChrome.compactLeftInset
    : 0;
  const rightFrameInset = shouldShowWindowsCaptionSpacer ? 0 : contentInsetRight;
  const headerContentStyle = {
    paddingLeft: contentInsetLeft + windowControlsInsetPadding + macHeaderControlsBuffer,
    paddingRight: rightFrameInset,
  };

  const isTabsPrimaryLayout = layoutMode === "inset" && Boolean(header);

  const collaborationControl = projectInviteContext ? (
    <div className="flex items-center gap-0">
      {(() => {
        const parts: ReactNode[] = [];
        if (projectInviteContext.projectId) {
          parts.push(
            <HeaderProjectChangesButton key="changes" projectId={projectInviteContext.projectId} />,
          );
        }
        parts.push(
          <HeaderProjectShareButton
            key="share"
            projectId={projectInviteContext.projectId}
            projectName={projectInviteContext.projectName}
          />,
        );
        if (!hideInbox) {
          parts.push(<HeaderInboxButton key="inbox" />);
        }
        return parts.flatMap((node, index) =>
          index === 0
            ? [node]
            : [
                <div
                  key={`collab-sep-${index}`}
                  className="mx-0.5 h-4 w-px shrink-0 bg-border"
                  aria-hidden
                />,
                node,
              ],
        );
      })()}
    </div>
  ) : !hideInbox ? (
    <HeaderInboxButton />
  ) : null;

  if (isTabsPrimaryLayout) {
    return (
      <div
        className={cn(
          headerLayoutClassName,
          "h-10 flex items-center px-2 titlebar-drag-region transition-[padding] duration-200 ease-out",
          headerSurfaceClassName,
          className,
        )}
      >
        {centerAddon && (
          <div
            className="pointer-events-none absolute inset-y-0 left-0 right-0 z-10 flex items-center justify-center"
            style={headerContentStyle}
          >
            <div className="pointer-events-auto titlebar-no-drag flex min-w-0 max-w-[52vw] items-center justify-center">
              {centerAddon}
            </div>
          </div>
        )}
        <div
          className="pointer-events-none absolute inset-y-0 left-0 right-0 z-[5] flex items-center justify-center"
          style={headerContentStyle}
        >
          <div className="pointer-events-auto titlebar-no-drag flex min-w-0 items-center">
            {compactHeaderActions ? (
              <div className="shared-header-action-pills inline-flex min-w-0 items-center">
                {header}
              </div>
            ) : (
              <div className="flex min-w-0 items-center">{header}</div>
            )}
            {preSearchAddon && (
              <div className="flex items-center shrink-0 ml-1">{preSearchAddon}</div>
            )}
          </div>
        </div>
        <div className="flex h-10 w-full items-stretch gap-0.5" style={headerContentStyle}>
          <div className="flex min-w-0 shrink-0 items-center gap-0.5 titlebar-no-drag">
            <SidebarInsetToggle />
          </div>
          {/* Explicit drag strip: avoid wrapping flex-1 in titlebar-no-drag (was ~full-width no-drag). */}
          <div className="min-h-0 min-w-0 flex-1" aria-hidden="true" />
          <div className="flex shrink-0 items-center gap-0 titlebar-no-drag">
            {collaborationControl}
            <LayoutToggles />
            {rightAddon && (
              <>
                {collaborationControl ? (
                  <div className="mx-1 h-4 w-px shrink-0 bg-border" aria-hidden />
                ) : null}
                <div className="flex items-center">{rightAddon}</div>
              </>
            )}
            {shouldShowWindowsCaptionSpacer && (
              <>
                {(collaborationControl || rightAddon) ? (
                  <div className="mx-1 h-4 w-px shrink-0 bg-border" aria-hidden />
                ) : null}
                <div
                  aria-hidden="true"
                  className="h-7 shrink-0 flex-none"
                  style={{ width: windowsCaptionSpacerWidth }}
                />
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        headerLayoutClassName,
        "h-10 flex items-center pl-4 pr-2 titlebar-drag-region transition-[padding] duration-200 ease-out",
        headerSurfaceClassName,
        className,
      )}
    >
      {centerAddon && (
        <div
          className="pointer-events-none absolute inset-y-0 left-0 right-0 z-10 flex items-center justify-center"
          style={headerContentStyle}
        >
          <div className="pointer-events-auto titlebar-no-drag flex min-w-0 max-w-[52vw] items-center justify-center">
            {centerAddon}
          </div>
        </div>
      )}
      <div className="flex h-10 w-full items-stretch gap-3" style={headerContentStyle}>
        <div className="flex min-w-0 shrink-0 items-center gap-0.5 titlebar-no-drag">
          <SidebarInsetToggle />
          {compactHeaderActions ? (
            <div className="shared-header-action-pills flex min-w-0 items-center">{header}</div>
          ) : (
            header
          )}
          {preSearchAddon && <div className="flex shrink-0 items-center">{preSearchAddon}</div>}
        </div>
        <div className="min-h-0 min-w-0 flex-1" aria-hidden="true" />
        <div className="flex min-w-0 shrink-0 items-center gap-0.5 titlebar-no-drag">
          <div className="flex items-center gap-0.5">
            {collaborationControl}
            <LayoutToggles />
            {rightAddon && (
              <>
                {collaborationControl ? (
                  <div className="mx-1 h-4 w-px shrink-0 bg-border" aria-hidden />
                ) : null}
                <div className="flex items-center">{rightAddon}</div>
              </>
            )}
            {shouldShowWindowsCaptionSpacer && (
              <>
                {(collaborationControl || rightAddon) ? (
                  <div className="mx-1 h-4 w-px shrink-0 bg-border" aria-hidden />
                ) : null}
                <div
                  aria-hidden="true"
                  className="h-7 shrink-0 flex-none"
                  style={{ width: windowsCaptionSpacerWidth }}
                />
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
