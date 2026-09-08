import Foundation

public struct RuntimePolicy: Codable, Sendable, Equatable {
    public let revision: String
    public let allowedTools: Set<String>
    public let allowGlobalPointer: Bool
    public init(revision: String, allowedTools: Set<String>, allowGlobalPointer: Bool) {
        self.revision = revision; self.allowedTools = allowedTools; self.allowGlobalPointer = allowGlobalPointer
    }
}

/// Synchronous revocation is deliberately outside Swift actor scheduling. Electron
/// can revoke a request while its async task is queued, animating, or in AX IPC.
public final class AuthorizationRegistry: @unchecked Sendable {
    private struct Session {
        var revision: UInt64
        var policy: RuntimePolicy?
        var requests: [String: ActionControl] = [:]
        var cancelledRequestIDs: [String] = []
    }
    private let lock = NSLock()
    private var sessions: [String: Session] = [:]
    private let limit: Int
    public init(sessionLimit: Int = 64) { limit = max(1, sessionLimit) }

    public func configure(session: String, policy: RuntimePolicy) throws {
        guard !session.isEmpty, session.utf8.count <= 512,
              let revision = UInt64(policy.revision), revision > 0,
              policy.allowedTools.isSubset(of: Set(ComputerTool.allCases.map(\.rawValue))) else {
            throw RuntimeFailure(.invalidArguments, "Invalid native authorization policy.")
        }
        try locked {
            guard sessions[session] != nil || sessions.count < limit else {
                throw RuntimeFailure(.busy, "Native session limit reached.")
            }
            if let old = sessions[session] {
                guard revision >= old.revision else { throw RuntimeFailure(.permissionDenied, "Authorization revision is stale.") }
                if revision == old.revision {
                    guard old.policy == policy else { throw RuntimeFailure(.permissionDenied, "A revoked revision cannot be reused.") }
                    return
                }
                old.requests.values.forEach { $0.cancel() }
            }
            sessions[session] = Session(revision: revision, policy: policy)
        }
    }

    public func authorize(session: String, revision: String, tool: ComputerTool) throws {
        try locked {
            guard let policy = sessions[session]?.policy, policy.revision == revision, policy.allowedTools.contains(tool.rawValue) else {
                throw RuntimeFailure(.permissionDenied, "Computer Use authorization was revoked or changed.")
            }
        }
    }

    public func register(session: String, request: String, revision: String, tool: ComputerTool, timeout: Duration = .seconds(30)) throws -> ActionControl {
        try locked {
            guard var entry = sessions[session], let policy = entry.policy,
                  policy.revision == revision, policy.allowedTools.contains(tool.rawValue) else {
                throw RuntimeFailure(.permissionDenied, "Computer Use authorization was revoked or changed.")
            }
            guard !request.isEmpty, request.utf8.count <= 128, entry.requests[request] == nil else {
                throw RuntimeFailure(.invalidRequestID, "Request ID is invalid or already in flight.")
            }
            guard !entry.cancelledRequestIDs.contains(request) else {
                throw RuntimeFailure(.cancelled, "Request was cancelled before native admission.")
            }
            guard entry.requests.count < 32 else { throw RuntimeFailure(.busy, "Too many in-flight requests for this session.") }
            let control = ActionControl(allowGlobalPointer: policy.allowGlobalPointer, timeout: timeout)
            entry.requests[request] = control
            sessions[session] = entry
            return control
        }
    }

    public func finish(session: String, request: String, control: ActionControl) {
        locked {
            guard sessions[session]?.requests[request] === control else { return }
            sessions[session]?.requests.removeValue(forKey: request)
            if sessions[session]?.policy == nil && sessions[session]?.requests.isEmpty == true {
                sessions.removeValue(forKey: session)
            }
        }
    }
    public func cancelRequest(session: String, request: String) {
        locked {
            guard var entry = sessions[session], !request.isEmpty, request.utf8.count <= 128 else { return }
            entry.requests[request]?.cancel()
            if !entry.cancelledRequestIDs.contains(request) { entry.cancelledRequestIDs.append(request) }
            if entry.cancelledRequestIDs.count > 512 { entry.cancelledRequestIDs.removeFirst() }
            sessions[session] = entry
        }
    }
    public func revoke(session: String) {
        locked {
            guard var entry = sessions[session] else { return }
            entry.requests.values.forEach { $0.cancel() }
            entry.policy = nil
            sessions[session] = entry
        }
    }
    public func revokeAll() {
        locked {
            for key in Array(sessions.keys) {
                sessions[key]?.requests.values.forEach { $0.cancel() }
                sessions[key]?.policy = nil
            }
        }
    }
    /// Only after all tasks have unwound. A later explicit higher-revision policy
    /// may start a new session; stale queued requests still have no policy.
    public func forget(session: String) {
        locked {
            guard sessions[session]?.requests.isEmpty == true, sessions[session]?.policy == nil else { return }
            sessions.removeValue(forKey: session)
        }
    }
    private func locked<T>(_ body: () throws -> T) rethrows -> T {
        lock.lock(); defer { lock.unlock() }; return try body()
    }
}

public final class ActionControl: @unchecked Sendable {
    public let cancellation: OperationCancellation
    public let allowGlobalPointer: Bool
    private let lock = NSLock()
    private var submitted = false
    public init(allowGlobalPointer: Bool = false, timeout: Duration = .seconds(30)) {
        self.allowGlobalPointer = allowGlobalPointer
        self.cancellation = OperationCancellation(timeout: timeout)
    }
    public func cancel() { cancellation.cancel() }
    public func check() throws {
        do { try cancellation.check() }
        catch let failure as RuntimeFailure {
            throw RuntimeFailure(failure.code, failure.message, delivery: hasDispatched ? .unknown : .notDispatched)
        } catch {
            throw RuntimeFailure(.cancelled, "Computer Use was cancelled.", delivery: hasDispatched ? .unknown : .notDispatched)
        }
    }
    /// Must be called immediately before the first potentially side-effecting OS
    /// call. A void-returning event post is not an application acknowledgement.
    public func markDispatch() throws {
        try check()
        lock.lock(); submitted = true; lock.unlock()
    }
    public var hasDispatched: Bool { lock.lock(); defer { lock.unlock() }; return submitted }
    public func normalize(_ error: any Error) -> RuntimeFailure {
        if let error = error as? RuntimeFailure {
            return RuntimeFailure(error.code, error.message, delivery: hasDispatched ? .unknown : error.delivery)
        }
        return RuntimeFailure(.internalError, "Native Computer Use failed.", delivery: hasDispatched ? .unknown : .notDispatched)
    }
}
