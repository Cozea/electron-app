import { Fragment } from "react"
import { TitleBar } from "../TitleBar"
import { AssistantToggleButton } from "@/components/assistant/AssistantToggleButton"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { SidebarTrigger } from "@/components/ui/sidebar"

interface SiteHeaderProps {
  breadcrumbs?: { label: string; href?: string }[]
}

export function SiteHeader({ breadcrumbs = [] }: SiteHeaderProps) {
  return (
    <TitleBar>
      <div className="flex items-center justify-between w-full">
        <div className="flex items-center" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <SidebarTrigger className="-ml-1" />
          <div className="mx-2 h-4 w-[1px] bg-foreground/20" />
          <Breadcrumb>
            <BreadcrumbList>
              {breadcrumbs.map((crumb, index) => (
                <Fragment key={crumb.label}>
                  <BreadcrumbItem>
                    {crumb.href && index < breadcrumbs.length - 1 ? (
                      <BreadcrumbLink href={crumb.href || "#"}>
                        {crumb.label}
                      </BreadcrumbLink>
                    ) : (
                      <BreadcrumbPage>{crumb.label}</BreadcrumbPage>
                    )}
                  </BreadcrumbItem>
                  {index < breadcrumbs.length - 1 && <BreadcrumbSeparator />}
                </Fragment>
              ))}
            </BreadcrumbList>
          </Breadcrumb>
        </div>
        <div className="flex items-center gap-2" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <AssistantToggleButton />
        </div>
      </div>
    </TitleBar>
  )
}
