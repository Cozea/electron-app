import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { resolveMembership, type LiveSessionMember } from "@/features/collaboration/live/liveSessionModel"

/**
 * Phase 6 P25 Media Gate Verification Test.
 *
 * Master Specification: Section 23 (Presence & Media), P25
 * Strict Gate:
 * Media failure, reconnection, or permission errors run strictly in the renderer UI plane
 * and NEVER touch or block cozea-projectd, CRDT file syncing, or AutoGit leases.
 */
describe("P25 session media decoupling gate", () => {
  const repoRoot = process.cwd()

  it("fails CI if projectd imports or references WebRTC, audio, or media signaling", () => {
    const projectdSrc = path.join(repoRoot, "apps/projectd/src")
    if (!fs.existsSync(projectdSrc)) return

    const files = fs.readdirSync(projectdSrc, { recursive: true }) as string[]
    const forbiddenPatterns = [
      "RTCPeerConnection",
      "getUserMedia",
      "MediaStream",
      "AudioContext",
      "AnalyserNode",
      "collaborationSessionMedia",
      "collaborationSessionMediaSignals",
      "sendSignal",
      "consumeSignal",
    ]

    const violations: { file: string; pattern: string }[] = []

    for (const rel of files) {
      if (!rel.endsWith(".ts")) continue
      const fullPath = path.join(projectdSrc, rel)
      const content = fs.readFileSync(fullPath, "utf8")

      for (const pattern of forbiddenPatterns) {
        if (content.includes(pattern)) {
          violations.push({ file: rel, pattern })
        }
      }
    }

    expect(violations).toEqual([])
  })

  it("fails CI if projectd-protocol exports or depends on media types", () => {
    const protocolSrc = path.join(repoRoot, "packages/projectd-protocol/src")
    if (!fs.existsSync(protocolSrc)) return

    const files = fs.readdirSync(protocolSrc, { recursive: true }) as string[]
    const forbiddenPatterns = [
      "RTCPeerConnection",
      "MediaStream",
      "AudioContext",
      "MicrophoneState",
      "collaborationSessionMedia",
    ]

    const violations: { file: string; pattern: string }[] = []

    for (const rel of files) {
      if (!rel.endsWith(".ts")) continue
      const fullPath = path.join(protocolSrc, rel)
      const content = fs.readFileSync(fullPath, "utf8")

      for (const pattern of forbiddenPatterns) {
        if (content.includes(pattern)) {
          violations.push({ file: rel, pattern })
        }
      }
    }

    expect(violations).toEqual([])
  })

  it("preserves member membership resolution with presence and microphone state attached", () => {
    const members: LiveSessionMember[] = [
      {
        principalId: "p_1",
        displayName: "Alice",
        role: "project_manager",
        status: "active",
        isSelf: true,
        microphoneState: "speaking",
        isWorkbenchActive: true,
        allowBackgroundAudio: false,
      },
      {
        principalId: "p_2",
        displayName: "Bob",
        role: "developer",
        status: "active",
        isSelf: false,
        microphoneState: "muted",
        isWorkbenchActive: false,
        allowBackgroundAudio: true,
      },
    ]

    const membership = resolveMembership(undefined, members)
    expect(membership).toBe("active")

    const self = members.find((m) => m.isSelf)
    expect(self?.microphoneState).toBe("speaking")
    expect(self?.isWorkbenchActive).toBe(true)

    const peer = members.find((m) => !m.isSelf)
    expect(peer?.microphoneState).toBe("muted")
    expect(peer?.allowBackgroundAudio).toBe(true)
  })

  it("verifies that electron builder configuration includes microphone usage description", () => {
    const builderConfigPath = path.join(repoRoot, "apps/desktop/electron-builder.config.cjs")
    const configContent = fs.readFileSync(builderConfigPath, "utf8")

    expect(configContent).toContain("NSMicrophoneUsageDescription")
    expect(configContent).toContain("Cozea uses your microphone for real-time voice collaboration")
  })

  it("verifies that macOS entitlements include audio-input and microphone permissions", () => {
    const entitlementsPath = path.join(repoRoot, "build/entitlements.mac.plist")
    const entitlementsContent = fs.readFileSync(entitlementsPath, "utf8")

    expect(entitlementsContent).toContain("com.apple.security.device.audio-input")
    expect(entitlementsContent).toContain("com.apple.security.device.microphone")
  })
})
