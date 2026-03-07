import * as React from "react"

import { useWindowChrome } from "@/hooks/useWindowChrome"
import { cn } from "@/lib/utils"

interface WindowChromeTopInsetProps extends React.HTMLAttributes<HTMLDivElement> {}

export function WindowChromeTopInset({
  className,
  style,
  ...props
}: WindowChromeTopInsetProps) {
  const windowChrome = useWindowChrome()

  if (!windowChrome.isMac) return null

  return (
    <div
      aria-hidden="true"
      className={cn(
        "titlebar-drag-region shrink-0 transition-[height,opacity] duration-200 ease-out",
        className
      )}
      style={{
        height: windowChrome.topInset,
        opacity: windowChrome.showMacWindowControls ? 1 : 0,
        ...style,
      }}
      {...props}
    />
  )
}
