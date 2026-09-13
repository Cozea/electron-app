import { expect, it, vi } from "vitest"
import { BackgroundDeviceIdentityManager } from "../../apps/projectd/src/identity/BackgroundDeviceIdentity"
import { NativeMacHelper } from "../../apps/projectd/src/native/NativeMacHelper"

it("reports safe identity recovery actions without creating replacement keys or exposing helper output", async () => {
  const helper = new NativeMacHelper()
  const read = vi.spyOn(helper, "loadIdentity")
  const manager = new BackgroundDeviceIdentityManager(helper)
  const generate = vi.spyOn(manager, "generateNewIdentity")
  try {
    read.mockRejectedValueOnce(new Error("secret helper contents"))
    await expect(manager.loadExistingIdentity()).rejects.toMatchObject({ code: "KEYCHAIN_UNAVAILABLE",
      message: expect.stringContaining("Unlock this Mac") })
    read.mockResolvedValueOnce(null)
    await expect(manager.loadExistingIdentity()).rejects.toMatchObject({ code: "IDENTITY_NOT_AUTHORIZED" })
    for (const malformed of ["secret invalid JSON", "null", JSON.stringify({ privateKey: "secret" })]) {
      read.mockResolvedValueOnce(malformed)
      await expect(manager.loadExistingIdentity()).rejects.toMatchObject({ code: "IDENTITY_INVALID",
        message: expect.not.stringContaining("secret") })
    }
    expect(generate).not.toHaveBeenCalled()
  } finally { read.mockRestore(); generate.mockRestore() }
})

it("classifies challenge and token rejection separately from transient service failures", async () => {
  const manager = new BackgroundDeviceIdentityManager()
  const identity = await manager.generateNewIdentity()
  for (const status of [401, 403]) {
    await expect(manager.authenticateWithCloud("https://gateway.example", async () => new Response(null, { status }), identity))
      .rejects.toMatchObject({ code: "DEVICE_AUTH_REJECTED" })
    let calls = 0
    await expect(manager.authenticateWithCloud("https://gateway.example", async () => ++calls === 1
      ? Response.json({ challenge: "challenge" }) : new Response(null, { status }), identity))
      .rejects.toMatchObject({ code: "DEVICE_AUTH_REJECTED" })
    expect(calls).toBe(2)
  }
  await expect(manager.authenticateWithCloud("https://gateway.example", async () => new Response(null, { status: 503 }), identity))
    .rejects.not.toHaveProperty("code", "DEVICE_AUTH_REJECTED")
})
