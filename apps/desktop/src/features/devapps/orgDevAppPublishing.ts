import type { Id } from "../../../../../convex/_generated/dataModel"
import { api } from "../../../../../convex/_generated/api"
import type { ConvexReactClient } from "convex/react"

export async function publishOrgDevAppFromWorkspace(input: {
  convex: ConvexReactClient
  userId: Id<"users">
  projectId: Id<"projects">
  organizationId: Id<"organizations">
  workspaceId: string
  name: string
  logoDataUrl?: string
  description?: string
}): Promise<void> {
  const packed = await window.electronAPI.orgDevApp.buildAndPack({
    workspaceId: input.workspaceId,
  })
  if (!packed.success) {
    throw new Error(packed.error)
  }

  const uploadUrl = await input.convex.mutation(api.devApps.generateUploadUrl, {
    userId: input.userId,
    organizationId: input.organizationId,
  })
  const zipBytes = packed.zip instanceof Uint8Array ? packed.zip : new Uint8Array(packed.zip)
  const uploadResponse = await fetch(uploadUrl, {
    method: "POST",
    headers: { "Content-Type": "application/zip" },
    body: zipBytes as unknown as BodyInit,
  })
  if (!uploadResponse.ok) {
    throw new Error("Cozea could not upload the built DevApp artifact.")
  }
  const uploaded = (await uploadResponse.json()) as { storageId?: string }
  if (!uploaded.storageId) {
    throw new Error("Cozea did not receive a storage id for the DevApp artifact.")
  }

  await input.convex.mutation(api.devApps.publish, {
    userId: input.userId,
    projectId: input.projectId,
    name: input.name,
    ...(input.description ? { description: input.description } : {}),
    ...(input.logoDataUrl ? { logoDataUrl: input.logoDataUrl } : {}),
    framework: packed.framework,
    artifactStorageId: uploaded.storageId as Id<"_storage">,
    entryPath: packed.entryPath,
    contentHash: packed.contentHash,
  })
}
