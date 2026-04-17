import { type ReactNode, useMemo } from "react";
import { useShallow } from "zustand/react/shallow";

import type { Id } from "../../../../convex/_generated/dataModel";
import { ProjectShellTitleBarCenterFromLabel } from "@/features/projects/components/ProjectShellTitleBarCenterFromLabel";
import { ProjectShellTitleBarLeft } from "@/features/projects/components/ProjectShellTitleBarLeft";
import { resolveSettingsSurfaceFromRoute } from "@/lib/settings/settingsRegistry";
import { useProjectHeaderStore } from "@/stores/useProjectHeaderStore";

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
  pathname,
  workspaceScoped,
  presencePreSearchAddon,
  projectId,
  projectName,
  editorProjectPath,
}: UseProjectChromeHeaderArgs) {
  const { headerFromPage, centerFromPage, insetLeft, insetRight } = useProjectHeaderStore(
    useShallow((state) => ({
      headerFromPage: state.header,
      centerFromPage: state.centerAddon,
      insetLeft: state.insetLeft,
      insetRight: state.insetRight,
    })),
  );

  const settingsTitle = useMemo(() => {
    if (!isSettingsModeRoute) return null;
    const unprefixedPath = pathname.startsWith("/projects/")
      ? `/${pathname.slice("/projects/".length)}`
      : pathname;
    const surface = resolveSettingsSurfaceFromRoute(unprefixedPath);
    if (surface) return surface.surface.label;
    return workspaceScoped ? "Workspace Settings" : "Settings";
  }, [isSettingsModeRoute, pathname, workspaceScoped]);

  return useMemo(() => {
    const headerResolved = headerFromPage ?? <ProjectShellTitleBarLeft />;

    const centerAddon =
      isSettingsModeRoute && settingsTitle ? (
        <ProjectShellTitleBarCenterFromLabel label={settingsTitle} />
      ) : (
        (centerFromPage ?? undefined)
      );

    return {
      header: headerResolved,
      centerAddon,
      preSearchAddon: isSettingsModeRoute ? undefined : (presencePreSearchAddon ?? undefined),
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
    editorProjectPath,
    headerFromPage,
    insetLeft,
    insetRight,
    isSettingsModeRoute,
    presencePreSearchAddon,
    projectId,
    projectName,
    settingsTitle,
  ]);
}
