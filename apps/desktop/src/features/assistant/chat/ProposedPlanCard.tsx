

import { HugeiconsIcon } from '@hugeicons/react'
import { useTranslation } from "@/lib/i18n"
import { appToast } from "@/lib/appToast";
import { AlignHorizontalCenterIcon as __EllipsisIconHugeIcon } from '@hugeicons/core-free-icons'

import { memo, useState, useId, useMemo } from "react";
import {
  buildCollapsedProposedPlanPreviewMarkdown,
  buildProposedPlanMarkdownFilename,
  downloadPlanAsTextFile,
  normalizePlanMarkdownForExport,
  proposedPlanTitle,
  stripDisplayedPlanMarkdown,
} from "../proposedPlan";
import ChatMarkdown from "./ChatMarkdown";
import { Button } from "@/components/ui/button";
import { UnifiedModal, UnifiedModalField } from "@/components/ui/unified-modal";
import {
  DropdownMenu as Menu,
  DropdownMenuContent as MenuPopup,
  DropdownMenuItem as MenuItem,
  DropdownMenuTrigger as MenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { usePretextOverflowTitleFor } from "@/hooks/usePretextOverflowTitle";

export const ProposedPlanCard = memo(function ProposedPlanCard({
  planMarkdown,
  cwd,
  workspaceRoot,
}: {
  planMarkdown: string;
  cwd: string | undefined;
  workspaceRoot: string | undefined;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [isSaveDialogOpen, setIsSaveDialogOpen] = useState(false);
  const [savePath, setSavePath] = useState("");
  const [isSavingToWorkspace, setIsSavingToWorkspace] = useState(false);
  const savePathInputId = useId();
  const title = proposedPlanTitle(planMarkdown) ?? "Proposed plan";
  const lineCount = planMarkdown.split("\n").length;
  const canCollapse = planMarkdown.length > 900 || lineCount > 20;
  const displayedPlanMarkdown = stripDisplayedPlanMarkdown(planMarkdown);
  const collapsedPreview = canCollapse
    ? buildCollapsedProposedPlanPreviewMarkdown(planMarkdown, { maxLines: 10 })
    : null;
  const downloadFilename = buildProposedPlanMarkdownFilename(planMarkdown);
  const saveContents = normalizePlanMarkdownForExport(planMarkdown);
  const { containerRef, getOverflowTitle } = usePretextOverflowTitleFor<HTMLDivElement>({
    font: "13px Inter",
  });
  const titleTooltip = useMemo(() => {
    const reservedWidth = 92;
    return getOverflowTitle(title, reservedWidth);
  }, [getOverflowTitle, title]);

  const handleDownload = () => {
    downloadPlanAsTextFile(downloadFilename, saveContents);
  };

  const openSaveDialog = () => {
    if (!workspaceRoot) {
      appToast.error({
        title: t("assistant.workspacePathIsUnavailable"),
        description: t("assistant.thisThreadDoesNotHaveA"),
      });
      return;
    }
    setSavePath((existing) => (existing.length > 0 ? existing : downloadFilename));
    setIsSaveDialogOpen(true);
  };

  const handleSaveToWorkspace = () => {
    const relativePath = savePath.trim();
    if (!workspaceRoot) {
      return;
    }
    if (!relativePath) {
      appToast.warning({
        title: t("assistant.enterAWorkspacePath"),
      });
      return;
    }

    setIsSavingToWorkspace(true);
    void window.electronAPI.project
      .writeFile({
        workspaceId: workspaceRoot,
        filePath: relativePath,
        content: saveContents,
      })
      .then((result) => {
        if (!result.success) {
          throw new Error(result.error ?? "An error occurred while saving.");
        }
        setIsSaveDialogOpen(false);
        appToast.success({
          title: t("assistant.planSavedToWorkspace"),
          description: relativePath,
        });
      })
      .catch((error) => {
        appToast.error({
          title: t("assistant.couldNotSavePlan"),
          description: error instanceof Error ? error.message : "An error occurred while saving.",
        });
      })
      .then(
        () => {
          setIsSavingToWorkspace(false);
        },
        () => {
          setIsSavingToWorkspace(false);
        },
      );
  };

  return (
    <div className="rounded-[24px] border border-border/80 bg-card/70 p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div ref={containerRef} className="flex min-w-0 items-center gap-2">
          <Badge variant="secondary">{t("assistant.plan")}</Badge>
          <p className="truncate text-sm font-medium text-foreground" title={titleTooltip}>
            {title}
          </p>
        </div>
        <Menu>
          <MenuTrigger
            render={<Button aria-label={t("assistant.planActions")} size="icon-xs" variant="outline" />}
          >
            <HugeiconsIcon icon={__EllipsisIconHugeIcon} aria-hidden="true" className="size-4" />
          </MenuTrigger>
          <MenuPopup align="end">
            <MenuItem onClick={handleDownload}>{t("assistant.downloadAsMarkdown")}</MenuItem>
            <MenuItem onClick={openSaveDialog} disabled={!workspaceRoot || isSavingToWorkspace}>
              {t("assistant.saveToWorkspace")}
            </MenuItem>
          </MenuPopup>
        </Menu>
      </div>
      <div className="mt-4">
        <div className={cn("relative", canCollapse && !expanded && "max-h-104 overflow-hidden")}>
          {canCollapse && !expanded ? (
            <ChatMarkdown text={collapsedPreview ?? ""} cwd={cwd} isStreaming={false} />
          ) : (
            <ChatMarkdown text={displayedPlanMarkdown} cwd={cwd} isStreaming={false} />
          )}
          {canCollapse && !expanded ? (
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-linear-to-t from-card/95 via-card/80 to-transparent" />
          ) : null}
        </div>
        {canCollapse ? (
          <div className="mt-4 flex justify-center">
            <Button
              size="sm"
              variant="outline"
              data-scroll-anchor-ignore
              onClick={() => setExpanded((value) => !value)}
            >
              {expanded ? "Collapse plan" : "Expand plan"}
            </Button>
          </div>
        ) : null}
      </div>

      <UnifiedModal
        open={isSaveDialogOpen}
        onOpenChange={setIsSaveDialogOpen}
        title={t("assistant.savePlanToWorkspace")}
        size="lg"
        dismissable={!isSavingToWorkspace}
        footer={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsSaveDialogOpen(false)}
              disabled={isSavingToWorkspace}
            >
              {t("assistant.cancel")}
            </Button>
            <Button
              size="sm"
              onClick={() => void handleSaveToWorkspace()}
              disabled={isSavingToWorkspace}
            >
              {isSavingToWorkspace ? "Saving..." : "Save"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {t("assistant.enterAPathRelativeTo")} <code>the workspace</code>.
          </p>
          <UnifiedModalField
            id={savePathInputId}
            label={t("assistant.workspacePath")}
            value={savePath}
            onChange={setSavePath}
            spellCheck={false}
            disabled={isSavingToWorkspace}
          />
        </div>
      </UnifiedModal>
    </div>
  );
});
