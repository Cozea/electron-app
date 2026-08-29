import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { describe, expect, it } from "vitest"

import {
  hashBuffer,
  ORG_DEVAPP_ARTIFACT_LIMITS,
  packDirectoryToZip,
  unpackZip,
} from "../../apps/desktop/electron/services/orgDevAppZip"

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
    const source = fs.mkdtempSync(path.join(os.tmpdir(), "org-devapp-path-src-"))
    const dest = fs.mkdtempSync(path.join(os.tmpdir(), "org-devapp-unsafe-"))
    try {
      fs.writeFileSync(path.join(source, "index.html"), "unsafe")
      const malicious = Buffer.from(packDirectoryToZip(source).zip)
      let offset = 0
      while ((offset = malicious.indexOf("index.html", offset, "utf8")) >= 0) {
        malicious.write("../bad.txt", offset, "utf8")
        offset += 10
      }
      expect(() => unpackZip(malicious, dest)).toThrow(/unsafe path/)
    } finally {
      fs.rmSync(source, { recursive: true, force: true })
      fs.rmSync(dest, { recursive: true, force: true })
    }
  })

  it("rejects oversized files before reading them into memory", () => {
    const source = fs.mkdtempSync(path.join(os.tmpdir(), "org-devapp-large-"))
    try {
      const largePath = path.join(source, "large.bin")
      fs.writeFileSync(largePath, "")
      fs.truncateSync(largePath, ORG_DEVAPP_ARTIFACT_LIMITS.maxEntryBytes + 1)
      expect(() => packDirectoryToZip(source)).toThrow(/file larger than/)
    } finally {
      fs.rmSync(source, { recursive: true, force: true })
    }
  })

  it("rejects symbolic links in build output", () => {
    const source = fs.mkdtempSync(path.join(os.tmpdir(), "org-devapp-link-"))
    try {
      fs.writeFileSync(path.join(source, "index.html"), "ok")
      fs.symlinkSync(path.join(source, "index.html"), path.join(source, "linked.html"))
      expect(() => packDirectoryToZip(source)).toThrow(/symbolic links/)
    } finally {
      fs.rmSync(source, { recursive: true, force: true })
    }
  })
})
