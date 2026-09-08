@preconcurrency import ApplicationServices
import CoreGraphics
import Foundation
import CozeaComputerUseCore

/// Explicit, bounded AX messaging helpers. No raw screen/control text is logged.
struct AXElementFingerprint: Sendable, Equatable {
    let role: String?
    let identifier: String?
    let title: String?
    let description: String?
}

enum AXAccess {
    /// Configure the exact queried object before every cross-process read. AX
    /// timeouts are not inherited by descendants. Injection keeps ordering and
    /// cancellation tests independent of desktop permissions or a responsive app.
    static func read<T>(
        _ element: AXUIElement,
        configureTimeout: (AXUIElement, Float) -> AXError = AXUIElementSetMessagingTimeout,
        _ operation: () -> T?
    ) -> T? {
        let timeout: Float
        if let budget = AXReadBudget.current {
            guard let remaining = budget.remainingTimeout() else { return nil }
            timeout = remaining
        } else { timeout = 0.1 }
        guard configureTimeout(element, timeout) == .success else { return nil }
        // Revocation/deadline may have occurred while configuring the object.
        if let budget = AXReadBudget.current, budget.remainingTimeout() == nil { return nil }
        return operation()
    }

    static func fingerprint(_ element: AXUIElement) -> AXElementFingerprint {
        func bounded(_ attribute: String) -> String? { string(element, attribute).map { String($0.prefix(256)) } }
        return AXElementFingerprint(role: bounded(kAXRoleAttribute), identifier: bounded(kAXIdentifierAttribute),
                                    title: bounded(kAXTitleAttribute), description: bounded(kAXDescriptionAttribute))
    }
    static func value(_ element: AXUIElement, _ attribute: String) -> CFTypeRef? {
        read(element) {
            var value: CFTypeRef?
            return AXUIElementCopyAttributeValue(element, attribute as CFString, &value) == .success ? value : nil
        }
    }
    static func string(_ element: AXUIElement, _ attribute: String) -> String? { value(element, attribute) as? String }
    static func element(_ element: AXUIElement, _ attribute: String) -> AXUIElement? {
        guard let raw = value(element, attribute), CFGetTypeID(raw) == AXUIElementGetTypeID() else { return nil }
        return (raw as! AXUIElement)
    }
    static func elements(_ element: AXUIElement, _ attribute: String) -> [AXUIElement] {
        guard let values = value(element, attribute) as? [AnyObject] else { return [] }
        return values.compactMap { CFGetTypeID($0) == AXUIElementGetTypeID() ? ($0 as! AXUIElement) : nil }
    }
    static func frame(_ element: AXUIElement) -> CGRect? {
        guard let p = value(element, kAXPositionAttribute), CFGetTypeID(p) == AXValueGetTypeID(),
              let s = value(element, kAXSizeAttribute), CFGetTypeID(s) == AXValueGetTypeID() else { return nil }
        var origin = CGPoint.zero; var size = CGSize.zero
        guard AXValueGetValue(p as! AXValue, .cgPoint, &origin), AXValueGetValue(s as! AXValue, .cgSize, &size) else { return nil }
        let result = CGRect(origin: origin, size: size)
        return result.coreRectangle.isValid ? result : nil
    }
    static func actions(_ element: AXUIElement) -> [String] {
        read(element) {
            var values: CFArray?
            guard AXUIElementCopyActionNames(element, &values) == .success else { return nil }
            return values as? [String]
        } ?? []
    }
    static func settable(_ element: AXUIElement, _ attribute: String) -> Bool {
        read(element) {
            var settable = DarwinBoolean(false)
            guard AXUIElementIsAttributeSettable(element, attribute as CFString, &settable) == .success else { return nil }
            return settable.boolValue
        } ?? false
    }
    static func requireOrdinary(_ element: AXUIElement) throws {
        if string(element, kAXSubroleAttribute) == "AXSecureTextField" {
            throw RuntimeFailure(.permissionDenied, "Secure text controls are excluded from Computer Use.")
        }
    }
    static func validate(_ element: AXUIElement, pid: pid_t) throws -> String {
        var actualPID: pid_t = 0
        guard AXUIElementGetPid(element, &actualPID) == .success, actualPID == pid,
              let role = string(element, kAXRoleAttribute) else {
            throw RuntimeFailure(.staleElement, "The accessibility element is no longer valid. Call get_app_state.")
        }
        try requireOrdinary(element)
        return role
    }
}
