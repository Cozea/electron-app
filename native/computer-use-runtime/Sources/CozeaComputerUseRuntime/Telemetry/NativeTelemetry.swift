import Foundation
import OSLog

/// Stage names and numeric counters only: never log text, screenshots, paths,
/// credentials, arguments, accessibility labels, or unredacted errors.
enum NativeTelemetry {
    static let logger = Logger(subsystem: "com.cozea.desktop", category: "ComputerUse")
    static let signposter = OSSignposter(subsystem: "com.cozea.desktop", category: "ComputerUse")
    final class Span: @unchecked Sendable {
        let stage: String
        let start = ContinuousClock.now
        let state: OSSignpostIntervalState
        private let ended = LockedValue(false)
        init(stage: String) {
            self.stage = stage
            state = signposter.beginInterval("ComputerUse", "stage=\(stage, privacy: .public)")
        }
        func end() {
            guard ended.withLock({ was in if was { return false }; was = true; return true }) else { return }
            signposter.endInterval("ComputerUse", state)
            let duration = start.duration(to: .now)
            let ms = Double(duration.components.seconds) * 1000 + Double(duration.components.attoseconds) / 1e15
            logger.debug("stage=\(self.stage, privacy: .public) ms=\(ms, privacy: .public)")
        }
        deinit { end() }
    }
    static func span(_ stage: String) -> Span { Span(stage: stage) }
    static func count(_ name: String, _ value: Int) { logger.debug("counter=\(name, privacy: .public) value=\(value, privacy: .public)") }
    static func failure(_ code: String) { logger.error("failure=\(code, privacy: .public)") }
}
