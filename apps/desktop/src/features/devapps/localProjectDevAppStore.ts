import { nanoid } from "nanoid";
import { create } from "zustand";
import { createJSONStorage, persist, type StateStorage } from "zustand/middleware";

import { isProjectDevAppCommand } from "../../../../../shared/projectDevAppCommand";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { isProjectDevAppLogoDataUrl } from "./projectDevAppLogo";
import type {
  AccessibleProjectDevApp,
  ProjectDevAppPublication,
  ProjectDevAppRelease,
  ProjectDevAppSourceProject,
  PublishProjectDevAppArgs,
  PublishProjectDevAppResult,
} from "./projectDevAppApi";

export const LOCAL_PROJECT_DEVAPP_STORAGE_KEY = "cozea:project-devapps:local:v1";
const LOCAL_PUBLICATION_ID_PREFIX = "local-devapp-publication:";
const LOCAL_RELEASE_ID_PREFIX = "local-devapp-release:";
const MAX_LOCAL_ENTRIES = 48;
const MAX_RELEASES_PER_ENTRY = 25;
/** Upper bound on release rows inspected before the newest are kept. */
const MAX_RELEASES_SCANNED = MAX_RELEASES_PER_ENTRY * 8;
const MAX_IDENTITY_NAME_LENGTH = 80;
/**
 * localStorage gives an origin roughly 5 MB of UTF-16 characters, shared with
 * every other Cozea key. Cap this catalog well below that and fail loudly
 * rather than letting a write blow the quota and silently lose the catalog.
 */
const MAX_PERSISTED_CATALOG_CHARACTERS = 2_500_000;

export const PROJECT_DEVAPP_STORAGE_FULL_MESSAGE =
  "This Mac has no room left to store local DevApps. Remove a Local DevApp or choose a smaller logo, then try again.";

/** Thrown when the local catalog cannot be persisted within the browser quota. */
export class ProjectDevAppStorageFullError extends Error {
  constructor() {
    super(PROJECT_DEVAPP_STORAGE_FULL_MESSAGE);
    this.name = "ProjectDevAppStorageFullError";
  }
}

function isQuotaExceededError(error: unknown): boolean {
  if (typeof DOMException !== "undefined" && error instanceof DOMException) {
    return (
      error.name === "QuotaExceededError" || error.name === "NS_ERROR_DOM_QUOTA_REACHED"
    );
  }
  return error instanceof Error && error.name === "QuotaExceededError";
}

export interface LocalProjectDevAppCatalogEntry extends AccessibleProjectDevApp {
  releases: ProjectDevAppRelease[];
}

export type PublishLocalProjectDevAppArgs = PublishProjectDevAppArgs & {
  sourceProject: ProjectDevAppSourceProject;
  logoDataUrl?: string;
};

export interface UpdateLocalProjectDevAppLogoArgs {
  publicationId: Id<"devAppPublications"> | string;
  logoDataUrl: string;
}

export interface UpdateLocalProjectDevAppIdentityArgs extends UpdateLocalProjectDevAppLogoArgs {
  name: string;
}

export interface LocalProjectDevAppCatalogState {
  entries: LocalProjectDevAppCatalogEntry[];
  publish: (args: PublishLocalProjectDevAppArgs) => PublishProjectDevAppResult;
  updateIdentity: (args: UpdateLocalProjectDevAppIdentityArgs) => void;
  updateLogo: (args: UpdateLocalProjectDevAppLogoArgs) => void;
}

function createMemoryStorage(): StateStorage {
  const items = new Map<string, string>();
  return {
    getItem: (name) => items.get(name) ?? null,
    setItem: (name, value) => {
      items.set(name, value);
    },
    removeItem: (name) => {
      items.delete(name);
    },
  };
}

/**
 * Translates the browser's opaque quota rejection into an error the publish and
 * identity flows can show verbatim.
 */
function withQuotaReporting(storage: StateStorage): StateStorage {
  return {
    getItem: (name) => storage.getItem(name),
    setItem: (name, value) => {
      try {
        return storage.setItem(name, value);
      } catch (error) {
        if (isQuotaExceededError(error)) {
          throw new ProjectDevAppStorageFullError();
        }
        throw error;
      }
    },
    removeItem: (name) => storage.removeItem(name),
  };
}

const localProjectDevAppStorage = withQuotaReporting(
  typeof window === "undefined" ? createMemoryStorage() : window.localStorage,
);

function assertPersistableEntries(entries: LocalProjectDevAppCatalogEntry[]): void {
  if (JSON.stringify({ entries }).length > MAX_PERSISTED_CATALOG_CHARACTERS) {
    throw new ProjectDevAppStorageFullError();
  }
}

function createPublicationId(): Id<"devAppPublications"> {
  return `${LOCAL_PUBLICATION_ID_PREFIX}${nanoid()}` as Id<"devAppPublications">;
}

function createReleaseId(): Id<"devAppReleases"> {
  return `${LOCAL_RELEASE_ID_PREFIX}${nanoid()}` as Id<"devAppReleases">;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requiredString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized || null;
}

function optionalString(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  return requiredString(value) ?? undefined;
}

function validTimestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function sanitizeRelease(
  value: unknown,
  publicationId: string,
  projectId: string,
): ProjectDevAppRelease | null {
  if (!isRecord(value)) return null;

  const releaseId = requiredString(value._id);
  const releasePublicationId = requiredString(value.publicationId);
  const releaseProjectId = requiredString(value.projectId);
  const framework = requiredString(value.framework);
  const devCommand = requiredString(value.devCommand);
  const sourceFingerprint = requiredString(value.sourceFingerprint)?.toLowerCase() ?? null;
  const createdBy = requiredString(value.createdBy);
  const version = value.version;
  const devPort = value.devPort;

  if (
    !releaseId?.startsWith(LOCAL_RELEASE_ID_PREFIX) ||
    releasePublicationId !== publicationId ||
    releaseProjectId !== projectId ||
    !framework ||
    !devCommand ||
    !isProjectDevAppCommand(devCommand) ||
    !sourceFingerprint ||
    !/^[a-f0-9]{64}$/.test(sourceFingerprint) ||
    !createdBy ||
    !Number.isSafeInteger(version) ||
    (version as number) < 1 ||
    !validTimestamp(value.createdAt) ||
    (devPort !== undefined &&
      (!Number.isInteger(devPort) || (devPort as number) < 1 || (devPort as number) > 65_535))
  ) {
    return null;
  }

  return {
    _id: releaseId as Id<"devAppReleases">,
    publicationId: publicationId as Id<"devAppPublications">,
    projectId: projectId as Id<"projects">,
    version: version as number,
    framework,
    devCommand,
    ...(devPort !== undefined ? { devPort: devPort as number } : {}),
    ...(optionalString(value.sourceRevision)
      ? { sourceRevision: optionalString(value.sourceRevision) }
      : {}),
    sourceFingerprint,
    createdBy: createdBy as Id<"users">,
    createdAt: value.createdAt,
  };
}

function sanitizeEntry(value: unknown): LocalProjectDevAppCatalogEntry | null {
  if (!isRecord(value) || !isRecord(value.publication) || !isRecord(value.sourceProject)) {
    return null;
  }

  const publicationValue = value.publication;
  const sourceProjectValue = value.sourceProject;
  const publicationId = requiredString(publicationValue._id);
  const projectId = requiredString(publicationValue.projectId);
  const name = requiredString(publicationValue.name);
  const createdBy = requiredString(publicationValue.createdBy);
  const updatedBy = requiredString(publicationValue.updatedBy);
  const sourceProjectId = requiredString(sourceProjectValue._id);
  const sourceProjectName = requiredString(sourceProjectValue.name);
  const sourceProjectSlug = requiredString(sourceProjectValue.slug);
  const sourceProjectStatus = requiredString(sourceProjectValue.status);

  if (
    !publicationId?.startsWith(LOCAL_PUBLICATION_ID_PREFIX) ||
    !projectId ||
    !name ||
    !createdBy ||
    !updatedBy ||
    !validTimestamp(publicationValue.createdAt) ||
    !validTimestamp(publicationValue.updatedAt) ||
    sourceProjectId !== projectId ||
    !sourceProjectName ||
    !sourceProjectSlug ||
    !sourceProjectStatus ||
    !validTimestamp(sourceProjectValue.updatedAt) ||
    !Array.isArray(value.releases)
  ) {
    return null;
  }

  const releaseIds = new Set<string>();
  const releaseVersions = new Set<number>();
  // Releases are append-only, so the tail holds the newest. Trim after sorting
  // so the active release is always the highest surviving version.
  const releases = value.releases
    .slice(-MAX_RELEASES_SCANNED)
    .map((release) => sanitizeRelease(release, publicationId, projectId))
    .filter((release): release is ProjectDevAppRelease => {
      if (!release || releaseIds.has(String(release._id)) || releaseVersions.has(release.version)) {
        return false;
      }
      releaseIds.add(String(release._id));
      releaseVersions.add(release.version);
      return true;
    })
    .sort((left, right) => left.version - right.version)
    .slice(-MAX_RELEASES_PER_ENTRY);
  const activeRelease = releases.at(-1);
  if (!activeRelease) return null;

  const description = optionalString(publicationValue.description);
  const sourceDescription = optionalString(sourceProjectValue.description) ?? null;
  const previewImageId = optionalString(sourceProjectValue.previewImageId) ?? null;
  const logoDataUrl = isProjectDevAppLogoDataUrl(value.logoDataUrl) ? value.logoDataUrl : undefined;
  const publication: ProjectDevAppPublication = {
    _id: publicationId as Id<"devAppPublications">,
    projectId: projectId as Id<"projects">,
    activeReleaseId: activeRelease._id,
    visibility: "project",
    name,
    ...(description ? { description } : {}),
    status: publicationValue.status === "archived" ? "archived" : "active",
    createdBy: createdBy as Id<"users">,
    updatedBy: updatedBy as Id<"users">,
    createdAt: publicationValue.createdAt,
    updatedAt: publicationValue.updatedAt,
  };

  return {
    publication,
    activeRelease,
    sourceProject: {
      _id: projectId as Id<"projects">,
      name: sourceProjectName,
      slug: sourceProjectSlug,
      description: sourceDescription,
      previewImageId: previewImageId as Id<"_storage"> | null,
      status: sourceProjectStatus,
      updatedAt: sourceProjectValue.updatedAt,
    },
    ...(logoDataUrl ? { logoDataUrl } : {}),
    releases,
  };
}

function sanitizeEntries(value: unknown): LocalProjectDevAppCatalogEntry[] {
  if (!Array.isArray(value)) return [];

  const entriesByProjectId = new Map<string, LocalProjectDevAppCatalogEntry>();
  for (const candidate of value.slice(0, MAX_LOCAL_ENTRIES)) {
    const entry = sanitizeEntry(candidate);
    if (!entry) continue;

    const projectId = String(entry.publication.projectId);
    const existing = entriesByProjectId.get(projectId);
    if (!existing || entry.publication.updatedAt > existing.publication.updatedAt) {
      entriesByProjectId.set(projectId, entry);
    }
  }

  return [...entriesByProjectId.values()];
}

function nextReleaseVersion(entry: LocalProjectDevAppCatalogEntry | undefined): number {
  if (!entry) {
    return 1;
  }

  return entry.releases.reduce((highest, release) => Math.max(highest, release.version), 0) + 1;
}

function publishLocalEntry(
  entries: LocalProjectDevAppCatalogEntry[],
  args: PublishLocalProjectDevAppArgs,
): {
  entries: LocalProjectDevAppCatalogEntry[];
  result: PublishProjectDevAppResult;
} {
  if (String(args.sourceProject._id) !== String(args.projectId)) {
    throw new Error("The DevApp source project must match the published project.");
  }
  if (!args.name.trim() || !args.framework.trim()) {
    throw new Error("The DevApp name and framework are required.");
  }
  if (!isProjectDevAppCommand(args.devCommand)) {
    throw new Error("The DevApp command must run a recognized preview package.json script.");
  }
  if (!/^[a-f0-9]{64}$/i.test(args.sourceFingerprint)) {
    throw new Error("The DevApp source fingerprint must be a SHA-256 digest.");
  }
  if (
    args.devPort !== undefined &&
    (!Number.isInteger(args.devPort) || args.devPort < 1 || args.devPort > 65_535)
  ) {
    throw new Error("The DevApp port must be an integer between 1 and 65535.");
  }

  const existingIndex = entries.findIndex(
    (entry) => String(entry.publication.projectId) === String(args.projectId),
  );
  const existing = existingIndex >= 0 ? entries[existingIndex] : undefined;
  if (args.logoDataUrl !== undefined && !isProjectDevAppLogoDataUrl(args.logoDataUrl)) {
    throw new Error("The DevApp logo must be a valid optimized PNG, JPEG, or WebP image.");
  }
  const inheritedLogoDataUrl = isProjectDevAppLogoDataUrl(existing?.logoDataUrl)
    ? existing.logoDataUrl
    : undefined;
  const logoDataUrl = inheritedLogoDataUrl ?? args.logoDataUrl;
  if (!existing && !logoDataUrl) {
    throw new Error("Choose an app logo before launching this project as a DevApp.");
  }
  const now = Date.now();
  const publicationId = existing?.publication._id ?? createPublicationId();
  const release: ProjectDevAppRelease = {
    _id: createReleaseId(),
    publicationId,
    projectId: args.projectId,
    version: nextReleaseVersion(existing),
    framework: args.framework,
    devCommand: args.devCommand,
    devPort: args.devPort,
    sourceRevision: args.sourceRevision,
    sourceFingerprint: args.sourceFingerprint,
    createdBy: args.userId,
    createdAt: now,
  };
  const publication: ProjectDevAppPublication = {
    _id: publicationId,
    projectId: args.projectId,
    activeReleaseId: release._id,
    visibility: "project",
    name: existing?.publication.name ?? args.name,
    description: args.description,
    status: "active",
    createdBy: existing?.publication.createdBy ?? args.userId,
    updatedBy: args.userId,
    createdAt: existing?.publication.createdAt ?? now,
    updatedAt: now,
  };
  const entry: LocalProjectDevAppCatalogEntry = {
    publication,
    activeRelease: release,
    sourceProject: { ...args.sourceProject },
    ...(logoDataUrl ? { logoDataUrl } : {}),
    releases: (existing ? [...existing.releases, release] : [release]).slice(
      -MAX_RELEASES_PER_ENTRY,
    ),
  };
  const nextEntries = [...entries];

  if (existingIndex >= 0) {
    nextEntries[existingIndex] = entry;
  } else {
    if (nextEntries.length >= MAX_LOCAL_ENTRIES) {
      throw new Error(
        `This Mac already holds ${MAX_LOCAL_ENTRIES} local DevApps. Remove one before publishing another.`,
      );
    }
    nextEntries.push(entry);
  }

  return {
    entries: nextEntries,
    result: {
      publication,
      release,
      created: existingIndex < 0,
    },
  };
}

function normalizeIdentityName(value: string): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) {
    throw new Error("The DevApp name is required.");
  }
  if (normalized.length > MAX_IDENTITY_NAME_LENGTH) {
    throw new Error(`The DevApp name must be ${MAX_IDENTITY_NAME_LENGTH} characters or fewer.`);
  }
  return normalized;
}

function updateLocalEntryIdentity(
  entries: LocalProjectDevAppCatalogEntry[],
  args: UpdateLocalProjectDevAppIdentityArgs,
): LocalProjectDevAppCatalogEntry[] {
  const name = normalizeIdentityName(args.name);
  if (!isProjectDevAppLogoDataUrl(args.logoDataUrl)) {
    throw new Error("The DevApp logo must be a valid optimized PNG, JPEG, or WebP image.");
  }

  const existingIndex = entries.findIndex(
    (entry) => String(entry.publication._id) === String(args.publicationId),
  );
  if (existingIndex < 0) {
    throw new Error(`Local DevApp publication "${String(args.publicationId)}" was not found.`);
  }

  const existing = entries[existingIndex];
  if (existing.publication.name === name && existing.logoDataUrl === args.logoDataUrl) {
    return entries;
  }

  const nextEntries = [...entries];
  nextEntries[existingIndex] = {
    ...existing,
    publication: {
      ...existing.publication,
      name,
      updatedAt: Math.max(Date.now(), existing.publication.updatedAt + 1),
    },
    logoDataUrl: args.logoDataUrl,
  };
  return nextEntries;
}

function updateLocalEntryLogo(
  entries: LocalProjectDevAppCatalogEntry[],
  args: UpdateLocalProjectDevAppLogoArgs,
): LocalProjectDevAppCatalogEntry[] {
  if (!isProjectDevAppLogoDataUrl(args.logoDataUrl)) {
    throw new Error("The DevApp logo must be a valid optimized PNG, JPEG, or WebP image.");
  }

  const existing = entries.find(
    (entry) => String(entry.publication._id) === String(args.publicationId),
  );
  if (!existing) {
    throw new Error(`Local DevApp publication "${String(args.publicationId)}" was not found.`);
  }

  return updateLocalEntryIdentity(entries, {
    ...args,
    name: existing.publication.name,
  });
}

export const useLocalProjectDevAppStore = create<LocalProjectDevAppCatalogState>()(
  persist(
    (set, get) => {
      /**
       * Persistence happens inside `set`, so a quota rejection would otherwise
       * leave memory ahead of storage. Check the budget first, then roll memory
       * back if the write still fails.
       */
      const commitEntries = (nextEntries: LocalProjectDevAppCatalogEntry[]) => {
        const previousEntries = get().entries;
        if (nextEntries === previousEntries) return;
        assertPersistableEntries(nextEntries);
        try {
          set({ entries: nextEntries });
        } catch (error) {
          try {
            set({ entries: previousEntries });
          } catch {
            // The rollback write is known to have fit before; ignore a second failure.
          }
          throw error;
        }
      };

      return {
        entries: [],
        publish: (args) => {
          const published = publishLocalEntry(get().entries, args);
          commitEntries(published.entries);
          return published.result;
        },
        updateIdentity: (args) => {
          commitEntries(updateLocalEntryIdentity(get().entries, args));
        },
        updateLogo: (args) => {
          commitEntries(updateLocalEntryLogo(get().entries, args));
        },
      };
    },
    {
      name: LOCAL_PROJECT_DEVAPP_STORAGE_KEY,
      version: 1,
      storage: createJSONStorage(() => localProjectDevAppStorage),
      partialize: (state) => ({ entries: state.entries }),
      merge: (persistedState, currentState) => {
        const persisted = persistedState as Partial<LocalProjectDevAppCatalogState> | undefined;
        return {
          ...currentState,
          entries: sanitizeEntries(persisted?.entries),
        };
      },
    },
  ),
);

export function useLocalProjectDevAppEntries(): LocalProjectDevAppCatalogEntry[] {
  return useLocalProjectDevAppStore((state) => state.entries);
}

export function useLocalProjectDevAppEntry(
  projectId: Id<"projects"> | string | null | undefined,
): LocalProjectDevAppCatalogEntry | null {
  return useLocalProjectDevAppStore((state) => {
    if (!projectId) {
      return null;
    }
    return (
      state.entries.find((entry) => String(entry.publication.projectId) === String(projectId)) ??
      null
    );
  });
}

export function getLocalProjectDevAppEntries(): LocalProjectDevAppCatalogEntry[] {
  return useLocalProjectDevAppStore.getState().entries;
}

export function getLocalProjectDevAppEntry(
  projectId: Id<"projects"> | string | null | undefined,
): LocalProjectDevAppCatalogEntry | null {
  if (!projectId) {
    return null;
  }
  return (
    getLocalProjectDevAppEntries().find(
      (entry) => String(entry.publication.projectId) === String(projectId),
    ) ?? null
  );
}

export function publishLocalProjectDevApp(
  args: PublishLocalProjectDevAppArgs,
): PublishProjectDevAppResult {
  return useLocalProjectDevAppStore.getState().publish(args);
}

export function updateLocalProjectDevAppLogo(
  publicationId: Id<"devAppPublications"> | string,
  logoDataUrl: string,
): void {
  useLocalProjectDevAppStore.getState().updateLogo({ publicationId, logoDataUrl });
}

export function updateLocalProjectDevAppIdentity(
  publicationId: Id<"devAppPublications"> | string,
  name: string,
  logoDataUrl: string,
): void {
  useLocalProjectDevAppStore.getState().updateIdentity({ publicationId, name, logoDataUrl });
}
