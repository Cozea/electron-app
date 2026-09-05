import { app, BrowserWindow, dialog, ipcMain, type WebContents } from "electron";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { BUILT_IN_SKILLS, MEMORY_SKILL_KEY, type BuiltInSkillDefinition } from "./agentSkills/builtInSkills";
import {
  normalizeAgentSkillCategory,
  resolveAgentSkillCategory,
} from "../../../../shared/agentSkillCategories";
import {
  removeMemoryInstructions,
  writeMemoryInstructions,
} from "./agentSkills/memoryInstructions";

import type {
  AgentSkillDraft,
  AgentSkillExportResult,
  AgentSkillMutationResult,
  AgentSkillProvider,
  AgentSkillProviderBinding,
  AgentSkillProviderInfo,
  AgentSkillRecord,
  AgentSkillsSnapshot,
  AgentSkillBuild,
  AgentSkillSetupPack,
  AgentSkillSetupPackResult,
  AgentSkillUpdateSource,
} from "../../../../shared/electronApiTypes";
import {
  parseSkillMarkdown,
  renderSkillMarkdown,
  slugifySkillName,
} from "./agentSkills/skillManifest";

const SKILL_FILE_NAME = "SKILL.md";
const COZEA_METADATA_FILE_NAME = ".cozea-skill.json";
const STATE_VERSION = 1;
const SETUP_PACK_EXTENSION = "cozea-skills.json";
const MAX_SKILL_FILES = 250;
const MAX_SKILL_BYTES = 5 * 1024 * 1024;
const MAX_SETUP_PACK_BYTES = 5 * 1024 * 1024;

interface AgentSkillServicePaths {
  dataRoot: string;
  homeRoot: string;
}

interface ManagedSkillMetadata {
  schemaVersion: 1;
  kind: "library";
  id: string;
  slug: string;
  displayName: string;
  compatibleProviders: AgentSkillProvider[];
  createdAt: number;
  updatedAt: number;
  originLabel?: string;
  /** Author-declared shelf. Absent means Cozea infers one from name and text. */
  category?: string;
  /** Folder this skill was copied from, re-read by a manual update. */
  originPath?: string;
}

interface ManagedBindingMetadata {
  schemaVersion: 1;
  kind: "binding";
  skillId: string;
  updatedAt: number;
}

interface DisabledExternalBinding {
  skillId: string;
  provider: AgentSkillProvider;
  originalPath: string;
  trashPath: string;
  disabledAt: number;
}

interface AgentSkillStateFile {
  schemaVersion: 1;
  disabledExternalBindings: DisabledExternalBinding[];
  /** Built-in skill keys already seeded, so deleting one keeps it deleted. */
  seededBuiltInSkills?: string[];
  /** Set once the first build has been recorded from what was already on. */
  seededCurrentBuild?: boolean;
  /** The build the user last activated. Remembered, not inferred. */
  activeBuildId?: string | null;
  /** Providers whose managed copies have been moved to their primary root. */
  migratedPrimaryRoots?: string[];
  /** Named skill loadouts. */
  builds?: AgentSkillBuild[];
}

interface ProviderSkillRoot {
  relativePath: string;
  /**
   * The provider owns this folder and rewrites it. Cozea can move a skill out
   * of it, but the provider puts it back — measured: 23 skills restored 22
   * minutes after being disabled, all with the same birth time. So these are
   * reported as essential rather than offered as something to switch off.
   */
  essential?: boolean;
  /**
   * A plugin marketplace rather than a skills folder: everything under it is
   * on disk but not loaded by the provider until the user installs it, and it
   * is nested one plugin deep rather than flat.
   */
  catalog?: boolean;
}

interface ProviderDefinition extends AgentSkillProviderInfo {
  /**
   * Every folder this provider loads skills from, in order. The first is the
   * one Cozea installs into; the rest are read-only, which is what keeps a
   * provider's own bundled skills visible without Cozea claiming to own them.
   */
  relativeRoots: ProviderSkillRoot[];
  /**
   * The file this provider always loads, relative to home. A skill folder is
   * only *offered* to the model; whether it gets used is the model's choice.
   * A managed section here is read every session, which is what makes project
   * memory actually reach the agent rather than hoping it opts in.
   */
  instructionsFile: string;
}

interface CopyEntry {
  sourcePath: string;
  relativePath: string;
  size: number;
}

const PROVIDER_DEFINITIONS: readonly ProviderDefinition[] = [
  {
    id: "codex",
    label: "Codex",
    // `.codex/skills` is where Codex actually keeps its library, so it leads
    // and is what Cozea installs into; `.agents` stays readable for skills
    // dropped there under the AGENTS.md convention.
    relativeRoots: [
      { relativePath: path.join(".codex", "skills") },
      { relativePath: path.join(".agents", "skills") },
      { relativePath: path.join(".codex", "plugins", "cache"), catalog: true },
    ],
    rootPath: "",
    rootPaths: [],
    instructionsFile: path.join(".agents", "AGENTS.md"),
    restartBehavior: "restart-external-app",
  },
  {
    id: "claude",
    label: "Claude",
    relativeRoots: [
      { relativePath: path.join(".claude", "skills") },
      { relativePath: path.join(".claude", "plugins", "marketplaces"), catalog: true },
    ],
    rootPath: "",
    rootPaths: [],
    instructionsFile: path.join(".claude", "CLAUDE.md"),
    restartBehavior: "live",
  },
  {
    id: "cursor",
    label: "Cursor",
    // `skills-cursor` is Cursor's own bundled set, alongside the user's.
    relativeRoots: [
      { relativePath: path.join(".cursor", "skills") },
      { relativePath: path.join(".cursor", "skills-cursor"), essential: true },
    ],
    rootPath: "",
    rootPaths: [],
    instructionsFile: path.join(".cursor", "rules", "cozea-project-memory.mdc"),
    restartBehavior: "restart-recommended",
  },
  {
    id: "opencode",
    label: "OpenCode",
    relativeRoots: [{ relativePath: path.join(".config", "opencode", "skills") }],
    rootPath: "",
    rootPaths: [],
    instructionsFile: path.join(".config", "opencode", "AGENTS.md"),
    restartBehavior: "restart-recommended",
  },
];

const PROVIDER_IDS = new Set<AgentSkillProvider>(
  PROVIDER_DEFINITIONS.map((provider) => provider.id),
);

function ensureDirectory(directoryPath: string): void {
  fs.mkdirSync(directoryPath, { recursive: true });
}

function readJsonFile<T>(filePath: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
  } catch {
    return null;
  }
}

function writeJsonFile(filePath: string, value: unknown): void {
  ensureDirectory(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function isDirectory(directoryPath: string): boolean {
  try {
    return fs.lstatSync(directoryPath).isDirectory();
  } catch {
    return false;
  }
}

function listDirectories(directoryPath: string): string[] {
  try {
    return fs
      .readdirSync(directoryPath, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
      .map((entry) => path.join(directoryPath, entry.name));
  } catch {
    return [];
  }
}

interface DiscoveredSkillDirectory {
  directoryPath: string;
  /** Found in a folder the provider rewrites, so Cozea cannot switch it off. */
  essential?: boolean;
  /** Present only for catalog finds: the plugin that owns the skill. */
  plugin?: string;
  marketplace?: string;
}

/** Depth to search below a marketplace for a `skills` folder. */
const CATALOG_MAX_DEPTH = 3;

/** Path segments that group plugins rather than name one. */
const CATALOG_GROUP_SEGMENTS = new Set(["plugins", "external_plugins"]);

/** A version or content hash sitting between a plugin and its `skills` folder. */
const CATALOG_VERSION_SEGMENT = /^v?\d[\w.+-]*$|^[0-9a-f]{6,40}$/i;

/**
 * Name the plugin that owns a `skills` folder, whatever the marketplace's
 * shape. Claude nests `plugins/<plugin>/skills`; Codex nests
 * `<plugin>/<version>/skills`. Walking back from the folder and stepping over
 * grouping and version segments covers both without hard-coding either.
 */
function catalogPluginName(marketplacePath: string, skillsParent: string): string | null {
  const relative = path.relative(marketplacePath, skillsParent);
  const segments = relative ? relative.split(path.sep) : [];
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    const segment = segments[index];
    if (CATALOG_GROUP_SEGMENTS.has(segment) || CATALOG_VERSION_SEGMENT.test(segment)) continue;
    return segment;
  }
  return null;
}

/**
 * Walk a provider's plugin marketplaces. Slugs repeat across plugins —
 * discord, imessage and telegram each ship an `access` skill — so the owning
 * plugin travels with the directory and becomes part of the skill's identity.
 */
function listCatalogSkillDirectories(catalogRoot: string): DiscoveredSkillDirectory[] {
  const found: DiscoveredSkillDirectory[] = [];
  for (const marketplacePath of listDirectories(catalogRoot)) {
    const marketplace = path.basename(marketplacePath);

    const visit = (directoryPath: string, depth: number) => {
      if (depth > CATALOG_MAX_DEPTH) return;
      // Highest version first, so a plugin cached at several versions is
      // represented by its newest copy.
      const children = listDirectories(directoryPath).sort((left, right) =>
        path.basename(right).localeCompare(path.basename(left), undefined, { numeric: true }),
      );
      for (const child of children) {
        if (path.basename(child) !== "skills") {
          visit(child, depth + 1);
          continue;
        }
        const plugin = catalogPluginName(marketplacePath, directoryPath);
        if (!plugin) continue;
        for (const skillPath of listDirectories(child)) {
          found.push({ directoryPath: skillPath, plugin, marketplace });
        }
      }
    };

    visit(marketplacePath, 0);
  }
  return found;
}

/**
 * Plugins Codex has actually installed, as `plugin@marketplace`. Its
 * `config.toml` records them explicitly, so skills belonging to one are
 * already live and must not be offered for install — nor treated as files
 * Cozea may move, since the plugin owns them.
 */
function readCodexInstalledPlugins(configPath: string): Set<string> {
  const installed = new Set<string>();
  let contents: string;
  try {
    contents = fs.readFileSync(configPath, "utf8");
  } catch {
    return installed;
  }

  // Line-based rather than one big regex: in multiline mode `$` ends a block
  // at the first newline, which silently hid every `enabled = false`.
  let current: string | null = null;
  let enabled = true;
  const commit = () => {
    if (current && enabled) installed.add(current);
  };

  for (const line of contents.split(/\r?\n/)) {
    const header = line.match(/^\s*\[([^\]]+)\]/);
    if (header) {
      commit();
      current = header[1].match(/^plugins\."([^"]+)"$/)?.[1] ?? null;
      enabled = true;
      continue;
    }
    if (!current) continue;
    const flag = line.match(/^\s*enabled\s*=\s*(true|false)/);
    if (flag) enabled = flag[1] === "true";
  }
  commit();

  return installed;
}

function readSkillMarkdown(directoryPath: string): string | null {
  try {
    const filePath = path.join(directoryPath, SKILL_FILE_NAME);
    if (!fs.lstatSync(filePath).isFile()) return null;
    const stats = fs.statSync(filePath);
    if (stats.size > MAX_SKILL_BYTES) return null;
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}

function collectCopyEntries(sourceRoot: string): CopyEntry[] {
  const entries: CopyEntry[] = [];
  let totalBytes = 0;

  const visit = (directoryPath: string, depth: number) => {
    if (depth > 12) {
      throw new Error("Skill folders may not be nested more than 12 levels deep.");
    }
    for (const entry of fs.readdirSync(directoryPath, { withFileTypes: true })) {
      if (entry.name === COZEA_METADATA_FILE_NAME) continue;
      const sourcePath = path.join(directoryPath, entry.name);
      const relativePath = path.relative(sourceRoot, sourcePath);
      if (!relativePath || relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
        throw new Error("Skill contains an unsafe path.");
      }
      const stats = fs.lstatSync(sourcePath);
      if (stats.isSymbolicLink()) {
        throw new Error(`Skill contains a symbolic link: ${relativePath}`);
      }
      if (stats.isDirectory()) {
        visit(sourcePath, depth + 1);
        continue;
      }
      if (!stats.isFile()) continue;
      entries.push({ sourcePath, relativePath, size: stats.size });
      totalBytes += stats.size;
      if (entries.length > MAX_SKILL_FILES || totalBytes > MAX_SKILL_BYTES) {
        throw new Error("Skill is too large to manage safely (maximum 250 files or 5 MB).");
      }
    }
  };

  visit(sourceRoot, 0);
  return entries;
}

function copySkillDirectory(sourceRoot: string, destinationRoot: string): void {
  const entries = collectCopyEntries(sourceRoot);
  if (!entries.some((entry) => entry.relativePath === SKILL_FILE_NAME)) {
    throw new Error("The selected folder does not contain a SKILL.md file.");
  }
  ensureDirectory(destinationRoot);
  for (const entry of entries) {
    const destinationPath = path.join(destinationRoot, entry.relativePath);
    ensureDirectory(path.dirname(destinationPath));
    fs.copyFileSync(entry.sourcePath, destinationPath);
  }
}

/**
 * External skills are identified by their folder name, not their contents.
 * One skill installed into four providers is usually four *different* files —
 * each tailored to that provider's paths and frontmatter — so hashing the text
 * split a single skill into four indistinguishable rows.
 */
function createExternalSkillId(slug: string): string {
  const normalized = slugifySkillName(slug);
  return `external_${normalized || createHash("sha256").update(slug).digest("hex").slice(0, 20)}`;
}

/**
 * Match a library skill back to the definition Cozea ships, so the Update
 * button can restore it. Matched by name rather than a stored key so skills
 * seeded before this existed — and ones the user re-imported — still resolve.
 */
function findBuiltInDefinition(skill: {
  name: string;
  slug: string;
}): BuiltInSkillDefinition | null {
  const name = skill.name.trim().toLowerCase();
  const slug = skill.slug.trim().toLowerCase();
  return (
    BUILT_IN_SKILLS.find(
      (definition) =>
        definition.name.trim().toLowerCase() === name ||
        slugifySkillName(definition.name) === slug,
    ) ?? null
  );
}

/**
 * Which build the enabled set happens to match exactly.
 *
 * Only a fallback now, for builds activated before the choice was recorded.
 * Inference alone was too brittle to be the answer: one skill enabled outside
 * the build, and the page claimed nothing was active even though the user had
 * just activated something. What was actually activated is stored in state.
 */
export function findActiveBuildId(
  builds: readonly AgentSkillBuild[],
  enabledSkillIds: readonly string[],
  knownSkillIds: ReadonlySet<string>,
): string | null {
  const enabled = new Set(enabledSkillIds);
  for (const build of builds) {
    // Skills the build names that no longer exist cannot be held against it.
    const wanted = build.skillIds.filter((id) => knownSkillIds.has(id));
    if (wanted.length !== enabled.size) continue;
    if (wanted.every((id) => enabled.has(id))) return build.id;
  }
  return null;
}

/** What applying a build has to turn on and off. */
export function planBuildApplication(
  build: Pick<AgentSkillBuild, "skillIds">,
  installedSkills: ReadonlyArray<{ id: string; enabled: boolean }>,
): { enable: string[]; disable: string[] } {
  const wanted = new Set(build.skillIds);
  const enable: string[] = [];
  const disable: string[] = [];
  for (const skill of installedSkills) {
    if (wanted.has(skill.id)) {
      if (!skill.enabled) enable.push(skill.id);
    } else if (skill.enabled) {
      disable.push(skill.id);
    }
  }
  return { enable, disable };
}

function uniqueProviders(values: readonly AgentSkillProvider[]): AgentSkillProvider[] {
  return Array.from(new Set(values.filter((provider) => PROVIDER_IDS.has(provider))));
}

function emptyBinding(
  provider: AgentSkillProviderInfo,
  compatible: boolean,
): AgentSkillProviderBinding {
  return {
    provider: provider.id,
    compatible,
    enabled: false,
    ownership: "none",
    path: null,
    restartBehavior: provider.restartBehavior,
  };
}

function normalizeSetupPack(value: unknown, sourcePath: string): AgentSkillSetupPack | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<AgentSkillSetupPack>;
  if (
    candidate.version !== 1 ||
    typeof candidate.setupName !== "string" ||
    typeof candidate.authorName !== "string" ||
    !Array.isArray(candidate.skills) ||
    candidate.skills.length > 200
  ) {
    return null;
  }

  const skills = candidate.skills.flatMap((skill) => {
    if (
      !skill ||
      typeof skill !== "object" ||
      typeof skill.packSkillId !== "string" ||
      typeof skill.name !== "string" ||
      typeof skill.slug !== "string" ||
      typeof skill.description !== "string" ||
      typeof skill.instructions !== "string" ||
      !Array.isArray(skill.compatibleProviders) ||
      !Array.isArray(skill.enabledProviders)
    ) {
      return [];
    }
    return [
      {
        packSkillId: skill.packSkillId.slice(0, 100),
        name: skill.name.slice(0, 160),
        slug: slugifySkillName(skill.slug) || "skill",
        description: skill.description.slice(0, 2_000),
        instructions: skill.instructions.slice(0, MAX_SKILL_BYTES),
        compatibleProviders: uniqueProviders(skill.compatibleProviders),
        enabledProviders: uniqueProviders(skill.enabledProviders),
      },
    ];
  });

  return {
    version: 1,
    setupName: candidate.setupName.slice(0, 160),
    authorName: candidate.authorName.slice(0, 160),
    exportedAt:
      typeof candidate.exportedAt === "number" && Number.isFinite(candidate.exportedAt)
        ? candidate.exportedAt
        : Date.now(),
    sourcePath,
    skills,
  };
}

export class AgentSkillService {
  private static instance: AgentSkillService;
  private readonly pathsOverride?: AgentSkillServicePaths;
  private mutationChain: Promise<void> = Promise.resolve();
  private displayScan: Promise<AgentSkillsSnapshot> | null = null;

  constructor(pathsOverride?: AgentSkillServicePaths) {
    this.pathsOverride = pathsOverride;
  }

  static getInstance(): AgentSkillService {
    if (!AgentSkillService.instance) {
      AgentSkillService.instance = new AgentSkillService();
    }
    return AgentSkillService.instance;
  }

  private get dataRoot(): string {
    if (this.pathsOverride) return this.pathsOverride.dataRoot;
    if (app.isReady()) return path.join(app.getPath("userData"), "agent-skills");
    return path.join(os.homedir(), ".cozea", "agent-skills");
  }

  private get homeRoot(): string {
    return this.pathsOverride?.homeRoot ?? os.homedir();
  }

  private get libraryRoot(): string {
    return path.join(this.dataRoot, "library");
  }

  private get trashRoot(): string {
    return path.join(this.dataRoot, "trash");
  }

  private get statePath(): string {
    return path.join(this.dataRoot, "state.json");
  }

  private get providers(): AgentSkillProviderInfo[] {
    return PROVIDER_DEFINITIONS.map((provider) => {
      const rootPaths = provider.relativeRoots.map((root) =>
        path.join(this.homeRoot, root.relativePath),
      );
      return {
        id: provider.id,
        label: provider.label,
        rootPath: rootPaths[0],
        rootPaths,
        restartBehavior: provider.restartBehavior,
      };
    });
  }

  /**
   * Catalog plugins the provider already runs, as `plugin@marketplace`. Their
   * skills are live, so they are neither offered for install nor listed as
   * Cozea's to move. Only Codex records this; Claude's marketplace clone has
   * no such file, so everything in it is genuinely uninstalled.
   */
  private installedCatalogPlugins(providerId: AgentSkillProvider): Set<string> {
    if (providerId !== "codex") return new Set();
    return readCodexInstalledPlugins(path.join(this.homeRoot, ".codex", "config.toml"));
  }

  private getProvider(providerId: AgentSkillProvider): AgentSkillProviderInfo {
    const provider = this.providers.find((candidate) => candidate.id === providerId);
    if (!provider) throw new Error(`Unsupported provider: ${providerId}`);
    return provider;
  }

  private loadState(): AgentSkillStateFile {
    const state = readJsonFile<AgentSkillStateFile>(this.statePath);
    if (
      !state ||
      state.schemaVersion !== STATE_VERSION ||
      !Array.isArray(state.disabledExternalBindings)
    ) {
      return { schemaVersion: STATE_VERSION, disabledExternalBindings: [], seededBuiltInSkills: [] };
    }
    return { ...state, seededBuiltInSkills: state.seededBuiltInSkills ?? [] };
  }

  private saveState(state: AgentSkillStateFile): void {
    writeJsonFile(this.statePath, state);
  }

  private enqueue<T>(operation: () => T | Promise<T>): Promise<T> {
    const next = this.mutationChain.then(operation, operation);
    this.mutationChain = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  private uniqueLibraryPath(slug: string): string {
    let candidate = path.join(this.libraryRoot, slug);
    let suffix = 2;
    while (fs.existsSync(candidate)) {
      candidate = path.join(this.libraryRoot, `${slug}-${suffix}`);
      suffix += 1;
    }
    return candidate;
  }

  /**
   * First run with skills already on: record them as a build.
   *
   * Someone who has been using agents for months would otherwise open Builds
   * to an empty page, and their first activation would quietly switch off
   * everything they had. The seeded build names exactly what is enabled, so
   * `findActiveBuildId` reports it as active straight away.
   *
   * Seeded at most once. The flag is only set when a build is actually
   * written, so a machine with nothing enabled yet can still be seeded later,
   * and deleting the build does not bring it back.
   */
  private seedBuildFromEnabledSkills(enabledSkillIds: readonly string[]): AgentSkillBuild[] {
    const state = this.loadState();
    const builds = state.builds ?? [];
    if (state.seededCurrentBuild || builds.length > 0 || enabledSkillIds.length === 0) {
      return builds;
    }
    const now = Date.now();
    const seeded: AgentSkillBuild = {
      id: `build_${randomUUID()}`,
      name: "Default",
      skillIds: [...enabledSkillIds],
      createdAt: now,
      updatedAt: now,
    };
    const next = [...builds, seeded];
    this.saveState({ ...state, builds: next, seededCurrentBuild: true });
    return next;
  }

  private moveToTrash(sourcePath: string, label: string): string {
    ensureDirectory(this.trashRoot);
    const destinationPath = path.join(
      this.trashRoot,
      `${Date.now()}-${slugifySkillName(label) || "skill"}-${randomUUID().slice(0, 8)}`,
    );
    fs.renameSync(sourcePath, destinationPath);
    return destinationPath;
  }

  list(): AgentSkillsSnapshot {
    const scan = this.scan();
    let step = scan.next();
    while (!step.done) step = scan.next();
    return step.value;
  }

  /** Serialize with mutations, but allow native input and other IPC between records. */
  listForDisplay(): Promise<AgentSkillsSnapshot> {
    if (this.displayScan) return this.displayScan;
    this.displayScan = this.enqueue(async () => {
      const scan = this.scan();
      let step = scan.next();
      while (!step.done) {
        await new Promise<void>((resolve) => setImmediate(resolve));
        step = scan.next();
      }
      return step.value;
    }).finally(() => { this.displayScan = null; });
    return this.displayScan;
  }

  private *scan(): Generator<void, AgentSkillsSnapshot, void> {
    yield;
    ensureDirectory(this.libraryRoot);
    const providers = this.providers;
    const managedById = new Map<string, AgentSkillRecord>();
    const externalById = new Map<string, AgentSkillRecord>();

    for (const directoryPath of listDirectories(this.libraryRoot)) {
      yield;
      const metadata = readJsonFile<ManagedSkillMetadata>(
        path.join(directoryPath, COZEA_METADATA_FILE_NAME),
      );
      const markdown = readSkillMarkdown(directoryPath);
      if (!metadata || metadata.kind !== "library" || metadata.schemaVersion !== 1 || !markdown)
        continue;
      const parsed = parseSkillMarkdown(markdown, metadata.slug);
      const compatibleProviders = uniqueProviders(metadata.compatibleProviders);
      const name = metadata.displayName || parsed.name;
      const declaredCategory = metadata.category ?? parsed.category ?? null;
      managedById.set(metadata.id, {
        id: metadata.id,
        slug: metadata.slug,
        name,
        description: parsed.description,
        instructions: parsed.instructions,
        source: "managed",
        editable: true,
        path: directoryPath,
        createdAt: metadata.createdAt,
        updatedAt: metadata.updatedAt,
        originLabel: metadata.originLabel,
        category: resolveAgentSkillCategory(declaredCategory, {
          name,
          description: parsed.description,
          slug: metadata.slug,
        }),
        categoryDeclared: normalizeAgentSkillCategory(declaredCategory) !== null,
        updateSource: "none",
        originPath: metadata.originPath,
        bindings: providers.map((provider) =>
          emptyBinding(provider, compatibleProviders.includes(provider.id)),
        ),
      });
    }

    const catalogById = new Map<string, AgentSkillRecord>();
    for (const provider of providers) {
      yield;
      const definition = PROVIDER_DEFINITIONS.find((candidate) => candidate.id === provider.id);
      const discovered = (definition?.relativeRoots ?? []).flatMap<DiscoveredSkillDirectory>(
        (root, index) => {
          const rootPath = provider.rootPaths[index];
          if (root.catalog) return listCatalogSkillDirectories(rootPath);
          return listDirectories(rootPath).map((directoryPath) => ({
            directoryPath,
            ...(root.essential ? { essential: true } : {}),
          }));
        },
      );

      const installedPlugins = discovered.some((entry) => entry.plugin)
        ? this.installedCatalogPlugins(provider.id)
        : new Set<string>();

      for (const { directoryPath, plugin, marketplace, essential } of discovered) {
        yield;
        // A skill from a plugin the provider already runs is not "available";
        // it is already live, and its files belong to the plugin.
        if (plugin && marketplace && installedPlugins.has(`${plugin}@${marketplace}`)) continue;
        const markdown = readSkillMarkdown(directoryPath);
        if (!markdown) continue;
        const marker = readJsonFile<ManagedBindingMetadata>(
          path.join(directoryPath, COZEA_METADATA_FILE_NAME),
        );
        if (marker?.kind === "binding" && marker.schemaVersion === 1) {
          const managed =
            managedById.get(marker.skillId) ??
            this.reclaimOrphanedBinding(marker, directoryPath, managedById);
          if (managed) {
            const binding = managed.bindings.find(
              (candidate) => candidate.provider === provider.id,
            );
            if (binding) {
              binding.enabled = true;
              binding.ownership = "managed";
              binding.path = directoryPath;
            }
            continue;
          }
        }

        const parsed = parseSkillMarkdown(markdown, path.basename(directoryPath));

        // A catalog find is not loaded by the provider yet, so it is offered
        // for install rather than reported as enabled.
        if (plugin) {
          const catalogId = `catalog_${slugifySkillName(plugin)}_${slugifySkillName(path.basename(directoryPath))}`;
          // Qualify the display name the way the providers themselves do
          // (`plugin:skill`): three plugins each ship an `access` skill, and
          // three rows called "access" are unreadable. The slug stays bare,
          // because that is the folder name an install writes to.
          const displayName =
            slugifySkillName(plugin) === slugifySkillName(parsed.name)
              ? parsed.name
              : `${plugin}:${parsed.name}`;
          const record =
            catalogById.get(catalogId) ??
            ({
              id: catalogId,
              slug: slugifySkillName(parsed.name) || path.basename(directoryPath),
              name: displayName,
              description: parsed.description,
              instructions: parsed.instructions,
              source: "catalog" as const,
              editable: false,
              path: directoryPath,
              createdAt: null,
              updatedAt: fs.statSync(path.join(directoryPath, SKILL_FILE_NAME)).mtimeMs,
              originLabel: marketplace ? `${plugin} · ${marketplace}` : plugin,
              category: resolveAgentSkillCategory(parsed.category, {
                name: parsed.name,
                description: parsed.description,
                slug: path.basename(directoryPath),
              }),
              categoryDeclared: normalizeAgentSkillCategory(parsed.category) !== null,
              updateSource: "none" as const,
              bindings: providers.map((candidate) => emptyBinding(candidate, true)),
            } satisfies AgentSkillRecord);
          const catalogBinding = record.bindings.find(
            (candidate) => candidate.provider === provider.id,
          );
          if (catalogBinding) {
            catalogBinding.available = true;
            catalogBinding.path ??= directoryPath;
          }
          catalogById.set(catalogId, record);
          continue;
        }

        const skillId = createExternalSkillId(path.basename(directoryPath));
        const existing = externalById.get(skillId);
        const record =
          existing ??
          ({
            id: skillId,
            slug: slugifySkillName(parsed.name) || path.basename(directoryPath),
            name: parsed.name,
            description: parsed.description,
            instructions: parsed.instructions,
            source: "external" as const,
            editable: false,
            path: directoryPath,
            createdAt: null,
            updatedAt: fs.statSync(path.join(directoryPath, SKILL_FILE_NAME)).mtimeMs,
            originLabel: "Provider folder",
            category: resolveAgentSkillCategory(parsed.category, {
              name: parsed.name,
              description: parsed.description,
              slug: path.basename(directoryPath),
            }),
            categoryDeclared: normalizeAgentSkillCategory(parsed.category) !== null,
            updateSource: "none" as const,
            bindings: providers.map((candidate) => emptyBinding(candidate, true)),
          } satisfies AgentSkillRecord);
        const binding = record.bindings.find((candidate) => candidate.provider === provider.id);
        if (binding && !binding.enabled) {
          binding.enabled = true;
          binding.ownership = "external";
          binding.path = directoryPath;
          if (essential) binding.essential = true;
          // The first provider scanned defines the record's canonical text.
          // Later ones only carry a variant when they actually read different,
          // so identical copies cost nothing on the wire.
          if (
            existing &&
            (parsed.instructions !== record.instructions ||
              parsed.description !== record.description)
          ) {
            binding.variant = {
              description: parsed.description,
              instructions: parsed.instructions,
            };
          }
        }
        externalById.set(skillId, record);
      }
    }

    const state = this.loadState();
    let stateChanged = false;
    const validDisabledBindings = state.disabledExternalBindings.filter((disabled) => {
      // The provider put it back. Cursor rewrites its own managed skills
      // folder, so a directory Cozea moved to trash can reappear at the path
      // it came from. The live copy is the truth: keeping the record would
      // report the skill as off while the provider is still loading it, and
      // would later refuse to re-enable it because the path is occupied.
      if (isDirectory(disabled.originalPath)) {
        stateChanged = true;
        return false;
      }
      const markdown = readSkillMarkdown(disabled.trashPath);
      if (!markdown) {
        stateChanged = true;
        return false;
      }
      const parsed = parseSkillMarkdown(markdown, path.basename(disabled.originalPath));
      // Older state stored a content hash here; re-derive so a disabled copy
      // rejoins the same row as its still-enabled siblings.
      const skillId = createExternalSkillId(path.basename(disabled.originalPath));
      if (disabled.skillId !== skillId) {
        disabled.skillId = skillId;
        stateChanged = true;
      }
      const record =
        externalById.get(skillId) ??
        ({
          id: skillId,
          slug: slugifySkillName(parsed.name) || path.basename(disabled.originalPath),
          name: parsed.name,
          description: parsed.description,
          instructions: parsed.instructions,
          source: "external" as const,
          editable: false,
          path: disabled.trashPath,
          createdAt: null,
          updatedAt: disabled.disabledAt,
          originLabel: "Provider folder",
          category: resolveAgentSkillCategory(parsed.category, {
            name: parsed.name,
            description: parsed.description,
            slug: path.basename(disabled.originalPath),
          }),
          categoryDeclared: normalizeAgentSkillCategory(parsed.category) !== null,
          updateSource: "none" as const,
          bindings: providers.map((provider) => emptyBinding(provider, true)),
        } satisfies AgentSkillRecord);
      const binding = record.bindings.find((candidate) => candidate.provider === disabled.provider);
      if (binding && !binding.enabled) {
        binding.ownership = "external";
        binding.path = disabled.originalPath;
      }
      externalById.set(skillId, record);
      return true;
    });
    if (stateChanged) {
      this.saveState({ ...state, disabledExternalBindings: validDisabledBindings });
    }

    const installed = [...managedById.values(), ...externalById.values()];
    // A catalog entry whose slug already occupies the install path is simply
    // the installed skill, so it is not offered a second time.
    const installedSlugs = new Set(installed.map((skill) => skill.slug));
    const catalog = [...catalogById.values()].filter(
      (skill) => !installedSlugs.has(skill.slug),
    );
    const skills = [...installed, ...catalog].sort((left, right) =>
      left.name.localeCompare(right.name, undefined, { sensitivity: "base" }),
    );
    for (const skill of skills) {
      skill.updateSource = this.resolveUpdateSource(skill);
    }
    const enabledSkillIds = skills
      .filter((skill) => skill.bindings.some((binding) => binding.enabled))
      .map((skill) => skill.id);
    const builds = this.seedBuildFromEnabledSkills(enabledSkillIds);
    const recorded = this.loadState().activeBuildId ?? null;
    const recordedActiveBuildId =
      recorded && builds.some((build) => build.id === recorded) ? recorded : null;

    return {
      skills,
      providers,
      libraryPath: this.libraryRoot,
      generatedAt: Date.now(),
      builds,
      // The recorded choice wins; the match is only consulted for builds
      // activated before Cozea started remembering.
      activeBuildId:
        recordedActiveBuildId ??
        findActiveBuildId(builds, enabledSkillIds, new Set(skills.map((skill) => skill.id))),
    };
  }

  /**
   * A provider copy whose marker points at a library skill that no longer
   * exists is an orphan: the library entry was reseeded under a new id while
   * its provider copies kept the old one. Left alone it shows up as a second,
   * external-looking row beside the skill it belongs to, and disabling it fails
   * the ownership check. Re-adopt it by slug and heal the marker on disk.
   */
  private reclaimOrphanedBinding(
    marker: ManagedBindingMetadata,
    directoryPath: string,
    managedById: Map<string, AgentSkillRecord>,
  ): AgentSkillRecord | null {
    const slug = path.basename(directoryPath);
    const managed = Array.from(managedById.values()).find(
      (candidate) => candidate.slug === slug,
    );
    if (!managed) return null;
    try {
      writeJsonFile(path.join(directoryPath, COZEA_METADATA_FILE_NAME), {
        ...marker,
        skillId: managed.id,
        updatedAt: Date.now(),
      } satisfies ManagedBindingMetadata);
    } catch {
      // Display still resolves correctly; the next write retries the heal.
    }
    return managed;
  }

  /**
   * What a manual update would read from. Cozea never polls for new versions,
   * so this answers "is there anywhere to update from", not "is one waiting".
   */
  private resolveUpdateSource(skill: AgentSkillRecord): AgentSkillUpdateSource {
    if (skill.source !== "managed") return "none";
    if (findBuiltInDefinition(skill)) return "built-in";
    if (skill.originPath && isDirectory(skill.originPath)) return "folder";
    return skill.bindings.some((binding) => binding.enabled && binding.ownership === "managed")
      ? "providers"
      : "none";
  }

  private mutationResult(
    success: boolean,
    options: Omit<AgentSkillMutationResult, "success" | "snapshot"> = {},
  ): AgentSkillMutationResult {
    return { success, snapshot: this.list(), ...options };
  }

  async save(draft: AgentSkillDraft): Promise<AgentSkillMutationResult> {
    return await this.enqueue(() => {
      try {
        const displayName = draft.name.trim();
        const description = draft.description.trim();
        const instructions = draft.instructions.trim();
        if (!displayName) throw new Error("Give the skill a name.");
        if (!description) throw new Error("Add a short description so agents know when to use it.");
        if (!instructions) throw new Error("Add instructions for the skill.");
        const compatibleProviders = uniqueProviders(draft.compatibleProviders);
        if (compatibleProviders.length === 0) {
          throw new Error("Choose at least one compatible provider.");
        }

        const current = draft.skillId
          ? this.list().skills.find((skill) => skill.id === draft.skillId)
          : null;
        if (draft.skillId && (!current || current.source !== "managed")) {
          throw new Error("Only skills in your Cozea library can be edited.");
        }

        const now = Date.now();
        const slug = current?.slug ?? slugifySkillName(displayName);
        if (!slug) throw new Error("The skill name must contain at least one letter or number.");
        const directoryPath = current?.path ?? this.uniqueLibraryPath(slug);
        ensureDirectory(directoryPath);
        const existingMetadata = current
          ? readJsonFile<ManagedSkillMetadata>(path.join(directoryPath, COZEA_METADATA_FILE_NAME))
          : null;
        const category =
          normalizeAgentSkillCategory(draft.category) ??
          (draft.category === undefined
            ? normalizeAgentSkillCategory(existingMetadata?.category)
            : null);
        const metadata: ManagedSkillMetadata = {
          schemaVersion: 1,
          kind: "library",
          id: existingMetadata?.id ?? `skill_${randomUUID()}`,
          slug,
          displayName,
          compatibleProviders,
          createdAt: existingMetadata?.createdAt ?? now,
          updatedAt: now,
          originLabel: existingMetadata?.originLabel,
          originPath: existingMetadata?.originPath,
          ...(category ? { category } : {}),
        };
        fs.writeFileSync(
          path.join(directoryPath, SKILL_FILE_NAME),
          renderSkillMarkdown({
            name: slug,
            description,
            instructions,
            ...(category ? { category } : {}),
          }),
          "utf8",
        );
        writeJsonFile(path.join(directoryPath, COZEA_METADATA_FILE_NAME), metadata);

        const changedProviders: AgentSkillProvider[] = [];
        if (current) {
          for (const binding of current.bindings) {
            if (binding.enabled && !compatibleProviders.includes(binding.provider)) {
              this.disableManagedBinding(current, binding.provider);
              changedProviders.push(binding.provider);
            } else if (binding.enabled && binding.ownership === "managed") {
              this.enableManagedBinding({ ...current, path: directoryPath }, binding.provider);
              changedProviders.push(binding.provider);
            }
          }
        }
        return this.mutationResult(true, {
          skillId: metadata.id,
          changedProviders: uniqueProviders(changedProviders),
        });
      } catch (error) {
        return this.mutationResult(false, {
          error: error instanceof Error ? error.message : "Unable to save the skill.",
        });
      }
    });
  }

  private enableManagedBinding(skill: AgentSkillRecord, providerId: AgentSkillProvider): void {
    const provider = this.getProvider(providerId);
    const destinationPath = path.join(provider.rootPath, skill.slug);
    ensureDirectory(provider.rootPath);
    if (fs.existsSync(destinationPath)) {
      const marker = readJsonFile<ManagedBindingMetadata>(
        path.join(destinationPath, COZEA_METADATA_FILE_NAME),
      );
      if (marker?.kind !== "binding" || marker.skillId !== skill.id) {
        throw new Error(`${provider.label} already has a different skill named “${skill.slug}”.`);
      }
    }

    const stagePath = path.join(provider.rootPath, `.${skill.slug}.cozea-stage-${randomUUID()}`);
    try {
      copySkillDirectory(skill.path, stagePath);
      writeJsonFile(path.join(stagePath, COZEA_METADATA_FILE_NAME), {
        schemaVersion: 1,
        kind: "binding",
        skillId: skill.id,
        updatedAt: Date.now(),
      } satisfies ManagedBindingMetadata);
      if (fs.existsSync(destinationPath)) {
        this.moveToTrash(destinationPath, `${provider.id}-${skill.slug}-previous`);
      }
      fs.renameSync(stagePath, destinationPath);
    } catch (error) {
      if (fs.existsSync(stagePath)) fs.rmSync(stagePath, { recursive: true, force: true });
      throw error;
    }

    // The skill lives in exactly one place per provider. Clearing our own
    // copies out of the other roots is what migrates a binding when a
    // provider's primary folder changes.
    this.trashManagedCopiesOutsidePrimary(skill, providerId);
  }

  /** Remove Cozea-owned copies of a skill from a provider's non-primary roots. */
  private trashManagedCopiesOutsidePrimary(
    skill: AgentSkillRecord,
    providerId: AgentSkillProvider,
  ): void {
    const provider = this.getProvider(providerId);
    for (const rootPath of provider.rootPaths.slice(1)) {
      const strayPath = path.join(rootPath, skill.slug);
      if (!isDirectory(strayPath)) continue;
      const marker = readJsonFile<ManagedBindingMetadata>(
        path.join(strayPath, COZEA_METADATA_FILE_NAME),
      );
      if (marker?.kind !== "binding" || marker.skillId !== skill.id) continue;
      try {
        this.moveToTrash(strayPath, `${providerId}-${skill.slug}-moved`);
      } catch {
        // Leaving a duplicate behind is better than failing the whole toggle.
      }
    }
  }

  private disableManagedBinding(skill: AgentSkillRecord, providerId: AgentSkillProvider): void {
    const provider = this.getProvider(providerId);
    // Check every root: a binding written before the provider's primary folder
    // changed still needs removing from wherever it actually sits.
    for (const rootPath of provider.rootPaths) {
      const destinationPath = path.join(rootPath, skill.slug);
      if (!fs.existsSync(destinationPath)) continue;
      const marker = readJsonFile<ManagedBindingMetadata>(
        path.join(destinationPath, COZEA_METADATA_FILE_NAME),
      );
      if (marker?.kind !== "binding" || marker.skillId !== skill.id) {
        throw new Error(
          `Cozea will not remove the externally managed ${provider.label} skill at this path.`,
        );
      }
      this.moveToTrash(destinationPath, `${provider.id}-${skill.slug}`);
    }
  }

  async setProviderEnabled(options: {
    skillId: string;
    provider: AgentSkillProvider;
    enabled: boolean;
  }): Promise<AgentSkillMutationResult> {
    return await this.enqueue(() => {
      try {
        const snapshot = this.list();
        const skill = snapshot.skills.find((candidate) => candidate.id === options.skillId);
        if (!skill) throw new Error("This skill is no longer available.");
        const binding = skill.bindings.find((candidate) => candidate.provider === options.provider);
        if (!binding?.compatible)
          throw new Error("This skill is not marked compatible with that provider.");
        if (binding.essential && !options.enabled) {
          throw new Error(
            "This skill ships with the agent, which restores it. Cozea cannot disable it.",
          );
        }
        if (binding.enabled === options.enabled) {
          return this.mutationResult(true, { skillId: skill.id, changedProviders: [] });
        }

        if (skill.source === "managed") {
          if (options.enabled) this.enableManagedBinding(skill, options.provider);
          else this.disableManagedBinding(skill, options.provider);
        } else {
          const state = this.loadState();
          if (options.enabled) {
            const disabled = state.disabledExternalBindings.find(
              (candidate) =>
                candidate.skillId === skill.id && candidate.provider === options.provider,
            );
            // No record means this provider never had a copy to begin with.
            // Every binding is marked compatible, so switching a skill on asks
            // all four providers; the ones that never carried it have nothing
            // to restore, which is not a failure. Reporting it as one made a
            // build that applied correctly look like it had errored.
            if (!disabled) {
              return this.mutationResult(true, { skillId: skill.id, changedProviders: [] });
            }
            if (!isDirectory(disabled.trashPath)) {
              throw new Error("The disabled provider copy could not be restored.");
            }
            if (fs.existsSync(disabled.originalPath)) {
              throw new Error("Another skill now occupies the original provider path.");
            }
            ensureDirectory(path.dirname(disabled.originalPath));
            fs.renameSync(disabled.trashPath, disabled.originalPath);
            state.disabledExternalBindings = state.disabledExternalBindings.filter(
              (candidate) => candidate !== disabled,
            );
          } else {
            if (!binding.path || !isDirectory(binding.path)) {
              throw new Error("The provider copy could not be found.");
            }
            const trashPath = this.moveToTrash(binding.path, `${options.provider}-${skill.slug}`);
            state.disabledExternalBindings = state.disabledExternalBindings.filter(
              (candidate) =>
                !(candidate.skillId === skill.id && candidate.provider === options.provider),
            );
            state.disabledExternalBindings.push({
              skillId: skill.id,
              provider: options.provider,
              originalPath: binding.path,
              trashPath,
              disabledAt: Date.now(),
            });
          }
          this.saveState(state);
        }

        return this.mutationResult(true, {
          skillId: skill.id,
          changedProviders: [options.provider],
        });
      } catch (error) {
        return this.mutationResult(false, {
          error: error instanceof Error ? error.message : "Unable to change the provider binding.",
        });
      }
    });
  }

  /**
   * The row-level master switch: turn a skill on or off everywhere it is
   * compatible. Each provider still goes through `setProviderEnabled`, so a
   * partial failure leaves the providers that did change already applied and
   * reports the first reason the rest did not.
   */
  async setEnabled(options: {
    skillId: string;
    enabled: boolean;
  }): Promise<AgentSkillMutationResult> {
    const skill = this.list().skills.find((candidate) => candidate.id === options.skillId);
    if (!skill) {
      return this.mutationResult(false, { error: "This skill is no longer available." });
    }

    const targets = skill.bindings
      .filter((binding) => binding.compatible && binding.enabled !== options.enabled)
      .map((binding) => binding.provider);
    if (targets.length === 0) {
      return this.mutationResult(true, { skillId: skill.id, changedProviders: [] });
    }

    const changedProviders: AgentSkillProvider[] = [];
    let failure: string | undefined;
    for (const provider of targets) {
      const result = await this.setProviderEnabled({
        skillId: skill.id,
        provider,
        enabled: options.enabled,
      });
      if (result.success) changedProviders.push(...(result.changedProviders ?? []));
      else failure ??= result.error;
    }

    if (failure) {
      return this.mutationResult(false, { skillId: skill.id, error: failure });
    }
    return this.mutationResult(true, {
      skillId: skill.id,
      changedProviders: uniqueProviders(changedProviders),
    });
  }

  /**
   * Re-read a skill from wherever it came from, then push the refreshed copy
   * into every provider that has it enabled. Deliberately manual: Cozea does
   * not poll origins, so this runs only when the user asks.
   */
  async update(skillId: string): Promise<AgentSkillMutationResult> {
    return await this.enqueue(() => {
      try {
        const skill = this.list().skills.find((candidate) => candidate.id === skillId);
        if (!skill) throw new Error("This skill is no longer available.");
        if (skill.source !== "managed") {
          throw new Error(
            "This skill lives in a provider folder, so that provider owns its updates. Copy it to your library first.",
          );
        }

        const metadata = readJsonFile<ManagedSkillMetadata>(
          path.join(skill.path, COZEA_METADATA_FILE_NAME),
        );
        if (!metadata) throw new Error("This skill's library copy could not be read.");
        const now = Date.now();

        if (skill.updateSource === "built-in") {
          const definition = findBuiltInDefinition(skill);
          if (!definition) throw new Error("This skill no longer ships with Cozea.");
          fs.writeFileSync(
            path.join(skill.path, SKILL_FILE_NAME),
            renderSkillMarkdown({
              name: metadata.slug,
              description: definition.description,
              instructions: definition.instructions,
              ...(metadata.category ? { category: metadata.category } : {}),
            }),
            "utf8",
          );
          writeJsonFile(path.join(skill.path, COZEA_METADATA_FILE_NAME), {
            ...metadata,
            displayName: definition.name,
            compatibleProviders: uniqueProviders(definition.compatibleProviders),
            updatedAt: now,
          } satisfies ManagedSkillMetadata);
          if (definition.key === MEMORY_SKILL_KEY) this.syncMemoryInstructions(definition.name);
        } else if (skill.updateSource === "folder") {
          const originPath = metadata.originPath;
          if (!originPath || !isDirectory(originPath)) {
            throw new Error("The folder this skill was imported from is no longer available.");
          }
          if (!readSkillMarkdown(originPath)) {
            throw new Error("That folder no longer contains a readable SKILL.md file.");
          }
          const stagePath = path.join(
            this.libraryRoot,
            `.${metadata.slug}.cozea-update-${randomUUID()}`,
          );
          try {
            copySkillDirectory(originPath, stagePath);
            writeJsonFile(path.join(stagePath, COZEA_METADATA_FILE_NAME), {
              ...metadata,
              updatedAt: now,
            } satisfies ManagedSkillMetadata);
            this.moveToTrash(skill.path, `library-${metadata.slug}-previous`);
            fs.renameSync(stagePath, skill.path);
          } catch (error) {
            if (fs.existsSync(stagePath)) fs.rmSync(stagePath, { recursive: true, force: true });
            throw error;
          }
        } else if (skill.updateSource !== "providers") {
          throw new Error(
            "There is nothing to update this skill from. Edit it to change what it does.",
          );
        }

        const refreshed = this.list().skills.find((candidate) => candidate.id === skillId);
        const changedProviders: AgentSkillProvider[] = [];
        for (const binding of skill.bindings) {
          if (!binding.enabled || binding.ownership !== "managed" || !refreshed) continue;
          const stillCompatible = refreshed.bindings.some(
            (candidate) => candidate.provider === binding.provider && candidate.compatible,
          );
          if (stillCompatible) this.enableManagedBinding(refreshed, binding.provider);
          else this.disableManagedBinding(refreshed, binding.provider);
          changedProviders.push(binding.provider);
        }

        return this.mutationResult(true, {
          skillId,
          changedProviders: uniqueProviders(changedProviders),
        });
      } catch (error) {
        return this.mutationResult(false, {
          error: error instanceof Error ? error.message : "Unable to update the skill.",
        });
      }
    });
  }

  async saveBuild(options: {
    buildId?: string;
    name: string;
    skillIds: string[];
  }): Promise<AgentSkillMutationResult> {
    return await this.enqueue(() => {
      try {
        const name = options.name.trim();
        if (!name) throw new Error("Give the build a name.");

        const known = new Set(this.list().skills.map((skill) => skill.id));
        const skillIds = Array.from(new Set(options.skillIds)).filter((id) => known.has(id));

        const state = this.loadState();
        const builds = [...(state.builds ?? [])];
        const now = Date.now();
        const index = options.buildId
          ? builds.findIndex((build) => build.id === options.buildId)
          : -1;

        if (options.buildId && index === -1) throw new Error("That build no longer exists.");

        const build: AgentSkillBuild = {
          id: options.buildId ?? `build_${randomUUID()}`,
          name: name.slice(0, 80),
          skillIds,
          createdAt: index >= 0 ? builds[index]!.createdAt : now,
          updatedAt: now,
        };

        if (index >= 0) builds[index] = build;
        else builds.push(build);

        this.saveState({ ...state, builds });
        return this.mutationResult(true, { skillId: build.id });
      } catch (error) {
        return this.mutationResult(false, {
          error: error instanceof Error ? error.message : "Unable to save the build.",
        });
      }
    });
  }

  async deleteBuild(buildId: string): Promise<AgentSkillMutationResult> {
    return await this.enqueue(() => {
      try {
        const state = this.loadState();
        const builds = (state.builds ?? []).filter((build) => build.id !== buildId);
        this.saveState({
          ...state,
          builds,
          ...(state.activeBuildId === buildId ? { activeBuildId: null } : {}),
        });
        return this.mutationResult(true);
      } catch (error) {
        return this.mutationResult(false, {
          error: error instanceof Error ? error.message : "Unable to delete the build.",
        });
      }
    });
  }

  /**
   * Switch to a build: everything it names goes on, everything else goes off.
   *
   * Runs through `setEnabled` per skill rather than touching files directly, so
   * a build change is exactly the same operation as flipping those toggles by
   * hand — including the ownership checks that stop Cozea removing a skill it
   * does not manage. A skill that refuses is reported and the rest still apply,
   * because a half-applied build the user can see beats an opaque failure.
   */
  async applyBuild(buildId: string): Promise<AgentSkillMutationResult> {
    const snapshot = this.list();
    const build = snapshot.builds.find((candidate) => candidate.id === buildId);
    if (!build) {
      return this.mutationResult(false, { error: "That build no longer exists." });
    }

    // Catalog entries are not installed, so there is nothing to switch on.
    // Essential skills are skipped outright: the provider rewrites the folder
    // they live in, so disabling them churns the filesystem and then loses.
    const installed = snapshot.skills
      .filter(
        (skill) =>
          skill.source !== "catalog" && !skill.bindings.some((binding) => binding.essential),
      )
      .map((skill) => ({
        id: skill.id,
        enabled: skill.bindings.some((binding) => binding.enabled),
      }));

    const { enable, disable } = planBuildApplication(build, installed);
    const changedProviders: AgentSkillProvider[] = [];
    const failures: string[] = [];

    for (const [skillId, enabled] of [
      ...disable.map((id) => [id, false] as const),
      ...enable.map((id) => [id, true] as const),
    ]) {
      const result = await this.setEnabled({ skillId, enabled });
      if (result.success) changedProviders.push(...(result.changedProviders ?? []));
      else if (result.error) failures.push(result.error);
    }

    // Remember what was activated, so a skill toggled afterwards cannot make
    // the page forget which build the user chose.
    const state = this.loadState();
    this.saveState({ ...state, activeBuildId: build.id });

    return this.mutationResult(failures.length === 0, {
      skillId: build.id,
      changedProviders: uniqueProviders(changedProviders),
      ...(failures.length > 0
        ? { error: `${failures.length} skill(s) could not change: ${failures[0]}` }
        : {}),
    });
  }

  async remove(skillId: string): Promise<AgentSkillMutationResult> {
    return await this.enqueue(() => {
      try {
        const skill = this.list().skills.find((candidate) => candidate.id === skillId);
        if (!skill) throw new Error("This skill is no longer available.");
        // The agent owns the folder and rewrites it, so a delete would come
        // back. Refused here as well as hidden, so no other caller can try.
        if (skill.bindings.some((binding) => binding.essential)) {
          throw new Error(
            "This skill ships with the agent, which restores it. Cozea cannot delete it.",
          );
        }
        const changedProviders: AgentSkillProvider[] = [];
        if (skill.source === "managed") {
          for (const binding of skill.bindings) {
            if (!binding.enabled || binding.ownership !== "managed") continue;
            this.disableManagedBinding(skill, binding.provider);
            changedProviders.push(binding.provider);
          }
          if (isDirectory(skill.path)) this.moveToTrash(skill.path, `library-${skill.slug}`);
        } else {
          for (const binding of skill.bindings) {
            if (!binding.enabled || !binding.path || !isDirectory(binding.path)) continue;
            this.moveToTrash(binding.path, `${binding.provider}-${skill.slug}`);
            changedProviders.push(binding.provider);
          }
          const state = this.loadState();
          state.disabledExternalBindings = state.disabledExternalBindings.filter(
            (candidate) => candidate.skillId !== skill.id,
          );
          this.saveState(state);
        }
        return this.mutationResult(true, { skillId, changedProviders });
      } catch (error) {
        return this.mutationResult(false, {
          error: error instanceof Error ? error.message : "Unable to remove the skill.",
        });
      }
    });
  }

  /**
   * Install a catalog skill by copying it into the provider's own skills
   * folder, which is what the provider actually loads from. The marketplace
   * copy stays put — Cozea is not the owner of a plugin's files.
   */
  async install(skillId: string): Promise<AgentSkillMutationResult> {
    return await this.enqueue(() => {
      try {
        const skill = this.list().skills.find((candidate) => candidate.id === skillId);
        if (!skill) throw new Error("This skill is no longer available.");
        if (skill.source !== "catalog") {
          throw new Error("This skill is already installed.");
        }
        const target = skill.bindings.find((binding) => binding.available && binding.path);
        if (!target?.path || !isDirectory(target.path)) {
          throw new Error("The catalog folder for this skill could not be read.");
        }

        const provider = this.getProvider(target.provider);
        const slug = slugifySkillName(skill.slug) || slugifySkillName(path.basename(target.path));
        if (!slug) throw new Error("This skill does not have a valid name.");
        const destinationPath = path.join(provider.rootPath, slug);
        if (fs.existsSync(destinationPath)) {
          throw new Error(`${provider.label} already has a skill named “${slug}”.`);
        }

        ensureDirectory(provider.rootPath);
        const stagePath = path.join(provider.rootPath, `.${slug}.cozea-install-${randomUUID()}`);
        try {
          copySkillDirectory(target.path, stagePath);
          fs.renameSync(stagePath, destinationPath);
        } catch (error) {
          if (fs.existsSync(stagePath)) fs.rmSync(stagePath, { recursive: true, force: true });
          throw error;
        }

        return this.mutationResult(true, {
          skillId: createExternalSkillId(slug),
          changedProviders: [target.provider],
        });
      } catch (error) {
        return this.mutationResult(false, {
          error: error instanceof Error ? error.message : "Unable to install the skill.",
        });
      }
    });
  }

  async copyToLibrary(skillId: string): Promise<AgentSkillMutationResult> {
    return await this.enqueue(() => {
      try {
        const skill = this.list().skills.find((candidate) => candidate.id === skillId);
        if (!skill) throw new Error("This skill is no longer available.");
        if (skill.source === "managed") {
          return this.mutationResult(true, { skillId: skill.id, changedProviders: [] });
        }
        const sourcePath =
          skill.bindings.find(
            (binding) => binding.enabled && binding.path && isDirectory(binding.path),
          )?.path ?? skill.path;
        if (!sourcePath || !isDirectory(sourcePath)) {
          throw new Error("The provider skill folder could not be read.");
        }
        return this.importFromDirectory(sourcePath, "Copied from a provider folder");
      } catch (error) {
        return this.mutationResult(false, {
          error: error instanceof Error ? error.message : "Unable to copy the skill.",
        });
      }
    });
  }

  private importFromDirectory(sourcePath: string, originLabel?: string): AgentSkillMutationResult {
    const markdown = readSkillMarkdown(sourcePath);
    if (!markdown)
      throw new Error("The selected folder does not contain a readable SKILL.md file.");
    const parsed = parseSkillMarkdown(markdown, path.basename(sourcePath));
    const slug = slugifySkillName(parsed.name) || slugifySkillName(path.basename(sourcePath));
    if (!slug) throw new Error("The imported skill does not have a valid name.");
    const directoryPath = this.uniqueLibraryPath(slug);
    copySkillDirectory(sourcePath, directoryPath);
    const now = Date.now();
    const category = normalizeAgentSkillCategory(parsed.category);
    const metadata: ManagedSkillMetadata = {
      schemaVersion: 1,
      kind: "library",
      id: `skill_${randomUUID()}`,
      slug: path.basename(directoryPath),
      displayName: parsed.name,
      compatibleProviders: this.providers.map((provider) => provider.id),
      createdAt: now,
      updatedAt: now,
      originLabel,
      originPath: sourcePath,
      ...(category ? { category } : {}),
    };
    writeJsonFile(path.join(directoryPath, COZEA_METADATA_FILE_NAME), metadata);
    return this.mutationResult(true, { skillId: metadata.id, changedProviders: [] });
  }

  async importDirectory(sender: WebContents): Promise<AgentSkillMutationResult> {
    const owner = BrowserWindow.fromWebContents(sender);
    const selection = owner
      ? await dialog.showOpenDialog(owner, {
          title: "Import agent skill",
          properties: ["openDirectory"],
        })
      : await dialog.showOpenDialog({
          title: "Import agent skill",
          properties: ["openDirectory"],
        });
    if (selection.canceled || !selection.filePaths[0]) {
      return this.mutationResult(false, { error: "Import canceled." });
    }
    return await this.enqueue(() => {
      try {
        return this.importFromDirectory(selection.filePaths[0], "Imported folder");
      } catch (error) {
        return this.mutationResult(false, {
          error: error instanceof Error ? error.message : "Unable to import the skill.",
        });
      }
    });
  }

  async openSetupPack(sender: WebContents): Promise<AgentSkillSetupPackResult> {
    const owner = BrowserWindow.fromWebContents(sender);
    const selection = owner
      ? await dialog.showOpenDialog(owner, {
          title: "Open shared skill setup",
          properties: ["openFile"],
          filters: [{ name: "Cozea skill setup", extensions: ["json"] }],
        })
      : await dialog.showOpenDialog({
          title: "Open shared skill setup",
          properties: ["openFile"],
          filters: [{ name: "Cozea skill setup", extensions: ["json"] }],
        });
    if (selection.canceled || !selection.filePaths[0])
      return { success: false, error: "Open canceled." };
    try {
      const filePath = selection.filePaths[0];
      if (fs.statSync(filePath).size > MAX_SETUP_PACK_BYTES) {
        throw new Error("Setup packs must be smaller than 5 MB.");
      }
      const pack = normalizeSetupPack(readJsonFile<unknown>(filePath), filePath);
      if (!pack) throw new Error("This is not a valid Cozea skill setup pack.");
      return { success: true, pack };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unable to open the setup pack.",
      };
    }
  }

  async copyFromSetupPack(
    packInput: AgentSkillSetupPack,
    packSkillId: string,
  ): Promise<AgentSkillMutationResult> {
    return await this.enqueue(() => {
      try {
        const pack = normalizeSetupPack(packInput, packInput.sourcePath);
        const packedSkill = pack?.skills.find((skill) => skill.packSkillId === packSkillId);
        if (!pack || !packedSkill) throw new Error("That skill is not present in the setup pack.");
        const slug = slugifySkillName(packedSkill.slug || packedSkill.name);
        const directoryPath = this.uniqueLibraryPath(slug || "skill");
        ensureDirectory(directoryPath);
        fs.writeFileSync(
          path.join(directoryPath, SKILL_FILE_NAME),
          renderSkillMarkdown({
            name: path.basename(directoryPath),
            description: packedSkill.description,
            instructions: packedSkill.instructions,
          }),
          "utf8",
        );
        const now = Date.now();
        const metadata: ManagedSkillMetadata = {
          schemaVersion: 1,
          kind: "library",
          id: `skill_${randomUUID()}`,
          slug: path.basename(directoryPath),
          displayName: packedSkill.name,
          compatibleProviders: packedSkill.compatibleProviders,
          createdAt: now,
          updatedAt: now,
          originLabel: pack.authorName ? `${pack.authorName} · ${pack.setupName}` : pack.setupName,
        };
        writeJsonFile(path.join(directoryPath, COZEA_METADATA_FILE_NAME), metadata);
        const created = this.list().skills.find((skill) => skill.id === metadata.id);
        const changedProviders: AgentSkillProvider[] = [];
        if (created) {
          for (const provider of packedSkill.enabledProviders) {
            if (!metadata.compatibleProviders.includes(provider)) continue;
            this.enableManagedBinding(created, provider);
            changedProviders.push(provider);
          }
        }
        return this.mutationResult(true, {
          skillId: metadata.id,
          changedProviders,
        });
      } catch (error) {
        return this.mutationResult(false, {
          error: error instanceof Error ? error.message : "Unable to copy the shared skill.",
        });
      }
    });
  }

  async exportSetupPack(
    sender: WebContents,
    options: { setupName: string; authorName: string },
  ): Promise<AgentSkillExportResult> {
    const setupName = options.setupName.trim() || "My agent setup";
    const authorName = options.authorName.trim() || "Cozea user";
    const defaultName = `${slugifySkillName(setupName) || "agent-setup"}.${SETUP_PACK_EXTENSION}`;
    const owner = BrowserWindow.fromWebContents(sender);
    const selection = owner
      ? await dialog.showSaveDialog(owner, {
          title: "Export skill setup",
          defaultPath: defaultName,
          filters: [{ name: "Cozea skill setup", extensions: ["json"] }],
        })
      : await dialog.showSaveDialog({
          title: "Export skill setup",
          defaultPath: defaultName,
          filters: [{ name: "Cozea skill setup", extensions: ["json"] }],
        });
    if (selection.canceled || !selection.filePath)
      return { success: false, error: "Export canceled." };
    try {
      const snapshot = this.list();
      const pack: AgentSkillSetupPack = {
        version: 1,
        setupName,
        authorName,
        exportedAt: Date.now(),
        sourcePath: "",
        skills: snapshot.skills.map((skill) => ({
          packSkillId: skill.id,
          name: skill.name,
          slug: skill.slug,
          description: skill.description,
          instructions: skill.instructions,
          compatibleProviders: skill.bindings
            .filter((binding) => binding.compatible)
            .map((binding) => binding.provider),
          enabledProviders: skill.bindings
            .filter((binding) => binding.enabled)
            .map((binding) => binding.provider),
        })),
      };
      writeJsonFile(selection.filePath, pack);
      return { success: true, filePath: selection.filePath };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unable to export the setup.",
      };
    }
  }

  /**
   * Move managed copies into whichever folder a provider now loads from.
   *
   * Codex reads `~/.codex/skills`, but Cozea used to install into
   * `~/.agents/skills`, so an enabled skill never actually reached it. Runs
   * once per provider and records that it did, because it is a repair rather
   * than something to redo on every launch.
   */
  async migrateManagedBindingsToPrimaryRoot(): Promise<void> {
    const done = this.loadState().migratedPrimaryRoots ?? [];
    const pending = PROVIDER_DEFINITIONS.filter(
      (definition) =>
        !done.includes(definition.id) &&
        definition.relativeRoots.filter((root) => !root.catalog).length > 1,
    );
    if (pending.length === 0) return;

    for (const definition of pending) {
      const provider = this.getProvider(definition.id);
      const secondaryRoots = provider.rootPaths.filter(
        (_root, index) => index > 0 && !definition.relativeRoots[index]?.catalog,
      );
      for (const rootPath of secondaryRoots) {
        for (const strayPath of listDirectories(rootPath)) {
          const marker = readJsonFile<ManagedBindingMetadata>(
            path.join(strayPath, COZEA_METADATA_FILE_NAME),
          );
          if (marker?.kind !== "binding" || marker.schemaVersion !== 1) continue;
          const skill = this.list().skills.find((candidate) => candidate.id === marker.skillId);
          if (!skill || skill.source !== "managed") continue;
          try {
            // Writes into the primary root, then clears the stray copy.
            this.enableManagedBinding(skill, definition.id);
          } catch {
            // A blocked move is not worth failing startup for; the next
            // enable or update retries it.
          }
        }
      }
    }

    const next = this.loadState();
    this.saveState({
      ...next,
      migratedPrimaryRoots: [
        ...(next.migratedPrimaryRoots ?? []),
        ...pending.map((definition) => definition.id),
      ],
    });
  }

  /**
   * Install the skills Cozea ships, once, and enable them everywhere they are
   * compatible so every agent tile inherits project memory as default context.
   *
   * Seeding is recorded per key rather than inferred from presence: a user who
   * deletes a built-in means it, and a later launch must not bring it back.
   */
  async ensureBuiltInSkills(): Promise<void> {
    for (const definition of BUILT_IN_SKILLS) {
      const state = this.loadState();
      if (state.seededBuiltInSkills?.includes(definition.key)) continue;

      try {
        const created = await this.save({
          name: definition.name,
          description: definition.description,
          instructions: definition.instructions,
          compatibleProviders: definition.compatibleProviders,
        });
        if (created.success && created.skillId) {
          for (const provider of definition.compatibleProviders) {
            await this.setProviderEnabled({
              skillId: created.skillId,
              provider,
              enabled: true,
            });
          }
        }

        // The skill folder only offers itself. Project memory has to be
        // consulted before an agent starts reading files, so every provider
        // also gets a managed block in the file it always loads.
        if (definition.key === MEMORY_SKILL_KEY) {
          this.syncMemoryInstructions(definition.name);
        }
      } catch {
        // A failed seed must never block startup; the next launch retries.
        continue;
      }

      const next = this.loadState();
      this.saveState({
        ...next,
        seededBuiltInSkills: [...(next.seededBuiltInSkills ?? []), definition.key],
      });
    }
  }

  /**
   * Mirror the memory instruction block across every provider Cozea knows,
   * whether or not that provider is installed: the file is cheap, and it means
   * the agent behaves correctly the moment the user does install one.
   */
  syncMemoryInstructions(skillName: string): void {
    for (const provider of PROVIDER_DEFINITIONS) {
      const target = path.join(this.homeRoot, provider.instructionsFile);
      try {
        writeMemoryInstructions(target, skillName);
      } catch {
        // A provider directory we cannot write is not worth failing startup for.
        continue;
      }
    }
  }

  /** Used when the user turns project memory off for a provider. */
  clearMemoryInstructions(): void {
    for (const provider of PROVIDER_DEFINITIONS) {
      try {
        removeMemoryInstructions(path.join(this.homeRoot, provider.instructionsFile));
      } catch {
        continue;
      }
    }
  }

  registerIpcHandlers(): void {
    ipcMain.handle("agentSkills:list", () => this.listForDisplay());
    ipcMain.handle("agentSkills:save", (_event, draft: AgentSkillDraft) => this.save(draft));
    ipcMain.handle(
      "agentSkills:setProviderEnabled",
      (_event, options: { skillId: string; provider: AgentSkillProvider; enabled: boolean }) =>
        this.setProviderEnabled(options),
    );
    ipcMain.handle(
      "agentSkills:setEnabled",
      (_event, options: { skillId: string; enabled: boolean }) => this.setEnabled(options),
    );
    ipcMain.handle("agentSkills:update", (_event, options: { skillId: string }) =>
      this.update(options.skillId),
    );
    ipcMain.handle("agentSkills:install", (_event, options: { skillId: string }) =>
      this.install(options.skillId),
    );
    ipcMain.handle(
      "agentSkills:saveBuild",
      (_event, options: { buildId?: string; name: string; skillIds: string[] }) =>
        this.saveBuild(options),
    );
    ipcMain.handle("agentSkills:deleteBuild", (_event, options: { buildId: string }) =>
      this.deleteBuild(options.buildId),
    );
    ipcMain.handle("agentSkills:applyBuild", (_event, options: { buildId: string }) =>
      this.applyBuild(options.buildId),
    );
    ipcMain.handle("agentSkills:copyToLibrary", (_event, options: { skillId: string }) =>
      this.copyToLibrary(options.skillId),
    );
    ipcMain.handle("agentSkills:remove", (_event, options: { skillId: string }) =>
      this.remove(options.skillId),
    );
    ipcMain.handle("agentSkills:importDirectory", (event) => this.importDirectory(event.sender));
    ipcMain.handle("agentSkills:openSetupPack", (event) => this.openSetupPack(event.sender));
    ipcMain.handle(
      "agentSkills:copyFromSetupPack",
      (_event, options: { pack: AgentSkillSetupPack; packSkillId: string }) =>
        this.copyFromSetupPack(options.pack, options.packSkillId),
    );
    ipcMain.handle(
      "agentSkills:exportSetupPack",
      (event, options: { setupName: string; authorName: string }) =>
        this.exportSetupPack(event.sender, options),
    );
  }
}
