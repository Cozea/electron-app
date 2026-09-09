import * as React from "react";
import {
  ProviderHub,
} from "./SkillBuildProviderHub";
import "@/features/projects/components/SkillBuildsView.css";
import {
  agentSkillsSnapshot,
  useAgentSkillsSnapshot,
} from "@/features/projects/model/agentSkillsSnapshot";
import {
  useProjectHeader,
} from "@/lib/useProjectHeader";

import {
  buildableSkills,
  partitionEssential,
  resolveSelectedBuild,
  skillMonogram,
  needsInstall,
  buildLoadout,
  loadoutByCategory,
  BUILD_PROVIDER_LABELS,
  BUILD_PROVIDER_ORDER,
  cozeaSkills,
  providerCandidates,
  toggleCategorySelection,
  filterPickerSkills,
} from "@/features/projects/model/skillBuildModel";
import {
  Logo,
} from "@/components/Logo";
import {
  Button,
} from "@/components/ui/button";
import {
  HeaderBackButton,
} from "@/components/ui/header-back-button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Input,
} from "@/components/ui/input";
import {
  ScrollArea,
} from "@/components/ui/scroll-area";
import {
  SearchInput,
} from "@/components/ui/search-input";
import {
  appToast,
} from "@/lib/appToast";
import {
  ensureNativeApi,
} from "@/lib/nativeApi";
import {
  useSearchParams,
} from "@/lib/router";
import {
  cn,
} from "@/lib/utils";

import {
  conciseDescription,
  ESSENTIAL_SKILL_NOTE,
  prettifySkillName,
} from "@/features/projects/model/agentSkillPresentation";
import type {
  AgentSkillBuild,
  AgentSkillProvider,
  AgentSkillMutationResult,
  AgentSkillRecord,
} from "@shared/electronApiTypes";

import {
  HugeiconsIcon,
} from "@hugeicons/react";
import {
  Add01Icon as __AddHugeIcon,
  ArrowLeft01Icon as __ArrowLeftHugeIcon,
  ArrowRight01Icon as __ArrowRightHugeIcon,
  Delete02Icon as __DeleteHugeIcon,
  FlashIcon as __FlashHugeIcon,
  FolderLibraryIcon as __LibraryHugeIcon,
  InformationCircleIcon as __InfoHugeIcon,
  Tick02Icon as __TickHugeIcon,
} from "@hugeicons/core-free-icons";


/** The providers' own marks, shared with the assistant's provider picker. */
import {
  BUILD_PROVIDER_ICONS,
} from "./skillBuildProviderIcons";

export function SkillBuildsView() {
  const [searchParams, setSearchParams] = useSearchParams();
  const query = searchParams.get("q") ?? "";
  const { data: snapshot, error: loadError } = useAgentSkillsSnapshot();
  const [selectedBuildId, setSelectedBuildId] = React.useState<string | null>(null);
  const [busyKey, setBusyKey] = React.useState<string | null>(null);
  const [isEditing, setIsEditing] = React.useState(false);
  const [openDetail, setOpenDetail] = React.useState<AgentSkillProvider | "cozea" | null>(null);
  const [draftName, setDraftName] = React.useState("");
  const [draftSkillIds, setDraftSkillIds] = React.useState<string[]>([]);

  React.useEffect(() => {
    if (!snapshot) return;
    setSelectedBuildId((current) =>
      current && snapshot.builds.some((build) => build.id === current)
        ? current
        : (snapshot.activeBuildId ?? snapshot.builds[0]?.id ?? null),
    );
  }, [snapshot]);

  /**
   * Coming back from a skill's page, which remounts this view with its state
   * lost. The params say which build and which provider page to reopen; they
   * are consumed once read so reopening Builds later starts clean. Declared
   * after the reconcile above so it wins on the same commit.
   */
  const detailParam = searchParams.get("detail");
  const buildParam = searchParams.get("build");
  React.useEffect(() => {
    if (!detailParam && !buildParam) return;
    if (buildParam) setSelectedBuildId(buildParam);
    if (detailParam && DETAIL_RING.includes(detailParam as AgentSkillProvider | "cozea")) {
      setOpenDetail(detailParam as AgentSkillProvider | "cozea");
    }
    const next = new URLSearchParams(searchParams);
    next.delete("detail");
    next.delete("build");
    setSearchParams(next, { replace: true });
  }, [buildParam, detailParam, searchParams, setSearchParams]);

  const runMutation = React.useCallback(
    async (
      key: string,
      operation: () => Promise<AgentSkillMutationResult>,
      success: string | null,
    ) => {
      setBusyKey(key);
      try {
        const result = await operation();
        agentSkillsSnapshot.publish(result.snapshot);
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
        if (success) appToast.success({ title: success });
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

  const skills = React.useMemo(() => buildableSkills(snapshot?.skills ?? []), [snapshot]);
  const builds = snapshot?.builds ?? [];
  const selectedBuild = resolveSelectedBuild(
    builds,
    selectedBuildId,
    snapshot?.activeBuildId ?? null,
  );
  const loadout = React.useMemo(
    () => (selectedBuild ? buildLoadout(selectedBuild, skills) : []),
    [selectedBuild, skills],
  );

  /** Builds are created and deleted, not edited: this always opens blank. */
  const startEditing = React.useCallback(() => {
    setIsEditing(true);
    setOpenDetail(null);
    setDraftName("");
    setDraftSkillIds([]);
  }, []);

  /**
   * Add or drop one skill on the open build. Deliberately silent: a bucket
   * page is a checklist, and a toast per tick would bury the screen.
   */
  const toggleBuildSkill = React.useCallback(
    async (skillId: string) => {
      if (!selectedBuild) return;

      // A catalog entry sits on disk unloaded, so it has to be installed
      // before a build can switch it on. Its id changes once installed, so
      // resolve the new record before writing the build.
      const candidate = skills.find((skill) => skill.id === skillId);
      let targetId = skillId;
      if (candidate && needsInstall(candidate)) {
        const installed = await runMutation(
          `toggle:${skillId}`,
          () => window.electronAPI.agentSkills.install({ skillId }),
          `${prettifySkillName(candidate.name)} installed`,
        );
        if (!installed?.success) return;
        targetId =
          installed.skillId ??
          installed.snapshot.skills.find((skill) => skill.slug === candidate.slug)?.id ??
          skillId;
      }

      const skillIds = selectedBuild.skillIds.includes(targetId)
        ? selectedBuild.skillIds.filter((held) => held !== targetId)
        : [...selectedBuild.skillIds, targetId];
      const isActive = snapshot?.activeBuildId === selectedBuild.id;
      const saved = await runMutation(
        `toggle:${skillId}`,
        () =>
          window.electronAPI.agentSkills.saveBuild({
            buildId: selectedBuild.id,
            name: selectedBuild.name,
            skillIds,
          }),
        null,
      );
      // `saveBuild` only records the build; it does not touch what is enabled
      // on disk. Editing the active build would therefore leave the providers
      // holding the previous set, so re-apply it here to keep them honest.
      if (saved?.success && isActive) {
        await runMutation(
          `toggle:${skillId}`,
          () => window.electronAPI.agentSkills.applyBuild({ buildId: selectedBuild.id }),
          null,
        );
      }
    },
    [runMutation, selectedBuild, skills, snapshot],
  );

  /** Deleting a build is destructive and unlabelled once gone: ask first. */
  const confirmDeleteBuild = React.useCallback(
    async (build: AgentSkillBuild) => {
      const result = await window.electronAPI.dialog.showMessageBox({
        type: "warning",
        title: "Delete build",
        message: `Delete “${build.name}”?`,
        detail:
          "The build is removed. The skills in it stay installed, and nothing is turned on or off by deleting it.",
        buttons: ["Delete", "Cancel"],
        defaultId: 1,
        cancelId: 1,
        noLink: true,
      });
      if (result.response !== 0) return;
      const mutation = await runMutation(
        `delete:${build.id}`,
        () => window.electronAPI.agentSkills.deleteBuild({ buildId: build.id }),
        "Build deleted",
      );
      // The hub renders nothing without a selection, so hand the page to a
      // surviving build rather than leaving it blank on the one just deleted.
      if (mutation?.success) {
        setSelectedBuildId((current) =>
          current === build.id
            ? (mutation.snapshot.activeBuildId ?? mutation.snapshot.builds[0]?.id ?? null)
            : current,
        );
        setOpenDetail(null);
      }
    },
    [runMutation],
  );

  const saveDraft = React.useCallback(async () => {
    const result = await runMutation(
      "save",
      () =>
        window.electronAPI.agentSkills.saveBuild({
          name: draftName,
          skillIds: draftSkillIds,
        }),
      "Build saved",
    );
    if (result?.success) {
      if (result.skillId) setSelectedBuildId(result.skillId);
      setIsEditing(false);
    }
  }, [draftName, draftSkillIds, runMutation]);

  const headerLeft = React.useMemo(() => {
    if (isEditing) return null;
    if (openDetail) {
      return <HeaderBackButton onClick={() => setOpenDetail(null)} />;
    }
    return (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-7 gap-1.5 rounded-full px-3 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-foreground/10 dark:hover:bg-foreground/15 [:hover,[data-pressed]]:bg-foreground/10 dark:[:hover,[data-pressed]]:bg-foreground/15 transition-colors"
        onClick={() => {
          const next = new URLSearchParams(searchParams);
          next.delete("view");
          setSearchParams(next);
        }}
      >
        <HugeiconsIcon icon={__LibraryHugeIcon} className="size-3.5" />
        All skills
      </Button>
    );
  }, [isEditing, openDetail, searchParams, setSearchParams]);

  const headerCenter = React.useMemo(() => {
    if (isEditing) {
      return (
        <span className="text-sm font-semibold tracking-tight text-foreground">
          {draftName ? `Edit: ${draftName}` : "New build"}
        </span>
      );
    }
    // A provider page names itself in its own heading; repeating it in the
    // header just said the same word twice.
    if (openDetail) return null;
    return selectedBuild ? (
      <span className="text-sm font-semibold tracking-tight text-foreground">
        {selectedBuild.name}
      </span>
    ) : null;
  }, [draftName, isEditing, openDetail, selectedBuild]);

  const isCurrentActive = Boolean(
    selectedBuild && snapshot?.activeBuildId === selectedBuild.id,
  );

  const headerRight = React.useMemo(() => {
    if (isEditing || openDetail || !selectedBuild) return null;
    return (
      <Button
        type="button"
        size="sm"
        className="h-7 rounded-full text-sm font-medium"
        data-tour="activate-build"
        // Read by the tutorial, which waits for the build to actually go live
        // rather than for the button to be clicked.
        data-tour-state={isCurrentActive ? "active" : "inactive"}
        onClick={() =>
          void runMutation(
            `apply:${selectedBuild.id}`,
            () => window.electronAPI.agentSkills.applyBuild({ buildId: selectedBuild.id }),
            `${selectedBuild.name} activated`,
          )
        }
        disabled={isCurrentActive || busyKey === `apply:${selectedBuild.id}`}
      >
        {busyKey === `apply:${selectedBuild.id}`
          ? "Activating…"
          : isCurrentActive
            ? "Activated"
            : "Activate build"}
      </Button>
    );
  }, [busyKey, isCurrentActive, isEditing, openDetail, runMutation, selectedBuild]);

  useProjectHeader(headerLeft, headerCenter, {
    rightAddon: headerRight,
    hideShare: true,
  });

  return (
    <div
      data-tour="skill-builds"
      className={cn(
        "skill-builds-surface relative flex h-full min-h-0 flex-col",
        "bg-[radial-gradient(135%_110%_at_50%_40%,color-mix(in_oklch,var(--foreground)_8%,var(--background))_0%,color-mix(in_oklch,var(--foreground)_2.5%,var(--background))_55%,var(--background)_100%)]",
        "after:pointer-events-none after:absolute after:inset-0 after:z-[4] after:content-['']",
        "after:bg-[radial-gradient(85%_75%_at_50%_46%,transparent_45%,color-mix(in_oklch,var(--foreground)_4%,transparent)_100%)]",
      )}
    >
      <div className="relative z-[5] mx-auto flex min-h-0 w-full max-w-[1400px] flex-1 flex-col px-6 pt-11 pb-4 sm:px-10">
        {loadError && snapshot ? <p role="status" className="px-6 py-2 text-sm text-destructive">{loadError} — showing the last local snapshot.</p> : null}
        {loadError && !snapshot ? (
          <p className="p-6 text-sm text-destructive">{loadError}</p>
        ) : !snapshot ? (
          <p role="status" className="p-6 text-sm text-muted-foreground">Reading local skills…</p>
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
            <EmptyBuilds onCreate={() => startEditing()} />
          </section>
        ) : selectedBuild ? (
          <>
            {openDetail ? (
              <DetailSheet
                detail={openDetail}
                candidates={filterPickerSkills(
                  openDetail === "cozea"
                    ? cozeaSkills(skills)
                    : providerCandidates(skills, openDetail),
                  query,
                  null,
                )}
                buildSkillIds={selectedBuild.skillIds}
                busySkillId={busyKey?.startsWith("toggle:") ? busyKey.slice(7) : null}
                onToggle={(skillId) => void toggleBuildSkill(skillId)}
                onOpenSkill={(skillId) => {
                  // Hands off to the skill's own page, which lives on the
                  // library side of this surface and reads the id from the URL.
                  // `back` carries the way home: not just "Builds", but this
                  // build's this provider page, since that is the page being
                  // left and the one Back has to return to. Both are component
                  // state here, so they only survive the trip in the URL.
                  const home = new URLSearchParams(searchParams);
                  home.set("view", "builds");
                  home.set("detail", openDetail);
                  home.set("build", selectedBuild.id);

                  const next = new URLSearchParams(searchParams);
                  next.delete("view");
                  next.set("skill", skillId);
                  next.set("back", home.toString());
                  setSearchParams(next);
                }}
                onSwitch={(direction) =>
                  setOpenDetail((current) => (current ? stepDetail(current, direction) : current))
                }
                onBack={() => setOpenDetail(null)}
              />
            ) : (
              <ProviderHub
                build={selectedBuild}
                loadout={loadout}
                skills={skills}
                isActive={snapshot?.activeBuildId === selectedBuild.id}
                busyKey={busyKey}
                onOpenProvider={setOpenDetail}
                onOpenShared={() => setOpenDetail("cozea")}
                onOpenAllSkills={() => {
                  const next = new URLSearchParams(searchParams);
                  next.delete("view");
                  setSearchParams(next);
                }}
                onEquip={() =>
                  void runMutation(
                    `apply:${selectedBuild.id}`,
                    () => window.electronAPI.agentSkills.applyBuild({ buildId: selectedBuild.id }),
                    `${selectedBuild.name} activated`,
                  )
                }
              />
            )}

            {/* The strip picks which build you are looking at, which is only
                a question on the hub. Inside a bucket page it is noise, and
                switching builds under an open page would be disorienting. */}
            {openDetail ? null : (
              <BuildStrip
                builds={builds}
                activeBuildId={snapshot?.activeBuildId ?? null}
                selectedBuildId={selectedBuildId}
                busyKey={busyKey}
                onDelete={(build) => void confirmDeleteBuild(build)}
                onSelect={(id) => {
                  setSelectedBuildId(id);
                  setIsEditing(false);
                  setOpenDetail(null);
                }}
                onCreate={() => {
                  setSelectedBuildId(null);
                  startEditing();
                }}
              />
            )}
          </>
        ) : null}
      </div>
    </div>
  );
}


/** The A/D ring: the core, then the agents, in the order the hub draws them. */
const DETAIL_RING: Array<AgentSkillProvider | "cozea"> = ["cozea", ...BUILD_PROVIDER_ORDER];

export function stepDetail(
  current: AgentSkillProvider | "cozea",
  direction: -1 | 1,
): AgentSkillProvider | "cozea" {
  const index = DETAIL_RING.indexOf(current);
  const next = (index + direction + DETAIL_RING.length) % DETAIL_RING.length;
  return DETAIL_RING[next]!;
}

/**
 * A bucket's page: every skill that bucket holds, grouped by category, with a
 * tick for the ones this build carries.
 *
 * The candidates are the whole installed library filtered to this bucket, not
 * just what the build already holds; otherwise an empty plate would open onto
 * an empty page with nothing to add.
 */
function DetailSheet({
  detail,
  candidates,
  buildSkillIds,
  busySkillId,
  onToggle,
  onOpenSkill,
  onSwitch,
  onBack: _onBack,
}: {
  detail: AgentSkillProvider | "cozea";
  candidates: AgentSkillRecord[];
  buildSkillIds: readonly string[];
  busySkillId: string | null;
  onToggle: (skillId: string) => void;
  onOpenSkill: (skillId: string) => void;
  onSwitch: (direction: -1 | 1) => void;
  onBack?: () => void;
}) {
  const isShared = detail === "cozea";
  const chosen = new Set(buildSkillIds);
  // Essential skills are always on and cannot be chosen, so they sit out of
  // the categories and the counts, in their own section at the end.
  const { choosable, essential } = partitionEssential(candidates);
  const groups = loadoutByCategory(choosable);
  const inBuild = choosable.filter((skill) => chosen.has(skill.id)).length;
  const Mark = isShared ? null : BUILD_PROVIDER_ICONS[detail];
  const title = isShared ? "Cozea" : BUILD_PROVIDER_LABELS[detail];

  // A and D walk the ring, the way the reference screen pages between
  // attributes. Ignored while typing so it cannot fight a text field.
  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, [contenteditable='true']")) return;
      const key = event.key.toLowerCase();
      if (key !== "a" && key !== "d") return;
      event.preventDefault();
      onSwitch(key === "a" ? -1 : 1);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onSwitch]);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <header className="relative flex shrink-0 items-center justify-center gap-4 px-5 pt-3 pb-3">
        <RingKey label="A" onClick={() => onSwitch(-1)} />
        <span className="flex items-center gap-2.5">
          {Mark ? (
            <Mark aria-hidden className="size-[18px] shrink-0 text-muted-foreground" />
          ) : (
            <Logo size={18} className="shrink-0 opacity-90" />
          )}
          <h2 className="text-[15px] tracking-[0.17em] text-foreground uppercase">{title}</h2>
          <span className="text-[13px] leading-none tabular-nums text-muted-foreground">
            <span className="font-medium text-foreground">{inBuild}</span>/{choosable.length}
          </span>
        </span>
        <RingKey label="D" onClick={() => onSwitch(1)} />

        <span aria-hidden="true" className="absolute inset-x-0 bottom-0 h-px bg-[var(--hub-ln)]" />
        <span
          aria-hidden="true"
          className="absolute bottom-0 left-1/2 h-0.5 w-[210px] -translate-x-1/2 bg-[var(--hub-charge)]"
        />
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 pt-1 pb-6">
        {choosable.length === 0 && essential.length === 0 ? (
          <p className="mx-auto max-w-sm py-12 text-center text-sm leading-6 text-muted-foreground">
            {isShared
              ? "Your library is empty. Skills you create or import into Cozea appear here."
              : `${BUILD_PROVIDER_LABELS[detail as AgentSkillProvider]} has no skills of its own yet. Skills from your library are listed on the Cozea page.`}
          </p>
        ) : null}

        {groups.map((group) => {
          const held = group.skills.filter((skill) => chosen.has(skill.id)).length;
          return (
            <section key={group.category} className="pt-5 first:pt-2">
              {/* Plain type, no frame: the hub carries the drawn structure,
                  and a page of lists is easier to read without it. */}
              <div className="flex items-baseline gap-2 pb-1.5">
                <h3 className="text-[11px] tracking-[0.14em] text-muted-foreground uppercase">
                  {group.label}
                </h3>
                <span className="text-[10px] tabular-nums text-muted-foreground/60">
                  {held}/{group.skills.length}
                </span>
              </div>

              <ul className="grid gap-0.5 sm:grid-cols-2">
                {group.skills.map((skill) => {
                  const isChosen = chosen.has(skill.id);
                  return (
                    <li key={skill.id} className="min-w-0">
                      {/* Two controls, not one: the box decides whether the
                          build carries the skill, the rest opens its page. */}
                      <div
                        className={cn(
                          "flex items-center gap-2.5 rounded-lg px-2.5 py-2 transition-colors",
                          isChosen
                            ? "bg-foreground/[0.07] hover:bg-foreground/[0.1]"
                            : "hover:bg-foreground/[0.04]",
                        )}
                      >
                        <button
                          type="button"
                          role="checkbox"
                          aria-checked={isChosen}
                          aria-label={`${isChosen ? "Remove" : "Add"} ${prettifySkillName(skill.name)}`}
                          disabled={busySkillId === skill.id}
                          onClick={() => onToggle(skill.id)}
                          className={cn(
                            "flex size-4 shrink-0 items-center justify-center rounded-[4px] border transition-colors",
                            "focus-visible:ring-ring/50 focus-visible:ring-2 focus-visible:outline-none",
                            "disabled:pointer-events-none disabled:opacity-60",
                            isChosen
                              ? "border-transparent bg-foreground text-background"
                              : "border-border hover:border-foreground/50",
                          )}
                        >
                          {isChosen ? (
                            <HugeiconsIcon icon={__TickHugeIcon} className="size-3" />
                          ) : null}
                        </button>
                        <button
                          type="button"
                          onClick={() => onOpenSkill(skill.id)}
                          className="flex min-w-0 flex-1 items-center gap-2.5 text-left focus-visible:ring-ring/50 focus-visible:rounded-md focus-visible:ring-2 focus-visible:outline-none"
                        >
                          <SkillMark name={skill.name} lit={isChosen} />
                          <span className="min-w-0 flex-1">
                            <span
                              className={cn(
                                "block truncate text-[13px] font-medium transition-colors",
                                isChosen ? "text-foreground" : "text-muted-foreground",
                              )}
                            >
                              {prettifySkillName(skill.name)}
                            </span>
                            <span className="mt-0.5 block truncate text-[11px] text-muted-foreground/80">
                              {conciseDescription(skill.description)}
                            </span>
                          </span>
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}

        {essential.length > 0 ? (
          <section className="pt-6">
            <div className="flex items-baseline gap-2 pb-1.5">
              <h3 className="text-[11px] tracking-[0.14em] text-muted-foreground uppercase">
                Essential
              </h3>
              <span className="text-[10px] tabular-nums text-muted-foreground/60">
                {essential.length}
              </span>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-label="Why these cannot be switched off"
                    className="flex size-4 items-center justify-center rounded-full text-muted-foreground/70 transition-colors hover:text-foreground"
                  >
                    <HugeiconsIcon icon={__InfoHugeIcon} className="size-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top">
                  {ESSENTIAL_SKILL_NOTE}
                </TooltipContent>
              </Tooltip>
            </div>

            <ul className="grid gap-0.5 sm:grid-cols-2">
              {essential.map((skill) => (
                <li key={skill.id} className="min-w-0">
                  <div className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 transition-colors hover:bg-foreground/[0.04]">
                    {/* No tick: the provider restores these, so a build cannot
                        promise to turn one off. */}
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span
                          tabIndex={0}
                          role="note"
                          aria-label={ESSENTIAL_SKILL_NOTE}
                          className="flex size-4 shrink-0 items-center justify-center rounded-full text-muted-foreground/70"
                        >
                          <HugeiconsIcon icon={__InfoHugeIcon} className="size-3.5" />
                        </span>
                      </TooltipTrigger>
                      <TooltipContent side="top">
                        {ESSENTIAL_SKILL_NOTE}
                      </TooltipContent>
                    </Tooltip>
                    <button
                      type="button"
                      onClick={() => onOpenSkill(skill.id)}
                      className="flex min-w-0 flex-1 items-center gap-2.5 text-left focus-visible:ring-ring/50 focus-visible:rounded-md focus-visible:ring-2 focus-visible:outline-none"
                    >
                      <SkillMark name={skill.name} lit={false} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-medium text-muted-foreground">
                          {prettifySkillName(skill.name)}
                        </span>
                        <span className="mt-0.5 block truncate text-[11px] text-muted-foreground/80">
                          {conciseDescription(skill.description)}
                        </span>
                      </span>
                    </button>
                    <span className="shrink-0 text-[9px] tracking-[0.16em] text-muted-foreground/60 uppercase">
                      Essential
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </div>
  );
}

/**
 * A skill's stand-in image. Skills ship no artwork, so this is a monogram on a
 * chamfered plate, cut the same way as the hub's.
 */
function SkillMark({ name, lit }: { name: string; lit: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "relative flex size-7 shrink-0 items-center justify-center border transition-colors",
        "[clip-path:polygon(0_0,calc(100%-6px)_0,100%_6px,100%_100%,6px_100%,0_calc(100%-6px))]",
        lit
          ? "border-[var(--hub-ln-hi)] bg-[var(--hub-fill-hi)] text-foreground"
          : "border-[var(--hub-ln)] bg-[var(--hub-fill)] text-muted-foreground",
      )}
    >
      <span className="text-[10px] leading-none font-medium tracking-[0.04em]">
        {skillMonogram(name)}
      </span>
    </span>
  );
}

/** The bracketed A / D keys that page between agents. */
function RingKey({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label === "A" ? "Previous agent" : "Next agent"}
      className="flex h-[22px] min-w-[26px] items-center justify-center rounded-[4px] border border-[var(--hub-ln)] px-1.5 font-mono text-[11px] text-muted-foreground transition-colors hover:border-[var(--hub-ln-hi)] hover:text-foreground"
    >
      {label}
    </button>
  );
}

/** Shared chrome for the small actions that sit on a build card. */
const CARD_ACTION_CLASS = cn(
  "flex size-6 items-center justify-center rounded-md text-muted-foreground",
  "transition-colors focus-visible:ring-ring/50 focus-visible:ring-2 focus-visible:outline-none",
  "disabled:pointer-events-none disabled:opacity-40",
);

function BuildStrip({
  builds,
  activeBuildId,
  selectedBuildId,
  busyKey,
  onSelect,
  onCreate,
  onDelete,
}: {
  builds: AgentSkillBuild[];
  activeBuildId: string | null;
  selectedBuildId: string | null;
  busyKey: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onDelete: (build: AgentSkillBuild) => void;
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
            // A card is two controls: select the build, or bin it. Nesting a
            // button inside a button is invalid, so the plate is the select
            // and the trash sits over it.
            <div key={build.id} className="group relative w-[158px] shrink-0">
            <button
              type="button"
              onClick={() => onSelect(build.id)}
              aria-current={isSelected ? "true" : undefined}
              className="relative flex w-full flex-col items-start gap-0.5 px-3 py-2.5 text-left"
            >
              {/* Same chamfered plate as the hub, at card scale. */}
              <span
                aria-hidden="true"
                className={cn(
                  "absolute inset-0 border transition-colors",
                  "[clip-path:polygon(0_0,calc(100%-10px)_0,100%_10px,100%_100%,10px_100%,0_calc(100%-10px))]",
                  isSelected
                    ? "border-[var(--hub-ln-hi)] bg-[var(--hub-fill-hi)]"
                    : "border-[var(--hub-ln)] bg-[var(--hub-fill)] group-hover:border-[var(--hub-ln-hi)]",
                )}
              />
              {/* Lit top edge: the selected build reads as the powered one. */}
              {isSelected ? (
                <span
                  aria-hidden="true"
                  className="absolute inset-x-3 top-0 h-px bg-[var(--hub-charge)]"
                />
              ) : null}
              <span
                className={cn(
                  "relative w-full min-w-0 truncate text-[12.5px] font-medium transition-colors",
                  isSelected ? "text-foreground" : "text-muted-foreground group-hover:text-foreground",
                )}
              >
                {build.name}
              </span>
              <span className="relative flex items-center gap-1 text-[10px] tracking-[0.12em] text-muted-foreground uppercase">
                {build.skillIds.length}
                {build.id === activeBuildId ? (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="text-success">Activated</span>
                  </>
                ) : null}
              </span>
            </button>
            {/* Deleting a build belongs to the build, not the page header.
                Hidden until the card is under the pointer; keyboard focus
                always brings it back. */}
            <span
              className={cn(
                "absolute right-1.5 bottom-1.5 z-10 flex items-center gap-0.5 rounded-md",
                // Opaque, because the cluster sits over the card's count row.
                "bg-background/90 transition-opacity",
                "opacity-0 group-hover:opacity-100 focus-within:opacity-100",
              )}
            >
              <button
                type="button"
                onClick={() => onDelete(build)}
                disabled={busyKey === `delete:${build.id}`}
                aria-label={`Delete ${build.name}`}
                title={`Delete ${build.name}`}
                className={cn(CARD_ACTION_CLASS, "hover:bg-destructive/12 hover:text-destructive")}
              >
                <HugeiconsIcon icon={__DeleteHugeIcon} className="size-3.5" />
              </button>
            </span>
            </div>
          );
        })}
        <button
          type="button"
          onClick={onCreate}
          className="flex w-[158px] shrink-0 items-center justify-center gap-1.5 border border-dashed border-[var(--hub-ln)] px-3 py-2.5 text-[11.5px] text-muted-foreground transition-colors [clip-path:polygon(0_0,calc(100%-10px)_0,100%_10px,100%_100%,10px_100%,0_calc(100%-10px))] hover:border-[var(--hub-ln-hi)] hover:text-foreground"
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
        <SearchInput
          value={query}
          onValueChange={setQuery}
          sizeVariant="compact"
          placeholder="Search skills to add..."
        />

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

      <ScrollArea scrollFade fadeSize="2rem" className="min-h-0 flex-1" viewportClassName="p-3">
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
      </ScrollArea>
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
          A build is a named set of skills. Activate one and Cozea turns those on and
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
