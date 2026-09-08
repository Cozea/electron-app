import XCTest
@testable import CozeaComputerUseCore

final class ContractTests: XCTestCase {
    func testClickRejectsAmbiguousAndBooleanCoordinates() throws {
        for text in [
            #"{"app":"test","element_index":1,"x":3,"y":4}"#,
            #"{"app":"test","x":true,"y":4}"#,
            #"{"app":"test","x":3}"#,
            #"{"app":"test","element_index":true}"#,
            #"{"app":"test","element_index":1,"click_count":1.5}"#,
            #"{"app":"test","element_index":1,"click_count":-1}"#,
            #"{"app":"test","x":3,"y":4,"click_method":"accessibility"}"#,
        ] { XCTAssertThrowsError(try ToolRequest(tool: "click", arguments: JSONValue.decodeObject(text)), text) }
    }
    func testStrictObservationOptionsAndEmptyText() throws {
        let request = try ToolRequest(tool: "get_app_state", arguments: JSONValue.decodeObject(#"{"app":"test","include_screenshot":false,"text_limit":"max"}"#))
        guard case .observe(_, let options) = request.operation else { return XCTFail() }
        XCTAssertNil(options.textLimit)
        XCTAssertFalse(options.includeScreenshot)
        XCTAssertTrue(options.includeText)
        XCTAssertThrowsError(try ToolRequest(tool: "get_app_state", arguments: JSONValue.decodeObject(#"{"app":"test","max_tree_nodes":true}"#)))
        XCTAssertNoThrow(try ToolRequest(tool: "type_text", arguments: JSONValue.decodeObject(#"{"app":"test","text":""}"#)))
    }
    func testCoordinateTransformAndEdges() throws {
        let map = ScreenshotGeometry(window: Rectangle(x: -1500, y: 120, width: 1000, height: 600), pixelWidth: 1280, pixelHeight: 768)
        XCTAssertEqual(try map.globalPoint(from: Point(x: 640, y: 384)), Point(x: -1000, y: 420))
        XCTAssertThrowsError(try map.globalPoint(from: Point(x: 1280, y: 0)))
        XCTAssertThrowsError(try map.globalPoint(from: Point(x: -.infinity, y: 0)))
        let display = DisplayGeometry(quartz: Rectangle(x: -1500, y: 120, width: 1500, height: 900), appKit: Rectangle(x: -1500, y: -120, width: 1500, height: 900))
        XCTAssertEqual(try display.appKitPoint(fromQuartz: Point(x: -750, y: 570)), Point(x: -750, y: 330))
    }
    func testAckDoesNotClaimObservedChangeForDispatch() throws {
        let result = try ActionAcknowledgement(window: WindowIdentity(processID: 2, windowID: 3, generation: 1), revision: StateRevision(observed: 0, dispatched: UInt64.max), observedChange: false, backend: "pid", observationID: "lease").result()
        XCTAssertFalse(result.isError)
        XCTAssertEqual(result.content.count, 1)
        let json = try JSONValue.decodeObject(XCTUnwrap(result.content.first?.text))
        XCTAssertEqual(json["state_changed"], .bool(false))
        XCTAssertEqual(json["command_version"], .string(String(UInt64.max)))
        XCTAssertLessThan(try result.jsonText().utf8.count, 2048)
        XCTAssertNil(result.content.first?.data)
    }
    func testOnlyDefinitePreDispatchUnavailabilityPermitsFallback() {
        XCTAssertTrue(RuntimeFailure(.backendUnavailable, "missing").permitsFallback)
        XCTAssertFalse(RuntimeFailure(.backendUnavailable, "uncertain", delivery: .unknown).permitsFallback)
        XCTAssertFalse(RuntimeFailure(.staleWindow, "gone").permitsFallback)
        XCTAssertFalse(RuntimeFailure(.ambiguousDelivery, "timeout", delivery: .unknown).permitsFallback)
    }
}
