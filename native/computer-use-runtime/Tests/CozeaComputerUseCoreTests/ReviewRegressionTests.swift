import XCTest
@testable import CozeaComputerUseCore

final class ReviewRegressionTests: XCTestCase {
    func testClickTargetPresenceTruthTable() throws {
        for mask in 0..<8 {
            var arguments: [String: JSONValue] = ["app": .string("fixture")]
            if mask & 1 != 0 { arguments["element_index"] = .number(0) }
            if mask & 2 != 0 { arguments["x"] = .number(0) }
            if mask & 4 != 0 { arguments["y"] = .number(0) }
            if mask == 1 || mask == 6 {
                XCTAssertNoThrow(try ToolRequest(tool: "click", arguments: arguments), "mask=\(mask)")
            } else {
                XCTAssertThrowsError(try ToolRequest(tool: "click", arguments: arguments), "mask=\(mask)") { error in
                    XCTAssertEqual((error as? RuntimeFailure)?.code, .invalidArguments)
                }
            }
        }
    }

    func testClickReportsMissingMixedAndPartialTargetsAccurately() {
        let cases = [
            (#"{"app":"test"}"#, "Provide either element_index or both x and y."),
            (#"{"app":"test","element_index":0,"x":1}"#, "Use either element_index or x/y, not both."),
            (#"{"app":"test","x":1}"#, "Coordinate targets require both x and y."),
            (#"{"app":"test","y":1}"#, "Coordinate targets require both x and y."),
        ]
        for (json, message) in cases {
            XCTAssertThrowsError(try ToolRequest(tool: "click", arguments: JSONValue.decodeObject(json))) { error in
                XCTAssertEqual((error as? RuntimeFailure)?.message, message)
            }
        }
    }

    func testImagesBypassReplayCacheSerialization() {
        for contents in [[ResultContent.png(Data([1]))], [.text("metadata"), .png(Data(repeating: 42, count: 1_000_000))]] {
            let result = ComputerResult(content: contents)
            XCTAssertNil(result.replayCacheEntry(measureEncodedBytes: { _ in
                XCTFail("Image observations must not be serialized for cache sizing")
                return 0
            }))
        }
    }

    func testTextReplayCacheUsesEncodedByteBoundaryAndRejectsEncodingFailure() throws {
        struct EncodingFailed: Error {}
        let result = ComputerResult.text("🙂\n\"ack\"")
        let byteCount = try result.jsonText().utf8.count
        XCTAssertEqual(result.replayCacheEntry(maximumBytes: byteCount), result)
        XCTAssertNil(result.replayCacheEntry(maximumBytes: byteCount - 1))
        XCTAssertNil(ComputerResult.text(String(repeating: "x", count: 8192)).replayCacheEntry())
        XCTAssertNil(result.replayCacheEntry(measureEncodedBytes: { _ in throw EncodingFailed() }))
        let failure = ComputerResult.failure(RuntimeFailure(.stateRequired, "Observe first."))
        XCTAssertEqual(failure.replayCacheEntry(), failure)
    }
}
