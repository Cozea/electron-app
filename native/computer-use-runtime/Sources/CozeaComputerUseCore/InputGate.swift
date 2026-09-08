import Foundation

/// Actors are reentrant across `await`. The explicit permit, not actor isolation,
/// keeps one complete cursor/input transaction active until its cleanup finishes.
public actor InputGate {
    private struct Waiter {
        let id: UUID
        let continuation: CheckedContinuation<Void, any Error>
    }
    private var held = false
    private var waiters: [Waiter] = []
    private let maxQueued: Int

    public init(maxQueued: Int = 64) { self.maxQueued = maxQueued }

    public func withPermit<T: Sendable>(
        _ operation: @Sendable () async throws -> T
    ) async throws -> T {
        try await acquire()
        defer { release() }
        try Task.checkCancellation()
        return try await operation()
    }

    private func acquire() async throws {
        try Task.checkCancellation()
        if !held { held = true; return }
        guard waiters.count < maxQueued else { throw RuntimeFailure(.busy, "The input queue is full.") }
        let id = UUID()
        try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, any Error>) in
                if Task.isCancelled { continuation.resume(throwing: CancellationError()); return }
                waiters.append(Waiter(id: id, continuation: continuation))
            }
        } onCancel: {
            Task { await self.cancelWaiter(id) }
        }
    }

    private func cancelWaiter(_ id: UUID) {
        guard let index = waiters.firstIndex(where: { $0.id == id }) else { return }
        waiters.remove(at: index).continuation.resume(throwing: CancellationError())
    }

    private func release() {
        if waiters.isEmpty { held = false }
        else { waiters.removeFirst().continuation.resume() }
    }

    public var queuedCount: Int { waiters.count }
}
