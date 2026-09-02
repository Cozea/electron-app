import * as React from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  SettingsFooterActions,
  SettingsGroup,
  SettingsPageBody,
  SettingsPageHeader,
  SettingsRow,
  SettingsRowControl,
  SettingsRowLabel,
  SettingsSectionDescription,
  SettingsSectionTitle,
  settingsInlineInputClass,
  settingsInlineInputWidth,
} from "@/components/settings/SettingsChrome";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/contexts/AuthContext";
import { appToast } from "@/lib/appToast";
import { ensureNativeApi } from "@/lib/nativeApi";
import { useSearchParams } from "@/lib/router";
import { cn } from "@/lib/utils";
import type {
  AgentSkillDraft,
  AgentSkillMutationResult,
  AgentSkillProvider,
  AgentSkillProviderBinding,
  AgentSkillRecord,
  AgentSkillsSnapshot,
  AgentSkillSetupPack,
  AgentSkillSetupPackSkill,
} from "@shared/electronApiTypes";

import { HugeiconsIcon } from "@hugeicons/react";
import {
  Add01Icon as __AddHugeIcon,
  Alert02Icon as __AlertHugeIcon,
  ArrowDown01Icon as __ArrowDownHugeIcon,
  ArrowLeft01Icon as __ArrowLeftHugeIcon,
  ArrowRight01Icon as __ArrowRightHugeIcon,
  Copy01Icon as __CopyHugeIcon,
  Delete02Icon as __DeleteHugeIcon,
  Download04Icon as __DownloadHugeIcon,
  Edit02Icon as __EditHugeIcon,
  FolderAddIcon as __FolderAddHugeIcon,
  FolderLibraryIcon as __FolderLibraryHugeIcon,
  MoreHorizontalIcon as __MoreHugeIcon,
  RefreshIcon as __RefreshHugeIcon,
  Share08Icon as __ShareHugeIcon,
  Tick02Icon as __TickHugeIcon,
} from "@hugeicons/core-free-icons";

const PROVIDER_LABELS: Record<AgentSkillProvider, string> = {
  codex: "Codex",
  claude: "Claude",
  cursor: "Cursor",
  opencode: "OpenCode",
};

const ALL_PROVIDERS = Object.keys(PROVIDER_LABELS) as AgentSkillProvider[];

function providerBindingLabel(binding: AgentSkillProviderBinding): string {
  if (binding.enabled && binding.ownership === "managed") return "Managed by Cozea";
  if (binding.enabled) return "Found in provider folder";
  if (binding.ownership === "external") return "Disabled · restorable";
  return "Not connected";
}

function formatUpdatedAt(value: number): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function matchesSearch(skill: AgentSkillRecord, query: string): boolean {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;
  return `${skill.name} ${skill.description} ${skill.slug}`.toLowerCase().includes(normalized);
}

function providerListLabel(providers: AgentSkillProvider[]): string {
  if (providers.length === 0) return "Not enabled";
  return providers.map((provider) => PROVIDER_LABELS[provider]).join(", ");
}

function enabledProviderLabel(skill: AgentSkillRecord): string {
  return providerListLabel(
    skill.bindings
      .filter((binding) => binding.enabled)
      .map((binding) => binding.provider),
  );
}

interface SkillEditorProps {
  initialSkill: AgentSkillRecord | null;
  busy: boolean;
  onCancel: () => void;
  onSave: (draft: AgentSkillDraft) => void;
}

function SkillEditor({ initialSkill, busy, onCancel, onSave }: SkillEditorProps) {
  const [name, setName] = React.useState(initialSkill?.name ?? "");
  const [description, setDescription] = React.useState(initialSkill?.description ?? "");
  const [instructions, setInstructions] = React.useState(initialSkill?.instructions ?? "");
  const [compatibleProviders, setCompatibleProviders] = React.useState<AgentSkillProvider[]>(
    initialSkill
      ? initialSkill.bindings
          .filter((binding) => binding.compatible)
          .map((binding) => binding.provider)
      : ALL_PROVIDERS,
  );

  return (
    <div className="h-full min-h-0 overflow-y-auto">
      <SettingsPageBody className="max-w-3xl space-y-6">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="-ml-2 h-7 px-2 text-muted-foreground"
          onClick={onCancel}
          disabled={busy}
        >
          <HugeiconsIcon icon={__ArrowLeftHugeIcon} />
          Back
        </Button>

        <SettingsPageHeader
          title={initialSkill ? `Edit ${initialSkill.name}` : "New skill"}
          description="Define what the skill does and which providers can use it."
          className="mb-0"
        />

        <section>
          <SettingsSectionTitle>Basics</SettingsSectionTitle>
          <SettingsGroup>
            <SettingsRow>
              <SettingsRowLabel title="Name" htmlFor="agent-skill-name" />
              <SettingsRowControl>
                <Input
                  id="agent-skill-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Review pull requests"
                  autoFocus
                  className={cn(settingsInlineInputClass, settingsInlineInputWidth)}
                />
              </SettingsRowControl>
            </SettingsRow>
            <SettingsRow>
              <SettingsRowLabel title="Description" htmlFor="agent-skill-description" />
              <SettingsRowControl>
                <Input
                  id="agent-skill-description"
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder="When should an agent use this?"
                  className={cn(settingsInlineInputClass, settingsInlineInputWidth)}
                />
              </SettingsRowControl>
            </SettingsRow>
          </SettingsGroup>
        </section>

        <section>
          <SettingsSectionTitle>Compatible providers</SettingsSectionTitle>
          <SettingsGroup>
            {ALL_PROVIDERS.map((provider) => (
              <SettingsRow key={provider}>
                <SettingsRowLabel title={PROVIDER_LABELS[provider]} />
                <SettingsRowControl>
                  <Switch
                    aria-label={`Make this skill compatible with ${PROVIDER_LABELS[provider]}`}
                    checked={compatibleProviders.includes(provider)}
                    onCheckedChange={(checked) => {
                      setCompatibleProviders((current) =>
                        checked
                          ? Array.from(new Set([...current, provider]))
                          : current.filter((candidate) => candidate !== provider),
                      );
                    }}
                  />
                </SettingsRowControl>
              </SettingsRow>
            ))}
          </SettingsGroup>
        </section>

        <section>
          <SettingsSectionTitle>Instructions</SettingsSectionTitle>
          <SettingsSectionDescription>
            Write the workflow and constraints the agent should follow.
          </SettingsSectionDescription>
          <SettingsGroup>
            <Textarea
              value={instructions}
              onChange={(event) => setInstructions(event.target.value)}
              placeholder={"Start by inspecting the project…\n\nWhen complete, verify…"}
              className="min-h-80 resize-y rounded-none border-0 bg-transparent p-5 font-mono text-[13px] leading-6 shadow-none focus-visible:ring-0"
            />
          </SettingsGroup>
        </section>

        <SettingsFooterActions className="gap-2">
          <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={busy}
            onClick={() =>
              onSave({
                skillId: initialSkill?.id,
                name,
                description,
                instructions,
                compatibleProviders,
              })
            }
          >
            {busy ? "Saving…" : "Save skill"}
          </Button>
        </SettingsFooterActions>
      </SettingsPageBody>
    </div>
  );
}

interface SkillInspectorProps {
  skill: AgentSkillRecord;
  busyKey: string | null;
  changedProviders: AgentSkillProvider[];
  onBack: () => void;
  onEdit: () => void;
  onCopy: () => void;
  onRemove: () => void;
  onToggleProvider: (provider: AgentSkillProvider, enabled: boolean) => void;
}

function SkillInspector({
  skill,
  busyKey,
  changedProviders,
  onBack,
  onEdit,
  onCopy,
  onRemove,
  onToggleProvider,
}: SkillInspectorProps) {
  const [instructionsOpen, setInstructionsOpen] = React.useState(false);
  const liveChanged = changedProviders.includes("claude");
  const restartChanged = changedProviders.filter((provider) => provider !== "claude");

  React.useEffect(() => {
    setInstructionsOpen(false);
  }, [skill.id]);

  return (
    <div className="h-full min-h-0 overflow-y-auto">
      <SettingsPageBody className="max-w-3xl space-y-6">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="-ml-2 h-7 px-2 text-muted-foreground"
          onClick={onBack}
        >
          <HugeiconsIcon icon={__ArrowLeftHugeIcon} />
          All skills
        </Button>

        <div className="flex items-start justify-between gap-4">
          <SettingsPageHeader
            title={skill.name}
            description={skill.description || "No description provided."}
            className="mb-0 min-w-0"
          />
          <div className="flex shrink-0 items-center gap-2">
            {skill.source === "managed" ? (
              <Button variant="outline" size="sm" onClick={onEdit}>
                <HugeiconsIcon icon={__EditHugeIcon} />
                Edit
              </Button>
            ) : (
              <Button size="sm" onClick={onCopy} disabled={busyKey === "copy"}>
                <HugeiconsIcon icon={__CopyHugeIcon} />
                {busyKey === "copy" ? "Copying…" : "Copy to my library"}
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`More actions for ${skill.name}`}
                >
                  <HugeiconsIcon icon={__MoreHugeIcon} />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                <DropdownMenuItem
                  variant="destructive"
                  onClick={onRemove}
                  disabled={busyKey === "remove"}
                >
                  <HugeiconsIcon icon={__DeleteHugeIcon} />
                  Remove skill
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        <section aria-labelledby="skill-providers-title">
          <SettingsSectionTitle>
            <span id="skill-providers-title">Use with</span>
          </SettingsSectionTitle>
          <SettingsSectionDescription>
            Changes apply to provider apps on this Mac. Other devices keep their own setup.
          </SettingsSectionDescription>
          <SettingsGroup>
            {skill.bindings.map((binding) => (
              <SettingsRow key={binding.provider}>
                <SettingsRowLabel
                  title={PROVIDER_LABELS[binding.provider]}
                  description={providerBindingLabel(binding)}
                />
                <SettingsRowControl>
                  {binding.compatible ? (
                    <Switch
                      aria-label={`${binding.enabled ? "Disable" : "Enable"} ${skill.name} for ${PROVIDER_LABELS[binding.provider]}`}
                      checked={binding.enabled}
                      disabled={busyKey === `provider:${binding.provider}`}
                      onCheckedChange={(enabled) => onToggleProvider(binding.provider, enabled)}
                    />
                  ) : (
                    <span className="text-xs text-muted-foreground">Not compatible</span>
                  )}
                </SettingsRowControl>
              </SettingsRow>
            ))}
          </SettingsGroup>

          {changedProviders.length > 0 ? (
            <div
              className={cn(
                "mt-2 flex items-start gap-2 px-1 text-[11px] leading-5",
                restartChanged.length > 0
                  ? "text-amber-800 dark:text-amber-300"
                  : "text-emerald-700 dark:text-emerald-400",
              )}
            >
              <HugeiconsIcon
                icon={restartChanged.length > 0 ? __AlertHugeIcon : __TickHugeIcon}
                className="mt-0.5 size-3.5 shrink-0"
              />
              <p>
                {liveChanged ? "Claude updates live. " : ""}
                {restartChanged.length > 0
                  ? `Restart standalone ${restartChanged.map((provider) => PROVIDER_LABELS[provider]).join(", ")} to guarantee the change is loaded.`
                  : "The change is active."}
              </p>
            </div>
          ) : null}
        </section>

        <section aria-labelledby="skill-instructions-title">
          <SettingsSectionTitle>
            <span id="skill-instructions-title">Instructions</span>
          </SettingsSectionTitle>
          <SettingsGroup>
            <button
              type="button"
              className="flex min-h-[58px] w-full items-center justify-between gap-6 px-6 py-4 text-left transition-colors hover:bg-accent/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
              aria-expanded={instructionsOpen}
              onClick={() => setInstructionsOpen((current) => !current)}
            >
              <span className="min-w-0">
                <span className="block text-sm font-medium text-foreground">
                  {instructionsOpen ? "Hide instructions" : "View instructions"}
                </span>
                <span className="mt-0.5 block text-xs text-muted-foreground/80">
                  Loaded by providers from SKILL.md
                </span>
              </span>
              <HugeiconsIcon
                icon={__ArrowDownHugeIcon}
                className={cn(
                  "size-4 shrink-0 text-muted-foreground transition-transform duration-200",
                  instructionsOpen && "rotate-180",
                )}
              />
            </button>
            {instructionsOpen ? (
              <div className="border-t border-border/25 px-6 py-5">
                <pre className="whitespace-pre-wrap break-words font-mono text-[13px] leading-6 text-foreground/90">
                  {skill.instructions || "No instructions provided."}
                </pre>
              </div>
            ) : null}
          </SettingsGroup>
        </section>

        <p className="px-1 text-[11px] text-muted-foreground/75">
          {skill.source === "managed" ? "My library" : "External"} ·{" "}
          <span className="font-mono">{skill.slug}</span> · Updated {formatUpdatedAt(skill.updatedAt)}
          {skill.originLabel ? ` · ${skill.originLabel}` : ""}
        </p>
      </SettingsPageBody>
    </div>
  );
}

function SetupPackBrowser({
  pack,
  selectedSkill,
  busy,
  onClose,
  onClearSelection,
  onSelect,
  onCopy,
}: {
  pack: AgentSkillSetupPack;
  selectedSkill: AgentSkillSetupPackSkill | null;
  busy: boolean;
  onClose: () => void;
  onClearSelection: () => void;
  onSelect: (skillId: string) => void;
  onCopy: (skillId: string) => void;
}) {
  if (selectedSkill) {
    return (
      <div className="h-full min-h-0 overflow-y-auto">
        <SettingsPageBody className="max-w-3xl space-y-6">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="-ml-2 h-7 px-2 text-muted-foreground"
            onClick={onClearSelection}
          >
            <HugeiconsIcon icon={__ArrowLeftHugeIcon} />
            Back to shared setup
          </Button>

          <div className="flex items-start justify-between gap-4">
            <SettingsPageHeader
              title={selectedSkill.name}
              description={selectedSkill.description || "No description provided."}
              className="mb-0 min-w-0"
            />
            <Button
              className="shrink-0"
              size="sm"
              onClick={() => onCopy(selectedSkill.packSkillId)}
              disabled={busy}
            >
              <HugeiconsIcon icon={__CopyHugeIcon} />
              {busy ? "Copying…" : "Copy to my library"}
            </Button>
          </div>

          <section>
            <SettingsSectionTitle>Compatible providers</SettingsSectionTitle>
            <SettingsGroup>
              <SettingsRow>
                <SettingsRowLabel
                  title={providerListLabel(selectedSkill.compatibleProviders)}
                  description="Compatibility from this shared setup"
                />
              </SettingsRow>
            </SettingsGroup>
          </section>

          <section>
            <SettingsSectionTitle>Instructions</SettingsSectionTitle>
            <SettingsGroup>
              <div className="px-6 py-5">
                <pre className="whitespace-pre-wrap break-words font-mono text-[13px] leading-6 text-foreground/90">
                  {selectedSkill.instructions || "No instructions provided."}
                </pre>
              </div>
            </SettingsGroup>
          </section>
        </SettingsPageBody>
      </div>
    );
  }

  return (
    <div className="h-full min-h-0 overflow-y-auto">
      <SettingsPageBody className="max-w-3xl space-y-6">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="-ml-2 h-7 px-2 text-muted-foreground"
          onClick={onClose}
        >
          <HugeiconsIcon icon={__ArrowLeftHugeIcon} />
          Back to my library
        </Button>

        <SettingsPageHeader
          title={pack.setupName}
          description={`Read-only setup shared by ${pack.authorName || "a teammate"} · ${pack.skills.length} ${pack.skills.length === 1 ? "skill" : "skills"}`}
          className="mb-0"
        />

        <section>
          <SettingsSectionTitle>Shared skills</SettingsSectionTitle>
          <SettingsGroup>
            {pack.skills.length > 0 ? (
              pack.skills.map((skill) => (
                <button
                  key={skill.packSkillId}
                  type="button"
                  onClick={() => onSelect(skill.packSkillId)}
                  className="flex min-h-[68px] w-full items-center justify-between gap-6 px-6 py-4 text-left transition-colors hover:bg-accent/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-foreground">{skill.name}</span>
                    <span className="mt-0.5 block truncate text-xs text-muted-foreground/80">
                      {skill.description || "No description"}
                    </span>
                    <span className="mt-1 block text-[11px] text-muted-foreground/65">
                      {providerListLabel(skill.compatibleProviders)}
                    </span>
                  </span>
                  <HugeiconsIcon
                    icon={__ArrowRightHugeIcon}
                    className="size-4 shrink-0 text-muted-foreground/60"
                  />
                </button>
              ))
            ) : (
              <div className="px-6 py-10 text-center text-sm text-muted-foreground">
                This setup has no skills.
              </div>
            )}
          </SettingsGroup>
        </section>
      </SettingsPageBody>
    </div>
  );
}

export function AgentSkillsPage() {
  const { user } = useAuth();
  const [searchParams] = useSearchParams();
  const [snapshot, setSnapshot] = React.useState<AgentSkillsSnapshot | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [selectedSkillId, setSelectedSkillId] = React.useState<string | null>(null);
  const [editorMode, setEditorMode] = React.useState<"create" | "edit" | null>(null);
  const [busyKey, setBusyKey] = React.useState<string | null>(null);
  const [changedProviders, setChangedProviders] = React.useState<AgentSkillProvider[]>([]);
  const [setupPack, setSetupPack] = React.useState<AgentSkillSetupPack | null>(null);
  const [selectedPackSkillId, setSelectedPackSkillId] = React.useState<string | null>(null);

  const loadSnapshot = React.useCallback(async () => {
    setLoadError(null);
    try {
      const next = await window.electronAPI.agentSkills.list();
      setSnapshot(next);
      setSelectedSkillId((current) =>
        current && next.skills.some((skill) => skill.id === current) ? current : null,
      );
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Unable to load agent skills.");
    }
  }, []);

  React.useEffect(() => {
    void loadSnapshot();
  }, [loadSnapshot]);

  const query = searchParams.get("q") ?? "";
  const source = searchParams.get("source") ?? "all";
  const provider = searchParams.get("provider") as AgentSkillProvider | null;
  const visibleSkills = React.useMemo(() => {
    if (!snapshot) return [];
    return snapshot.skills.filter((skill) => {
      if (!matchesSearch(skill, query)) return false;
      if (source !== "all" && skill.source !== source) return false;
      if (
        provider &&
        !skill.bindings.some((binding) => binding.provider === provider && binding.enabled)
      ) {
        return false;
      }
      return true;
    });
  }, [provider, query, snapshot, source]);

  const selectedSkill = snapshot?.skills.find((skill) => skill.id === selectedSkillId) ?? null;
  const selectedPackSkill =
    setupPack?.skills.find((skill) => skill.packSkillId === selectedPackSkillId) ?? null;

  const refreshCozeaAgents = React.useCallback(
    async (providers: AgentSkillProvider[] | undefined) => {
      if (!providers?.length) return;
      try {
        await ensureNativeApi().server.refreshProviders();
      } catch {
        // The runtime's periodic provider snapshot will still converge.
      }
    },
    [],
  );

  const acceptMutation = React.useCallback(
    async (result: AgentSkillMutationResult, successTitle: string) => {
      setSnapshot(result.snapshot);
      if (!result.success) {
        if (result.error && !/canceled/i.test(result.error)) {
          appToast.error({ title: "Agent Skills", description: result.error });
        }
        return false;
      }
      if (result.skillId) setSelectedSkillId(result.skillId);
      setChangedProviders(result.changedProviders ?? []);
      await refreshCozeaAgents(result.changedProviders);
      appToast.success({ title: successTitle });
      return true;
    },
    [refreshCozeaAgents],
  );

  const runMutation = React.useCallback(
    async (
      key: string,
      operation: () => Promise<AgentSkillMutationResult>,
      successTitle: string,
    ) => {
      setBusyKey(key);
      try {
        return await acceptMutation(await operation(), successTitle);
      } catch (error) {
        appToast.error({
          title: "Agent Skills",
          description: error instanceof Error ? error.message : "The local operation failed.",
        });
        return false;
      } finally {
        setBusyKey(null);
      }
    },
    [acceptMutation],
  );

  const handleRemove = React.useCallback(async () => {
    if (!selectedSkill) return;
    const result = await window.electronAPI.dialog.showMessageBox({
      type: "warning",
      title: "Remove agent skill",
      message: `Remove “${selectedSkill.name}”?`,
      detail:
        selectedSkill.source === "managed"
          ? "Cozea will disconnect its provider copies and move the personal library copy to recoverable local trash."
          : "Provider copies will be moved to recoverable local trash. Cozea will not delete files permanently.",
      buttons: ["Remove", "Cancel"],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
    });
    if (result.response !== 0) return;
    const success = await runMutation(
      "remove",
      () => window.electronAPI.agentSkills.remove({ skillId: selectedSkill.id }),
      "Skill removed",
    );
    if (success) {
      setSelectedSkillId(null);
      setChangedProviders([]);
    }
  }, [runMutation, selectedSkill]);

  const displayName =
    [user?.firstName, user?.lastName].filter(Boolean).join(" ") || user?.email || "Cozea user";

  if (setupPack) {
    return (
      <SetupPackBrowser
        pack={setupPack}
        selectedSkill={selectedPackSkill}
        busy={busyKey === "pack-copy"}
        onClose={() => {
          setSetupPack(null);
          setSelectedPackSkillId(null);
        }}
        onClearSelection={() => setSelectedPackSkillId(null)}
        onSelect={setSelectedPackSkillId}
        onCopy={(packSkillId) => {
          void runMutation(
            "pack-copy",
            () =>
              window.electronAPI.agentSkills.copyFromSetupPack({ pack: setupPack, packSkillId }),
            "Skill copied to your library",
          ).then((success) => {
            if (success) {
              setSetupPack(null);
              setSelectedPackSkillId(null);
            }
          });
        }}
      />
    );
  }

  if (editorMode) {
    return (
      <SkillEditor
        key={`${editorMode}:${selectedSkill?.id ?? "new"}`}
        initialSkill={editorMode === "edit" ? selectedSkill : null}
        busy={busyKey === "save"}
        onCancel={() => setEditorMode(null)}
        onSave={(draft) => {
          void runMutation(
            "save",
            () => window.electronAPI.agentSkills.save(draft),
            "Skill saved",
          ).then((success) => {
            if (success) setEditorMode(null);
          });
        }}
      />
    );
  }

  if (selectedSkill) {
    return (
      <SkillInspector
        skill={selectedSkill}
        busyKey={busyKey}
        changedProviders={changedProviders}
        onBack={() => {
          setSelectedSkillId(null);
          setChangedProviders([]);
        }}
        onEdit={() => setEditorMode("edit")}
        onCopy={() => {
          void runMutation(
            "copy",
            () => window.electronAPI.agentSkills.copyToLibrary({ skillId: selectedSkill.id }),
            "Skill copied to your library",
          );
        }}
        onRemove={() => void handleRemove()}
        onToggleProvider={(providerId, enabled) => {
          void runMutation(
            `provider:${providerId}`,
            () =>
              window.electronAPI.agentSkills.setProviderEnabled({
                skillId: selectedSkill.id,
                provider: providerId,
                enabled,
              }),
            enabled
              ? `Enabled for ${PROVIDER_LABELS[providerId]}`
              : `Disabled for ${PROVIDER_LABELS[providerId]}`,
          );
        }}
      />
    );
  }

  return (
    <div className="h-full min-h-0 overflow-y-auto">
      <SettingsPageBody className="max-w-3xl space-y-6">
        <div className="flex items-start justify-between gap-4">
          <SettingsPageHeader
            title="Agent Skills"
            description={
              snapshot
                ? visibleSkills.length === snapshot.skills.length
                  ? `${snapshot.skills.length} ${snapshot.skills.length === 1 ? "skill" : "skills"} on this Mac`
                  : `${visibleSkills.length} of ${snapshot.skills.length} skills`
                : "Skills available to your agent apps on this Mac"
            }
            className="mb-0 min-w-0"
          />
          <div className="flex shrink-0 items-center gap-1.5">
            <Button size="sm" onClick={() => setEditorMode("create")}>
              <HugeiconsIcon icon={__AddHugeIcon} />
              New skill
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label="More library actions">
                  <HugeiconsIcon icon={__MoreHugeIcon} />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuItem onClick={() => void loadSnapshot()}>
                  <HugeiconsIcon icon={__RefreshHugeIcon} />
                  Refresh library
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={busyKey === "import"}
                  onClick={() =>
                    void runMutation(
                      "import",
                      () => window.electronAPI.agentSkills.importDirectory(),
                      "Skill imported",
                    )
                  }
                >
                  <HugeiconsIcon icon={__FolderAddHugeIcon} />
                  Import folder
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => {
                    void window.electronAPI.agentSkills.openSetupPack().then((result) => {
                      if (!result.success || !result.pack) {
                        if (result.error && !/canceled/i.test(result.error)) {
                          appToast.error({
                            title: "Could not open setup",
                            description: result.error,
                          });
                        }
                        return;
                      }
                      setSetupPack(result.pack);
                      setSelectedPackSkillId(null);
                    });
                  }}
                >
                  <HugeiconsIcon icon={__ShareHugeIcon} />
                  Open shared setup
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => {
                    void window.electronAPI.agentSkills
                      .exportSetupPack({ setupName: "My agent setup", authorName: displayName })
                      .then((result) => {
                        if (result.success) {
                          appToast.success({
                            title: "Setup pack exported",
                            description: result.filePath,
                          });
                        } else if (result.error && !/canceled/i.test(result.error)) {
                          appToast.error({
                            title: "Could not export setup",
                            description: result.error,
                          });
                        }
                      });
                  }}
                >
                  <HugeiconsIcon icon={__DownloadHugeIcon} />
                  Export setup
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        <section aria-label="Skill library">
          <SettingsSectionTitle>Library</SettingsSectionTitle>
          {loadError ? (
            <SettingsGroup>
              <div className="px-6 py-4 text-sm text-destructive">{loadError}</div>
            </SettingsGroup>
          ) : !snapshot ? (
            <SettingsGroup>
              {[0, 1, 2].map((item) => (
                <div key={item} className="flex min-h-[72px] items-center px-6 py-4">
                  <div className="h-9 w-full animate-pulse rounded-lg bg-muted" />
                </div>
              ))}
            </SettingsGroup>
          ) : visibleSkills.length === 0 ? (
            <SettingsGroup>
              <div className="px-6 py-10 text-center">
                <HugeiconsIcon
                  icon={__FolderLibraryHugeIcon}
                  className="mx-auto size-6 text-muted-foreground/55"
                />
                <p className="mt-3 text-sm font-medium text-foreground">No matching skills</p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  Try another search or filter, or create a new skill.
                </p>
              </div>
            </SettingsGroup>
          ) : (
            <SettingsGroup>
              {visibleSkills.map((skill) => (
                <button
                  key={skill.id}
                  type="button"
                  onClick={() => {
                    setSelectedSkillId(skill.id);
                    setChangedProviders([]);
                  }}
                  className="flex min-h-[76px] w-full items-center justify-between gap-6 px-6 py-4 text-left transition-colors hover:bg-accent/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-foreground">{skill.name}</span>
                    <span className="mt-0.5 block truncate text-xs text-muted-foreground/80">
                      {skill.description || "No description"}
                    </span>
                    <span className="mt-1 block text-[11px] text-muted-foreground/65">
                      {skill.source === "managed" ? "My library" : "External"} ·{" "}
                      {enabledProviderLabel(skill)}
                    </span>
                  </span>
                  <HugeiconsIcon
                    icon={__ArrowRightHugeIcon}
                    className="size-4 shrink-0 text-muted-foreground/60"
                  />
                </button>
              ))}
            </SettingsGroup>
          )}
        </section>
      </SettingsPageBody>
    </div>
  );
}

export default AgentSkillsPage;
