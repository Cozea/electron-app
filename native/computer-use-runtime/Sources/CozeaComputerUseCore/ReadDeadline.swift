import Foundation

private final class ReadRace<T: Sendable>: @unchecked Sendable {
    private let lock = NSLock()
    private var continuation: CheckedContinuation<T, any Error>?
    private var result: Result<T, any Error>?
    func install(_ continuation: CheckedContinuation<T, any Error>) {
        lock.lock()
        if let result { lock.unlock(); continuation.resume(with: result) }
        else { self.continuation = continuation; lock.unlock() }
    }
    func finish(_ result: Result<T, any Error>) {
        lock.lock()
        guard self.result == nil else { lock.unlock(); return }
        self.result = result
        let continuation = self.continuation; self.continuation = nil
        lock.unlock()
        continuation?.resume(with: result)
    }
}

/// For read-only OS operations whose underlying API may ignore task cancellation.
/// Never use this to race input submission: an input task must unwind explicitly.
public func withReadDeadline<T: Sendable>(
    timeout: Duration,
    operation: @escaping @Sendable () async throws -> T
) async throws -> T {
    let race = ReadRace<T>()
    let task = Task {
        do { race.finish(.success(try await operation())) }
        catch { race.finish(.failure(error)) }
    }
    let timer = Task {
        do { try await Task.sleep(for: timeout) } catch { return }
        race.finish(.failure(RuntimeFailure(.timedOut, "The read-only OS operation timed out.")))
        task.cancel()
    }
    defer { timer.cancel(); task.cancel() }
    return try await withTaskCancellationHandler {
        try await withCheckedThrowingContinuation { race.install($0) }
    } onCancel: {
        race.finish(.failure(CancellationError()))
        task.cancel(); timer.cancel()
    }
}
