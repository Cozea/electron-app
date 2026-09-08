import XCTest
@testable import CozeaComputerUseCore

private actor Trace {
    var events: [String] = []
    func append(_ value: String) { events.append(value) }
}
final class ActionSafetyTests: XCTestCase, @unchecked Sendable {
    func testCoordinateObservationsRejectUIChangesAndExpiration() throws {
        try CoordinateLeaseGuard.validate(observedVersion: 5, currentObservedVersion: 5,
            inputVersion: 2, currentInputVersion: 2, age: .seconds(1))
        XCTAssertThrowsError(try CoordinateLeaseGuard.validate(observedVersion: 5, currentObservedVersion: 6,
            inputVersion: 2, currentInputVersion: 2, age: .seconds(1)))
        XCTAssertThrowsError(try CoordinateLeaseGuard.validate(observedVersion: 5, currentObservedVersion: 5,
            inputVersion: 2, currentInputVersion: 3, age: .seconds(1)))
        XCTAssertThrowsError(try CoordinateLeaseGuard.validate(observedVersion: 5, currentObservedVersion: 5,
            inputVersion: 2, currentInputVersion: 2, age: .seconds(31)))
    }
    func testInputCannotPrecedeCursorArrivalAndRevalidation() async throws {
        let trace = Trace()
        let control = ActionControl()
        let backend = try await CausalPointerSequence.perform(control: control,
            resolve: { await trace.append("resolve"); return 1 },
            arrive: { _ in await trace.append("arrival") },
            revalidate: { _ in await trace.append("validate") },
            dispatch: { _ in try control.markDispatch(); await trace.append("dispatch"); return "fixture" })
        let events = await trace.events
        XCTAssertEqual(events, ["resolve", "arrival", "validate", "dispatch"])
        XCTAssertEqual(backend, "fixture")
    }
    func testCancellationDuringTravelNeverDispatches() async {
        let control = ActionControl()
        do {
            _ = try await CausalPointerSequence.perform(control: control,
                resolve: { 1 }, arrive: { _ in control.cancel() }, revalidate: { _ in },
                dispatch: { _ in XCTFail("Input dispatched after cancellation"); return "bad" })
            XCTFail("Cancellation was ignored")
        } catch {}
        XCTAssertFalse(control.hasDispatched)
    }
    func testMovedTargetNeverDispatches() async {
        let control = ActionControl()
        do {
            _ = try await CausalPointerSequence.perform(control: control, resolve: { 1 }, arrive: { _ in },
                revalidate: { _ in throw RuntimeFailure(.staleElement, "Moved") },
                dispatch: { _ in XCTFail("Input dispatched at a moved target"); return "bad" })
            XCTFail()
        } catch {}
        XCTAssertFalse(control.hasDispatched)
    }
    func testCancellationBeforeFFIAdmissionIsRetained() throws {
        let registry = AuthorizationRegistry()
        try registry.configure(session: "s", policy: RuntimePolicy(revision: "1", allowedTools: ["click"], allowGlobalPointer: false))
        registry.cancelRequest(session: "s", request: "r")
        XCTAssertThrowsError(try registry.register(session: "s", request: "r", revision: "1", tool: .click))
    }
    func testRevocationCancelsAnAdmittedRequestAndCannotReuseTheRevision() throws {
        let registry = AuthorizationRegistry()
        let policy = RuntimePolicy(revision: "1", allowedTools: ["click"], allowGlobalPointer: false)
        try registry.configure(session: "s", policy: policy)
        let control = try registry.register(session: "s", request: "r", revision: "1", tool: .click)
        registry.revoke(session: "s")
        XCTAssertThrowsError(try control.check())
        XCTAssertThrowsError(try registry.configure(session: "s", policy: policy))
        XCTAssertThrowsError(try registry.register(session: "s", request: "new", revision: "1", tool: .click))
    }
    func testAfterDispatchFailureNeverPermitsFallback() throws {
        let control = ActionControl()
        try control.markDispatch()
        let error = control.normalize(RuntimeFailure(.backendUnavailable, "Backend failed"))
        XCTAssertEqual(error.delivery, .unknown)
        XCTAssertFalse(error.permitsFallback)
    }
    func testSharedCatalogueContainsBoundedObservationAndAllNineTools() throws {
        let value = try JSONValue.decodeObject(ToolCatalogue.jsonText())
        guard case .array(let tools) = value["tools"] else { return XCTFail("No tools") }
        XCTAssertEqual(tools.count, 9)
        let encoded = try ToolCatalogue.jsonText()
        XCTAssertTrue(encoded.contains("snapshot_id"))
        XCTAssertTrue(encoded.contains("include_screenshot"))
    }
    func testAcknowledgementIsSmallAndNeverContainsImages() throws {
        let value = try ActionAcknowledgement(window: WindowIdentity(processID: 10, windowID: 20, generation: 1),
            revision: StateRevision(observed: 3, dispatched: 4), observedChange: false, backend: "fixture", observationID: "s").result()
        XCTAssertLessThan(try value.jsonText().utf8.count, 2048)
        XCTAssertEqual(value.content.count, 1)
        XCTAssertEqual(value.content.first?.type, "text")
        XCTAssertNil(value.content.first?.data)
    }
}
