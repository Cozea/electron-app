import { Fragment, type ReactNode } from "react"
import { cn } from "@/lib/utils"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { CommandSearch } from "@/components/CommandSearch"
import { LayoutToggles } from "@/components/layouts/LayoutToggles"

interface UnifiedHeaderProps {
  breadcrumbs: { label: string; href?: string }[]
  header?: ReactNode
  breadcrumbAddon?: ReactNode
  className?: string
}

export function UnifiedHeader({
  breadcrumbs,
  header,
  breadcrumbAddon,
  className,
}: UnifiedHeaderProps) {
  const isTabsPrimaryLayout =
    breadcrumbs.length === 0 && !breadcrumbAddon && Boolean(header)

  if (isTabsPrimaryLayout) {
    return (
      <div
        className={cn(
          "absolute top-0 left-0 right-0 z-40 h-10 flex items-center px-2 bg-background titlebar-drag-region",
          className
        )}
      >
        <div className="flex items-center w-full gap-0.5">
          <div className="flex items-center min-w-0 flex-1 titlebar-no-drag">
            {header}
          </div>
          <div className="mx-0.5 h-4 w-px shrink-0 bg-border/70" />
          <div className="flex items-center gap-0 titlebar-no-drag shrink-0">
            <CommandSearch />
            <LayoutToggles />
          </div>
        </div>
      </div>
    )
  }

  return (
    <div
      className={cn(
        "absolute top-0 left-0 right-0 z-40 h-10 flex items-center px-4 bg-background titlebar-drag-region",
        className
      )}
    >
      <div className="flex items-center w-full gap-3">
        <div className="flex items-center min-w-0 titlebar-no-drag">
          {breadcrumbs.length > 0 && (
            <Breadcrumb>
              <BreadcrumbList>
                {breadcrumbs.map((crumb, index) => (
                  <Fragment key={`${crumb.label}-${index}`}>
                    <BreadcrumbItem>
                      {crumb.href && index < breadcrumbs.length - 1 ? (
                        <BreadcrumbLink href={crumb.href || "#"}>
                          {crumb.label}
                        </BreadcrumbLink>
                      ) : (
                        <BreadcrumbPage className="text-muted-foreground/80">
                          {crumb.label}
                        </BreadcrumbPage>
                      )}
                    </BreadcrumbItem>
                    {index < breadcrumbs.length - 1 && <BreadcrumbSeparator />}
                  </Fragment>
                ))}
              </BreadcrumbList>
            </Breadcrumb>
          )}
          {breadcrumbAddon && (
            <div className={cn("flex items-center gap-2", breadcrumbs.length > 0 && "ml-3")}>
              {breadcrumbAddon}
            </div>
          )}
        </div>
        <div className="flex-1" />
        <div className="flex items-center gap-0.5 titlebar-no-drag min-w-0">
          {header}
          {(header || breadcrumbAddon) && (
            <div className="mx-1.5 h-4 w-px shrink-0 bg-border/70" />
          )}
          <div className="flex items-center gap-0.5">
            <CommandSearch />
            <LayoutToggles />
          </div>
        </div>
      </div>
    </div>
  )
}
