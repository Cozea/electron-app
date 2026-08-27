import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { describe, expect, it } from "vitest"

import { hashBuffer, packDirectoryToZip, unpackZip } from "../../apps/desktop/electron/services/orgDevAppZip"

describe("org DevApp zip packing", () => {
  it("round-trips a static index.html tree", () => {
    const source = fs.mkdtempSync(path.join(os.tmpdir(), "org-devapp-src-"))
    const dest = fs.mkdtempSync(path.join(os.tmpdir(), "org-devapp-dst-"))
    try {
      fs.writeFileSync(path.join(source, "index.html"), "<html><body>ok</body></html>")
      fs.mkdirSync(path.join(source, "assets"))
      fs.writeFileSync(path.join(source, "assets", "app.js"), "console.log(1)")

      const packed = packDirectoryToZip(source)
      expect(packed.contentHash).toBe(hashBuffer(packed.zip))
      expect(packed.contentHash).toMatch(/^[a-f0-9]{64}$/)

      unpackZip(packed.zip, dest)
      expect(fs.readFileSync(path.join(dest, "index.html"), "utf8")).toContain("ok")
      expect(fs.readFileSync(path.join(dest, "assets", "app.js"), "utf8")).toBe("console.log(1)")
    } finally {
      fs.rmSync(source, { recursive: true, force: true })
      fs.rmSync(dest, { recursive: true, force: true })
    }
  })

  it("rejects zip paths that escape the destination", () => {
    const dest = fs.mkdtempSync(path.join(os.tmpdir(), "org-devapp-unsafe-"))
    try {
      expect(() => unpackZip(Buffer.from("not-a-zip"), dest)).toThrow(/not a valid zip/)
    } finally {
      fs.rmSync(dest, { recursive: true, force: true })
    }
  })
})
