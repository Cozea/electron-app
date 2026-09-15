import React, { useRef, useState, useCallback, useEffect, type ReactNode } from "react"
import { cn } from "@/lib/utils"

export interface GlideMenuProps extends React.HTMLAttributes<HTMLDivElement> {
  rowSelector?: string
  highlightClassName?: string
  children: ReactNode
}

/**
 * GlideMenu: Single fluid background pill that glides continuously across rows.
 * Hardware-accelerated with translate3d and Apple-grade deceleration curve.
 */
export function GlideMenu({
  rowSelector = "[data-row]",
  highlightClassName = "rounded-md bg-[var(--sidebar-pill-hover-bg)]",
  className,
  children,
  ...props
}: GlideMenuProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const pillRef = useRef<HTMLDivElement | null>(null)
  const [hasHover, setHasHover] = useState(false)
  const activeRowRef = useRef<HTMLElement | null>(null)

  const updatePillPosition = useCallback(
    (targetRow: HTMLElement, animate = true) => {
      const container = containerRef.current
      const pill = pillRef.current
      if (!container || !pill) return

      const containerRect = container.getBoundingClientRect()
      const rowRect = targetRow.getBoundingClientRect()

      const top = rowRect.top - containerRect.top
      const left = rowRect.left - containerRect.left
      const width = rowRect.width
      const height = rowRect.height

      if (!animate) {
        pill.style.transition = "none"
      } else {
        pill.style.transition = ""
      }

      pill.style.transform = `translate3d(${left}px, ${top}px, 0)`
      pill.style.width = `${width}px`
      pill.style.height = `${height}px`

      if (!animate) {
        void pill.offsetHeight
        pill.style.transition = ""
      }
    },
    [],
  )

  useEffect(() => {
    if (!containerRef.current) return
    const ro = new ResizeObserver(() => {
      if (activeRowRef.current) {
        updatePillPosition(activeRowRef.current, false)
      }
    })
    ro.observe(containerRef.current)

    const handleScroll = () => {
      if (activeRowRef.current) {
        updatePillPosition(activeRowRef.current, false)
      }
    }
    window.addEventListener("scroll", handleScroll, { capture: true, passive: true })

    return () => {
      ro.disconnect()
      window.removeEventListener("scroll", handleScroll, { capture: true })
    }
  }, [updatePillPosition])

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.pointerType === "touch") return
      const target = (event.target as HTMLElement | null)?.closest<HTMLElement>(rowSelector)
      if (!target || !containerRef.current?.contains(target)) {
        return
      }

      if (activeRowRef.current !== target) {
        const isFirstHover = !hasHover
        activeRowRef.current = target
        setHasHover(true)
        updatePillPosition(target, !isFirstHover)
      }
    },
    [hasHover, rowSelector, updatePillPosition],
  )

  const handlePointerLeave = useCallback(() => {
    activeRowRef.current = null
    setHasHover(false)
  }, [])

  return (
    <div
      ref={containerRef}
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
      className={cn("group/glide relative", className)}
      {...props}
    >
      <div
        ref={pillRef}
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute left-0 top-0 z-0 will-change-transform",
          "transition-[transform,width,height,opacity] duration-150 ease-[cubic-bezier(0.16,1,0.3,1)]",
          hasHover ? "opacity-100" : "opacity-0",
          highlightClassName,
        )}
      />
      {children}
    </div>
  )
}

export default GlideMenu
