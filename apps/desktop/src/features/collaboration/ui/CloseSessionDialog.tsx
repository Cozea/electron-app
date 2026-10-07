import { useState } from "react"
import { useTranslation } from "@/lib/i18n"
import type { ProjectdCloseChoice, ProjectdClosePreflight } from "@cozea/projectd-protocol"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { UnifiedModal } from "@/components/ui/unified-modal"

interface CloseSessionDialogProps {
  review: ProjectdClosePreflight
  busy: boolean
  onCancel: () => void
  onConfirm: (choice: ProjectdCloseChoice) => void
}

export function CloseSessionDialog({ review, busy, onCancel, onConfirm }: CloseSessionDialogProps) {
  const { t } = useTranslation()
  const [allowUnpublishedGit, setAllowUnpublishedGit] = useState(true)
  const [allowUnresolvedConflicts, setAllowUnresolvedConflicts] = useState(true)
  const conflictCount = Object.values(review.conflicts).reduce((sum, count) => sum + count, 0)
  return (
    <UnifiedModal
      open
      onOpenChange={(open) => { if (!open) onCancel() }}
      title={t("collab.closeCollaborationForEveryone")}
      size="sm"
      dismissable={!busy}
      footer={
        <>
          <Button variant="outline" disabled={busy} onClick={onCancel}>{t("collab.cancel")}</Button>
          <Button variant="destructive" disabled={busy || (review.gitLag && !allowUnpublishedGit) || (conflictCount > 0 && !allowUnresolvedConflicts)}
            onClick={() => onConfirm({ reviewId: review.reviewId, allowUnpublishedGit, allowUnresolvedConflicts })}>
            {busy ? "Closing…" : "Close collaboration"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">{t("collab.theReviewedSessionIsRetainedIn")}</p>
        <div className="space-y-4 text-sm">
          <p>{review.gitLag ? "Some session changes have not been saved to Git." : "Git includes all reviewed session changes."}</p>
          <p>{conflictCount ? `${conflictCount} unresolved conflicts remain.` : "No unresolved session conflicts were detected."}</p>
          <p>{review.merge ? (review.merge.ahead === 0
            ? `The reviewed checkpoint is already included in ${review.merge.targetBranch}.`
            : `${review.merge.ahead} commits are not in ${review.merge.targetBranch}. ${review.merge.clean ? "The merge preview is clean." : "The merge preview has conflicts."}`)
            : review.mergeUnavailable}</p>
          {review.gitLag && <label className="flex items-start gap-2">
            <Checkbox checked={allowUnpublishedGit} disabled={busy} onCheckedChange={(value) => setAllowUnpublishedGit(value === true)} />
            {t("collab.closeWithUnpublishedChangesRetainedIn")}
          </label>}
          {conflictCount > 0 && <label className="flex items-start gap-2">
            <Checkbox checked={allowUnresolvedConflicts} disabled={busy} onCheckedChange={(value) => setAllowUnresolvedConflicts(value === true)} />
            {t("collab.closeWithTheseUnresolvedConflictsRetained")}
          </label>}
        </div>
      </div>
    </UnifiedModal>
  )
}
