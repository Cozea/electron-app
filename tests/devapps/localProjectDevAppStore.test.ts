import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Id } from "../../convex/_generated/dataModel";
import type { PublishLocalProjectDevAppArgs } from "@/features/devapps/localProjectDevAppStore";

class MemoryStorage implements Storage {
  readonly #items = new Map<string, string>();

  get length(): number {
    return this.#items.size;
  }

  clear(): void {
    this.#items.clear();
  }

  getItem(key: string): string | null {
    return this.#items.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.#items.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.#items.delete(key);
  }

  setItem(key: string, value: string): void {
    this.#items.set(key, value);
  }
}

const projectId = "local-project:one" as Id<"projects">;
const userId = "local-user:one" as Id<"users">;
const logoDataUrl = "data:image/webp;base64,UklGRjEyMzRXRUJQ";
const updatedLogoDataUrl = "data:image/webp;base64,UklGRjU2NzhXRUJQ";

function createPublishArgs(
  patch: Partial<PublishLocalProjectDevAppArgs> = {},
): PublishLocalProjectDevAppArgs {
  return {
    projectId,
    userId,
    name: "Local dashboard",
    description: "Runs from this machine",
    framework: "vite-react",
    devCommand: "bun run dev",
    devPort: 5173,
    sourceRevision: "abc123",
    sourceFingerprint: "a".repeat(64),
    logoDataUrl,
    sourceProject: {
      _id: projectId,
      name: "Local dashboard",
      slug: "local-dashboard",
      description: "Runs from this machine",
      previewImageId: null,
      status: "active",
      updatedAt: 100,
    },
    ...patch,
  };
}

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal("window", { localStorage: new MemoryStorage() });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("local project DevApp catalog", () => {
  it("keeps one publication per project and appends immutable versioned releases", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-16T20:00:00Z"));
    const catalog = await import("@/features/devapps/localProjectDevAppStore");
    const observedEntryCounts: number[] = [];
    const unsubscribe = catalog.useLocalProjectDevAppStore.subscribe((state) => {
      observedEntryCounts.push(state.entries.length);
    });

    const first = catalog.publishLocalProjectDevApp(createPublishArgs());
    vi.setSystemTime(new Date("2026-07-16T20:05:00Z"));
    const second = catalog.publishLocalProjectDevApp(
      createPublishArgs({
        name: "Updated dashboard",
        sourceRevision: "def456",
        sourceFingerprint: "b".repeat(64),
      }),
    );
    unsubscribe();

    const entry = catalog.getLocalProjectDevAppEntry(projectId);
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.publication._id).toBe(first.publication._id);
    expect(second.publication.createdAt).toBe(first.publication.createdAt);
    expect(second.publication.name).toBe("Local dashboard");
    expect(second.release._id).not.toBe(first.release._id);
    expect(entry?.releases.map((release) => release.version)).toEqual([1, 2]);
    expect(entry?.releases[0]).toBe(first.release);
    expect(entry?.activeRelease).toBe(second.release);
    expect(entry?.publication.activeReleaseId).toBe(second.release._id);
    expect(entry?.logoDataUrl).toBe(logoDataUrl);
    expect(observedEntryCounts).toEqual([1, 1]);
  });

  it("requires a valid logo for the first publication", async () => {
    const catalog = await import("@/features/devapps/localProjectDevAppStore");
    const withoutLogo = createPublishArgs();
    delete withoutLogo.logoDataUrl;

    expect(() => catalog.publishLocalProjectDevApp(withoutLogo)).toThrow("Choose an app logo");
    expect(() =>
      catalog.publishLocalProjectDevApp(
        createPublishArgs({ logoDataUrl: "data:image/svg+xml;base64,PHN2Zz4=" }),
      ),
    ).toThrow("valid optimized PNG, JPEG, or WebP");
    expect(catalog.getLocalProjectDevAppEntries()).toEqual([]);
  });

  it("inherits the existing logo when an update omits it", async () => {
    const catalog = await import("@/features/devapps/localProjectDevAppStore");
    catalog.publishLocalProjectDevApp(createPublishArgs());
    const update = createPublishArgs({
      sourceRevision: "def456",
      sourceFingerprint: "b".repeat(64),
    });
    delete update.logoDataUrl;

    const result = catalog.publishLocalProjectDevApp(update);

    expect(result.created).toBe(false);
    expect(catalog.getLocalProjectDevAppEntry(projectId)?.logoDataUrl).toBe(logoDataUrl);
  });

  it("preserves custom identity when publishing a new release", async () => {
    const catalog = await import("@/features/devapps/localProjectDevAppStore");
    const first = catalog.publishLocalProjectDevApp(createPublishArgs());
    catalog.updateLocalProjectDevAppIdentity(
      first.publication._id,
      "Custom console",
      updatedLogoDataUrl,
    );

    const second = catalog.publishLocalProjectDevApp(
      createPublishArgs({
        name: "Renamed source project",
        logoDataUrl,
        sourceRevision: "def456",
        sourceFingerprint: "b".repeat(64),
        sourceProject: {
          ...createPublishArgs().sourceProject,
          name: "Renamed source project",
          slug: "renamed-source-project",
          updatedAt: 200,
        },
      }),
    );

    const entry = catalog.getLocalProjectDevAppEntry(projectId);
    expect(second.created).toBe(false);
    expect(second.publication.name).toBe("Custom console");
    expect(entry?.publication.name).toBe("Custom console");
    expect(entry?.logoDataUrl).toBe(updatedLogoDataUrl);
    expect(entry?.sourceProject.name).toBe("Renamed source project");
    expect(entry?.sourceProject.slug).toBe("renamed-source-project");
    expect(entry?.releases.map((release) => release.version)).toEqual([1, 2]);
    expect(entry?.releases[0]).toBe(first.release);
    expect(entry?.activeRelease).toBe(second.release);
    expect(entry?.publication.activeReleaseId).toBe(second.release._id);
  });

  it("updates the DevApp identity in place without creating a release", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-16T20:00:00Z"));
    const storage = new MemoryStorage();
    vi.stubGlobal("window", { localStorage: storage });
    const catalog = await import("@/features/devapps/localProjectDevAppStore");
    const published = catalog.publishLocalProjectDevApp(createPublishArgs());
    const before = catalog.getLocalProjectDevAppEntry(projectId);
    const observedIdentities: Array<{ name: string; logoDataUrl?: string }> = [];
    const unsubscribe = catalog.useLocalProjectDevAppStore.subscribe((state) => {
      const entry = state.entries[0];
      if (entry) {
        observedIdentities.push({
          name: entry.publication.name,
          logoDataUrl: entry.logoDataUrl,
        });
      }
    });

    vi.setSystemTime(new Date("2026-07-16T20:05:00Z"));
    catalog.updateLocalProjectDevAppIdentity(
      published.publication._id,
      "  Renamed dashboard  ",
      updatedLogoDataUrl,
    );
    unsubscribe();

    const after = catalog.getLocalProjectDevAppEntry(projectId);
    expect(after?.publication.name).toBe("Renamed dashboard");
    expect(after?.logoDataUrl).toBe(updatedLogoDataUrl);
    expect(after?.publication.updatedAt).toBe(new Date("2026-07-16T20:05:00Z").getTime());
    expect(after?.sourceProject.name).toBe("Local dashboard");
    expect(after?.activeRelease).toBe(before?.activeRelease);
    expect(after?.releases).toBe(before?.releases);
    expect(after?.releases).toHaveLength(1);
    expect(after?.publication.activeReleaseId).toBe(published.release._id);
    expect(observedIdentities).toEqual([
      { name: "Renamed dashboard", logoDataUrl: updatedLogoDataUrl },
    ]);

    vi.resetModules();
    const reloadedModule = await import("@/features/devapps/localProjectDevAppStore");
    const restored = reloadedModule.getLocalProjectDevAppEntry(projectId);
    expect(restored?.publication.name).toBe("Renamed dashboard");
    expect(restored?.logoDataUrl).toBe(updatedLogoDataUrl);
    expect(restored?.sourceProject.name).toBe("Local dashboard");
    expect(restored?.releases).toHaveLength(1);
    expect(restored?.activeRelease._id).toBe(published.release._id);
  });

  it("keeps the logo-only update helper backward-compatible", async () => {
    const catalog = await import("@/features/devapps/localProjectDevAppStore");
    const published = catalog.publishLocalProjectDevApp(createPublishArgs());
    const before = catalog.getLocalProjectDevAppEntry(projectId);

    catalog.updateLocalProjectDevAppLogo(published.publication._id, updatedLogoDataUrl);

    const after = catalog.getLocalProjectDevAppEntry(projectId);
    expect(after?.publication.name).toBe("Local dashboard");
    expect(after?.logoDataUrl).toBe(updatedLogoDataUrl);
    expect(after?.activeRelease).toBe(before?.activeRelease);
    expect(after?.releases).toBe(before?.releases);
  });

  it("rejects invalid identity values and missing publications without changing state", async () => {
    const catalog = await import("@/features/devapps/localProjectDevAppStore");
    const published = catalog.publishLocalProjectDevApp(createPublishArgs());
    const before = catalog.getLocalProjectDevAppEntry(projectId);
    let notificationCount = 0;
    const unsubscribe = catalog.useLocalProjectDevAppStore.subscribe(() => {
      notificationCount += 1;
    });

    expect(() =>
      catalog.updateLocalProjectDevAppIdentity(
        published.publication._id,
        "Local dashboard",
        "data:image/svg+xml;base64,PHN2Zz4=",
      ),
    ).toThrow("valid optimized PNG, JPEG, or WebP");
    expect(() =>
      catalog.updateLocalProjectDevAppIdentity(
        "local-devapp-publication:missing",
        "Missing dashboard",
        updatedLogoDataUrl,
      ),
    ).toThrow("was not found");
    expect(() =>
      catalog.updateLocalProjectDevAppIdentity(
        published.publication._id,
        "   ",
        updatedLogoDataUrl,
      ),
    ).toThrow("name is required");
    expect(() =>
      catalog.updateLocalProjectDevAppIdentity(
        published.publication._id,
        "x".repeat(81),
        updatedLogoDataUrl,
      ),
    ).toThrow("80 characters or fewer");
    unsubscribe();

    expect(catalog.getLocalProjectDevAppEntry(projectId)).toBe(before);
    expect(notificationCount).toBe(0);
  });

  it("does not notify or change timestamps when normalized identity values are unchanged", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-16T20:00:00Z"));
    const catalog = await import("@/features/devapps/localProjectDevAppStore");
    const published = catalog.publishLocalProjectDevApp(createPublishArgs());
    const before = catalog.getLocalProjectDevAppEntry(projectId);
    let notificationCount = 0;
    const unsubscribe = catalog.useLocalProjectDevAppStore.subscribe(() => {
      notificationCount += 1;
    });

    vi.setSystemTime(new Date("2026-07-16T20:05:00Z"));
    catalog.updateLocalProjectDevAppIdentity(
      published.publication._id,
      "  Local dashboard  ",
      logoDataUrl,
    );
    unsubscribe();

    const after = catalog.getLocalProjectDevAppEntry(projectId);
    expect(after).toBe(before);
    expect(after?.publication.updatedAt).toBe(new Date("2026-07-16T20:00:00Z").getTime());
    expect(notificationCount).toBe(0);
  });

  it("rehydrates the catalog from machine-local storage", async () => {
    const storage = new MemoryStorage();
    vi.stubGlobal("window", { localStorage: storage });
    const firstModule = await import("@/features/devapps/localProjectDevAppStore");
    const published = firstModule.publishLocalProjectDevApp(createPublishArgs());

    expect(storage.getItem(firstModule.LOCAL_PROJECT_DEVAPP_STORAGE_KEY)).not.toBeNull();

    vi.resetModules();
    const reloadedModule = await import("@/features/devapps/localProjectDevAppStore");
    const restored = reloadedModule.getLocalProjectDevAppEntry(projectId);

    expect(restored?.publication._id).toBe(published.publication._id);
    expect(restored?.activeRelease._id).toBe(published.release._id);
    expect(restored?.releases).toHaveLength(1);
    expect(restored?.sourceProject.slug).toBe("local-dashboard");
    expect(restored?.logoDataUrl).toBe(logoDataUrl);
  });

  it("preserves legacy persisted entries that do not have a logo", async () => {
    const storage = new MemoryStorage();
    vi.stubGlobal("window", { localStorage: storage });
    const firstModule = await import("@/features/devapps/localProjectDevAppStore");
    firstModule.publishLocalProjectDevApp(createPublishArgs());

    const serialized = storage.getItem(firstModule.LOCAL_PROJECT_DEVAPP_STORAGE_KEY);
    const persisted = JSON.parse(serialized ?? "{}") as {
      state?: { entries?: Array<{ logoDataUrl?: string }> };
    };
    const persistedEntry = persisted.state?.entries?.[0];
    expect(persistedEntry).toBeDefined();
    if (persistedEntry) {
      delete persistedEntry.logoDataUrl;
    }
    storage.setItem(firstModule.LOCAL_PROJECT_DEVAPP_STORAGE_KEY, JSON.stringify(persisted));

    vi.resetModules();
    const reloadedModule = await import("@/features/devapps/localProjectDevAppStore");
    const restored = reloadedModule.getLocalProjectDevAppEntry(projectId);

    expect(restored?.publication.name).toBe("Local dashboard");
    expect(restored?.logoDataUrl).toBeUndefined();
  });

  it("strips an invalid persisted logo without deleting the catalog entry", async () => {
    const storage = new MemoryStorage();
    vi.stubGlobal("window", { localStorage: storage });
    const firstModule = await import("@/features/devapps/localProjectDevAppStore");
    firstModule.publishLocalProjectDevApp(createPublishArgs());

    const serialized = storage.getItem(firstModule.LOCAL_PROJECT_DEVAPP_STORAGE_KEY);
    const persisted = JSON.parse(serialized ?? "{}") as {
      state?: { entries?: Array<{ logoDataUrl?: string }> };
    };
    const persistedEntry = persisted.state?.entries?.[0];
    expect(persistedEntry).toBeDefined();
    if (persistedEntry) {
      persistedEntry.logoDataUrl = "data:image/svg+xml;base64,PHN2Zz4=";
    }
    storage.setItem(firstModule.LOCAL_PROJECT_DEVAPP_STORAGE_KEY, JSON.stringify(persisted));

    vi.resetModules();
    const reloadedModule = await import("@/features/devapps/localProjectDevAppStore");
    const restored = reloadedModule.getLocalProjectDevAppEntry(projectId);

    expect(restored?.activeRelease.version).toBe(1);
    expect(restored?.logoDataUrl).toBeUndefined();
  });

  it("drops persisted entries whose release command is unsafe", async () => {
    const storage = new MemoryStorage();
    vi.stubGlobal("window", { localStorage: storage });
    const firstModule = await import("@/features/devapps/localProjectDevAppStore");
    firstModule.publishLocalProjectDevApp(createPublishArgs());

    const serialized = storage.getItem(firstModule.LOCAL_PROJECT_DEVAPP_STORAGE_KEY);
    expect(serialized).not.toBeNull();
    const persisted = JSON.parse(serialized ?? "{}") as {
      state?: { entries?: Array<{ releases?: Array<{ devCommand?: string }> }> };
    };
    const persistedRelease = persisted.state?.entries?.[0]?.releases?.[0];
    expect(persistedRelease).toBeDefined();
    if (persistedRelease) {
      persistedRelease.devCommand = "bun run dev && rm -rf /";
    }
    storage.setItem(firstModule.LOCAL_PROJECT_DEVAPP_STORAGE_KEY, JSON.stringify(persisted));

    vi.resetModules();
    const reloadedModule = await import("@/features/devapps/localProjectDevAppStore");

    expect(reloadedModule.getLocalProjectDevAppEntries()).toEqual([]);
  });

  it("rejects a source-project snapshot for a different project", async () => {
    const catalog = await import("@/features/devapps/localProjectDevAppStore");
    const otherProjectId = "local-project:other" as Id<"projects">;

    expect(() =>
      catalog.publishLocalProjectDevApp(
        createPublishArgs({
          sourceProject: {
            ...createPublishArgs().sourceProject,
            _id: otherProjectId,
          },
        }),
      ),
    ).toThrow("source project must match");
    expect(catalog.getLocalProjectDevAppEntries()).toEqual([]);
  });

  it("reports a clear failure when the browser rejects the write for quota", async () => {
    const storage = new MemoryStorage();
    vi.spyOn(storage, "setItem").mockImplementation(() => {
      const error = new Error("exceeded the quota");
      error.name = "QuotaExceededError";
      throw error;
    });
    vi.stubGlobal("window", { localStorage: storage });

    const catalog = await import("@/features/devapps/localProjectDevAppStore");

    expect(() => catalog.publishLocalProjectDevApp(createPublishArgs())).toThrow(
      catalog.PROJECT_DEVAPP_STORAGE_FULL_MESSAGE,
    );
    // Memory must not drift ahead of a catalog that was never persisted.
    expect(catalog.getLocalProjectDevAppEntries()).toEqual([]);
  });

  it("refuses a logo large enough to blow the storage budget", async () => {
    const catalog = await import("@/features/devapps/localProjectDevAppStore");
    const logo = await import("@/features/devapps/projectDevAppLogo");
    const base64 = "UklGRjEyMzRXRUJQ".padEnd(
      logo.PROJECT_DEVAPP_LOGO_MAX_DATA_URL_LENGTH,
      "A",
    );

    expect(() =>
      catalog.publishLocalProjectDevApp(
        createPublishArgs({ logoDataUrl: `data:image/webp;base64,${base64}` }),
      ),
    ).toThrow("must be a valid optimized");
    expect(catalog.getLocalProjectDevAppEntries()).toEqual([]);
  });

  it("keeps the newest releases when an entry exceeds the release cap", async () => {
    const storage = new MemoryStorage();
    vi.stubGlobal("window", { localStorage: storage });
    const firstModule = await import("@/features/devapps/localProjectDevAppStore");
    firstModule.publishLocalProjectDevApp(createPublishArgs());

    const persisted = JSON.parse(
      storage.getItem(firstModule.LOCAL_PROJECT_DEVAPP_STORAGE_KEY) ?? "{}",
    );
    const template = persisted.state.entries[0].releases[0];
    persisted.state.entries[0].releases = Array.from({ length: 60 }, (_unused, index) => ({
      ...template,
      _id: `local-devapp-release:v${index + 1}`,
      version: index + 1,
    }));
    storage.setItem(
      firstModule.LOCAL_PROJECT_DEVAPP_STORAGE_KEY,
      JSON.stringify(persisted),
    );

    vi.resetModules();
    const reloaded = await import("@/features/devapps/localProjectDevAppStore");
    const entry = reloaded.getLocalProjectDevAppEntry(projectId);

    expect(entry?.releases.length).toBe(25);
    expect(entry?.releases.at(-1)?.version).toBe(60);
    expect(entry?.activeRelease.version).toBe(60);
  });
});
