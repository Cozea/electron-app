/**
 * Project-relative path validation shared by the tree CRDT, the materializer and AutoGit.
 *
 * Master Specification: Section 10.3, Invariants C37, C38
 * Tree paths arrive from peers as CRDT data, so they are untrusted input. A path must
 * stay a plain relative path inside the project and must never name Git metadata.
 */

export class InvalidProjectPathError extends Error {
  readonly path: string

  constructor(path: string, reason: string) {
    super(`Invalid project path '${path}': ${reason}`)
    this.name = "InvalidProjectPathError"
    this.path = path
  }
}

/**
 * Returns the canonical form of a project-relative path (forward slashes, no `.`
 * segments, no leading or trailing slash), or throws InvalidProjectPathError.
 */
export function normalizeProjectPath(input: string): string {
  if (typeof input !== "string") {
    throw new InvalidProjectPathError(String(input), "path must be a string")
  }
  if (input.includes("\0")) {
    throw new InvalidProjectPathError(input, "path contains a NUL byte")
  }

  const slashed = input.replace(/\\/g, "/")
  if (slashed.startsWith("/") || /^[A-Za-z]:/.test(slashed)) {
    throw new InvalidProjectPathError(input, "absolute paths are not project paths")
  }

  const segments = slashed.split("/").filter((segment) => segment !== "" && segment !== ".")
  if (segments.length === 0) {
    throw new InvalidProjectPathError(input, "path is empty")
  }
  for (const segment of segments) {
    if (segment === "..") {
      throw new InvalidProjectPathError(input, "parent-directory segments are not allowed")
    }
    if (segment.toLowerCase() === ".git") {
      throw new InvalidProjectPathError(input, "Git metadata is not replicated project content")
    }
  }

  return segments.join("/")
}

export function isValidProjectPath(input: string): boolean {
  try {
    normalizeProjectPath(input)
    return true
  } catch {
    return false
  }
}
