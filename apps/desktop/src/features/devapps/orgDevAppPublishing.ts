import type { Id } from "../../../../../convex/_generated/dataModel"
import { api } from "../../../../../convex/_generated/api"
import type { ConvexReactClient } from "convex/react"
import { getDeviceGatewayBaseUrl, getDeviceSession } from "@/lib/deviceSession"

export type OrgDevAppPublishStage =
  | "building"
  | "uploading"
  | "verifying"
  | "runtimeBuild"
  | "publishing"
  | "complete"

export async function publishOrgDevAppFromWorkspace(input: {
  convex: ConvexReactClient
  projectId: Id<"projects">
  workspaceId: string
  name: string
  logoDataUrl?: string
  description?: string
  signal?: AbortSignal
  onStageChange?: (stage: OrgDevAppPublishStage) => void
}): Promise<void> {
  input.onStageChange?.("building")
  if (input.signal?.aborted) throw new DOMException("Publishing was cancelled.", "AbortError")
  const operationId = crypto.randomUUID()
  const cancelBuild = () => {
    void window.electronAPI.orgDevApp.cancelBuild({ operationId })
  }
  const reservation = await input.convex.mutation(api.devApps.createUploadReservation, {
    projectId: input.projectId,
  })
  input.signal?.addEventListener("abort", cancelBuild, { once: true })
  try {
    if (input.signal?.aborted) throw new DOMException("Publishing was cancelled.", "AbortError")
    input.onStageChange?.("uploading")
    const packed = await window.electronAPI.orgDevApp.buildAndUpload({
      workspaceId: input.workspaceId,
      operationId,
      uploadUrl: reservation.uploadUrl,
    })
    if (!packed.success) {
      if (input.signal?.aborted) throw new DOMException("Publishing was cancelled.", "AbortError")
      throw new Error(packed.error)
    }

    input.onStageChange?.("verifying")
    const registered = await input.convex.mutation(api.devApps.registerUploadedArtifact, {
      reservationId: reservation.reservationId,
      storageId: packed.storageId as Id<"_storage">,
      contentHash: packed.contentHash,
      runtimeKind: packed.runtimeKind,
    })
    if (!registered.registered) {
      throw new Error(registered.error)
    }

    const inspection = await window.electronAPI.devAppAuthoring.inspectWorkspace({
      workspaceId: input.workspaceId,
    })
    const authoredExecutable =
      inspection.success &&
      inspection.inspection.status === "valid" &&
      Boolean(
        inspection.inspection.source.manifest.worker ||
          inspection.inspection.source.manifest.service?.runtimeKind === "node",
      )
    if (packed.runtimeKind === "service" || authoredExecutable) {
      input.onStageChange?.("runtimeBuild")
      const session = await getDeviceSession()
      const gatewayBaseUrl = getDeviceGatewayBaseUrl()
      const started = await window.electronAPI.orgDevApp.startRuntimeBuild({
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        uploadReservationId: reservation.reservationId,
        gatewayBaseUrl,
        accessToken: session.accessToken,
      })
      if (!started.success) throw new Error(started.error)
      let build = started.build
      while (build.status === "queued" || build.status === "building") {
        if (input.signal?.aborted) {
          throw new DOMException("Publishing was cancelled.", "AbortError")
        }
        if (Date.now() >= reservation.expiresAt - 15_000) {
          throw new Error("The contained DevApp build did not finish before its upload expired.")
        }
        await new Promise<void>((resolve) => setTimeout(resolve, 2_000))
        const current = await window.electronAPI.orgDevApp.getRuntimeBuild({
          buildId: build.buildId,
          gatewayBaseUrl,
          accessToken: session.accessToken,
        })
        if (!current.success) throw new Error(current.error)
        build = current.build
      }
      if (build.status !== "ready") {
        throw new Error(build.error ?? "The contained DevApp build failed.")
      }
    }

    input.onStageChange?.("publishing")
    await input.convex.mutation(api.devApps.publish, {
      projectId: input.projectId,
      name: input.name,
      ...(input.description ? { description: input.description } : {}),
      ...(input.logoDataUrl ? { logoDataUrl: input.logoDataUrl } : {}),
      framework: packed.framework,
      uploadReservationId: reservation.reservationId,
      entryPath: packed.entryPath,
      runtimeKind: packed.runtimeKind,
      ...(packed.manifestVersion ? { manifestVersion: packed.manifestVersion } : {}),
      ...(packed.platform ? { platform: packed.platform } : {}),
      ...(packed.arch ? { arch: packed.arch } : {}),
      ...(packed.permissionSetHash ? { permissionSetHash: packed.permissionSetHash } : {}),
    })
    input.onStageChange?.("complete")
  } catch (error) {
    await input.convex.mutation(api.devApps.abandonUploadReservation, {
      reservationId: reservation.reservationId,
    }).catch(() => undefined)
    throw error
  } finally {
    input.signal?.removeEventListener("abort", cancelBuild)
  }
}
