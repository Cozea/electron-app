import XCTest
@testable import CozeaComputerUseCore

private actor Counter {
    var active = 0
    var maximum = 0
    var completed = 0
    func enter() { active += 1; maximum = max(maximum, active) }
    func leave() { active -= 1; completed += 1 }
}

final class ConcurrencyTests: XCTestCase, @unchecked Sendable {
    func testGateHoldsPermitAcrossSuspension() async throws {
        let gate = InputGate(maxQueued: 200)
        let counter = Counter()
        try await withThrowingTaskGroup(of: Void.self) { group in
            for _ in 0..<100 {
                group.addTask {
                    try await gate.withPermit {
                        await counter.enter()
                        try await Task.sleep(for: .milliseconds(1))
                        await counter.leave()
                    }
                }
            }
            try await group.waitForAll()
        }
        let maximum = await counter.maximum
        let completed = await counter.completed
        XCTAssertEqual(maximum, 1)
        XCTAssertEqual(completed, 100)
    }

    func testCancelledWaiterDoesNotRunOrLeakPermit() async throws {
        let gate = InputGate()
        let first = Task { try await gate.withPermit { try await Task.sleep(for: .milliseconds(100)) } }
        try await Task.sleep(for: .milliseconds(10))
        let cancelled = Task { try await gate.withPermit { XCTFail("Cancelled input dispatched") } }
        try await Task.sleep(for: .milliseconds(10))
        cancelled.cancel()
        do { try await cancelled.value; XCTFail() } catch {}
        try await first.value
        let final = try await gate.withPermit { 42 }
        XCTAssertEqual(final, 42)
        let queued = await gate.queuedCount
        XCTAssertEqual(queued, 0)
    }

    func testCommandsAndOtherWindowsCannotSatisfyObservationWait() async throws {
        let clock = StateClock()
        let a = WindowIdentity(processID: 1, windowID: 1, generation: 1)
        let b = WindowIdentity(processID: 2, windowID: 2, generation: 1)
        _ = await clock.recordDispatched(a)
        _ = await clock.recordObserved(b, signals: .value)
        let outcome = try await clock.waitForObservedChange(a, after: 0, timeout: .milliseconds(5))
        XCTAssertEqual(outcome, .timedOut)
        let state = await clock.current(a)
        XCTAssertEqual(state.observed, 0)
        XCTAssertGreaterThan(state.dispatched, 0)
    }

    func testObservationWaitHandlesEarlySignalAndCancellation() async throws {
        let clock = StateClock()
        let window = WindowIdentity(processID: 1, windowID: 1, generation: 1)
        let version = await clock.recordObserved(window, signals: .value)
        let outcome = try await clock.waitForObservedChange(window, after: 0, signals: .value)
        XCTAssertEqual(outcome, .changed(version))
        let waiter = Task { try await clock.waitForObservedChange(window, after: version, timeout: .seconds(30)) }
        try await Task.sleep(for: .milliseconds(5))
        waiter.cancel()
        do { _ = try await waiter.value; XCTFail() } catch {}
        let count = await clock.waiterCount
        XCTAssertEqual(count, 0)
    }

    func testObservationLeasesDoNotRemapOrCrossSessions() async throws {
        let store = ObservationStore<Int>(perSessionLimit: 2)
        try await store.publish(session: "a", id: "old", aliases: ["Safari"], value: 10)
        try await store.publish(session: "a", id: "new", aliases: ["Safari"], value: 20)
        let old = try await store.lease(session: "a", app: "safari", id: "old")
        let latest = try await store.lease(session: "a", app: "safari")
        XCTAssertEqual(old, 10)
        XCTAssertEqual(latest, 20)
        do { _ = try await store.lease(session: "b", app: "safari", id: "old"); XCTFail() } catch {}
        try await store.publish(session: "a", id: "third", aliases: ["Safari"], value: 30)
        do { _ = try await store.lease(session: "a", app: "safari", id: "old"); XCTFail() } catch {}
    }
}
