@preconcurrency import ApplicationServices
import CoreGraphics
import Foundation
import CozeaComputerUseCore

/// The registry caches identity, not permission to click. Mutations revalidate
/// ownership and geometry after acquiring the input lease and after cursor travel.
final class WindowRegistry: @unchecked Sendable {
    let worker = NativeWorker("accessibility")
    private var generations: [UInt32: (launch: String, element: AXUIElement, generation: UInt64)] = [:]
    private var serial: UInt64 = 0
    private var accessibilityEnabled: Set<String> = []

    func resolve(app: AppDescriptor, control: ActionControl) async throws -> WindowHandle {
        try await worker.run { [self] in
            try control.check()
            guard AXIsProcessTrusted() else { throw RuntimeFailure(.permissionDenied, "Accessibility permission is required.") }
            let application = AXUIElementCreateApplication(app.pid)
            if accessibilityEnabled.insert(app.launchIdentity).inserted {
                _ = AXUIElementSetAttributeValue(application, "AXManualAccessibility" as CFString, kCFBooleanTrue)
                _ = AXUIElementSetAttributeValue(application, "AXEnhancedUserInterface" as CFString, kCFBooleanTrue)
            }
            let windows = AXAccess.elements(application, kAXWindowsAttribute)
            let focused = AXAccess.element(application, kAXFocusedWindowAttribute)
            let selected = ([focused].compactMap { $0 } + windows).first { element in
                (AXAccess.value(element, kAXMinimizedAttribute) as? Bool) != true && AXAccess.frame(element) != nil
            }
            guard let window = selected, let bounds = AXAccess.frame(window) else {
                throw RuntimeFailure(.staleWindow, "The target has no visible accessible window. Open or unminimize it first.")
            }
            let title = AXAccess.string(window, kAXTitleAttribute) ?? app.name
            let candidates = Self.windowInfo(pid: app.pid)
            let matches = candidates.filter { info in
                guard let raw = info[kCGWindowBounds as String] as? NSDictionary,
                      let cgBounds = CGRect(dictionaryRepresentation: raw as CFDictionary) else { return false }
                return bounds.coreRectangle.approximatelyEquals(cgBounds.coreRectangle, tolerance: 3)
            }
            let exactTitles = matches.filter { ($0[kCGWindowName as String] as? String) == title }
            let chosen: [String: Any]?
            if exactTitles.count == 1 { chosen = exactTitles.first }
            else if matches.count == 1 { chosen = matches.first }
            else { chosen = nil }
            guard let info = chosen, let number = info[kCGWindowNumber as String] as? NSNumber else {
                throw RuntimeFailure(.staleWindow, "Cannot uniquely match the accessibility window to WindowServer. Bring the target window into view.")
            }
            let id = number.uint32Value
            let generation: UInt64
            if let existing = generations[id], existing.launch == app.launchIdentity, CFEqual(existing.element, window) {
                generation = existing.generation
            } else {
                serial += 1; generation = serial
                generations[id] = (app.launchIdentity, window, generation)
            }
            if generations.count > 128 {
                generations = generations.filter { key, _ in Self.windowExists(id: key) }
            }
            try control.check()
            return WindowHandle(identity: WindowIdentity(processID: app.pid, windowID: id, generation: generation),
                                app: app, application: application, element: window, bounds: bounds,
                                title: title, layer: (info[kCGWindowLayer as String] as? Int) ?? 0)
        }
    }

    func validate(_ window: WindowHandle, control: ActionControl) async throws {
        guard await AppDirectory.shared.isCurrent(window.app) else { throw RuntimeFailure(.staleWindow, "The application restarted. Call get_app_state.") }
        try await worker.run {
            try control.check()
            try Self.validateNow(window)
        }
    }
    static func validateNow(_ window: WindowHandle) throws {
        guard let info = windowInfo(pid: window.app.pid).first(where: {
            ($0[kCGWindowNumber as String] as? NSNumber)?.uint32Value == window.identity.windowID
        }), let raw = info[kCGWindowBounds as String] as? NSDictionary,
           let current = CGRect(dictionaryRepresentation: raw as CFDictionary),
           current.coreRectangle.approximatelyEquals(window.bounds.coreRectangle),
           let axFrame = AXAccess.frame(window.element),
           axFrame.coreRectangle.approximatelyEquals(window.bounds.coreRectangle) else {
            throw RuntimeFailure(.staleWindow, "The window moved, resized, closed, or changed ownership. Call get_app_state.")
        }
        _ = try AXAccess.validate(window.element, pid: window.app.pid)
    }
    static func windowInfo(pid: pid_t) -> [[String: Any]] {
        let info = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? []
        return info.filter {
            ($0[kCGWindowOwnerPID as String] as? NSNumber)?.int32Value == pid &&
            ($0[kCGWindowIsOnscreen as String] as? NSNumber)?.boolValue == true &&
            ($0[kCGWindowLayer as String] as? Int) == 0
        }
    }
    private static func windowExists(id: UInt32) -> Bool {
        !(CGWindowListCopyWindowInfo(.optionIncludingWindow, id) as? [[String: Any]] ?? []).isEmpty
    }
    func reset() async { _ = try? await worker.run { [self] in generations.removeAll(); accessibilityEnabled.removeAll() } }
}
