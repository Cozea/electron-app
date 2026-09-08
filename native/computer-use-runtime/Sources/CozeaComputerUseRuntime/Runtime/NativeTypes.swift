@preconcurrency import AppKit
@preconcurrency import ApplicationServices
import CoreGraphics
import Foundation
import CozeaComputerUseCore

struct AppDescriptor: Sendable, Equatable {
    let pid: pid_t
    let name: String
    let bundleID: String?
    let launchIdentity: String
    var aliases: [String] { [name, String(pid)] + (bundleID.map { [$0] } ?? []) }
}

/// AX references are retained, immutable handles. All messaging goes through the
/// AX worker. They never escape to JavaScript or get reused for another index.
struct WindowHandle: @unchecked Sendable {
    let identity: WindowIdentity
    let app: AppDescriptor
    let application: AXUIElement
    let element: AXUIElement
    let bounds: CGRect
    let title: String
    let layer: Int
}

struct TreeObservation: @unchecked Sendable {
    let window: WindowHandle
    let text: String
    let elements: [Int: ElementRecord]
    let truncated: Bool
    let nodeCount: Int
}

struct ObservationLease: @unchecked Sendable {
    let id: String
    let window: WindowHandle
    let tree: TreeObservation?
    let imageGeometry: ScreenshotGeometry?
    let revision: StateRevision
    let createdAt: ContinuousClock.Instant
    let coherent: Bool
    let inputRevision: UInt64
}

struct PointerTarget: Sendable {
    let window: WindowIdentity
    let globalPoint: CGPoint
    let localPoint: CGPoint
    let windowBounds: CGRect
    let layer: Int
}

struct ResolvedElement: @unchecked Sendable {
    let element: AXUIElement
    let role: String
    let actions: [String]
    let bounds: CGRect
}

extension CGRect {
    var coreRectangle: Rectangle {
        Rectangle(x: origin.x, y: origin.y, width: width, height: height)
    }
}
extension Point { var cgPoint: CGPoint { CGPoint(x: x, y: y) } }

final class LockedValue<Value>: @unchecked Sendable {
    private let lock = NSLock()
    private var value: Value
    init(_ value: Value) { self.value = value }
    func withLock<T>(_ body: (inout Value) throws -> T) rethrows -> T {
        lock.lock(); defer { lock.unlock() }; return try body(&value)
    }
}

/// Blocking AX and event APIs must not occupy Swift's cooperative executor or
/// AppKit's main run loop. A serial queue also confines mutable per-worker state.
final class NativeWorker: @unchecked Sendable {
    private let queue: DispatchQueue
    init(_ name: String) { queue = DispatchQueue(label: "com.cozea.computer-use.\(name)", qos: .userInitiated) }
    func run<T: Sendable>(_ body: @escaping @Sendable () throws -> T) async throws -> T {
        try await withCheckedThrowingContinuation { continuation in
            queue.async { continuation.resume(with: Result { try autoreleasepool(invoking: body) }) }
        }
    }
    func enqueue(_ body: @escaping @Sendable () -> Void) { queue.async(execute: body) }
}

func nativeFailure(_ error: any Error, control: ActionControl? = nil) -> RuntimeFailure {
    if let control, control.hasDispatched { return control.normalize(error) }
    if let failure = error as? RuntimeFailure { return failure }
    if let error = error as? ComputerUseError {
        return RuntimeFailure(.invalidArguments, error.errorDescription ?? "Invalid native action.")
    }
    return RuntimeFailure(.internalError, "Native Computer Use failed. Consult redacted diagnostics.")
}

final class InputActivity: @unchecked Sendable {
    struct Status: Sendable { var revision: UInt64 = 0; var dispatching = false; var lastDispatchTime: CFTimeInterval = 0 }
    private let values = LockedValue<[WindowIdentity: Status]>([:])
    func status(_ window: WindowIdentity) -> Status { values.withLock { $0[window] ?? Status() } }
    func begin(_ window: WindowIdentity) { values.withLock { values in var s = values[window] ?? Status(); s.revision += 1; s.dispatching = true; values[window] = s } }
    func end(_ window: WindowIdentity, time: CFTimeInterval) { values.withLock { values in var s = values[window] ?? Status(); s.revision += 1; s.dispatching = false; s.lastDispatchTime = time; values[window] = s } }
    func reset() { values.withLock { $0.removeAll() } }
}
