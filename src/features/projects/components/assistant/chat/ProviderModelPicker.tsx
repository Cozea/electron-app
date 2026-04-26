import { HugeiconsIcon } from '@hugeicons/react'
import { ChevronDoubleCloseIcon as __ChevronDownIconHugeIcon } from '@hugeicons/core-free-icons'
import { type ProviderKind, type ServerProvider } from "@cozea/assistant-contracts";
import { resolveSelectableModel } from "@cozea/assistant-shared/model";
import { memo, useMemo, useState } from "react";
import type { VariantProps } from "class-variance-authority";
import { type ProviderPickerKind, PROVIDER_OPTIONS } from "./session-logic";
import { Button, buttonVariants } from "../ui/button";
import {
  Menu,
  MenuGroup,
  MenuItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator as MenuDivider,
  MenuSub,
  MenuSubPopup,
  MenuSubTrigger,
  MenuTrigger,
} from "../ui/menu";
import { ClaudeAI, CursorIcon, Gemini, OpenAI, OpenCodeIcon } from "../Icons";
import type { Icon } from "../Icons";
import { cn } from "@/lib/utils";
import { getProviderSnapshot } from "../../providerModels";
import { usePretextOverflowTitleFor } from "@/hooks/usePretextOverflowTitle";

const PROVIDER_ICON_BY_PROVIDER: Record<ProviderPickerKind, Icon> = {
  codex: OpenAI,
  claudeAgent: ClaudeAI,
  cursor: CursorIcon,
  opencode: OpenCodeIcon,
};

const COMING_SOON_PROVIDER_OPTIONS = [
  { id: "gemini", label: "Gemini", icon: Gemini },
] as const;

function providerIconClassName(
  provider: ProviderKind | ProviderPickerKind,
  fallbackClassName: string,
): string {
  return provider === "claudeAgent" ? "text-[#d97757]" : fallbackClassName;
}

export const ProviderModelPicker = memo(function ProviderModelPicker(props: {
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
}) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const activeProvider = props.lockedProvider ?? props.provider;
  const providerMenuOptions = useMemo(
    () =>
      PROVIDER_OPTIONS.map((option) => {
        const liveProvider = props.providers
          ? getProviderSnapshot(props.providers, option.value)
          : undefined;
        const modelOptions = props.modelOptionsByProvider[option.value];

        if (!props.providers) {
          return {
            ...option,
            modelOptions,
            isSelectable: modelOptions.length > 0,
            unavailableLabel: modelOptions.length > 0 ? null : "Unavailable",
          };
        }

        if (!liveProvider) {
          return {
            ...option,
            modelOptions,
            isSelectable: false,
            unavailableLabel: "Loading",
          };
        }

        if (!liveProvider.enabled || liveProvider.status === "disabled") {
          return {
            ...option,
            modelOptions,
            isSelectable: false,
            unavailableLabel: "Disabled",
          };
        }

        if (!liveProvider.installed) {
          return {
            ...option,
            modelOptions,
            isSelectable: false,
            unavailableLabel: "Not installed",
          };
        }

        if (liveProvider.status === "error") {
          return {
            ...option,
            modelOptions,
            isSelectable: false,
            unavailableLabel: "Unavailable",
          };
        }

        if (modelOptions.length <= 0) {
          return {
            ...option,
            modelOptions,
            isSelectable: false,
            unavailableLabel:
              liveProvider.auth.status === "unauthenticated" ? "Sign in required" : "No models",
          };
        }

        return {
          ...option,
          modelOptions,
          isSelectable: true,
          unavailableLabel: null,
        };
      }),
    [props.modelOptionsByProvider, props.providers],
  );
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
    setIsMenuOpen(false);
  };

  return (
    <Menu
      open={isMenuOpen}
      onOpenChange={(open) => {
        if (props.disabled) {
          setIsMenuOpen(false);
          return;
        }
        setIsMenuOpen(open);
      }}
    >
      <MenuTrigger
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
          <HugeiconsIcon icon={__ChevronDownIconHugeIcon} aria-hidden="true" className="size-3 shrink-0 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100" />
        </span>
      </MenuTrigger>
      <MenuPopup align="start">
        {props.lockedProvider !== null ? (
          <MenuGroup>
            <MenuRadioGroup
              value={props.model}
              onValueChange={(value) => handleModelChange(props.lockedProvider!, value)}
            >
              {props.modelOptionsByProvider[props.lockedProvider].map((modelOption) => (
                <MenuRadioItem
                  key={`${props.lockedProvider}:${modelOption.slug}`}
                  value={modelOption.slug}
                  onClick={() => setIsMenuOpen(false)}
                >
                  {modelOption.name}
                </MenuRadioItem>
              ))}
            </MenuRadioGroup>
          </MenuGroup>
        ) : (
          <>
            {providerMenuOptions.map((option) => {
              const OptionIcon = PROVIDER_ICON_BY_PROVIDER[option.value];
              if (!option.isSelectable) {
                return (
                  <MenuItem key={option.value} disabled>
                    <OptionIcon
                      aria-hidden="true"
                      className={cn(
                        "size-4 shrink-0 opacity-80",
                        providerIconClassName(option.value, "text-muted-foreground/85"),
                      )}
                    />
                    <span>{option.label}</span>
                    <span className="ms-auto text-[11px] text-muted-foreground/80 uppercase tracking-[0.08em]">
                      {option.unavailableLabel}
                    </span>
                  </MenuItem>
                );
              }
              return (
                <MenuSub key={option.value}>
                  <MenuSubTrigger>
                    <OptionIcon
                      aria-hidden="true"
                      className={cn(
                        "size-4 shrink-0",
                        providerIconClassName(option.value, "text-muted-foreground/85"),
                      )}
                    />
                    {option.label}
                  </MenuSubTrigger>
                  <MenuSubPopup className="[--available-height:min(24rem,70vh)]" sideOffset={4}>
                    <MenuGroup>
                      <MenuRadioGroup
                        value={props.provider === option.value ? props.model : ""}
                        onValueChange={(value) => handleModelChange(option.value, value)}
                      >
                        {option.modelOptions.map((modelOption) => (
                          <MenuRadioItem
                            key={`${option.value}:${modelOption.slug}`}
                            value={modelOption.slug}
                            onClick={() => setIsMenuOpen(false)}
                          >
                            {modelOption.name}
                          </MenuRadioItem>
                        ))}
                      </MenuRadioGroup>
                    </MenuGroup>
                  </MenuSubPopup>
                </MenuSub>
              );
            })}
            <MenuDivider />
            {COMING_SOON_PROVIDER_OPTIONS.map((option) => {
              const OptionIcon = option.icon;
              return (
                <MenuItem key={option.id} disabled>
                  <OptionIcon aria-hidden="true" className="size-4 shrink-0 opacity-80" />
                  <span>{option.label}</span>
                  <span className="ms-auto text-[11px] text-muted-foreground/80 uppercase tracking-[0.08em]">
                    Coming soon
                  </span>
                </MenuItem>
              );
            })}
          </>
        )}
      </MenuPopup>
    </Menu>
  );
});
