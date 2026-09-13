import { expect, it, vi } from "vitest"
import { LineMessageDecoder } from "@cozea/projectd-protocol"

it("preserves resolution text and paths across every UTF-8 socket boundary", () => {
  const requests = [
    { type: "request", id: "r1", method: "sessions.rebaseRecovery", params: { path: "代码/é.ts", text: "中文 café 👩🏽‍💻 e\u0301\nresolved" } },
    { type: "response", id: "r1", result: { text: "日本語 — مرحبا" } },
  ]
  const bytes = Buffer.from(requests.map((request) => JSON.stringify(request) + "\n").join(""))
  for (let offset = 0; offset <= bytes.length; offset++) {
    const decoder = new LineMessageDecoder()
    expect([...decoder.push(bytes.subarray(0, offset)), ...decoder.push(bytes.subarray(offset))]).toEqual(requests)
  }
  const decoder = new LineMessageDecoder()
  expect([...bytes].flatMap((byte) => decoder.push(Buffer.from([byte])))).toEqual(requests)
})

it("does not leak malformed resolution payloads or carry partial codepoints into a new connection", () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => undefined)
  try {
    const oldConnection = new LineMessageDecoder()
    expect(oldConnection.push(Buffer.from([0xf0, 0x9f]))).toEqual([])
    const fresh = new LineMessageDecoder()
    expect(fresh.push('private-source-secret not JSON\n{"type":"response","id":"ok","result":true}\n'))
      .toEqual([{ type: "response", id: "ok", result: true }])
    expect(log.mock.calls.flat().join(" ")).not.toContain("private-source-secret")
    expect(log).toHaveBeenCalledTimes(1)
  } finally { log.mockRestore() }
})
