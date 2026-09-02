const UNREACHABLE = "Could not reach"

/**
 * Wraps a gateway call so a transport failure names what could not be reached.
 *
 * Node reports a DNS or connection failure as a bare `fetch failed`, which tells an author
 * nothing about which host was tried or whether the service is simply not deployed. HTTP
 * status handling stays with each caller; this only rescues the errors fetch itself throws.
 */
export async function fetchDevAppGateway(
  url: string,
  init: RequestInit,
  service: string,
): Promise<Response> {
  try {
    return await fetch(url, init)
  } catch (error) {
    let origin = url
    try {
      origin = new URL(url).origin
    } catch {
      /* keep the raw url when it will not parse */
    }
    if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
      throw new Error(`The ${service} at ${origin} did not respond in time.`)
    }
    const cause = error instanceof Error ? error.message : String(error)
    throw new Error(`${UNREACHABLE} the ${service} at ${origin}: ${cause}`)
  }
}
