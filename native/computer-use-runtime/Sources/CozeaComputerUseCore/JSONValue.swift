import Foundation

/// Typed boundary data: no [String: Any] is sent across Swift concurrency domains.
public enum JSONValue: Codable, Sendable, Equatable {
    case null
    case bool(Bool)
    case number(Double)
    case string(String)
    case array([JSONValue])
    case object([String: JSONValue])

    public init(from decoder: any Decoder) throws {
        let value = try decoder.singleValueContainer()
        if value.decodeNil() { self = .null }
        else if let x = try? value.decode(Bool.self) { self = .bool(x) }
        else if let x = try? value.decode(String.self) { self = .string(x) }
        else if let x = try? value.decode(Double.self), x.isFinite { self = .number(x) }
        else if let x = try? value.decode([JSONValue].self) { self = .array(x) }
        else { self = .object(try value.decode([String: JSONValue].self)) }
    }

    public func encode(to encoder: any Encoder) throws {
        var value = encoder.singleValueContainer()
        switch self {
        case .null: try value.encodeNil()
        case .bool(let x): try value.encode(x)
        case .number(let x): try value.encode(x)
        case .string(let x): try value.encode(x)
        case .array(let x): try value.encode(x)
        case .object(let x): try value.encode(x)
        }
    }

    public var string: String? { if case .string(let x) = self { x } else { nil } }
    public var number: Double? { if case .number(let x) = self { x } else { nil } }
    public var bool: Bool? { if case .bool(let x) = self { x } else { nil } }
    public var object: [String: JSONValue]? { if case .object(let x) = self { x } else { nil } }

    public static func decodeObject(_ text: String, maxBytes: Int = 2 * 1024 * 1024) throws -> [String: JSONValue] {
        guard text.utf8.count <= maxBytes, let data = text.data(using: .utf8) else {
            throw RuntimeFailure(.invalidArguments, "Request exceeds the UTF-8 payload limit.")
        }
        do {
            guard let object = try JSONDecoder().decode(JSONValue.self, from: data).object else {
                throw RuntimeFailure(.invalidArguments, "Arguments must be a JSON object.")
            }
            return object
        } catch let error as RuntimeFailure { throw error }
        catch { throw RuntimeFailure(.invalidArguments, "Arguments must be valid JSON.") }
    }

    public func jsonText() throws -> String {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        return String(decoding: try encoder.encode(self), as: UTF8.self)
    }
}
