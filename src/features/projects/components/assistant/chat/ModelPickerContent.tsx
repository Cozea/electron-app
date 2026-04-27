import {
  type ProviderKind,
  type ServerProvider,
} from "@cozea/assistant-contracts";
import { resolveSelectableModel } from "@cozea/assistant-shared/model";
import { memo, useMemo, useState, useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { Search01Icon as __SearchIconHugeIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { ModelListRow } from "./ModelListRow";
import { ModelPickerSidebar } from "./ModelPickerSidebar";
import { isModelPickerNewModel } from "./modelPickerModelHighlights";
import { buildModelPickerSearchText, scoreModelPickerSearch } from "./modelPickerSearch";
import { Combobox, ComboboxEmpty, ComboboxInput, ComboboxListVirtualized } from "@/components/ui/combobox";
import { type ModelEsque, PROVIDER_ICON_BY_PROVIDER } from "./providerIconUtils";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import { Schema } from "effect";
import { cn } from "@/lib/utils";
import { TooltipProvider } from "@/components/ui/tooltip";

type ModelPickerItem = {
  slug: string;
  name: string;
  shortName?: string;
  subProvider?: string;
  provider: ProviderKind;
};

const EMPTY_MODEL_JUMP_LABELS = new Map<string, string>();

const FavoritesSchema = Schema.Array(Schema.Struct({
  provider: Schema.String as unknown as Schema.Schema<ProviderKind>,
  model: Schema.String,
}));

export const ModelPickerContent = memo(function ModelPickerContent(props: {
  provider: ProviderKind;
  model: string;
  lockedProvider: ProviderKind | null;
  providers?: ReadonlyArray<ServerProvider>;
  modelOptionsByProvider: Record<ProviderKind, ReadonlyArray<ModelEsque>>;
  terminalOpen: boolean;
  onRequestClose?: () => void;
  onProviderModelChange: (provider: ProviderKind, model: string) => void;
}) {
  const { modelOptionsByProvider, onProviderModelChange } = props;
  const [searchQuery, setSearchQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);
  const listRegionRef = useRef<HTMLDivElement>(null);
  const [favorites, setFavorites] = useLocalStorage<Array<{ provider: ProviderKind; model: string }>>("cozea:favorites", [], FavoritesSchema);

  const [selectedProvider, setSelectedProvider] = useState<ProviderKind | "favorites">(() => {
    if (props.lockedProvider !== null) {
      return props.lockedProvider;
    }
    return favorites.length > 0 ? "favorites" : props.provider;
  });

  const focusSearchInput = useCallback(() => {
    searchInputRef.current?.focus({ preventScroll: true });
  }, []);

  const handleSelectProvider = useCallback(
    (provider: ProviderKind | "favorites") => {
      setSelectedProvider(provider);
      window.requestAnimationFrame(() => {
        focusSearchInput();
      });
    },
    [focusSearchInput],
  );

  useLayoutEffect(() => {
    focusSearchInput();
    const frame = window.requestAnimationFrame(() => {
      focusSearchInput();
    });
    const timeout = window.setTimeout(() => {
      focusSearchInput();
    }, 0);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timeout);
    };
  }, [focusSearchInput]);

  const favoritesSet = useMemo(() => {
    return new Set(favorites.map((fav) => `${fav.provider}:${fav.model}`));
  }, [favorites]);
  const favoriteOrder = useMemo(() => {
    return new Map(
      favorites.map((favorite, index) => [`${favorite.provider}:${favorite.model}`, index]),
    );
  }, [favorites]);

  const readyProviderSet = useMemo(() => {
    if (!props.providers || props.providers.length === 0) {
      return null;
    }
    return new Set(
      props.providers
        .filter((provider) => provider.status === "ready")
        .map((provider) => provider.provider),
    );
  }, [props.providers]);

  const flatModels = useMemo(() => {
    return Object.entries(props.modelOptionsByProvider).flatMap(([providerKind, models]) => {
      if (readyProviderSet && !readyProviderSet.has(providerKind as ProviderKind)) {
        return [];
      }
      return models.map((m) => ({
        slug: m.slug,
        name: m.name,
        ...(m.shortName ? { shortName: m.shortName } : {}),
        ...(m.subProvider ? { subProvider: m.subProvider } : {}),
        provider: providerKind as ProviderKind,
      })) satisfies Array<ModelPickerItem>;
    });
  }, [props.modelOptionsByProvider, readyProviderSet]);

  const filteredModels = useMemo(() => {
    let result = flatModels;

    if (searchQuery.trim()) {
      const rankedMatches = result
        .map((model) => ({
          model,
          score: scoreModelPickerSearch(
            {
              ...model,
              isFavorite: favoritesSet.has(`${model.provider}:${model.slug}`),
            },
            searchQuery,
          ),
          isFavorite: favoritesSet.has(`${model.provider}:${model.slug}`),
          tieBreaker: buildModelPickerSearchText(model),
        }))
        .filter(
          (
            rankedModel,
          ): rankedModel is {
            model: ModelPickerItem;
            score: number;
            isFavorite: boolean;
            tieBreaker: string;
          } => rankedModel.score !== null,
        );

      if (props.lockedProvider !== null) {
        return rankedMatches
          .filter((rankedModel) => rankedModel.model.provider === props.lockedProvider)
          .toSorted((a, b) => {
            const scoreDelta = a.score - b.score;
            if (scoreDelta !== 0) {
              return scoreDelta;
            }
            if (a.isFavorite !== b.isFavorite) {
              return a.isFavorite ? -1 : 1;
            }
            return a.tieBreaker.localeCompare(b.tieBreaker);
          })
          .map((rankedModel) => rankedModel.model);
      }

      return rankedMatches
        .toSorted((a, b) => {
          const scoreDelta = a.score - b.score;
          if (scoreDelta !== 0) {
            return scoreDelta;
          }
          if (a.isFavorite !== b.isFavorite) {
            return a.isFavorite ? -1 : 1;
          }
          return a.tieBreaker.localeCompare(b.tieBreaker);
        })
        .map((rankedModel) => rankedModel.model);
    }

    if (props.lockedProvider !== null) {
      result = result.filter((m) => m.provider === props.lockedProvider);
    } else if (selectedProvider === "favorites") {
      result = result.filter((m) => favoritesSet.has(`${m.provider}:${m.slug}`));
    } else {
      result = result.filter((m) => m.provider === selectedProvider);
    }

    return result.toSorted((a, b) => {
      const aOrder = favoriteOrder.get(`${a.provider}:${a.slug}`);
      const bOrder = favoriteOrder.get(`${b.provider}:${b.slug}`);

      if (aOrder !== undefined && bOrder !== undefined) {
        return aOrder - bOrder;
      }
      if (aOrder !== undefined) {
        return -1;
      }
      if (bOrder !== undefined) {
        return 1;
      }
      return 0;
    });
  }, [
    favoriteOrder,
    favoritesSet,
    flatModels,
    props.lockedProvider,
    searchQuery,
    selectedProvider,
  ]);

  const handleModelSelect = useCallback(
    (modelSlug: string, provider: ProviderKind) => {
      const resolvedModel = resolveSelectableModel(
        provider,
        modelSlug,
        modelOptionsByProvider[provider] as any,
      );
      if (resolvedModel) {
        onProviderModelChange(provider, resolvedModel);
      }
    },
    [modelOptionsByProvider, onProviderModelChange],
  );

  const toggleFavorite = useCallback(
    (provider: ProviderKind, model: string) => {
      setFavorites((prev) => {
        const newFavorites = [...prev];
        const index = newFavorites.findIndex((f) => f.provider === provider && f.model === model);
        if (index >= 0) {
          newFavorites.splice(index, 1);
        } else {
          newFavorites.push({ provider, model });
        }
        return newFavorites;
      });
    },
    [setFavorites],
  );

  const isLocked = props.lockedProvider !== null;
  const isSearching = searchQuery.trim().length > 0;
  const showSidebar = !isLocked && !isSearching;
  const LockedProviderIcon =
    isLocked && props.lockedProvider ? PROVIDER_ICON_BY_PROVIDER[props.lockedProvider] : null;
  
  const modelJumpCommandByKey = useMemo(() => {
    const mapping = new Map<string, string>();
    for (const [visibleModelIndex, model] of filteredModels.entries()) {
      if (visibleModelIndex < 9) {
        mapping.set(`${model.provider}:${model.slug}`, `modelPicker.jump.${visibleModelIndex + 1}`);
      }
    }
    return mapping;
  }, [filteredModels]);

  const modelJumpModelKeys = useMemo(
    () => [...modelJumpCommandByKey.keys()],
    [modelJumpCommandByKey],
  );
  
  const modelJumpLabelByKey = useMemo((): ReadonlyMap<string, string> => {
    if (modelJumpCommandByKey.size === 0) {
      return EMPTY_MODEL_JUMP_LABELS;
    }
    const mapping = new Map<string, string>();
    for (const [modelKey, command] of modelJumpCommandByKey) {
      const indexMatch = command.match(/jump\.(\d)$/);
      if (indexMatch) {
        mapping.set(modelKey, `⌘${indexMatch[1]}`);
      }
    }
    return mapping.size > 0 ? mapping : EMPTY_MODEL_JUMP_LABELS;
  }, [modelJumpCommandByKey]);

  useEffect(() => {
    const onWindowKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat) {
        return;
      }
      
      if ((event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey) {
        const digit = parseInt(event.key, 10);
        if (digit >= 1 && digit <= 9) {
          const jumpIndex = digit - 1;
          const targetModelKey = modelJumpModelKeys[jumpIndex];
          if (targetModelKey) {
            const [provider, slug] = targetModelKey.split(":") as [ProviderKind, string];
            event.preventDefault();
            event.stopPropagation();
            handleModelSelect(slug, provider);
          }
        }
      }
    };

    window.addEventListener("keydown", onWindowKeyDown, true);
    return () => window.removeEventListener("keydown", onWindowKeyDown, true);
  }, [handleModelSelect, modelJumpModelKeys]);

  useLayoutEffect(() => {
    const listRegion = listRegionRef.current;
    if (!listRegion) {
      return;
    }

    let cancelled = false;
    let frame = 0;
    let nestedFrame = 0;
    let timeout = 0;

    const measureScrollArea = () => {
      if (cancelled) {
        return;
      }
      const viewport = listRegion;
      if (viewport.scrollHeight <= viewport.clientHeight) {
        return;
      }
      const originalScrollTop = viewport.scrollTop;
      const maxScrollTop = viewport.scrollHeight - viewport.clientHeight;
      if (maxScrollTop <= 0) {
        return;
      }
      viewport.scrollTop = Math.min(originalScrollTop + 1, maxScrollTop);
      viewport.scrollTop = originalScrollTop;
    };

    queueMicrotask(measureScrollArea);
    frame = window.requestAnimationFrame(() => {
      measureScrollArea();
      nestedFrame = window.requestAnimationFrame(measureScrollArea);
    });
    timeout = window.setTimeout(measureScrollArea, 0);

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
      window.cancelAnimationFrame(nestedFrame);
      window.clearTimeout(timeout);
    };
  }, [filteredModels.length]);

  return (
    <TooltipProvider delayDuration={0}>
      <div
        className={cn(
          "relative flex w-full h-full overflow-hidden text-popover-foreground",
          isLocked ? "flex-col" : "flex-row",
        )}
      >
        {isLocked && LockedProviderIcon && props.lockedProvider && (
          <div className="flex items-center gap-2 px-4 py-3 border-b border-border/40">
            <LockedProviderIcon className="size-4 shrink-0" />
            <span className="text-sm font-medium">Select a model</span>
          </div>
        )}

        {showSidebar && (
          <ModelPickerSidebar
            selectedProvider={selectedProvider}
            onSelectProvider={handleSelectProvider}
            providers={props.providers}
          />
        )}

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <Combobox
            open
            disabled={false}
            value={`${props.provider}:${props.model}`}
            onValueChange={(value) => {
              if (!value) return;
              const [provider, slug] = value.split(":") as [ProviderKind, string];
              handleModelSelect(slug, provider);
            }}
          >
            <div className="relative border-b border-border/40">
              <ComboboxInput
                ref={searchInputRef}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search models..."
                showTrigger={false}
                showClear={false}
                startAddon={<HugeiconsIcon icon={__SearchIconHugeIcon} className="size-4 opacity-50" />}
                className="w-full px-2 py-2.5 text-sm"
                inputClassName="bg-transparent border-0 outline-none focus-visible:ring-0 shadow-none !pl-10"
              />
            </div>
            <div
              ref={listRegionRef}
              className="relative min-h-0 flex-1 w-full overflow-y-auto overscroll-contain"
            >
              <ComboboxListVirtualized className="min-h-full">
                {filteredModels.length === 0 ? (
                  <ComboboxEmpty className="py-6">No matching models found.</ComboboxEmpty>
                ) : (
                  filteredModels.map((model, index) => {
                    const isFav = favoritesSet.has(`${model.provider}:${model.slug}`);
                    return (
                      <ModelListRow
                        key={`${model.provider}:${model.slug}`}
                        index={index}
                        model={model}
                        provider={model.provider}
                        isFavorite={isFav}
                        showProvider={isSearching || selectedProvider === "favorites"}
                        showNewBadge={isModelPickerNewModel(model.provider, model.slug)}
                        jumpLabel={modelJumpLabelByKey.get(`${model.provider}:${model.slug}`)}
                        onToggleFavorite={() => toggleFavorite(model.provider, model.slug)}
                        preferShortName={!isSearching}
                      />
                    );
                  })
                )}
              </ComboboxListVirtualized>
            </div>
          </Combobox>
        </div>
      </div>
    </TooltipProvider>
  );
});
