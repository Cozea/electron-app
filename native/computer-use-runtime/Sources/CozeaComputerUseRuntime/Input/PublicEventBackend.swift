@preconcurrency import ApplicationServices
import CoreGraphics
import Foundation
import CozeaComputerUseCore

extension MouseButton {
    var cg: CGMouseButton { switch self { case .left: .left; case .right: .right; case .middle: .center } }
    var down: CGEventType { switch self { case .left: .leftMouseDown; case .right: .rightMouseDown; case .middle: .otherMouseDown } }
    var up: CGEventType { switch self { case .left: .leftMouseUp; case .right: .rightMouseUp; case .middle: .otherMouseUp } }
}

/// Public PID posting does not move the hardware pointer. Global HID delivery is
/// a distinct, explicitly authorized operation, never an unconditional fallback.
enum PublicEventBackend {
    static func mouseEvent(_ type: CGEventType, at point: CGPoint, button: MouseButton = .left, count: Int = 1) throws -> CGEvent {
        guard let source = CGEventSource(stateID: .privateState),
              let event = CGEvent(mouseEventSource: source, mouseType: type, mouseCursorPosition: point, mouseButton: button.cg) else {
            throw RuntimeFailure(.backendUnavailable, "Cannot allocate a public pointer event.")
        }
        event.flags = []
        event.setIntegerValueField(.mouseEventClickState, value: Int64(count))
        return event
    }
    static func post(_ event: CGEvent, pid: pid_t, global: Bool = false) {
        if global { event.post(tap: .cghidEventTap) } else { event.postToPid(pid) }
    }
    static func click(_ target: PointerTarget, button: MouseButton, count: Int, global: Bool, control: ActionControl) throws {
        if global && !control.allowGlobalPointer { throw RuntimeFailure(.permissionDenied, "Global pointer delivery is disabled.") }
        let pairs = try (1...count).map { i in
            (try mouseEvent(button.down, at: target.globalPoint, button: button, count: i),
             try mouseEvent(button.up, at: target.globalPoint, button: button, count: i))
        }
        for (down, up) in pairs {
            try control.markDispatch()
            post(down, pid: target.window.processID, global: global)
            // Always release even if revocation arrives after mouseDown.
            post(up, pid: target.window.processID, global: global)
        }
    }
    static func scroll(_ target: PointerTarget, direction: ScrollDirection, pages: Double, control: ActionControl) throws {
        let amount = Int32(min(max(pages * 600, 1), 12_000))
        let y: Int32 = direction == .up ? amount : direction == .down ? -amount : 0
        let x: Int32 = direction == .left ? amount : direction == .right ? -amount : 0
        guard let event = CGEvent(scrollWheelEvent2Source: nil, units: .pixel, wheelCount: 2, wheel1: y, wheel2: x, wheel3: 0) else {
            throw RuntimeFailure(.backendUnavailable, "Cannot allocate a scroll event.")
        }
        event.location = target.globalPoint; event.flags = []
        try control.markDispatch(); event.postToPid(target.window.processID)
    }
    static func typeChunk(_ units: [UInt16], pid: pid_t, control: ActionControl) throws {
        guard let source = CGEventSource(stateID: .privateState),
              let down = CGEvent(keyboardEventSource: source, virtualKey: 0, keyDown: true),
              let up = CGEvent(keyboardEventSource: source, virtualKey: 0, keyDown: false) else {
            throw RuntimeFailure(.backendUnavailable, "Cannot allocate a keyboard event.")
        }
        units.withUnsafeBufferPointer { buffer in
            guard let base = buffer.baseAddress else { return }
            down.keyboardSetUnicodeString(stringLength: buffer.count, unicodeString: base)
            up.keyboardSetUnicodeString(stringLength: buffer.count, unicodeString: base)
        }
        down.flags = []; up.flags = []
        try control.markDispatch(); down.postToPid(pid); up.postToPid(pid)
    }
    static func key(_ specification: String, pid: pid_t, control: ActionControl) throws {
        let parsed = try KeyPressParser.parse(specification)
        guard let source = CGEventSource(stateID: .privateState) else { throw RuntimeFailure(.backendUnavailable, "Cannot allocate a keyboard source.") }
        func event(_ key: CGKeyCode, down: Bool, flags: CGEventFlags) throws -> CGEvent {
            guard let event = CGEvent(keyboardEventSource: source, virtualKey: key, keyDown: down) else {
                throw RuntimeFailure(.backendUnavailable, "Cannot allocate a key event.")
            }
            event.flags = flags; return event
        }
        var flags: CGEventFlags = []
        var downs: [CGEvent] = []; var releases: [CGEvent] = []
        for modifier in parsed.modifiers {
            flags.insert(modifier.flag)
            downs.append(try event(modifier.keyCode, down: true, flags: flags))
        }
        downs.append(try event(parsed.keyCode, down: true, flags: flags))
        releases.append(try event(parsed.keyCode, down: false, flags: flags))
        for modifier in parsed.modifiers.reversed() {
            flags.remove(modifier.flag)
            releases.append(try event(modifier.keyCode, down: false, flags: flags))
        }
        var began = false
        defer { if began { releases.forEach { $0.postToPid(pid) } } }
        for down in downs { try control.markDispatch(); began = true; down.postToPid(pid) }
    }
}
