import * as React from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SettingsPageBody, SettingsPageHeader } from "@/components/settings/SettingsChrome";
import { appToast } from "@/lib/appToast";
import { ensureNativeApi } from "@/lib/nativeApi";
import { cn } from "@/lib/utils";
import {
  ClaudeAI,
  CursorIcon,
  OpenAI,
  OpenCodeIcon,
  type Icon,
} from "@/features/projects/components/assistant/Icons";
import {
  conciseDescription,
  prettifySkillName,
} from "@/features/projects/pages/AgentSkillsPage";
import {
  agentSkillCategoryLabel,
  agentSkillCategoryOrder,
} from "@shared/agentSkillCategories";
import type {
  AgentSkillBuild,
  AgentSkillProvider,
  AgentSkillMutationResult,
  AgentSkillRecord,
  AgentSkillsSnapshot,
} from "@shared/electronApiTypes";

import { HugeiconsIcon } from "@hugeicons/react";
import {
  Add01Icon as __AddHugeIcon,
  ArrowLeft01Icon as __ArrowLeftHugeIcon,
  ArrowRight01Icon as __ArrowRightHugeIcon,
  Delete02Icon as __DeleteHugeIcon,
  Edit02Icon as __EditHugeIcon,
  FlashIcon as __FlashHugeIcon,
  Search01Icon as __SearchHugeIcon,
  Tick02Icon as __TickHugeIcon,
} from "@hugeicons/core-free-icons";

/** A build can only hold skills that are actually installed. */
export function installedSkills(skills: readonly AgentSkillRecord[]): AgentSkillRecord[] {
  return skills.filter((skill) => skill.source !== "catalog");
}

/** Skills a build names, in library order, ignoring ones that have gone. */
export function buildLoadout(
  build: Pick<AgentSkillBuild, "skillIds">,
  skills: readonly AgentSkillRecord[],
): AgentSkillRecord[] {
  const wanted = new Set(build.skillIds);
  return skills.filter((skill) => wanted.has(skill.id));
}

/** Slots grouped by category, the way a character sheet groups equipment. */
export function loadoutByCategory(
  loadout: readonly AgentSkillRecord[],
): Array<{ category: string; label: string; skills: AgentSkillRecord[] }> {
  const groups = new Map<string, AgentSkillRecord[]>();
  for (const skill of loadout) {
    const bucket = groups.get(skill.category);
    if (bucket) bucket.push(skill);
    else groups.set(skill.category, [skill]);
  }
  return Array.from(groups, ([category, skills]) => ({
    category,
    label: agentSkillCategoryLabel(category),
    skills,
  })).sort(
    (left, right) => agentSkillCategoryOrder(left.category) - agentSkillCategoryOrder(right.category),
  );
}

export const BUILD_PROVIDER_LABELS: Record<AgentSkillProvider, string> = {
  codex: "Codex",
  claude: "Claude",
  cursor: "Cursor",
  opencode: "OpenCode",
};

/** The providers' own marks, shared with the assistant's provider picker. */
const BUILD_PROVIDER_ICONS: Record<AgentSkillProvider, Icon> = {
  claude: ClaudeAI,
  codex: OpenAI,
  cursor: CursorIcon,
  opencode: OpenCodeIcon,
};

export const BUILD_PROVIDER_ORDER: AgentSkillProvider[] = [
  "claude",
  "codex",
  "cursor",
  "opencode",
];

/**
 * Which of a build's skills each provider would actually run.
 *
 * Compatibility, not current state: a build describes what you want on, and a
 * skill that is not compatible with a provider can never be part of what that
 * provider runs, whether the build is equipped or not.
 */
export function providerSkillCounts(
  loadout: readonly AgentSkillRecord[],
): Array<{ provider: AgentSkillProvider; label: string; count: number }> {
  return BUILD_PROVIDER_ORDER.map((provider) => ({
    provider,
    label: BUILD_PROVIDER_LABELS[provider],
    count: loadout.filter((skill) =>
      skill.bindings.some((binding) => binding.provider === provider && binding.compatible),
    ).length,
  }));
}

/** The part of a build one provider runs, ready to group by category. */
export function providerLoadout(
  loadout: readonly AgentSkillRecord[],
  provider: AgentSkillProvider,
): AgentSkillRecord[] {
  return loadout.filter((skill) =>
    skill.bindings.some((binding) => binding.provider === provider && binding.compatible),
  );
}

/**
 * Picking a whole category at once: if it is already fully chosen the click
 * clears it, otherwise it completes it. Partial selections fill up rather than
 * emptying, which is what a half-ticked group invites you to do.
 */
export function toggleCategorySelection(
  selected: readonly string[],
  categorySkillIds: readonly string[],
): string[] {
  const chosen = new Set(selected);
  const allChosen =
    categorySkillIds.length > 0 && categorySkillIds.every((id) => chosen.has(id));
  if (allChosen) {
    return selected.filter((id) => !categorySkillIds.includes(id));
  }
  return [...selected, ...categorySkillIds.filter((id) => !chosen.has(id))];
}

/** Narrow the picker to a search term and, optionally, one category. */
export function filterPickerSkills(
  skills: readonly AgentSkillRecord[],
  query: string,
  category: string | null,
): AgentSkillRecord[] {
  const needle = query.trim().toLowerCase();
  return skills.filter((skill) => {
    if (category && skill.category !== category) return false;
    if (!needle) return true;
    return `${skill.name} ${skill.description}`.toLowerCase().includes(needle);
  });
}

export function SkillBuildsView() {
  const [snapshot, setSnapshot] = React.useState<AgentSkillsSnapshot | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [selectedBuildId, setSelectedBuildId] = React.useState<string | null>(null);
  const [busyKey, setBusyKey] = React.useState<string | null>(null);
  const [isEditing, setIsEditing] = React.useState(false);
  const [openProvider, setOpenProvider] = React.useState<AgentSkillProvider | null>(null);
  const [draftName, setDraftName] = React.useState("");
  const [draftSkillIds, setDraftSkillIds] = React.useState<string[]>([]);

  const load = React.useCallback(async () => {
    setLoadError(null);
    try {
      const next = await window.electronAPI.agentSkills.list();
      setSnapshot(next);
      setSelectedBuildId((current) =>
        current && next.builds.some((build) => build.id === current)
          ? current
          : (next.activeBuildId ?? next.builds[0]?.id ?? null),
      );
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Unable to load builds.");
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const runMutation = React.useCallback(
    async (key: string, operation: () => Promise<AgentSkillMutationResult>, success: string) => {
      setBusyKey(key);
      try {
        const result = await operation();
        setSnapshot(result.snapshot);
        if (!result.success) {
          if (result.error) appToast.error({ title: "Builds", description: result.error });
          return result;
        }
        if (result.changedProviders?.length) {
          try {
            await ensureNativeApi().server.refreshProviders();
          } catch {
            // The runtime's periodic provider snapshot converges anyway.
          }
        }
        appToast.success({ title: success });
        return result;
      } catch (error) {
        appToast.error({
          title: "Builds",
          description: error instanceof Error ? error.message : "The local operation failed.",
        });
        return null;
      } finally {
        setBusyKey(null);
      }
    },
    [],
  );

  const skills = React.useMemo(() => installedSkills(snapshot?.skills ?? []), [snapshot]);
  const builds = snapshot?.builds ?? [];
  const selectedBuild = builds.find((build) => build.id === selectedBuildId) ?? null;
  const loadout = React.useMemo(
    () => (selectedBuild ? buildLoadout(selectedBuild, skills) : []),
    [selectedBuild, skills],
  );

  const startEditing = React.useCallback((build: AgentSkillBuild | null) => {
    setIsEditing(true);
    setOpenProvider(null);
    setDraftName(build?.name ?? "");
    setDraftSkillIds(build?.skillIds ?? []);
  }, []);

  const saveDraft = React.useCallback(async () => {
    const result = await runMutation(
      "save",
      () =>
        window.electronAPI.agentSkills.saveBuild({
          ...(selectedBuild && draftName !== "" ? { buildId: selectedBuild.id } : {}),
          name: draftName,
          skillIds: draftSkillIds,
        }),
      "Build saved",
    );
    if (result?.success) {
      if (result.skillId) setSelectedBuildId(result.skillId);
      setIsEditing(false);
    }
  }, [draftName, draftSkillIds, runMutation, selectedBuild]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <SettingsPageBody className="max-w-5xl shrink-0 space-y-5 pb-4">
        <div className="relative flex items-start justify-center gap-4">
          <SettingsPageHeader
            title="Builds"
            description={
              snapshot
                ? `${builds.length} ${builds.length === 1 ? "build" : "builds"} · ${skills.length} skills to draw from`
                : "Saved skill loadouts"
            }
            className="mb-0 min-w-0 text-center"
          />
          <div className="absolute top-0 right-0 flex shrink-0 items-center gap-1.5">
            <Button
              size="sm"
              onClick={() => {
                setSelectedBuildId(null);
                startEditing(null);
              }}
            >
              <HugeiconsIcon icon={__AddHugeIcon} />
              New build
            </Button>
          </div>
        </div>
      </SettingsPageBody>

      <div className="mx-auto flex min-h-0 w-full max-w-5xl flex-1 flex-col px-8 pb-5 sm:px-10">
        {loadError ? (
          <p className="p-6 text-sm text-destructive">{loadError}</p>
        ) : isEditing ? (
          <section className="flex min-h-0 min-w-0 flex-1 flex-col rounded-2xl border border-border/50 bg-card/40">
            <BuildEditor
              name={draftName}
              skillIds={draftSkillIds}
              allSkills={skills}
              busy={busyKey === "save"}
              onNameChange={setDraftName}
              onSetSkillIds={setDraftSkillIds}
              onToggleSkill={(id) =>
                setDraftSkillIds((current) =>
                  current.includes(id)
                    ? current.filter((candidate) => candidate !== id)
                    : [...current, id],
                )
              }
              onCancel={() => setIsEditing(false)}
              onSave={() => void saveDraft()}
            />
          </section>
        ) : builds.length === 0 ? (
          <section className="flex min-h-0 min-w-0 flex-1 flex-col rounded-2xl border border-border/50 bg-card/40">
            <EmptyBuilds onCreate={() => startEditing(null)} />
          </section>
        ) : selectedBuild ? (
          <>
            {openProvider ? (
              <ProviderSheet
                provider={openProvider}
                total={providerLoadout(loadout, openProvider).length}
                groups={loadoutByCategory(providerLoadout(loadout, openProvider))}
                onBack={() => setOpenProvider(null)}
              />
            ) : (
              <ProviderHub
                build={selectedBuild}
                loadout={loadout}
                isActive={snapshot?.activeBuildId === selectedBuild.id}
                busyKey={busyKey}
                onOpenProvider={setOpenProvider}
                onEdit={() => startEditing(selectedBuild)}
                onDelete={() =>
                  void runMutation(
                    `delete:${selectedBuild.id}`,
                    () =>
                      window.electronAPI.agentSkills.deleteBuild({ buildId: selectedBuild.id }),
                    "Build deleted",
                  )
                }
                onEquip={() =>
                  void runMutation(
                    `apply:${selectedBuild.id}`,
                    () => window.electronAPI.agentSkills.applyBuild({ buildId: selectedBuild.id }),
                    `${selectedBuild.name} equipped`,
                  )
                }
              />
            )}

            <BuildStrip
              builds={builds}
              activeBuildId={snapshot?.activeBuildId ?? null}
              selectedBuildId={selectedBuildId}
              onSelect={(id) => {
                setSelectedBuildId(id);
                setIsEditing(false);
                setOpenProvider(null);
              }}
              onCreate={() => {
                setSelectedBuildId(null);
                startEditing(null);
              }}
            />
          </>
        ) : null}
      </div>
    </div>
  );
}

/** Elongated hexagon, the shape a loadout node wants to be. */
const NODE_HEX = "polygon(12% 0,88% 0,100% 50%,88% 100%,12% 100%,0 50%)";

/** Where each provider sits on the stage, as a percentage of it. */
const NODE_POSITIONS: Array<{ left: string; top: string }> = [
  { left: "26%", top: "28%" },
  { left: "74%", top: "28%" },
  { left: "26%", top: "78%" },
  { left: "74%", top: "78%" },
];

/**
 * The loadout screen: the build at the centre, each provider a node around it
 * carrying the number of that build's skills it would run, joined by traces.
 * Clicking a node opens what that provider actually gets.
 */
function ProviderHub({
  build,
  loadout,
  isActive,
  busyKey,
  onOpenProvider,
  onEdit,
  onDelete,
  onEquip,
}: {
  build: AgentSkillBuild;
  loadout: AgentSkillRecord[];
  isActive: boolean;
  busyKey: string | null;
  onOpenProvider: (provider: AgentSkillProvider) => void;
  onEdit: () => void;
  onDelete: () => void;
  onEquip: () => void;
}) {
  const counts = providerSkillCounts(loadout);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex shrink-0 items-center justify-end gap-1.5 px-1 pb-1">
        <Button variant="ghost" size="sm" onClick={onEdit}>
          <HugeiconsIcon icon={__EditHugeIcon} />
          Edit
        </Button>
        <Button
          variant="destructive-outline"
          size="sm"
          onClick={onDelete}
          disabled={busyKey === `delete:${build.id}`}
        >
          <HugeiconsIcon icon={__DeleteHugeIcon} />
          Delete
        </Button>
        <Button size="sm" onClick={onEquip} disabled={isActive || busyKey === `apply:${build.id}`}>
          <HugeiconsIcon icon={isActive ? __TickHugeIcon : __FlashHugeIcon} />
          {busyKey === `apply:${build.id}` ? "Equipping…" : isActive ? "Equipped" : "Equip build"}
        </Button>
      </header>

      <div className="flex min-h-0 flex-1 items-center justify-center">
        <div className="relative aspect-[1/0.62] w-full max-w-[640px]">
          {/* Traces from the core to each node, drawn behind them. */}
          <svg
            viewBox="0 0 100 62"
            preserveAspectRatio="none"
            aria-hidden="true"
            className="absolute inset-0 size-full overflow-visible"
          >
            <defs>
              <linearGradient id="cozea-build-trace" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0" stopColor="currentColor" stopOpacity="0.05" />
                <stop offset="0.5" stopColor="currentColor" stopOpacity="0.3" />
                <stop offset="1" stopColor="currentColor" stopOpacity="0.05" />
              </linearGradient>
            </defs>
            <g
              className="text-foreground"
              stroke="url(#cozea-build-trace)"
              strokeWidth="0.5"
              fill="none"
            >
              <path d="M50 31 L26 17" />
              <path d="M50 31 L74 17" />
              <path d="M50 31 L26 48" />
              <path d="M50 31 L74 48" />
            </g>
          </svg>

          {counts.map((node, index) => (
            <ProviderNode
              key={node.provider}
              node={node}
              position={NODE_POSITIONS[index]!}
              isActive={isActive}
              onClick={onOpenProvider}
            />
          ))}

          {/* The core plate, carrying the build's total. */}
          <div className="absolute top-1/2 left-1/2 size-[160px] -translate-x-1/2 -translate-y-1/2">
            <div className="absolute inset-0 rotate-45 rounded-[14px] border border-foreground/25 bg-[linear-gradient(160deg,var(--card),color-mix(in_oklch,var(--card)_60%,black))] after:absolute after:inset-[5px] after:rounded-[10px] after:border after:border-foreground/[0.07] after:content-['']" />
            <div className="absolute inset-0 flex flex-col items-center justify-center px-3.5">
              <span className="line-clamp-2 text-center text-[13px] leading-[1.25] font-medium text-foreground">
                {build.name}
              </span>
              <span className="mt-1.5 text-[8.5px] tracking-[0.2em] whitespace-nowrap text-muted-foreground/60">
                {loadout.length} {loadout.length === 1 ? "SKILL" : "SKILLS"}
              </span>
            </div>
          </div>

            {isActive ? (
              <p className="absolute top-[calc(50%+120px)] left-1/2 -translate-x-1/2 text-[9px] tracking-[0.18em] whitespace-nowrap text-emerald-500">
                EQUIPPED
              </p>
            ) : null}
        </div>
      </div>
    </div>
  );
}

function ProviderNode({
  node,
  position,
  isActive,
  onClick,
}: {
  node: { provider: AgentSkillProvider; label: string; count: number };
  position: { left: string; top: string };
  isActive: boolean;
  onClick: (provider: AgentSkillProvider) => void;
}) {
  const isEmpty = node.count === 0;
  return (
    <button
      type="button"
      style={position}
      onClick={() => onClick(node.provider)}
      disabled={isEmpty}
      aria-label={`${node.label}: ${node.count} skills`}
      className="group absolute h-[74px] w-[168px] -translate-x-1/2 -translate-y-1/2"
    >
      {/* Two stacked hexagons: the outer is the hairline, the inner the fill.
          A clip-path cannot take a border, so the border is a layer. */}
      <span
        style={{ clipPath: NODE_HEX }}
        className={cn(
          "absolute inset-0 transition-colors",
          isEmpty
            ? "bg-foreground/[0.09]"
            : isActive
              ? "bg-emerald-500/60 group-hover:bg-emerald-500/80"
              : "bg-foreground/25 group-hover:bg-foreground/50",
        )}
      />
      <span
        style={{ clipPath: NODE_HEX }}
        className={cn(
          "absolute inset-[1.5px]",
          isEmpty
            ? "bg-background/60"
            : "bg-[linear-gradient(180deg,var(--card),color-mix(in_oklch,var(--card)_70%,black))]",
        )}
      />
      <span
        className={cn(
          "relative z-10 flex h-full flex-col items-center justify-center gap-px",
          isEmpty && "opacity-40",
        )}
      >
        <span className="text-[9.5px] tracking-[0.18em] text-muted-foreground uppercase">
          {node.label}
        </span>
        <span className="flex items-center gap-2">
          <ProviderMark provider={node.provider} />
          <span className="text-[22px] leading-none font-semibold tabular-nums text-foreground">
            {node.count}
          </span>
        </span>
      </span>
    </button>
  );
}

/** What one provider runs in this build, by category. */
function ProviderMark({ provider }: { provider: AgentSkillProvider }) {
  const Mark = BUILD_PROVIDER_ICONS[provider];
  return <Mark aria-hidden className="size-[18px] shrink-0 text-foreground/70" />;
}

function ProviderSheet({
  provider,
  groups,
  total,
  onBack,
}: {
  provider: AgentSkillProvider;
  groups: Array<{ category: string; label: string; skills: AgentSkillRecord[] }>;
  total: number;
  onBack: () => void;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col rounded-2xl border border-border/50 bg-card/40">
      <header className="flex shrink-0 items-center gap-3 rounded-t-2xl border-b border-border/50 bg-foreground/[0.05] px-5 py-3.5">
        <Button variant="ghost" size="sm" className="-ml-2 h-7 px-2" onClick={onBack}>
          <HugeiconsIcon icon={__ArrowLeftHugeIcon} />
          Back
        </Button>
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold text-foreground">
            {BUILD_PROVIDER_LABELS[provider]}
          </h2>
          <p className="text-[11px] text-muted-foreground/70">
            {total} {total === 1 ? "skill" : "skills"} in this build
          </p>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        <div className="space-y-5">
          {groups.map((group) => (
            <div key={group.category}>
              <h3 className="px-1 pb-2 text-[11px] font-medium tracking-wide text-muted-foreground/70 uppercase">
                {group.label}
              </h3>
              <ul className="grid gap-2 sm:grid-cols-2">
                {group.skills.map((skill) => (
                  <li
                    key={skill.id}
                    className="min-w-0 rounded-xl border border-border/40 bg-background/40 px-3 py-2.5"
                  >
                    <span className="block truncate text-sm font-medium text-foreground">
                      {prettifySkillName(skill.name)}
                    </span>
                    <span className="mt-0.5 block truncate text-[11px] text-muted-foreground/70">
                      {conciseDescription(skill.description)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** The saved builds, along the bottom, with arrows beside the scroll. */
function BuildStrip({
  builds,
  activeBuildId,
  selectedBuildId,
  onSelect,
  onCreate,
}: {
  builds: AgentSkillBuild[];
  activeBuildId: string | null;
  selectedBuildId: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
}) {
  const trackRef = React.useRef<HTMLDivElement | null>(null);

  const nudge = (direction: -1 | 1) => {
    const track = trackRef.current;
    if (!track) return;
    track.scrollBy({ left: direction * Math.max(track.clientWidth * 0.6, 200), behavior: "smooth" });
  };

  return (
    <div className="relative shrink-0 pt-3">
      <Button
        variant="outline"
        size="icon-xl"
        aria-label="Previous builds"
        onClick={() => nudge(-1)}
        className="absolute top-1/2 left-0 z-10 size-9 -translate-y-1/2 rounded-full border-border bg-popover shadow-md sm:size-9 dark:bg-popover"
      >
        <HugeiconsIcon icon={__ArrowLeftHugeIcon} className="size-4" />
      </Button>
      <Button
        variant="outline"
        size="icon-xl"
        aria-label="More builds"
        onClick={() => nudge(1)}
        className="absolute top-1/2 right-0 z-10 size-9 -translate-y-1/2 rounded-full border-border bg-popover shadow-md sm:size-9 dark:bg-popover"
      >
        <HugeiconsIcon icon={__ArrowRightHugeIcon} className="size-4" />
      </Button>

      <div
        ref={trackRef}
        className="flex gap-2 overflow-x-auto px-11 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {builds.map((build) => {
          const isSelected = build.id === selectedBuildId;
          return (
            <button
              key={build.id}
              type="button"
              onClick={() => onSelect(build.id)}
              aria-current={isSelected ? "true" : undefined}
              className={cn(
                "relative flex w-[158px] shrink-0 flex-col items-start gap-0.5 rounded-[10px] border px-3 py-2.5 text-left transition-colors",
                // A hairline along the top edge marks the selected card the way
                // the hub's nodes are lit.
                isSelected
                  ? "border-border/60 bg-card/70 text-foreground before:absolute before:inset-x-3 before:-top-px before:h-px before:bg-foreground/50 before:content-['']"
                  : "border-border/40 text-muted-foreground hover:border-border/70 hover:text-foreground",
              )}
            >
              <span className="w-full min-w-0 truncate text-[12.5px] font-medium">
                {build.name}
              </span>
              <span className="flex items-center gap-1 text-[10.5px] tracking-[0.04em] text-muted-foreground/70">
                {build.skillIds.length} {build.skillIds.length === 1 ? "SKILL" : "SKILLS"}
                {build.id === activeBuildId ? (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="text-emerald-500">EQUIPPED</span>
                  </>
                ) : null}
              </span>
            </button>
          );
        })}
        <button
          type="button"
          onClick={onCreate}
          className="flex w-[158px] shrink-0 items-center justify-center gap-1.5 rounded-[10px] border border-dashed border-border/50 px-3 py-2.5 text-[11.5px] text-muted-foreground transition-colors hover:border-border hover:text-foreground"
        >
          <HugeiconsIcon icon={__AddHugeIcon} className="size-3.5" />
          New build
        </button>
      </div>
    </div>
  );
}

function BuildEditor({
  name,
  skillIds,
  allSkills,
  busy,
  onNameChange,
  onSetSkillIds,
  onToggleSkill,
  onCancel,
  onSave,
}: {
  name: string;
  skillIds: string[];
  allSkills: AgentSkillRecord[];
  busy: boolean;
  onNameChange: (value: string) => void;
  onSetSkillIds: (ids: string[]) => void;
  onToggleSkill: (id: string) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  const [query, setQuery] = React.useState("");
  const [category, setCategory] = React.useState<string | null>(null);

  const chosen = new Set(skillIds);
  const categories = React.useMemo(() => loadoutByCategory(allSkills), [allSkills]);
  const visible = React.useMemo(
    () => filterPickerSkills(allSkills, query, category),
    [allSkills, category, query],
  );
  const groups = React.useMemo(() => loadoutByCategory(visible), [visible]);

  return (
    <>
      <header className="flex shrink-0 items-center gap-3 rounded-t-2xl border-b border-border/50 bg-foreground/[0.05] px-5 py-3">
        <Input
          value={name}
          onChange={(event) => onNameChange(event.target.value)}
          placeholder="Name this build"
          autoFocus
          className="h-8 max-w-xs"
        />
        <span className="text-[11px] text-muted-foreground/70">{skillIds.length} selected</span>
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          <Button variant="outline" size="sm" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button size="sm" onClick={onSave} disabled={busy}>
            {busy ? "Saving…" : "Save build"}
          </Button>
        </div>
      </header>

      <div className="shrink-0 space-y-2.5 border-b border-border/40 px-5 py-3">
        <div className="relative">
          <HugeiconsIcon
            icon={__SearchHugeIcon}
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground/70"
          />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search skills to add..."
            className="h-9 pl-9"
          />
        </div>

        {/* Browsing by category beats scrolling 39 skills looking for one. */}
        <div className="flex flex-wrap items-center gap-1.5">
          <CategoryChip
            label="All"
            count={allSkills.length}
            isActive={category === null}
            onClick={() => setCategory(null)}
          />
          {categories.map((group) => (
            <CategoryChip
              key={group.category}
              label={group.label}
              count={group.skills.length}
              isActive={category === group.category}
              onClick={() => setCategory(category === group.category ? null : group.category)}
            />
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {groups.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">No matching skills.</p>
        ) : (
          groups.map((group) => {
            const ids = group.skills.map((skill) => skill.id);
            const allChosen = ids.every((id) => chosen.has(id));
            return (
              <div key={group.category} className="mb-4 last:mb-0">
                <div className="flex items-center justify-between gap-3 px-2 pb-1.5">
                  <h3 className="text-[11px] font-medium tracking-wide text-muted-foreground/70 uppercase">
                    {group.label}
                  </h3>
                  <button
                    type="button"
                    onClick={() => onSetSkillIds(toggleCategorySelection(skillIds, ids))}
                    className="text-[11px] text-muted-foreground/70 transition-colors hover:text-foreground"
                  >
                    {allChosen ? "Clear" : "Select all"}
                  </button>
                </div>
                <ul>
                  {group.skills.map((skill) => {
                    const isChosen = chosen.has(skill.id);
                    return (
                      <li key={skill.id}>
                        <button
                          type="button"
                          aria-pressed={isChosen}
                          onClick={() => onToggleSkill(skill.id)}
                          className={cn(
                            "flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors",
                            isChosen
                              ? "border-transparent bg-foreground/[0.08] text-foreground"
                              : "border-transparent text-muted-foreground hover:bg-accent/40 hover:text-foreground",
                          )}
                        >
                          <span
                            className={cn(
                              "flex size-4 shrink-0 items-center justify-center rounded border",
                              isChosen
                                ? "border-transparent bg-foreground text-background"
                                : "border-border",
                            )}
                          >
                            {isChosen ? (
                              <HugeiconsIcon icon={__TickHugeIcon} className="size-3" />
                            ) : null}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium">
                              {prettifySkillName(skill.name)}
                            </span>
                            <span className="mt-0.5 block truncate text-[11px] text-muted-foreground/70">
                              {conciseDescription(skill.description)}
                            </span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })
        )}
      </div>
    </>
  );
}

function CategoryChip({
  label,
  count,
  isActive,
  onClick,
}: {
  label: string;
  count: number;
  isActive: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={isActive}
      onClick={onClick}
      className={cn(
        "flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[11px] transition-colors",
        isActive
          ? "border-transparent bg-foreground/12 font-medium text-foreground"
          : "border-border/50 text-muted-foreground hover:border-border hover:text-foreground",
      )}
    >
      {label}
      <span className="tabular-nums opacity-60">{count}</span>
    </button>
  );
}

function EmptyBuilds({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-10 text-center">
      <HugeiconsIcon icon={__FlashHugeIcon} className="size-7 text-muted-foreground/50" />
      <div>
        <p className="text-sm font-medium text-foreground">No builds yet</p>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          A build is a named set of skills. Equip one and Cozea turns those on and
          everything else off.
        </p>
      </div>
      <Button size="sm" onClick={onCreate}>
        <HugeiconsIcon icon={__AddHugeIcon} />
        Create your first build
      </Button>
    </div>
  );
}

export default SkillBuildsView;
