import ApplicationServices
import CoreGraphics
import Darwin
import Foundation
import OpenComputerUseKit

private let upstreamVersion = "0.3.3"
private let upstreamRevision = "41c5294cfe4735baca03f9c82b4de99d191a0b49"

private final class ComputerUseRuntimeStore: @unchecked Sendable {
    static let shared = ComputerUseRuntimeStore()

    private let lock = NSLock()
    private var servers: [String: StdioMCPServer] = [:]

    private func server(for sessionID: String) -> StdioMCPServer {
        lock.lock()
        defer { lock.unlock() }
        if let existing = servers[sessionID] {
            return existing
        }
        let created = StdioMCPServer()
        servers[sessionID] = created
        return created
    }

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

    func listTools() throws -> String {
        try encodeJSON([
            "tools": ToolDefinitions.all.map(\.asDictionary),
            "upstreamVersion": upstreamVersion,
            "upstreamRevision": upstreamRevision,
        ])
    }

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

    func reset(sessionID: String) {
        lock.lock()
        let server = servers.removeValue(forKey: sessionID)
        lock.unlock()
        if server != nil {
            // The upstream MCP notification owns visual-cursor cleanup.
            turnEndedDetached(server: server!)
        }
    }

    func resetAll() {
        lock.lock()
        let existing = Array(servers.values)
        servers.removeAll()
        lock.unlock()
        for server in existing {
            turnEndedDetached(server: server)
        }
    }

    private func turnEndedDetached(server: StdioMCPServer) {
        let request = "{\"jsonrpc\":\"2.0\",\"method\":\"notifications/turn-ended\",\"params\":{}}"
        _ = server.handle(line: request)
    }
}

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

private func copyCString(_ text: String) -> UnsafeMutablePointer<CChar>? {
    strdup(text)
}

private func errorJSON(_ error: Error) -> String {
    let message = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
    return (try? encodeJSON([
        "content": [["type": "text", "text": message]],
        "isError": true,
    ])) ?? "{\"content\":[{\"type\":\"text\",\"text\":\"Computer Use failed.\"}],\"isError\":true}"
}

private func string(_ pointer: UnsafePointer<CChar>?) -> String? {
    guard let pointer else { return nil }
    return String(cString: pointer)
}

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

@_cdecl("cozea_computer_use_list_tools")
public func cozeaComputerUseListTools() -> UnsafeMutablePointer<CChar>? {
    do {
        return copyCString(try ComputerUseRuntimeStore.shared.listTools())
    } catch {
        return copyCString(errorJSON(error))
    }
}

@_cdecl("cozea_computer_use_turn_ended")
public func cozeaComputerUseTurnEnded(_ sessionIDPointer: UnsafePointer<CChar>?) {
    guard let sessionID = string(sessionIDPointer), !sessionID.isEmpty else { return }
    ComputerUseRuntimeStore.shared.turnEnded(sessionID: sessionID)
}

@_cdecl("cozea_computer_use_reset_session")
public func cozeaComputerUseResetSession(_ sessionIDPointer: UnsafePointer<CChar>?) {
    guard let sessionID = string(sessionIDPointer), !sessionID.isEmpty else { return }
    ComputerUseRuntimeStore.shared.reset(sessionID: sessionID)
}

@_cdecl("cozea_computer_use_reset_all")
public func cozeaComputerUseResetAll() {
    ComputerUseRuntimeStore.shared.resetAll()
}

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

@_cdecl("cozea_computer_use_free")
public func cozeaComputerUseFree(_ pointer: UnsafeMutablePointer<CChar>?) {
    guard let pointer else { return }
    free(pointer)
}
