import Foundation

/// The FFI caller can revoke a request immediately, even while its Swift task is suspended.
public final class OperationCancellation: @unchecked Sendable {
    private let lock = NSLock()
    private var reason: RuntimeFailure?
    public let deadline: ContinuousClock.Instant

    public init(timeout: Duration = .seconds(30)) { deadline = .now.advanced(by: timeout) }

    public func cancel(_ reason: RuntimeFailure = RuntimeFailure(.cancelled, "Computer Use was cancelled.")) {
        lock.withLock { if self.reason == nil { self.reason = reason } }
    }

    public func check() throws {
        if let error = lock.withLock({ reason }) { throw error }
        if ContinuousClock.now >= deadline { throw RuntimeFailure(.timedOut, "The Computer Use deadline expired.") }
        if Task.isCancelled { throw RuntimeFailure(.cancelled, "Computer Use was cancelled.") }
    }

    public var isCancelled: Bool { lock.withLock { reason != nil } || ContinuousClock.now >= deadline }
}
