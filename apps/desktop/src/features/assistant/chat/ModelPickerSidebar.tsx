import { type ProviderInstanceId } from "@cozea/assistant-contracts";
import { memo, useMemo } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { PinIcon as __PinIconHugeIcon, Clock01Icon as __Clock01IconHugeIcon } from "@hugeicons/core-free-icons";
import { Gemini, OpenCodeIcon } from "../Icons";
import { ProviderInstanceIcon } from "./ProviderInstanceIcon";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { ProviderInstanceEntry } from "../../providerInstances";

function describeUnavailableInstance(entry: ProviderInstanceEntry): string {
  if (entry.status === "ready") {
    return entry.displayName;
  }
  const kind =
    entry.status === "error"
      ? "Unavailable"
      : entry.status === "warning"
        ? "Limited"
        : entry.status === "disabled"
          ? "Disabled in settings"
          : "Not ready";
  const msg = entry.snapshot.message?.trim() || entry.snapshot.unavailableReason?.trim();
  return msg ? `${entry.displayName} — ${kind}. ${msg}` : `${entry.displayName} — ${kind}.`;
}

const SELECTED_BUTTON_CLASS = "bg-[var(--sidebar-pill-hover-bg)] text-[var(--sidebar-pill-hover-fg)]";
const SELECTED_INDICATOR_CLASS =
  "pointer-events-none absolute right-0 top-1/2 z-10 h-5 w-0.5 -translate-y-1/2 rounded-l-full bg-primary";
const BADGE_BASE_CLASS =
  "pointer-events-none absolute -right-0.5 top-0.5 z-10 flex size-3.5 items-center justify-center rounded-full bg-transparent shadow-sm ";
const SOON_BADGE_CLASS = `${BADGE_BASE_CLASS} text-muted-foreground `;

const PICKER_TOOLTIP_SIDE = "left" as const;
const PICKER_TOOLTIP_CLASS = "max-w-64 text-balance font-normal leading-snug";
const PICKER_ITEM_CLASS = "relative flex w-full justify-center";
const PICKER_BUTTON_CLASS =
  "relative isolate flex h-10 w-full cursor-pointer items-center justify-center rounded transition-colors hover:bg-[var(--sidebar-pill-hover-bg)] hover:text-[var(--sidebar-pill-hover-fg)]";

export const ModelPickerSidebar = memo(function ModelPickerSidebar(props: {
  selectedInstanceId: ProviderInstanceId | "favorites";
  onSelectInstance: (instanceId: ProviderInstanceId | "favorites") => void;
  instanceEntries: ReadonlyArray<ProviderInstanceEntry>;
  showFavorites?: boolean;
  showComingSoon?: boolean;
}) {
  const handleSelect = (instanceId: ProviderInstanceId | "favorites") => {
    props.onSelectInstance(instanceId);
  };
  const showFavorites = props.showFavorites ?? true;
  const showComingSoon = props.showComingSoon ?? true;
  const duplicateDriverCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const entry of props.instanceEntries) {
      counts.set(entry.driverKind, (counts.get(entry.driverKind) ?? 0) + 1);
    }
    return counts;
  }, [props.instanceEntries]);

  return (
    <div className="flex w-12 shrink-0 flex-col items-center gap-1 overflow-y-auto border-r border-border/40 bg-muted/30 px-1 py-1 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
      {showFavorites ? (
        <div className={PICKER_ITEM_CLASS}>
          {props.selectedInstanceId === "favorites" && <div className={SELECTED_INDICATOR_CLASS} />}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                className={cn(
                  PICKER_BUTTON_CLASS,
                  props.selectedInstanceId === "favorites" && SELECTED_BUTTON_CLASS,
                )}
                onClick={() => handleSelect("favorites")}
                type="button"
                data-model-picker-provider="favorites"
                aria-label="Pinned"
              >
                <HugeiconsIcon icon={__PinIconHugeIcon} className="size-5 shrink-0" aria-hidden />
              </button>
              </TooltipTrigger>
              <TooltipContent side={PICKER_TOOLTIP_SIDE} align="center" className={PICKER_TOOLTIP_CLASS}>
                Pinned
              </TooltipContent>
            </Tooltip>
          </div>
      ) : null}

      {showFavorites ? <div className="my-0.5 h-px w-full bg-border/40" /> : null}

      {props.instanceEntries.map((entry) => {
        const isDisabled = !entry.isAvailable || entry.status !== "ready";
        const isSelected = props.selectedInstanceId === entry.instanceId;
        const showInstanceBadge =
          Boolean(entry.accentColor) || (duplicateDriverCounts.get(entry.driverKind) ?? 0) > 1;

        const providerTooltip = isDisabled ? describeUnavailableInstance(entry) : entry.displayName;

        const button = (
          <button
            data-model-picker-provider={entry.instanceId}
            className={cn(
              PICKER_BUTTON_CLASS,
              isSelected && SELECTED_BUTTON_CLASS,
              isDisabled && "opacity-50 cursor-not-allowed hover:bg-transparent",
            )}
            data-provider-accent-color={entry.accentColor}
            onClick={() => !isDisabled && handleSelect(entry.instanceId)}
            disabled={isDisabled}
            type="button"
            aria-label={providerTooltip}
          >
            <ProviderInstanceIcon
              driverKind={entry.driverKind}
              displayName={entry.displayName}
              accentColor={entry.accentColor}
              showBadge={showInstanceBadge}
              className="size-6"
              iconClassName="size-5"
            />
          </button>
        );

        const trigger = isDisabled ? (
          <span className="relative block h-10 w-full">{button}</span>
        ) : (
          button
        );

        return (
          <div key={entry.instanceId} className={PICKER_ITEM_CLASS}>
            {isSelected && <div className={SELECTED_INDICATOR_CLASS} />}
            <Tooltip>
              <TooltipTrigger asChild>{trigger}</TooltipTrigger>
              <TooltipContent side={PICKER_TOOLTIP_SIDE} align="center" className={PICKER_TOOLTIP_CLASS}>
                {providerTooltip}
              </TooltipContent>
            </Tooltip>
          </div>
        );
      })}

      {showComingSoon ? (
        <>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="relative block h-10 w-full">
                <button
                  className={cn(
                    "relative isolate flex h-10 w-full items-center justify-center rounded opacity-50 cursor-not-allowed transition-colors hover:bg-transparent",
                  )}
                  disabled
                  type="button"
                  data-model-picker-provider="gemini-coming-soon"
                  aria-label="Gemini — coming soon"
                >
                  <Gemini className="size-5 text-muted-foreground/85" aria-hidden />
                  <span className={SOON_BADGE_CLASS} aria-hidden>
                    <HugeiconsIcon icon={__Clock01IconHugeIcon} className="size-2" />
                  </span>
                </button>
              </span>
            </TooltipTrigger>
            <TooltipContent side={PICKER_TOOLTIP_SIDE} align="center" className={PICKER_TOOLTIP_CLASS}>
              Gemini — Coming soon
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="relative block h-10 w-full">
                <button
                  className={cn(
                    "relative isolate flex h-10 w-full items-center justify-center rounded opacity-50 cursor-not-allowed transition-colors hover:bg-transparent",
                  )}
                  disabled
                  type="button"
                  data-model-picker-provider="github-copilot-coming-soon"
                  aria-label="Github Copilot — coming soon"
                >
                  <OpenCodeIcon className="size-5 text-muted-foreground/85" aria-hidden />
                  <span className={SOON_BADGE_CLASS} aria-hidden>
                    <HugeiconsIcon icon={__Clock01IconHugeIcon} className="size-2" />
                  </span>
                </button>
              </span>
            </TooltipTrigger>
            <TooltipContent side={PICKER_TOOLTIP_SIDE} align="center" className={PICKER_TOOLTIP_CLASS}>
              Github Copilot — Coming soon
            </TooltipContent>
          </Tooltip>
        </>
      ) : null}
    </div>
  );
});
