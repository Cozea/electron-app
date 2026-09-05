import fs from "node:fs"
import { afterEach, describe, expect, it, vi } from "vitest"
import { validateDeviceGatewayUrl } from "@shared/gatewayUrl"
import { parseGitHubNumericId } from "@shared/collaborationRepository"
import { getDeviceGatewayBaseUrl } from "@/lib/deviceSession"
import { decryptPayload, decryptPayloadMetadata, encryptPayload, generateRoomKeyBase64 } from "@/lib/collab/cipherEnvelope"
import { CollabWsProvider, type CollabSessionDescriptor } from "@/lib/yjs/CollabWsProvider"
import type { EncryptedCollabOutbox } from "@/features/collaboration/persistence/EncryptedCollabOutbox"
import { YjsProjectDoc } from "@/lib/yjs/YjsProjectDoc"
import { seedProjectDocFromWorkspace } from "@/features/collaboration/runtime/seedProjectDocFromWorkspace"

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks() })

describe("collaboration security review regressions", () => {
  it("validates actual renderer configuration before obtaining credentials", () => {
    vi.stubEnv("VITE_AUTH_SERVER_URL", "http://insecure.example.test")
    expect(() => getDeviceGatewayBaseUrl()).toThrow(/HTTPS/)
    expect(validateDeviceGatewayUrl("https://gateway.example.test/")).toBe("https://gateway.example.test")
    expect(validateDeviceGatewayUrl("http://127.0.0.1:8787/")).toBe("http://127.0.0.1:8787")
    for (const url of ["http://127.0.0.1.attacker.test", "https://user:pass@gateway.test", "https://gateway.test/?secret=1", "https://gateway.test/#fragment", "file:///tmp/token"]) {
      expect(() => validateDeviceGatewayUrl(url)).toThrow()
    }
  })

  it("rejects lossy or nonpositive GitHub IDs", () => {
    expect(parseGitHubNumericId("1135272524")).toBe(1135272524)
    for (const id of ["0", "-1", "1.5", "1e3", "9007199254740993", "Infinity", ""]) {
      expect(() => parseGitHubNumericId(id)).toThrow()
    }
  })

  it("keeps command/path attribution out of the readable envelope while retaining Yjs compatibility", async () => {
    const key = generateRoomKeyBase64()
    const bytes = new Uint8Array([1, 2, 3])
    const attribution = { commandText: "secret command", terminalTitle: "private title", gitCwd: "/private/home/repo", workspaceId: "private-workspace" }
    const metadata = { projectId: "p", roomId: "session:s", idempotencyKey: "update_1" }
    const envelope = await encryptPayload({ roomKeyBase64: key, kind: "yjs_update", keyVersion: 1, plaintext: bytes, metadata, privateMetadata: attribution })
    const aad = JSON.parse(Buffer.from(envelope.aad, "base64").toString())
    for (const [name, value] of Object.entries(attribution)) {
      expect(aad).not.toHaveProperty(name)
      expect(JSON.stringify(envelope)).not.toContain(value)
    }
    await expect(decryptPayload({ roomKeyBase64: key, envelope, expectedKind: "yjs_update" })).resolves.toEqual(bytes)
    await expect(decryptPayloadMetadata({ roomKeyBase64: key, envelope })).resolves.toEqual(attribution)
    const other = await encryptPayload({ roomKeyBase64: key, kind: "yjs_update", keyVersion: 1, plaintext: bytes, metadata: { ...metadata, idempotencyKey: "update_2" }, privateMetadata: attribution })
    await expect(decryptPayloadMetadata({ roomKeyBase64: key, envelope: { ...envelope, privateMetadata: other.privateMetadata } })).rejects.toThrow()
    const legacy = await encryptPayload({ roomKeyBase64: key, kind: "yjs_update", keyVersion: 1, plaintext: bytes, metadata })
    await expect(decryptPayloadMetadata({ roomKeyBase64: key, envelope: legacy })).resolves.toEqual({})
  })

  it("counts an IPC read rejection without abandoning other files", async () => {
    vi.stubGlobal("window", { electronAPI: { project: {
      listFiles: vi.fn(async () => ({ success: true, files: [{ path: "bad.ts", sizeBytes: 5 }, { path: "ok.ts", sizeBytes: 5 }] })),
      readFile: vi.fn(async ({ filePath }: { filePath: string }) => {
        if (filePath === "bad.ts") throw new Error("IPC rejected")
        return { success: true, content: "hello" }
      }),
    } } })
    const doc = new YjsProjectDoc("p")
    try {
      await expect(seedProjectDocFromWorkspace({ doc, workspaceId: "w" })).resolves.toMatchObject({ seededFiles: 1, failedFiles: 1 })
      expect(doc.files.get("ok.ts")?.toString()).toBe("hello")
    } finally { doc.destroy() }
  })

  it("aborts connecting sockets and detaches callbacks on teardown", () => {
    vi.stubGlobal("window", { clearTimeout })
    vi.stubGlobal("WebSocket", { OPEN: 1, CONNECTING: 0 })
    const doc = new YjsProjectDoc("p")
    const close = vi.fn()
    const outboxClose = vi.fn()
    const socket = { readyState: 0, close, onopen: vi.fn(), onmessage: vi.fn(), onclose: vi.fn(), onerror: vi.fn() }
    const provider = new CollabWsProvider({
      doc: doc.doc, awareness: doc.awareness,
      session: { projectId: "p", roomId: "session:s" } as CollabSessionDescriptor,
      outbox: { close: outboxClose } as unknown as EncryptedCollabOutbox,
    })
    ;(provider as unknown as { socket: unknown }).socket = socket
    provider.destroy()
    expect(close).toHaveBeenCalledWith(1000, "Provider destroyed")
    expect(socket.onopen).toBeNull()
    expect(socket.onmessage).toBeNull()
    expect(outboxClose).toHaveBeenCalledOnce()
    doc.destroy()
  })

  it("updates tokens in place without a token-driven bootstrap effect", () => {
    const context = fs.readFileSync("apps/desktop/src/contexts/YjsProjectContext.tsx", "utf8")
    expect(context).toContain("wsProviderRef.current?.updateSession(wsSession)")
    expect(context).not.toContain("wsSession?.token,")
    const hook = fs.readFileSync("apps/desktop/src/features/collaboration/hooks/useCollabSession.ts", "utf8")
    expect(hook).toContain("currentSessionRef")
    expect(hook).toContain("generation !== requestGenerationRef.current")
  })
})
