import { type ProviderDriverKind, type ProviderInstanceId, type ProviderKind } from "@cozea/assistant-contracts";
import { memo } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { StarIcon as __StarIconHugeIcon } from "@hugeicons/core-free-icons";
import {
  getDisplayModelName,
  getTriggerDisplayModelLabel,
  type ModelEsque,
  PROVIDER_ICON_BY_PROVIDER,
} from "./providerIconUtils";
import { ComboboxItem } from "@/components/ui/combobox";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export const ModelListRow = memo(function ModelListRow(props: {
  index: number;
  model: ModelEsque;
  instanceId: ProviderInstanceId;
  driverKind: ProviderDriverKind;
  providerDisplayName: string;
  providerAccentColor?: string;
  isFavorite: boolean;
  showProvider: boolean;
  preferShortName?: boolean;
  useTriggerLabel?: boolean;
  showNewBadge?: boolean;
  jumpLabel?: string | null;
  onToggleFavorite: () => void;
}) {
  const ProviderIcon = PROVIDER_ICON_BY_PROVIDER[props.driverKind as ProviderKind] ?? null;
  const providerLabel = props.model.subProvider
    ? `${props.providerDisplayName} · ${props.model.subProvider}`
    : props.providerDisplayName;

  return (
    <ComboboxItem
      hideIndicator
      index={props.index}
      value={`${props.instanceId}:${props.model.slug}`}
      contentClassName="flex w-full items-start gap-2"
      className={cn(
        "w-full cursor-pointer rounded px-3 py-2 transition-colors group",
        "data-highlighted:bg-muted data-selected:bg-accent data-selected:text-foreground",
      )}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            className="mt-0.5 shrink-0 cursor-pointer opacity-40 transition-opacity group-hover:opacity-100"
            onClick={(event) => {
              event.stopPropagation();
              props.onToggleFavorite();
            }}
            onKeyDown={(event) => {
              event.stopPropagation();
            }}
            type="button"
            aria-label={props.isFavorite ? "Remove from favorites" : "Add to favorites"}
          >
            <HugeiconsIcon
              icon={__StarIconHugeIcon}
              className={cn("size-4", props.isFavorite && "fill-current text-yellow-500")}
            />
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" align="center">
          {props.isFavorite ? "Remove from favorites" : "Add to favorites"}
        </TooltipContent>
      </Tooltip>

      <div className="min-w-0 flex-1 text-left">
        <div className="flex items-center justify-between gap-2 min-w-0">
          <div className="text-xs font-medium leading-snug flex items-center gap-2 min-w-0">
            <span className="truncate">
              {props.useTriggerLabel
                ? getTriggerDisplayModelLabel(props.model)
                : getDisplayModelName(
                    props.model,
                    props.preferShortName ? { preferShortName: true } : undefined,
                  )}
            </span>
            {props.showNewBadge ? (
              <span
                className="shrink-0 rounded border border-amber-500/35 bg-amber-500/15 px-0.5 py-px text-[10px] font-bold uppercase leading-none tracking-wide text-amber-800 dark:border-amber-400/30 dark:bg-amber-400/12 dark:text-amber-200"
                aria-label="New model"
              >
                New
              </span>
            ) : null}
          </div>
          {props.jumpLabel ? (
            <span className="h-4 min-w-0 shrink-0 rounded-sm px-1.5 text-[10px] bg-muted text-muted-foreground font-mono">
              {props.jumpLabel}
            </span>
          ) : null}
        </div>
        {props.showProvider && (
          <div className="flex items-center gap-1 mt-0.5">
            {ProviderIcon ? <ProviderIcon className="size-3 shrink-0" /> : null}
            {props.providerAccentColor ? (
              <span
                className="size-1.5 shrink-0 rounded-full"
                style={{ backgroundColor: props.providerAccentColor }}
                aria-hidden
              />
            ) : null}
            <span className="text-xs font-normal leading-snug text-muted-foreground/70 truncate">
              {providerLabel}
            </span>
          </div>
        )}
      </div>
    </ComboboxItem>
  );
});
