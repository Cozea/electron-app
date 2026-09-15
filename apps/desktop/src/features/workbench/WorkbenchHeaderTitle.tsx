import { memo } from "react";
import { ProjectPixelInvaderIcon } from "@/components/ProjectPixelInvaderIcon";
import { WorkbenchHeaderBranchControl } from "@/features/workbench/WorkbenchHeaderBranchControl";

export interface WorkbenchHeaderTitleProps {
  projectName: string | null;
  hasActiveLiveSession?: boolean;
  hasProjectRecord?: boolean;
}

export const WorkbenchHeaderTitle = memo(function WorkbenchHeaderTitle({
  projectName,
}: WorkbenchHeaderTitleProps) {
  if (!projectName) return null;

  return (
    <div className="flex min-w-0 items-center gap-2">
      <div
        className="flex h-7 min-w-0 max-w-[320px] items-center gap-1.5 text-sm font-medium text-foreground"
        title={projectName}
        data-workbench-header-title="true"
      >
        <ProjectPixelInvaderIcon
          name={projectName}
          className="size-4 shrink-0"
        />
        <span className="truncate">{projectName}</span>
      </div>
      <div className="flex min-w-0 items-center gap-1.5 whitespace-nowrap">
        {/* Lane/branch state is read from context inside the control so
            this element stays identity-stable while lanes settle. */}
        <WorkbenchHeaderBranchControl
          triggerClassName="h-7 min-h-7 min-w-0 shrink gap-1 rounded-md border-0 bg-transparent px-1.5 text-sm font-medium text-foreground shadow-none hover:bg-muted/60 transition-[background-color,color,transform] duration-150 active:scale-[0.98]"
          trailing={null}
        />
      </div>
    </div>
  );
});
