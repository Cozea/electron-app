import { app, BrowserWindow, dialog, ipcMain, type WebContents } from "electron";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type {
  AgentSkillDraft,
  AgentSkillExportResult,
  AgentSkillMutationResult,
  AgentSkillProvider,
  AgentSkillProviderBinding,
  AgentSkillProviderInfo,
  AgentSkillRecord,
  AgentSkillsSnapshot,
  AgentSkillSetupPack,
  AgentSkillSetupPackResult,
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
}

interface ProviderDefinition extends AgentSkillProviderInfo {
  relativeRoot: string;
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
    relativeRoot: path.join(".agents", "skills"),
    rootPath: "",
    restartBehavior: "restart-external-app",
  },
  {
    id: "claude",
    label: "Claude",
    relativeRoot: path.join(".claude", "skills"),
    rootPath: "",
    restartBehavior: "live",
  },
  {
    id: "cursor",
    label: "Cursor",
    relativeRoot: path.join(".cursor", "skills"),
    rootPath: "",
    restartBehavior: "restart-recommended",
  },
  {
    id: "opencode",
    label: "OpenCode",
    relativeRoot: path.join(".config", "opencode", "skills"),
    rootPath: "",
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

function createExternalSkillId(markdown: string): string {
  return `external_${createHash("sha256").update(markdown).digest("hex").slice(0, 20)}`;
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
    return PROVIDER_DEFINITIONS.map((provider) => ({
      id: provider.id,
      label: provider.label,
      rootPath: path.join(this.homeRoot, provider.relativeRoot),
      restartBehavior: provider.restartBehavior,
    }));
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
      return { schemaVersion: STATE_VERSION, disabledExternalBindings: [] };
    }
    return state;
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
    ensureDirectory(this.libraryRoot);
    const providers = this.providers;
    const managedById = new Map<string, AgentSkillRecord>();
    const externalById = new Map<string, AgentSkillRecord>();

    for (const directoryPath of listDirectories(this.libraryRoot)) {
      const metadata = readJsonFile<ManagedSkillMetadata>(
        path.join(directoryPath, COZEA_METADATA_FILE_NAME),
      );
      const markdown = readSkillMarkdown(directoryPath);
      if (!metadata || metadata.kind !== "library" || metadata.schemaVersion !== 1 || !markdown)
        continue;
      const parsed = parseSkillMarkdown(markdown, metadata.slug);
      const compatibleProviders = uniqueProviders(metadata.compatibleProviders);
      managedById.set(metadata.id, {
        id: metadata.id,
        slug: metadata.slug,
        name: metadata.displayName || parsed.name,
        description: parsed.description,
        instructions: parsed.instructions,
        source: "managed",
        editable: true,
        path: directoryPath,
        createdAt: metadata.createdAt,
        updatedAt: metadata.updatedAt,
        originLabel: metadata.originLabel,
        bindings: providers.map((provider) =>
          emptyBinding(provider, compatibleProviders.includes(provider.id)),
        ),
      });
    }

    for (const provider of providers) {
      for (const directoryPath of listDirectories(provider.rootPath)) {
        const markdown = readSkillMarkdown(directoryPath);
        if (!markdown) continue;
        const marker = readJsonFile<ManagedBindingMetadata>(
          path.join(directoryPath, COZEA_METADATA_FILE_NAME),
        );
        if (marker?.kind === "binding" && marker.schemaVersion === 1) {
          const managed = managedById.get(marker.skillId);
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
        const skillId = createExternalSkillId(markdown);
        const existing = externalById.get(skillId);
        const record = existing ?? {
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
          bindings: providers.map((candidate) => emptyBinding(candidate, true)),
        };
        const binding = record.bindings.find((candidate) => candidate.provider === provider.id);
        if (binding) {
          binding.enabled = true;
          binding.ownership = "external";
          binding.path = directoryPath;
        }
        externalById.set(skillId, record);
      }
    }

    const state = this.loadState();
    let stateChanged = false;
    const validDisabledBindings = state.disabledExternalBindings.filter((disabled) => {
      const markdown = readSkillMarkdown(disabled.trashPath);
      if (!markdown) {
        stateChanged = true;
        return false;
      }
      const parsed = parseSkillMarkdown(markdown, path.basename(disabled.originalPath));
      const record = externalById.get(disabled.skillId) ?? {
        id: disabled.skillId,
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
        bindings: providers.map((provider) => emptyBinding(provider, true)),
      };
      const binding = record.bindings.find((candidate) => candidate.provider === disabled.provider);
      if (binding && !binding.enabled) {
        binding.ownership = "external";
        binding.path = disabled.originalPath;
      }
      externalById.set(disabled.skillId, record);
      return true;
    });
    if (stateChanged) {
      this.saveState({ ...state, disabledExternalBindings: validDisabledBindings });
    }

    const skills = [...managedById.values(), ...externalById.values()].sort((left, right) =>
      left.name.localeCompare(right.name, undefined, { sensitivity: "base" }),
    );
    return {
      skills,
      providers,
      libraryPath: this.libraryRoot,
      generatedAt: Date.now(),
    };
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
        };
        fs.writeFileSync(
          path.join(directoryPath, SKILL_FILE_NAME),
          renderSkillMarkdown({ name: slug, description, instructions }),
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
  }

  private disableManagedBinding(skill: AgentSkillRecord, providerId: AgentSkillProvider): void {
    const provider = this.getProvider(providerId);
    const destinationPath = path.join(provider.rootPath, skill.slug);
    if (!fs.existsSync(destinationPath)) return;
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
            if (!disabled || !isDirectory(disabled.trashPath)) {
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

  async remove(skillId: string): Promise<AgentSkillMutationResult> {
    return await this.enqueue(() => {
      try {
        const skill = this.list().skills.find((candidate) => candidate.id === skillId);
        if (!skill) throw new Error("This skill is no longer available.");
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

  registerIpcHandlers(): void {
    ipcMain.handle("agentSkills:list", () => this.list());
    ipcMain.handle("agentSkills:save", (_event, draft: AgentSkillDraft) => this.save(draft));
    ipcMain.handle(
      "agentSkills:setProviderEnabled",
      (_event, options: { skillId: string; provider: AgentSkillProvider; enabled: boolean }) =>
        this.setProviderEnabled(options),
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
