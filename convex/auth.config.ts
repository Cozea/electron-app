import type { AuthConfig } from "convex/server"

const issuer = process.env.COZEA_DEVICE_AUTH_ISSUER
const applicationID = process.env.COZEA_DEVICE_AUTH_AUDIENCE

if (!issuer || !applicationID) {
  throw new Error(
    "COZEA_DEVICE_AUTH_ISSUER and COZEA_DEVICE_AUTH_AUDIENCE must be configured",
  )
}

export default {
  providers: [
    {
      type: "customJwt",
      issuer,
      applicationID,
      jwks: `${issuer.replace(/\/$/, "")}/.well-known/jwks.json`,
      algorithm: "ES256",
    },
  ],
} satisfies AuthConfig
