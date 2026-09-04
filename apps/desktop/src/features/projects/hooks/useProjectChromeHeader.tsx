import { type ReactNode, useMemo } from "react";
import { useShallow } from "zustand/react/shallow";

import type { Id } from "../../../../../../convex/_generated/dataModel";
import { ProjectShellTitleBarLeft } from "@/features/projects/ui/ProjectShellTitleBarLeft";
import { useProjectHeaderStore } from "@/features/projects/model/projectHeaderStore";

interface UseProjectChromeHeaderArgs {
  isSettingsModeRoute: boolean;
  pathname: string;
  workspaceScoped: boolean;
  presencePreSearchAddon: ReactNode | null;
  /** Route project (or last workbench fallback from layout) for changes/share/inbox strip */
  projectId: Id<"projects"> | null;
  projectName: string | null;
  /** Local path for Open-in-editor; same source the workbench uses */
  editorProjectPath: string | null;
}

/**
 * Feeds the single `UnifiedHeader` from the same sources as the workbench:
 * - Left: `ProjectShellTitleBarLeft` (sidebar toggle) whenever the page did not call `useProjectHeader` (settings, /projects hub, …)
 * - Center: page `centerAddon` from the store, or settings title in the workbench center shell
 */
export function useProjectChromeHeader({
  isSettingsModeRoute,
  pathname: _pathname,
  workspaceScoped: _workspaceScoped,
  presencePreSearchAddon,
  projectId,
  projectName,
  editorProjectPath,
}: UseProjectChromeHeaderArgs) {
  const { headerFromPage, centerFromPage, rightFromPage, hideShare, insetLeft, insetRight } =
    useProjectHeaderStore(
      useShallow((state) => ({
        headerFromPage: state.header,
        centerFromPage: state.centerAddon,
        rightFromPage: state.rightAddon,
        hideShare: state.hideShare,
        insetLeft: state.insetLeft,
        insetRight: state.insetRight,
      })),
    );

  return useMemo(() => {
    const headerResolved = headerFromPage ?? <ProjectShellTitleBarLeft />;
    const centerAddon = isSettingsModeRoute ? undefined : (centerFromPage ?? undefined);

    return {
      header: headerResolved,
      centerAddon,
      preSearchAddon: isSettingsModeRoute ? undefined : (presencePreSearchAddon ?? undefined),
      rightAddon: isSettingsModeRoute ? undefined : (rightFromPage ?? undefined),
      hideShare,
      contentInsetLeft: insetLeft,
      contentInsetRight: insetRight,
      projectInviteContext: {
        projectId,
        projectName,
      },
      editorProjectPath,
    };
  }, [
    centerFromPage,
    rightFromPage,
    hideShare,
    editorProjectPath,
    headerFromPage,
    insetLeft,
    insetRight,
    isSettingsModeRoute,
    presencePreSearchAddon,
    projectId,
    projectName,
  ]);
}
