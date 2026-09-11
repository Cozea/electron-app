import { describe, expect, it } from "vitest"

import { SessionMediaService } from "../../apps/desktop/src/features/collaboration/services/SessionMediaService"

describe("P25 Microphone and session media", () => {
  it("initializes in muted state and toggles mute cleanly", () => {
    const media = new SessionMediaService()
    expect(media.muted).toBe(true)

    // Toggle unmute
    const unmuted = media.toggleMute()
    expect(unmuted).toBe(false)
    expect(media.muted).toBe(false)

    // Toggle mute
    const muted = media.toggleMute()
    expect(muted).toBe(true)
    expect(media.muted).toBe(true)
  })

  it("enforces Invariant C42: media failure does not throw or block collaboration", async () => {
    const media = new SessionMediaService()

    // When navigator.mediaDevices is absent or throws permission error:
    const acquired = await media.acquireMicrophone()
    expect(acquired).toBe(false)
    // Operation does not throw; fails gracefully so file collaboration continues unblocked!
    expect(media.muted).toBe(true)
  })

  it("automatically mutes microphone when Session Workbench transitions to IDLE (Section 23.4)", () => {
    const media = new SessionMediaService()
    media.setMuted(false)
    expect(media.muted).toBe(false)

    // User switches to ordinary workbench -> Session Workbench becomes IDLE
    media.onWorkbenchIdle()
    expect(media.muted).toBe(true)
  })

  it("tracks peer media states and disposes cleanly on session leave", () => {
    const media = new SessionMediaService()

    media.updatePeerState("peer_alice", { isMuted: false, isSpeaking: true })
    const aliceState = media.getPeerState("peer_alice")
    expect(aliceState?.isMuted).toBe(false)
    expect(aliceState?.isSpeaking).toBe(true)

    media.dispose()
    expect(media.getPeerState("peer_alice")).toBeNull()
    expect(media.muted).toBe(true)
  })
})
