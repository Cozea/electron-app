"use client";

interface ProjectShellTitleBarCenterFromLabelProps {
  label: string;
}

/**
 * Center title row using the same layout shell as the workbench project name strip,
 * so settings (and similar) share identical chrome — only the label differs.
 */
export function ProjectShellTitleBarCenterFromLabel({ label }: ProjectShellTitleBarCenterFromLabelProps) {
  return (
    <div className="flex min-w-0 max-w-[52vw] items-center justify-center gap-2">
      <div className="flex h-6 min-w-0 max-w-full items-center">
        <div
          className="flex h-6 min-w-0 max-w-[320px] items-center px-2.5 text-xs font-medium text-foreground"
          title={label}
        >
          <span className="block truncate">{label}</span>
        </div>
      </div>
    </div>
  );
}
