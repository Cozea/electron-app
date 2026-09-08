@preconcurrency import ScreenCaptureKit
import CoreMedia
import CoreVideo
import QuartzCore
import Darwin
import Foundation
import CozeaComputerUseCore

struct PixelFrame: @unchecked Sendable {
    let buffer: CVPixelBuffer
    let evidenceTime: CFTimeInterval
    let width: Int
    let height: Int
    let identity: WindowIdentity
}

/// Each sink is bound to exactly one window and one stream incarnation. Never
/// mutate a window ID while older SCStream callbacks remain in flight.
final class WindowStream: NSObject, SCStreamOutput, SCStreamDelegate, @unchecked Sendable {
    let identity: WindowIdentity
    let bounds: CGRect
    private struct Storage {
        var stream: SCStream?
        var frame: PixelFrame?
        var valid = true
        var frameCount: UInt64 = 0
        var failure: String?
    }
    private let storage = LockedValue(Storage())
    private let sampleQueue = DispatchQueue(label: "com.cozea.computer-use.frames", qos: .userInitiated)
    private init(identity: WindowIdentity, bounds: CGRect) { self.identity = identity; self.bounds = bounds; super.init() }

    static func start(window: SCWindow, handle: WindowHandle) async throws -> WindowStream {
        let sink = WindowStream(identity: handle.identity, bounds: handle.bounds)
        let stream = SCStream(filter: SCContentFilter(desktopIndependentWindow: window), configuration: configuration(bounds: handle.bounds), delegate: sink)
        sink.storage.withLock { $0.stream = stream }
        do {
            try stream.addStreamOutput(sink, type: .screen, sampleHandlerQueue: sink.sampleQueue)
            try await stream.startCapture()
            try Task.checkCancellation()
            return sink
        } catch {
            await sink.stop()
            throw error
        }
    }
    static func configuration(bounds: CGRect) -> SCStreamConfiguration {
        let configuration = SCStreamConfiguration()
        let scale = min(1, 1280 / max(bounds.width, bounds.height, 1))
        configuration.width = max(1, Int((bounds.width * scale).rounded(.up)))
        configuration.height = max(1, Int((bounds.height * scale).rounded(.up)))
        configuration.minimumFrameInterval = CMTime(value: 1, timescale: 15)
        configuration.queueDepth = 3
        configuration.pixelFormat = kCVPixelFormatType_32BGRA
        configuration.showsCursor = false
        configuration.capturesAudio = false
        configuration.scalesToFit = true
        configuration.ignoreShadowsSingleWindow = true
        return configuration
    }
    func frame(notBefore time: CFTimeInterval) -> PixelFrame? {
        storage.withLock { state in
            guard state.valid, let frame = state.frame, frame.evidenceTime >= time else { return nil }
            return frame
        }
    }
    var frameCount: UInt64 { storage.withLock { $0.frameCount } }
    var failed: Bool { storage.withLock { !$0.valid || $0.failure != nil } }
    func stop() async {
        let stream = storage.withLock { state -> SCStream? in
            state.valid = false; state.frame = nil
            let stream = state.stream; state.stream = nil
            return stream
        }
        if let stream { try? await stream.stopCapture() }
    }

    func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of outputType: SCStreamOutputType) {
        guard outputType == .screen, CMSampleBufferIsValid(sampleBuffer),
              let attachments = CMSampleBufferGetSampleAttachmentsArray(sampleBuffer, createIfNecessary: false) as? [[SCStreamFrameInfo: Any]],
              let attachment = attachments.first, let raw = attachment[.status] as? Int,
              let status = SCFrameStatus(rawValue: raw) else { return }
        let time: CFTimeInterval
        if let displayTime = attachment[.displayTime] as? UInt64, displayTime > 0 {
            var info = mach_timebase_info_data_t(); mach_timebase_info(&info)
            time = Double(displayTime) * Double(info.numer) / Double(info.denom) / 1e9
        } else {
            // A receipt timestamp must not be passed off as a captured-frame
            // timestamp. Unknown freshness forces the one-shot fallback.
            time = 0
        }
        storage.withLock { state in
            guard state.valid, state.stream === stream else { return }
            switch status {
            case .complete:
                guard let pixel = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
                state.frame = PixelFrame(buffer: pixel, evidenceTime: time, width: CVPixelBufferGetWidth(pixel),
                                         height: CVPixelBufferGetHeight(pixel), identity: identity)
                state.frameCount += 1
            case .idle:
                if let old = state.frame {
                    // Idle is explicit WindowServer evidence that content did not
                    // change. It supplies no new IOSurface; retain only one prior frame.
                    state.frame = PixelFrame(buffer: old.buffer, evidenceTime: time, width: old.width,
                                             height: old.height, identity: identity)
                }
            case .blank, .suspended, .stopped:
                state.frame = nil
            case .started: break
            @unknown default: state.frame = nil
            }
        }
    }
    func stream(_ stream: SCStream, didStopWithError error: any Error) {
        storage.withLock { state in
            guard state.stream === stream else { return }
            state.frame = nil; state.valid = false; state.failure = "stream-stopped"
        }
    }
}
