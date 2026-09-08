@preconcurrency import ScreenCaptureKit
import CoreGraphics
import CoreImage
import CoreMedia
import ImageIO
import UniformTypeIdentifiers
import QuartzCore
import Foundation
import CozeaComputerUseCore

struct CapturedImage: Sendable {
    let png: Data
    let geometry: ScreenshotGeometry
    let source: String
    let frameTime: CFTimeInterval
}
private struct ImageBox: @unchecked Sendable { let image: CGImage }
private struct ContentBox: @unchecked Sendable { let content: SCShareableContent }

actor CaptureRuntime {
    private struct Entry {
        let id: UUID
        let bounds: CGRect
        let task: Task<WindowStream, any Error>
        var users: Int
        var touched: ContinuousClock.Instant
    }
    private var entries: [WindowIdentity: Entry] = [:]
    private var owners: [WindowIdentity: Set<String>] = [:]
    private var contentCache: (ContentBox, ContinuousClock.Instant)?
    private var generation: UInt64 = 0
    private let encoder = NativeWorker("image-encode")
    private let ciContext = CIContext(options: [.cacheIntermediates: false])
    private var idleTasks: [WindowIdentity: Task<Void, Never>] = [:]

    func snapshot(window: WindowHandle, session: String, notBefore: CFTimeInterval, control: ActionControl) async throws -> CapturedImage {
        let span = NativeTelemetry.span("capture.total"); defer { span.end() }
        try control.check()
        guard CGPreflightScreenCaptureAccess() else { throw RuntimeFailure(.permissionDenied, "Screen Recording permission is required for screenshots.") }
        let requestGeneration = generation
        let scWindow = try await shareable(window)
        try control.check()
        guard generation == requestGeneration else { throw RuntimeFailure(.cancelled, "Capture was reset.") }
        var sink: WindowStream?
        var leaseID: UUID?
        do {
            let lease = try acquire(window: window, scWindow: scWindow)
            leaseID = lease.id
            owners[window.identity, default: []].insert(session)
            sink = try await withReadDeadline(timeout: .seconds(2)) { try await lease.task.value }
        } catch {
            sink = nil
            if let id = leaseID {
                release(window.identity, id: id)
                if entries[window.identity]?.id == id, entries[window.identity]?.users == 0 { evict(window.identity) }
            }
            leaseID = nil
        }
        defer { if let leaseID { release(window.identity, id: leaseID) } }
        try control.check()
        guard generation == requestGeneration else { throw RuntimeFailure(.cancelled, "Capture was reset.") }

        if let sink {
            // Await the next frame without blocking an executor or sample callback.
            let deadline = ContinuousClock.now.advanced(by: .milliseconds(120))
            repeat {
                try control.check()
                if let frame = sink.frame(notBefore: notBefore), frame.identity == window.identity {
                    let image = try await encode(frame: frame, window: window, control: control)
                    return CapturedImage(png: image.png, geometry: image.geometry, source: "stream", frameTime: frame.evidenceTime)
                }
                if sink.failed { break }
                try await Task.sleep(for: .milliseconds(8))
            } while ContinuousClock.now < deadline
        }
        // A stale cached frame is never silently returned following input. The
        // one-shot path is bounded and still uses the already-resolved SCWindow.
        let acquired = try await withReadDeadline(timeout: .seconds(2)) {
            ImageBox(image: try await SCScreenshotManager.captureImage(contentFilter: SCContentFilter(desktopIndependentWindow: scWindow),
                                                                        configuration: WindowStream.configuration(bounds: window.bounds)))
        }
        try control.check()
        guard generation == requestGeneration else { throw RuntimeFailure(.cancelled, "Capture was reset.") }
        let encoded = try await encode(image: acquired, window: window, control: control)
        return CapturedImage(png: encoded.png, geometry: encoded.geometry, source: "one-shot", frameTime: CACurrentMediaTime())
    }

    private func shareable(_ window: WindowHandle) async throws -> SCWindow {
        if let cached = contentCache, cached.1.duration(to: .now) < .seconds(2),
           let match = cached.0.content.windows.first(where: { $0.windowID == window.identity.windowID && $0.owningApplication?.processID == window.app.pid }) {
            return match
        }
        let content = try await withReadDeadline(timeout: .seconds(2)) { ContentBox(content: try await SCShareableContent.current) }
        contentCache = (content, .now)
        guard let match = content.content.windows.first(where: { $0.windowID == window.identity.windowID && $0.owningApplication?.processID == window.app.pid }) else {
            throw RuntimeFailure(.staleWindow, "ScreenCaptureKit no longer exposes this target window.")
        }
        return match
    }
    private func acquire(window: WindowHandle, scWindow: SCWindow) throws -> (id: UUID, task: Task<WindowStream, any Error>) {
        idleTasks.removeValue(forKey: window.identity)?.cancel()
        if var existing = entries[window.identity], existing.bounds == window.bounds {
            existing.users += 1; existing.touched = .now; entries[window.identity] = existing
            return (existing.id, existing.task)
        }
        if let old = entries[window.identity] {
            guard old.users == 0 else { throw RuntimeFailure(.busy, "A prior capture generation is still in use.") }
            evict(window.identity)
        }
        if entries.count >= 2 {
            guard let key = entries.filter({ $0.value.users == 0 }).min(by: { $0.value.touched < $1.value.touched })?.key else {
                throw RuntimeFailure(.busy, "The capture capacity is temporarily in use.")
            }
            evict(key)
        }
        let id = UUID()
        let task = Task { try await WindowStream.start(window: scWindow, handle: window) }
        entries[window.identity] = Entry(id: id, bounds: window.bounds, task: task, users: 1, touched: .now)
        return (id, task)
    }
    private func release(_ key: WindowIdentity, id: UUID) {
        guard var entry = entries[key], entry.id == id else { return }
        entry.users = max(0, entry.users - 1); entry.touched = .now; entries[key] = entry
        if entry.users == 0 {
            idleTasks[key]?.cancel()
            idleTasks[key] = Task { [weak self] in
                do { try await Task.sleep(for: .seconds(15)) } catch { return }
                await self?.expire(key, id: id)
            }
        }
    }
    private func expire(_ key: WindowIdentity, id: UUID) {
        guard let entry = entries[key], entry.id == id, entry.users == 0 else { return }
        evict(key)
    }
    private func evict(_ key: WindowIdentity) {
        owners.removeValue(forKey: key)
        idleTasks.removeValue(forKey: key)?.cancel()
        guard let entry = entries.removeValue(forKey: key) else { return }
        entry.task.cancel()
        Task { if let stream = try? await entry.task.value { await stream.stop() } }
    }
    func releaseSession(_ session: String) {
        for key in Array(owners.keys) {
            owners[key]?.remove(session)
            if owners[key]?.isEmpty == true { evict(key) }
        }
    }
    func reset() {
        generation += 1; contentCache = nil
        for key in Array(entries.keys) { evict(key) }
    }
    func diagnostics() -> [String: JSONValue] { ["active_streams": .number(Double(entries.count)), "max_streams": .number(2)] }

    private func encode(frame: PixelFrame, window: WindowHandle, control: ActionControl) async throws -> CapturedImage {
        let context = ciContext
        let image = try await encoder.run {
            try control.check()
            let input = CIImage(cvPixelBuffer: frame.buffer)
            guard let image = context.createCGImage(input, from: input.extent) else { throw RuntimeFailure(.internalError, "Cannot convert the captured pixel buffer.") }
            return ImageBox(image: image)
        }
        return try await encode(image: image, window: window, control: control)
    }
    private func encode(image: ImageBox, window: WindowHandle, control: ActionControl) async throws -> CapturedImage {
        try await encoder.run {
            let span = NativeTelemetry.span("capture.encode"); defer { span.end() }
            try control.check()
            let data = NSMutableData()
            guard let destination = CGImageDestinationCreateWithData(data, UTType.png.identifier as CFString, 1, nil) else {
                throw RuntimeFailure(.internalError, "Cannot create screenshot encoder.")
            }
            CGImageDestinationAddImage(destination, image.image, nil)
            guard CGImageDestinationFinalize(destination) else { throw RuntimeFailure(.internalError, "Screenshot encoding failed.") }
            guard data.length <= 3 * 1024 * 1024 else { throw RuntimeFailure(.busy, "Screenshot exceeded the 3 MiB image budget; reduce the target window size.") }
            try control.check()
            NativeTelemetry.count("capture.png_bytes", data.length)
            let geometry = ScreenshotGeometry(window: window.bounds.coreRectangle, pixelWidth: image.image.width, pixelHeight: image.image.height)
            return CapturedImage(png: data as Data, geometry: geometry, source: "encoded", frameTime: 0)
        }
    }
}
