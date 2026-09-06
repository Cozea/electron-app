import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const joinLinks = readFileSync(join(process.cwd(), "convex/projectJoinLinks.ts"), "utf8")
const presence = readFileSync(join(process.cwd(), "convex/projectPresence.ts"), "utf8")
const presenceHook = readFileSync(
  join(process.cwd(), "apps/desktop/src/hooks/useProjectPresence.ts"),
  "utf8",
)

function section(source: string, name: string): string {
  const start = source.indexOf(`export const ${name}`)
  expect(start).toBeGreaterThanOrEqual(0)
  const remainder = source.slice(start + 1)
  const nextOffset = remainder.search(/\nexport const \w+/)
  return nextOffset >= 0 ? source.slice(start, start + 1 + nextOffset) : source.slice(start)
}

describe("direct device-principal project authority", () => {
  it("derives join-link membership from authenticated device authority", () => {
    const join = section(joinLinks, "joinByToken")

    expect(join).toContain("requireAuthenticatedDevice(ctx)")
    expect(join).toContain("userId: principal._id")
    expect(join).not.toContain("trustProjectDevice")
    expect(join).not.toContain("userId: args.userId")
    expect(join).not.toContain("deviceLabel: args.deviceLabel")
  })

  it("derives presence presentation from the canonical principal", () => {
    const heartbeat = section(presence, "heartbeat")

    expect(heartbeat).toContain("requireAuthenticatedDevice(ctx)")
    expect(heartbeat).toContain("principal.displayName")
    expect(heartbeat).toContain("principal.avatarStorageId")
    expect(heartbeat).toContain("ctx.storage.getUrl")
    expect(heartbeat).not.toContain("userId: v.optional")
    expect(heartbeat).not.toContain("userName: v.optional")
    expect(heartbeat).not.toContain("userAvatarUrl: v.optional")
    expect(heartbeat).not.toContain("userName: args.userName")
    expect(heartbeat).not.toContain("userAvatarUrl: args.userAvatarUrl")
    expect(heartbeat).not.toContain("userEmail")
  })

  it("does not send identity/presentation claims in renderer presence heartbeats", () => {
    const callStart = presenceHook.indexOf("await heartbeat({")
    expect(callStart).toBeGreaterThanOrEqual(0)
    const call = presenceHook.slice(callStart, presenceHook.indexOf("})", callStart) + 2)

    expect(call).toContain("projectId")
    expect(call).not.toContain("userId:")
    expect(call).not.toContain("userName")
    expect(call).not.toContain("userEmail")
    expect(call).not.toContain("userAvatarUrl")
  })
})
