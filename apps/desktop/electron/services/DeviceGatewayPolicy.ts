declare const __COZEA_DEVICE_GATEWAY_ORIGIN__: string

/** Build-pinned device gateway authority. Renderer IPC can never select a token recipient. */
export function getTrustedDeviceGatewayBaseUrl(): string {
  const configured =
    typeof __COZEA_DEVICE_GATEWAY_ORIGIN__ === "string"
      ? __COZEA_DEVICE_GATEWAY_ORIGIN__
      : process.env.VITE_AUTH_SERVER_URL || process.env.VITE_COLLAB_BASE_URL || "https://api.cozea.app"
  const url = new URL(configured)
  if (url.protocol !== "https:" && !(url.protocol === "http:" && url.hostname === "127.0.0.1")) {
    throw new Error("The Cozea device gateway is not configured securely.")
  }
  return url.origin
}
