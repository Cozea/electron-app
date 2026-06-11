import * as React from "react"

import { cn } from "@/lib/utils"

const Textarea = React.forwardRef<HTMLTextAreaElement, React.ComponentProps<"textarea">>(
  ({ className, ...props }, ref) => {
    return (
      <textarea
        ref={ref}
        data-slot="textarea"
        className={cn(
          "placeholder:text-muted-foreground/72 flex field-sizing-content min-h-16 w-full rounded-lg border border-input bg-background not-dark:bg-clip-padding px-[calc(--spacing(3)-1px)] py-2 text-sm text-foreground shadow-xs/5 ring-ring/24 transition-shadow outline-none dark:bg-input/32 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:shadow-none disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-64 disabled:shadow-none",
          "aria-invalid:border-destructive/36 aria-invalid:shadow-none focus-visible:aria-invalid:border-destructive/64 focus-visible:aria-invalid:ring-destructive/16 dark:aria-invalid:ring-destructive/24",
          className
        )}
        {...props}
      />
    )
  }
)
Textarea.displayName = "Textarea"

export { Textarea }
