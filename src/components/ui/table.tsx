import * as React from "react"

import { cn } from "@/lib/utils"

function wrapPlainTableText(children: React.ReactNode): React.ReactNode {
  const childArray = React.Children.toArray(children)
  if (childArray.length !== 1) {
    return children
  }

  const [child] = childArray
  if (typeof child !== "string" && typeof child !== "number") {
    return children
  }

  return <span className="block min-w-0 max-w-full truncate">{child}</span>
}

function Table({ className, ...props }: React.ComponentProps<"table">) {
  return (
    <div
      data-slot="table-container"
      className="app-scrollbar relative w-full overflow-x-auto"
    >
      <table
        data-slot="table"
        className={cn("w-full min-w-full table-fixed caption-bottom text-sm", className)}
        {...props}
      />
    </div>
  )
}

function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return (
    <thead
      data-slot="table-header"
      className={cn("[&_tr]:border-b", className)}
      {...props}
    />
  )
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return (
    <tbody
      data-slot="table-body"
      className={cn("[&_tr:last-child]:border-0", className)}
      {...props}
    />
  )
}

function TableFooter({ className, ...props }: React.ComponentProps<"tfoot">) {
  return (
    <tfoot
      data-slot="table-footer"
      className={cn(
        "bg-muted/50 border-t font-medium [&>tr]:last:border-b-0",
        className
      )}
      {...props}
    />
  )
}

function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        "border-b transition-colors [&>td]:transition-colors data-[interactive=true]:hover:[&>td]:bg-[var(--table-row-hover)] data-[interactive=true]:focus-visible:[&>td]:bg-[var(--table-row-hover)] data-[state=selected]:[&>td]:bg-[var(--table-row-selected)]",
        className
      )}
      {...props}
    />
  )
}

function TableHead({ className, children, ...props }: React.ComponentProps<"th">) {
  return (
    <th
      data-slot="table-head"
      className={cn(
        "text-foreground h-10 overflow-hidden px-2 text-left align-middle font-medium whitespace-nowrap text-ellipsis [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px] [&>div]:max-w-full [&>div]:min-w-0 [&>div]:overflow-hidden",
        className
      )}
      {...props}
    >
      {wrapPlainTableText(children)}
    </th>
  )
}

function TableCell({ className, children, ...props }: React.ComponentProps<"td">) {
  return (
    <td
      data-slot="table-cell"
      className={cn(
        "overflow-hidden p-2 align-middle whitespace-nowrap text-ellipsis [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px] [&>div]:max-w-full [&>div]:min-w-0 [&>div]:overflow-hidden [&>div>div]:max-w-full [&>div>div]:min-w-0",
        className
      )}
      {...props}
    >
      {wrapPlainTableText(children)}
    </td>
  )
}

function TableCaption({
  className,
  ...props
}: React.ComponentProps<"caption">) {
  return (
    <caption
      data-slot="table-caption"
      className={cn("text-muted-foreground mt-4 text-sm", className)}
      {...props}
    />
  )
}

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
}
