import { v } from "convex/values"

export const lifecycleFenceValidator = v.object({
  fenceId: v.string(),
  intent: v.union(v.literal("pause"), v.literal("close")),
  sessionSeq: v.number(),
  barrierId: v.string(),
  keyVersion: v.number(),
  requestedByPrincipalId: v.id("devicePrincipals"),
  createdAt: v.number(),
  gitSavedThroughSeq: v.union(v.number(), v.null()),
})
