import type { QueryCtx } from "../_generated/server"

export async function verifiedInstallationIsCurrent(ctx: Pick<QueryCtx, "db">, repository: { installationId: string; verifiedAt: number; revokedAt?: number }): Promise<boolean> {
  if (repository.revokedAt !== undefined) return false
  const revocation = await ctx.db.query("collaborationInstallationRevocations").withIndex("by_installation", q => q.eq("installationId", repository.installationId)).unique()
  return !revocation || repository.verifiedAt > revocation.revokedAt
}
