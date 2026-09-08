import Foundation

public struct ResultContent: Codable, Sendable, Equatable {
    public let type: String
    public let text: String?
    public let data: String?
    public let mimeType: String?
    public static func text(_ text: String) -> Self { Self(type: "text", text: text, data: nil, mimeType: nil) }
    public static func png(_ data: Data) -> Self { Self(type: "image", text: nil, data: data.base64EncodedString(), mimeType: "image/png") }
}

public struct ComputerResult: Codable, Sendable, Equatable {
    public let content: [ResultContent]
    public let isError: Bool
    public init(content: [ResultContent], isError: Bool = false) { self.content = content; self.isError = isError }
    public static func text(_ text: String) -> Self { Self(content: [.text(text)]) }
    public static func failure(_ error: RuntimeFailure) -> Self {
        let payload: JSONValue = .object([
            "ok": .bool(false), "error": .string(error.code.rawValue),
            "message": .string(error.message), "delivery": .string(error.delivery.rawValue),
            "retry_safe": .bool(error.delivery == .notDispatched),
        ])
        return Self(content: [.text((try? payload.jsonText()) ?? "Computer Use failed.")], isError: true)
    }
    /// Keep only small text results for duplicate-request replay. Reject image
    /// payloads before encoding; observations may contain megabytes of PNG/base64.
    /// The size measurement is injectable to test the no-image-encoding invariant.
    public func replayCacheEntry(
        maximumBytes: Int = 8192,
        measureEncodedBytes: (ComputerResult) throws -> Int = { try $0.jsonText().utf8.count }
    ) -> ComputerResult? {
        guard maximumBytes >= 0,
              content.allSatisfy({ $0.type == "text" && $0.data == nil }),
              let size = try? measureEncodedBytes(self), size >= 0, size <= maximumBytes else { return nil }
        return self
    }

    public func jsonText() throws -> String {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.withoutEscapingSlashes, .sortedKeys]
        return String(decoding: try encoder.encode(self), as: UTF8.self)
    }
}

public struct ActionAcknowledgement: Sendable {
    public let window: WindowIdentity
    public let revision: StateRevision
    public let observedChange: Bool
    public let backend: String
    public let observationID: String
    public init(window: WindowIdentity, revision: StateRevision, observedChange: Bool, backend: String, observationID: String) {
        self.window = window; self.revision = revision; self.observedChange = observedChange
        self.backend = backend; self.observationID = observationID
    }
    public func result() throws -> ComputerResult {
        // String revisions avoid loss of UInt64 precision in JavaScript consumers.
        .text(try JSONValue.object([
            "ok": .bool(true), "delivery": .string("dispatched"),
            "state_version": .string(String(revision.observed)),
            "command_version": .string(String(revision.dispatched)),
            "state_changed": .bool(observedChange), "observed_change": .bool(observedChange),
            "backend": .string(backend), "window_id": .number(Double(window.windowID)),
            "snapshot_id": .string(observationID),
            "observation_required": .string("Call get_app_state when the next action depends on changed UI."),
        ]).jsonText())
    }
}
