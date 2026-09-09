"use client";

import { SIDEBAR_TRANSITION_CLASS_NAME, SidebarTrigger, useSidebar } from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";

/**
 * Left segment of the project-shell title bar (sidebar toggle).
 * Shared by the workbench and any route that uses the same shell but does not call `useProjectHeader`.
 */
export function ProjectShellTitleBarLeft() {
  const { open } = useSidebar();
  const showTitlebarTrigger = !open;

  return (
    <div
      data-sidebar-header-toggle={showTitlebarTrigger ? "visible" : "hidden"}
      aria-hidden={!showTitlebarTrigger}
      inert={!showTitlebarTrigger}
      className={cn(
        "workbench-header-toolbar flex min-w-0 shrink-0 items-center overflow-hidden transition-[width,opacity]",
        SIDEBAR_TRANSITION_CLASS_NAME,
        showTitlebarTrigger ? "w-8.5 opacity-100" : "w-0 opacity-0",
      )}
    >
      <SidebarTrigger
        aria-label="Expand sidebar"
        className="h-7 w-7 shrink-0 rounded-md text-muted-foreground/75 hover:bg-muted/60 hover:text-foreground"
      />
    </div>
  );
}
