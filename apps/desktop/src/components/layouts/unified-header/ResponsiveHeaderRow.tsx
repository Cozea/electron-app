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

/** A stable portal target preserves React state and subscriptions across overflow moves. */
function HeaderGroup({ group, hidden, destination, register, dismiss, overflowTrigger }: HeaderGroupProps) {
  const slot = useRef<HTMLDivElement>(null)
  const [host] = useState(() => {
    const element = document.createElement("div")
    element.className = "responsive-header-group"
    element.dataset.headerGroup = group.id
    return element
  })
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
  useLayoutEffect(() => () => host.remove(), [host])
  return <>
    <div ref={slot} className="responsive-header-slot" data-overflowed={hidden || undefined} />
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
    const measure = () => {
      frame = 0
      const state = current.current
      // Keep the open popover's contents and its trigger stable while it is being used.
      if (state.open || element.clientWidth === 0) return
      const css = getComputedStyle(element)
      const usable = element.clientWidth - parseFloat(css.paddingLeft) - parseFloat(css.paddingRight)
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
    scheduleRef.current = schedule
    const observer = new ResizeObserver(schedule)
    observerRef.current = observer
    observer.observe(element)
    if (leadingRef.current) observer.observe(leadingRef.current)
    for (const host of hosts.current.values()) observer.observe(host)
    element.addEventListener("focusout", schedule, true)
    // Padding transitions do not change a border box; content-box observation does.
    measure()
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      observerRef.current = null
      scheduleRef.current = () => {}
      element.removeEventListener("focusout", schedule, true)
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
