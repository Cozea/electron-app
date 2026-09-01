import { describe, expect, it, vi } from "vitest"

import { DevAppDevelopmentTrustStore } from "../../shared/devAppDevelopmentTrust"
import type { OrgDevAppPreflightReport } from "../../shared/orgDevAppDiagnostics"
import {
  DevAppPreviewSession,
  developmentWorkerKey,
  type DevAppPreviewFs,
} from "../../apps/desktop/electron/services/DevAppPreviewSession"
import type { DevAppWorkerState } from "../../apps/desktop/electron/services/DevAppWorkerHost"
import { DEV_APP_MANIFEST_VERSION } from "../../shared/devAppPackage"
import {
  DEV_APP_WORKER_PROTOCOL_VERSION,
  createDevAppWorkerViewPortBootstrap,
} from "../../shared/devAppWorkerProtocol"

const WORKSPACE = "/Users/admin/proj"
const SOURCE = "/Users/admin/proj/apps/inventory"
const SOURCE_ID = "b".repeat(32)

function phaseEightManifestFixture(candidate: unknown): unknown {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return candidate
  const record = candidate as Record<string, unknown>
  const worker = record.worker && typeof record.worker === "object" && !Array.isArray(record.worker)
    ? record.worker as Record<string, unknown>
    : null
  const service = record.service && typeof record.service === "object" && !Array.isArray(record.service)
    ? record.service as Record<string, unknown>
    : null
  const executable = Boolean(worker || service?.runtimeKind === "node")
  return {
    ...record,
    ...(record.manifestVersion === 1 ? { manifestVersion: DEV_APP_MANIFEST_VERSION } : {}),
    ...(worker
      ? { worker: { protocolVersion: DEV_APP_WORKER_PROTOCOL_VERSION, ...worker } }
      : {}),
    ...(executable && record.runtime === undefined
      ? { runtime: { location: "device", state: "device" } }
      : {}),
  }
}

const CLEAN_PREFLIGHT: OrgDevAppPreflightReport = {
  ok: true,
  framework: "vite-react",
  expectedRuntimeKind: "static",
  diagnostics: [],
}

const workerState = (publicationId: string): DevAppWorkerState => ({
  publicationId,
  protocolVersion: DEV_APP_WORKER_PROTOCOL_VERSION,
  status: "ready",
  restarts: 0,
  lastError: null,
  logs: [],
})

function approveCurrent(session: DevAppPreviewSession): ReturnType<DevAppPreviewSession["status"]> {
  const status = session.status(SOURCE_ID)
  return status?.status === "needsApproval"
    ? session.approve(SOURCE_ID, status.approvalFingerprint)
    : status
}

function makeFs(
  files: Record<string, string>,
  links: Record<string, string> = {},
): DevAppPreviewFs {
  return {
    readFile: (p) => files[p] ?? null,
    exists: (p) => p in files || p in links || p === SOURCE || p === WORKSPACE,
    realpath: (p) => links[p] ?? (p in files || p === SOURCE || p === WORKSPACE ? p : null),
  }
}

function makeSession(
  options: {
    manifest?: unknown
    files?: Record<string, string>
    links?: Record<string, string>
    preflight?: OrgDevAppPreflightReport
  } = {},
) {
  const manifestPath = `${SOURCE}/cozea-devapp.json`
  const files: Record<string, string> = {
    ...(options.manifest === undefined
      ? {
          [manifestPath]: JSON.stringify({
            manifestVersion: DEV_APP_MANIFEST_VERSION,
            name: "Inventory",
            view: { entry: "dist/index.html" },
          }),
        }
      : options.manifest === null
        ? {}
        : { [manifestPath]: JSON.stringify(phaseEightManifestFixture(options.manifest)) }),
    ...options.files,
  }

  const runningWorkers = new Map<string, DevAppWorkerState>()
  const worker = {
    start: vi.fn((input: { publicationId: string }) => {
      const state = workerState(input.publicationId)
      runningWorkers.set(input.publicationId, state)
      return state
    }),
    stop: vi.fn((publicationId: string) => runningWorkers.delete(publicationId)),
    release: vi.fn(),
    getState: vi.fn((publicationId: string) => runningWorkers.get(publicationId) ?? null),
    attachViewPort: vi.fn((_publicationId: string, connectionId: string, protocolVersion: number) =>
      createDevAppWorkerViewPortBootstrap(connectionId, protocolVersion),
    ),
    detachViewPort: vi.fn(),
  }
  const preflight = vi.fn(() => options.preflight ?? CLEAN_PREFLIGHT)
  const trust = new DevAppDevelopmentTrustStore(() => 1_000_000)

  const session = new DevAppPreviewSession({
    fs: makeFs(files, options.links),
    join: (...parts) => parts.join("/"),
    resolve: (value) => value,
    hashPath: () => SOURCE_ID,
    preflight,
    trust,
    worker,
  })

  const open = () =>
    session.open({
      sourcePath: SOURCE,
      workspaceId: "ws_1",
      workspaceRoot: WORKSPACE,
      leaseId: "tile_1",
    })

  return { session, worker, preflight, trust, open, files }
}

describe("Preview session — refuses what it should not load", () => {
  it("refuses a source outside the project", () => {
    const { session } = makeSession()
    const status = session.open({
      sourcePath: "/Users/admin/.ssh",
      workspaceId: "ws_1",
      workspaceRoot: WORKSPACE,
      leaseId: "tile_1",
    })
    expect(status.status).toBe("invalid")
  })

  it("refuses a sibling directory whose name merely starts with the project path", () => {
    const { session } = makeSession()
    const status = session.open({
      sourcePath: `${WORKSPACE}-secrets/app`,
      workspaceId: "ws_1",
      workspaceRoot: WORKSPACE,
      leaseId: "tile_1",
    })
    expect(status.status).toBe("invalid")
  })

  it("refuses a source symlink that resolves outside the project", () => {
    const { session } = makeSession({ links: { [SOURCE]: "/Users/admin/outside/inventory" } })
    const status = session.open({
      sourcePath: SOURCE,
      workspaceId: "ws_1",
      workspaceRoot: WORKSPACE,
      leaseId: "tile_1",
    })
    expect(status.status).toBe("invalid")
  })

  it("reports a missing manifest as a fixable diagnostic, not a crash", () => {
    const { open } = makeSession({ manifest: null })
    const status = open()
    expect(status).toMatchObject({ status: "invalid" })
    expect(status.status === "invalid" && status.diagnostics[0]?.code).toBe("manifest-missing")
  })

  it("passes the manifest parser's diagnostics straight through", () => {
    const { open } = makeSession({
      manifest: {
        manifestVersion: 1,
        name: "A",
        worker: { entry: "w.js", capabilities: ["nope"], tools: [] },
      },
    })
    const status = open()
    expect(status.status === "invalid" && status.diagnostics.map((d) => d.code)).toContain(
      "manifest-unknown-capability",
    )
  })
})

describe("Preview session — approval comes first", () => {
  const withWorker = {
    manifestVersion: 1,
    name: "Inventory",
    view: { entry: "dist/index.html" },
    worker: { entry: "worker.js", capabilities: ["project.read"], tools: [] },
  }

  it("does not start a worker before the user has approved", () => {
    const { open, worker } = makeSession({
      manifest: withWorker,
      files: { [`${SOURCE}/worker.js`]: "//", [`${SOURCE}/dist/index.html`]: "<html>" },
    })
    const status = open()
    expect(status.status).toBe("needsApproval")
    expect(status.status === "needsApproval" && status.missing).toEqual(["project.read"])
    expect(worker.start).not.toHaveBeenCalled()
  })

  it("requires approval to execute a worker even with no declared host capabilities", () => {
    const { open, session, worker } = makeSession({
      manifest: {
        manifestVersion: 1,
        name: "Inventory",
        view: { entry: "dist/index.html" },
        worker: { entry: "worker.js", capabilities: [], tools: [] },
      },
      files: { [`${SOURCE}/worker.js`]: "//", [`${SOURCE}/dist/index.html`]: "<html>" },
    })
    const status = open()
    expect(status.status).toBe("needsApproval")
    expect(status.status === "needsApproval" && status.workerExecution).toBe(true)
    expect(worker.start).not.toHaveBeenCalled()
    expect(approveCurrent(session)?.status).toBe("running")
    expect(worker.start).toHaveBeenCalled()
  })

  it("starts the worker once approved, bound to the workspace", () => {
    const { open, session, worker } = makeSession({
      manifest: withWorker,
      files: { [`${SOURCE}/worker.js`]: "//", [`${SOURCE}/dist/index.html`]: "<html>" },
    })
    open()
    const status = approveCurrent(session)
    expect(status?.status).toBe("running")
    expect(worker.start).toHaveBeenCalledWith(
      expect.objectContaining({
        entrypoint: `${SOURCE}/worker.js`,
        packageRoot: SOURCE,
        protocolVersion: DEV_APP_WORKER_PROTOCOL_VERSION,
        grant: { capabilities: ["project.read"], agentInvocable: false },
        authorizationExpiresAt: 44_200_000,
        binding: { workspaceId: "ws_1", workspaceRoot: WORKSPACE },
      }),
    )
  })

  it("namespaces the worker key so it cannot address a published worker", () => {
    const { open, session, worker } = makeSession({
      manifest: withWorker,
      files: { [`${SOURCE}/worker.js`]: "//", [`${SOURCE}/dist/index.html`]: "<html>" },
    })
    open()
    approveCurrent(session)
    expect(worker.start.mock.calls[0]![0].publicationId).toBe(`dev:${SOURCE_ID}`)
    expect(developmentWorkerKey(SOURCE_ID)).toBe(`dev:${SOURCE_ID}`)
  })

  it("binds a view port to only the approved worker for that source", () => {
    const { open, session, worker } = makeSession({
      manifest: withWorker,
      files: { [`${SOURCE}/worker.js`]: "//", [`${SOURCE}/dist/index.html`]: "<html>" },
    })
    open()
    expect(() => session.attachViewPort(SOURCE_ID, "view_1", {})).toThrow(/no available worker/)
    approveCurrent(session)

    const bootstrap = session.attachViewPort(SOURCE_ID, "view_1", {})
    expect(bootstrap).toMatchObject({
      kind: "cozea-devapp-view-port",
      connectionId: "view_1",
      protocolVersion: DEV_APP_WORKER_PROTOCOL_VERSION,
    })
    expect(worker.attachViewPort).toHaveBeenCalledWith(
      `dev:${SOURCE_ID}`,
      "view_1",
      DEV_APP_WORKER_PROTOCOL_VERSION,
      {},
    )
    session.detachViewPort(SOURCE_ID, "view_1")
    expect(worker.detachViewPort).toHaveBeenCalledWith(`dev:${SOURCE_ID}`, "view_1")
  })

  it("runs a view-only package with no worker at all", () => {
    const { open, session, worker } = makeSession({
      files: { [`${SOURCE}/dist/index.html`]: "<html>" },
    })
    open()
    const status = approveCurrent(session)
    expect(status?.status).toBe("running")
    expect(status?.status === "running" && status.worker).toBeNull()
    expect(worker.start).not.toHaveBeenCalled()
    expect(() => session.attachViewPort(SOURCE_ID, "view_1", {})).toThrow(/no available worker/)
  })
})

describe("Preview session — hot reload cannot widen a grant", () => {
  const manifestPath = `${SOURCE}/cozea-devapp.json`
  const narrow = {
    manifestVersion: 1,
    name: "Inventory",
    view: { entry: "dist/index.html" },
    worker: { entry: "worker.js", capabilities: ["project.read"], tools: [] },
  }

  function running() {
    const files: Record<string, string> = {
      [manifestPath]: JSON.stringify(phaseEightManifestFixture(narrow)),
      [`${SOURCE}/worker.js`]: "//",
      [`${SOURCE}/dist/index.html`]: "<html>",
    }
    const runningWorkers = new Map<string, DevAppWorkerState>()
    const worker = {
      start: vi.fn((input: { publicationId: string }) => {
        const state = workerState(input.publicationId)
        runningWorkers.set(input.publicationId, state)
        return state
      }),
      stop: vi.fn((publicationId: string) => runningWorkers.delete(publicationId)),
      release: vi.fn(),
      getState: vi.fn((publicationId: string) => runningWorkers.get(publicationId) ?? null),
      attachViewPort: vi.fn(
        (_publicationId: string, connectionId: string, protocolVersion: number) =>
          createDevAppWorkerViewPortBootstrap(connectionId, protocolVersion),
      ),
      detachViewPort: vi.fn(),
    }
    const session = new DevAppPreviewSession({
      fs: {
        readFile: (p) => files[p] ?? null,
        exists: (p) => p in files || p === SOURCE || p === WORKSPACE,
        realpath: (p) => (p in files || p === SOURCE || p === WORKSPACE ? p : null),
      },
      join: (...parts) => parts.join("/"),
      resolve: (value) => value,
      hashPath: () => SOURCE_ID,
      preflight: () => CLEAN_PREFLIGHT,
      trust: new DevAppDevelopmentTrustStore(() => 1_000_000),
      worker,
    })
    session.open({
      sourcePath: SOURCE,
      workspaceId: "ws_1",
      workspaceRoot: WORKSPACE,
      leaseId: "tile_1",
    })
    approveCurrent(session)
    return { session, worker, files }
  }

  it("stops the worker and asks again when the manifest asks for more", () => {
    // Without this, editing a file on disk would be a way to gain capabilities the user
    // was never shown.
    const { session, worker, files } = running()
    files[manifestPath] = JSON.stringify(phaseEightManifestFixture({
      ...narrow,
      worker: { entry: "worker.js", capabilities: ["project.read", "process.spawn"], tools: [] },
    }))
    const status = session.reload(SOURCE_ID)
    expect(status?.status).toBe("needsApproval")
    expect(status?.status === "needsApproval" && status.missing).toEqual(["process.spawn"])
    expect(worker.stop).toHaveBeenCalledWith(`dev:${SOURCE_ID}`)
  })

  it("does not approve a changed manifest using a stale prompt", () => {
    const { session, worker, files } = running()
    const shown = session.status(SOURCE_ID)
    expect(shown?.status).toBe("running")
    files[manifestPath] = JSON.stringify(phaseEightManifestFixture({
      ...narrow,
      worker: { entry: "worker.js", capabilities: ["project.read", "process.spawn"], tools: [] },
    }))
    const widened = session.reload(SOURCE_ID)
    expect(widened?.status).toBe("needsApproval")
    const startsBeforeStaleApproval = worker.start.mock.calls.length
    const staleFingerprint = "v1;project.read;agent=0"
    const result = session.approve(SOURCE_ID, staleFingerprint)
    expect(result?.status).toBe("needsApproval")
    expect(worker.start).toHaveBeenCalledTimes(startsBeforeStaleApproval)
  })

  it("keeps running when the manifest narrows, with the narrowed grant", () => {
    const { session, files } = running()
    files[manifestPath] = JSON.stringify(phaseEightManifestFixture({
      ...narrow,
      worker: { entry: "worker.js", capabilities: [], tools: [] },
    }))
    const status = session.reload(SOURCE_ID)
    expect(status?.status).toBe("running")
    expect(status?.status === "running" && status.grant.capabilities).toEqual([])
  })

  it("does not restart the worker for an ordinary reload", () => {
    // The host joins an already-running worker, so a view reload must not kill in-flight
    // worker work.
    const { session, worker } = running()
    session.reload(SOURCE_ID)
    expect(worker.stop).not.toHaveBeenCalled()
  })

  it("advances a reload token the view can key off", () => {
    const { session } = running()
    const before = session.status(SOURCE_ID)
    const after = session.reload(SOURCE_ID)
    expect(before?.status === "running" && before.reloadToken).toBe(0)
    expect(after?.status === "running" && after.reloadToken).toBe(1)
  })

  it("stops the worker when the manifest is deleted mid-session", () => {
    const { session, worker, files } = running()
    delete files[manifestPath]
    expect(session.reload(SOURCE_ID)?.status).toBe("invalid")
    expect(worker.stop).toHaveBeenCalledWith(`dev:${SOURCE_ID}`)
  })

  it("stops the worker when the manifest becomes unparsable", () => {
    const { session, worker, files } = running()
    files[manifestPath] = "{ broken"
    expect(session.reload(SOURCE_ID)?.status).toBe("invalid")
    expect(worker.stop).toHaveBeenCalled()
  })

  it("stops the worker when the manifest targets an unsupported protocol", () => {
    const { session, worker, files } = running()
    files[manifestPath] = JSON.stringify(phaseEightManifestFixture({
      ...narrow,
      worker: {
        ...narrow.worker,
        protocolVersion: DEV_APP_WORKER_PROTOCOL_VERSION + 1,
      },
    }))
    const status = session.reload(SOURCE_ID)
    expect(status?.status).toBe("invalid")
    expect(
      status?.status === "invalid" && status.diagnostics.map((diagnostic) => diagnostic.code),
    ).toContain("worker-protocol-version-unsupported")
    expect(worker.stop).toHaveBeenCalledWith(`dev:${SOURCE_ID}`)
  })

  it("returns null for a source that was never opened", () => {
    const { session } = running()
    expect(session.reload("src_other")).toBeNull()
    expect(session.status("src_other")).toBeNull()
  })
})

describe("Preview session — where the view comes from", () => {
  const approved = (manifest: unknown, files: Record<string, string> = {}, links = {}) => {
    const made = makeSession({ manifest, files, links })
    made.open()
    return approveCurrent(made.session)
  }

  it("prefers a declared dev server, so hot reload is available", () => {
    const status = approved(
      {
        manifestVersion: 1,
        name: "A",
        view: { entry: "dist/index.html", dev: { url: "http://localhost:5173" } },
      },
      { [`${SOURCE}/dist/index.html`]: "<html>" },
    )
    expect(status?.status === "running" && status.view).toEqual({
      kind: "devServer",
      url: "http://localhost:5173",
    })
  })

  it("falls back to the built output publishing would pack", () => {
    const status = approved(
      {
        manifestVersion: 1,
        name: "A",
        view: { entry: "dist/index.html" },
      },
      { [`${SOURCE}/dist/index.html`]: "<html>" },
    )
    expect(status?.status === "running" && status.view).toEqual({
      kind: "builtOutput",
      entryPath: "dist/index.html",
      url: `cozea-devapp://${SOURCE_ID}.dev/dist/index.html`,
    })
  })

  it("says what to do when there is neither", () => {
    const status = approved({
      manifestVersion: 1,
      name: "A",
      view: { entry: "dist/index.html", dev: { command: "bun run dev" } },
    })
    expect(status?.status === "running" && status.view).toMatchObject({
      kind: "unavailable",
      fix: expect.stringContaining("bun run dev"),
    })
  })

  it("refuses a view entry that symlinks out of the package", () => {
    // The manifest parser cannot see the filesystem: `dist/index.html` is a textually
    // clean path even when it is a link to /etc/passwd.
    const status = approved(
      { manifestVersion: 1, name: "A", view: { entry: "dist/index.html" } },
      { [`${SOURCE}/dist/index.html`]: "<html>" },
      { [`${SOURCE}/dist/index.html`]: "/etc/passwd" },
    )
    expect(status?.status === "running" && status.view.kind).toBe("unavailable")
  })

  it("refuses a worker entry that symlinks out of the package", () => {
    const made = makeSession({
      manifest: {
        manifestVersion: 1,
        name: "A",
        view: { entry: "dist/index.html" },
        worker: { entry: "worker.js", capabilities: [], tools: [] },
      },
      files: { [`${SOURCE}/worker.js`]: "//", [`${SOURCE}/dist/index.html`]: "<html>" },
      links: { [`${SOURCE}/worker.js`]: "/usr/local/bin/anything" },
    })
    made.open()
    const status = approveCurrent(made.session)
    expect(status?.status === "running" && status.worker).toBeNull()
    expect(made.worker.start).not.toHaveBeenCalled()
  })
})

describe("Preview session — preflight runs the whole time", () => {
  it("reports preflight before approval, so a broken project says so early", () => {
    const failing: OrgDevAppPreflightReport = {
      ok: false,
      framework: "next",
      expectedRuntimeKind: "service",
      diagnostics: [
        {
          code: "next-missing-standalone",
          severity: "blocker",
          message: "next.config needs output: 'standalone'.",
        },
      ],
    }
    const { open } = makeSession({
      manifest: {
        manifestVersion: 1,
        name: "A",
        view: { entry: "dist/index.html" },
        worker: { entry: "w.js", capabilities: ["project.read"], tools: [] },
      },
      preflight: failing,
    })
    const status = open()
    expect(status.status).toBe("needsApproval")
    expect(status.status === "needsApproval" && status.preflight.diagnostics[0]?.code).toBe(
      "next-missing-standalone",
    )
  })

  it("re-runs preflight on every reload rather than caching a stale verdict", () => {
    const { open, session, preflight } = makeSession({
      files: { [`${SOURCE}/dist/index.html`]: "<html>" },
    })
    open()
    approveCurrent(session)
    const before = preflight.mock.calls.length
    session.reload(SOURCE_ID)
    expect(preflight.mock.calls.length).toBeGreaterThan(before)
  })
})

describe("Preview session — closing", () => {
  it("releases the lease rather than killing a worker another lease holds", () => {
    const { open, session, worker } = makeSession({
      manifest: {
        manifestVersion: 1,
        name: "A",
        view: { entry: "dist/index.html" },
        worker: { entry: "worker.js", capabilities: [], tools: [] },
      },
      files: { [`${SOURCE}/worker.js`]: "//", [`${SOURCE}/dist/index.html`]: "<html>" },
    })
    open()
    approveCurrent(session)
    session.close(SOURCE_ID)
    expect(worker.release).toHaveBeenCalledWith(`dev:${SOURCE_ID}`, "tile_1")
    expect(session.status(SOURCE_ID)).toBeNull()
  })

  it("is a no-op for a source that was never opened", () => {
    const { session } = makeSession()
    expect(() => session.close("src_other")).not.toThrow()
  })

  it("keeps a shared preview alive until its last surface lease closes", () => {
    const made = makeSession({
      manifest: {
        manifestVersion: 1,
        name: "A",
        view: { entry: "dist/index.html" },
        worker: { entry: "worker.js", capabilities: [], tools: [] },
      },
      files: { [`${SOURCE}/worker.js`]: "//", [`${SOURCE}/dist/index.html`]: "<html>" },
    })
    made.open()
    approveCurrent(made.session)
    made.session.open({
      sourcePath: SOURCE,
      workspaceId: "ws_1",
      workspaceRoot: WORKSPACE,
      leaseId: "tile_2",
    })

    expect(made.session.close(SOURCE_ID, "tile_1")).toBe(false)
    expect(made.session.status(SOURCE_ID)?.status).toBe("running")
    expect(made.worker.release).toHaveBeenCalledWith(`dev:${SOURCE_ID}`, "tile_1")
    expect(made.session.close(SOURCE_ID, "tile_2")).toBe(true)
    expect(made.worker.release).toHaveBeenCalledWith(`dev:${SOURCE_ID}`, "tile_2")
    expect(made.session.status(SOURCE_ID)).toBeNull()
  })
})
