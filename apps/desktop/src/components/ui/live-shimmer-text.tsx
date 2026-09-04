import { memo, type ReactNode } from "react"

import { cn } from "@/lib/utils"

/**
 * Text with a highlight travelling across it, for copy that describes something
 * currently running.
 *
 * The effect is two stacked copies of the same string: a base, and a second one
 * masked to a moving window and drawn over it.
 *
 * The mask only reaches full opacity at a thin peak — most of the band paints at
 * about 55% — so the sweep has to be the *stronger* of the two tones to survive
 * that blend. Pair a faded base with the full-strength colour on top and the
 * band reads clearly; invert it (opaque base, weaker sweep) and the sweep is
 * invisible, which is exactly how the light-mode sidebar lost its shimmer.
 *
 * The nested `focus`/`counter`/`aligned` spans keep the overlay pinned over the
 * base while its mask sweeps — the widths in `index.css` depend on that
 * nesting, so keep all three layers.
 */
export const LiveShimmerText = memo(function LiveShimmerText(props: {
  children: ReactNode
  className?: string
  title?: string
  /** Resting colour; must be the faded one, or the band will not show. */
  baseClassName?: string
  /** Colour of the travelling band; must be stronger than the base. */
  sweepClassName?: string
}) {
  const {
    baseClassName = "text-muted-foreground/75",
    sweepClassName = "text-foreground",
  } = props

  return (
    <span
      className={cn(
        "cozea-live-shimmer relative inline-block max-w-full overflow-hidden",
        props.className,
      )}
      title={props.title}
    >
      <span className={cn("block truncate", baseClassName)}>{props.children}</span>
      <span
        aria-hidden
        className="cozea-live-shimmer-focus pointer-events-none absolute inset-y-0 select-none"
      >
        <span className="cozea-live-shimmer-counter block">
          <span className={cn("cozea-live-shimmer-aligned block truncate", sweepClassName)}>
            {props.children}
          </span>
        </span>
      </span>
    </span>
  )
})
