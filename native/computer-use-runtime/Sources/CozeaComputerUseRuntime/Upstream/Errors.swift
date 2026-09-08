// Adapted from iFurySt/open-codex-computer-use, revision 41c5294cfe4735baca03f9c82b4de99d191a0b49.
// AGPL-3.0-or-later; see native/computer-use-runtime/LICENSE.upstream.txt and docs/computer-use-v2.md.

import Foundation

let computerUseNoWindowFoundMessage = "Apple event error -10005: cgWindowNotFound"

public enum ComputerUseError: Error, LocalizedError {
    case message(String)
    case unsupportedTool(String)
    case invalidArguments(String)
    case appNotFound(String)
    case permissionDenied(String)
    case stateUnavailable(String)

    public var errorDescription: String? {
        switch self {
        case .message(let value):
            return value
        case .unsupportedTool(let name):
            return "unsupportedTool(\"\(name)\")"
        case .invalidArguments(let message):
            return "invalidArguments(\"\(message)\")"
        case .appNotFound(let app):
            return "appNotFound(\"\(app)\")"
        case .permissionDenied(let message):
            return message
        case .stateUnavailable(let message):
            return message
        }
    }

    var toolResultIsError: Bool {
        true
    }
}

extension ComputerUseError {
    static func missingArgument(_ name: String) -> ComputerUseError {
        .message("Missing required argument: \(name)")
    }
}
