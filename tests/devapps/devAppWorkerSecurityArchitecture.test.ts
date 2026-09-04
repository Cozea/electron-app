import fs from "node:fs"
import path from "node:path"

import { describe, expect, it } from "vitest"

const ROOT = path.resolve(import.meta.dirname, "../..")
const read = (relativePath: string) => fs.readFileSync(path.join(ROOT, relativePath), "utf8")

describe("DevApp worker security architecture", () => {
  it("keeps development and published worker execution on separate runtime boundaries", () => {
    const artifactService = read("apps/desktop/electron/services/OrgDevAppArtifactService.ts")
    const main = read("apps/desktop/electron/main.ts")
    expect(artifactService).not.toContain("DevAppWorkerHost")
    expect(artifactService).not.toContain("devAppWorkerHost")
    expect(main.match(/worker: devAppWorkerHost/g)).toHaveLength(1)
  })

  it("makes hosted execution deny-by-default with no device fallback", () => {
    const sandbox = read("cloudflare/worker/src/durableObjects/CozeaDevAppSandbox.ts")
    const hostedRoute = read("cloudflare/worker/src/routes/devAppHostedRuntimes.ts")
    const published = read("apps/desktop/electron/services/PublishedDevAppRuntimeService.ts")
    expect(sandbox).toContain("enableInternet = false")
    expect(sandbox).toContain("acquireHostedRuntimeLease")
    expect(sandbox).toContain("releaseHostedRuntimeLease")
    expect(hostedRoute).toContain("--cap-drop ALL")
    expect(hostedRoute).toContain("--security-opt no-new-privileges")
    expect(hostedRoute).toContain("setAllowedHosts(network ?")
    expect(hostedRoute).toContain("claimHostedRuntimeStart")
    expect(hostedRoute).toContain("clearHostedRuntime")
    expect(hostedRoute).toContain("`organization:${request.identity.organizationId}:${request.identity.publicationId}`")
    expect(hostedRoute).not.toContain(
      "`organization:${request.identity.organizationId}:${request.identity.publicationId}:${request.identity.releaseId}`",
    )
    expect(hostedRoute).toContain("keepAlive: false")
    expect(hostedRoute).toContain("ghcr\\.io\\/cozea\\/devapps")
    expect(hostedRoute).toContain("serviceUrl: request.servicePort ? transport.url : null")
    expect(hostedRoute).not.toContain("target.exposePort(request.servicePort")
    const runtimeTransport = read("packages/devapp-runtime/src/index.ts")
    expect(runtimeTransport).toContain("x-cozea-hosted-service-token")
    expect(runtimeTransport).toContain("proxyServiceRequest")
    expect(hostedRoute).toMatch(/name\.startsWith\(["']COZEA_["']\)/)
    expect(hostedRoute.indexOf("...request.environment")).toBeLessThan(
      hostedRoute.indexOf("COZEA_DEVAPP_PUBLICATION_ID"),
    )
    expect(published).toContain("Hosted DevApps cannot mount or browse folders from this device")
    expect(published).not.toContain('placement.location !== "device"')
  })

  it("creates each device container exactly once before starting it", () => {
    const helper = read("native/devapp-container-runtime/Sources/CozeaDevAppContainerRuntime/CozeaDevAppContainerRuntime.swift")
    expect(helper.match(/try await container\.create\(\)/g)).toHaveLength(1)
    expect(helper).toContain("try await container.start()")
  })

  it("keeps publisher-host service bytes out of the contained execution path", () => {
    const artifact = read("apps/desktop/electron/services/OrgDevAppArtifactService.ts")
    const diagnostics = read("shared/orgDevAppDiagnostics.ts")
    expect(artifact).toContain("Executable bytes come")
    expect(artifact).not.toContain("assertPortableServiceTree")
    expect(artifact).not.toContain("scanOutputTree")
    expect(artifact).not.toMatch(/fs\.cpSync\((?:standalone|sourceRoot)/)
    expect(diagnostics).not.toContain("native-runtime-dependency")
    expect(diagnostics).not.toContain("native-code-in-output")
  })

  it("keeps device bearer-token routing out of renderer-selected IPC", () => {
    const preload = read("apps/desktop/electron/preload.ts")
    const api = read("shared/electronApiTypes.ts")
    const handlers = read("apps/desktop/electron/ipc/registerOrgDevAppHandlers.ts")
    expect(preload).not.toContain("gatewayBaseUrl")
    expect(api).not.toContain("gatewayBaseUrl")
    expect(handlers).toContain("getTrustedDeviceGatewayBaseUrl()")
  })

  it("revokes worker authority by terminating the shared contained runtime", () => {
    const handlers = read("apps/desktop/electron/ipc/registerOrgDevAppHandlers.ts")
    const published = read("apps/desktop/electron/services/PublishedDevAppRuntimeService.ts")
    const tile = read("apps/desktop/src/features/workbench/WorkbenchOrgDevAppTile.tsx")
    expect(handlers).toMatch(/"orgDevApp:revokePublishedWorker",\s+async/)
    expect(handlers).toContain("await service.stopRuntime(")
    expect(handlers).toContain("await publishedRuntime.stopFor(options.ref, options.workspaceId)")
    expect(published).not.toContain("stopWorkerFor(")
    expect(tile).toMatch(/if \(runtimeStopped\) return;?/)
    expect(tile).toMatch(/setRuntimeStopped\(true\);?/)
  })

  it("keeps the runtime signing key out of untrusted build steps", () => {
    const workflow = read(".github/workflows/devapp-runtime-image.yml")
    const jobEnvironment = workflow.slice(0, workflow.indexOf("    steps:"))
    expect(jobEnvironment).not.toContain("COZEA_RUNTIME_SIGNING_PRIVATE_KEY")
    expect(workflow).toContain("COZEA_RUNTIME_SIGNING_PRIVATE_KEY: ${{ secrets.COZEA_RUNTIME_SIGNING_PRIVATE_KEY }}")
    expect(workflow.indexOf("COZEA_RUNTIME_SIGNING_PRIVATE_KEY:")).toBeGreaterThan(
      workflow.indexOf("- name: Assemble and sign exact multi-platform release"),
    )
  })

  it("does not inherit the parent environment into a development worker", () => {
    const adapter = read("apps/desktop/electron/services/devAppUtilityProcess.ts")
    expect(adapter).toContain('"--permission"')
    expect(adapter).toContain("--allow-fs-read=")
    expect(adapter).toContain("--allow-fs-write=")
    expect(adapter).not.toContain("...process.env")
    expect(adapter).not.toMatch(/\bHOME\s*:/)
    expect(adapter).not.toMatch(/\bPATH\s*:/)
  })

  it("requires explicit approval for every development worker", () => {
    const session = read("apps/desktop/electron/services/DevAppPreviewSession.ts")
    expect(session).toContain("requireExplicitApproval: workerExecution")
    expect(session).toContain("workerExecution ? trust.expiresAt : null")
  })
})
