/**
 * Env files a live session shares although Git ignores them.
 *
 * `.env` files hold the keys and settings a project needs to run and are normally kept
 * out of Git, so a teammate's fresh copy would not run without them. A session that
 * shares them carries them through its end-to-end encrypted room like any other file,
 * and AutoGit never commits them (CheckpointBuilder).
 */

import path from "node:path"

/** Templates such as `.env.example` are meant for Git, and hold no secrets. */
const TEMPLATE_PARTS = new Set(["example", "sample", "template", "dist", "defaults"])

/** `.env`, `.env.<name>`, and Cloudflare's `.dev.vars`, in any folder of the project. */
export function isSharedEnvironmentFile(relativePath: string): boolean {
  const name = path.posix.basename(relativePath.replace(/\\/g, "/"))
  // Copies the materializer keeps of a replaced file stay on this machine.
  if (/\.conflict\.\d+$/.test(name)) return false
  const match = /^\.(?:env|dev\.vars)(?:\.(.+))?$/.exec(name)
  if (!match) return false
  return !(match[1] ?? "")
    .toLowerCase()
    .split(".")
    .some((part) => TEMPLATE_PARTS.has(part))
}
