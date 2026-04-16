"use client";

import { SidebarTrigger, useOptionalSidebar } from "@/components/ui/sidebar";
import { WorkbenchHeaderEditorControl } from "@/features/projects/components/workbench/WorkbenchHeaderEditorControl";
import { cn } from "@/lib/utils";

interface ProjectShellTitleBarLeftProps {
  projectPath: string | null;
}

/**
 * Left segment of the project-shell title bar (sidebar + Open-in-editor).
 * Shared by the workbench and any route that uses the same shell but does not call `useProjectHeader`.
 */
export function ProjectShellTitleBarLeft({ projectPath }: ProjectShellTitleBarLeftProps) {
  const sidebar = useOptionalSidebar();
  const sidebarChromeOpen = Boolean(
    sidebar && (sidebar.isMobile ? sidebar.openMobile : sidebar.open),
  );

  return (
    <div className="workbench-header-toolbar flex min-w-0 items-center gap-1.5">
      <SidebarTrigger
        className={cn(
          "h-7 w-7 shrink-0 rounded-md",
          sidebarChromeOpen
            ? "text-muted-foreground/75 hover:bg-sidebar-accent hover:text-foreground"
            : "text-muted-foreground/75 hover:bg-muted/60 hover:text-foreground",
        )}
      />

      <WorkbenchHeaderEditorControl
        projectPath={projectPath}
        adjacentOpenSidebar={sidebarChromeOpen}
      />
    </div>
  );
}
