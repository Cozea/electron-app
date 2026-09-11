/**
 * Session Media Service for WebRTC voice communication.
 *
 * Master Specification: Section 23.1 - 23.4
 * Invariants:
 * - C42: Media failure does not block file collaboration.
 *   Microphone and file sync lifecycles are completely decoupled.
 * - Section 23.4: Idling a Session Workbench automatically mutes microphone.
 */

import { EventEmitter } from "node:events"

export interface ParticipantMediaState {
  participantId: string
  isMuted: boolean
  isSpeaking: boolean
}

export class SessionMediaService extends EventEmitter {
  private localStream: MediaStream | null = null
  private isMuted = true
  private peerStates = new Map<string, ParticipantMediaState>()
  private isIdle = false

  get muted(): boolean {
    return this.isMuted
  }

  get idle(): boolean {
    return this.isIdle
  }

  get stream(): MediaStream | null {
    return this.localStream
  }

  /**
   * Section 23.3: Request microphone permission and acquire local audio stream.
   * Fails gracefully without throwing to caller or interrupting CRDT sync (Invariant C42).
   */
  async acquireMicrophone(): Promise<boolean> {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      console.log("[SessionMedia] MediaDevices not available in current environment")
      return false
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      })

      this.localStream = stream
      // Default to muted on initial acquire
      this.setMuted(true)
      this.emit("stream_acquired", stream)
      return true
    } catch (err: any) {
      // Invariant C42: Log and fail gracefully; do NOT throw or block file sync
      console.warn("[SessionMedia] Microphone permission denied or audio device unavailable:", err?.message)
      this.emit("error", err)
      return false
    }
  }

  setMuted(muted: boolean): void {
    this.isMuted = muted
    if (this.localStream) {
      for (const track of this.localStream.getAudioTracks()) {
        track.enabled = !muted
      }
    }
    this.emit("mute_change", this.isMuted)
  }

  toggleMute(): boolean {
    this.setMuted(!this.isMuted)
    return this.isMuted
  }

  /**
   * Section 23.4: Auto-mute when Session Workbench transitions to IDLE.
   */
  onWorkbenchIdle(): void {
    this.isIdle = true
    if (!this.isMuted) {
      this.setMuted(true)
      console.log("[SessionMedia] Microphone automatically muted as Session Workbench idled (Section 23.4)")
    }
  }

  onWorkbenchActive(): void {
    this.isIdle = false
  }

  updatePeerState(participantId: string, state: Partial<ParticipantMediaState>): void {
    const existing = this.peerStates.get(participantId) ?? {
      participantId,
      isMuted: true,
      isSpeaking: false,
    }
    const updated = { ...existing, ...state }
    this.peerStates.set(participantId, updated)
    this.emit("peer_media_change", updated)
  }

  getPeerState(participantId: string): ParticipantMediaState | null {
    return this.peerStates.get(participantId) ?? null
  }

  /**
   * Section 23.4: Cleanup on session leave or pause.
   */
  dispose(): void {
    if (this.localStream) {
      for (const track of this.localStream.getTracks()) {
        track.stop()
      }
      this.localStream = null
    }
    this.peerStates.clear()
    this.isMuted = true
    this.emit("disposed")
  }
}
