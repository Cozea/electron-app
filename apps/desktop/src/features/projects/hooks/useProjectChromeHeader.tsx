import { type ReactNode, useMemo } from "react";
import { useShallow } from "zustand/react/shallow";

import type { Id } from "../../../../../../convex/_generated/dataModel";
import { useProjectHeaderStore } from "@/lib/projectHeaderStore";
import type { LiveSessionMember } from "@/features/collaboration/live/liveSessionModel";
import type { LiveSessionContext, LiveSessionRecord } from "@/features/collaboration/live/useLiveSession";
import { WorkbenchHeaderTitle } from "@/features/workbench/WorkbenchHeaderTitle";

interface UseProjectChromeHeaderArgs {
  isSettingsModeRoute: boolean;
  isWorkbenchView: boolean;
  presencePreSearchAddon: ReactNode | null;
  liveSessionControl?: ReactNode | null;
  liveSessionMembers?: LiveSessionMember[];
  liveSession?: LiveSessionContext | null;
  /** All non-hidden project sessions; lets the share slot show a session nobody has joined. */
  sessions?: readonly LiveSessionRecord[];
  /** Branch the folder has checked out; the session slot prefers its session. */
  activeBranch?: string | null;
  /** Current route project for the changes/share/inbox strip. */
  projectId: Id<"projects"> | null;
  projectName: string | null;
  /** Local path for Open-in-editor; same source the workbench uses */
  editorProjectPath: string | null;
  /** Principal IDs of users actively online in this project */
  onlinePrincipalIds?: Set<string>;
}

/**
 * Feeds the single `UnifiedHeader` from the route's published state:
 * - Left: page `header` from the store (sidebar toggle is rendered permanently by `UnifiedHeader`)
 * - Center: page `centerAddon` from the store, or settings title in the workbench center shell
 */
export function useProjectChromeHeader({
  isSettingsModeRoute,
  isWorkbenchView,
  presencePreSearchAddon,
  liveSessionControl,
  liveSessionMembers,
  liveSession,
  sessions,
  activeBranch,
  projectId,
  projectName,
  editorProjectPath,
  onlinePrincipalIds,
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
    const hasActiveLiveSession = Boolean(
      liveSessionMembers && liveSessionMembers.some((m) => m.status === "active")
    );
    const defaultWorkbenchHeader = isWorkbenchView && projectName ? (
      <WorkbenchHeaderTitle
        projectName={projectName}
        hasActiveLiveSession={hasActiveLiveSession}
        hasProjectRecord={Boolean(projectId)}
      />
    ) : undefined;
    const headerResolved = headerFromPage ?? defaultWorkbenchHeader;
    const centerAddon = isSettingsModeRoute ? undefined : (centerFromPage ?? undefined);

    return {
      header: headerResolved,
      centerAddon,
      preSearchAddon: isSettingsModeRoute ? undefined : (presencePreSearchAddon ?? undefined),
      liveSessionControl: isSettingsModeRoute ? undefined : (liveSessionControl ?? undefined),
      liveSessionMembers: isSettingsModeRoute ? undefined : liveSessionMembers,
      liveSession: isSettingsModeRoute ? undefined : (liveSession ?? undefined),
      sessions: isSettingsModeRoute ? undefined : sessions,
      activeBranch: isSettingsModeRoute ? undefined : (activeBranch ?? null),
      onlinePrincipalIds: isSettingsModeRoute ? undefined : onlinePrincipalIds,
      rightAddon: rightFromPage ?? undefined,
      hideShare: hideShare || isSettingsModeRoute || !isWorkbenchView || !projectId,
      contentInsetLeft: insetLeft,
      contentInsetRight: insetRight,
      projectInviteContext: isSettingsModeRoute ? undefined : {
        projectId,
        projectName,
      },
      editorProjectPath: isSettingsModeRoute ? null : editorProjectPath,
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
    isWorkbenchView,
    presencePreSearchAddon,
    liveSessionControl,
    liveSessionMembers,
    liveSession,
    sessions,
    activeBranch,
    onlinePrincipalIds,
    projectId,
    projectName,
  ]);
}
