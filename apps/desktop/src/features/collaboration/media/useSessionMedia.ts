/**
 * Session WebRTC Voice Media Engine.
 *
 * Master Specification: Section 23 (Presence & Media), 23.3 Microphone, 23.4 Workbench switch, P25.
 *
 * Strict Isolation Gate:
 * Media failure, reconnection, or permission errors run strictly in the renderer UI plane
 * and NEVER touch or block cozea-projectd, CRDT file syncing, or AutoGit leases.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useMutation } from "convex/react"
import { useSafeConvexQuery } from "@/hooks/useSafeConvexQuery"
import { api } from "../../../../../../convex/_generated/api"
import type { Doc, Id } from "../../../../../../convex/_generated/dataModel"
import type { LiveSessionMember, MicrophoneState } from "../live/liveSessionModel"

const DEFAULT_ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
]

export interface AudioInputDeviceInfo {
  deviceId: string
  label: string
  groupId: string
}

export interface SessionMediaController {
  microphoneState: MicrophoneState
  isMuted: boolean
  isSpeaking: boolean
  permissionStatus: "not-determined" | "granted" | "denied" | "restricted" | "unknown"
  allowBackgroundAudio: boolean
  setAllowBackgroundAudio: (allow: boolean) => void
  toggleMute: () => Promise<void>
  requestMicrophonePermission: () => Promise<boolean>
  analyserNode?: AnalyserNode | null
  error: string | null
  audioDevices: AudioInputDeviceInfo[]
  selectedDeviceId: string | null
  selectAudioDevice: (deviceId: string) => Promise<void>
}

interface PeerConnectionState {
  pc: RTCPeerConnection
  makingOffer: boolean
  ignoreOffer: boolean
  audioElement: HTMLAudioElement | null
}

const AUDIO_DEVICE_STORAGE_KEY = "cozea:audio:selectedInputDeviceId"

export function useSessionMedia(input: {
  sessionId: Id<"collaborationSessions"> | null | undefined
  enabled: boolean
  members: readonly LiveSessionMember[]
  myPrincipalId: string | null
  isWorkbenchActive: boolean
}): SessionMediaController {
  const { sessionId, enabled, members, myPrincipalId, isWorkbenchActive } = input

  const [permissionStatus, setPermissionStatus] = useState<
    "not-determined" | "granted" | "denied" | "restricted" | "unknown"
  >("not-determined")
  const [isMuted, setIsMuted] = useState<boolean>(true)
  const [isSpeaking, setIsSpeaking] = useState<boolean>(false)
  const [allowBackgroundAudio, setAllowBackgroundAudio] = useState<boolean>(false)
  const [analyserNode, setAnalyserNode] = useState<AnalyserNode | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [audioDevices, setAudioDevices] = useState<AudioInputDeviceInfo[]>([])
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(() => {
    try {
      return localStorage.getItem(AUDIO_DEVICE_STORAGE_KEY)
    } catch {
      return null
    }
  })

  // Remote peer connections map: targetPrincipalId -> PeerConnectionState
  const peersRef = useRef<Map<string, PeerConnectionState>>(new Map())
  const localStreamRef = useRef<MediaStream | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const gainNodeRef = useRef<GainNode | null>(null)
  const mediaStreamSourceRef = useRef<MediaStreamAudioSourceNode | null>(null)
  const selectedDeviceIdRef = useRef<string | null>(selectedDeviceId)
  selectedDeviceIdRef.current = selectedDeviceId
  const vadAnimationRef = useRef<number | null>(null)
  const vadSpeakingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const previousWorkbenchActiveRef = useRef<boolean>(isWorkbenchActive)
  // The session this device has sent presence for; leaving is only meaningful after joining.
  const presenceSessionRef = useRef<string | null>(null)

  // Enumerate native audio input devices
  const refreshAudioDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return
    try {
      const devices = await navigator.mediaDevices.enumerateDevices()
      const inputs = devices
        .filter((d) => d.kind === "audioinput")
        .map((d, idx) => ({
          deviceId: d.deviceId,
          label: d.label || `Microphone ${idx + 1}`,
          groupId: d.groupId,
        }))
      setAudioDevices(inputs)
    } catch (err) {
      console.error("[SessionMedia] Failed to enumerate audio devices:", err)
    }
  }, [])

  useEffect(() => {
    void refreshAudioDevices()
    const handleDeviceChange = () => {
      void refreshAudioDevices()
    }
    navigator.mediaDevices?.addEventListener?.("devicechange", handleDeviceChange)
    return () => {
      navigator.mediaDevices?.removeEventListener?.("devicechange", handleDeviceChange)
    }
  }, [refreshAudioDevices])

  // Convex mutations & queries
  const sendSignal = useMutation(api.collaborationSessionMedia.sendSignal)
  const consumeSignal = useMutation(api.collaborationSessionMedia.consumeSignal)
  const updatePresence = useMutation(api.collaborationSessionMedia.updatePresence)
  const leaveMediaSession = useMutation(api.collaborationSessionMedia.leaveMediaSession)

  const pendingSignalsQuery = useSafeConvexQuery(
    api.collaborationSessionMedia.listPendingSignals,
    enabled && sessionId ? { sessionId } : "skip",
  )
  const pendingSignals = pendingSignalsQuery.data ?? []

  // Check initial macOS / system microphone permission
  useEffect(() => {
    let cancelled = false
    const checkPermission = async () => {
      if (window.electronAPI?.media?.getMicrophonePermission) {
        try {
          const status = await window.electronAPI.media.getMicrophonePermission()
          if (!cancelled) setPermissionStatus(status)
        } catch (err) {
          console.error("[SessionMedia] Failed to query microphone permission:", err)
          if (!cancelled) setPermissionStatus("unknown")
        }
      } else {
        if (!cancelled) setPermissionStatus("granted")
      }
    }
    void checkPermission()
    return () => {
      cancelled = true
    }
  }, [])

  // Prompt for microphone permission
  const requestMicrophonePermission = useCallback(async (): Promise<boolean> => {
    try {
      if (window.electronAPI?.media?.requestMicrophonePermission) {
        const granted = await window.electronAPI.media.requestMicrophonePermission()
        setPermissionStatus(granted ? "granted" : "denied")
        if (granted) void refreshAudioDevices()
        return granted
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      stream.getTracks().forEach((track) => track.stop())
      setPermissionStatus("granted")
      void refreshAudioDevices()
      return true
    } catch (err) {
      console.error("[SessionMedia] Microphone permission request rejected:", err)
      setPermissionStatus("denied")
      return false
    }
  }, [refreshAudioDevices])

  // Initialize or acquire local media stream with real AudioContext and AnalyserNode
  const acquireLocalStream = useCallback(
    async (targetDeviceId?: string): Promise<MediaStream | null> => {
      const deviceIdToUse = targetDeviceId !== undefined ? targetDeviceId : selectedDeviceIdRef.current

      // Return current stream only if it exists AND no specific device switch was requested
      if (localStreamRef.current && targetDeviceId === undefined) {
        return localStreamRef.current
      }

      try {
        let stream: MediaStream
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            audio: {
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true,
              ...(deviceIdToUse ? { deviceId: { exact: deviceIdToUse } } : {}),
            },
          })
        } catch (err) {
          if (deviceIdToUse) {
            console.warn("[SessionMedia] Target device unavailable, falling back to default:", err)
            stream = await navigator.mediaDevices.getUserMedia({
              audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
              },
            })
          } else {
            throw err
          }
        }

        localStreamRef.current = stream

        // Set initial track state matching isMuted
        stream.getAudioTracks().forEach((track) => {
          track.enabled = !isMuted
        })

        // Refresh device list to resolve human-readable labels once permission is granted
        void refreshAudioDevices()

        // Setup VAD (Voice Activity Detection) via AnalyserNode
        const AudioCtx =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
        if (AudioCtx) {
          let audioCtx = audioContextRef.current
          if (!audioCtx || audioCtx.state === "closed") {
            audioCtx = new AudioCtx()
            audioContextRef.current = audioCtx
          }
          if (audioCtx.state === "suspended") {
            await audioCtx.resume()
          }

          let gainNode = gainNodeRef.current
          if (!gainNode) {
            gainNode = audioCtx.createGain()
            gainNode.gain.setValueAtTime(isMuted ? 0 : 1, audioCtx.currentTime)
            gainNodeRef.current = gainNode
          }

          let analyser = analyserNode
          if (!analyser) {
            analyser = audioCtx.createAnalyser()
            analyser.fftSize = 512
            analyser.smoothingTimeConstant = 0.8
            gainNode.connect(analyser)
            setAnalyserNode(analyser)
          }

          // Disconnect old stream source if reconnecting
          if (mediaStreamSourceRef.current) {
            try {
              mediaStreamSourceRef.current.disconnect()
            } catch {
              // ignore
            }
          }

          const source = audioCtx.createMediaStreamSource(stream)
          source.connect(gainNode)
          mediaStreamSourceRef.current = source

          if (!vadAnimationRef.current) {
            const dataArray = new Uint8Array(analyser.frequencyBinCount)
            const checkVAD = () => {
              if (!localStreamRef.current) return
              analyser.getByteFrequencyData(dataArray)

              // Calculate energy across vocal range bins (~100Hz to 3kHz)
              let sum = 0
              const maxBin = Math.min(32, dataArray.length)
              for (let i = 1; i < maxBin; i++) {
                sum += dataArray[i]
              }
              const vocalAverage = sum / (maxBin - 1)
              const threshold = 18

              const trackActive = localStreamRef.current.getAudioTracks().some((t) => t.enabled)
              if (vocalAverage > threshold && trackActive) {
                setIsSpeaking(true)
                if (vadSpeakingTimeoutRef.current) clearTimeout(vadSpeakingTimeoutRef.current)
                vadSpeakingTimeoutRef.current = setTimeout(() => {
                  setIsSpeaking(false)
                }, 350)
              }

              vadAnimationRef.current = requestAnimationFrame(checkVAD)
            }
            vadAnimationRef.current = requestAnimationFrame(checkVAD)
          }
        }

        setPermissionStatus("granted")
        setError(null)
        return stream
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to access microphone"
        console.error("[SessionMedia] acquireLocalStream error:", message)
        setError(message)
        setPermissionStatus("denied")
        return null
      }
    },
    [isMuted, analyserNode, refreshAudioDevices],
  )

  // Switch active microphone device live without dropping peer connections
  const selectAudioDevice = useCallback(
    async (deviceId: string) => {
      setSelectedDeviceId(deviceId)
      try {
        localStorage.setItem(AUDIO_DEVICE_STORAGE_KEY, deviceId)
      } catch {
        // ignore
      }

      const oldStream = localStreamRef.current
      if (oldStream) {
        try {
          const newStream = await acquireLocalStream(deviceId)
          if (!newStream) return

          const newAudioTrack = newStream.getAudioTracks()[0]
          if (newAudioTrack) {
            // Update tracks in all active RTCPeerConnections via replaceTrack
            peersRef.current.forEach(({ pc }) => {
              const senders = pc.getSenders()
              const existingSender = senders.find((s) => s.track?.kind === "audio")
              if (existingSender) {
                void existingSender.replaceTrack(newAudioTrack)
              } else {
                pc.addTrack(newAudioTrack, newStream)
              }
            })
          }

          // Stop previous tracks to release old microphone hardware
          const oldTracks = oldStream.getAudioTracks().filter((t) => t.id !== newAudioTrack?.id)
          oldTracks.forEach((t) => t.stop())
        } catch (err) {
          console.error("[SessionMedia] Failed to switch audio input device:", err)
        }
      }
    },
    [acquireLocalStream],
  )

  // Toggle Mute / Unmute
  const toggleMute = useCallback(async () => {
    if (isMuted) {
      // Unmuting
      let stream = localStreamRef.current
      if (!stream) {
        stream = await acquireLocalStream()
      }
      if (audioContextRef.current && audioContextRef.current.state === "suspended") {
        await audioContextRef.current.resume()
      }
      if (stream) {
        stream.getAudioTracks().forEach((track) => {
          track.enabled = true
        })
        if (gainNodeRef.current && audioContextRef.current) {
          gainNodeRef.current.gain.setValueAtTime(1, audioContextRef.current.currentTime)
        }
        setIsMuted(false)
        // Add or replace track in all active peer connections
        peersRef.current.forEach(({ pc }) => {
          stream?.getAudioTracks().forEach((track) => {
            const senders = pc.getSenders()
            const existingSender = senders.find((s) => s.track?.kind === "audio")
            if (existingSender) {
              void existingSender.replaceTrack(track)
            } else {
              pc.addTrack(track, stream!)
            }
          })
        })
      }
    } else {
      // Muting
      if (localStreamRef.current) {
        localStreamRef.current.getAudioTracks().forEach((track) => {
          track.enabled = false
        })
      }
      if (gainNodeRef.current && audioContextRef.current) {
        gainNodeRef.current.gain.setValueAtTime(0, audioContextRef.current.currentTime)
      }
      setIsMuted(true)
      setIsSpeaking(false)
    }
  }, [isMuted, acquireLocalStream])

  // Master Plan 23.4: Workbench Idle Mute Policy
  // If Session Workbench transitions from ACTIVE to IDLE, microphone automatically mutes unless background audio is permitted.
  useEffect(() => {
    const wasActive = previousWorkbenchActiveRef.current
    previousWorkbenchActiveRef.current = isWorkbenchActive

    if (wasActive && !isWorkbenchActive && !allowBackgroundAudio && !isMuted) {
      if (localStreamRef.current) {
        localStreamRef.current.getAudioTracks().forEach((track) => {
          track.enabled = false
        })
      }
      if (gainNodeRef.current && audioContextRef.current) {
        gainNodeRef.current.gain.setValueAtTime(0, audioContextRef.current.currentTime)
      }
      setIsMuted(true)
      setIsSpeaking(false)
    }
  }, [isWorkbenchActive, allowBackgroundAudio, isMuted])

  // Sync current media presence with Convex
  const currentMicrophoneState: MicrophoneState = useMemo(() => {
    if (permissionStatus === "denied" || permissionStatus === "restricted") return "unpermitted"
    if (isMuted) return "muted"
    if (isSpeaking) return "speaking"
    return "active"
  }, [permissionStatus, isMuted, isSpeaking])

  useEffect(() => {
    if (!enabled || !sessionId || !myPrincipalId) return

    presenceSessionRef.current = sessionId
    updatePresence({
      sessionId,
      microphoneState: currentMicrophoneState,
      isWorkbenchActive,
      allowBackgroundAudio,
    }).catch((err) => {
      console.error("[SessionMedia] updatePresence failed:", err)
    })
  }, [enabled, sessionId, myPrincipalId, currentMicrophoneState, isWorkbenchActive, allowBackgroundAudio, updatePresence])

  // Helper to create or get RTCPeerConnection for a remote peer (W3C Perfect Negotiation)
  const getOrCreatePeer = useCallback(
    (remotePrincipalId: string): PeerConnectionState => {
      const existing = peersRef.current.get(remotePrincipalId)
      if (existing && existing.pc.signalingState !== "closed") {
        return existing
      }

      const pc = new RTCPeerConnection({ iceServers: DEFAULT_ICE_SERVERS })

      const peerState: PeerConnectionState = {
        pc,
        makingOffer: false,
        ignoreOffer: false,
        audioElement: null,
      }

      // Audio playback element
      const audioEl = document.createElement("audio")
      audioEl.autoplay = true
      peerState.audioElement = audioEl

      // Add local audio tracks if stream exists
      if (localStreamRef.current) {
        localStreamRef.current.getAudioTracks().forEach((track) => {
          pc.addTrack(track, localStreamRef.current!)
        })
      }

      // Handle incoming remote audio track
      pc.ontrack = (event) => {
        if (event.streams && event.streams[0]) {
          audioEl.srcObject = event.streams[0]
          void audioEl.play().catch((err) => {
            console.warn("[SessionMedia] Remote audio playback warning:", err)
          })
        }
      }

      // Send ICE candidates to remote peer via Convex
      pc.onicecandidate = ({ candidate }) => {
        if (candidate && sessionId) {
          sendSignal({
            sessionId,
            targetPrincipalId: remotePrincipalId as Id<"devicePrincipals">,
            type: "candidate",
            payload: JSON.stringify(candidate),
          }).catch((err) => {
            console.error("[SessionMedia] sendSignal (candidate) failed:", err)
          })
        }
      }

      // Perfect negotiation: onnegotiationneeded
      pc.onnegotiationneeded = async () => {
        try {
          peerState.makingOffer = true
          await pc.setLocalDescription()
          if (sessionId && pc.localDescription) {
            await sendSignal({
              sessionId,
              targetPrincipalId: remotePrincipalId as Id<"devicePrincipals">,
              type: "offer",
              payload: JSON.stringify(pc.localDescription),
            })
          }
        } catch (err) {
          console.error("[SessionMedia] Negotiation error:", err)
        } finally {
          peerState.makingOffer = false
        }
      }

      peersRef.current.set(remotePrincipalId, peerState)
      return peerState
    },
    [myPrincipalId, sessionId, sendSignal],
  )

  // Maintain peer connections with active remote members
  useEffect(() => {
    if (!enabled || !sessionId || !myPrincipalId) return

    const activeRemoteMembers = members.filter(
      (m) => m.principalId !== myPrincipalId && m.status === "active",
    )

    // Ensure connection exists for all active members
    activeRemoteMembers.forEach((member) => {
      getOrCreatePeer(member.principalId)
    })

    // Clean up members who left
    const activeIds = new Set(activeRemoteMembers.map((m) => m.principalId))
    peersRef.current.forEach((peerState, id) => {
      if (!activeIds.has(id)) {
        peerState.pc.close()
        if (peerState.audioElement) {
          peerState.audioElement.srcObject = null
          peerState.audioElement.remove()
        }
        peersRef.current.delete(id)
      }
    })
  }, [enabled, sessionId, myPrincipalId, members, getOrCreatePeer])

  // Process incoming pending signals from Convex (SDP offers, answers, candidates)
  useEffect(() => {
    if (!pendingSignals || pendingSignals.length === 0 || !sessionId) return

    pendingSignals.forEach(async (signal: Doc<"collaborationSessionMediaSignals">) => {
      const senderId = String(signal.senderPrincipalId)
      const peerState = getOrCreatePeer(senderId)
      const pc = peerState.pc
      const isPolite = !myPrincipalId || myPrincipalId > senderId

      try {
        if (signal.type === "offer" || signal.type === "answer") {
          const description: RTCSessionDescriptionInit = JSON.parse(signal.payload)
          const offerCollision =
            description.type === "offer" &&
            (peerState.makingOffer || pc.signalingState !== "stable")

          peerState.ignoreOffer = !isPolite && offerCollision
          if (peerState.ignoreOffer) {
            await consumeSignal({ signalId: signal._id })
            return
          }

          if (offerCollision) {
            await pc.setLocalDescription({ type: "rollback" })
          }

          await pc.setRemoteDescription(description)

          if (description.type === "offer") {
            await pc.setLocalDescription()
            if (pc.localDescription) {
              await sendSignal({
                sessionId,
                targetPrincipalId: signal.senderPrincipalId,
                type: "answer",
                payload: JSON.stringify(pc.localDescription),
              })
            }
          }
        } else if (signal.type === "candidate") {
          const candidateInit: RTCIceCandidateInit = JSON.parse(signal.payload)
          try {
            await pc.addIceCandidate(candidateInit)
          } catch (candidateErr) {
            if (!peerState.ignoreOffer) {
              console.warn("[SessionMedia] addIceCandidate warning:", candidateErr)
            }
          }
        }
      } catch (err) {
        console.error("[SessionMedia] Signaling processing error:", err)
      } finally {
        await consumeSignal({ signalId: signal._id }).catch((err) => {
          console.error("[SessionMedia] consumeSignal failed:", err)
        })
      }
    })
  }, [pendingSignals, sessionId, myPrincipalId, getOrCreatePeer, sendSignal, consumeSignal])

  // Teardown on unmount or session leave
  useEffect(() => {
    return () => {
      // Clean up VAD
      if (vadAnimationRef.current) cancelAnimationFrame(vadAnimationRef.current)
      if (vadSpeakingTimeoutRef.current) clearTimeout(vadSpeakingTimeoutRef.current)
      if (audioContextRef.current) {
        void audioContextRef.current.close().catch((err) => {
          console.error("[SessionMedia] Error closing AudioContext:", err)
        })
      }

      // Stop local tracks
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((track) => track.stop())
        localStreamRef.current = null
      }

      // Close all peer connections
      peersRef.current.forEach(({ pc, audioElement }) => {
        pc.close()
        if (audioElement) {
          audioElement.srcObject = null
          audioElement.remove()
        }
      })
      peersRef.current.clear()

      // Inform backend of leave
      if (sessionId && presenceSessionRef.current === sessionId) {
        presenceSessionRef.current = null
        void leaveMediaSession({ sessionId }).catch((err) => {
          console.error("[SessionMedia] leaveMediaSession failed:", err)
        })
      }
    }
  }, [sessionId, leaveMediaSession])

  return {
    microphoneState: currentMicrophoneState,
    isMuted,
    isSpeaking,
    permissionStatus,
    allowBackgroundAudio,
    setAllowBackgroundAudio,
    toggleMute,
    requestMicrophonePermission,
    analyserNode,
    error,
    audioDevices,
    selectedDeviceId,
    selectAudioDevice,
  }
}
