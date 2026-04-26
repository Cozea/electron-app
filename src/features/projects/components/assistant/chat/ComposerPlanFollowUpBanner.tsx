// @ts-nocheck
import { memo, useMemo } from "react";
import { usePretextOverflowTitleFor } from "@/hooks/usePretextOverflowTitle";

export const ComposerPlanFollowUpBanner = memo(function ComposerPlanFollowUpBanner({
  planTitle,
}: {
  planTitle: string | null;
}) {
  const { containerRef, getOverflowTitle } = usePretextOverflowTitleFor<HTMLDivElement>({
    font: "13px Inter",
  });
  const planTitleTooltip = useMemo(() => {
    if (!planTitle) return undefined;
    const reservedWidth = 96;
    return getOverflowTitle(planTitle, reservedWidth);
  }, [getOverflowTitle, planTitle]);

  return (
    <div className="px-4 py-3.5 sm:px-5 sm:py-4">
      <div ref={containerRef} className="flex flex-wrap items-center gap-2">
        <span className="uppercase text-sm tracking-[0.2em]">Plan ready</span>
        {planTitle ? (
          <span className="min-w-0 flex-1 truncate text-sm font-medium" title={planTitleTooltip}>
            {planTitle}
          </span>
        ) : null}
      </div>
      {/* <div className="mt-2 text-xs text-muted-foreground">
        Review the plan
      </div> */}
    </div>
  );
});
