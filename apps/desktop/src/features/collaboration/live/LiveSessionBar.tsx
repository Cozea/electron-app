/**
 * The bar under the project header: the live session for the active Session
 * Workbench, or a pointer to another of this device's live sessions.
 *
 * Master Specification: Section 5.3, 23.2
 * Phase: P23
 */

import { useState } from "react"

import { MergeSessionDialog } from "../ui/MergeSessionDialog"
import { RebaseSessionDialog } from "../ui/RebaseSessionDialog"
import { CloseSessionDialog } from "../ui/CloseSessionDialog"
import { BinaryConflictDialog } from "../ui/BinaryConflictDialog"
import { StructuralConflictDialog } from "../ui/StructuralConflictDialog"
import { SessionBranchNotice, SessionWorkbenchControls } from "./SessionWorkbenchControls"
import type { LiveSessionController } from "./useLiveSession"

export function LiveSessionBar({ live }: { live: LiveSessionController }) {
  const [merging, setMerging] = useState(false)
  const [rebasing, setRebasing] = useState(false)
  const [reviewingFiles, setReviewingFiles] = useState(false)
  const [reviewingPaths, setReviewingPaths] = useState(false)
  if (live.session && live.sync) {
    return (
      <>
        <SessionWorkbenchControls
        branchName={live.session.branchName}
        targetBranch={live.session.targetBranch}
        lifecycle={live.session.lifecycle}
        sync={live.sync}
        autoGit={live.autoGit}
        members={live.members}
        membership={live.membership}
        canManage={live.canManage}
        canEdit={live.canEdit}
        target={live.target}
        busyAction={live.busyAction}
        onSaveNow={live.saveNow}
        onIgnoreEnvironmentFiles={live.ignoreEnvironmentFiles}
        onCheckTarget={live.checkTarget}
        onDismissTarget={live.dismissTarget}
        onRebase={() => setRebasing(true)}
        onBinaryConflicts={() => setReviewingFiles(true)}
        onStructuralConflicts={() => setReviewingPaths(true)}
        onMerge={() => setMerging(true)}
        onJoin={live.join}
        onLeave={live.leave}
        onPause={live.pause}
        onResume={live.resume}
        onEnd={live.end}
      />
        {reviewingFiles && <BinaryConflictDialog key={live.session.publicSessionId} publicSessionId={live.session.publicSessionId}
          canEdit={live.canEdit} onClose={() => setReviewingFiles(false)} />}
        {reviewingPaths && <StructuralConflictDialog key={live.session.publicSessionId} publicSessionId={live.session.publicSessionId}
          canEdit={live.canEdit} onClose={() => setReviewingPaths(false)} />}
        <RebaseSessionDialog
          isOpen={rebasing}
          onOpenChange={setRebasing}
          publicSessionId={live.session.publicSessionId}
          branchName={live.session.branchName}
          targetBranch={live.session.targetBranch}
        />
        {live.closeReview && <CloseSessionDialog key={live.closeReview.reviewId} review={live.closeReview}
          busy={live.busyAction === "end"} onCancel={live.cancelClose} onConfirm={live.confirmClose} />}
        <MergeSessionDialog
          isOpen={merging}
          onOpenChange={setMerging}
          publicSessionId={live.session.publicSessionId}
          branchName={live.session.branchName}
          targetBranch={live.session.targetBranch}
          canManage={live.canManage}
          onPause={live.pause}
          onEnd={() => { setMerging(false); live.end() }}
        />
      </>
    )
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
