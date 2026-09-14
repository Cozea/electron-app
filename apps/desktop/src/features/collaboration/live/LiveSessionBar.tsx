/**
 * The bar under the project header: points to another of this device's live sessions
 * if the user has a live session on another branch.
 *
 * (Active sessions on the current branch are rendered directly in the UnifiedHeader
 * via HeaderLiveSessionControl to preserve vertical space and unify presence).
 *
 * Master Specification: Section 5.3, 23.2
 */

import { SessionBranchNotice } from "./SessionWorkbenchControls"
import type { LiveSessionController } from "./useLiveSession"

export function LiveSessionBar({ live }: { live: LiveSessionController }) {
  // If this branch is the active live session, it is already rendered in the UnifiedHeader.
  if (live.session && live.sync) {
    return null
  }

  const other = live.otherSessions[0]
  if (!other) return null

  return (
    <SessionBranchNotice
      branchName={other.branchName}
      busy={live.busyAction === "switch"}
      onSwitch={() => live.openSessionWorkbench(other.publicSessionId)}
    />
  )
}
