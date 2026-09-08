import XCTest
import CoreGraphics
@testable import CozeaComputerUseRuntime

final class NativeUnitTests: XCTestCase {
    func testRecoveredMotionEndsAtTarget() {
        let start = CGPoint(x: 100, y: 100); let end = CGPoint(x: 600, y: 300)
        let candidates = HeadingDrivenCursorMotionModel.makeCandidates(start: start, end: end,
            bounds: CGRect(x: 0, y: 0, width: 1200, height: 900), startForward: CGVector(dx: 1, dy: 0), endForward: CGVector(dx: 1, dy: 0))
        let candidate = HeadingDrivenCursorMotionModel.chooseBestCandidate(from: candidates)
        XCTAssertNotNil(candidate)
        XCTAssertEqual(candidate?.path.sample(at: 0).point, start)
        XCTAssertEqual(candidate?.path.sample(at: 1).point, end)
        XCTAssertGreaterThan(OfficialCursorMotionModel.closeEnoughTime, 1)
        XCTAssertLessThan(OfficialCursorMotionModel.closeEnoughTime, 2)
    }
    func testKeyMappingAndSkyFocusRecordStayDeterministic() throws {
        XCTAssertEqual(try KeyPressParser.parse("super+c").modifiers.count, 1)
        let active = skyLightActivationRecord(windowID: 0x12345678, focused: true)
        XCTAssertEqual(active.count, 0xF8)
        XCTAssertEqual(Array(active[0x3C...0x3F]), [0x78, 0x56, 0x34, 0x12])
        XCTAssertEqual(active[0x8A], 1)
    }
}
