import {
  defaultInstanceIdForDriver,
  type ProviderDriverKind,
  type ProviderInstanceId,
  type ProviderKind,
  type ProviderOptionDescriptor,
  type ServerProvider,
} from "@cozea/assistant-contracts";
import { getProviderOptionCurrentValue, resolveSelectableModel } from "@cozea/assistant-shared/model";
import {
  ArrowLeft01Icon as __ArrowLeftHugeIcon,
  ArrowRight01Icon as __ArrowRightHugeIcon,
  CheckmarkCircle02Icon as __CheckHugeIcon,
  Refresh01Icon as __ResetHugeIcon,
  ZapIcon as __ZapHugeIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { memo, useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { Switch } from "@/components/ui/switch";
import {
  deriveProviderInstanceEntries,
  sortProviderInstanceEntries,
  type ProviderInstanceEntry,
} from "@/features/assistant/providerInstances";
import { cn } from "@/lib/utils";
import { getDirectlySelectableOptions } from "./modelPickerOptions";
import { getDisplayModelName, type ModelEsque } from "./providerIconUtils";

type SelectDescriptor = Extract<ProviderOptionDescriptor, { type: "select" }>;

type ModelPickerItem = ModelEsque & {
  provider: ProviderKind;
  instanceId: ProviderInstanceId;
  driverKind: ProviderDriverKind;
  instanceDisplayName: string;
};

export type ModelPickerPrimaryView = "models" | "capabilities";

function toModelEsque(model: ModelEsque): ModelEsque {
  return {
    slug: model.slug,
    name: model.name,
    ...(model.shortName ? { shortName: model.shortName } : {}),
    ...(model.subProvider ? { subProvider: model.subProvider } : {}),
    ...(model.isDefault !== undefined ? { isDefault: model.isDefault } : {}),
    ...(model.isLegacy !== undefined ? { isLegacy: model.isLegacy } : {}),
  };
}

function buildModelOptionsByInstance(
  entries: ReadonlyArray<ProviderInstanceEntry>,
  modelOptionsByProvider: Record<ProviderKind, ReadonlyArray<ModelEsque>>,
): ReadonlyMap<ProviderInstanceId, ReadonlyArray<ModelEsque>> {
  const optionsByInstance = new Map<ProviderInstanceId, ReadonlyArray<ModelEsque>>();
  for (const entry of entries) {
    const snapshotModels = entry.models.map(toModelEsque);
    optionsByInstance.set(
      entry.instanceId,
      snapshotModels.length > 0 ? snapshotModels : modelOptionsByProvider[entry.provider] ?? [],
    );
  }
  return optionsByInstance;
}

function isEffortDescriptor(descriptor: SelectDescriptor): boolean {
  const normalizedId = descriptor.id.toLowerCase();
  return (
    normalizedId === "effort" ||
    normalizedId === "reasoningeffort" ||
    normalizedId === "reasoning" ||
    normalizedId === "thinking"
  );
}

function isSpeedOption(id: string, label?: string): boolean {
  const normalizedId = id.toLowerCase();
  const normalizedLabel = (label ?? "").toLowerCase();
  return (
    normalizedId === "fastmode" ||
    normalizedId === "servicetier" ||
    normalizedId === "speed" ||
    normalizedId === "fast" ||
    normalizedLabel.includes("speed") ||
    normalizedLabel.includes("fast mode")
  );
}

function isEnabledSpeedValue(value: unknown): boolean {
  return ["true", "on", "fast", "priority", "turbo", "enabled"].includes(
    String(value ?? "").toLowerCase(),
  );
}

export const ModelPickerContent = memo(function ModelPickerContent(props: {
  provider: ProviderKind;
  activeInstanceId?: ProviderInstanceId;
  model: string;
  lockedProvider: ProviderKind | null;
  providers?: ReadonlyArray<ServerProvider>;
  modelOptionsByProvider: Record<ProviderKind, ReadonlyArray<ModelEsque>>;
  optionDescriptors?: ReadonlyArray<ProviderOptionDescriptor>;
  onOptionChange?: (id: string, value: string | boolean) => void;
  terminalOpen: boolean;
  initialView?: ModelPickerPrimaryView;
  maxAvailableHeightPx?: number;
  onRequestClose?: () => void;
  onProviderModelChange: (
    provider: ProviderKind,
    model: string,
    instanceId?: ProviderInstanceId,
  ) => void;
}) {
  const { onOptionChange, onProviderModelChange, onRequestClose } = props;
  const [activeView, setActiveView] = useState<string>(props.initialView ?? "models");

  useEffect(() => {
    setActiveView(props.initialView ?? "models");
  }, [props.initialView]);

  const instanceEntries = useMemo(
    () => sortProviderInstanceEntries(deriveProviderInstanceEntries(props.providers ?? [])),
    [props.providers],
  );
  const activeInstanceId =
    props.activeInstanceId ?? defaultInstanceIdForDriver(props.provider as ProviderDriverKind);
  const entryByInstanceId = useMemo(
    () => new Map(instanceEntries.map((entry) => [entry.instanceId, entry] as const)),
    [instanceEntries],
  );
  const modelOptionsByInstance = useMemo(
    () => buildModelOptionsByInstance(instanceEntries, props.modelOptionsByProvider),
    [instanceEntries, props.modelOptionsByProvider],
  );

  const visibleModels = useMemo(() => {
    const models: ModelPickerItem[] = [];
    for (const [instanceId, options] of modelOptionsByInstance) {
      const entry = entryByInstanceId.get(instanceId);
      if (
        !entry ||
        entry.status !== "ready" ||
        (props.lockedProvider !== null && entry.provider !== props.lockedProvider)
      ) {
        continue;
      }
      for (const model of options) {
        models.push({
          ...toModelEsque(model),
          provider: entry.provider,
          instanceId,
          driverKind: entry.driverKind,
          instanceDisplayName: entry.displayName,
        });
      }
    }

    return models.toSorted((left, right) => {
      const leftActive = left.instanceId === activeInstanceId;
      const rightActive = right.instanceId === activeInstanceId;
      if (leftActive !== rightActive) return leftActive ? -1 : 1;
      if (left.isLegacy !== right.isLegacy) return left.isLegacy ? 1 : -1;
      if (left.isDefault !== right.isDefault) return left.isDefault ? -1 : 1;
      return 0;
    });
  }, [activeInstanceId, entryByInstanceId, modelOptionsByInstance, props.lockedProvider]);

  const lockedInstanceCount = useMemo(
    () =>
      props.lockedProvider === null
        ? instanceEntries.length
        : instanceEntries.filter((entry) => entry.provider === props.lockedProvider).length,
    [instanceEntries, props.lockedProvider],
  );
  const showInstanceLabel = props.lockedProvider === null || lockedInstanceCount > 1;

  const activeSelectedModel = useMemo(
    () =>
      visibleModels.find(
        (model) => model.slug === props.model && model.instanceId === activeInstanceId,
      ) ?? visibleModels.find((model) => model.slug === props.model) ?? null,
    [activeInstanceId, props.model, visibleModels],
  );
  const activeModelDisplayLabel = activeSelectedModel
    ? getDisplayModelName(activeSelectedModel, { preferShortName: true })
    : props.model;

  const selectDescriptors = useMemo(
    () =>
      (props.optionDescriptors ?? []).filter(
        (descriptor): descriptor is SelectDescriptor => descriptor.type === "select",
      ),
    [props.optionDescriptors],
  );
  const speedDescriptor = useMemo(
    () => props.optionDescriptors?.find((descriptor) => isSpeedOption(descriptor.id, descriptor.label)),
    [props.optionDescriptors],
  );
  const primaryCapabilityDescriptor = useMemo(
    () =>
      selectDescriptors.find(isEffortDescriptor) ??
      selectDescriptors.find((descriptor) => descriptor.id.toLowerCase() === "variant") ??
      null,
    [selectDescriptors],
  );
  const secondarySelectDescriptors = useMemo(
    () =>
      selectDescriptors.filter(
        (descriptor) =>
          descriptor.id !== primaryCapabilityDescriptor?.id &&
          descriptor.id !== speedDescriptor?.id,
      ),
    [primaryCapabilityDescriptor?.id, selectDescriptors, speedDescriptor?.id],
  );
  const booleanDescriptors = useMemo(
    () =>
      (props.optionDescriptors ?? []).filter(
        (descriptor) =>
          descriptor.type === "boolean" && descriptor.id !== speedDescriptor?.id,
      ),
    [props.optionDescriptors, speedDescriptor?.id],
  );

  const handleModelSelect = useCallback(
    (model: ModelPickerItem) => {
      const options = modelOptionsByInstance.get(model.instanceId);
      if (!options) return;
      const resolvedModel = resolveSelectableModel(model.provider, model.slug, options);
      if (!resolvedModel) return;
      onProviderModelChange(model.provider, resolvedModel, model.instanceId);
      onRequestClose?.();
    },
    [modelOptionsByInstance, onProviderModelChange, onRequestClose],
  );

  useEffect(() => {
    if (activeView !== "models") return;

    const handleWindowKeyDown = (event: globalThis.KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.repeat ||
        (!event.metaKey && !event.ctrlKey) ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }
      const modelIndex = Number.parseInt(event.key, 10) - 1;
      const selectedModel = visibleModels[modelIndex];
      if (modelIndex < 0 || modelIndex > 8 || !selectedModel) return;
      event.preventDefault();
      event.stopPropagation();
      handleModelSelect(selectedModel);
    };

    window.addEventListener("keydown", handleWindowKeyDown, true);
    return () => window.removeEventListener("keydown", handleWindowKeyDown, true);
  }, [activeView, handleModelSelect, visibleModels]);

  const handleSpeedToggle = useCallback(
    (nextChecked: boolean) => {
      if (!speedDescriptor) return;
      if (speedDescriptor.type === "boolean") {
        onOptionChange?.(speedDescriptor.id, nextChecked);
        return;
      }

      const matchedOption = speedDescriptor.options.find((option) => {
        const normalizedId = option.id.toLowerCase();
        return nextChecked
          ? ["fast", "priority", "turbo", "on", "true", "enabled"].includes(normalizedId)
          : ["default", "standard", "auto", "off", "false", "disabled"].includes(normalizedId);
      });
      const fallbackValue = nextChecked
        ? (speedDescriptor.options.find(
            (option) => !["default", "standard", "auto"].includes(option.id.toLowerCase()),
          )?.id ?? "fast")
        : (speedDescriptor.options.find((option) => option.isDefault)?.id ??
          speedDescriptor.options[0]?.id ??
          "default");
      onOptionChange?.(speedDescriptor.id, matchedOption?.id ?? fallbackValue);
    },
    [onOptionChange, speedDescriptor],
  );

  const activeOptionDescriptor = activeView.startsWith("option:")
    ? selectDescriptors.find((descriptor) => descriptor.id === activeView.slice("option:".length))
    : undefined;

  if (activeOptionDescriptor) {
    const currentValue = getProviderOptionCurrentValue(activeOptionDescriptor);
    const directlySelectableOptions = getDirectlySelectableOptions(activeOptionDescriptor);
    const maxHeight = Math.max(144, Math.min(288, props.maxAvailableHeightPx ?? 288));
    return (
      <div className="flex w-full flex-col overflow-hidden text-popover-foreground" style={{ maxHeight }}>
        <div className="grid h-9 shrink-0 grid-cols-[28px_1fr_28px] items-center px-2">
          <button
            type="button"
            onClick={() => setActiveView("capabilities")}
            className="flex size-7 cursor-pointer items-center justify-center rounded-full text-muted-foreground outline-none transition-colors hover:bg-foreground/[0.06] hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring"
            aria-label="Back to capabilities"
          >
            <HugeiconsIcon icon={__ArrowLeftHugeIcon} className="size-3.5" />
          </button>
          <span className="text-center text-[13px] font-medium text-foreground">
            {activeOptionDescriptor.label}
          </span>
        </div>
        <div className="min-h-0 overflow-y-auto px-1.5 pb-1.5 app-scrollbar" role="listbox">
          {directlySelectableOptions.map((option) => {
            const isSelected = String(currentValue ?? "") === option.id;
            return (
              <button
                key={option.id}
                type="button"
                role="option"
                aria-selected={isSelected}
                className={cn(
                  "flex min-h-8 w-full cursor-pointer items-center justify-between gap-2 rounded-lg px-2.5 py-1 text-left outline-none transition-colors hover:bg-foreground/[0.055] focus-visible:bg-foreground/[0.055]",
                )}
                onClick={() => {
                  onOptionChange?.(activeOptionDescriptor.id, option.id);
                  setActiveView("capabilities");
                }}
              >
                <span className="min-w-0">
                  <span className="block truncate text-[13px] text-foreground">{option.label}</span>
                  {option.description ? (
                    <span className="block truncate text-[11px] text-muted-foreground">
                      {option.description}
                    </span>
                  ) : null}
                </span>
                {isSelected ? (
                  <HugeiconsIcon icon={__CheckHugeIcon} className="size-3.5 shrink-0 text-foreground" />
                ) : null}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  if (activeView === "models") {
    const maxHeight = Math.max(160, Math.min(288, props.maxAvailableHeightPx ?? 288));
    return (
      <div
        className="flex w-full flex-col overflow-hidden text-popover-foreground"
        style={{ maxHeight }}
      >
        <div className="shrink-0 px-3.5 pb-1.5 pt-2.5 text-[13px] font-medium text-muted-foreground">
          Select model
        </div>
        <div
          data-model-picker-model-list
          className="app-scrollbar scroll-fade-y min-h-0 overflow-y-auto px-1.5 pb-1.5"
          role="listbox"
        >
          {visibleModels.length === 0 ? (
            <div className="px-3 py-5 text-center text-[13px] text-muted-foreground">
              No models available.
            </div>
          ) : (
            visibleModels.map((model, index) => {
              const isSelected =
                props.model === model.slug && activeInstanceId === model.instanceId;
              const modelLabel = getDisplayModelName(model, { preferShortName: true });
              return (
                <div key={`${model.instanceId}:${model.slug}`}>
                  {index > 0 && model.isDefault ? (
                    <div className="mx-3 my-1 h-px bg-border/50" aria-hidden />
                  ) : null}
                  <button
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    className={cn(
                      "flex min-h-8 w-full cursor-pointer items-center justify-between gap-2 rounded-lg px-2.5 py-1 text-left outline-none transition-colors hover:bg-foreground/[0.055] focus-visible:bg-foreground/[0.055]",
                    )}
                    onClick={() => handleModelSelect(model)}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] text-foreground">{modelLabel}</span>
                      {model.isDefault || showInstanceLabel ? (
                        <span className="block truncate text-[11px] text-muted-foreground">
                          {model.isDefault ? "Recommended" : null}
                          {model.isDefault && showInstanceLabel ? " · " : null}
                          {showInstanceLabel ? model.instanceDisplayName : null}
                        </span>
                      ) : null}
                    </span>
                    {isSelected ? (
                      <HugeiconsIcon icon={__CheckHugeIcon} className="size-3.5 shrink-0 text-foreground" />
                    ) : null}
                  </button>
                </div>
              );
            })
          )}
        </div>
      </div>
    );
  }

  const primaryOptions = primaryCapabilityDescriptor
    ? getDirectlySelectableOptions(primaryCapabilityDescriptor)
    : [];
  const currentPrimaryValue = primaryCapabilityDescriptor
    ? getProviderOptionCurrentValue(primaryCapabilityDescriptor)
    : undefined;
  const currentPrimaryIndex = Math.max(
    0,
    primaryOptions.findIndex((option) => option.id === currentPrimaryValue),
  );
  const selectedPrimaryOption = primaryOptions[currentPrimaryIndex];
  const defaultPrimaryOption =
    primaryOptions.find((option) => option.isDefault) ?? primaryOptions[0];
  const effortProgress =
    primaryOptions.length > 1 ? (currentPrimaryIndex / (primaryOptions.length - 1)) * 100 : 0;
  const isSpeedChecked = speedDescriptor
    ? isEnabledSpeedValue(getProviderOptionCurrentValue(speedDescriptor))
    : false;
  const inlineContextDescriptor = secondarySelectDescriptors.find(
    (descriptor) => descriptor.id.toLowerCase() === "contextwindow",
  );
  const remainingSecondarySelectDescriptors = secondarySelectDescriptors.filter(
    (descriptor) => descriptor.id !== inlineContextDescriptor?.id,
  );
  const inlineContextValue = inlineContextDescriptor
    ? getProviderOptionCurrentValue(inlineContextDescriptor)
    : undefined;
  const inlineContextLabel = inlineContextDescriptor
    ? (inlineContextDescriptor.options.find((option) => option.id === inlineContextValue)?.label ??
      String(inlineContextValue ?? "Default"))
    : null;
  const sliderStyle = {
    "--model-picker-effort-progress": `${effortProgress}%`,
  } as CSSProperties;

  return (
    <div className="flex w-full flex-col overflow-hidden text-popover-foreground">
      <div className="px-3 pb-3 pt-2">
        <div className="grid grid-cols-[32px_1fr_32px] items-start gap-1">
          {speedDescriptor ? (
            <button
              type="button"
              aria-label={isSpeedChecked ? "Turn off fast mode" : "Turn on fast mode"}
              aria-pressed={isSpeedChecked}
              onClick={() => handleSpeedToggle(!isSpeedChecked)}
              className={cn(
                "flex size-8 cursor-pointer items-center justify-center rounded-full outline-none transition-colors hover:bg-foreground/[0.06] focus-visible:ring-1 focus-visible:ring-ring",
                isSpeedChecked ? "text-blue-500" : "text-muted-foreground",
              )}
            >
              <HugeiconsIcon icon={__ZapHugeIcon} className="size-4" />
            </button>
          ) : (
            <span aria-hidden />
          )}

          <div className="min-w-0 text-center">
            <button
              type="button"
              onClick={() => setActiveView("models")}
              className="inline-flex max-w-full cursor-pointer items-center justify-center gap-0.5 rounded-lg px-1 text-[13px] font-medium text-blue-500 outline-none transition-colors hover:bg-foreground/[0.05] focus-visible:ring-1 focus-visible:ring-ring"
              aria-label={`Select model. Current model: ${activeModelDisplayLabel}`}
            >
              <span className="truncate">
                {selectedPrimaryOption?.label ?? primaryCapabilityDescriptor?.label ?? "Capabilities"}
              </span>
              <HugeiconsIcon icon={__ArrowRightHugeIcon} className="size-3.5 shrink-0" />
            </button>
            <div className="mt-px flex min-w-0 items-center justify-center gap-1 text-[11px] text-muted-foreground">
              <button
                type="button"
                onClick={() => setActiveView("models")}
                className="min-w-0 cursor-pointer truncate rounded px-0.5 outline-none hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring"
              >
                {activeModelDisplayLabel}
              </button>
              {inlineContextDescriptor && inlineContextLabel ? (
                <>
                  <span aria-hidden>·</span>
                  <button
                    type="button"
                    onClick={() => setActiveView(`option:${inlineContextDescriptor.id}`)}
                    className="flex shrink-0 cursor-pointer items-center gap-0.5 rounded px-0.5 outline-none hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring"
                    aria-label={`${inlineContextDescriptor.label}: ${inlineContextLabel}`}
                  >
                    <span>{inlineContextLabel}</span>
                    <HugeiconsIcon icon={__ArrowRightHugeIcon} className="size-2.5" />
                  </button>
                </>
              ) : null}
            </div>
          </div>

          <button
            type="button"
            aria-label={`Reset ${primaryCapabilityDescriptor?.label ?? "capability"}`}
            disabled={
              !primaryCapabilityDescriptor ||
              !defaultPrimaryOption ||
              defaultPrimaryOption.id === currentPrimaryValue
            }
            onClick={() => {
              if (primaryCapabilityDescriptor && defaultPrimaryOption) {
                onOptionChange?.(primaryCapabilityDescriptor.id, defaultPrimaryOption.id);
              }
            }}
            className="flex size-8 cursor-pointer items-center justify-center rounded-full text-muted-foreground outline-none transition-colors hover:bg-foreground/[0.06] hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-default disabled:opacity-35"
          >
            <HugeiconsIcon icon={__ResetHugeIcon} className="size-4" />
          </button>
        </div>

        {primaryCapabilityDescriptor && primaryOptions.length > 1 ? (
          <div className="relative mt-2 h-6" style={sliderStyle}>
            <div className="absolute inset-0 overflow-hidden rounded-full bg-foreground/[0.13]">
              <div
                className="h-full bg-blue-500"
                style={{ width: "var(--model-picker-effort-progress)" }}
              />
            </div>
            <div
              className="pointer-events-none absolute inset-x-3 top-1/2 flex -translate-y-1/2 items-center justify-between"
              aria-hidden
            >
              {primaryOptions.map((option, index) => (
                <span
                  key={option.id}
                  className={cn(
                    "size-1 rounded-full",
                    index <= currentPrimaryIndex ? "bg-blue-200/60" : "bg-foreground/30",
                  )}
                />
              ))}
            </div>
            <input
              className="model-picker-effort-slider absolute inset-0 z-10 w-full"
              type="range"
              min={0}
              max={primaryOptions.length - 1}
              step={1}
              value={currentPrimaryIndex}
              aria-label={primaryCapabilityDescriptor.label}
              aria-valuetext={selectedPrimaryOption?.label}
              onChange={(event) => {
                const selectedOption = primaryOptions[Number(event.currentTarget.value)];
                if (selectedOption) {
                  onOptionChange?.(primaryCapabilityDescriptor.id, selectedOption.id);
                }
              }}
            />
          </div>
        ) : null}
      </div>

      {remainingSecondarySelectDescriptors.length > 0 || booleanDescriptors.length > 0 ? (
        <div className="border-t border-border/45 px-1.5 py-1">
          {remainingSecondarySelectDescriptors.map((descriptor) => {
            const currentValue = getProviderOptionCurrentValue(descriptor);
            const currentLabel =
              descriptor.options.find((option) => option.id === currentValue)?.label ??
              String(currentValue ?? "Default");
            return (
              <button
                key={descriptor.id}
                type="button"
                className="flex h-8 w-full cursor-pointer items-center justify-between rounded-lg px-2.5 text-left text-[11px] outline-none transition-colors hover:bg-foreground/[0.055] focus-visible:bg-foreground/[0.055]"
                onClick={() => setActiveView(`option:${descriptor.id}`)}
              >
                <span className="font-medium text-foreground">{descriptor.label}</span>
                <span className="flex min-w-0 items-center gap-1 text-muted-foreground">
                  <span className="truncate">{currentLabel}</span>
                  <HugeiconsIcon icon={__ArrowRightHugeIcon} className="size-3.5 shrink-0" />
                </span>
              </button>
            );
          })}
          {booleanDescriptors.map((descriptor) => {
            const isChecked = getProviderOptionCurrentValue(descriptor) === true;
            return (
              <div key={descriptor.id} className="flex h-8 items-center justify-between px-2.5 text-[11px]">
                <span className="font-medium text-foreground">{descriptor.label}</span>
                <Switch
                  checked={isChecked}
                  onCheckedChange={(checked) => onOptionChange?.(descriptor.id, checked)}
                  className="-mr-1 scale-[0.75]"
                  aria-label={descriptor.label}
                />
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
});
