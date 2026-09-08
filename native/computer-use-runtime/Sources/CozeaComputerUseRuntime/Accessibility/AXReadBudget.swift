@preconcurrency import ApplicationServices
import Foundation
import CozeaComputerUseCore

/// A synchronous AX traversal budget. The scope stays on NativeWorker's thread;
/// it must never span an await or escape its closure. Nested scopes restore the
/// previous budget so another request cannot inherit cancellation or a deadline.
final class AXReadBudget {
    private static let threadKey = "com.cozea.computer-use.ax-read-budget"
    private let cancellation: OperationCancellation
    private let deadline: ContinuousClock.Instant
    private(set) var exhausted = false

    init(cancellation: OperationCancellation, deadline: ContinuousClock.Instant) {
        self.cancellation = cancellation
        self.deadline = min(deadline, cancellation.deadline)
    }

    static var current: AXReadBudget? {
        Thread.current.threadDictionary[threadKey] as? AXReadBudget
    }

    func withScope<T>(_ operation: () throws -> T) rethrows -> T {
        let dictionary = Thread.current.threadDictionary
        let previous = dictionary[Self.threadKey]
        dictionary[Self.threadKey] = self
        defer {
            if let previous { dictionary[Self.threadKey] = previous }
            else { dictionary.removeObject(forKey: Self.threadKey) }
        }
        return try operation()
    }

    /// Zero resets AX's default timeout, so an expired budget must skip the read
    /// rather than configuring a zero timeout. Every query recomputes remaining time.
    func remainingTimeout(now: ContinuousClock.Instant = .now) -> Float? {
        guard !cancellation.isCancelled, !Task.isCancelled, now < deadline else {
            exhausted = true
            return nil
        }
        let remaining = now.duration(to: deadline).components
        let seconds = Double(remaining.seconds) + Double(remaining.attoseconds) / 1e18
        let timeout = Float(min(0.1, seconds))
        guard timeout > 0 else { exhausted = true; return nil }
        return timeout
    }
}
