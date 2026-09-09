import {
  lazy,
  type ReactNode,
  Suspense,
} from "react";

import type { Id } from "../../../../../convex/_generated/dataModel";
import { ProjectShellTitleBarLeft } from "@/features/projects/ui/ProjectShellTitleBarLeft";
// PRODUCT TOUR DEBUG: temporary, remove before release.
import { ProductTourDebugTrigger } from "@/features/tour/ProductTourDebugTrigger";
import { cn } from "@/lib/utils";
import { useWindowChrome } from "@/hooks/useWindowChrome";
import { useWindowsCaptionControlsWidth } from "@/hooks/useWindowsCaptionControlsWidth";
import { HeaderProjectChangesButton } from "./unified-header/HeaderProjectChangesButton";
import { WorkbenchHeaderEditorControl } from "@/features/workbench/WorkbenchHeaderEditorControl";
import { useOptionalSidebar } from "@/components/ui/sidebar";

import { ResponsiveHeaderRow, type HeaderActionGroup } from "./unified-header/ResponsiveHeaderRow";

const LazyHeaderProjectShareButton = lazy(() =>
  import("./unified-header/HeaderProjectShareButton").then((module) => ({
    default: module.HeaderProjectShareButton,
  })),
);

function HeaderShareButtonFallback() {
  return (
    <div
      aria-hidden="true"
      className="h-7 w-7 rounded-md bg-sidebar transition-colors"
    />
  );
}

interface UnifiedHeaderProps {
  header?: ReactNode;
  centerAddon?: ReactNode;
  preSearchAddon?: ReactNode;
  rightAddon?: ReactNode;
  className?: string;
  /** `fixed` spans the viewport (legacy). `embedded` stays in layout flow (e.g. inside `SidebarInset`) so it clears the sidebar. */
  layoutMode?: "fixed" | "inset" | "embedded";
  leftWindowControlsInset?: boolean;
  contentInsetLeft?: number;
  contentInsetRight?: number;
  compactHeaderActions?: boolean;
  hideShare?: boolean;
  projectInviteContext?: {
    projectId: Id<"projects"> | null;
    projectName?: string | null;
  } | null;
  /** Local project path for “Open in editor” (shown beside Changes / Share). */
  editorProjectPath?: string | null;
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
  hideShare = false,
  projectInviteContext = null,
  editorProjectPath = null,
}: UnifiedHeaderProps) {
  const windowChrome = useWindowChrome();
  const sidebar = useOptionalSidebar();
  const shouldShowWindowsCaptionSpacer = windowChrome.isWindows;
  const windowsCaptionSpacerWidth = useWindowsCaptionControlsWidth();
  const shouldApplyLeftWindowControlsInset = leftWindowControlsInset && windowChrome.isMac;
  /** Inset is for viewport-fixed titlebars under traffic lights; embedded shell already clears the sidebar. */
  const relaxMacTitlebarLeadingPadding =
    layoutMode === "embedded" &&
    shouldApplyLeftWindowControlsInset &&
    sidebar != null &&
    sidebar.state === "expanded";
  // Transparent surface: the header sits above the content area in a flex
  // column (nothing scrolls beneath it), and a distinct tint/border made it
  // read as a separate bar from the tile canvas behind it.
  const headerLayoutClassName =
    layoutMode === "inset"
      ? "relative z-10 w-full shrink-0"
      : layoutMode === "embedded"
        ? "relative z-40 w-full shrink-0"
        : "fixed top-0 left-0 right-0 z-40";
  const windowControlsInsetPadding =
    shouldApplyLeftWindowControlsInset && !relaxMacTitlebarLeadingPadding
      ? windowChrome.titlebarLeadingSpace
      : 0;
  const rightFrameInset = shouldShowWindowsCaptionSpacer ? 0 : contentInsetRight;
  const headerContentStyle = {
    paddingLeft: contentInsetLeft + windowControlsInsetPadding,
    paddingRight: rightFrameInset,
  };
  /** Embedded shell: tighter trailing edge so header actions sit nearer the window border. */
  const shellHorizontalPadding =
    layoutMode === "embedded"
      ? "pl-2 pr-1.5"
      : "pl-4 pr-2";
  const isTabsPrimaryLayout = layoutMode === "inset" && Boolean(header);

  const groups: HeaderActionGroup[] = [];
  if (preSearchAddon) {
    groups.push({ id: "presence", label: "Collaboration", priority: 10, placement: "leading", content: preSearchAddon });
  }
  if (projectInviteContext) {
    if (projectInviteContext.projectId) {
      groups.push({ id: "changes", label: "Changes", priority: 80,
        content: <HeaderProjectChangesButton projectId={projectInviteContext.projectId} /> });
    }
    if (editorProjectPath) {
      groups.push({ id: "editor", label: "Open in editor", priority: 30,
        content: <WorkbenchHeaderEditorControl workspaceId={editorProjectPath} /> });
    }
    if (!hideShare) {
      groups.push({ id: "share", label: "Share project", priority: 20,
        content: <Suspense fallback={<HeaderShareButtonFallback />}>
          <LazyHeaderProjectShareButton projectId={projectInviteContext.projectId} projectName={projectInviteContext.projectName} />
        </Suspense> });
    }
  }
  if (rightAddon) {
    groups.push({ id: "page", label: "Page actions", priority: 100, content: rightAddon });
  }

  /*
   * PRODUCT TOUR DEBUG. TEMPORARY, REMOVE BEFORE RELEASE.
   * Replays the first run tutorial on demand so it can be reviewed without
   * wiping app data. Priority 120 keeps it above the overflow cut while
   * testing. Delete this block, the import above, and
   * features/tour/ProductTourDebugTrigger.tsx together.
   */
  groups.push({
    id: "product-tour-debug",
    label: "Run tutorial",
    priority: 120,
    content: <ProductTourDebugTrigger />,
  });

  return (
    <div className={cn(headerLayoutClassName, "h-10 flex min-w-0 items-center titlebar-drag-region", shellHorizontalPadding, className)}>
      <ResponsiveHeaderRow
        leading={<ProjectShellTitleBarLeft />}
        title={isTabsPrimaryLayout ? undefined : header}
        center={centerAddon ?? (isTabsPrimaryLayout ? header : undefined)}
        groups={groups}
        style={headerContentStyle}
        trailingWidth={shouldShowWindowsCaptionSpacer ? windowsCaptionSpacerWidth : 0}
        compact={compactHeaderActions}
      />
    </div>
  );
}
