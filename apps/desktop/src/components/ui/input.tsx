import * as React from "react"

import { cn } from "@/lib/utils"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "file:text-foreground placeholder:text-muted-foreground/72 selection:bg-primary selection:text-primary-foreground h-9 w-full min-w-0 rounded-lg border border-input bg-popover not-dark:bg-clip-padding px-[calc(--spacing(3)-1px)] py-1 text-sm text-foreground shadow-xs/5 ring-ring/24 transition-shadow outline-none sm:h-8 dark:bg-input/32 file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium autofill:bg-foreground/4 dark:autofill:bg-foreground/8 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-64 disabled:shadow-none",
        "focus-visible:border-ring focus-visible:ring-[3px] focus-visible:shadow-none",
        "aria-invalid:border-destructive/36 aria-invalid:shadow-none focus-visible:aria-invalid:border-destructive/64 focus-visible:aria-invalid:ring-destructive/16 dark:aria-invalid:ring-destructive/24",
        className
      )}
      {...props}
    />
  )
}

export { Input }
