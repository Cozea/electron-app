import { renderToStaticMarkup } from "react-dom/server"
import { ConvexReactClient } from "convex/react"
import { getFunctionName } from "convex/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { AuthContext, type AuthContextType } from "@/contexts/AuthContext"
import { CloudClientContext } from "@/lib/cloudQueries"
import { useProjectRouteData } from "@/contexts/project/useProjectRouteData"
import { useQueryCache } from "@/app/model/queryCache"
import type { Doc, Id } from "../../convex/_generated/dataModel"
import type { LocalProjectDTO, LocalProjectId } from "../../shared/localProjectTypes"
import type { WorkspaceCatalogSnapshot } from "../../shared/workspaceTypes"

const catalog = vi.hoisted(() => ({ snapshot: null as WorkspaceCatalogSnapshot | null }))
vi.mock("@/features/workspace/useWorkspaceCatalogSnapshot", () => ({
  useWorkspaceCatalogSnapshot: (enabled = true) => enabled ? catalog.snapshot : null,
}))
// SSR Zustand reads its module-initial snapshot. Supply the current fixture cache
// explicitly; ordinary cache subscription/hydration has its own behavioral suite.
vi.mock("@/app/model/queryCache", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/app/model/queryCache")>()
  return { ...actual, useCachedQuery: <T,>(key: string, fresh: T | undefined) =>
    fresh === undefined ? actual.useQueryCache.getState().get<T>(key) : fresh }
})

const localId = ("lpj_" + "a".repeat(32)) as LocalProjectId
const cloudId = "project_shared" as Id<"projects">
const entry: LocalProjectDTO = { projectId: localId, name: "Personal", localName: "Personal", fallbackName: "Personal",
  slug: "personal", hidden: false, status: "active", cloudProjectId: null, sharedName: null,
  sharedStatus: null, sharedIdentityKey: null, sharedObservedAt: null, createdAt: 1, updatedAt: 1 }
const auth: AuthContextType = {
  user: null, principalId: "principal" as Id<"devicePrincipals">, preferences: null, accessToken: null, personalWorkspace: null,
  localDevice: { identityKey: "czd_00000000000000000000000000", platform: "darwin", displayName: "Local",
    avatarUrl: null, presentationConfigured: true, updatedAt: 1 },
  isLocalDeviceReady: true, localDeviceError: null, retryLocalDevice: async () => {}, updateLocalDevice: async () => {},
  isAuthenticated: false, isConvexAuthReady: true, isLoading: false, isRevalidating: false, authError: null,
  needsOnboarding: false, retryDeviceSession: async () => {}, refreshToken: async () => "retryable",
}

beforeEach(() => {
  catalog.snapshot = { revision: 1, generatedAt: 1, entries: {}, projects: { [localId]: entry } }
  useQueryCache.getState().clear()
})
afterEach(() => vi.unstubAllGlobals())

function render(client: ConvexReactClient | null, projectId: string | null, check: (data: ReturnType<typeof useProjectRouteData>) => void, ready = true, slug?: string) {
  function Screen() {
    const data = useProjectRouteData(projectId, slug)
    check(data)
    return <p>{data.projectName}</p>
  }
  return renderToStaticMarkup(<CloudClientContext value={client}><AuthContext value={{ ...auth, isConvexAuthReady: ready }}><Screen /></AuthContext></CloudClientContext>)
}

describe("local project route cloud boundary", () => {
  it("opens a local project with a genuine configured client and creates zero cloud watches", async () => {
    const socket = vi.fn(() => { throw new Error("Unexpected connection") })
    vi.stubGlobal("WebSocket", socket)
    const client = new ConvexReactClient("http://127.0.0.1:3210")
    const watch = vi.spyOn(client, "watchQuery")
    useQueryCache.getState().set(`layout-project-${localId}`, { _id: cloudId, name: "Stale cloud project" })
    expect(render(client, localId, (data) => {
      expect(data.executionProjectId).toBe(localId)
      expect(data.cloudProjectId).toBeNull()
      expect(data.project).toBeNull()
    })).toContain("Personal")
    expect(watch).not.toHaveBeenCalled()
    expect(socket).not.toHaveBeenCalled()
    await client.close()
  })

  it("queries only the associated genuine ID and retains the local execution owner", async () => {
    catalog.snapshot!.projects![localId] = { ...entry, cloudProjectId: cloudId }
    const client = new ConvexReactClient("http://127.0.0.1:3210")
    const watch = vi.spyOn(client, "watchQuery")
    render(client, cloudId, (data) => {
      expect(data.localProjectId).toBe(localId)
      expect(data.executionProjectId).toBe(localId)
    })
    expect(watch).toHaveBeenCalledOnce()
    expect(getFunctionName(watch.mock.calls[0][0])).toBe("projects:getAccessibleById")
    expect(watch.mock.calls[0][1]).toEqual({ projectId: cloudId })
    await client.close()
  })

  it("does not subscribe without verified cloud readiness or local catalog discovery", async () => {
    catalog.snapshot!.projects![localId] = { ...entry, cloudProjectId: cloudId }
    const client = new ConvexReactClient("http://127.0.0.1:3210")
    const watch = vi.spyOn(client, "watchQuery")
    render(client, localId, (data) => expect(data.executionProjectId).toBe(localId), false)
    catalog.snapshot = null
    render(client, "unknown-legacy-route", () => {})
    expect(watch).not.toHaveBeenCalled()
    await client.close()
  })

  it("never derives a cloud association from an unknown local route's cached document", () => {
    catalog.snapshot!.projects = {}
    useQueryCache.getState().set(`layout-project-${localId}`, { _id: cloudId, name: "Unrelated", slug: "personal" })
    render(null, localId, (data) => {
      expect(data.cloudProjectId).toBeNull()
      expect(data.project).toBeNull()
      expect(data.executionProjectId).toBeNull()
    })
  })

  it("uses fresh associated metadata even when entering through a local slug", async () => {
    catalog.snapshot!.projects![localId] = { ...entry, cloudProjectId: cloudId }
    const shared: Doc<"projects"> = { _id: cloudId, _creationTime: 1, name: "Shared name", slug: "shared-slug",
      creationPath: "fresh", status: "active", createdBy: auth.principalId!, createdAt: 1, updatedAt: 1 }
    const client = new ConvexReactClient("http://127.0.0.1:3210")
    const sdkWatch = client.watchQuery.bind(client)
    const watch = vi.spyOn(client, "watchQuery").mockImplementation((...args) => {
      const result = sdkWatch(args[0], args[1] ?? {}, args[2])
      vi.spyOn(result, "localQueryResult").mockReturnValue(shared)
      return result
    })
    render(client, null, (data) => {
      expect(data.project).toBe(shared)
      expect(data.projectName).toBe("Personal")
      expect(data.projectSlug).toBe("personal")
      expect(data.executionProjectId).toBe(localId)
    }, true, "personal")
    expect(watch).toHaveBeenCalledOnce()
    expect(getFunctionName(watch.mock.calls[0][0])).toBe("projects:getAccessibleById")
    await client.close()
  })
})
