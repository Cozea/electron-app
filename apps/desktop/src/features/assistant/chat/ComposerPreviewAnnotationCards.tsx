import type { PreviewAnnotationPayload } from "@cozea/contracts/t3/ipc"

import { Button } from "@/components/ui/button"
import {
  formatElementContextLabel,
  normalizeElementContextSelection,
} from "@/features/projects/browser/elementContext"
import { cn } from "@/lib/utils"

import type { ComposerImageDraft } from "./CozeaChatSurface"

export function ComposerPreviewAnnotationCards(props: {
  readonly annotations: ReadonlyArray<PreviewAnnotationPayload>
  readonly images: ReadonlyArray<ComposerImageDraft>
  readonly onRemove: (annotationId: string) => void
  readonly onExpandImage: (imageId: string) => void
  readonly className?: string
}) {
  if (props.annotations.length === 0) return null
  const imagesById = new Map(props.images.map((image) => [image.id, image]))
  return (
    <div className={cn("flex flex-wrap gap-1.5", props.className)}>
      {props.annotations.map((annotation) => {
        const image = imagesById.get(annotation.id)
        const labels = annotation.elements.flatMap((target) => {
          const context = normalizeElementContextSelection(target.element)
          return context ? [formatElementContextLabel(context)] : []
        })
        return (
          <section
            key={annotation.id}
            className="group/preview-annotation relative flex min-w-0 max-w-full items-center overflow-hidden rounded-lg border border-border/80 bg-background/72"
          >
            {image ? (
              <button
                type="button"
                aria-label={`Preview ${image.name}`}
                className="size-14 shrink-0 cursor-zoom-in overflow-hidden border-r border-border/70 bg-muted"
                onClick={() => props.onExpandImage(image.id)}
              >
                <img
                  src={image.previewUrl}
                  alt="Annotated preview crop"
                  className="size-full object-cover"
                />
              </button>
            ) : (
              <span className="grid size-10 shrink-0 place-items-center border-r border-border/70 text-primary">
                ⌁
              </span>
            )}
            <div className="min-w-0 px-2.5 py-2 pr-8">
              {annotation.comment.trim() ? (
                <p className="max-w-80 truncate text-xs font-medium text-foreground">
                  {annotation.comment.trim()}
                </p>
              ) : null}
              <div
                className={cn(
                  "flex min-w-0 items-center gap-2 text-[10px] text-muted-foreground",
                  annotation.comment.trim() && "mt-1",
                )}
              >
                {labels.length > 0 ? (
                  <span className="max-w-40 truncate font-mono">
                    {labels.slice(0, 2).join(" ")}
                    {labels.length > 2 ? ` +${labels.length - 2}` : ""}
                  </span>
                ) : null}
                {annotation.elements.length > 0 ? (
                  <span>
                    {annotation.elements.length} element
                    {annotation.elements.length === 1 ? "" : "s"}
                  </span>
                ) : null}
                {annotation.regions.length > 0 ? (
                  <span>
                    {annotation.regions.length} region{annotation.regions.length === 1 ? "" : "s"}
                  </span>
                ) : null}
                {annotation.strokes.length > 0 ? (
                  <span>
                    {annotation.strokes.length} drawing{annotation.strokes.length === 1 ? "" : "s"}
                  </span>
                ) : null}
                {annotation.styleChanges.length > 0 ? (
                  <span>
                    {annotation.styleChanges.length} style change
                    {annotation.styleChanges.length === 1 ? "" : "s"}
                  </span>
                ) : null}
              </div>
            </div>
            <Button
              type="button"
              size="icon-xs"
              variant="ghost"
              aria-label="Remove preview annotation"
              className="absolute right-1 top-1 size-5"
              onClick={() => props.onRemove(annotation.id)}
            >
              ×
            </Button>
          </section>
        )
      })}
    </div>
  )
}
