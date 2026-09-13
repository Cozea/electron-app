export type BackgroundIdentityErrorCode = "KEYCHAIN_UNAVAILABLE" | "IDENTITY_NOT_AUTHORIZED" | "IDENTITY_INVALID" | "DEVICE_AUTH_REJECTED"

/** Safe messages only: helper output and identity JSON must never reach the UI. */
export class BackgroundIdentityError extends Error {
  readonly code: BackgroundIdentityErrorCode
  constructor(code: BackgroundIdentityErrorCode, message: string) {
    super(message)
    this.name = "BackgroundIdentityError"
    this.code = code
  }
}
