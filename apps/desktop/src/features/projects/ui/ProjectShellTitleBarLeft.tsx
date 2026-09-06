"use client";

import { SidebarTrigger, useSidebar } from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";

/**
 * Left segment of the project-shell title bar (sidebar toggle).
 * Shared by the workbench and any route that uses the same shell but does not call `useProjectHeader`.
 */
export function ProjectShellTitleBarLeft() {
  const { isMobile, openMobile, state } = useSidebar();
  const sidebarChromeOpen = isMobile ? openMobile : state === "expanded";
  const showTitlebarTrigger = isMobile ? !openMobile : state === "collapsed";

  if (!showTitlebarTrigger) return null;

  return (
    <div className="workbench-header-toolbar flex min-w-0 items-center">
      <SidebarTrigger
        className={cn(
          "h-7 w-7 shrink-0 rounded-md",
          sidebarChromeOpen
            ? "text-muted-foreground/75 hover:bg-sidebar-accent hover:text-foreground"
            : "text-muted-foreground/75 hover:bg-muted/60 hover:text-foreground",
        )}
      />
    </div>
  );
}
