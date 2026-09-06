import * as React from "react";

import { Button } from "@/components/ui/button";
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
  settingsNativeSelectClass,
} from "@/features/settings/ui/SettingsChrome";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/contexts/AuthContext";
import { appToast } from "@/lib/appToast";
import { ensureNativeApi } from "@/lib/nativeApi";
import { useSearchParams } from "@/lib/router";
import { cn } from "@/lib/utils";
import { useProjectHeader } from "@/lib/useProjectHeader";
import { SkillBuildsView } from "@/features/projects/pages/SkillBuildsView";
import { ScheduledTasksView } from "@/features/projects/pages/ScheduledTasksView";
import { agentSkillsSnapshot, useAgentSkillsSnapshot } from "@/features/projects/model/agentSkillsSnapshot";
import { showDesktopContextMenu } from "@/lib/desktopBridgeClient";
import { getNativeMenuIcon } from "@/lib/nativeMenuIcons";
import type { ContextMenuItem } from "@cozea/assistant-contracts";
import {
  AgentSkillCategoryCarousel,
  type AgentSkillCategoryGroup,
} from "@/features/projects/components/AgentSkillCategoryCarousel";
import {
  AGENT_SKILL_CATEGORIES,
  agentSkillCategoryLabel,
  agentSkillCategoryOrder,
} from "@shared/agentSkillCategories";
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
  Cancel01Icon as __CancelHugeIcon,
  Copy01Icon as __CopyHugeIcon,
  Delete02Icon as __DeleteHugeIcon,
  Download04Icon as __DownloadHugeIcon,
  Edit02Icon as __EditHugeIcon,
  FolderAddIcon as __FolderAddHugeIcon,
  FolderLibraryIcon as __FolderLibraryHugeIcon,
  MoreHorizontalIcon as __MoreHugeIcon,
  RefreshIcon as __RefreshHugeIcon,
  Search01Icon as __SearchHugeIcon,
  Settings02Icon as __SettingsHugeIcon,
  Share08Icon as __ShareHugeIcon,
  InformationCircleIcon as __InfoHugeIcon,
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
  if (binding.enabled && binding.variant) return "Provider folder · its own copy";
  if (binding.enabled) return "Found in provider folder";
  if (binding.available) return "In the plugin catalog · not installed";
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

/** Initialisms that should not be sentence-cased when a slug is prettified. */
const SKILL_NAME_ACRONYMS = new Map<string, string>(
  Object.entries({
    ai: "AI", api: "API", ci: "CI", cli: "CLI", css: "CSS", db: "DB", docx: "DOCX",
    html: "HTML", io: "IO", ios: "iOS", mcp: "MCP", md: "MD", pdf: "PDF", pptx: "PPTX", pr: "PR",
    qa: "QA", sdk: "SDK", seo: "SEO", ui: "UI", ux: "UX", xlsx: "XLSX",
  }),
);

/** Joining words stay lower-case unless they open the title. */
const SKILL_NAME_MINOR_WORDS = new Set([
  "a", "an", "and", "as", "at", "but", "by", "for", "from", "in", "into", "of", "on", "or",
  "per", "the", "to", "via", "with",
]);

/**
 * Skill names are declared as invocation slugs — `cloudflare-email-service` —
 * because that is what you type to call one. They read as identifiers rather
 * than names when browsing, so the list shows a title-cased form.
 *
 * If a skill has a plugin/package prefix (e.g. `build-ios-apps:ios-debugger-agent`),
 * only the actual skill name is shown.
 */
export function prettifySkillName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return trimmed;

  const target = trimmed.includes(":") ? trimmed.slice(trimmed.lastIndexOf(":") + 1).trim() : trimmed;
  if (!target || /[A-Z\s]/.test(target)) return target;

  return target
    .split(/[-_]/)
    .filter(Boolean)
    .map((word, index) => {
      const acronym = SKILL_NAME_ACRONYMS.get(word.toLowerCase());
      if (acronym) return acronym;
      if (index > 0 && SKILL_NAME_MINOR_WORDS.has(word.toLowerCase())) return word.toLowerCase();
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(" ");
}

/**
 * What fits on one line of a library row at a typical window width, next to
 * the row's toggle or Install button. Kept short deliberately: the browser
 * clips anything wider mid-word, which is worse than a clause we chose.
 */
const CONCISE_DESCRIPTION_LIMIT = 72;

/**
 * Openings that say when to reach for a skill rather than what it does. The
 * row has no space for the ceremony, and the full text is a click away.
 */
const DESCRIPTION_PREAMBLE = new RegExp(
  "^(?:" +
    [
      "use\\s+(?:this\\s+skill\\s+)?(?:when|whenever|for|to)",
      "this\\s+skill\\s+(?:is\\s+for|should\\s+be\\s+used\\s+(?:when|to|for))",
      "(?:load|invoke|trigger)\\s+(?:this\\s+skill\\s+)?(?:when|before)",
    ].join("|") +
    ")\\s+" +
    // The same trailing clause follows any of those openings.
    "(?:the\\s+user\\s+(?:wants?|asks?|needs?)\\s+(?:to\\s+|for\\s+)?)?",
  "i",
);

function stripDescriptionPreamble(value: string): string {
  const stripped = value.replace(DESCRIPTION_PREAMBLE, "");
  // Only take it if something substantial is left to read.
  if (stripped.length < 16) return value;
  return stripped.charAt(0).toUpperCase() + stripped.slice(1);
}

/** Words that read as a broken-off sentence when a line ends on them. */
const DANGLING_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "but", "by", "can", "for", "from", "in", "into", "is",
  "its", "of", "on", "or", "that", "the", "their", "them", "then", "these", "this", "to",
  "used", "uses", "using", "when", "which", "while", "with", "your",
]);

/** Descriptions are prose, so their inline markdown is noise in a list row. */
function stripInlineMarkdown(value: string): string {
  return value
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/\*([^*\s][^*]*)\*/g, "$1");
}

/** Drop a trailing fragment so the line ends on a whole thought. */
function trimDanglingWords(value: string): string {
  const words = value.split(" ");
  while (words.length > 1 && DANGLING_WORDS.has(words[words.length - 1].toLowerCase())) {
    words.pop();
  }
  return words.join(" ");
}

/**
 * Descriptions in the wild run to a paragraph of trigger phrases, and their
 * first sentence alone often overflows the row. Take that sentence, then cut
 * it back to a clause so the line reads as something finished rather than
 * stopping mid-word; the full text is on the skill's own page.
 */
export function conciseDescription(description: string): string {
  const collapsed = stripInlineMarkdown(description.replace(/\s+/g, " ")).trim();
  if (!collapsed) return "No description";

  const firstSentence = collapsed.match(/^.*?[.!?](?=\s|$)/)?.[0] ?? collapsed;
  // A very short first match is usually an abbreviation, not a sentence.
  const sentence = stripDescriptionPreamble(
    (firstSentence.length < 24 ? collapsed : firstSentence).trim(),
  );
  if (sentence.length <= CONCISE_DESCRIPTION_LIMIT) return sentence;

  // The ellipsis counts against the budget, so the result never exceeds it.
  const budget = CONCISE_DESCRIPTION_LIMIT - 1;
  const head = sentence.slice(0, budget + 1);
  const clauseBreak = Math.max(
    head.lastIndexOf(", "),
    head.lastIndexOf("; "),
    head.lastIndexOf(": "),
    head.lastIndexOf(" — "),
    head.lastIndexOf(" – "),
    // A relative clause is the tail a one-line summary can most safely lose.
    head.lastIndexOf(" that "),
    head.lastIndexOf(" which "),
    head.lastIndexOf(" where "),
  );
  // Only honour a clause break that still leaves a useful amount of the line.
  const cut = clauseBreak > budget / 2 ? clauseBreak : head.lastIndexOf(" ");
  const trimmed = trimDanglingWords(
    sentence.slice(0, cut > 0 ? cut : budget).replace(/[\s,;:—–-]+$/, ""),
  );
  return `${trimmed}…`;
}

function isSkillEnabled(skill: AgentSkillRecord): boolean {
  return skill.bindings.some((binding) => binding.enabled);
}

export type SkillStatusFilter = "all" | "installed" | "available";

const STATUS_FILTERS: ReadonlyArray<{ id: SkillStatusFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "installed", label: "Installed" },
  { id: "available", label: "Not installed" },
];

/**
 * A provider's list is everything it can run: what it already loads, plus what
 * sits in its catalog waiting to be installed. Matching only `enabled` hid
 * every installable skill behind the provider rows in the sidebar.
 */
/**
 * What the subtitle says under "Agent Skills".
 *
 * The two source views are named after where a skill lives, which is not
 * self-explanatory, so they explain themselves rather than repeating a count
 * the list beneath already shows.
 */
/** Ships with the agent, which restores it, so Cozea cannot manage it. */
export function isEssentialSkill(skill: AgentSkillRecord): boolean {
  return skill.bindings.some((binding) => binding.essential);
}

/** The one sentence shown wherever an essential skill is marked. */
export const ESSENTIAL_SKILL_NOTE = "Cozea cannot disable or delete it.";

export function describeSkillsView(
  source: string,
  snapshot: AgentSkillsSnapshot | null,
  counts: { visible: number; available: number },
): string {
  if (source === "managed") {
    return "Skills Cozea keeps in its own library. Any agent inside Cozea can use them.";
  }
  if (source === "external") {
    return "Skills that already live in your agents' own folders.";
  }
  if (!snapshot) return "Skills available to your agent apps on this Mac";
  if (counts.visible === snapshot.skills.length) {
    const total = snapshot.skills.length;
    return `${total} ${total === 1 ? "skill" : "skills"} on this Mac · ${counts.available} ready to install`;
  }
  return `${counts.visible} of ${snapshot.skills.length} skills`;
}

export function skillMatchesProvider(
  skill: AgentSkillRecord,
  provider: AgentSkillProvider | null,
): boolean {
  if (!provider) return true;
  return skill.bindings.some(
    (binding) => binding.provider === provider && (binding.enabled || binding.available),
  );
}

export function skillMatchesStatus(skill: AgentSkillRecord, status: SkillStatusFilter): boolean {
  if (status === "all") return true;
  return status === "installed" ? skill.source !== "catalog" : skill.source === "catalog";
}

/** A catalog skill is on disk but not loaded until it is installed. */
function installProvider(skill: AgentSkillRecord): AgentSkillProvider | null {
  if (skill.source !== "catalog") return null;
  return skill.bindings.find((binding) => binding.available)?.provider ?? null;
}

/** Says what the manual Update button would actually read from. */
function updateHint(skill: AgentSkillRecord): string {
  switch (skill.updateSource) {
    case "built-in":
      return "Update to the version Cozea ships";
    case "folder":
      return `Re-read this skill from ${skill.originPath ?? "the folder it came from"}`;
    case "providers":
      return "Push your library copy to every provider that has it enabled";
    default:
      return "There is nothing to update this skill from";
  }
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
  // Blank means "let Cozea place it", which is what an unedited skill gets.
  const [category, setCategory] = React.useState(
    initialSkill?.categoryDeclared ? initialSkill.category : "",
  );
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
            <SettingsRow>
              <SettingsRowLabel
                title="Category"
                description="Which section of the library this skill sits in."
                htmlFor="agent-skill-category"
              />
              <SettingsRowControl>
                <select
                  id="agent-skill-category"
                  value={category}
                  onChange={(event) => setCategory(event.target.value)}
                  className={settingsNativeSelectClass}
                >
                  <option value="">Choose automatically</option>
                  {AGENT_SKILL_CATEGORIES.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
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
                category,
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
  onEdit: () => void;
  onCopy: () => void;
  onUpdate: () => void;
  onInstall: () => void;
  onRemove: () => void;
}

function SkillInspector({
  skill,
  busyKey,
  changedProviders,
  onEdit,
  onCopy,
  onUpdate,
  onInstall,
  onRemove,
}: SkillInspectorProps) {
  const [instructionsOpen, setInstructionsOpen] = React.useState(false);
  const [copyProvider, setCopyProvider] = React.useState<AgentSkillProvider | null>(null);
  const liveChanged = changedProviders.includes("claude");
  const restartChanged = changedProviders.filter((provider) => provider !== "claude");

  React.useEffect(() => {
    setInstructionsOpen(false);
    setCopyProvider(null);
  }, [skill.id]);

  // One skill, one page — the per-provider copies live inside it rather than
  // as separate rows, because they are the same skill tailored per provider.
  const installedProviders = skill.bindings
    .filter((binding) => binding.enabled)
    .map((binding) => binding.provider);
  const hasTailoredCopies = skill.bindings.some((binding) => binding.variant);
  const shownProvider =
    copyProvider && installedProviders.includes(copyProvider)
      ? copyProvider
      : (installedProviders[0] ?? null);
  const shownBinding = skill.bindings.find((binding) => binding.provider === shownProvider);
  const shownInstructions = shownBinding?.variant?.instructions ?? skill.instructions;
  const installFor = installProvider(skill);

  return (
    <div className="h-full min-h-0 overflow-y-auto">
      <SettingsPageBody className="max-w-3xl space-y-6">
        {/* Title and actions share a row; the description gets the full column
            below them rather than being squeezed into what the buttons leave. */}
        <div>
          <div className="flex items-start justify-between gap-4">
            <SettingsPageHeader
              title={prettifySkillName(skill.name)}
              className="mb-0 min-w-0 flex-1"
            />
            <div className="flex shrink-0 items-center gap-2">
              {skill.updateSource === "none" ? null : (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs text-muted-foreground"
                  onClick={onUpdate}
                  disabled={busyKey === `update:${skill.id}`}
                  title={updateHint(skill)}
                >
                  <HugeiconsIcon icon={__RefreshHugeIcon} className="size-3.5" />
                  {busyKey === `update:${skill.id}` ? "Updating…" : "Update"}
                </Button>
              )}
              {skill.source === "catalog" ? (
                <Button size="sm" onClick={onInstall} disabled={busyKey === "install"}>
                  <HugeiconsIcon icon={__DownloadHugeIcon} />
                  {busyKey === "install"
                    ? "Installing…"
                    : `Install for ${PROVIDER_LABELS[installFor ?? "claude"]}`}
                </Button>
              ) : skill.source === "managed" ? (
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
              {isEssentialSkill(skill) ? <EssentialTag /> : null}
              {skill.source === "catalog" || isEssentialSkill(skill) ? null : (
                <Button
                  variant="destructive-outline"
                  size="sm"
                  onClick={onRemove}
                  disabled={busyKey === "remove"}
                >
                  <HugeiconsIcon icon={__DeleteHugeIcon} />
                  {busyKey === "remove" ? "Deleting…" : "Delete"}
                </Button>
              )}
            </div>
          </div>
          <p className="mt-2 px-1 text-xs leading-5 text-muted-foreground/80">
            {skill.description || "No description provided."}
          </p>
        </div>

        <section aria-labelledby="skill-providers-title">
          <SettingsSectionTitle>
            <span id="skill-providers-title">Use with</span>
          </SettingsSectionTitle>
          <SettingsSectionDescription>
            Which providers currently run this skill. Turn skills on and off by activating a
            build.
          </SettingsSectionDescription>
          <SettingsGroup>
            {skill.bindings.map((binding) => (
              <SettingsRow key={binding.provider}>
                <SettingsRowLabel
                  title={PROVIDER_LABELS[binding.provider]}
                  description={providerBindingLabel(binding)}
                />
                <SettingsRowControl>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="inline-flex">
                        <Switch
                          checked={binding.enabled}
                          disabled
                          aria-label={`${PROVIDER_LABELS[binding.provider]}: ${binding.enabled ? "enabled" : "disabled"}`}
                        />
                      </span>
                    </TooltipTrigger>
                    <TooltipContent side="top">
                      {binding.enabled
                        ? "Switched on in active build"
                        : "Switched off in active build"}
                    </TooltipContent>
                  </Tooltip>
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
          <div className="flex items-end justify-between gap-4">
            <SettingsSectionTitle>
              <span id="skill-instructions-title">Instructions</span>
            </SettingsSectionTitle>
            {hasTailoredCopies && installedProviders.length > 1 ? (
              <div
                role="group"
                aria-label="Show the copy installed for a provider"
                className="mb-2 flex items-center gap-0.5 rounded-lg border border-border/50 bg-muted/40 p-0.5"
              >
                {installedProviders.map((provider) => (
                  <button
                    key={provider}
                    type="button"
                    aria-pressed={provider === shownProvider}
                    onClick={() => setCopyProvider(provider)}
                    className={cn(
                      "rounded-md px-2 py-1 text-[11px] transition-colors",
                      provider === shownProvider
                        ? "bg-background text-foreground shadow-xs"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {PROVIDER_LABELS[provider]}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
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
                  {hasTailoredCopies && shownProvider
                    ? `${PROVIDER_LABELS[shownProvider]} keeps its own copy, tailored to that app`
                    : installedProviders.length > 1
                      ? `The same copy in ${providerListLabel(installedProviders)}`
                      : "Loaded by providers from SKILL.md"}
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
                  {shownInstructions || "No instructions provided."}
                </pre>
              </div>
            ) : null}
          </SettingsGroup>
        </section>

        <p className="px-1 text-[11px] text-muted-foreground/75">
          {skill.source === "managed"
            ? "My library"
            : skill.source === "catalog"
              ? "Plugin catalog"
              : "External"} ·{" "}
          {agentSkillCategoryLabel(skill.category)}
          {skill.categoryDeclared ? "" : " (auto)"} ·{" "}
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

          <div>
            <div className="flex items-start justify-between gap-4">
              <SettingsPageHeader title={selectedSkill.name} className="mb-0 min-w-0 flex-1" />
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
            <p className="mt-2 px-1 text-xs leading-5 text-muted-foreground/80">
              {selectedSkill.description || "No description provided."}
            </p>
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
  const [searchParams, setSearchParams] = useSearchParams();
  const { data: snapshot, error: loadError } = useAgentSkillsSnapshot();
  const [selectedSkillId, setSelectedSkillId] = React.useState<string | null>(null);
  /**
   * The query string Back should restore, handed over by whoever opened the
   * skill. The detail is component state, not a route, so history has no entry
   * to pop, and "go to Builds" is not enough either: the surface you left was a
   * particular build's particular provider page. Whoever opens a skill knows
   * how to describe its own state, so it encodes that rather than this page
   * guessing. Null means the skill came from the library list behind it.
   */
  const [returnTo, setReturnTo] = React.useState<string | null>(null);
  const [editorMode, setEditorMode] = React.useState<"create" | "edit" | null>(null);
  const [busyKey, setBusyKey] = React.useState<string | null>(null);
  const [changedProviders, setChangedProviders] = React.useState<AgentSkillProvider[]>([]);
  const [setupPack, setSetupPack] = React.useState<AgentSkillSetupPack | null>(null);
  const [selectedPackSkillId, setSelectedPackSkillId] = React.useState<string | null>(null);

  const loadSnapshot = React.useCallback(async () => {
    await agentSkillsSnapshot.refresh().catch(() => undefined);
  }, []);

  const routeQuery = searchParams.get("q") ?? "";
  const [query, setQuery] = React.useState(routeQuery);
  React.useEffect(() => setQuery(routeQuery), [routeQuery]);

  const setParam = React.useCallback(
    (key: string, value: string | null, options?: { replace?: boolean }) => {
      if (key === "q") setQuery(value ?? "");
      const next = new URLSearchParams(searchParams);
      if (value) next.set(key, value);
      else next.delete(key);
      setSearchParams(next, options);
    },
    [searchParams, setSearchParams],
  );

  const source = searchParams.get("source") ?? "all";
  const provider = searchParams.get("provider") as AgentSkillProvider | null;
  const status = (searchParams.get("status") ?? "all") as SkillStatusFilter;
  const view = searchParams.get("view") ?? "skills";
  const skillParam = searchParams.get("skill");

  /**
   * A skill can be addressed by id, so the Builds pages can hand off to this
   * one. The param is consumed once the snapshot actually holds the skill,
   * otherwise the load below would reconcile the selection straight back to
   * null; clearing it afterwards keeps closing the skill from reopening it.
   */
  React.useEffect(() => {
    if (!skillParam || !snapshot) return;
    if (!snapshot.skills.some((skill) => skill.id === skillParam)) return;
    setSelectedSkillId(skillParam);
    setReturnTo(searchParams.get("back"));
    const next = new URLSearchParams(searchParams);
    next.delete("skill");
    next.delete("back");
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams, skillParam, snapshot]);

  React.useEffect(() => {
    if (!snapshot) return;
    setSelectedSkillId((current) =>
      current && snapshot.skills.some((skill) => skill.id === current) ? current : null,
    );
  }, [snapshot]);

  /**
   * Everything the sidebar and search allow through, before the status filter.
   * Kept separate so the status tabs can show honest counts of what picking
   * each one would give you.
   */
  const scopedSkills = React.useMemo(() => {
    if (!snapshot) return [];
    return snapshot.skills.filter((skill) => {
      if (!matchesSearch(skill, query)) return false;
      if (source !== "all" && skill.source !== source) return false;
      if (!skillMatchesProvider(skill, provider)) return false;
      return true;
    });
  }, [provider, query, snapshot, source]);

  const statusCounts = React.useMemo(
    () => ({
      all: scopedSkills.length,
      installed: scopedSkills.filter((skill) => skillMatchesStatus(skill, "installed")).length,
      available: scopedSkills.filter((skill) => skillMatchesStatus(skill, "available")).length,
    }),
    [scopedSkills],
  );

  const visibleSkills = React.useMemo(
    () =>
      scopedSkills.filter((skill) => skillMatchesStatus(skill, status)),
    [scopedSkills, status],
  );

  const setStatus = React.useCallback(
    (next: SkillStatusFilter) => {
      const params = new URLSearchParams(searchParams);
      if (next === "all") params.delete("status");
      else params.set("status", next);
      setSearchParams(params, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  /** One section per shelf, in the taxonomy's order, empty shelves omitted. */
  const skillGroups = React.useMemo(() => {
    const groups = new Map<string, AgentSkillRecord[]>();
    for (const skill of visibleSkills) {
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
    ) satisfies AgentSkillCategoryGroup[];
  }, [visibleSkills]);

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
      agentSkillsSnapshot.publish(result.snapshot);
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

  /**
   * Updating is always a deliberate click: Cozea does not poll skill origins,
   * so nothing here claims a newer version exists — it just re-reads the one
   * the skill came from.
   */
  const handleUpdate = React.useCallback(
    async (skill: AgentSkillRecord) => {
      await runMutation(
        `update:${skill.id}`,
        () => window.electronAPI.agentSkills.update({ skillId: skill.id }),
        `${skill.name} updated`,
      );
    },
    [runMutation],
  );

  const handleInstall = React.useCallback(
    async (skill: AgentSkillRecord) => {
      const provider = installProvider(skill);
      await runMutation(
        `install:${skill.id}`,
        () => window.electronAPI.agentSkills.install({ skillId: skill.id }),
        provider ? `${skill.name} installed for ${PROVIDER_LABELS[provider]}` : "Skill installed",
      );
    },
    [runMutation],
  );

  const handleRemove = React.useCallback(async () => {
    if (!selectedSkill) return;
    const result = await window.electronAPI.dialog.showMessageBox({
      type: "warning",
      title: "Delete agent skill",
      message: `Delete “${selectedSkill.name}”?`,
      detail:
        selectedSkill.source === "managed"
          ? "Cozea will disconnect its provider copies and move the personal library copy to recoverable local trash."
          : "Provider copies will be moved to recoverable local trash. Cozea will not delete files permanently.",
      buttons: ["Delete", "Cancel"],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
    });
    if (result.response !== 0) return;
    const success = await runMutation(
      "remove",
      () => window.electronAPI.agentSkills.remove({ skillId: selectedSkill.id }),
      "Skill deleted",
    );
    if (success) {
      setSelectedSkillId(null);
      setChangedProviders([]);
    }
  }, [runMutation, selectedSkill]);

  const displayName =
    [user?.firstName, user?.lastName].filter(Boolean).join(" ") || user?.email || "Cozea user";

  /**
   * Leaving the detail. A skill handed over from elsewhere replays that
   * surface's own query string, so you land back on the exact page you left,
   * not merely the section it belonged to. One opened from the library just
   * closes onto the list behind it.
   */
  const closeDetail = React.useCallback(() => {
    setSelectedSkillId(null);
    setChangedProviders([]);
    if (!returnTo) return;
    setReturnTo(null);
    setSearchParams(new URLSearchParams(returnTo));
  }, [returnTo, setSearchParams]);

  const headerBack = React.useMemo(
    () => (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-7 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground"
        onClick={closeDetail}
      >
        <HugeiconsIcon icon={__ArrowLeftHugeIcon} className="size-3.5" />
        Back
      </Button>
    ),
    [closeDetail],
  );

  const headerFilter = React.useMemo(() => {
    if (!snapshot) return null;
    return (
      <div
        data-header-segmented="true"
        role="group"
        aria-label="Filter skills by whether they are installed"
        className="flex items-center gap-1"
      >
        {STATUS_FILTERS.map((filter) => (
          <button
            key={filter.id}
            type="button"
            aria-pressed={status === filter.id}
            onClick={() => setStatus(filter.id)}
            className={cn(
              "flex items-center gap-1.5 rounded-full px-3 text-xs transition-colors cursor-pointer",
              status === filter.id
                ? "bg-white/10 dark:bg-white/10 text-foreground font-medium shadow-xs"
                : "text-muted-foreground/80 hover:text-foreground hover:bg-white/[0.05]",
            )}
          >
            <span>{filter.label}</span>
            <span
              className={cn(
                "text-[11px] tabular-nums",
                status === filter.id ? "text-foreground/70" : "text-muted-foreground/60",
              )}
            >
              {statusCounts[filter.id]}
            </span>
          </button>
        ))}
      </div>
    );
  }, [setStatus, snapshot, status, statusCounts]);

  const headerActions = React.useMemo(() => {
    return (
      <div className="flex items-center gap-1.5">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="More library actions"
              onClick={async (event) => {
                event.preventDefault();
                event.stopPropagation();
                const rect = event.currentTarget.getBoundingClientRect();
                const position = {
                  x: Math.round(rect.left),
                  y: Math.round(rect.bottom + 4),
                };
                const items: ContextMenuItem<string>[] = [
                  {
                    id: "refresh",
                    label: "Refresh library",
                    icon: getNativeMenuIcon("sync"),
                  },
                  {
                    id: "import",
                    label: "Import folder",
                    icon: getNativeMenuIcon("open-folder"),
                    enabled: busyKey !== "import",
                  },
                  {
                    id: "sep-1",
                    label: "",
                    type: "separator",
                  },
                  {
                    id: "open-setup",
                    label: "Open shared setup",
                    icon: getNativeMenuIcon("package"),
                  },
                  {
                    id: "export-setup",
                    label: "Export setup",
                    icon: getNativeMenuIcon("copy"),
                  },
                ];
                const action = await showDesktopContextMenu(items, position);
                if (!action) return;
                if (action === "refresh") {
                  void loadSnapshot();
                } else if (action === "import") {
                  void runMutation(
                    "import",
                    () => window.electronAPI.agentSkills.importDirectory(),
                    "Skill imported",
                  );
                } else if (action === "open-setup") {
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
                } else if (action === "export-setup") {
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
                }
              }}
            >
              <HugeiconsIcon icon={__SettingsHugeIcon} className="size-4" aria-hidden />
            </Button>
          </TooltipTrigger>
          <TooltipContent>More library actions</TooltipContent>
        </Tooltip>
        <Button
          type="button"
          size="sm"
          className="gap-1 rounded-full"
          onClick={() => setEditorMode("create")}
        >
          <HugeiconsIcon icon={__AddHugeIcon} className="size-3.5" aria-hidden />
          Add
        </Button>
      </div>
    );
  }, [busyKey, displayName, loadSnapshot, runMutation]);

  const onDetail = Boolean(selectedSkill) && !editorMode && !setupPack;

  useProjectHeader(
    onDetail ? headerBack : editorMode || selectedSkill || setupPack ? null : headerFilter,
    null,
    {
      rightAddon: editorMode || selectedSkill || setupPack ? null : headerActions,
      hideShare: true,
      disabled: view === "builds" || view === "schedules",
    },
  );

  if (view === "builds") {
    return <SkillBuildsView />;
  }

  if (view === "schedules") {
    return <ScheduledTasksView />;
  }

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
        onEdit={() => setEditorMode("edit")}
        onCopy={() => {
          void runMutation(
            "copy",
            () => window.electronAPI.agentSkills.copyToLibrary({ skillId: selectedSkill.id }),
            "Skill copied to your library",
          );
        }}
        onUpdate={() => void handleUpdate(selectedSkill)}
        onInstall={() => void handleInstall(selectedSkill)}
        onRemove={() => void handleRemove()}
      />
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="mx-auto w-full max-w-[960px] shrink-0 space-y-6 px-6 pt-4 pb-2">
        <header>
          <h1 className="text-[26px] leading-tight font-medium tracking-[-0.03em] text-foreground">
            Agent Skills
          </h1>
        </header>

        <div className="sticky top-[-1rem] z-20 -mx-6 bg-background/95 px-6 pt-3 pb-2 backdrop-blur-md">
          <div className="relative">
            <HugeiconsIcon
              icon={__SearchHugeIcon}
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground/70"
              aria-hidden
            />
            <Input
              type="search"
              value={query}
              onChange={(event) => {
                const val = event.target.value;
                setQuery(val);
                setParam("q", val.trim() ? val : null, { replace: true });
              }}
              onBlur={() => setParam("q", query.trim() ? query : null, { replace: true })}
              onKeyDown={(event) => {
                if (event.key === "Enter") setParam("q", query.trim() ? query : null, { replace: true });
              }}
              placeholder="Search skills…"
              className={cn("h-11 rounded-search bg-muted pl-9 text-sm", query && "pr-9")}
            />
            {query ? (
              <button
                type="button"
                onClick={() => {
                  setQuery("");
                  setParam("q", null, { replace: true });
                }}
                className="absolute top-1/2 right-3 -translate-y-1/2 text-muted-foreground hover:text-foreground p-0.5 rounded-full cursor-pointer"
                aria-label="Clear search"
              >
                <HugeiconsIcon icon={__CancelHugeIcon} className="size-3.5" />
              </button>
            ) : null}
          </div>
        </div>
      </div>

      <section aria-label="Skill library" className="flex min-h-0 flex-1 flex-col pb-2">
        {loadError && snapshot ? <p role="status" className="px-6 py-2 text-sm text-destructive">{loadError} — showing the last local snapshot.</p> : null}
        {loadError && !snapshot ? (
          <div className="mx-auto flex w-full max-w-3xl flex-1 items-center justify-center px-8 sm:px-10">
            <SettingsGroup className="w-full">
              <div className="px-6 py-4 text-sm text-destructive">{loadError}</div>
            </SettingsGroup>
          </div>
        ) : !snapshot ? (
          <div className="mx-auto flex w-full max-w-3xl flex-1 items-center justify-center px-8 sm:px-10">
            <SettingsGroup className="w-full">
              {[0, 1, 2].map((item) => (
                <div key={item} className="flex min-h-[72px] items-center px-6 py-4">
                  <div className="h-9 w-full animate-pulse rounded-lg bg-muted" />
                </div>
              ))}
            </SettingsGroup>
          </div>
        ) : visibleSkills.length === 0 ? (
          <div className="mx-auto flex w-full max-w-3xl flex-1 items-center justify-center px-8 pb-16 sm:px-10">
            <SettingsGroup className="w-full">
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
          </div>
        ) : (
            <AgentSkillCategoryCarousel
              groups={skillGroups}
              renderSkill={(skill) => {
                const enabled = isSkillEnabled(skill);
                const updating = busyKey === `update:${skill.id}`;
                const installFor = installProvider(skill);
                const installing = busyKey === `install:${skill.id}`;
                return (
                  <div
                    key={skill.id}
                    className="flex min-h-[64px] w-full items-center gap-3 px-5 py-3 transition-colors hover:bg-accent/35"
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedSkillId(skill.id);
                        setReturnTo(null);
                        setChangedProviders([]);
                      }}
                      className="-my-1 flex min-w-0 flex-1 flex-col items-start rounded-md py-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <span className="flex w-full min-w-0 items-baseline">
                        <span className="truncate text-sm font-medium text-foreground">
                          {prettifySkillName(skill.name)}
                        </span>
                      </span>
                      {/* Two lines, not one: inside a card at 62% of the track
                          the longest concise description needs ~500px, so a
                          single line was clipped by CSS on any narrow window —
                          mid-word, past the clause the trimming had chosen. */}
                      <span className="mt-0.5 line-clamp-2 w-full text-xs leading-snug text-muted-foreground/80">
                        {conciseDescription(skill.description)}
                      </span>
                    </button>
                    <div className="flex shrink-0 items-center gap-2">
                      {/* A skill a provider owns has no origin Cozea can re-read,
                          so it gets no button rather than a permanently dead one. */}
                      {skill.updateSource === "none" ? null : (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 gap-1 px-2 text-[11px] font-normal text-muted-foreground"
                          disabled={updating}
                          title={updateHint(skill)}
                          aria-label={`Update ${skill.name}`}
                          onClick={() => void handleUpdate(skill)}
                        >
                          <HugeiconsIcon icon={__RefreshHugeIcon} className="size-3" />
                          {updating ? "Updating…" : "Update"}
                        </Button>
                      )}
                      {installFor ? (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 gap-1 px-2 text-[11px]"
                          disabled={installing}
                          title={`Install for ${PROVIDER_LABELS[installFor]} from the ${skill.originLabel ?? "plugin catalog"}`}
                          onClick={() => void handleInstall(skill)}
                        >
                          <HugeiconsIcon icon={__DownloadHugeIcon} className="size-3" />
                          {installing ? "Installing…" : "Install"}
                        </Button>
                      ) : (
                        <div className="flex shrink-0 items-center gap-2">
                          {isEssentialSkill(skill) ? <EssentialTag /> : null}
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="inline-flex">
                                <Switch
                                  checked={enabled}
                                  disabled
                                  aria-label={`${prettifySkillName(skill.name)}: ${enabled ? "enabled" : "disabled"}`}
                                />
                              </span>
                            </TooltipTrigger>
                            <TooltipContent side="top">
                              {enabled
                                ? "Switched on in active build"
                                : "Switched off in active build"}
                            </TooltipContent>
                          </Tooltip>
                        </div>
                      )}
                    </div>
                  </div>
                );
              }}
            />
        )}
      </section>
    </div>
  );
}

/** The mark shown wherever a skill is Cozea's to list but not to manage. */
function EssentialTag() {
  return (
    <span className="flex shrink-0 items-center gap-1.5">
      <span className="text-[11px] tracking-[0.1em] text-muted-foreground/70 uppercase">
        Essential
      </span>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            tabIndex={0}
            role="note"
            aria-label={ESSENTIAL_SKILL_NOTE}
            className="flex size-4 items-center justify-center rounded-full text-muted-foreground/70 transition-colors hover:text-foreground"
          >
            <HugeiconsIcon icon={__InfoHugeIcon} className="size-3.5" />
          </span>
        </TooltipTrigger>
        <TooltipContent side="top">{ESSENTIAL_SKILL_NOTE}</TooltipContent>
      </Tooltip>
    </span>
  );
}

export default AgentSkillsPage;
