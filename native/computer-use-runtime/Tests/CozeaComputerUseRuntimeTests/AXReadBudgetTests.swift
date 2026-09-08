import XCTest
import ApplicationServices
import CozeaComputerUseCore
@testable import CozeaComputerUseRuntime

final class AXReadBudgetTests: XCTestCase {
    func testEveryObjectGetsTimeoutBeforeEachRead() {
        let parent = AXUIElementCreateApplication(1)
        let child = AXUIElementCreateApplication(2)
        var events: [String] = []
        for element in [parent, child, child] {
            let result: Int? = AXAccess.read(element, configureTimeout: { target, timeout in
                XCTAssertTrue(CFEqual(target, element))
                XCTAssertGreaterThan(timeout, 0)
                XCTAssertLessThanOrEqual(timeout, 0.1)
                events.append("timeout")
                return .success
            }) { events.append("read"); return 1 }
            XCTAssertEqual(result, 1)
        }
        XCTAssertEqual(events, ["timeout", "read", "timeout", "read", "timeout", "read"])
    }

    func testCancelledAndExpiredBudgetsPerformNoSDKCalls() {
        let cancelled = OperationCancellation()
        cancelled.cancel()
        let budgets = [
            AXReadBudget(cancellation: cancelled, deadline: .now.advanced(by: .seconds(1))),
            AXReadBudget(cancellation: OperationCancellation(), deadline: .now.advanced(by: .seconds(-1))),
        ]
        for budget in budgets {
            budget.withScope {
                let result: Int? = AXAccess.read(AXUIElementCreateApplication(1), configureTimeout: { _, _ in
                    XCTFail("A cancelled/expired traversal configured an SDK timeout")
                    return .success
                }) { XCTFail("A cancelled/expired traversal queried AX"); return 1 }
                XCTAssertNil(result)
            }
            XCTAssertTrue(budget.exhausted)
            XCTAssertNil(AXReadBudget.current)
        }
    }

    func testTimeoutIsClampedToRemainingDeadlineAndNeverZero() {
        let now = ContinuousClock.now
        let budget = AXReadBudget(cancellation: OperationCancellation(), deadline: now.advanced(by: .milliseconds(25)))
        XCTAssertEqual(budget.remainingTimeout(now: now) ?? 0, 0.025, accuracy: 0.0001)
        XCTAssertEqual(budget.remainingTimeout(now: now.advanced(by: .milliseconds(20))) ?? 0, 0.005, accuracy: 0.0001)
        XCTAssertNil(budget.remainingTimeout(now: now.advanced(by: .milliseconds(25))))
        XCTAssertTrue(budget.exhausted)
    }

    func testConfigurationFailureAndRevocationSkipRead() {
        let element = AXUIElementCreateApplication(1)
        let failed: Int? = AXAccess.read(element, configureTimeout: { _, _ in .cannotComplete }) {
            XCTFail("Timeout configuration failure must not issue an unbounded read"); return 1
        }
        XCTAssertNil(failed)
        let cancellation = OperationCancellation()
        let budget = AXReadBudget(cancellation: cancellation, deadline: cancellation.deadline)
        budget.withScope {
            let cancelled: Int? = AXAccess.read(element, configureTimeout: { _, _ in
                cancellation.cancel(); return .success
            }) { XCTFail("Revoked request still queried AX"); return 1 }
            XCTAssertNil(cancelled)
        }
    }

    func testNestedAndThrowingScopesRestorePreviousBudget() throws {
        struct Expected: Error {}
        let outer = AXReadBudget(cancellation: OperationCancellation(), deadline: .now.advanced(by: .seconds(1)))
        let inner = AXReadBudget(cancellation: OperationCancellation(), deadline: .now.advanced(by: .seconds(1)))
        try outer.withScope {
            XCTAssertTrue(AXReadBudget.current === outer)
            XCTAssertThrowsError(try inner.withScope { () throws -> Void in
                XCTAssertTrue(AXReadBudget.current === inner)
                throw Expected()
            })
            XCTAssertTrue(AXReadBudget.current === outer)
        }
        XCTAssertNil(AXReadBudget.current)
    }
}
