import Foundation

public enum Delivery: String, Codable, Sendable {
    case notDispatched = "not_dispatched"
    case dispatched
    case unknown
}

/// An error after input submission MUST NOT trigger another backend or an automatic retry.
public struct RuntimeFailure: Error, LocalizedError, Codable, Sendable, Equatable {
    public enum Code: String, Codable, Sendable {
        case invalidArguments = "INVALID_ARGUMENTS"
        case unsupported = "UNSUPPORTED_PLATFORM"
        case permissionDenied = "PERMISSION_DENIED"
        case stateRequired = "STATE_REQUIRED"
        case staleElement = "STALE_ELEMENT"
        case staleWindow = "STALE_WINDOW"
        case staleObservation = "STALE_OBSERVATION"
        case focusChanged = "FOCUS_CHANGED"
        case cursorUnavailable = "CURSOR_UNAVAILABLE"
        case backendUnavailable = "BACKEND_UNAVAILABLE"
        case ambiguousDelivery = "DELIVERY_UNKNOWN"
        case cancelled = "CANCELLED"
        case timedOut = "TIMED_OUT"
        case busy = "BUSY"
        case invalidRequestID = "REQUEST_ID_REUSED"
        case internalError = "INTERNAL_ERROR"
    }

    public let code: Code
    public let message: String
    public let delivery: Delivery

    public init(_ code: Code, _ message: String, delivery: Delivery = .notDispatched) {
        self.code = code
        self.message = message
        self.delivery = delivery
    }

    public var errorDescription: String? { "\(code.rawValue): \(message)" }
    public var permitsFallback: Bool { code == .backendUnavailable && delivery == .notDispatched }
}
