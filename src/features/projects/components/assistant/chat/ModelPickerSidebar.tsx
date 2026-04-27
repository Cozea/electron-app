import { type ProviderKind, type ServerProvider } from "@cozea/assistant-contracts";
import { memo } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { StarIcon as __StarIconHugeIcon, Clock01Icon as __Clock01IconHugeIcon, MagicWand01Icon as __MagicWand01IconHugeIcon } from "@hugeicons/core-free-icons";
import { Gemini, OpenCodeIcon } from "../Icons";
import { AVAILABLE_PROVIDER_OPTIONS, PROVIDER_ICON_BY_PROVIDER } from "./providerIconUtils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { getProviderSnapshot } from "../../providerModels";

function describeUnavailableProvider(label: string, live: ServerProvider | undefined): string {
  if (!live) {
    return `${label} — waiting for provider status…`;
  }
  if (live.status === "ready") {
    return label;
  }
  const kind =
    live.status === "error"
      ? "Unavailable"
      : live.status === "warning"
        ? "Limited"
        : live.status === "disabled"
          ? "Disabled in settings"
          : "Not ready";
  const msg = live.message?.trim();
  return msg ? `${label} — ${kind}. ${msg}` : `${label} — ${kind}.`;
}

const SELECTED_BUTTON_CLASS = "bg-[var(--sidebar-pill-hover-bg)] text-[var(--sidebar-pill-hover-fg)]";
const SELECTED_INDICATOR_CLASS =
  "pointer-events-none absolute right-0 top-1/2 z-10 h-5 w-0.5 -translate-y-1/2 rounded-l-full bg-primary";
const BADGE_BASE_CLASS =
  "pointer-events-none absolute -right-0.5 top-0.5 z-10 flex size-3.5 items-center justify-center rounded-full bg-transparent shadow-sm ";
const NEW_BADGE_CLASS = `${BADGE_BASE_CLASS} text-amber-600 dark:text-amber-300 `;
const SOON_BADGE_CLASS = `${BADGE_BASE_CLASS} text-muted-foreground `;

const PICKER_TOOLTIP_SIDE = "left" as const;
const PICKER_TOOLTIP_CLASS = "max-w-64 text-balance font-normal leading-snug";
const PICKER_ITEM_CLASS = "relative flex w-full justify-center";
const PICKER_BUTTON_CLASS =
  "relative isolate flex h-10 w-full cursor-pointer items-center justify-center rounded transition-colors hover:bg-[var(--sidebar-pill-hover-bg)] hover:text-[var(--sidebar-pill-hover-fg)]";

export const ModelPickerSidebar = memo(function ModelPickerSidebar(props: {
  selectedProvider: ProviderKind | "favorites";
  onSelectProvider: (provider: ProviderKind | "favorites") => void;
  providers?: ReadonlyArray<ServerProvider>;
}) {
  const handleProviderClick = (provider: ProviderKind | "favorites") => {
    props.onSelectProvider(provider);
  };

  return (
    <div className="flex w-12 shrink-0 flex-col items-center gap-1 overflow-y-auto border-r border-border/40 bg-muted/30 px-1 py-1 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
      {/* Favorites section */}
      <div className={PICKER_ITEM_CLASS}>
        {props.selectedProvider === "favorites" && <div className={SELECTED_INDICATOR_CLASS} />}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              className={cn(
                PICKER_BUTTON_CLASS,
                props.selectedProvider === "favorites" && SELECTED_BUTTON_CLASS,
              )}
              onClick={() => handleProviderClick("favorites")}
              type="button"
              data-model-picker-provider="favorites"
              aria-label="Favorites"
            >
              <HugeiconsIcon icon={__StarIconHugeIcon} className="size-5 fill-current shrink-0" aria-hidden />
            </button>
            </TooltipTrigger>
            <TooltipContent side={PICKER_TOOLTIP_SIDE} align="center" className={PICKER_TOOLTIP_CLASS}>
              Favorites
            </TooltipContent>
          </Tooltip>
        </div>

      <div className="my-0.5 h-px w-full bg-border/40" />

      {/* Provider buttons */}
      {AVAILABLE_PROVIDER_OPTIONS.map((option) => {
        const OptionIcon = PROVIDER_ICON_BY_PROVIDER[option.value];
        const liveProvider = props.providers
          ? getProviderSnapshot(props.providers, option.value)
          : undefined;

        const isDisabled = !liveProvider || liveProvider.status !== "ready";
        const isSelected = props.selectedProvider === option.value;
        const badge = option.pickerSidebarBadge;

        const providerTooltip = isDisabled
          ? describeUnavailableProvider(option.label, liveProvider)
          : badge === "new"
            ? `${option.label} — New`
            : option.label;

        const button = (
          <button
            data-model-picker-provider={option.value}
            className={cn(
              PICKER_BUTTON_CLASS,
              isSelected && SELECTED_BUTTON_CLASS,
              isDisabled && "opacity-50 cursor-not-allowed hover:bg-transparent",
            )}
            onClick={() => !isDisabled && handleProviderClick(option.value)}
            disabled={isDisabled}
            type="button"
            aria-label={
              isDisabled
                ? (providerTooltip ?? option.label)
                : badge === "new"
                  ? `${option.label}, new`
                  : option.label
            }
          >
            <OptionIcon className="size-5 shrink-0" aria-hidden />
            {badge === "new" ? (
              <span className={NEW_BADGE_CLASS} aria-hidden>
                <HugeiconsIcon icon={__MagicWand01IconHugeIcon} className="size-2" />
              </span>
            ) : badge === "soon" ? (
              <span className={SOON_BADGE_CLASS} aria-hidden>
                <HugeiconsIcon icon={__Clock01IconHugeIcon} className="size-2" />
              </span>
            ) : null}
          </button>
        );

        const trigger = isDisabled ? (
          <span className="relative block h-10 w-full">{button}</span>
        ) : (
          button
        );

        return (
          <div key={option.value} className={PICKER_ITEM_CLASS}>
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

      {/* Gemini button (coming soon) */}
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
      {/* Github Copilot button (coming soon) */}
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
    </div>
  );
});
