import { ConvexError } from "convex/values"

import type { Doc } from "../_generated/dataModel"
import type { MutationCtx, QueryCtx } from "../_generated/server"
import { isDeviceIdentityKey, isTokenIssuedAfterRevocationBoundary, normalizeDeviceIdentityKey } from "../../shared/deviceIdentity"

type AuthenticatedCtx = Pick<QueryCtx | MutationCtx, "auth" | "db">

export type DevicePrincipal = Doc<"devicePrincipals"> & {
  identityKey: string
  deviceLabel: string
  platform: string
  encryptionPublicKeyJwk: string
  encryptionPublicKeyAlgorithm: string
  encryptionFingerprint: string
  signingPublicKeyJwk: string
  signingPublicKeyAlgorithm: string
  signingFingerprint: string
  status: "active"
  signingKeyVersion: number
  tokenValidAfter: number
}

export function isRegisteredDevicePrincipal(
  user: Doc<"devicePrincipals"> | null,
): user is DevicePrincipal {
  return Boolean(
    user &&
    user.identityKey &&
    isDeviceIdentityKey(user.identityKey) &&
    user.deviceLabel &&
    user.platform &&
    user.encryptionPublicKeyJwk &&
    user.encryptionPublicKeyAlgorithm &&
    user.encryptionFingerprint &&
    user.signingPublicKeyJwk &&
    user.signingPublicKeyAlgorithm &&
    user.signingFingerprint &&
    (user.status === undefined || user.status === "active") &&
    (user.signingKeyVersion === undefined || user.signingKeyVersion >= 1) &&
    (user.tokenValidAfter === undefined || user.tokenValidAfter >= 0),
  )
}

export async function requireAuthenticatedDevice(
  ctx: AuthenticatedCtx,
): Promise<DevicePrincipal> {
  const identity = await ctx.auth.getUserIdentity()
  if (!identity) {
    throw new ConvexError("Authentication required")
  }
  const identityKey = normalizeDeviceIdentityKey(identity.subject)
  if (!isDeviceIdentityKey(identityKey)) {
    throw new ConvexError("Authenticated principal is not a Cozea device")
  }
  const user = await ctx.db
    .query("devicePrincipals")
    .withIndex("by_identity_key", (q) => q.eq("identityKey", identityKey))
    .unique()
  if (!isRegisteredDevicePrincipal(user) || user.identityKey !== identityKey) {
    throw new ConvexError("Authenticated device is not registered")
  }
  const claims = identity as unknown as Record<string, unknown>
  const tokenKeyVersion = claims.key_version
  // Convex intentionally omits JWT housekeeping claims such as iat from
  // getUserIdentity(), so the issuer duplicates it as a custom claim.
  const issuedAtSeconds = claims.token_issued_at
  const signingKeyVersion = user.signingKeyVersion ?? 1
  const tokenValidAfter = user.tokenValidAfter ?? 0
  if (tokenKeyVersion !== signingKeyVersion) {
    throw new ConvexError("Device session has been revoked")
  }
  if (
    typeof issuedAtSeconds !== "number" ||
    !isTokenIssuedAfterRevocationBoundary(issuedAtSeconds, tokenValidAfter)
  ) {
    throw new ConvexError("Device session is no longer valid")
  }
  return {
    ...user,
    status: "active",
    signingKeyVersion,
    tokenValidAfter,
  }
}
