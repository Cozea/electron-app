import {
  defaultInstanceIdForDriver,
  type ProviderDriverKind,
  type ProviderInstanceId,
  type ProviderKind,
  type ServerProvider,
  type ProviderOptionDescriptor,
} from "@cozea/assistant-contracts";
import { getProviderOptionCurrentValue } from "@cozea/assistant-shared/model";
import { memo, useMemo } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowDown01Icon as __ChevronDownIconHugeIcon, ZapIcon as __ZapIconHugeIcon } from "@hugeicons/core-free-icons";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { ProviderInstanceIcon } from "./ProviderInstanceIcon";
import {
  type ModelEsque,
  getTriggerDisplayModelLabel,
  getTriggerDisplayModelName,
} from "./providerIconUtils";
import { usePretextOverflowTitleFor } from "@/hooks/usePretextOverflowTitle";
import {
  deriveProviderInstanceEntries,
  sortProviderInstanceEntries,
} from "../../providerInstances";

interface ProviderModelPickerProps {
  provider: ProviderKind;
  activeInstanceId?: ProviderInstanceId;
  model: string;
  lockedProvider: ProviderKind | null;
  providers?: ReadonlyArray<ServerProvider>;
  modelOptionsByProvider: Record<ProviderKind, ReadonlyArray<ModelEsque>>;
  optionDescriptors?: ReadonlyArray<ProviderOptionDescriptor>;
  activeProviderIconClassName?: string;
  compact?: boolean;
  disabled?: boolean;
  terminalOpen?: boolean;
  open?: boolean;
  triggerClassName?: string;
  onOpenChange?: (open: boolean) => void;
  onProviderModelChange: (provider: ProviderKind, model: string) => void;
}

export const ProviderModelPicker = memo(function ProviderModelPicker(props: ProviderModelPickerProps) {
  const instanceEntries = useMemo(
    () => sortProviderInstanceEntries(deriveProviderInstanceEntries(props.providers ?? [])),
    [props.providers],
  );
  const activeInstanceId =
    props.activeInstanceId ?? defaultInstanceIdForDriver(props.provider as ProviderDriverKind);
  const activeEntry = useMemo(
    () => instanceEntries.find((entry) => entry.instanceId === activeInstanceId) ?? null,
    [activeInstanceId, instanceEntries],
  );
  const activeProvider = activeEntry?.provider ?? props.lockedProvider ?? props.provider;
  const selectedProviderOptions = activeEntry?.models.length
    ? activeEntry.models
    : props.modelOptionsByProvider[activeProvider];
  
  const selectedModel =
    selectedProviderOptions?.find((option) => option.slug === props.model) ??
    selectedProviderOptions?.find((option) => option.isDefault && !option.isLegacy) ??
    selectedProviderOptions?.find((option) => !option.isLegacy) ??
    selectedProviderOptions?.[0];
  const duplicateDriverCount = instanceEntries.filter(
    (entry) => activeEntry !== null && entry.driverKind === activeEntry.driverKind,
  ).length;
  const showInstanceBadge = Boolean(activeEntry?.accentColor) || duplicateDriverCount > 1;
  const triggerTitle = selectedModel ? getTriggerDisplayModelName(selectedModel) : props.model;
  const triggerLabel = selectedModel ? getTriggerDisplayModelLabel(selectedModel) : props.model;

  const effortDescriptor = props.optionDescriptors?.find(
    (d) => d.id === "effort" || d.id === "reasoningEffort" || d.id === "reasoning" || d.id === "thinking",
  );
  const currentEffortVal = effortDescriptor ? getProviderOptionCurrentValue(effortDescriptor) : null;
  const currentEffortLabel = useMemo(() => {
    if (!effortDescriptor || currentEffortVal === undefined || currentEffortVal === null) return null;
    if (effortDescriptor.type === "select") {
      return effortDescriptor.options.find((o) => o.id === currentEffortVal)?.label ?? String(currentEffortVal);
    }
    if (typeof currentEffortVal === "boolean") {
      return currentEffortVal ? "Thinking" : null;
    }
    return null;
  }, [effortDescriptor, currentEffortVal]);

  const speedDescriptor = props.optionDescriptors?.find((d) => {
    const normId = d.id.toLowerCase();
    const normLabel = (d.label ?? "").toLowerCase();
    return (
      normId === "fastmode" ||
      normId === "servicetier" ||
      normId === "speed" ||
      normId === "fast" ||
      normLabel.includes("speed") ||
      normLabel.includes("fast mode")
    );
  });
  const currentSpeedVal = String(
    speedDescriptor ? getProviderOptionCurrentValue(speedDescriptor) ?? "" : "",
  ).toLowerCase();
  const isFastModeActive =
    currentSpeedVal === "true" ||
    currentSpeedVal === "on" ||
    currentSpeedVal === "fast" ||
    currentSpeedVal === "priority" ||
    currentSpeedVal === "turbo" ||
    currentSpeedVal === "enabled";

  const { containerRef, getOverflowTitle } = usePretextOverflowTitleFor<HTMLSpanElement>({
    font: "14px Inter",
  });
  const overflowTitle = getOverflowTitle(triggerLabel, 0);

  return (
    <button
      type="button"
      data-chat-provider-model-picker="true"
      className={cn(
        "inline-flex h-7 min-w-0 items-center justify-start gap-1.5 whitespace-nowrap rounded-full border border-transparent px-2 text-xs font-normal text-muted-foreground transition-colors hover:bg-accent/80 hover:text-foreground cursor-pointer outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50",
        props.compact ? "max-w-56 shrink-0" : "max-w-64 shrink sm:max-w-72 sm:px-3",
        props.triggerClassName,
      )}
      disabled={props.disabled}
      onClick={() => props.onOpenChange?.(!props.open)}
    >
      <span
        className={cn(
          "flex min-w-0 w-full box-border items-center gap-1.5 overflow-hidden",
          props.compact ? "max-w-52 sm:pl-0.5" : undefined,
        )}
      >
        {activeEntry ? (
          <ProviderInstanceIcon
            driverKind={activeEntry.driverKind}
            displayName={activeEntry.displayName}
            accentColor={activeEntry.accentColor}
            showBadge={showInstanceBadge}
            className={showInstanceBadge ? "size-5" : "size-4"}
            iconClassName={cn("size-4", props.activeProviderIconClassName)}
            badgeClassName="right-[-0.125rem] bottom-[-0.125rem] h-3 min-w-3 text-[7px]"
          />
        ) : null}
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              ref={containerRef}
              className="min-w-0 flex-1 truncate flex items-center gap-1.5"
            >
              <span className="truncate">{triggerTitle}</span>
              {currentEffortLabel ? (
                <span className="truncate text-muted-foreground/60 font-normal text-xs">
                  {currentEffortLabel}
                </span>
              ) : null}
              {isFastModeActive ? (
                <HugeiconsIcon
                  icon={__ZapIconHugeIcon}
                  className="size-3 shrink-0 text-amber-500 fill-current"
                  aria-label="Fast mode on"
                />
              ) : null}
            </span>
          </TooltipTrigger>
          {overflowTitle && <TooltipContent side="top">{overflowTitle}</TooltipContent>}
        </Tooltip>
        <HugeiconsIcon
          icon={__ChevronDownIconHugeIcon}
          aria-hidden="true"
          className={cn(
            "size-3 shrink-0 opacity-60 transition-transform duration-200",
            props.open && "rotate-180",
          )}
        />
      </span>
    </button>
  );
});
