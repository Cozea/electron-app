import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  PreviewAutomationOperation,
  PreviewAutomationRequest,
  PreviewViewportSetting,
} from "@cozea/contracts/t3";
import type {
  BrowserSurfaceInventoryEntry,
  BrowserSurfaceKind,
} from "../../shared/browserSurfaceTypes";

const recordingMocks = vi.hoisted(() => ({
  targets: [] as Array<{ runtimeTabId: string; serverTabId: string }>,
  readTargets: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
}));
const viewportMocks = vi.hoisted(() => ({ commit: vi.fn() }));
const surfaceControllerMocks = vi.hoisted(() => ({
  ensure: vi.fn(),
  focus: vi.fn(),
  release: vi.fn(),
  renew: vi.fn(() => true),
}));
const devServerRunMocks = vi.hoisted(() => ({
  ensure: vi.fn(),
  state: {
    contexts: {} as Record<string, { terminalId: string }>,
    runs: {} as Record<string, { status: string; error?: string | null }>,
  },
}));

vi.mock("@/features/projects/browser/browserRecording", () => ({
  readActiveBrowserRecordingTargets: recordingMocks.readTargets,
  startBrowserRecording: recordingMocks.start,
  stopBrowserRecording: recordingMocks.stop,
}));
vi.mock("@/features/projects/browser/browserViewportActions", () => ({
  commitBrowserViewportChange: viewportMocks.commit,
}));
vi.mock("@/features/projects/devserver/devServerSurfaceController", () => ({
  ensureDevServerSurface: surfaceControllerMocks.ensure,
  focusDevServerSurface: surfaceControllerMocks.focus,
  releaseDevServerSurfaceLease: surfaceControllerMocks.release,
  renewDevServerSurfaceLease: surfaceControllerMocks.renew,
}));
vi.mock("@/features/projects/devserver/devServerRunStore", () => ({
  buildDevServerRunKey: (workspaceId: string, laneId: string) => `${workspaceId}::${laneId}`,
  ensureDevServerRun: devServerRunMocks.ensure,
  useDevServerRunStore: Object.assign(() => devServerRunMocks.state, {
    getState: () => devServerRunMocks.state,
  }),
}));

import { browserViewportSettingKey } from "../../apps/desktop/src/features/projects/browser/browserViewportLayout";
import { useBrowserViewportStore } from "../../apps/desktop/src/features/projects/browser/browserViewportStore";
import {
  clearDevAppPreviewRuntimeForTests,
  publishDevAppPreviewRuntime,
} from "../../apps/desktop/src/features/projects/devapps/devAppPreviewRuntimeStore";
import {
  clearDevAppPreviewSurfaceControllersForTests,
  registerDevAppPreviewSurfaceController,
} from "../../apps/desktop/src/features/projects/devapps/devAppPreviewSurfaceController";
import {
  buildWorkbenchScopeKey,
  useProjectWorkbenchStore,
} from "../../apps/desktop/src/stores/useProjectWorkbenchStore";
import { __t3PreviewAutomationHostTestUtils } from "../../apps/desktop/src/substrate/t3PreviewAutomationHost";

const THREAD_ID = "thread-automation" as PreviewAutomationRequest["threadId"];
let previewWebviews: Array<{
  getAttribute: (name: string) => string | null;
  executeJavaScript: (code: string) => Promise<unknown>;
}> = [];

function request(
  operation: PreviewAutomationOperation,
  input: unknown = {},
  tabId?: string,
): PreviewAutomationRequest {
  return {
    requestId: `request-${operation}`,
    threadId: THREAD_ID,
    ...(tabId ? { tabId, tabIdExplicit: true } : {}),
    operation,
    input,
    timeoutMs: 1_000,
  };
}

function makeInventory(
  kind: BrowserSurfaceKind,
  tileId: string,
  runtimeTabId = `runtime-${kind}`,
): BrowserSurfaceInventoryEntry {
  return {
    runtimeTabId,
    tileId,
    workbenchSessionKey: "project-1::collab::workspace-1",
    kind,
    title: kind,
    url: "https://example.com/",
    active: true,
    controller: "none",
  };
}

function createWorkbenchSurface(kind: BrowserSurfaceKind): BrowserSurfaceInventoryEntry {
  const actions = useProjectWorkbenchStore.getState().actions;
  actions.ensureWorkbench("project-1", "collab", "workspace-1");
  actions.addTile(
    "project-1",
    "collab",
    "assistantChat",
    { threadId: THREAD_ID, activate: false },
    "workspace-1",
  );
  const tileId =
    kind === "browser"
      ? actions.addTile("project-1", "collab", "browser", {}, "workspace-1")
      : kind === "orgDevApp"
        ? actions.addTile(
            "project-1",
            "collab",
            "orgDevApp",
            {
              orgDevAppPublicationId: "publication-1",
              orgDevAppOrganizationId: "organization-1",
              orgDevAppContentHash: "hash-1",
            },
            "workspace-1",
          )
        : kind === "devAppPreview"
          ? actions.addTile(
              "project-1",
              "collab",
              "devAppPreview",
              { devAppPreviewRelativePath: "apps/inventory" },
              "workspace-1",
            )
          : actions.addTile(
              "project-1",
              "collab",
              "devServer",
              kind === "projectDevApp" ? { devAppId: "project-devapp-1" } : {},
              "workspace-1",
            );
  actions.setActiveTile("project-1", "collab", tileId, "workspace-1");
  return makeInventory(kind, tileId);
}

function installBridge(surface: BrowserSurfaceInventoryEntry) {
  const automation = {
    status: vi.fn(async () => ({
      available: true,
      visible: true,
      tabId: surface.runtimeTabId,
      url: surface.url,
      title: surface.title,
      loading: false,
    })),
    snapshot: vi.fn(async () => ({ url: surface.url, title: surface.title, nodes: [] })),
    click: vi.fn(async () => undefined),
    type: vi.fn(async () => undefined),
    press: vi.fn(async () => undefined),
    scroll: vi.fn(async () => undefined),
    evaluate: vi.fn(async (_tabId: string, input: { expression?: string }) =>
      input.expression === "document.readyState" ? "complete" : { ok: true },
    ),
    waitFor: vi.fn(async () => undefined),
  };
  const preview = {
    listSurfaces: vi.fn(async () => [surface]),
    navigate: vi.fn(async () => undefined),
    setColorScheme: vi.fn(async () => undefined),
    automation,
  };
  vi.stubGlobal("window", {
    setTimeout,
    clearTimeout,
    desktopBridge: { preview },
    electronAPI: {
      devServer: {
        getState: vi.fn(async () => ({
          running: true,
          ready: true,
          port: 4173,
          runId: "run-1",
          phase: "running" as const,
        })),
      },
      terminal: {
        list: vi.fn(async () => ["terminal-1"]),
      },
    },
  });
  vi.stubGlobal("document", {
    querySelectorAll: vi.fn(() => previewWebviews),
  });
  return preview;
}

function installViewportWebview(runtimeTabId: string, setting: PreviewViewportSetting): void {
  const attributes = new Map<string, string>([
    ["data-preview-tab", runtimeTabId],
    ["data-preview-viewport-key", browserViewportSettingKey(setting)],
    ["data-preview-css-width", setting._tag === "fill" ? "1280" : `${setting.width}`],
    ["data-preview-css-height", setting._tag === "fill" ? "800" : `${setting.height}`],
  ]);
  previewWebviews = [
    {
      getAttribute: (name: string) => attributes.get(name) ?? null,
      executeJavaScript: vi.fn(async () => ({
        width: setting._tag === "fill" ? 1280 : setting.width,
        height: setting._tag === "fill" ? 800 : setting.height,
      })),
    },
  ];
}

afterEach(() => {
  __t3PreviewAutomationHostTestUtils.resetRuntime();
  useProjectWorkbenchStore.setState({ workbenches: {} });
  useBrowserViewportStore.setState({ byTabId: {} });
  previewWebviews = [];
  recordingMocks.targets = [];
  recordingMocks.readTargets.mockReset();
  recordingMocks.start.mockReset();
  recordingMocks.stop.mockReset();
  viewportMocks.commit.mockReset();
  surfaceControllerMocks.ensure.mockReset();
  surfaceControllerMocks.focus.mockReset();
  surfaceControllerMocks.release.mockReset();
  surfaceControllerMocks.renew.mockReset().mockReturnValue(true);
  devServerRunMocks.ensure.mockReset();
  devServerRunMocks.state.contexts = {};
  devServerRunMocks.state.runs = {};
  clearDevAppPreviewRuntimeForTests();
  clearDevAppPreviewSurfaceControllersForTests();
  vi.unstubAllGlobals();
});

describe("T3 preview automation host", () => {
  it("advertises the complete pinned T3 operation set", () => {
    expect(__t3PreviewAutomationHostTestUtils.supportedOperations).toEqual([
      "status",
      "open",
      "navigate",
      "snapshot",
      "click",
      "type",
      "press",
      "scroll",
      "evaluate",
      "waitFor",
      "recordingStart",
      "recordingStop",
      "resize",
      "setColorScheme",
      "devServerStatus",
      "devServerEnsure",
      "devServerAttach",
      "devAppPreviewEnsure",
      "devAppPreviewAttach",
    ]);
  });

  it("resolves explicit, last-controlled, then active targets without crossing workbenches", () => {
    const browser = makeInventory("browser", "browser-1");
    const devServer = makeInventory("devServer", "dev-server-1");
    const foreign = { ...makeInventory("orgDevApp", "foreign-1"), active: true };
    const context = {
      projectId: "project-1",
      laneId: "collab",
      workspaceId: "workspace-1",
      assistantTileId: "assistant-1",
      activeTileId: browser.tileId,
      tileIds: new Set(["assistant-1", browser.tileId, devServer.tileId]),
    };
    const surfaces = [browser, devServer, foreign];

    expect(
      __t3PreviewAutomationHostTestUtils.resolveSurfaceTarget(
        context,
        surfaces,
        devServer.runtimeTabId,
        browser.runtimeTabId,
      )?.runtimeTabId,
    ).toBe(devServer.runtimeTabId);
    expect(
      __t3PreviewAutomationHostTestUtils.resolveSurfaceTarget(
        context,
        surfaces,
        null,
        devServer.runtimeTabId,
      )?.runtimeTabId,
    ).toBe(devServer.runtimeTabId);
    expect(
      __t3PreviewAutomationHostTestUtils.resolveSurfaceTarget(context, surfaces, null, null)
        ?.runtimeTabId,
    ).toBe(browser.runtimeTabId);
    expect(
      __t3PreviewAutomationHostTestUtils.resolveSurfaceTarget(
        context,
        surfaces,
        foreign.runtimeTabId,
        null,
      ),
    ).toBeNull();
  });

  const directOperations: Array<{
    operation: PreviewAutomationOperation;
    input: unknown;
  }> = [
    { operation: "status", input: {} },
    { operation: "open", input: { url: "example.com" } },
    { operation: "navigate", input: { url: "example.com", readiness: "load" } },
    { operation: "snapshot", input: {} },
    { operation: "click", input: { selector: "button" } },
    { operation: "type", input: { selector: "input", text: "hello" } },
    { operation: "press", input: { key: "Enter" } },
    { operation: "scroll", input: { deltaY: 100 } },
    { operation: "evaluate", input: { expression: "document.title" } },
    { operation: "waitFor", input: { text: "Example" } },
    { operation: "recordingStart", input: {} },
    { operation: "recordingStop", input: {} },
    { operation: "resize", input: { mode: "freeform", width: 800, height: 600 } },
    { operation: "setColorScheme", input: { colorScheme: "dark" } },
  ];
  const cases = (
    ["browser", "devServer", "projectDevApp", "orgDevApp", "devAppPreview"] as const
  ).flatMap((kind) => directOperations.map((entry) => ({ kind, ...entry })));

  it.each(cases)(
    "routes $operation through the living $kind guest",
    async ({ kind, operation, input }) => {
      const surface = createWorkbenchSurface(kind);
      const bridge = installBridge(surface);
      const setting = { _tag: "freeform", width: 800, height: 600 } as const;
      if (operation === "resize") {
        installViewportWebview(surface.runtimeTabId, setting);
        viewportMocks.commit.mockImplementation(async (tabId, next) => {
          useBrowserViewportStore.getState().set(tabId, next);
        });
      }
      recordingMocks.readTargets.mockImplementation(() => [
        { runtimeTabId: surface.runtimeTabId, serverTabId: surface.runtimeTabId },
      ]);
      recordingMocks.start.mockResolvedValue("2026-08-31T00:00:00.000Z");
      recordingMocks.stop.mockResolvedValue({
        id: "recording-1",
        tabId: surface.runtimeTabId,
        path: "/tmp/recording.webm",
        mimeType: "video/webm",
        sizeBytes: 100,
        createdAt: "2026-08-31T00:01:00.000Z",
      });

      const result = await __t3PreviewAutomationHostTestUtils.runRequest(
        request(operation, input, surface.runtimeTabId),
        "environment-1",
      );

      if (operation === "status" || operation === "open" || operation === "navigate") {
        expect(result).toMatchObject({
          available: true,
          tabId: surface.runtimeTabId,
          surfaces: [{ tabId: surface.runtimeTabId, kind, title: kind, active: true }],
        });
      }
      if (operation === "open" || operation === "navigate") {
        expect(bridge.navigate).toHaveBeenCalledWith(surface.runtimeTabId, "https://example.com");
      }
      if (operation === "resize") {
        expect(result).toEqual({
          tabId: surface.runtimeTabId,
          setting,
          viewport: { width: 800, height: 600 },
        });
      }
      if (operation === "recordingStart") {
        expect(recordingMocks.start).toHaveBeenCalledWith(
          surface.runtimeTabId,
          { environmentId: "environment-1", threadId: THREAD_ID },
          surface.runtimeTabId,
        );
      }
      if (operation === "recordingStop") {
        expect(recordingMocks.stop).toHaveBeenCalledWith(surface.runtimeTabId);
      }
    },
  );

  it("reports live process and guest status without conflating page and process health", async () => {
    const surface = createWorkbenchSurface("devServer");
    installBridge(surface);
    const context = {
      projectId: "project-1",
      laneId: "collab",
      workspaceId: "workspace-1",
      assistantTileId: "assistant-1",
      activeTileId: surface.tileId,
      tileIds: new Set(["assistant-1", surface.tileId]),
    };

    const status = await __t3PreviewAutomationHostTestUtils.readDevServerStatus(
      context,
      {
        context,
        handle: {
          tileId: surface.tileId,
          scopeKey: "scope-1",
          leaseToken: "lease-1",
          created: false,
          focused: false,
        },
      },
      true,
    );

    expect(status).toMatchObject({
      running: true,
      ready: true,
      port: 4173,
      headless: false,
      reusedProcess: true,
      surface: { available: true, tabId: surface.runtimeTabId },
    });
  });

  it("bounds surface inventory to the shared contract limits", () => {
    const surfaces = Array.from({ length: 65 }, (_, index) => ({
      ...makeInventory("browser", `browser-${index}`, `runtime-browser-${index}`),
      title: "x".repeat(513),
    }));

    const result = __t3PreviewAutomationHostTestUtils.surfaceInventoryStatus(surfaces);

    expect(result).toHaveLength(64);
    expect(result[0]?.title).toHaveLength(512);
    expect(result.at(-1)?.tabId).toBe("runtime-browser-63");
  });

  it.each(["devServerStatus", "devServerAttach", "devServerEnsure"] as const)(
    "keeps %s on the singleton process and living Dev Server surface",
    async (operation) => {
      const surface = createWorkbenchSurface("devServer");
      installBridge(surface);
      surfaceControllerMocks.ensure.mockResolvedValue({
        tileId: surface.tileId,
        scopeKey: "scope-1",
        leaseToken: "lease-1",
        created: false,
        focused: false,
      });
      devServerRunMocks.state.contexts["workspace-1::collab"] = {
        terminalId: "terminal-1",
      };
      devServerRunMocks.state.runs["workspace-1::collab"] = { status: "running" };

      const result = await __t3PreviewAutomationHostTestUtils.runRequest(
        request(operation, operation === "devServerAttach" ? { open: true } : {}),
      );

      expect(result).toMatchObject({
        running: true,
        ready: true,
        port: 4173,
        headless: false,
      });
      if (operation !== "devServerStatus") {
        expect(surfaceControllerMocks.ensure).toHaveBeenCalledTimes(1);
      }
      if (operation === "devServerEnsure") {
        expect(devServerRunMocks.ensure).toHaveBeenCalledWith("workspace-1::collab", {});
      }
    },
  );

  it("creates a confined DevApp preview without bypassing capability approval", async () => {
    const actions = useProjectWorkbenchStore.getState().actions;
    actions.ensureWorkbench("project-1", "collab", "workspace-1");
    actions.addTile("project-1", "collab", "assistantChat", { threadId: THREAD_ID }, "workspace-1");
    const bridge = installBridge(makeInventory("devAppPreview", "pending-devapp"));
    bridge.listSurfaces.mockResolvedValue([]);
    const owner = Symbol("preview-runtime");
    const ensureSurface = vi.fn(async (input: { relativePath: string; create: boolean }) => {
      const tileId = actions.addTile(
        "project-1",
        "collab",
        "devAppPreview",
        { activate: false, devAppPreviewRelativePath: input.relativePath },
        "workspace-1",
      );
      publishDevAppPreviewRuntime(owner, {
        tileId,
        relativePath: input.relativePath,
        hotReload: true,
        openError: null,
        status: {
          status: "needsApproval",
          sourceId: "8a9f6d2f624cb5e73e4b6f5a67d21dc9",
          name: "Inventory",
          requested: { capabilities: ["project.metadata"], agentInvocable: false },
          declaredTools: [],
          workerExecution: true,
          approvalFingerprint: "v1;project.metadata;agent=0",
          missing: ["project.metadata"],
          badge: { tone: "development", label: "Development", detail: "Approval required." },
          preflight: {
            ok: true,
            framework: "static",
            expectedRuntimeKind: "static",
            diagnostics: [],
          },
        },
      });
      return {
        scopeKey: buildWorkbenchScopeKey("project-1", "collab", "workspace-1"),
        tileId,
        created: true,
        focused: false,
      };
    });
    registerDevAppPreviewSurfaceController(
      buildWorkbenchScopeKey("project-1", "collab", "workspace-1"),
      { ensureSurface, focusSurface: vi.fn(() => true) },
    );

    const result = await __t3PreviewAutomationHostTestUtils.runRequest(
      request("devAppPreviewEnsure", { relativePath: "apps/inventory" }),
    );

    expect(ensureSurface).toHaveBeenCalledWith(
      expect.objectContaining({ relativePath: "apps/inventory", create: true, focus: false }),
    );
    expect(result).toMatchObject({
      phase: "needsApproval",
      relativePath: "apps/inventory",
      sourceId: "8a9f6d2f624cb5e73e4b6f5a67d21dc9",
      ready: false,
      requestedCapabilities: ["project.metadata"],
      surface: { available: false, tabId: null },
    });
  });

  it("attaches an existing approved DevApp preview to its living guest", async () => {
    const surface = createWorkbenchSurface("devAppPreview");
    const bridge = installBridge(surface);
    const owner = Symbol("preview-runtime");
    publishDevAppPreviewRuntime(owner, {
      tileId: surface.tileId,
      relativePath: "apps/inventory",
      hotReload: true,
      openError: null,
      status: {
        status: "running",
        sourceId: "8a9f6d2f624cb5e73e4b6f5a67d21dc9",
        name: "Inventory",
        view: {
          kind: "builtOutput",
          entryPath: "dist/index.html",
          url: "cozea-devapp://8a9f6d2f624cb5e73e4b6f5a67d21dc9.dev/dist/index.html",
        },
      grant: { capabilities: [], agentInvocable: false },
      declaredTools: [],
        badge: { tone: "development", label: "Development", detail: "Approved." },
        preflight: {
          ok: true,
          framework: "static",
          expectedRuntimeKind: "static",
          diagnostics: [],
        },
        worker: null,
        reloadToken: 0,
      },
    });
    const ensureSurface = vi.fn(async () => ({
      scopeKey: buildWorkbenchScopeKey("project-1", "collab", "workspace-1"),
      tileId: surface.tileId,
      created: false,
      focused: false,
    }));
    registerDevAppPreviewSurfaceController(
      buildWorkbenchScopeKey("project-1", "collab", "workspace-1"),
      { ensureSurface, focusSurface: vi.fn(() => true) },
    );

    const result = await __t3PreviewAutomationHostTestUtils.runRequest(
      request("devAppPreviewAttach", {}, surface.runtimeTabId),
    );

    expect(ensureSurface).toHaveBeenCalledWith(
      expect.objectContaining({
        preferredTileId: surface.tileId,
        relativePath: "apps/inventory",
        create: false,
      }),
    );
    expect(result).toMatchObject({
      phase: "running",
      ready: true,
      surface: { available: true, tabId: surface.runtimeTabId },
    });
    expect(bridge.automation.status).toHaveBeenCalledWith(surface.runtimeTabId);
  });

  it("discovers a newly created inactive Dev Server surface in the same request", async () => {
    const actions = useProjectWorkbenchStore.getState().actions;
    actions.ensureWorkbench("project-1", "collab", "workspace-1");
    actions.addTile("project-1", "collab", "assistantChat", { threadId: THREAD_ID }, "workspace-1");

    const placeholder = makeInventory("devServer", "pending-tile", "runtime-created-dev-server");
    const bridge = installBridge(placeholder);
    let createdSurface: BrowserSurfaceInventoryEntry | null = null;
    bridge.listSurfaces.mockImplementation(async () => (createdSurface ? [createdSurface] : []));
    surfaceControllerMocks.ensure.mockImplementation(async () => {
      const tileId = actions.addTile(
        "project-1",
        "collab",
        "devServer",
        { activate: false, agentManaged: true },
        "workspace-1",
      );
      createdSurface = { ...placeholder, tileId, active: false };
      return {
        tileId,
        scopeKey: "scope-created",
        leaseToken: "lease-created",
        created: true,
        focused: false,
      };
    });

    const result = await __t3PreviewAutomationHostTestUtils.runRequest(
      request("open", { open: false }),
      "environment-1",
    );

    expect(result).toMatchObject({
      available: true,
      tabId: "runtime-created-dev-server",
      surfaces: [
        {
          tabId: "runtime-created-dev-server",
          kind: "devServer",
          active: false,
        },
      ],
    });
    expect(surfaceControllerMocks.focus).not.toHaveBeenCalled();
  });

  it("serializes bounded manager failures without reviving the blackout error", () => {
    expect(
      __t3PreviewAutomationHostTestUtils.toResponseError(
        new Error("Preview automation click was interrupted by human input in tab runtime-1"),
      ),
    ).toMatchObject({ _tag: "PreviewAutomationControlInterruptedError" });
    expect(
      __t3PreviewAutomationHostTestUtils.toResponseError(
        new Error(
          "Preview evaluation result in tab runtime-1 was 900000 bytes; maximum is 524288 bytes",
        ),
      ),
    ).toMatchObject({ _tag: "PreviewAutomationResultTooLargeError" });
  });
});
