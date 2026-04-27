import { type ProviderKind, type ServerProvider } from "@cozea/assistant-contracts";
import { memo } from "react";
import type { VariantProps } from "class-variance-authority";
import { HugeiconsIcon } from "@hugeicons/react";
import { ChevronDoubleCloseIcon as __ChevronDownIconHugeIcon } from "@hugeicons/core-free-icons";
import { Button, buttonVariants } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  type ModelEsque,
  PROVIDER_ICON_BY_PROVIDER,
  getTriggerDisplayModelLabel,
  getTriggerDisplayModelName,
} from "./providerIconUtils";
import { usePretextOverflowTitleFor } from "@/hooks/usePretextOverflowTitle";

interface ProviderModelPickerProps {
  provider: ProviderKind;
  model: string;
  lockedProvider: ProviderKind | null;
  providers?: ReadonlyArray<ServerProvider>;
  modelOptionsByProvider: Record<ProviderKind, ReadonlyArray<ModelEsque>>;
  activeProviderIconClassName?: string;
  compact?: boolean;
  disabled?: boolean;
  terminalOpen?: boolean;
  open?: boolean;
  triggerVariant?: VariantProps<typeof buttonVariants>["variant"];
  triggerClassName?: string;
  onOpenChange?: (open: boolean) => void;
  onProviderModelChange: (provider: ProviderKind, model: string) => void;
}

export const ProviderModelPicker = memo(function ProviderModelPicker(props: ProviderModelPickerProps) {
  const activeProvider = props.lockedProvider ?? props.provider;
  const selectedProviderOptions = props.modelOptionsByProvider[activeProvider];
  
  const selectedModel =
    selectedProviderOptions?.find((option) => option.slug === props.model) ??
    selectedProviderOptions?.[0];
  
  const ProviderIcon = PROVIDER_ICON_BY_PROVIDER[activeProvider];
  const triggerTitle = selectedModel ? getTriggerDisplayModelName(selectedModel) : props.model;
  const triggerLabel = selectedModel ? getTriggerDisplayModelLabel(selectedModel) : props.model;

  const { containerRef, getOverflowTitle } = usePretextOverflowTitleFor<HTMLSpanElement>({
    font: "14px Inter",
  });
  const overflowTitle = getOverflowTitle(triggerLabel, 0);

  return (
    <Button
      size="sm"
      variant={props.triggerVariant ?? "ghost"}
      data-chat-provider-model-picker="true"
      className={cn(
        "min-w-0 justify-start overflow-hidden whitespace-nowrap px-2 text-muted-foreground/70 hover:text-foreground/80 [&_svg]:mx-0",
        props.compact ? "max-w-42 shrink-0" : "max-w-48 shrink sm:max-w-56 sm:px-3",
        props.triggerClassName,
      )}
      disabled={props.disabled}
      onClick={() => props.onOpenChange?.(!props.open)}
    >
      <span
        className={cn(
          "flex min-w-0 w-full box-border items-center gap-2 overflow-hidden",
          props.compact ? "max-w-36 sm:pl-1" : undefined,
        )}
      >
        <ProviderIcon
          aria-hidden="true"
          className={cn("size-4 shrink-0", props.activeProviderIconClassName)}
        />
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              ref={containerRef}
              className="min-w-0 flex-1 truncate"
            >
              {triggerTitle}
            </span>
          </TooltipTrigger>
          {overflowTitle && <TooltipContent side="top">{overflowTitle}</TooltipContent>}
        </Tooltip>
        <HugeiconsIcon icon={__ChevronDownIconHugeIcon} aria-hidden="true" className="size-3 shrink-0 opacity-60" />
      </span>
    </Button>
  );
});
