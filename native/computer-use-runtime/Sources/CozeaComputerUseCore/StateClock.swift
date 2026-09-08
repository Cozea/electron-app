import Foundation

public struct WindowIdentity: Hashable, Codable, Sendable {
    public let processID: Int32
    public let windowID: UInt32
    public let generation: UInt64
    public init(processID: Int32, windowID: UInt32, generation: UInt64) {
        self.processID = processID; self.windowID = windowID; self.generation = generation
    }
}

public struct StateSignal: OptionSet, Hashable, Sendable {
    public let rawValue: UInt8
    public init(rawValue: UInt8) { self.rawValue = rawValue }
    public static let focus = Self(rawValue: 1 << 0)
    public static let value = Self(rawValue: 1 << 1)
    public static let layout = Self(rawValue: 1 << 2)
    public static let destroyed = Self(rawValue: 1 << 3)
    public static let all: Self = [.focus, .value, .layout, .destroyed]
    static let individual: [Self] = [.focus, .value, .layout, .destroyed]
}

public struct StateRevision: Sendable, Equatable {
    public let observed: UInt64
    public let dispatched: UInt64
    public init(observed: UInt64 = 0, dispatched: UInt64 = 0) {
        self.observed = observed; self.dispatched = dispatched
    }
}

public enum StateWaitResult: Sendable, Equatable {
    case changed(UInt64)
    case timedOut
}

/// Observations and command submission are different facts. A submitted click does
/// not prove a state change, and an unrelated app cannot satisfy this window's waiter.
public actor StateClock {
    private struct State {
        var observed: UInt64 = 0
        var dispatched: UInt64 = 0
        var signalVersions: [StateSignal: UInt64] = [:]
    }
    private struct Waiter {
        let window: WindowIdentity
        let after: UInt64
        let signals: StateSignal
        let continuation: CheckedContinuation<StateWaitResult, any Error>
        let timer: Task<Void, Never>
    }
    private var sequence: UInt64 = 0
    private var states: [WindowIdentity: State] = [:]
    private var waiters: [UUID: Waiter] = [:]

    public init() {}

    public func current(_ window: WindowIdentity) -> StateRevision {
        let state = states[window] ?? State()
        return StateRevision(observed: state.observed, dispatched: state.dispatched)
    }

    @discardableResult
    public func recordObserved(_ window: WindowIdentity, signals: StateSignal) -> UInt64 {
        sequence += 1
        var state = states[window] ?? State()
        state.observed = sequence
        for signal in StateSignal.individual where signals.contains(signal) {
            state.signalVersions[signal] = sequence
        }
        states[window] = state
        let ready = waiters.compactMap { id, waiter in
            waiter.window == window && match(state, after: waiter.after, signals: waiter.signals) ? id : nil
        }
        for id in ready { finish(id, result: .success(.changed(sequence))) }
        return sequence
    }

    @discardableResult
    public func recordDispatched(_ window: WindowIdentity) -> UInt64 {
        sequence += 1
        var state = states[window] ?? State()
        state.dispatched = sequence
        states[window] = state
        return sequence
    }

    public func waitForObservedChange(
        _ window: WindowIdentity,
        after version: UInt64,
        signals: StateSignal = .all,
        timeout: Duration = .milliseconds(80)
    ) async throws -> StateWaitResult {
        try Task.checkCancellation()
        if let state = states[window], match(state, after: version, signals: signals) {
            return .changed(state.observed)
        }
        guard timeout > .zero else { return .timedOut }
        let id = UUID()
        return try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { continuation in
                if Task.isCancelled { continuation.resume(throwing: CancellationError()); return }
                let timer = Task {
                    do { try await Task.sleep(for: timeout) }
                    catch { return }
                    self.finish(id, result: .success(.timedOut))
                }
                waiters[id] = Waiter(window: window, after: version, signals: signals, continuation: continuation, timer: timer)
            }
        } onCancel: {
            Task { await self.finish(id, result: .failure(CancellationError())) }
        }
    }

    public func forget(_ window: WindowIdentity) {
        states.removeValue(forKey: window)
        for id in waiters.compactMap({ $0.value.window == window ? $0.key : nil }) {
            finish(id, result: .failure(RuntimeFailure(.staleWindow, "The target window was destroyed.")))
        }
    }

    public func reset() {
        states.removeAll()
        for id in Array(waiters.keys) { finish(id, result: .failure(CancellationError())) }
    }

    private func match(_ state: State, after: UInt64, signals: StateSignal) -> Bool {
        state.signalVersions.contains { signals.contains($0.key) && $0.value > after }
    }
    private func finish(_ id: UUID, result: Result<StateWaitResult, any Error>) {
        guard let waiter = waiters.removeValue(forKey: id) else { return }
        waiter.timer.cancel()
        waiter.continuation.resume(with: result)
    }

    public var waiterCount: Int { waiters.count }
}
