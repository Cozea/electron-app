@preconcurrency import ApplicationServices
import CoreGraphics
import Darwin
import Foundation
import CozeaComputerUseCore
import CozeaComputerUseRuntime

private final class BlockingResult<Value: Sendable>: @unchecked Sendable {
    private let lock = NSLock()
    private var result: Result<Value, any Error>?
    func put(_ value: Result<Value, any Error>) { lock.lock(); result = value; lock.unlock() }
    func get() throws -> Value {
        lock.lock(); defer { lock.unlock() }
        guard let result else { throw RuntimeFailure(.internalError, "Native operation produced no result.") }
        return try result.get()
    }
}

/// Only the Rust blocking pool may call this helper. Main-thread blocking/nested
/// run-loop pumping is forbidden: AppKit must keep presenting the causal cursor.
private func wait<Value: Sendable>(_ body: @escaping @Sendable () async throws -> Value) throws -> Value {
    guard !Thread.isMainThread else { throw RuntimeFailure(.internalError, "Async native operations require a worker thread.") }
    let semaphore = DispatchSemaphore(value: 0)
    let result = BlockingResult<Value>()
    Task {
        do { result.put(.success(try await body())) }
        catch { result.put(.failure(error)) }
        semaphore.signal()
    }
    semaphore.wait()
    return try result.get()
}
private func string(_ pointer: UnsafePointer<CChar>?) -> String? { pointer.map { String(cString: $0) } }
private func failure(_ error: any Error) -> UnsafeMutablePointer<CChar>? {
    let error = error as? RuntimeFailure ?? RuntimeFailure(.internalError, "Native Computer Use failed.")
    return strdup((try? ComputerResult.failure(error).jsonText()) ?? "{\"content\":[],\"isError\":true}")
}

@_cdecl("cozea_computer_use_configure")
public func configure(_ session: UnsafePointer<CChar>?, _ policy: UnsafePointer<CChar>?) -> Bool {
    guard let session = string(session), let policy = string(policy) else { return false }
    do { try MacComputerRuntime.shared.configure(session: session, policyJSON: policy); return true } catch { return false }
}
@_cdecl("cozea_computer_use_revoke_session")
public func revokeSession(_ session: UnsafePointer<CChar>?) {
    if let session = string(session) { MacComputerRuntime.shared.revoke(session: session) }
}
@_cdecl("cozea_computer_use_revoke_all")
public func revokeAll() { MacComputerRuntime.shared.revokeAll() }
@_cdecl("cozea_computer_use_cancel_request")
public func cancelRequest(_ session: UnsafePointer<CChar>?, _ request: UnsafePointer<CChar>?) {
    if let session = string(session), let request = string(request) { MacComputerRuntime.shared.cancelRequest(session: session, request: request) }
}
@_cdecl("cozea_computer_use_call")
public func call(_ session: UnsafePointer<CChar>?, _ tool: UnsafePointer<CChar>?, _ arguments: UnsafePointer<CChar>?, _ context: UnsafePointer<CChar>?) -> UnsafeMutablePointer<CChar>? {
    guard let session = string(session), let tool = string(tool), let arguments = string(arguments), let context = string(context) else {
        return failure(RuntimeFailure(.invalidArguments, "Invalid native bridge arguments."))
    }
    do { return strdup(try wait { await MacComputerRuntime.shared.call(session: session, tool: tool, argumentsJSON: arguments, contextJSON: context) }) }
    catch { return failure(error) }
}
@_cdecl("cozea_computer_use_list_tools")
public func listTools() -> UnsafeMutablePointer<CChar>? {
    do { return strdup(try ToolCatalogue.jsonText()) } catch { return failure(error) }
}
@_cdecl("cozea_computer_use_diagnostics")
public func diagnostics() -> UnsafeMutablePointer<CChar>? {
    do { return strdup(try wait { try await MacComputerRuntime.shared.diagnostics() }) } catch { return failure(error) }
}
@_cdecl("cozea_computer_use_turn_ended")
public func turnEnded(_ session: UnsafePointer<CChar>?) {
    guard let session = string(session) else { return }
    MacComputerRuntime.shared.revoke(session: session)
    _ = try? wait { await MacComputerRuntime.shared.end(session: session) }
}
@_cdecl("cozea_computer_use_reset_session")
public func resetSession(_ session: UnsafePointer<CChar>?) { turnEnded(session) }
@_cdecl("cozea_computer_use_reset_all")
public func resetAll() {
    MacComputerRuntime.shared.revokeAll()
    _ = try? wait { await MacComputerRuntime.shared.resetAll() }
}
@_cdecl("cozea_computer_use_request_permission")
public func requestPermission(_ target: UnsafePointer<CChar>?) -> Bool {
    guard Thread.isMainThread, let target = string(target) else { return false }
    switch target {
    case "accessibility": return AXIsProcessTrustedWithOptions(["AXTrustedCheckOptionPrompt": true] as CFDictionary)
    case "screenRecording": return CGPreflightScreenCaptureAccess() || CGRequestScreenCaptureAccess()
    default: return false
    }
}
@_cdecl("cozea_computer_use_free")
public func freeString(_ pointer: UnsafeMutablePointer<CChar>?) { if let pointer { free(pointer) } }
