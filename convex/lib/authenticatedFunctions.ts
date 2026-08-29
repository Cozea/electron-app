import { ConvexError } from "convex/values"

import { mutation as baseMutation, query as baseQuery } from "../_generated/server"
import { requireAuthenticatedDevice } from "./deviceAuth"
import { canAccessProject, canEditProject } from "./projectAccess"

type Builder = typeof baseQuery | typeof baseMutation

const CALLER_ID_FIELDS = [
  "userId", "createdBy", "requestedBy", "invitedBy", "addedBy", "ownerId",
  "deletedBy", "createdByUserId", "addedByUserId",
] as const

function isCallerIdentityField(field: string): boolean {
  return CALLER_ID_FIELDS.includes(field as (typeof CALLER_ID_FIELDS)[number]) ||
    /^(?:actor|viewer|requester|inviter|invited|added|deleted|created)UserId$/.test(field)
}

function authenticatedBuilder<T extends Builder>(builder: T, mode: "read" | "write"): T {
  return ((definition: {
    args?: unknown
    returns?: unknown
    handler: (ctx: never, args: Record<string, unknown>) => unknown
  }) => builder({
    ...definition,
    handler: async (ctx: never, args: Record<string, unknown>) => {
      const serverSecret = args.serverSecret
      const expectedServerSecret = process.env.AI_GATEWAY_SECRET
      if (typeof serverSecret === "string" && expectedServerSecret && serverSecret === expectedServerSecret) {
        return await definition.handler(ctx, args)
      }
      const device = await requireAuthenticatedDevice(ctx)
      for (const [field, claimed] of Object.entries(args)) {
        if (isCallerIdentityField(field) && claimed !== undefined && claimed !== device._id) {
          throw new ConvexError(`Caller-supplied ${field} does not match the authenticated device`)
        }
      }
      const projectId = args.projectId
      if (typeof projectId === "string") {
        const isSelfKeyRequest = mode === "write" && typeof args.recipientDeviceId === "string"
        const allowed = mode === "write" && !isSelfKeyRequest
          ? await canEditProject(ctx, projectId as never, device._id)
          : await canAccessProject(ctx, projectId as never, device._id)
        if (!allowed) throw new ConvexError("The authenticated device cannot access this project")
      }
      return await definition.handler(ctx, args)
    },
  } as never)) as unknown as T
}

export const authenticatedQuery = authenticatedBuilder(baseQuery, "read")
export const authenticatedMutation = authenticatedBuilder(baseMutation, "write")
