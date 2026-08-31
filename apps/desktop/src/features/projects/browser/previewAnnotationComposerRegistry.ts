import type { PreviewAnnotationPayload, PreviewAnnotationSubmission } from "@cozea/contracts/t3/ipc"

interface PreviewAnnotationComposerTarget {
  readonly id: string
  readonly workbenchSessionKey: string
  readonly active: () => boolean
  readonly attach: (
    annotation: PreviewAnnotationPayload,
    submission: PreviewAnnotationSubmission,
  ) => Promise<void>
}

const targets = new Map<string, PreviewAnnotationComposerTarget>()

export function registerPreviewAnnotationComposerTarget(
  target: PreviewAnnotationComposerTarget,
): () => void {
  targets.set(target.id, target)
  return () => {
    if (targets.get(target.id) === target) targets.delete(target.id)
  }
}

export async function attachPreviewAnnotationToComposer(
  workbenchSessionKey: string,
  annotation: PreviewAnnotationPayload,
  submission: PreviewAnnotationSubmission,
): Promise<boolean> {
  const eligible = Array.from(targets.values()).filter(
    (target) => target.workbenchSessionKey === workbenchSessionKey,
  )
  const target = eligible.find((candidate) => candidate.active()) ?? eligible[0]
  if (!target) return false
  await target.attach(annotation, submission)
  return true
}
