/** Validate the renderer's actual Vite environment, not only build-process env. */
export function validateDeviceGatewayUrl(value: string): string {
  const url = new URL(value.trim())
  const loopback = url.protocol === "http:" && url.hostname === "127.0.0.1"
  if (url.protocol !== "https:" && !loopback) {
    throw new Error("The device gateway must use HTTPS (HTTP is allowed only for 127.0.0.1)")
  }
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new Error("The device gateway must be an origin without credentials, path, query or fragment")
  }
  return url.origin
}
