import { HugeiconsIcon } from "@hugeicons/react";
import {
  CheckmarkCircle02Icon as __CheckIconHugeIcon,
  ChevronDoubleCloseIcon as __ChevronDownIconHugeIcon,
} from "@hugeicons/core-free-icons";
import { memo, useEffect, useMemo, useState } from "react";
import type { VariantProps } from "class-variance-authority";
import { type ProviderKind, type ServerProvider } from "@cozea/assistant-contracts";
import { resolveSelectableModel } from "@cozea/assistant-shared/model";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { usePretextOverflowTitleFor } from "@/hooks/usePretextOverflowTitle";

import { getProviderSnapshot } from "../../providerModels";
import { Button, buttonVariants } from "../ui/button";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { ClaudeAI, CursorIcon, Gemini, OpenAI, OpenCodeIcon } from "../Icons";
import type { Icon } from "../Icons";
import { type ProviderPickerKind, PROVIDER_OPTIONS } from "./session-logic";

interface ProviderModelPickerProps {
  provider: ProviderKind;
  model: string;
  lockedProvider: ProviderKind | null;
  providers?: ReadonlyArray<ServerProvider>;
  modelOptionsByProvider: Record<ProviderKind, ReadonlyArray<{ slug: string; name: string }>>;
  activeProviderIconClassName?: string;
  compact?: boolean;
  disabled?: boolean;
  triggerVariant?: VariantProps<typeof buttonVariants>["variant"];
  triggerClassName?: string;
  onProviderModelChange: (provider: ProviderKind, model: string) => void;
}

interface ProviderModelPickerOption {
  value: ProviderKind;
  label: string;
  icon: Icon;
  modelOptions: ReadonlyArray<{ slug: string; name: string }>;
  isSelectable: boolean;
  unavailableLabel: string | null;
}

const PROVIDER_ICON_BY_PROVIDER: Record<ProviderPickerKind, Icon> = {
  codex: OpenAI,
  claudeAgent: ClaudeAI,
  cursor: CursorIcon,
  opencode: OpenCodeIcon,
};

const COMING_SOON_PROVIDER_OPTIONS = [{ id: "gemini", label: "Gemini", icon: Gemini }] as const;

function providerIconClassName(
  provider: ProviderKind | ProviderPickerKind,
  fallbackClassName: string,
): string {
  return provider === "claudeAgent" ? "text-[#d97757]" : fallbackClassName;
}

function matchesSearch(
  query: string,
  option: ProviderModelPickerOption,
  modelOption: { slug: string; name: string },
): boolean {
  if (!query) {
    return true;
  }
  const haystack = `${option.label} ${modelOption.name} ${modelOption.slug}`.toLowerCase();
  return haystack.includes(query);
}

export const ProviderModelPicker = memo(function ProviderModelPicker(
  props: ProviderModelPickerProps,
) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const activeProvider = props.lockedProvider ?? props.provider;
  const [providerFilter, setProviderFilter] = useState<ProviderKind>(activeProvider);

  useEffect(() => {
    setProviderFilter(activeProvider);
  }, [activeProvider]);

  useEffect(() => {
    if (!isOpen) {
      setSearchQuery("");
    }
  }, [isOpen]);

  const providerMenuOptions = useMemo<ReadonlyArray<ProviderModelPickerOption>>(
    () =>
      PROVIDER_OPTIONS.map((option) => {
        const liveProvider = props.providers
          ? getProviderSnapshot(props.providers, option.value)
          : undefined;
        const modelOptions = props.modelOptionsByProvider[option.value];

        if (!props.providers) {
          return {
            ...option,
            icon: PROVIDER_ICON_BY_PROVIDER[option.value],
            modelOptions,
            isSelectable: modelOptions.length > 0,
            unavailableLabel: modelOptions.length > 0 ? null : "Unavailable",
          };
        }

        if (!liveProvider) {
          return {
            ...option,
            icon: PROVIDER_ICON_BY_PROVIDER[option.value],
            modelOptions,
            isSelectable: false,
            unavailableLabel: "Loading",
          };
        }

        if (!liveProvider.enabled || liveProvider.status === "disabled") {
          return {
            ...option,
            icon: PROVIDER_ICON_BY_PROVIDER[option.value],
            modelOptions,
            isSelectable: false,
            unavailableLabel: "Disabled",
          };
        }

        if (!liveProvider.installed) {
          return {
            ...option,
            icon: PROVIDER_ICON_BY_PROVIDER[option.value],
            modelOptions,
            isSelectable: false,
            unavailableLabel: "Not installed",
          };
        }

        if (liveProvider.status === "error") {
          return {
            ...option,
            icon: PROVIDER_ICON_BY_PROVIDER[option.value],
            modelOptions,
            isSelectable: false,
            unavailableLabel: "Unavailable",
          };
        }

        if (modelOptions.length <= 0) {
          return {
            ...option,
            icon: PROVIDER_ICON_BY_PROVIDER[option.value],
            modelOptions,
            isSelectable: false,
            unavailableLabel:
              liveProvider.auth.status === "unauthenticated" ? "Sign in required" : "No models",
          };
        }

        return {
          ...option,
          icon: PROVIDER_ICON_BY_PROVIDER[option.value],
          modelOptions,
          isSelectable: true,
          unavailableLabel: null,
        };
      }),
    [props.modelOptionsByProvider, props.providers],
  );

  const selectableProviders = providerMenuOptions.filter((option) => option.isSelectable);
  const unavailableProviders = providerMenuOptions.filter((option) => !option.isSelectable);
  const normalizedQuery = searchQuery.trim().toLowerCase();
  const selectedProviderOption =
    providerMenuOptions.find((option) => option.value === providerFilter) ??
    providerMenuOptions.find((option) => option.value === activeProvider) ??
    providerMenuOptions[0];

  const visibleGroups = useMemo(() => {
    if (props.lockedProvider !== null) {
      const lockedOption = providerMenuOptions.find(
        (option) => option.value === props.lockedProvider,
      );
      if (!lockedOption) {
        return [];
      }
      return [
        {
          option: lockedOption,
          models: lockedOption.modelOptions.filter((modelOption) =>
            matchesSearch(normalizedQuery, lockedOption, modelOption),
          ),
        },
      ];
    }

    if (!normalizedQuery) {
      return selectedProviderOption
        ? [
            {
              option: selectedProviderOption,
              models: selectedProviderOption.modelOptions,
            },
          ]
        : [];
    }

    return selectableProviders.flatMap((option) => {
      const matchingModels = option.modelOptions.filter((modelOption) =>
        matchesSearch(normalizedQuery, option, modelOption),
      );
      if (matchingModels.length > 0) {
        return [{ option, models: matchingModels }];
      }
      if (option.label.toLowerCase().includes(normalizedQuery)) {
        return [{ option, models: option.modelOptions }];
      }
      return [];
    });
  }, [
    normalizedQuery,
    props.lockedProvider,
    providerMenuOptions,
    selectableProviders,
    selectedProviderOption,
  ]);

  const selectedProviderOptions = props.modelOptionsByProvider[activeProvider];
  const selectedModelLabel =
    selectedProviderOptions.find((option) => option.slug === props.model)?.name ?? props.model;
  const { containerRef, getOverflowTitle } = usePretextOverflowTitleFor<HTMLSpanElement>({
    font: "13px Inter",
  });
  const selectedModelTitle = useMemo(() => {
    const reservedWidth = 16 + 8 + 12 + 8;
    return getOverflowTitle(selectedModelLabel, reservedWidth);
  }, [getOverflowTitle, selectedModelLabel]);
  const ProviderIcon = PROVIDER_ICON_BY_PROVIDER[activeProvider];

  const handleModelChange = (provider: ProviderKind, value: string) => {
    if (props.disabled) return;
    if (!value) return;
    const resolvedModel = resolveSelectableModel(
      provider,
      value,
      props.modelOptionsByProvider[provider],
    );
    if (!resolvedModel) return;
    props.onProviderModelChange(provider, resolvedModel);
    setIsOpen(false);
  };

  return (
    <Popover
      open={isOpen}
      onOpenChange={(open) => {
        if (props.disabled) {
          setIsOpen(false);
          return;
        }
        setIsOpen(open);
      }}
    >
      <PopoverTrigger
        render={
          <Button
            size="sm"
            variant={props.triggerVariant ?? "ghost"}
            className={cn(
              "group min-w-0 justify-start overflow-hidden whitespace-nowrap px-2 text-muted-foreground/70 hover:text-foreground/80 [&_svg]:mx-0",
              props.compact ? "max-w-42 shrink-0" : "max-w-48 shrink sm:max-w-56 sm:px-3",
              props.triggerClassName,
            )}
            disabled={props.disabled}
          />
        }
      >
        <span
          ref={containerRef}
          className={cn(
            "flex min-w-0 w-full items-center gap-2 overflow-hidden",
            props.compact ? "max-w-36" : undefined,
          )}
        >
          <ProviderIcon
            aria-hidden="true"
            className={cn(
              "size-4 shrink-0",
              providerIconClassName(activeProvider, "text-muted-foreground/70"),
              props.activeProviderIconClassName,
            )}
          />
          <span className="min-w-0 flex-1 truncate" title={selectedModelTitle}>
            {selectedModelLabel}
          </span>
          <HugeiconsIcon
            icon={__ChevronDownIconHugeIcon}
            aria-hidden="true"
            className="size-3 shrink-0 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100"
          />
        </span>
      </PopoverTrigger>

      <PopoverPopup
        align="start"
        sideOffset={6}
        className="w-[min(36rem,calc(100vw-1.5rem))] p-0 [--viewport-inline-padding:0]"
      >
        <div className="flex min-h-0 flex-col">
          <div className="border-b border-border/60 px-3 py-3">
            <Input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search models or providers"
              className="h-8 border-border/60 bg-background/80 text-sm"
              autoFocus
            />
          </div>

          {props.lockedProvider === null ? (
            <div className="border-b border-border/60 px-3 py-2">
              <div className="flex flex-wrap gap-1.5">
                {selectableProviders.map((option) => {
                  const OptionIcon = option.icon;
                  const isActive = option.value === providerFilter;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[11px] transition-colors",
                        isActive
                          ? "border-border bg-accent text-foreground"
                          : "border-transparent bg-secondary/70 text-muted-foreground hover:bg-accent/80 hover:text-foreground",
                      )}
                      onClick={() => setProviderFilter(option.value)}
                    >
                      <OptionIcon
                        className={cn(
                          "size-3.5 shrink-0",
                          providerIconClassName(option.value, "text-muted-foreground/80"),
                        )}
                      />
                      <span>{option.label}</span>
                    </button>
                  );
                })}
              </div>
              {unavailableProviders.length > 0 ? (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {unavailableProviders.map((option) => {
                    const OptionIcon = option.icon;
                    return (
                      <span
                        key={`${option.value}:unavailable`}
                        className="inline-flex items-center gap-1.5 rounded-full border border-transparent bg-secondary/55 px-2 py-1 text-[11px] text-muted-foreground/65"
                        title={option.unavailableLabel ?? undefined}
                      >
                        <OptionIcon
                          className={cn(
                            "size-3.5 shrink-0 opacity-80",
                            providerIconClassName(option.value, "text-muted-foreground/70"),
                          )}
                        />
                        <span>{option.label}</span>
                        <span className="uppercase tracking-[0.08em]">
                          {option.unavailableLabel}
                        </span>
                      </span>
                    );
                  })}
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="max-h-[22rem] overflow-y-auto px-2 py-2">
            {visibleGroups.length === 0 ? (
              <div className="px-2 py-6 text-center text-sm text-muted-foreground">
                No matching models.
              </div>
            ) : (
              <div className="space-y-3">
                {visibleGroups.map(({ option, models }) => {
                  const OptionIcon = option.icon;
                  return (
                    <div key={`group:${option.value}`} className="space-y-1">
                      {props.lockedProvider === null &&
                      (normalizedQuery.length > 0 || visibleGroups.length > 1) ? (
                        <div className="flex items-center gap-2 px-2 pt-1 pb-0.5">
                          <OptionIcon
                            className={cn(
                              "size-3.5 shrink-0",
                              providerIconClassName(option.value, "text-muted-foreground/75"),
                            )}
                          />
                          <p className="text-[10px] font-medium uppercase tracking-[0.1em] text-muted-foreground/70">
                            {option.label}
                          </p>
                        </div>
                      ) : null}

                      <div className="space-y-0.5">
                        {models.map((modelOption) => {
                          const isSelected =
                            props.provider === option.value && props.model === modelOption.slug;
                          return (
                            <button
                              key={`${option.value}:${modelOption.slug}`}
                              type="button"
                              className={cn(
                                "flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left transition-colors",
                                isSelected
                                  ? "bg-accent text-foreground"
                                  : "text-muted-foreground hover:bg-accent/70 hover:text-foreground",
                              )}
                              onClick={() => handleModelChange(option.value, modelOption.slug)}
                            >
                              <OptionIcon
                                className={cn(
                                  "mt-0.5 size-4 shrink-0",
                                  providerIconClassName(option.value, "text-muted-foreground/75"),
                                )}
                              />
                              <div className="min-w-0 flex-1">
                                <div className="truncate text-sm">{modelOption.name}</div>
                                <div className="truncate text-[11px] text-muted-foreground/70">
                                  {normalizedQuery ? `${option.label} • ${modelOption.slug}` : modelOption.slug}
                                </div>
                              </div>
                              {isSelected ? (
                                <HugeiconsIcon
                                  icon={__CheckIconHugeIcon}
                                  className="size-4 shrink-0 text-foreground/85"
                                />
                              ) : null}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="border-t border-border/60 px-3 py-2">
            <div className="flex flex-wrap gap-1.5">
              {COMING_SOON_PROVIDER_OPTIONS.map((option) => {
                const OptionIcon = option.icon;
                return (
                  <span
                    key={option.id}
                    className="inline-flex items-center gap-1.5 rounded-full border border-transparent bg-secondary/55 px-2 py-1 text-[11px] text-muted-foreground/65"
                  >
                    <OptionIcon aria-hidden="true" className="size-3.5 shrink-0 opacity-80" />
                    <span>{option.label}</span>
                    <span className="uppercase tracking-[0.08em]">Coming soon</span>
                  </span>
                );
              })}
            </div>
          </div>
        </div>
      </PopoverPopup>
    </Popover>
  );
});
