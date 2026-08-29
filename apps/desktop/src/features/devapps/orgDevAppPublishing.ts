import type { Id } from "../../../../../convex/_generated/dataModel"
import { api } from "../../../../../convex/_generated/api"
import type { ConvexReactClient } from "convex/react"

export type OrgDevAppPublishStage =
  | "building"
  | "uploading"
  | "verifying"
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
  input.signal?.addEventListener("abort", cancelBuild, { once: true })
  const packed = await window.electronAPI.orgDevApp.buildAndPack({
    workspaceId: input.workspaceId,
    operationId,
  }).finally(() => {
    input.signal?.removeEventListener("abort", cancelBuild)
  })
  if (!packed.success) {
    if (input.signal?.aborted) throw new DOMException("Publishing was cancelled.", "AbortError")
    throw new Error(packed.error)
  }

  if (input.signal?.aborted) throw new DOMException("Publishing was cancelled.", "AbortError")
  const reservation = await input.convex.mutation(api.devApps.createUploadReservation, {
    projectId: input.projectId,
  })
  try {
    input.onStageChange?.("uploading")
    const zipBytes = packed.zip instanceof Uint8Array ? packed.zip : new Uint8Array(packed.zip)
    const uploadResponse = await fetch(reservation.uploadUrl, {
      method: "POST",
      headers: { "Content-Type": "application/zip" },
      body: zipBytes as unknown as BodyInit,
      signal: input.signal,
    })
    if (!uploadResponse.ok) {
      throw new Error("Cozea could not upload the built DevApp artifact.")
    }
    const uploaded = (await uploadResponse.json()) as { storageId?: string }
    if (!uploaded.storageId) {
      throw new Error("Cozea did not receive a storage id for the DevApp artifact.")
    }

    input.onStageChange?.("verifying")
    const registered = await input.convex.mutation(api.devApps.registerUploadedArtifact, {
      reservationId: reservation.reservationId,
      storageId: uploaded.storageId as Id<"_storage">,
      contentHash: packed.contentHash,
    })
    if (!registered.registered) {
      throw new Error(registered.error)
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
    })
    input.onStageChange?.("complete")
  } catch (error) {
    await input.convex.mutation(api.devApps.abandonUploadReservation, {
      reservationId: reservation.reservationId,
    }).catch(() => undefined)
    throw error
  }
}
