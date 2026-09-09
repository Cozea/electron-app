import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react"
import { createPortal } from "react-dom"

import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"
import { SIDEBAR_TRANSITION_CLASS_NAME } from "@/components/ui/sidebar"
import { resolveHeaderOverflow } from "./headerOverflow"
import { HeaderOverflowContext } from "./HeaderOverflowContext"
import "./responsiveHeader.css"

export interface HeaderActionGroup {
  id: string
  label: string
  priority: number
  content: ReactNode
  placement?: "leading" | "trailing"
}

interface ResponsiveHeaderRowProps {
  leading: ReactNode
  title?: ReactNode
  center?: ReactNode
  groups: readonly HeaderActionGroup[]
  style?: CSSProperties
  trailingWidth?: number
  compact?: boolean
}

interface HeaderGroupProps {
  group: HeaderActionGroup
  hidden: boolean
  destination: HTMLElement | null
  register: (id: string, element: HTMLElement | null) => void
  dismiss: () => void
  overflowTrigger: HTMLButtonElement | null
}

const HEADER_GROUP_MOTION_MS = 160
const HEADER_GROUP_EASING = "cubic-bezier(0.22, 1, 0.36, 1)"

function prefersReducedMotion() {
  return typeof window !== "undefined"
    && typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches
}

/**
 * Animate a slot between widths.
 *
 * `from` is read off the live box rather than assumed, so reversing mid-flight
 * continues from where the slot actually is instead of snapping to its natural
 * width first. The host inside is `width: max-content`, so clamping the slot
 * never changes the width the overflow pass measures.
 */
function animateSlotWidth(element: HTMLElement, from: number, to: number) {
  element.dataset.collapsing = "true"
  return element.animate(
    [
      { maxWidth: `${from}px`, marginLeft: from === 0 ? "0px" : "6px", opacity: from === 0 ? 0 : 1 },
      { maxWidth: `${to}px`, marginLeft: to === 0 ? "0px" : "6px", opacity: to === 0 ? 0 : 1 },
    ],
    { duration: HEADER_GROUP_MOTION_MS, easing: HEADER_GROUP_EASING, fill: "forwards" },
  )
}

/** A stable portal target preserves React state and subscriptions across overflow moves. */
function HeaderGroup({ group, hidden, destination, register, dismiss, overflowTrigger }: HeaderGroupProps) {
  const slot = useRef<HTMLDivElement>(null)
  const [host] = useState(() => {
    const element = document.createElement("div")
    element.className = "responsive-header-group"
    element.dataset.headerGroup = group.id
    return element
  })
  // `settled` trails `hidden` by the collapse. The slot leaves the flow only
  // once it has finished shrinking, so the row closes the gap across the
  // animation instead of in one frame -- which is also what stops the title
  // regaining its space in a single jump.
  const [settled, setSettled] = useState(hidden)
  const settledRef = useRef(settled)
  settledRef.current = settled
  const motion = useRef<Animation | null>(null)
  const previousHidden = useRef(hidden)
  const pendingExpand = useRef(false)

  useLayoutEffect(() => {
    register(group.id, host)
    return () => register(group.id, null)
  }, [group.id, host, register])
  useLayoutEffect(() => {
    const target = hidden && destination ? destination : slot.current
    if (target && host.parentElement !== target) target.append(host)
    host.inert = hidden && !destination
    host.setAttribute("aria-hidden", String(hidden && !destination))
  }, [destination, hidden, host])

  useLayoutEffect(() => {
    if (previousHidden.current === hidden) return
    previousHidden.current = hidden
    const element = slot.current
    // Moving into an open popover is a change of container, not a collapse.
    if (!element || destination || prefersReducedMotion()) {
      motion.current?.cancel()
      motion.current = null
      setSettled(hidden)
      return
    }
    // Read before cancelling: cancelling drops the filled end state and snaps
    // the slot back to its natural width.
    const currentWidth = element.getBoundingClientRect().width
    motion.current?.cancel()
    if (hidden) {
      const animation = animateSlotWidth(element, currentWidth, 0)
      motion.current = animation
      animation.finished.then(() => setSettled(true)).catch(() => {})
      return
    }
    if (settledRef.current) {
      // Out of the flow: rejoin first, expand once the attribute has cleared.
      pendingExpand.current = true
      setSettled(false)
      return
    }
    // Reversing a collapse that never finished; the slot is still in the flow.
    const animation = animateSlotWidth(element, currentWidth, host.getBoundingClientRect().width)
    motion.current = animation
    animation.finished.then(() => { delete element.dataset.collapsing; motion.current = null }).catch(() => {})
  }, [destination, hidden, host])

  useLayoutEffect(() => {
    const element = slot.current
    if (!element) return
    if (settled) {
      // Absolute and hidden now, so the filled end state has nothing to hold.
      motion.current?.cancel()
      motion.current = null
      delete element.dataset.collapsing
      return
    }
    if (!pendingExpand.current) return
    pendingExpand.current = false
    motion.current?.cancel()
    const animation = animateSlotWidth(element, 0, host.getBoundingClientRect().width)
    motion.current = animation
    animation.finished.then(() => { delete element.dataset.collapsing; motion.current = null }).catch(() => {})
  }, [host, settled])

  useLayoutEffect(() => () => { motion.current?.cancel(); host.remove() }, [host])
  return <>
    <div ref={slot} className="responsive-header-slot" data-overflowed={settled || undefined} />
    {createPortal(<HeaderOverflowContext value={{ dismiss, returnFocus: () => hidden ? overflowTrigger ?? undefined : true }}>
      {group.content}
    </HeaderOverflowContext>, host)}
  </>
}

export function ResponsiveHeaderRow({ leading, title, center, groups, style, trailingWidth = 0, compact = true }: ResponsiveHeaderRowProps) {
  const row = useRef<HTMLDivElement>(null)
  const leadingRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const [hidden, setHidden] = useState<Set<string>>(() => new Set())
  const [open, setOpen] = useState(false)
  const [popup, setPopup] = useState<HTMLDivElement | null>(null)
  const openingDialog = useRef(false)
  const [dismiss] = useState(() => () => {
    openingDialog.current = true
    setOpen(false)
  })
  const hosts = useRef(new Map<string, HTMLElement>())
  const scheduleRef = useRef(() => {})
  const observerRef = useRef<ResizeObserver | null>(null)
  const current = useRef({ groups, hidden, open, trailingWidth, title })
  current.current = { groups, hidden, open, trailingWidth, title }
  const [register] = useState(() => (id: string, element: HTMLElement | null) => {
    const previous = hosts.current.get(id)
    if (previous) observerRef.current?.unobserve(previous)
    if (element) {
      hosts.current.set(id, element)
      observerRef.current?.observe(element)
    } else hosts.current.delete(id)
    scheduleRef.current()
  })

  useLayoutEffect(() => {
    const element = row.current
    if (!element) return
    let frame = 0
    // The row's content box, straight off the observer. Reading it back with
    // getComputedStyle every frame forced a style recalc for a value the
    // observer already delivered -- and the sidebar's 300ms padding transition
    // changes this while `clientWidth` stays put, so it cannot simply be cached.
    let contentWidth: number | null = null
    let force = true
    let lastUsable = Number.NaN
    const measure = () => {
      frame = 0
      const state = current.current
      // Keep the open popover's contents and its trigger stable while it is being used.
      if (state.open || element.clientWidth === 0) return
      let usable = contentWidth
      if (usable === null) {
        const css = getComputedStyle(element)
        usable = element.clientWidth - parseFloat(css.paddingLeft) - parseFloat(css.paddingRight)
      }
      // Nothing that feeds the decision moved, so the rect reads below would
      // return exactly what they returned last frame.
      if (!force && usable === lastUsable) return
      force = false
      lastUsable = usable
      const leadingWidth = leadingRef.current?.getBoundingClientRect().width ?? 0
      // Text can flex down to this budget before secondary actions leave the row.
      const titleWidth = state.title ? 144 : 0
      const items = state.groups.map((group) => {
        const host = hosts.current.get(group.id)
        return {
          id: group.id,
          priority: group.priority,
          width: host?.getBoundingClientRect().width ?? 0,
          pinned: Boolean(host?.contains(document.activeElement)),
        }
      })
      const next = resolveHeaderOverflow(items, usable - leadingWidth - titleWidth - state.trailingWidth - 12, state.hidden)
      if (next.size !== state.hidden.size || [...next].some((id) => !state.hidden.has(id))) {
        // Keep the focused disclosure in place until focus leaves it.
        if (next.size === 0 && document.activeElement === triggerRef.current) return
        setHidden(next)
      }
    }
    const schedule = () => { if (!frame) frame = requestAnimationFrame(measure) }
    // Every caller outside the observer -- a group registering, focus leaving,
    // a prop change -- moves something the width guard cannot see.
    scheduleRef.current = () => { force = true; schedule() }
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.target === element) {
          contentWidth = entry.contentBoxSize?.[0]?.inlineSize ?? entry.contentRect.width
        } else {
          // The leading region or a group changed its own width; the row's did not.
          force = true
        }
      }
      schedule()
    })
    observerRef.current = observer
    observer.observe(element)
    if (leadingRef.current) observer.observe(leadingRef.current)
    for (const host of hosts.current.values()) observer.observe(host)
    // Focus moving releases a pin, which the width guard cannot observe.
    const onFocusOut = () => { force = true; schedule() }
    element.addEventListener("focusout", onFocusOut, true)
    // Padding transitions do not change a border box; content-box observation does.
    measure()
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      observerRef.current = null
      scheduleRef.current = () => {}
      element.removeEventListener("focusout", onFocusOut, true)
    }
  }, [])
  useLayoutEffect(() => { scheduleRef.current() }, [groups, open, trailingWidth, title])

  const renderGroup = (group: HeaderActionGroup) => <HeaderGroup
    key={group.id}
    group={group}
    hidden={hidden.has(group.id)}
    destination={open ? popup?.querySelector<HTMLElement>(`[data-overflow-destination="${group.id}"]`) ?? null : null}
    register={register}
    dismiss={dismiss}
    overflowTrigger={triggerRef.current}
  />

  return <Popover open={open} onOpenChange={(next) => { openingDialog.current = false; setOpen(next) }}>
    <div ref={row} className={cn("responsive-header-row h-10 transition-[padding]", SIDEBAR_TRANSITION_CLASS_NAME)} style={style}>
      <div ref={leadingRef} className="responsive-header-leading titlebar-no-drag">{leading}</div>
      <div className={cn("responsive-header-title titlebar-no-drag", compact && "shared-header-action-pills")}>{title}</div>
      {groups.filter((group) => group.placement === "leading").map(renderGroup)}
      <div className="responsive-header-center titlebar-no-drag" data-unified-header-center="true">{center}</div>
      <div className="responsive-header-actions titlebar-no-drag" data-unified-header-actions="true">
        {groups.filter((group) => group.placement !== "leading").map(renderGroup)}
        <PopoverTrigger asChild>
          <Button ref={triggerRef} variant="ghost" size="icon" aria-label="More header actions"
            className="responsive-header-overflow h-7 w-7 shrink-0" hidden={hidden.size === 0}>
            <span aria-hidden="true">•••</span>
          </Button>
        </PopoverTrigger>
      </div>
      {trailingWidth > 0 && <div className="shrink-0" aria-hidden="true" style={{ width: trailingWidth }} />}
    </div>
    <PopoverContent ref={setPopup} align="end" finalFocus={() => openingDialog.current ? false : true} aria-label="More header actions" className="responsive-header-popup flex-col gap-3 p-3">
      {groups.filter((group) => hidden.has(group.id)).map((group) => <div key={group.id}>
        <div className="mb-1 text-xs text-muted-foreground">{group.label}</div>
        <div data-overflow-destination={group.id} />
      </div>)}
    </PopoverContent>
  </Popover>
}
