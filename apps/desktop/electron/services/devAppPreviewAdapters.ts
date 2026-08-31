import { createHash } from "node:crypto"
import fs from "node:fs"

import type { DevAppPreviewFs } from "./DevAppPreviewSession"

const MAX_DEV_APP_MANIFEST_BYTES = 1024 * 1024

/**
 * The real filesystem behind `DevAppPreviewSession`, and the source-id derivation.
 *
 * Kept apart from the session so every rule the session enforces — containment, symlink
 * resolution, grant widening — is tested against a fake tree rather than against whatever
 * happens to exist on the machine running the suite.
 */

export const nodePreviewFs: DevAppPreviewFs = {
  readFile: (absolutePath) => {
    try {
      if (fs.statSync(absolutePath).size > MAX_DEV_APP_MANIFEST_BYTES) return null
      return fs.readFileSync(absolutePath, "utf8")
    } catch {
      // Missing, unreadable, and "is a directory" are all the same answer to the caller:
      // there is no manifest here. The session turns that into a diagnostic.
      return null
    }
  },
  exists: (absolutePath) => {
    try {
      return fs.existsSync(absolutePath)
    } catch {
      return false
    }
  },
  realpath: (absolutePath) => {
    try {
      return fs.realpathSync(absolutePath)
    } catch {
      return null
    }
  },
}

/**
 * Derives the opaque id a development source is addressed by.
 *
 * A hash rather than the path itself, because the id ends up in `cozea-devapp:dev/<id>`
 * refs that are persisted in workbench state and handed to agents — and a developer's
 * directory layout belongs in neither. It also keeps the id inside the ref grammar, which
 * a path with slashes and spaces would not be.
 */
export function hashSourcePath(absolutePath: string): string {
  return createHash("sha256").update(absolutePath).digest("hex").slice(0, 32)
}
