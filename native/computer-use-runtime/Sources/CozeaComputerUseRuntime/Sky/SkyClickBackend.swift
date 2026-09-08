import CoreGraphics
import Foundation
import CozeaComputerUseCore

/// Private event ABI is isolated here. Conservative upstream timings are retained
/// until real application-family tests justify changing them. This is not an
/// OpenAI SDK and symbol presence is not a guarantee of delivery correctness.
enum SkyClickBackend {
    static var available: Bool {
        let major = ProcessInfo.processInfo.operatingSystemVersion.majorVersion
        return (14...26).contains(major) &&
            ProcessInfo.processInfo.environment["COZEA_CU_DISABLE_SKY"] != "1" && SkyLightSPI.shared.capability.isAvailable
    }
    static var diagnostics: [String: JSONValue] {
        ["available": .bool(available), "private_spi": .bool(true), "profile": .string("conservative-upstream-41c5294"),
         "missing_symbols": .array(SkyLightSPI.shared.capability.missingSymbols.map(JSONValue.string)),
         "os_version": .string(ProcessInfo.processInfo.operatingSystemVersionString),
         "compatibility": .string("Runtime symbol check; application delivery requires observation.")]
    }

    struct Step { let event: CGEvent; let delay: TimeInterval; let isDown: Bool; let isUp: Bool }

    /// Runs exclusively on the native input worker, never AppKit or a Swift actor
    /// executor. Once synthetic focus or any event is submitted, failures are
    /// delivery-unknown and MUST NOT trigger another click backend.
    static func click(_ target: PointerTarget, count: Int, frontmostPID: pid_t?, control: ActionControl) throws {
        guard available, (1...2).contains(count) else {
            throw RuntimeFailure(.backendUnavailable, "SkyLight is unavailable for this operation.")
        }
        guard CGRect(origin: .zero, size: target.windowBounds.size).contains(target.localPoint) else {
            throw RuntimeFailure(.backendUnavailable, "SkyLight requires a point inside the observed window.")
        }
        let spi = SkyLightSPI.shared
        guard let source = CGEventSource(stateID: .hidSystemState) else { throw RuntimeFailure(.backendUnavailable, "Cannot allocate an event source.") }
        let group = Int64(DispatchTime.now().uptimeNanoseconds % 1_000_000_000)
        func event(_ type: CGEventType, point: CGPoint, local: CGPoint, state: Int64, phase: Int64) throws -> CGEvent {
            guard let event = CGEvent(mouseEventSource: source, mouseType: type, mouseCursorPosition: point, mouseButton: .left) else {
                throw RuntimeFailure(.backendUnavailable, "Cannot allocate a targeted input event.")
            }
            let fields: [(UInt32, Int64)] = [(0, phase), (1, state), (3, 0), (7, 3),
                (40, Int64(target.window.processID)), (51, Int64(target.window.windowID)), (58, group),
                (91, Int64(target.window.windowID)), (92, Int64(target.window.windowID))]
            for (field, value) in fields { try spi.setIntegerField(event, field: field, value: value) }
            try spi.setWindowLocation(event, point: local)
            return event
        }
        let primer = CGPoint(x: -1, y: -1)
        var steps = [
            Step(event: try event(.mouseMoved, point: target.globalPoint, local: target.localPoint, state: 0, phase: 2), delay: 0.015, isDown: false, isUp: false),
            Step(event: try event(.leftMouseDown, point: primer, local: primer, state: 1, phase: 1), delay: 0.001, isDown: true, isUp: false),
            Step(event: try event(.leftMouseUp, point: primer, local: primer, state: 1, phase: 2), delay: 0.100, isDown: false, isUp: true),
        ]
        for index in 1...count {
            steps.append(Step(event: try event(.leftMouseDown, point: target.globalPoint, local: target.localPoint, state: Int64(index), phase: 3), delay: 0.001, isDown: true, isUp: false))
            steps.append(Step(event: try event(.leftMouseUp, point: target.globalPoint, local: target.localPoint, state: Int64(index), phase: 3), delay: index < count ? 0.080 : 0, isDown: false, isUp: true))
        }
        let release = try event(.leftMouseUp, point: target.globalPoint, local: target.localPoint, state: 1, phase: 3)
        let focus = frontmostPID == target.window.processID ? nil : try spi.prepareSyntheticTargetFocus(targetPID: target.window.processID, targetWindowID: target.window.windowID)
        var pressed = false
        var focusStarted = false
        var focusEnded = false
        defer {
            // Cleanup may submit only releases, never a second activating click.
            if pressed { try? spi.postToPid(release, pid: target.window.processID); release.postToPid(target.window.processID) }
            if focusStarted && !focusEnded, let focus { try? spi.endSyntheticTargetFocus(focus) }
        }
        try control.check()
        if let focus {
            try control.markDispatch(); focusStarted = true
            try spi.beginSyntheticTargetFocus(focus)
        }
        for step in steps {
            try control.check()
            try control.markDispatch()
            // The upstream Chromium recipe deliberately uses both channels.
            if step.isDown { pressed = true }
            try spi.postToPid(step.event, pid: target.window.processID)
            step.event.postToPid(target.window.processID)
            if step.isUp { pressed = false }
            if step.delay > 0 { Thread.sleep(forTimeInterval: step.delay) }
        }
        if let focus {
            Thread.sleep(forTimeInterval: 0.100)
            try spi.endSyntheticTargetFocus(focus); focusEnded = true
        }
    }
}
