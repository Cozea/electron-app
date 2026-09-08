@preconcurrency import ApplicationServices
import CoreGraphics
import CryptoKit
import QuartzCore
import Foundation
import CozeaComputerUseCore

public struct NativeCallContext: Codable, Sendable {
    public let requestID: String
    public let policyRevision: String
    public init(requestID: String, policyRevision: String) { self.requestID = requestID; self.policyRevision = policyRevision }
}

/// Public boundary consumed by the thin C ABI. Native policy revision changes
/// synchronously cancel controls; async teardown never grants extra authority.
public final class MacComputerRuntime: @unchecked Sendable {
    public static let shared = MacComputerRuntime()
    private let authorization: AuthorizationRegistry
    private let coordinator: RuntimeCoordinator
    private init() {
        let authorization = AuthorizationRegistry()
        self.authorization = authorization
        coordinator = RuntimeCoordinator(authorization: authorization)
    }
    public func configure(session: String, policyJSON: String) throws {
        guard policyJSON.utf8.count <= 16_384 else { throw RuntimeFailure(.invalidArguments, "Policy is too large.") }
        let policy = try JSONDecoder().decode(RuntimePolicy.self, from: Data(policyJSON.utf8))
        try authorization.configure(session: session, policy: policy)
    }
    public func call(session: String, tool: String, argumentsJSON: String, contextJSON: String) async -> String {
        do {
            guard contextJSON.utf8.count <= 4096 else { throw RuntimeFailure(.invalidArguments, "Call context is too large.") }
            let context = try JSONDecoder().decode(NativeCallContext.self, from: Data(contextJSON.utf8))
            let request = try ToolRequest(tool: tool, arguments: JSONValue.decodeObject(argumentsJSON))
            let result = await coordinator.call(session: session, request: request, context: context, argumentsJSON: argumentsJSON)
            return try result.jsonText()
        } catch { return (try? ComputerResult.failure(nativeFailure(error)).jsonText()) ?? "{\"content\":[],\"isError\":true}" }
    }
    public func revoke(session: String) {
        authorization.revoke(session: session)
        Task { await coordinator.cancel(session: session) }
    }
    public func revokeAll() {
        authorization.revokeAll()
        Task { await coordinator.cancelAll() }
    }
    public func cancelRequest(session: String, request: String) {
        authorization.cancelRequest(session: session, request: request)
        Task { await coordinator.cancelRequest(session: session, request: request) }
    }
    public func end(session: String) async {
        authorization.revoke(session: session)
        await coordinator.end(session: session)
    }
    public func resetAll() async {
        authorization.revokeAll()
        await coordinator.resetAll()
    }
    public func diagnostics() async throws -> String {
        var result = await coordinator.diagnostics()
        result["supported"] = .bool(true); result["installed"] = .bool(true)
        result["accessibility"] = .bool(AXIsProcessTrusted())
        result["screenRecording"] = .bool(CGPreflightScreenCaptureAccess())
        result["version"] = .string("2.0.0")
        result["abiVersion"] = .number(2)
        result["backend"] = .string("CozeaMacComputerRuntimeV2")
        result["sky"] = .object(SkyClickBackend.diagnostics)
        return try JSONValue.object(result).jsonText()
    }
}

private actor RuntimeCoordinator {
    private struct Key: Hashable { let session: String; let request: String }
    private struct Pending { let fingerprint: String; let task: Task<ComputerResult, Never>; let timer: Task<Void, Never> }
    private struct Completed { let key: Key; let fingerprint: String; let result: ComputerResult? }
    private let authorization: AuthorizationRegistry
    private let clock = StateClock()
    private let windows = WindowRegistry()
    private let activity = InputActivity()
    private let leases = ObservationStore<ObservationLease>()
    private let capture = CaptureRuntime()
    private let observationGate = InputGate(maxQueued: 16)
    private let accessibility: AccessibilityRuntime
    private let actions: ActionRouter
    private var running: [Key: Pending] = [:]
    private var completed: [Completed] = []
    private var closingSessions: Set<String> = []
    private var resetting = false
    private var sessions: Set<String> = []

    init(authorization: AuthorizationRegistry) {
        self.authorization = authorization
        accessibility = AccessibilityRuntime(windows: windows, clock: clock)
        actions = ActionRouter(accessibility: accessibility, clock: clock, activity: activity)
    }

    func call(session: String, request: ToolRequest, context: NativeCallContext, argumentsJSON: String) async -> ComputerResult {
        do {
            guard !resetting, !closingSessions.contains(session) else {
                throw RuntimeFailure(.busy, "Native session teardown is in progress.")
            }
            try authorization.authorize(session: session, revision: context.policyRevision, tool: request.tool)
            let key = Key(session: session, request: context.requestID)
            let canonical = try JSONValue.object(JSONValue.decodeObject(argumentsJSON)).jsonText()
            let fingerprint = SHA256.hash(data: Data((request.tool.rawValue + "\n" + context.policyRevision + "\n" + canonical).utf8)).map { String(format: "%02x", $0) }.joined()
            if let previous = completed.first(where: { $0.key == key }) {
                guard previous.fingerprint == fingerprint else { throw RuntimeFailure(.invalidRequestID, "A request ID was reused with different arguments.") }
                guard let result = previous.result else { throw RuntimeFailure(.staleObservation, "This observation result is no longer cached. Use a new request ID.") }
                return result
            }
            if let pending = running[key] {
                guard pending.fingerprint == fingerprint else { throw RuntimeFailure(.invalidRequestID, "A request ID was reused with different arguments.") }
                return await pending.task.value
            }
            let control = try authorization.register(session: session, request: context.requestID, revision: context.policyRevision, tool: request.tool)
            sessions.insert(session)
            let owner = Data(session.utf8).base64EncodedString() + ":" + context.requestID
            let task = Task { [self] in
                let span = NativeTelemetry.span("request.\(request.tool.rawValue)")
                defer { span.end() }
                do { return try await execute(session: session, request: request, owner: owner, control: control) }
                catch {
                    let failure = nativeFailure(error, control: control)
                    NativeTelemetry.failure(failure.code.rawValue)
                    await CursorController.shared.cancel(owner: owner)
                    return ComputerResult.failure(failure)
                }
            }
            let timer = Task {
                do { try await Task.sleep(for: .seconds(30)) } catch { return }
                control.cancellation.cancel(RuntimeFailure(.timedOut, "Computer Use request deadline expired."))
                task.cancel()
            }
            running[key] = Pending(fingerprint: fingerprint, task: task, timer: timer)
            let result = await task.value
            timer.cancel(); running.removeValue(forKey: key)
            authorization.finish(session: session, request: context.requestID, control: control)
            // Keep small acknowledgements/tombstones, not images or document text.
            let cache = (try? result.jsonText().utf8.count).map { $0 <= 8192 } == true ? result : nil
            if !resetting && !closingSessions.contains(session) { completed.append(Completed(key: key, fingerprint: fingerprint, result: cache)) }
            if completed.count > 512 { completed.removeFirst(completed.count - 512) }
            return result
        } catch { return .failure(nativeFailure(error)) }
    }

    private func execute(session: String, request: ToolRequest, owner: String, control: ActionControl) async throws -> ComputerResult {
        try control.check()
        switch request.operation {
        case .listApps:
            let list = await AppDirectory.shared.list()
            try control.check()
            return .text(list)
        case .observe(let app, let options):
            return try await observationGate.withPermit { [self] in
                try await observe(session: session, app: app, options: options, control: control)
            }
        default:
            guard let app = request.operation.app else { throw RuntimeFailure(.invalidArguments, "An action requires an app.") }
            let lease = try await leases.lease(session: session, app: app, id: request.observationID)
            return try await actions.execute(request, lease: lease, owner: owner, control: control)
        }
    }

    private struct ImageOutcome: Sendable { let image: CapturedImage?; let error: RuntimeFailure? }
    private func imageOutcome(window: WindowHandle, session: String, after time: CFTimeInterval, include: Bool, control: ActionControl) async -> ImageOutcome {
        guard include else { return ImageOutcome(image: nil, error: nil) }
        do { return ImageOutcome(image: try await capture.snapshot(window: window, session: session, notBefore: time, control: control), error: nil) }
        catch { return ImageOutcome(image: nil, error: nativeFailure(error)) }
    }
    private func treeOutcome(window: WindowHandle, options: ObservationOptions, control: ActionControl) async throws -> TreeObservation? {
        guard options.includeText else { return nil }
        return try await accessibility.snapshot(window: window, options: options, control: control)
    }
    private func observe(session: String, app query: String, options: ObservationOptions, control: ActionControl) async throws -> ComputerResult {
        for attempt in 0...1 {
            try control.check()
            let app = try await AppDirectory.shared.resolve(query)
            let window = try await windows.resolve(app: app, control: control)
            let before = await clock.current(window.identity)
            let inputBefore = activity.status(window.identity)
            let minFrameTime = max(inputBefore.lastDispatchTime, CACurrentMediaTime() - 0.1)
            async let treeWork = treeOutcome(window: window, options: options, control: control)
            async let imageWork = imageOutcome(window: window, session: session, after: minFrameTime, include: options.includeScreenshot, control: control)
            let (tree, image) = try await (treeWork, imageWork)
            try control.check()
            try await windows.validate(window, control: control)
            let after = await clock.current(window.identity)
            let inputAfter = activity.status(window.identity)
            let coherent = before.observed == after.observed && inputBefore.revision == inputAfter.revision && !inputAfter.dispatching
            if !coherent && attempt == 0 { continue }
            if tree == nil && image.image == nil { throw image.error ?? RuntimeFailure(.stateRequired, "No observation was available.") }
            let id = UUID().uuidString
            let lease = ObservationLease(id: id, window: window, tree: tree, imageGeometry: image.image?.geometry,
                                         revision: after, createdAt: .now, coherent: coherent, inputRevision: inputAfter.revision)
            try await leases.publish(session: session, id: id, aliases: [query] + app.aliases, value: lease)
            try control.check()
            var metadata: [String: JSONValue] = [
                "snapshot_id": .string(id), "state_version": .string(String(after.observed)),
                "command_version": .string(String(after.dispatched)), "window_id": .number(Double(window.identity.windowID)),
                "window_generation": .string(String(window.identity.generation)), "observation_consistent": .bool(coherent),
                "tree_truncated": .bool(tree?.truncated ?? false), "image_available": .bool(image.image != nil),
            ]
            if let imageError = image.error { metadata["image_error"] = .string(imageError.code.rawValue) }
            if let capture = image.image {
                metadata["image_width"] = .number(Double(capture.geometry.pixelWidth)); metadata["image_height"] = .number(Double(capture.geometry.pixelHeight))
                metadata["capture_source"] = .string(capture.source)
            }
            var text = try JSONValue.object(metadata).jsonText()
            if let tree { text += "\n\n" + tree.text }
            if !coherent { text += "\nThe UI changed during observation. Re-observe before an action; this snapshot cannot authorize input." }
            var contents: [ResultContent] = [.text(text)]
            if let image = image.image { contents.append(.png(image.png)) }
            return ComputerResult(content: contents)
        }
        throw RuntimeFailure(.internalError, "Observation retry bound exceeded.")
    }

    func cancelRequest(session: String, request: String) { running[Key(session: session, request: request)]?.task.cancel() }
    func cancel(session: String) {
        for (key, entry) in running where key.session == session { entry.task.cancel() }
        Task { await CursorController.shared.cancelSession(session) }
    }
    func cancelAll() { running.values.forEach { $0.task.cancel() }; Task { await CursorController.shared.cancel() } }
    func end(session: String) async {
        closingSessions.insert(session)
        defer { closingSessions.remove(session) }
        cancel(session: session)
        let draining = running.filter { $0.key.session == session }.map(\.value.task)
        for task in draining { _ = await task.value }
        await leases.remove(session: session)
        await capture.releaseSession(session)
        await CursorController.shared.cancelSession(session)
        sessions.remove(session)
        completed.removeAll { $0.key.session == session }
        authorization.forget(session: session)
        if sessions.isEmpty { await accessibility.reset(); await windows.reset(); await clock.reset(); activity.reset() }
    }
    func resetAll() async {
        resetting = true
        defer { resetting = false }
        cancelAll()
        let draining = running.values.map(\.task)
        for task in draining { _ = await task.value }
        await leases.reset(); await capture.reset(); await accessibility.reset(); await windows.reset(); await clock.reset()
        activity.reset(); sessions.removeAll(); completed.removeAll()
        await CursorController.shared.cancel()
    }
    func diagnostics() async -> [String: JSONValue] {
        ["capture": .object(await capture.diagnostics()), "active_requests": .number(Double(running.count)),
         "active_sessions": .number(Double(sessions.count)), "observations": .string("explicit-only")]
    }
}
