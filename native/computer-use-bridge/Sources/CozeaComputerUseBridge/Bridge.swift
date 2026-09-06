import ApplicationServices
import CoreGraphics
import Darwin
import Foundation
import OpenComputerUseKit

private let upstreamVersion = "0.3.3"
private let upstreamRevision = "41c5294cfe4735baca03f9c82b4de99d191a0b49"

/// Thread-safe wrapper around OpenComputerUseKit's StdioMCPServer for concurrent access.
private final class LockedMCPServer: @unchecked Sendable {
    private let lock = NSLock()
    private let server = StdioMCPServer()

    /// Handles a single line of MCP protocol input with thread-safe locking.
    /// - Parameter line: JSON-RPC request or notification line
    /// - Returns: JSON-RPC response line, or nil for notifications
    func handle(line: String) -> String? {
        lock.lock()
        defer { lock.unlock() }
        return server.handle(line: line)
    }
}

/// Manages per-session Computer Use MCP servers, providing session isolation for concurrent agent threads.
private final class ComputerUseRuntimeStore: @unchecked Sendable {
    static let shared = ComputerUseRuntimeStore()

    private let lock = NSLock()
    private var servers: [String: LockedMCPServer] = [:]

    /// Returns an existing MCP server for the session or creates a new one.
    /// - Parameter sessionID: Unique session identifier
    /// - Returns: Thread-safe MCP server for the session
    private func server(for sessionID: String) -> LockedMCPServer {
        lock.lock()
        defer { lock.unlock() }
        if let existing = servers[sessionID] {
            return existing
        }
        let created = LockedMCPServer()
        servers[sessionID] = created
        return created
    }

    /// Invokes a Computer Use tool via JSON-RPC on the session's MCP server.
    /// - Parameters:
    ///   - sessionID: Session identifier for state isolation
    ///   - tool: Tool name to invoke
    ///   - argumentsJSON: JSON string containing tool arguments
    /// - Returns: JSON string containing the MCP tool result
    /// - Throws: NSError if arguments are invalid, the tool call fails, or JSON encoding fails
    func call(sessionID: String, tool: String, argumentsJSON: String) throws -> String {
        let argumentsData = Data(argumentsJSON.utf8)
        let arguments = try JSONSerialization.jsonObject(with: argumentsData)
        guard let argumentsObject = arguments as? [String: Any] else {
            throw NSError(
                domain: "CozeaComputerUseBridge",
                code: 1,
                userInfo: [NSLocalizedDescriptionKey: "Computer Use arguments must be a JSON object."]
            )
        }

        let request: [String: Any] = [
            "jsonrpc": "2.0",
            "id": 1,
            "method": "tools/call",
            "params": [
                "name": tool,
                "arguments": argumentsObject,
            ],
        ]
        let requestData = try JSONSerialization.data(withJSONObject: request, options: [.withoutEscapingSlashes])
        guard let requestText = String(data: requestData, encoding: .utf8),
              let responseText = server(for: sessionID).handle(line: requestText) else {
            throw NSError(
                domain: "CozeaComputerUseBridge",
                code: 2,
                userInfo: [NSLocalizedDescriptionKey: "OpenComputerUseKit returned no tool response."]
            )
        }

        let responseData = Data(responseText.utf8)
        guard let response = try JSONSerialization.jsonObject(with: responseData) as? [String: Any] else {
            throw NSError(
                domain: "CozeaComputerUseBridge",
                code: 3,
                userInfo: [NSLocalizedDescriptionKey: "OpenComputerUseKit returned invalid JSON-RPC."]
            )
        }
        if let result = response["result"] as? [String: Any] {
            return try encodeJSON(result)
        }
        if let error = response["error"] as? [String: Any] {
            let message = error["message"] as? String ?? "OpenComputerUseKit tool call failed."
            return try encodeJSON([
                "content": [["type": "text", "text": message]],
                "isError": true,
            ])
        }
        throw NSError(
            domain: "CozeaComputerUseBridge",
            code: 4,
            userInfo: [NSLocalizedDescriptionKey: "OpenComputerUseKit returned neither result nor error."]
        )
    }

    /// Returns the list of available Computer Use tools and version information.
    /// - Returns: JSON string containing tool definitions and upstream version metadata
    /// - Throws: NSError if JSON encoding fails
    func listTools() throws -> String {
        try encodeJSON([
            "tools": ToolDefinitions.all.map(\.asDictionary),
            "upstreamVersion": upstreamVersion,
            "upstreamRevision": upstreamRevision,
        ])
    }

    /// Notifies the session's MCP server that the current agent turn has ended.
    /// This allows cleanup of visual state like on-screen cursors.
    /// - Parameter sessionID: Session identifier
    func turnEnded(sessionID: String) {
        let request: [String: Any] = [
            "jsonrpc": "2.0",
            "method": "notifications/turn-ended",
            "params": [:],
        ]
        guard let requestData = try? JSONSerialization.data(withJSONObject: request),
              let requestText = String(data: requestData, encoding: .utf8) else {
            return
        }
        _ = server(for: sessionID).handle(line: requestText)
    }

    /// Resets a specific session by removing its MCP server and sending a turn-ended notification.
    /// - Parameter sessionID: Session identifier to reset
    func reset(sessionID: String) {
        lock.lock()
        let server = servers.removeValue(forKey: sessionID)
        lock.unlock()
        if let server {
            // The upstream MCP notification owns visual-cursor cleanup.
            turnEndedDetached(server: server)
        }
    }

    /// Resets all sessions by removing all MCP servers and sending turn-ended notifications to each.
    func resetAll() {
        lock.lock()
        let existing = Array(servers.values)
        servers.removeAll()
        lock.unlock()
        for server in existing {
            turnEndedDetached(server: server)
        }
    }

    /// Sends a turn-ended notification to a server without waiting for a response.
    /// - Parameter server: MCP server to notify
    private func turnEndedDetached(server: LockedMCPServer) {
        let request = "{\"jsonrpc\":\"2.0\",\"method\":\"notifications/turn-ended\",\"params\":{}}"
        _ = server.handle(line: request)
    }
}

/// Encodes a Swift object to a JSON string without escaping slashes.
/// - Parameter object: Object to encode
/// - Returns: JSON string representation
/// - Throws: NSError if encoding fails
private func encodeJSON(_ object: Any) throws -> String {
    let data = try JSONSerialization.data(withJSONObject: object, options: [.withoutEscapingSlashes])
    guard let text = String(data: data, encoding: .utf8) else {
        throw NSError(
            domain: "CozeaComputerUseBridge",
            code: 5,
            userInfo: [NSLocalizedDescriptionKey: "Failed to encode Computer Use JSON response."]
        )
    }
    return text
}

/// Creates a malloc'd C string copy that the caller must free.
/// - Parameter text: Swift string to copy
/// - Returns: Pointer to the C string copy
private func copyCString(_ text: String) -> UnsafeMutablePointer<CChar>? {
    strdup(text)
}

/// Converts an error to a JSON-encoded Computer Use error result.
/// - Parameter error: Error to encode
/// - Returns: JSON string representing the error as a tool result
private func errorJSON(_ error: Error) -> String {
    let message = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
    return (try? encodeJSON([
        "content": [["type": "text", "text": message]],
        "isError": true,
    ])) ?? "{\"content\":[{\"type\":\"text\",\"text\":\"Computer Use failed.\"}],\"isError\":true}"
}

/// Safely converts a C string pointer to a Swift String.
/// - Parameter pointer: Pointer to a null-terminated C string
/// - Returns: Swift String, or nil if the pointer is null
private func string(_ pointer: UnsafePointer<CChar>?) -> String? {
    guard let pointer else { return nil }
    return String(cString: pointer)
}

/// C-exported function that invokes a Computer Use tool for a given session.
/// - Parameters:
///   - sessionIDPointer: C string session identifier
///   - toolPointer: C string tool name
///   - argumentsPointer: C string JSON arguments
/// - Returns: Malloc'd C string containing JSON-encoded tool result (caller must free)
@_cdecl("cozea_computer_use_call")
public func cozeaComputerUseCall(
    _ sessionIDPointer: UnsafePointer<CChar>?,
    _ toolPointer: UnsafePointer<CChar>?,
    _ argumentsPointer: UnsafePointer<CChar>?
) -> UnsafeMutablePointer<CChar>? {
    guard let sessionID = string(sessionIDPointer), !sessionID.isEmpty,
          let tool = string(toolPointer), !tool.isEmpty,
          let argumentsJSON = string(argumentsPointer) else {
        return copyCString("{\"content\":[{\"type\":\"text\",\"text\":\"Invalid Computer Use bridge arguments.\"}],\"isError\":true}")
    }
    do {
        return copyCString(
            try ComputerUseRuntimeStore.shared.call(
                sessionID: sessionID,
                tool: tool,
                argumentsJSON: argumentsJSON
            )
        )
    } catch {
        return copyCString(errorJSON(error))
    }
}

/// C-exported function that lists all available Computer Use tools.
/// - Returns: Malloc'd C string containing JSON-encoded tool list (caller must free)
@_cdecl("cozea_computer_use_list_tools")
public func cozeaComputerUseListTools() -> UnsafeMutablePointer<CChar>? {
    do {
        return copyCString(try ComputerUseRuntimeStore.shared.listTools())
    } catch {
        return copyCString(errorJSON(error))
    }
}

/// C-exported function that signals the end of an agent turn for a session.
/// - Parameter sessionIDPointer: C string session identifier
@_cdecl("cozea_computer_use_turn_ended")
public func cozeaComputerUseTurnEnded(_ sessionIDPointer: UnsafePointer<CChar>?) {
    guard let sessionID = string(sessionIDPointer), !sessionID.isEmpty else { return }
    ComputerUseRuntimeStore.shared.turnEnded(sessionID: sessionID)
}

/// C-exported function that resets a specific Computer Use session.
/// - Parameter sessionIDPointer: C string session identifier
@_cdecl("cozea_computer_use_reset_session")
public func cozeaComputerUseResetSession(_ sessionIDPointer: UnsafePointer<CChar>?) {
    guard let sessionID = string(sessionIDPointer), !sessionID.isEmpty else { return }
    ComputerUseRuntimeStore.shared.reset(sessionID: sessionID)
}

/// C-exported function that resets all Computer Use sessions.
@_cdecl("cozea_computer_use_reset_all")
public func cozeaComputerUseResetAll() {
    ComputerUseRuntimeStore.shared.resetAll()
}

/// C-exported function that returns Computer Use runtime diagnostics including permission status.
/// - Returns: Malloc'd C string containing JSON-encoded diagnostics (caller must free)
@_cdecl("cozea_computer_use_diagnostics")
public func cozeaComputerUseDiagnostics() -> UnsafeMutablePointer<CChar>? {
    let accessibility = AXIsProcessTrusted()
    let screenRecording = CGPreflightScreenCaptureAccess()
    do {
        return copyCString(try encodeJSON([
            "installed": true,
            "version": upstreamVersion,
            "upstreamRevision": upstreamRevision,
            "backend": "OpenComputerUseKit",
            "accessibility": accessibility,
            "screenRecording": screenRecording,
        ]))
    } catch {
        return copyCString(errorJSON(error))
    }
}

/// C-exported function that requests macOS system permissions for accessibility or screen recording.
/// - Parameter targetPointer: C string permission target ("accessibility" or "screenRecording")
/// - Returns: True if permission is granted or already held, false otherwise
@_cdecl("cozea_computer_use_request_permission")
public func cozeaComputerUseRequestPermission(_ targetPointer: UnsafePointer<CChar>?) -> Bool {
    guard let target = string(targetPointer) else { return false }
    switch target {
    case "accessibility":
        let promptKey = kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String
        let options = [promptKey: true] as CFDictionary
        return AXIsProcessTrustedWithOptions(options)
    case "screenRecording":
        if CGPreflightScreenCaptureAccess() { return true }
        return CGRequestScreenCaptureAccess()
    default:
        return false
    }
}

/// C-exported function that frees a C string previously returned by this bridge.
/// - Parameter pointer: Pointer to free
@_cdecl("cozea_computer_use_free")
public func cozeaComputerUseFree(_ pointer: UnsafeMutablePointer<CChar>?) {
    guard let pointer else { return }
    free(pointer)
}
