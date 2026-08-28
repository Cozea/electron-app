import {
  defaultInstanceIdForDriver,
  type ProviderDriverKind,
  type ProviderInstanceId,
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
import {
  deriveProviderInstanceEntries,
  sortProviderInstanceEntries,
  type ProviderInstanceEntry,
} from "../../providerInstances";

type ModelPickerItem = {
  slug: string;
  name: string;
  shortName?: string;
  subProvider?: string;
  isDefault?: boolean;
  isLegacy?: boolean;
  provider: ProviderKind;
  instanceId: ProviderInstanceId;
  driverKind: ProviderDriverKind;
  instanceDisplayName: string;
  instanceAccentColor?: string;
};

const EMPTY_MODEL_JUMP_LABELS = new Map<string, string>();

const FavoritesSchema = Schema.Array(Schema.Struct({
  provider: Schema.String,
  model: Schema.String,
}));

function providerModelKey(provider: string, model: string): string {
  return `${provider}:${model}`;
}

function splitInstanceModelKey(key: string): { instanceId: ProviderInstanceId; slug: string } {
  const colonIndex = key.indexOf(":");
  if (colonIndex === -1) {
    return { instanceId: key as ProviderInstanceId, slug: "" };
  }
  return {
    instanceId: key.slice(0, colonIndex) as ProviderInstanceId,
    slug: key.slice(colonIndex + 1),
  };
}

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
  const out = new Map<ProviderInstanceId, ReadonlyArray<ModelEsque>>();
  for (const entry of entries) {
    const snapshotModels = entry.models.map(toModelEsque);
    out.set(
      entry.instanceId,
      snapshotModels.length > 0 ? snapshotModels : modelOptionsByProvider[entry.provider] ?? [],
    );
  }
  return out;
}

export const ModelPickerContent = memo(function ModelPickerContent(props: {
  provider: ProviderKind;
  activeInstanceId?: ProviderInstanceId;
  model: string;
  lockedProvider: ProviderKind | null;
  providers?: ReadonlyArray<ServerProvider>;
  modelOptionsByProvider: Record<ProviderKind, ReadonlyArray<ModelEsque>>;
  terminalOpen: boolean;
  onRequestClose?: () => void;
  onProviderModelChange: (provider: ProviderKind, model: string, instanceId?: ProviderInstanceId) => void;
}) {
  const { onProviderModelChange } = props;
  const [searchQuery, setSearchQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);
  const listRegionRef = useRef<HTMLDivElement>(null);
  const [favorites, setFavorites] = useLocalStorage<ReadonlyArray<{ provider: string; model: string }>>("cozea:favorites", [], FavoritesSchema);

  const instanceEntries = useMemo(
    () => sortProviderInstanceEntries(deriveProviderInstanceEntries(props.providers ?? [])),
    [props.providers],
  );
  const activeInstanceId =
    props.activeInstanceId ?? defaultInstanceIdForDriver(props.provider as ProviderDriverKind);
  const modelOptionsByInstance = useMemo(
    () => buildModelOptionsByInstance(instanceEntries, props.modelOptionsByProvider),
    [instanceEntries, props.modelOptionsByProvider],
  );

  const [selectedInstanceId, setSelectedInstanceId] = useState<ProviderInstanceId | "favorites">(() => {
    if (props.lockedProvider !== null) {
      return activeInstanceId;
    }
    return favorites.length > 0 ? "favorites" : activeInstanceId;
  });

  const focusSearchInput = useCallback(() => {
    searchInputRef.current?.focus({ preventScroll: true });
  }, []);

  const handleSelectInstance = useCallback(
    (instanceId: ProviderInstanceId | "favorites") => {
      setSelectedInstanceId(instanceId);
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
    return new Set(favorites.map((fav) => providerModelKey(fav.provider, fav.model)));
  }, [favorites]);
  const favoriteOrder = useMemo(() => {
    return new Map(
      favorites.map((favorite, index) => [providerModelKey(favorite.provider, favorite.model), index]),
    );
  }, [favorites]);

  const entryByInstanceId = useMemo(
    () => new Map(instanceEntries.map((entry) => [entry.instanceId, entry] as const)),
    [instanceEntries],
  );
  const matchesLockedProvider = useCallback(
    (entry: Pick<ProviderInstanceEntry, "provider"> | ModelPickerItem): boolean => {
      return props.lockedProvider === null || entry.provider === props.lockedProvider;
    },
    [props.lockedProvider],
  );

  const readyInstanceSet = useMemo(() => {
    const ready = new Set<ProviderInstanceId>();
    for (const entry of instanceEntries) {
      if (entry.status === "ready") {
        ready.add(entry.instanceId);
      }
    }
    return ready;
  }, [instanceEntries]);

  const flatModels = useMemo(() => {
    const out: ModelPickerItem[] = [];
    for (const [instanceId, models] of modelOptionsByInstance) {
      const entry = entryByInstanceId.get(instanceId);
      if (!entry || !readyInstanceSet.has(instanceId)) {
        continue;
      }
      for (const model of models) {
        out.push({
          slug: model.slug,
          name: model.name,
          ...(model.shortName ? { shortName: model.shortName } : {}),
          ...(model.subProvider ? { subProvider: model.subProvider } : {}),
          ...(model.isDefault !== undefined ? { isDefault: model.isDefault } : {}),
          ...(model.isLegacy !== undefined ? { isLegacy: model.isLegacy } : {}),
          provider: entry.provider,
          instanceId,
          driverKind: entry.driverKind,
          instanceDisplayName: entry.displayName,
          ...(entry.accentColor ? { instanceAccentColor: entry.accentColor } : {}),
        });
      }
    }
    return out;
  }, [entryByInstanceId, modelOptionsByInstance, readyInstanceSet]);

  const isLocked = props.lockedProvider !== null;
  const isSearching = searchQuery.trim().length > 0;
  const lockedInstanceEntries = useMemo(
    () => (props.lockedProvider ? instanceEntries.filter((entry) => matchesLockedProvider(entry)) : []),
    [instanceEntries, matchesLockedProvider, props.lockedProvider],
  );
  const showLockedInstanceSidebar = isLocked && lockedInstanceEntries.length > 1;
  const showSidebar = !isSearching && (!isLocked || showLockedInstanceSidebar);
  const sidebarInstanceEntries = showLockedInstanceSidebar ? lockedInstanceEntries : instanceEntries;
  const instanceOrder = useMemo(
    () => instanceEntries.map((entry) => entry.instanceId),
    [instanceEntries],
  );

  const filteredModels = useMemo(() => {
    let result = flatModels;

    if (searchQuery.trim()) {
      const rankedMatches = result
        .map((model) => ({
          model,
          score: scoreModelPickerSearch(
            {
              name: model.name,
              ...(model.shortName ? { shortName: model.shortName } : {}),
              ...(model.subProvider ? { subProvider: model.subProvider } : {}),
              driverKind: model.driverKind,
              providerDisplayName: model.instanceDisplayName,
              isFavorite: favoritesSet.has(providerModelKey(model.instanceId, model.slug)),
            },
            searchQuery,
          ),
          isFavorite: favoritesSet.has(providerModelKey(model.instanceId, model.slug)),
          tieBreaker: buildModelPickerSearchText({
            name: model.name,
            ...(model.shortName ? { shortName: model.shortName } : {}),
            ...(model.subProvider ? { subProvider: model.subProvider } : {}),
            driverKind: model.driverKind,
            providerDisplayName: model.instanceDisplayName,
          }),
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

      return rankedMatches
        .filter((rankedModel) => matchesLockedProvider(rankedModel.model))
        .toSorted((a, b) => {
          const scoreDelta = a.score - b.score;
          if (scoreDelta !== 0) return scoreDelta;
          if (a.isFavorite !== b.isFavorite) return a.isFavorite ? -1 : 1;
          return a.tieBreaker.localeCompare(b.tieBreaker);
        })
        .map((rankedModel) => rankedModel.model);
    }

    if (props.lockedProvider !== null) {
      result = result.filter((m) => matchesLockedProvider(m));
      if (showLockedInstanceSidebar) {
        result = result.filter((m) => m.instanceId === selectedInstanceId);
      }
    } else if (selectedInstanceId === "favorites") {
      result = result.filter((m) => favoritesSet.has(providerModelKey(m.instanceId, m.slug)));
    } else {
      result = result.filter((m) => m.instanceId === selectedInstanceId);
    }

    return result.toSorted((a, b) => {
      const aOrder = favoriteOrder.get(providerModelKey(a.instanceId, a.slug));
      const bOrder = favoriteOrder.get(providerModelKey(b.instanceId, b.slug));

      if (aOrder !== undefined && bOrder !== undefined) return aOrder - bOrder;
      if (aOrder !== undefined) return -1;
      if (bOrder !== undefined) return 1;
      if (a.isLegacy !== b.isLegacy) return a.isLegacy ? 1 : -1;
      if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
      if (selectedInstanceId === "favorites") {
        return instanceOrder.indexOf(a.instanceId) - instanceOrder.indexOf(b.instanceId);
      }
      return 0;
    });
  }, [
    favoriteOrder,
    favoritesSet,
    flatModels,
    instanceOrder,
    matchesLockedProvider,
    props.lockedProvider,
    searchQuery,
    selectedInstanceId,
    showLockedInstanceSidebar,
  ]);

  const handleModelSelect = useCallback(
    (modelSlug: string, instanceId: ProviderInstanceId) => {
      const options = modelOptionsByInstance.get(instanceId);
      const entry = entryByInstanceId.get(instanceId);
      if (!options || !entry) return;
      const resolvedModel = resolveSelectableModel(entry.provider, modelSlug, options as any);
      if (resolvedModel) {
        onProviderModelChange(entry.provider, resolvedModel, instanceId);
      }
    },
    [entryByInstanceId, modelOptionsByInstance, onProviderModelChange],
  );

  const toggleFavorite = useCallback(
    (instanceId: ProviderInstanceId, model: string) => {
      setFavorites((prev) => {
        const newFavorites = [...prev];
        const index = newFavorites.findIndex((f) => f.provider === instanceId && f.model === model);
        if (index >= 0) {
          newFavorites.splice(index, 1);
        } else {
          newFavorites.push({ provider: instanceId, model });
        }
        return newFavorites;
      });
    },
    [setFavorites],
  );

  const LockedProviderIcon =
    isLocked && props.lockedProvider ? PROVIDER_ICON_BY_PROVIDER[props.lockedProvider] : null;
  const lockedHeaderLabel = useMemo(() => {
    if (!isLocked || !props.lockedProvider) return null;
    const active = lockedInstanceEntries.find((entry) => entry.instanceId === activeInstanceId);
    return (active ?? lockedInstanceEntries[0])?.displayName ?? null;
  }, [activeInstanceId, isLocked, lockedInstanceEntries, props.lockedProvider]);

  const modelJumpCommandByKey = useMemo(() => {
    const mapping = new Map<string, string>();
    for (const [visibleModelIndex, model] of filteredModels.entries()) {
      if (visibleModelIndex < 9) {
        mapping.set(providerModelKey(model.instanceId, model.slug), `modelPicker.jump.${visibleModelIndex + 1}`);
      }
    }
    return mapping;
  }, [filteredModels]);

  const modelJumpModelKeys = useMemo(
    () => [...modelJumpCommandByKey.keys()],
    [modelJumpCommandByKey],
  );

  const filteredModelKeys = useMemo(
    (): string[] => filteredModels.map((model) => providerModelKey(model.instanceId, model.slug)),
    [filteredModels],
  );
  const filteredModelByKey = useMemo(
    (): ReadonlyMap<string, ModelPickerItem> =>
      new Map(filteredModels.map((model) => [providerModelKey(model.instanceId, model.slug), model] as const)),
    [filteredModels],
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
            const { instanceId, slug } = splitInstanceModelKey(targetModelKey);
            event.preventDefault();
            event.stopPropagation();
            handleModelSelect(slug, instanceId);
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
  }, [filteredModelKeys]);

  return (
    <TooltipProvider delayDuration={0}>
      <div
        className={cn(
          "relative flex w-full h-full overflow-hidden text-popover-foreground",
          isLocked && !showLockedInstanceSidebar ? "flex-col" : "flex-row",
        )}
      >
        {isLocked && !showLockedInstanceSidebar && LockedProviderIcon && lockedHeaderLabel && (
          <div className="flex items-center gap-2 px-4 py-3 border-b border-border/40">
            <LockedProviderIcon className="size-4 shrink-0" />
            <span className="text-sm font-medium">{lockedHeaderLabel}</span>
          </div>
        )}

        {showSidebar && (
          <ModelPickerSidebar
            selectedInstanceId={selectedInstanceId}
            onSelectInstance={handleSelectInstance}
            instanceEntries={sidebarInstanceEntries}
            showFavorites={!isLocked}
            showComingSoon={!isLocked}
          />
        )}

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <Combobox
            open
            disabled={false}
            value={providerModelKey(activeInstanceId, props.model)}
            onValueChange={(value) => {
              if (!value) return;
              const { instanceId, slug } = splitInstanceModelKey(String(value));
              handleModelSelect(slug, instanceId);
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
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    e.preventDefault();
                    e.stopPropagation();
                    props.onRequestClose?.();
                    return;
                  }
                  e.stopPropagation();
                }}
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
                  filteredModelKeys.map((modelKey, index) => {
                    const model = filteredModelByKey.get(modelKey);
                    if (!model) return null;
                    const isFav = favoritesSet.has(modelKey);
                    return (
                      <ModelListRow
                        key={modelKey}
                        index={index}
                        model={model}
                        instanceId={model.instanceId}
                        driverKind={model.driverKind}
                        providerDisplayName={model.instanceDisplayName}
                        providerAccentColor={model.instanceAccentColor}
                        isFavorite={isFav}
                        showProvider={isSearching || selectedInstanceId === "favorites" || showLockedInstanceSidebar}
                        showNewBadge={isModelPickerNewModel(model.provider, model.slug)}
                        jumpLabel={modelJumpLabelByKey.get(modelKey)}
                        onToggleFavorite={() => toggleFavorite(model.instanceId, model.slug)}
                        preferShortName={!isSearching}
                        useTriggerLabel={isLocked && !showLockedInstanceSidebar}
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
