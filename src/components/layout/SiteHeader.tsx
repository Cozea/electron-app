import { Fragment } from "react"
import { Cloud, CloudOff, ArrowUp, ArrowDown } from "lucide-react"
import { TitleBar } from "../TitleBar"
import { CommandSearch } from "../CommandSearch"
import { AssistantToggleButton } from "@/components/assistant/AssistantToggleButton"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { PresenceAvatarGroup } from "@/components/presence/PresenceAvatarGroup"
import { useYjsProject } from "@/contexts/YjsProjectContext"
import { useOptionalProjectSyncContext } from "@/features/projects/contexts/ProjectSyncContext"
import type { PresenceUser } from "@/hooks/useProjectPresence"

interface SiteHeaderProps {
  breadcrumbs?: { label: string; href?: string }[]
  presenceUsers?: PresenceUser[]
}

export function SiteHeader({ breadcrumbs = [], presenceUsers }: SiteHeaderProps) {
  const { isConnected } = useYjsProject()
  const syncContext = useOptionalProjectSyncContext()

  // Show cloud status only when in a project (breadcrumbs > 1)
  const showCloudStatus = breadcrumbs.length > 1

  // Determine sync state from progress
  const syncProgress = syncContext?.syncProgress
  const isSyncing = syncProgress?.status === "syncing"
  const isUploading = isSyncing && syncProgress?.message?.startsWith("Uploading")
  const isDownloading = isSyncing && syncProgress?.message?.startsWith("Downloading")
  const pendingCount = syncProgress ? Math.max(0, syncProgress.total - syncProgress.current) : 0

  // Generate tooltip text based on state
  const getTooltipText = () => {
    if (!isConnected) return "Offline - changes saved locally"
    if (isUploading) return `Uploading ${pendingCount} file${pendingCount !== 1 ? 's' : ''}...`
    if (isDownloading) return `Downloading ${pendingCount} file${pendingCount !== 1 ? 's' : ''}...`
    return "Connected to cloud"
  }

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

          {/* Cloud connection indicator with sync animation */}
          {showCloudStatus && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="ml-2 flex items-center gap-0.5">
                    {isConnected ? (
                      <>
                        <Cloud className="h-4 w-4 text-muted-foreground fill-muted-foreground" />
                        {isUploading && (
                          <ArrowUp className="h-3 w-3 text-blue-500 animate-bounce" />
                        )}
                        {isDownloading && (
                          <ArrowDown className="h-3 w-3 text-green-500 animate-bounce" />
                        )}
                      </>
                    ) : (
                      <CloudOff className="h-4 w-4 text-orange-500" />
                    )}
                  </div>
                </TooltipTrigger>
                <TooltipContent>
                  {getTooltipText()}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </div>
        <div className="flex items-center gap-1" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          {presenceUsers && presenceUsers.length > 0 && (
            <PresenceAvatarGroup users={presenceUsers} maxVisible={4} />
          )}
          <CommandSearch />
          <AssistantToggleButton />
        </div>
      </div>
    </TitleBar>
  )
}
